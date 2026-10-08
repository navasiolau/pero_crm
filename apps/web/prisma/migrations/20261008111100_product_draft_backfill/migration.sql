BEGIN;

ALTER TABLE "Product" ALTER COLUMN "status" SET DEFAULT 'DRAFT'::"ProductStatus";

-- Все изделия ранних заказов, включая мягко удалённые проекты и изделия.
-- Меняем только статус/дату статуса; денежные снимки и бизнес-поля сохраняются.
CREATE TEMP TABLE "_product_draft_backfill_111" ON COMMIT DROP AS
SELECT p."id", p."status" AS "oldStatus"
FROM "Product" p
JOIN "Project" j ON j."id" = p."projectId"
WHERE j."stage" IN ('LEAD'::"ProjectStage", 'ESTIMATE'::"ProjectStage")
  AND p."status" <> 'DRAFT'::"ProductStatus";

INSERT INTO "ProductStatusHistory" ("id", "productId", "fromStatus", "toStatus", "comment", "changedById", "createdAt")
SELECT 'migration111-history-' || "id", "id", "oldStatus", 'DRAFT'::"ProductStatus",
       'Перенос изделий ранних проектов в черновики (задача 111)', NULL, CURRENT_TIMESTAMP
FROM "_product_draft_backfill_111";

INSERT INTO "ChangeLog" ("id", "actorType", "actorId", "actorName", "entity", "entityId", "action", "field", "oldValue", "newValue", "source", "createdAt")
SELECT 'migration111-audit-' || "id", 'system', 'migration111', 'Миграция черновиков',
       'product', "id", 'status', 'status', to_jsonb("oldStatus"::text), to_jsonb('DRAFT'::text), 'migration', CURRENT_TIMESTAMP
FROM "_product_draft_backfill_111";

UPDATE "Product" p
SET "status" = 'DRAFT'::"ProductStatus", "statusChangedAt" = CURRENT_TIMESTAMP
FROM "_product_draft_backfill_111" b
WHERE p."id" = b."id";

COMMIT;