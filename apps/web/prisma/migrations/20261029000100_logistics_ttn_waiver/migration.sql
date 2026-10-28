-- Явное исключение сохраняется отдельно в рейсе и неизменяемом проведении.
ALTER TABLE "LogisticsTrip" ADD COLUMN "ttnNotRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LogisticsPosting" ADD COLUMN "ttnNotRequired" BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION "check_logistics_posting_total"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE posting_id TEXT; posting "LogisticsPosting"%ROWTYPE; total_amount NUMERIC; total_byn NUMERIC; total_bps INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'LogisticsPosting' THEN posting_id := NEW."id";
  ELSIF TG_TABLE_NAME = 'Payment' THEN
    IF NEW."logisticsAllocationId" IS NULL THEN RETURN NULL; END IF;
    SELECT "postingId" INTO posting_id FROM "LogisticsPostingAllocation" WHERE "id" = NEW."logisticsAllocationId";
  ELSE posting_id := NEW."postingId";
  END IF;
  SELECT * INTO posting FROM "LogisticsPosting" WHERE "id" = posting_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT COALESCE(sum("amount"),0), COALESCE(sum("bynAmount"),0), COALESCE(sum("percentBps"),0)
    INTO total_amount,total_byn,total_bps FROM "LogisticsPostingAllocation" WHERE "postingId" = posting_id;
  IF total_amount <> posting."amount" OR total_byn <> posting."bynAmount" OR total_bps <> 10000 THEN
    RAISE EXCEPTION 'LOGISTICS_POSTING_TOTAL_MISMATCH' USING ERRCODE = '23514';
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
      OR a."bynAmount" <> round(a."amount" * posting."rate",2))) THEN
    RAISE EXCEPTION 'LOGISTICS_POSTING_PAYMENT_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
