-- Добавочные корректировки сохраняют исходные SETTLED-снимки и начисления.
CREATE TABLE "ProductPercentageAdjustment" (
  "id" TEXT PRIMARY KEY,
  "completionShareId" TEXT NOT NULL REFERENCES "ProductPercentageCompletionShare"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "recipientId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "clientMutationId" TEXT NOT NULL,
  "configRevision" INTEGER NOT NULL,
  "kind" "ProductPercentageKind" NOT NULL,
  "unitPrice" DECIMAL(12,2) NOT NULL,
  "quantity" INTEGER NOT NULL,
  "ratePercent" DECIMAL(5,2) NOT NULL,
  "previousAmount" DECIMAL(12,2) NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "delta" DECIMAL(12,2) NOT NULL,
  "calculationVersion" INTEGER NOT NULL DEFAULT 4,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductPercentageAdjustment_shape" CHECK (
    "calculationVersion"=4 AND "configRevision">0 AND "quantity">0
    AND "unitPrice">=0 AND "unitPrice"<>'NaN'
    AND "ratePercent">=0 AND "ratePercent"<=15 AND "ratePercent"<>'NaN'
    AND "previousAmount">=0 AND "previousAmount"<>'NaN'
    AND "amount">=0 AND "amount"<>'NaN' AND "delta"<>'NaN'
    AND "amount"=CEIL((CASE WHEN "kind"='ENGINEERING' THEN "unitPrice" ELSE "unitPrice"*"quantity" END)*"ratePercent"/100)
    AND "delta"="amount"-"previousAmount")
);
-- statement-breakpoint
CREATE UNIQUE INDEX "ProductPercentageAdjustment_clientMutationId_key" ON "ProductPercentageAdjustment"("clientMutationId");
-- statement-breakpoint
CREATE UNIQUE INDEX "ProductPercentageAdjustment_completionShareId_configRevision_key" ON "ProductPercentageAdjustment"("completionShareId","configRevision");
-- statement-breakpoint
ALTER TABLE "PayrollEntry" ADD COLUMN "percentageAdjustmentId" TEXT REFERENCES "ProductPercentageAdjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- statement-breakpoint
CREATE UNIQUE INDEX "PayrollEntry_percentageAdjustmentId_key" ON "PayrollEntry"("percentageAdjustmentId");
-- statement-breakpoint
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_percentage_adjustment_fields" CHECK (
  "percentageAdjustmentId" IS NULL OR
  ("percentageCompletionShareId" IS NULL AND "settlementShareId" IS NULL
    AND "scheme" IN ('PRODUCT_PERCENT_ENGINEERING','PRODUCT_PERCENT_ASSEMBLY','PRODUCT_PERCENT_INSTALLATION')
    AND "productId" IS NOT NULL AND "projectId" IS NOT NULL AND "currency"='BYN' AND "projectCurrency"='BYN'
    AND "amount"<>0 AND "amount"<>'NaN' AND "bynAmount"="amount" AND "projectAmount"="amount"
    AND "bynAmount" IS NOT NULL AND "projectAmount" IS NOT NULL));
-- statement-breakpoint
CREATE FUNCTION "validate_product_percentage_adjustment"() RETURNS trigger AS $$
DECLARE source RECORD; previous_amount DECIMAL(12,2);
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
  SELECT a."amount" INTO previous_amount FROM "ProductPercentageAdjustment" a
    WHERE a."completionShareId"=NEW."completionShareId" ORDER BY a."configRevision" DESC LIMIT 1;
  previous_amount:=COALESCE(previous_amount,source."amount");
  IF NEW."previousAmount" IS DISTINCT FROM previous_amount
  THEN RAISE EXCEPTION 'product percentage adjustment baseline mismatch'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- statement-breakpoint
CREATE TRIGGER "ProductPercentageAdjustment_source" BEFORE INSERT ON "ProductPercentageAdjustment"
  FOR EACH ROW EXECUTE FUNCTION "validate_product_percentage_adjustment"();
-- statement-breakpoint
CREATE TRIGGER "ProductPercentageAdjustment_append_only" BEFORE UPDATE OR DELETE ON "ProductPercentageAdjustment"
  FOR EACH ROW EXECUTE FUNCTION "reject_product_payment_history_mutation"();
-- statement-breakpoint
CREATE OR REPLACE FUNCTION "protect_settled_product_payroll_entry"() RETURNS trigger AS $$
BEGIN
  IF OLD."settlementShareId" IS NOT NULL OR OLD."percentageCompletionShareId" IS NOT NULL OR OLD."percentageAdjustmentId" IS NOT NULL
  THEN RAISE EXCEPTION 'product percentage payroll entry is append-only'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- statement-breakpoint
