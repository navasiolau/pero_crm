-- Рефактор «Проект = заказ с изделиями»:
-- старая таблица "Project" (фактически изделие) переименовывается в "Product",
-- сверху создаётся новая "Project" (заказ клиента). Данные переносятся 1:1:
-- для каждого изделия создаётся родительский проект с его реквизитами.

BEGIN;

-- 1. Статус изделия
CREATE TYPE "ProductStatus" AS ENUM ('DESIGN', 'PRODUCTION', 'DELIVERY', 'INSTALLATION', 'DONE', 'RECLAMATION');

-- 2. Старый "Project" становится "Product" (FK на него перепривязываются автоматически)
ALTER TABLE "Project" RENAME TO "Product";
ALTER TABLE "Product" RENAME CONSTRAINT "Project_pkey" TO "Product_pkey";
ALTER INDEX "Project_number_key" RENAME TO "Product_number_key";
-- имя освобождаем сразу: такой же индекс будет создан для новой таблицы "Project"
DROP INDEX "Project_stage_stageChangedAt_idx";

-- 3. Новая таблица проектов (заказов)
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "stage" "ProjectStage" NOT NULL DEFAULT 'LEAD',
    "stageChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currency" TEXT NOT NULL DEFAULT 'BYN',
    "address" TEXT,
    "refusalReason" TEXT,
    "refusalComment" TEXT,
    "reclamationReason" TEXT,
    "reclamationDescription" TEXT,
    "reclamationFault" TEXT,
    "managerId" TEXT,
    "engineerId" TEXT,
    "clientId" TEXT NOT NULL,
    "createdById" TEXT,
    "legacyId" TEXT,
    "legacyTable" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Project_number_key" ON "Project"("number");
