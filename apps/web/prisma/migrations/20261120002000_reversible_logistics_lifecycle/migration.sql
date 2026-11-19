ALTER TABLE "LogisticsProjectShare" ADD COLUMN "removedAt" TIMESTAMP(3);
ALTER TABLE "LogisticsShipmentLine" ADD COLUMN "removedAt" TIMESTAMP(3);
ALTER TABLE "LogisticsDocument" ADD COLUMN "hiddenAt" TIMESTAMP(3);
ALTER TABLE "LogisticsDocument" ADD COLUMN "visibilityRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "LogisticsPosting" ADD COLUMN "restoredFromId" TEXT;
ALTER TABLE "LogisticsPosting" ADD CONSTRAINT "LogisticsPosting_restoredFromId_fkey"
  FOREIGN KEY ("restoredFromId") REFERENCES "LogisticsPosting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LogisticsPosting" ADD CONSTRAINT "LogisticsPosting_single_source"
  CHECK ("restoredFromId" IS NULL OR "reallocatedFromId" IS NULL);

CREATE OR REPLACE FUNCTION "check_logistics_share_total"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE trip_id TEXT; total INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'LogisticsTrip' THEN
    IF TG_OP = 'DELETE' THEN trip_id := OLD."id"; ELSE trip_id := NEW."id"; END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN trip_id := OLD."tripId"; ELSE trip_id := NEW."tripId"; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM "LogisticsTrip" WHERE "id" = trip_id) THEN
    SELECT COALESCE(sum("percentBps"), 0) INTO total FROM "LogisticsProjectShare" WHERE "tripId" = trip_id AND "removedAt" IS NULL;
    IF total <> 10000 THEN RAISE EXCEPTION 'LOGISTICS_SHARES_MUST_TOTAL_10000' USING ERRCODE = '23514'; END IF;
  END IF;
  IF TG_TABLE_NAME = 'LogisticsProjectShare' THEN
    IF TG_OP = 'UPDATE' THEN
      IF OLD."tripId" <> NEW."tripId" AND EXISTS (SELECT 1 FROM "LogisticsTrip" WHERE "id" = OLD."tripId") THEN
        SELECT COALESCE(sum("percentBps"), 0) INTO total FROM "LogisticsProjectShare" WHERE "tripId" = OLD."tripId" AND "removedAt" IS NULL;
        IF total <> 10000 THEN RAISE EXCEPTION 'LOGISTICS_SHARES_MUST_TOTAL_10000' USING ERRCODE = '23514'; END IF;
      END IF;
    END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE FUNCTION "check_logistics_live_share"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE trip_id TEXT;
BEGIN
  trip_id := NEW."tripId";
  IF EXISTS (
    SELECT 1 FROM "LogisticsShipmentLine" line
    JOIN "LogisticsProjectShare" share USING ("tripId", "projectId")
    WHERE line."tripId" = trip_id AND line."removedAt" IS NULL AND share."removedAt" IS NOT NULL
  ) THEN RAISE EXCEPTION 'LOGISTICS_ACTIVE_LINE_REQUIRES_ACTIVE_SHARE' USING ERRCODE = '23514'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "LogisticsShipmentLine_live_share"
  AFTER INSERT OR UPDATE ON "LogisticsShipmentLine" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "check_logistics_live_share"();
CREATE CONSTRAINT TRIGGER "LogisticsProjectShare_live_lines"
  AFTER INSERT OR UPDATE ON "LogisticsProjectShare" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "check_logistics_live_share"();

CREATE FUNCTION "preserve_ready_logistics_document"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."state" = 'READY' AND (TG_OP = 'DELETE' OR
      (to_jsonb(OLD) - 'hiddenAt' - 'visibilityRevision') IS DISTINCT FROM
      (to_jsonb(NEW) - 'hiddenAt' - 'visibilityRevision')) THEN
    RAISE EXCEPTION 'LOGISTICS_READY_DOCUMENT_IS_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "LogisticsDocument_ready_immutable" BEFORE UPDATE OR DELETE ON "LogisticsDocument"
  FOR EACH ROW EXECUTE FUNCTION "preserve_ready_logistics_document"();

