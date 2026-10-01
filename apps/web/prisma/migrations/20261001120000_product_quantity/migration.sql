-- Аддитивно: прежние количества, цены и финансовая история не изменяются.
BEGIN;
ALTER TABLE "Product" ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Product" ADD CONSTRAINT "Product_quantity_positive" CHECK ("quantity" >= 1);
ALTER TABLE "Work" ADD COLUMN "quantityPerUnit" DECIMAL(10,2);
ALTER TABLE "ProjectMaterial" ADD COLUMN "quantityPerUnit" DECIMAL(12,3);
UPDATE "Work" SET "quantityPerUnit" = "quantity"
WHERE "productId" IS NOT NULL AND "paymentKind" = 'LEGACY';
UPDATE "ProjectMaterial" SET "quantityPerUnit" = "quantity";
COMMIT;
