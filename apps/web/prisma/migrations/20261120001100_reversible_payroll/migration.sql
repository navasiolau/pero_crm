CREATE TABLE "PayrollPayoutBatch" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "actorId" TEXT NOT NULL,
  "selection" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3)
);

ALTER TABLE "Payout"
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletedById" TEXT,
  ADD COLUMN "lastActionId" TEXT,
  ADD COLUMN "batchId" TEXT REFERENCES "PayrollPayoutBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Payout_batchId_idx" ON "Payout"("batchId");
CREATE INDEX "Payout_deletedAt_idx" ON "Payout"("deletedAt");

ALTER TABLE "PayrollEntry"
  ADD COLUMN "compensatesId" TEXT REFERENCES "PayrollEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD COLUMN "compensationActionId" TEXT,
  ADD COLUMN "compensationRevision" INTEGER;
ALTER TABLE "PayrollEntry"
  ADD CONSTRAINT "PayrollEntry_compensation_origin" CHECK (
    ("compensatesId" IS NULL) = ("compensationActionId" IS NULL) AND
    ("compensatesId" IS NULL) = ("compensationRevision" IS NULL) AND
    ("compensatesId" IS NULL OR
      ("compensatesId" <> id AND "compensationRevision" > 0 AND "percentageCompletionShareId" IS NULL
       AND "percentageAdjustmentId" IS NULL AND "settlementShareId" IS NULL))
  );
CREATE UNIQUE INDEX "PayrollEntry_compensatesId_compensationActionId_key"
  ON "PayrollEntry"("compensatesId", "compensationActionId");
CREATE UNIQUE INDEX "PayrollEntry_compensatesId_compensationRevision_key"
  ON "PayrollEntry"("compensatesId", "compensationRevision");

CREATE FUNCTION "pero_payroll_compensation_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."compensatesId" IS NOT NULL OR EXISTS (SELECT 1 FROM "PayrollEntry" WHERE "compensatesId" = OLD.id) THEN
    RAISE EXCEPTION 'payroll compensation and source are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW."compensatesId" IS DISTINCT FROM OLD."compensatesId" OR
     NEW."compensationActionId" IS DISTINCT FROM OLD."compensationActionId" OR
     NEW."compensationRevision" IS DISTINCT FROM OLD."compensationRevision" THEN
    RAISE EXCEPTION 'payroll compensation origin is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "PayrollEntry_compensation_immutable"
  BEFORE UPDATE OR DELETE ON "PayrollEntry" FOR EACH ROW
  EXECUTE FUNCTION "pero_payroll_compensation_immutable"();

CREATE FUNCTION "pero_payroll_compensation_source"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source "PayrollEntry"%ROWTYPE; multiplier INTEGER; revision INTEGER;
BEGIN
  IF NEW."compensatesId" IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO source FROM "PayrollEntry" WHERE id = NEW."compensatesId";
  SELECT COALESCE(MAX("compensationRevision"), 0) + 1 INTO revision
    FROM "PayrollEntry" WHERE "compensatesId" = NEW."compensatesId";
  multiplier := CASE WHEN revision % 2 = 1 THEN -1 ELSE 1 END;
  IF source.id IS NULL OR source."compensatesId" IS NOT NULL OR NEW."compensationRevision" <> revision OR
     ROW(NEW."userId", NEW."taskId", NEW."workId", NEW."productId", NEW."projectId", NEW.currency, NEW."projectCurrency", NEW.scheme, NEW.month)
     IS DISTINCT FROM ROW(source."userId", source."taskId", source."workId", source."productId", source."projectId",
       source.currency, source."projectCurrency", source.scheme, source.month) OR
     ROW(NEW.amount, NEW."bynAmount", NEW."projectAmount")
     IS DISTINCT FROM ROW(source.amount * multiplier, source."bynAmount" * multiplier, source."projectAmount" * multiplier) THEN
    RAISE EXCEPTION 'payroll compensation source mismatch';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "PayrollEntry_compensation_source" BEFORE INSERT ON "PayrollEntry"
  FOR EACH ROW EXECUTE FUNCTION "pero_payroll_compensation_source"();

CREATE OR REPLACE FUNCTION "validate_product_percentage_adjustment"() RETURNS trigger AS $$
DECLARE source RECORD; previous_amount DECIMAL(12,2); compensations NUMERIC;
BEGIN
  SELECT s."userId",s."amount",c."state",c."kind",c."productCurrency",p."status",
    p."expectedPrice",p."quantity",cfg."revision",cfg."ratePercent"
  INTO source FROM "ProductPercentageCompletionShare" s
    JOIN "ProductPercentageCompletion" c ON c."id"=s."completionId"
    JOIN "Product" p ON p."id"=c."productId"
    JOIN "ProductPercentageConfig" cfg ON cfg."productId"=p."id" AND cfg."kind"=c."kind"
  WHERE s."id"=NEW."completionShareId";
  IF NOT FOUND OR source."state"<>'SETTLED' OR source."productCurrency"<>'BYN' OR source."status"='DONE'
    OR NEW."recipientId" IS DISTINCT FROM source."userId" OR NEW."kind" IS DISTINCT FROM source."kind"
    OR NEW."unitPrice" IS DISTINCT FROM source."expectedPrice" OR NEW."quantity" IS DISTINCT FROM source."quantity"
    OR NEW."configRevision" IS DISTINCT FROM source."revision" OR NEW."ratePercent" IS DISTINCT FROM source."ratePercent"
  THEN RAISE EXCEPTION 'product percentage adjustment source mismatch'; END IF;
  SELECT COALESCE(SUM(c.amount),0) INTO compensations
    FROM "PayrollEntry" c JOIN "PayrollEntry" origin ON origin.id=c."compensatesId"
    LEFT JOIN "ProductPercentageAdjustment" a ON a.id=origin."percentageAdjustmentId"
    WHERE origin."percentageCompletionShareId"=NEW."completionShareId"
      OR a."completionShareId"=NEW."completionShareId";
  SELECT COALESCE(SUM(a.delta),0) + COALESCE(source."amount",0) + compensations INTO previous_amount
    FROM "ProductPercentageAdjustment" a WHERE a."completionShareId"=NEW."completionShareId";
  IF NEW."previousAmount" IS DISTINCT FROM previous_amount
  THEN RAISE EXCEPTION 'product percentage adjustment baseline mismatch'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
