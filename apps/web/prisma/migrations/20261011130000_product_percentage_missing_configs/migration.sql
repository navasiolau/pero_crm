-- Добавляются только отсутствующие пары, включая частичные конфиги и soft-deleted изделия.
-- Существующие ставки, ревизии, настройки организации и финансовая история неизменны.
INSERT INTO "ProductPercentageConfig" ("id","productId","kind","ratePercent","revision","reviewedLegacyWorkIds","createdAt","updatedAt")
SELECT gen_random_uuid(), p."id", k."kind"::"ProductPercentageKind", 0, 1, '{}', NOW(), NOW()
FROM "Product" p CROSS JOIN (VALUES ('ENGINEERING'),('ASSEMBLY'),('INSTALLATION')) AS k("kind")
WHERE NOT EXISTS (SELECT 1 FROM "ProductPercentageConfig" c WHERE c."productId" = p."id" AND c."kind" = k."kind"::"ProductPercentageKind")
ON CONFLICT ("productId","kind") DO NOTHING;
