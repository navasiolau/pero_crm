-- Новая причина означает окончательный пропуск этапа без назначенного сотрудника.
-- Старые SKIPPED_ONCE и legacy PENDING_FX сохраняют прежние допустимые переходы.
CREATE OR REPLACE FUNCTION "protect_product_percentage_completion"() RETURNS trigger AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'product percentage completion is append-only'; END IF;
  IF OLD."state"='SKIPPED_ONCE' AND NEW."state"='SETTLED'
    AND OLD."reason" IS DISTINCT FROM 'Сотрудник не назначен при завершении'
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
