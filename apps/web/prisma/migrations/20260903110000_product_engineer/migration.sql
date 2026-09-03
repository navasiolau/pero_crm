-- Инженер переезжает с проекта на изделие (решение владельца 09.2026):
-- инженер ответственен за конкретное изделие, на проекте их может быть
-- несколько — по одному на изделие. Существующие изделия наследуют
-- инженера своего проекта.
ALTER TABLE "Product" ADD COLUMN "engineerId" TEXT;

-- Бэкфилл: изделия проекта получают инженера проекта
UPDATE "Product" SET "engineerId" = p."engineerId"
FROM "Project" p
WHERE "Product"."projectId" = p."id" AND p."engineerId" IS NOT NULL;

ALTER TABLE "Product" ADD CONSTRAINT "Product_engineerId_fkey" FOREIGN KEY ("engineerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Product_engineerId_idx" ON "Product"("engineerId");

ALTER TABLE "Project" DROP CONSTRAINT IF EXISTS "Project_engineerId_fkey";
ALTER TABLE "Project" DROP COLUMN IF EXISTS "engineerId";