CREATE FUNCTION "validate_product_percentage_adjustment_payroll"() RETURNS trigger AS $$
DECLARE source RECORD;
BEGIN
  IF NEW."percentageAdjustmentId" IS NULL THEN RETURN NEW; END IF;
  SELECT a."recipientId",a."delta",a."kind",c."productId",p."projectId"
    INTO source FROM "ProductPercentageAdjustment" a
    JOIN "ProductPercentageCompletionShare" s ON s."id"=a."completionShareId"
    JOIN "ProductPercentageCompletion" c ON c."id"=s."completionId"
    JOIN "Product" p ON p."id"=c."productId" WHERE a."id"=NEW."percentageAdjustmentId";
  IF NOT FOUND OR NEW."userId" IS DISTINCT FROM source."recipientId"
    OR NEW."productId" IS DISTINCT FROM source."productId" OR NEW."projectId" IS DISTINCT FROM source."projectId"
    OR NEW."amount" IS DISTINCT FROM source."delta"
    OR NEW."scheme" IS DISTINCT FROM ('PRODUCT_PERCENT_'||source."kind"::text)
  THEN RAISE EXCEPTION 'product percentage adjustment payroll mismatch'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- statement-breakpoint
CREATE TRIGGER "PayrollEntry_percentage_adjustment_source" BEFORE INSERT ON "PayrollEntry"
  FOR EACH ROW EXECUTE FUNCTION "validate_product_percentage_adjustment_payroll"();
-- statement-breakpoint
CREATE OR REPLACE FUNCTION "protect_product_percentage_completion"() RETURNS trigger AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'product percentage completion is append-only'; END IF;
  IF OLD."state"='SKIPPED_ONCE' AND NEW."state"='SETTLED'
    AND OLD."amount" IS NULL AND OLD."bynAmount" IS NULL AND OLD."projectAmount" IS NULL
    AND NEW."calculationVersion"=4 AND NEW."productCurrency"='BYN' AND NEW."payrollCurrency"='BYN'
    AND NEW."ratePercentSnapshot">0 AND NEW."recipientId" IS NOT NULL
    AND ROW(NEW."id",NEW."productId",NEW."kind") IS NOT DISTINCT FROM ROW(OLD."id",OLD."productId",OLD."kind")
  THEN RETURN NEW; END IF;
  IF OLD."state"<>'PENDING_FX' OR NEW."state"<>'SETTLED'
    OR OLD."amount" IS NOT NULL OR OLD."bynAmount" IS NOT NULL OR OLD."projectAmount" IS NOT NULL
    OR NEW."amount" IS NULL OR NEW."bynAmount" IS NULL OR NEW."projectAmount" IS NULL
    OR NEW."productRateByn" IS NULL OR NEW."payrollRateByn" IS NULL
    OR NEW."productRateDate" IS NULL OR NEW."payrollRateDate" IS NULL OR NEW."settledAt" IS NULL
    OR ROW(NEW."id",NEW."productId",NEW."kind",NEW."completedAt",NEW."completedById",NEW."statusAtCompletion",
      NEW."reason",NEW."priceSnapshot",NEW."ratePercentSnapshot",NEW."productCurrency",NEW."payrollCurrency",NEW."configRevision",
      NEW."calculationVersion",NEW."quantitySnapshot",NEW."totalSnapshot",NEW."recipientId")
    IS DISTINCT FROM ROW(OLD."id",OLD."productId",OLD."kind",OLD."completedAt",OLD."completedById",OLD."statusAtCompletion",
      OLD."reason",OLD."priceSnapshot",OLD."ratePercentSnapshot",OLD."productCurrency",OLD."payrollCurrency",OLD."configRevision",
      OLD."calculationVersion",OLD."quantitySnapshot",OLD."totalSnapshot",OLD."recipientId")
  THEN RAISE EXCEPTION 'product percentage completion inputs are immutable'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- statement-breakpoint
CREATE OR REPLACE FUNCTION "protect_product_percentage_share"() RETURNS trigger AS $$
DECLARE completion RECORD;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'product percentage share is append-only'; END IF;
  SELECT * INTO completion FROM "ProductPercentageCompletion" WHERE "id"=OLD."completionId";
  IF completion."state"='SETTLED' AND completion."calculationVersion"=4
    AND OLD."amount" IS NULL AND OLD."bynAmount" IS NULL AND OLD."projectAmount" IS NULL
    AND NEW."userId"=completion."recipientId" AND NEW."shareUnits"=1000000
    AND NEW."amount"=completion."amount" AND NEW."bynAmount"=completion."bynAmount" AND NEW."projectAmount"=completion."projectAmount"
    AND ROW(NEW."id",NEW."completionId") IS NOT DISTINCT FROM ROW(OLD."id",OLD."completionId")
  THEN RETURN NEW; END IF;
  IF completion."state"<>'PENDING_FX' OR OLD."amount" IS NOT NULL OR OLD."bynAmount" IS NOT NULL OR OLD."projectAmount" IS NOT NULL
    OR NEW."amount" IS NULL OR NEW."bynAmount" IS NULL OR NEW."projectAmount" IS NULL
    OR ROW(NEW."id",NEW."completionId",NEW."userId",NEW."userNameSnapshot",NEW."shareUnits")
    IS DISTINCT FROM ROW(OLD."id",OLD."completionId",OLD."userId",OLD."userNameSnapshot",OLD."shareUnits")
  THEN RAISE EXCEPTION 'product percentage share inputs are immutable'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
