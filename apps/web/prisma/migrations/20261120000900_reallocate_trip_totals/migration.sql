ALTER TABLE "LogisticsPosting" ADD COLUMN "reallocatedFromId" TEXT;
CREATE UNIQUE INDEX "LogisticsPosting_reallocatedFromId_key" ON "LogisticsPosting"("reallocatedFromId");
ALTER TABLE "LogisticsPosting" ADD CONSTRAINT "LogisticsPosting_reallocatedFromId_fkey"
  FOREIGN KEY ("reallocatedFromId") REFERENCES "LogisticsPosting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
  IF posting."reallocatedFromId" IS NOT NULL THEN
    SELECT * INTO previous FROM "LogisticsPosting" WHERE "id" = posting."reallocatedFromId";
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
  IF NOT posting."ttnNotRequired" AND NOT EXISTS (SELECT 1 FROM "LogisticsPostingDocument" pd JOIN "LogisticsDocument" d ON d."id" = pd."documentId"
    WHERE pd."postingId" = posting_id AND d."state" = 'READY' AND d."stage" IN ('ISSUED','SIGNED')) THEN
    RAISE EXCEPTION 'LOGISTICS_POSTING_TTN_REQUIRED' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM "LogisticsPostingDocument" pd JOIN "LogisticsDocument" d ON d."id" = pd."documentId"
    WHERE pd."postingId" = posting_id AND (d."state" <> 'READY' OR d."tripId" <> posting."tripId")) THEN
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
        (posting."reallocatedFromId" IS NULL
         OR sign(a."bynAmount" - round(a."amount" * posting."rate",2)) <> sign(posting."bynAmount" - rounded_byn))))) THEN
    RAISE EXCEPTION 'LOGISTICS_POSTING_PAYMENT_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