CREATE INDEX "Project_stage_stageChangedAt_idx" ON "Project"("stage", "stageChangedAt");
ALTER TABLE "Project" ADD CONSTRAINT "Project_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_engineerId_fkey" FOREIGN KEY ("engineerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. История статусов изделия
CREATE TABLE "ProductStatusHistory" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "fromStatus" "ProductStatus",
    "toStatus" "ProductStatus" NOT NULL,
    "comment" TEXT,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductStatusHistory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProductStatusHistory_productId_createdAt_idx" ON "ProductStatusHistory"("productId", "createdAt");
ALTER TABLE "ProductStatusHistory" ADD CONSTRAINT "ProductStatusHistory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Соответствие изделие → новый проект (1:1)
CREATE TEMP TABLE _project_map AS
SELECT id AS product_id, replace(gen_random_uuid()::text, '-', '') AS project_id
FROM "Product";

INSERT INTO "Project" ("id", "number", "title", "stage", "stageChangedAt", "currency", "address",
    "refusalReason", "refusalComment", "reclamationReason", "reclamationDescription", "reclamationFault",
    "managerId", "engineerId", "clientId", "createdById", "legacyId", "legacyTable", "createdAt", "updatedAt")
SELECT m.project_id, p."number", p."title", p."stage", p."stageChangedAt", p."currency", p."address",
    p."refusalReason", p."refusalComment", p."reclamationReason", p."reclamationDescription", p."reclamationFault",
    p."managerId", p."engineerId", p."clientId", p."createdById", p."legacyId", p."legacyTable", p."createdAt", p."updatedAt"
FROM "Product" p
JOIN _project_map m ON m.product_id = p.id;

-- 6. Приводим "Product" к новой схеме
ALTER TABLE "Product" ADD COLUMN "projectId" TEXT;
ALTER TABLE "Product" ADD COLUMN "status" "ProductStatus" NOT NULL DEFAULT 'DESIGN';
ALTER TABLE "Product" ADD COLUMN "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "Product" p SET "projectId" = m.project_id FROM _project_map m WHERE m.product_id = p.id;
UPDATE "Product" SET
    "status" = (CASE "stage"::text
        WHEN 'IN_WORK' THEN 'PRODUCTION'
        WHEN 'DONE' THEN 'DONE'
        WHEN 'RECLAMATION' THEN 'RECLAMATION'
        ELSE 'DESIGN' END)::"ProductStatus",
    "statusChangedAt" = "stageChangedAt";
UPDATE "Product" SET "number" = "number" || '-1';

ALTER TABLE "Product" ALTER COLUMN "projectId" SET NOT NULL;
ALTER TABLE "Product"
    DROP COLUMN "clientId",
    DROP COLUMN "managerId",
    DROP COLUMN "engineerId",
    DROP COLUMN "stage",
    DROP COLUMN "stageChangedAt",
    DROP COLUMN "address",
    DROP COLUMN "refusalReason",
    DROP COLUMN "refusalComment",
    DROP COLUMN "reclamationReason",
    DROP COLUMN "reclamationDescription",
    DROP COLUMN "reclamationFault",
    DROP COLUMN "currency";

ALTER TABLE "Product" ADD CONSTRAINT "Product_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Product_projectId_idx" ON "Product"("projectId");
CREATE INDEX "Product_status_statusChangedAt_idx" ON "Product"("status", "statusChangedAt");

-- Начальная запись в истории статусов изделия
INSERT INTO "ProductStatusHistory" ("id", "productId", "fromStatus", "toStatus", "createdAt")
SELECT replace(gen_random_uuid()::text, '-', ''), id, NULL, "status", "statusChangedAt" FROM "Product";

-- 7. Задачи: старый projectId (= изделие) → productId, новый projectId → проект
ALTER TABLE "Task" DROP CONSTRAINT "Task_projectId_fkey";
ALTER TABLE "Task" RENAME COLUMN "projectId" TO "productId";
ALTER TABLE "Task" ALTER COLUMN "productId" DROP NOT NULL;
ALTER TABLE "Task" ADD COLUMN "projectId" TEXT;
UPDATE "Task" t SET "projectId" = m.project_id FROM _project_map m WHERE m.product_id = t."productId";
ALTER TABLE "Task" ALTER COLUMN "projectId" SET NOT NULL;
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Task_productId_idx" ON "Task"("productId");

-- 8. Работы: то же
ALTER TABLE "Work" DROP CONSTRAINT "Work_projectId_fkey";
ALTER TABLE "Work" RENAME COLUMN "projectId" TO "productId";
ALTER TABLE "Work" ALTER COLUMN "productId" DROP NOT NULL;
ALTER INDEX "Work_projectId_idx" RENAME TO "Work_productId_idx";
ALTER TABLE "Work" ADD COLUMN "projectId" TEXT;
UPDATE "Work" w SET "projectId" = m.project_id FROM _project_map m WHERE m.product_id = w."productId";
ALTER TABLE "Work" ALTER COLUMN "projectId" SET NOT NULL;
ALTER TABLE "Work" ADD CONSTRAINT "Work_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Work" ADD CONSTRAINT "Work_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Work_projectId_idx" ON "Work"("projectId");

-- 9. Файлы: то же
ALTER TABLE "File" DROP CONSTRAINT "File_projectId_fkey";
DROP INDEX "File_projectId_category_idx";
ALTER TABLE "File" RENAME COLUMN "projectId" TO "productId";
ALTER TABLE "File" ALTER COLUMN "productId" DROP NOT NULL;
ALTER TABLE "File" ADD COLUMN "projectId" TEXT;
UPDATE "File" f SET "projectId" = m.project_id FROM _project_map m WHERE m.product_id = f."productId";
ALTER TABLE "File" ALTER COLUMN "projectId" SET NOT NULL;
ALTER TABLE "File" ADD CONSTRAINT "File_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "File" ADD CONSTRAINT "File_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "File_projectId_category_idx" ON "File"("projectId", "category");

-- 10. Коммуникации, платежи, история этапов — перепривязка к новому проекту
ALTER TABLE "Communication" DROP CONSTRAINT "Communication_projectId_fkey";
UPDATE "Communication" c SET "projectId" = m.project_id FROM _project_map m WHERE m.product_id = c."projectId";
ALTER TABLE "Communication" ADD CONSTRAINT "Communication_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Payment" DROP CONSTRAINT "Payment_projectId_fkey";
UPDATE "Payment" p SET "projectId" = m.project_id FROM _project_map m WHERE m.product_id = p."projectId";
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectStageHistory" DROP CONSTRAINT "ProjectStageHistory_projectId_fkey";
UPDATE "ProjectStageHistory" h SET "projectId" = m.project_id FROM _project_map m WHERE m.product_id = h."projectId";
ALTER TABLE "ProjectStageHistory" ADD CONSTRAINT "ProjectStageHistory_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Начисления (FK нет — просто перепривязка; NULL-записи «% оборота» не трогаем)
UPDATE "PayrollEntry" e SET "projectId" = m.project_id FROM _project_map m WHERE m.product_id = e."projectId";

-- 11. Склад: потребность и движения — на изделии (FK перепривязан при rename таблицы)
ALTER TABLE "ProjectMaterial" RENAME COLUMN "projectId" TO "productId";
ALTER TABLE "ProjectMaterial" RENAME CONSTRAINT "ProjectMaterial_projectId_fkey" TO "ProjectMaterial_productId_fkey";
ALTER INDEX "ProjectMaterial_projectId_materialId_key" RENAME TO "ProjectMaterial_productId_materialId_key";

ALTER TABLE "StockMovement" RENAME COLUMN "projectId" TO "productId";
ALTER TABLE "StockMovement" RENAME CONSTRAINT "StockMovement_projectId_fkey" TO "StockMovement_productId_fkey";
ALTER INDEX "StockMovement_projectId_idx" RENAME TO "StockMovement_productId_idx";

DROP TABLE _project_map;

COMMIT;
