-- Backfill пустых процентных ставок нулями (решение владельца 06.10.2026: пустое = 0).
-- Начислений, ревизий и истории не создаёт и не меняет; только заполняет NULL.
UPDATE "ProductPercentageConfig" SET "ratePercent" = 0 WHERE "ratePercent" IS NULL;
UPDATE "OrgSetting" SET "value" = REPLACE("value", ':null', ':"0.00"')
WHERE "key" = 'productPercentageDefaults' AND "value" LIKE '%null%';
-- Изделия без конфигов (legacy-импорт) получают все три ставки 0: поле никогда не пустое.
INSERT INTO "ProductPercentageConfig" ("id","productId","kind","ratePercent","revision","reviewedLegacyWorkIds","createdAt","updatedAt")
SELECT gen_random_uuid(), p."id", k."kind"::"ProductPercentageKind", 0, 1, '{}', NOW(), NOW()
FROM "Product" p CROSS JOIN (VALUES ('ENGINEERING'),('ASSEMBLY'),('INSTALLATION')) AS k("kind")
WHERE NOT EXISTS (SELECT 1 FROM "ProductPercentageConfig" c WHERE c."productId" = p."id" AND c."kind" = k."kind"::"ProductPercentageKind");
