-- Требует согласованной замены web: прежняя Prisma-модель несовместима с DROP.
-- Меняются только размещение и удаляемые владельцем метаданные; IDs/objects/FKs сохранены.
BEGIN;
CREATE TYPE "FileSection" AS ENUM ('GENERAL', 'MEASUREMENT', 'PRODUCTION', 'INSTALLATION');
ALTER TABLE "File" ADD COLUMN "section" "FileSection";
UPDATE "File"
SET "section" = CASE
  WHEN "category"::text = 'MEASUREMENT' THEN 'MEASUREMENT'::"FileSection"
  WHEN "productId" IS NULL THEN 'GENERAL'::"FileSection"
  WHEN "stage"::text = 'INSTALLATION' THEN 'INSTALLATION'::"FileSection"
  ELSE 'PRODUCTION'::"FileSection"
END;
ALTER TABLE "File" ALTER COLUMN "section" SET NOT NULL;
ALTER TABLE "File" ALTER COLUMN "section" SET DEFAULT 'GENERAL';
DROP INDEX "File_projectId_category_idx";
DROP INDEX "File_projectId_stage_idx";
ALTER TABLE "File" DROP COLUMN "category", DROP COLUMN "stage", DROP COLUMN "caption";
DROP TYPE "FileCategory";
DROP TYPE "FileStage";
CREATE INDEX "File_projectId_section_idx" ON "File"("projectId", "section");
COMMIT;
