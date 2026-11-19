ALTER TYPE "FinanceDocumentState" ADD VALUE 'RETAINED';
ALTER TABLE "FinanceDocument" ADD COLUMN "visibilityRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PluginSetting" ADD COLUMN "configured" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Plugin" ADD COLUMN "settingsRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Notification" ADD COLUMN "readRevision" INTEGER NOT NULL DEFAULT 0;

-- Новые связи уже проверяет PaymentReportDocument_validate. Здесь защищаем повторное включение платежа.
CREATE FUNCTION "pero_payment_require_ready_documents"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE invalid_document BOOLEAN;
BEGIN
  IF NEW."deletedAt" IS NOT NULL OR NEW."deletionId" IS NOT NULL THEN RETURN NEW; END IF;
  IF OLD."deletedAt" IS NULL AND OLD."deletionId" IS NULL THEN RETURN NEW; END IF;
  SELECT bool_or(locked.state <> 'READY') INTO invalid_document FROM (
    SELECT d.state FROM "FinanceDocument" d
    WHERE d.id = NEW."reportDocumentId" OR EXISTS (
      SELECT 1 FROM "PaymentReportDocument" r WHERE r."paymentId" = NEW.id AND r."documentId" = d.id
    )
    ORDER BY d.id FOR SHARE OF d
  ) locked;
  IF invalid_document THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Сначала восстановите исходные отчётные документы';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Payment_require_ready_documents"
BEFORE UPDATE OF "deletedAt", "deletionId" ON "Payment"
FOR EACH ROW EXECUTE FUNCTION "pero_payment_require_ready_documents"();
