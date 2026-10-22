-- Только additive-метаданные: исходные IDs, storageKey, SHA, авторство и receipts не меняются.
BEGIN;
-- Backfill и включение legacy-sync видны вместе; старый writer не попадёт в промежуток.
LOCK TABLE "Payment" IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE "PaymentReportDocument" (
  "paymentId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "position" INTEGER NOT NULL CHECK ("position" >= 0),
  CONSTRAINT "PaymentReportDocument_pkey" PRIMARY KEY ("paymentId", "documentId"),
  CONSTRAINT "PaymentReportDocument_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PaymentReportDocument_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "FinanceDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PaymentReportDocument_documentId_key" ON "PaymentReportDocument"("documentId");
CREATE UNIQUE INDEX "PaymentReportDocument_paymentId_position_key" ON "PaymentReportDocument"("paymentId", "position");

INSERT INTO "PaymentReportDocument" ("paymentId", "documentId", "position")
  SELECT "id", "reportDocumentId", 0 FROM "Payment" WHERE "reportDocumentId" IS NOT NULL;

-- Одиночный старый клиент также создаёт коллекцию в той же транзакции.
CREATE FUNCTION "sync_legacy_payment_report_document"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."reportDocumentId" IS NOT NULL THEN
    INSERT INTO "PaymentReportDocument" ("paymentId", "documentId", "position")
      VALUES (NEW."id", NEW."reportDocumentId", 0)
      ON CONFLICT ("paymentId", "documentId") DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Payment_report_document_legacy_sync" AFTER INSERT OR UPDATE OF "reportDocumentId" ON "Payment"
  FOR EACH ROW EXECUTE FUNCTION "sync_legacy_payment_report_document"();

-- Блокировка оригинала закрывает гонку READY/владелец между проверкой writer и привязкой.
CREATE FUNCTION "validate_payment_report_document"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE document "FinanceDocument"%ROWTYPE; payment "Payment"%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."paymentId" IS DISTINCT FROM NEW."paymentId" THEN
    RAISE EXCEPTION 'PAYMENT_REPORT_DOCUMENT_BINDING_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO document FROM "FinanceDocument" WHERE "id" = NEW."documentId" FOR UPDATE;
  SELECT * INTO payment FROM "Payment" WHERE "id" = NEW."paymentId";
  IF document."id" IS NULL OR payment."id" IS NULL OR document."state" <> 'READY'
    OR document."uploadedById" IS DISTINCT FROM payment."createdById"
    OR payment."direction" <> 'EXPENSE' OR payment."logisticsAllocationId" IS NOT NULL
    OR EXISTS (SELECT 1 FROM "Payment" p WHERE p."reportDocumentId" = NEW."documentId" AND p."id" <> NEW."paymentId") THEN
    RAISE EXCEPTION 'PAYMENT_REPORT_DOCUMENT_UNAVAILABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "PaymentReportDocument_validate" BEFORE INSERT OR UPDATE ON "PaymentReportDocument"
  FOR EACH ROW EXECUTE FUNCTION "validate_payment_report_document"();

-- Расширяет deferred-инвариант 20261010143000: обычный комплект недопустим у логистики.
-- Сам исходный check_logistics_posting_total и его триггеры сохраняются полностью.
CREATE FUNCTION "check_payment_report_document_set"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE payment_id TEXT; payment "Payment"%ROWTYPE; count_documents INTEGER; last_position INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'Payment' THEN payment_id := NEW."id";
  ELSIF TG_OP = 'DELETE' THEN payment_id := OLD."paymentId";
  ELSE payment_id := NEW."paymentId";
  END IF;
  SELECT * INTO payment FROM "Payment" WHERE "id" = payment_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT count(*), max("position") INTO count_documents, last_position
    FROM "PaymentReportDocument" WHERE "paymentId" = payment_id;
  IF payment."logisticsAllocationId" IS NOT NULL AND (count_documents <> 0 OR payment."reportDocumentId" IS NOT NULL) THEN
    RAISE EXCEPTION 'LOGISTICS_POSTING_PAYMENT_MISMATCH' USING ERRCODE = '23514';
  END IF;
  IF count_documents > 0 AND (last_position <> count_documents - 1
    OR payment."reportDocumentId" IS DISTINCT FROM (SELECT "documentId" FROM "PaymentReportDocument" WHERE "paymentId" = payment_id AND "position" = 0)) THEN
    RAISE EXCEPTION 'PAYMENT_REPORT_DOCUMENT_SET_MISMATCH' USING ERRCODE = '23514';
  END IF;
  IF count_documents = 0 AND payment."reportDocumentId" IS NOT NULL THEN
    RAISE EXCEPTION 'PAYMENT_REPORT_DOCUMENT_SET_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "Payment_report_document_set" AFTER INSERT OR UPDATE ON "Payment"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_payment_report_document_set"();
CREATE CONSTRAINT TRIGGER "PaymentReportDocument_set" AFTER INSERT OR UPDATE OR DELETE ON "PaymentReportDocument"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_payment_report_document_set"();
COMMIT;
