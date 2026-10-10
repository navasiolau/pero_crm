CREATE TYPE "LogisticsPostingStatus" AS ENUM ('ACTIVE', 'SUPERSEDED');
CREATE TABLE "LogisticsPosting" (
  "id" TEXT PRIMARY KEY,
  "tripId" TEXT NOT NULL REFERENCES "LogisticsTrip"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "tripRevision" INTEGER NOT NULL CHECK ("tripRevision" >= 1),
  "clientMutationId" TEXT NOT NULL UNIQUE,
  "requestFingerprint" TEXT NOT NULL,
  "actorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "actorNameSnapshot" TEXT NOT NULL,
  "status" "LogisticsPostingStatus" NOT NULL DEFAULT 'ACTIVE',
  "amount" DECIMAL(12,2) NOT NULL CHECK ("amount" > 0),
  "bynAmount" DECIMAL(12,2) NOT NULL CHECK ("bynAmount" >= 0),
  "currency" TEXT NOT NULL CHECK ("currency" IN ('BYN','USD','EUR','RUB')),
  "cashAccountId" TEXT NOT NULL REFERENCES "CashAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "cashAccountNameSnapshot" TEXT NOT NULL,
  "expenseArticleId" TEXT NOT NULL REFERENCES "ExpenseArticle"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "rate" DECIMAL(14,6) NOT NULL CHECK ("rate" > 0 AND ("currency" <> 'BYN' OR "rate" = 1)),
  "rateDate" TIMESTAMP(3), "paidAt" TIMESTAMP(3) NOT NULL,
  "manifestSnapshot" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("tripId","tripRevision"), UNIQUE ("id","tripId")
);
CREATE UNIQUE INDEX "LogisticsPosting_one_active_trip" ON "LogisticsPosting"("tripId") WHERE "status" = 'ACTIVE';
CREATE INDEX "LogisticsPosting_tripId_status_idx" ON "LogisticsPosting"("tripId","status");
CREATE TABLE "LogisticsPostingAllocation" (
  "id" TEXT PRIMARY KEY,
  "postingId" TEXT NOT NULL REFERENCES "LogisticsPosting"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "projectId" TEXT NOT NULL REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "projectNumberSnapshot" TEXT NOT NULL,
  "percentBps" INTEGER NOT NULL CHECK ("percentBps" > 0 AND "percentBps" <= 10000),
  "amount" DECIMAL(12,2) NOT NULL CHECK ("amount" >= 0),
  "bynAmount" DECIMAL(12,2) NOT NULL CHECK ("bynAmount" >= 0),
  UNIQUE ("postingId","projectId")
);
CREATE INDEX "LogisticsPostingAllocation_projectId_idx" ON "LogisticsPostingAllocation"("projectId");
ALTER TABLE "Payment" ADD COLUMN "logisticsAllocationId" TEXT;
CREATE UNIQUE INDEX "Payment_logisticsAllocationId_key" ON "Payment"("logisticsAllocationId");
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_logisticsAllocationId_fkey" FOREIGN KEY ("logisticsAllocationId") REFERENCES "LogisticsPostingAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "LogisticsDocument_id_tripId_key" ON "LogisticsDocument"("id","tripId");
CREATE TABLE "LogisticsPostingDocument" (
  "postingId" TEXT NOT NULL, "tripId" TEXT NOT NULL, "documentId" TEXT NOT NULL,
  PRIMARY KEY ("postingId","documentId"),
  FOREIGN KEY ("postingId","tripId") REFERENCES "LogisticsPosting"("id","tripId") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("documentId","tripId") REFERENCES "LogisticsDocument"("id","tripId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "LogisticsPostingDocument_documentId_tripId_idx" ON "LogisticsPostingDocument"("documentId","tripId");

-- Исторические поля не переписываются. Разрешено только ACTIVE -> SUPERSEDED.
CREATE FUNCTION "preserve_logistics_money"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'LogisticsPosting' AND TG_OP = 'UPDATE' THEN
    IF OLD."status" = 'ACTIVE' AND NEW."status" = 'SUPERSEDED' AND (to_jsonb(OLD) - 'status') = (to_jsonb(NEW) - 'status') THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME = 'Payment' THEN
    IF TG_OP = 'DELETE' AND OLD."logisticsAllocationId" IS NULL THEN RETURN OLD; END IF;
    IF TG_OP = 'UPDATE' AND OLD."logisticsAllocationId" IS NULL AND NEW."logisticsAllocationId" IS NULL THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'LOGISTICS_MONEY_HISTORY_IS_IMMUTABLE' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER "LogisticsPosting_immutable" BEFORE UPDATE OR DELETE ON "LogisticsPosting" FOR EACH ROW EXECUTE FUNCTION "preserve_logistics_money"();
CREATE TRIGGER "LogisticsPostingAllocation_immutable" BEFORE UPDATE OR DELETE ON "LogisticsPostingAllocation" FOR EACH ROW EXECUTE FUNCTION "preserve_logistics_money"();
CREATE TRIGGER "LogisticsPostingDocument_immutable" BEFORE UPDATE OR DELETE ON "LogisticsPostingDocument" FOR EACH ROW EXECUTE FUNCTION "preserve_logistics_money"();
CREATE TRIGGER "Payment_logistics_immutable" BEFORE UPDATE OR DELETE ON "Payment" FOR EACH ROW EXECUTE FUNCTION "preserve_logistics_money"();

CREATE FUNCTION "preserve_used_logistics_document"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "LogisticsPostingDocument" WHERE "documentId" = OLD."id") THEN
    RAISE EXCEPTION 'LOGISTICS_POSTING_DOCUMENT_IS_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "LogisticsDocument_posting_immutable" BEFORE UPDATE OR DELETE ON "LogisticsDocument" FOR EACH ROW EXECUTE FUNCTION "preserve_used_logistics_document"();

-- Проверка целого проведения отложена до конца той же транзакции.
CREATE FUNCTION "check_logistics_posting_total"() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF NOT EXISTS (SELECT 1 FROM "LogisticsPostingDocument" pd JOIN "LogisticsDocument" d ON d."id" = pd."documentId"
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
CREATE CONSTRAINT TRIGGER "LogisticsPosting_total" AFTER INSERT OR UPDATE ON "LogisticsPosting" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_logistics_posting_total"();
CREATE CONSTRAINT TRIGGER "LogisticsPostingAllocation_total" AFTER INSERT ON "LogisticsPostingAllocation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_logistics_posting_total"();
CREATE CONSTRAINT TRIGGER "LogisticsPostingDocument_total" AFTER INSERT ON "LogisticsPostingDocument" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_logistics_posting_total"();
CREATE CONSTRAINT TRIGGER "Payment_logistics_total" AFTER INSERT ON "Payment" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_logistics_posting_total"();