CREATE OR REPLACE FUNCTION "check_logistics_posting_total"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE posting_id TEXT; posting "LogisticsPosting"%ROWTYPE; total_amount NUMERIC; total_byn NUMERIC; total_bps INTEGER; rounded_byn NUMERIC; previous "LogisticsPosting"%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'LogisticsPosting' THEN posting_id := NEW."id";
  ELSIF TG_TABLE_NAME = 'Payment' THEN
    IF NEW."logisticsAllocationId" IS NULL THEN RETURN NULL; END IF;
    SELECT "postingId" INTO posting_id FROM "LogisticsPostingAllocation" WHERE "id" = NEW."logisticsAllocationId";
  ELSE posting_id := NEW."postingId";
  END IF;
  SELECT * INTO posting FROM "LogisticsPosting" WHERE "id" = posting_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT COALESCE(sum("amount"),0), COALESCE(sum("bynAmount"),0), COALESCE(sum("percentBps"),0), COALESCE(sum(round("amount" * posting."rate", 2)),0)
    INTO total_amount,total_byn,total_bps,rounded_byn FROM "LogisticsPostingAllocation" WHERE "postingId" = posting_id;
  IF total_amount <> posting."amount" OR total_byn <> posting."bynAmount" OR total_bps <> 10000 THEN
    RAISE EXCEPTION 'LOGISTICS_POSTING_TOTAL_MISMATCH' USING ERRCODE = '23514';
  END IF;
  IF COALESCE(posting."reallocatedFromId", posting."restoredFromId") IS NOT NULL THEN
    SELECT * INTO previous FROM "LogisticsPosting" WHERE "id" = COALESCE(posting."reallocatedFromId", posting."restoredFromId");
    IF NOT FOUND OR previous."tripId" <> posting."tripId" OR previous."status" <> 'SUPERSEDED'
      OR previous."tripRevision" >= posting."tripRevision"
      OR (previous."amount", previous."bynAmount", previous."currency", previous."rate",
          previous."rateDate", previous."paidAt", previous."cashAccountId", previous."cashAccountNameSnapshot",
          previous."expenseArticleId", previous."ttnNotRequired")
         IS DISTINCT FROM
         (posting."amount", posting."bynAmount", posting."currency", posting."rate",
          posting."rateDate", posting."paidAt", posting."cashAccountId", posting."cashAccountNameSnapshot",
          posting."expenseArticleId", posting."ttnNotRequired")
      OR ARRAY(SELECT "documentId" FROM "LogisticsPostingDocument" WHERE "postingId" = previous."id" ORDER BY "documentId")
         IS DISTINCT FROM
         ARRAY(SELECT "documentId" FROM "LogisticsPostingDocument" WHERE "postingId" = posting."id" ORDER BY "documentId")
    THEN
      RAISE EXCEPTION 'LOGISTICS_REALLOCATION_SOURCE_MISMATCH' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF posting."restoredFromId" IS NOT NULL AND (
    previous."manifestSnapshot" IS DISTINCT FROM posting."manifestSnapshot"
    OR EXISTS (
      (SELECT "projectId", "percentBps", "amount", "bynAmount", "projectNumberSnapshot"
       FROM "LogisticsPostingAllocation" WHERE "postingId" = previous."id"
       EXCEPT
       SELECT "projectId", "percentBps", "amount", "bynAmount", "projectNumberSnapshot"
       FROM "LogisticsPostingAllocation" WHERE "postingId" = posting."id")
      UNION ALL
      (SELECT "projectId", "percentBps", "amount", "bynAmount", "projectNumberSnapshot"
       FROM "LogisticsPostingAllocation" WHERE "postingId" = posting."id"
       EXCEPT
       SELECT "projectId", "percentBps", "amount", "bynAmount", "projectNumberSnapshot"
       FROM "LogisticsPostingAllocation" WHERE "postingId" = previous."id")
    )
  ) THEN
    RAISE EXCEPTION 'LOGISTICS_RESTORED_SOURCE_MISMATCH' USING ERRCODE = '23514';
  END IF;
  IF NOT posting."ttnNotRequired" AND NOT EXISTS (SELECT 1 FROM "LogisticsPostingDocument" pd JOIN "LogisticsDocument" d ON d."id" = pd."documentId"
    WHERE pd."postingId" = posting_id AND d."state" = 'READY' AND d."stage" IN ('ISSUED','SIGNED')) THEN
    RAISE EXCEPTION 'LOGISTICS_POSTING_TTN_REQUIRED' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM "LogisticsPostingDocument" pd JOIN "LogisticsDocument" d ON d."id" = pd."documentId"
    WHERE pd."postingId" = posting_id AND (d."state" <> 'READY' OR d."hiddenAt" IS NOT NULL OR d."tripId" <> posting."tripId")) THEN
    RAISE EXCEPTION 'LOGISTICS_POSTING_TTN_MISMATCH' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM "LogisticsPostingAllocation" a LEFT JOIN "Payment" p ON p."logisticsAllocationId" = a."id"
    WHERE a."postingId" = posting_id AND (
      (a."amount" = 0 AND p."id" IS NOT NULL) OR
      (a."amount" > 0 AND (p."id" IS NULL OR p."projectId" IS DISTINCT FROM a."projectId" OR p."direction" <> 'EXPENSE'
        OR p."amount" <> a."amount" OR p."bynAmount" <> a."bynAmount" OR p."projectAmount" IS DISTINCT FROM a."bynAmount"
        OR p."currency" <> posting."currency" OR p."rate" <> posting."rate" OR p."rateDate" IS DISTINCT FROM posting."rateDate"
        OR p."cashAccountId" IS DISTINCT FROM posting."cashAccountId" OR p."expenseArticleId" IS DISTINCT FROM posting."expenseArticleId"
        OR p."paidAt" <> posting."paidAt" OR p."deletionId" IS NOT NULL OR p."reportDocumentId" IS NOT NULL))
      OR (a."amount" = 0 AND a."bynAmount" <> 0)
      OR (a."bynAmount" <> round(a."amount" * posting."rate",2) AND
        (COALESCE(posting."reallocatedFromId", posting."restoredFromId") IS NULL
         OR sign(a."bynAmount" - round(a."amount" * posting."rate",2)) <> sign(posting."bynAmount" - rounded_byn))))) THEN
    RAISE EXCEPTION 'LOGISTICS_POSTING_PAYMENT_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
