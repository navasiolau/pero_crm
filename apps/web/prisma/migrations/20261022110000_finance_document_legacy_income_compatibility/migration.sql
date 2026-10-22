-- Legacy INCOME + single reportDocumentId был разрешён прежним writer.
-- Новый комплект для приходов не добавляем; применённую миграцию 20261022090000 не меняем.
CREATE OR REPLACE FUNCTION "validate_payment_report_document"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE document "FinanceDocument"%ROWTYPE; payment "Payment"%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."paymentId" IS DISTINCT FROM NEW."paymentId" THEN
    RAISE EXCEPTION 'PAYMENT_REPORT_DOCUMENT_BINDING_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO document FROM "FinanceDocument" WHERE "id" = NEW."documentId" FOR UPDATE;
  SELECT * INTO payment FROM "Payment" WHERE "id" = NEW."paymentId";
  IF document."id" IS NULL OR payment."id" IS NULL OR document."state" <> 'READY'
    OR document."uploadedById" IS DISTINCT FROM payment."createdById"
    OR (payment."direction" <> 'EXPENSE' AND NOT (payment."direction" = 'INCOME'
      AND NEW."position" = 0 AND NEW."documentId" IS NOT DISTINCT FROM payment."reportDocumentId"))
    OR payment."logisticsAllocationId" IS NOT NULL
    OR EXISTS (SELECT 1 FROM "Payment" p WHERE p."reportDocumentId" = NEW."documentId" AND p."id" <> NEW."paymentId") THEN
    RAISE EXCEPTION 'PAYMENT_REPORT_DOCUMENT_UNAVAILABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
