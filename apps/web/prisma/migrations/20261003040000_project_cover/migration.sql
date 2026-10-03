-- Additive nullable project cover. No backfill or historical file changes.
ALTER TABLE "Project" ADD COLUMN "coverFileId" TEXT;
CREATE UNIQUE INDEX "Project_coverFileId_key" ON "Project"("coverFileId");
ALTER TABLE "Project" ADD CONSTRAINT "Project_coverFileId_fkey"
  FOREIGN KEY ("coverFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;
