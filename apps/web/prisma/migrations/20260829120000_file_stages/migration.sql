-- Группы файлов по этапам мебельного производства (плагин file-stages):
-- новый enum FileStage и поле stage на File (по умолчанию Производство,
-- существующие файлы попадают в «Производство»).

BEGIN;

-- 1. Тип-перечисление этапов
CREATE TYPE "FileStage" AS ENUM ('PRODUCTION', 'ASSEMBLY', 'INSTALLATION');

-- 2. Поле группы на файле
ALTER TABLE "File" ADD COLUMN "stage" "FileStage" NOT NULL DEFAULT 'PRODUCTION';

-- 3. Индекс для выборки файлов проекта по группе
CREATE INDEX "File_projectId_stage_idx" ON "File" ("projectId", "stage");

COMMIT;
