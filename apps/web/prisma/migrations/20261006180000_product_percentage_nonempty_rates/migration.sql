-- Backfill пустых процентных ставок нулями (решение владельца 06.10.2026: пустое = 0).
-- Начислений, ревизий и истории не создаёт и не меняет; только заполняет NULL.
UPDATE "ProductPercentageConfig" SET "ratePercent" = 0 WHERE "ratePercent" IS NULL;
UPDATE "OrgSetting" SET "value" = REPLACE("value", ':null', ':"0.00"')
WHERE "key" = 'productPercentageDefaults' AND "value" LIKE '%null%';
