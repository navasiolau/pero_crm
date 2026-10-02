-- Add the assembly kind without changing existing enum values or financial facts.
-- ASSEMBLY was committed by the preceding enum-only migration.
ALTER TABLE "Product" ADD COLUMN "assemblerId" TEXT;
CREATE INDEX "Product_assemblerId_idx" ON "Product"("assemblerId");
ALTER TABLE "Product" ADD CONSTRAINT "Product_assemblerId_fkey"
  FOREIGN KEY ("assemblerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Protective markers only. No payroll, assignment, price or quantity backfill.
INSERT INTO "ProductPercentageCompletion"
  ("id", "productId", "kind", "state", "statusAtCompletion", "reason", "productCurrency")
SELECT 'single-legacy-assembly:' || p."id", p."id", 'ASSEMBLY', 'LEGACY_PROTECTED', p."status",
  'Исторически достигнут этап сборки: запрет повторного начисления', pr."currency"
FROM "Product" p JOIN "Project" pr ON pr."id" = p."projectId"
WHERE NOT EXISTS (
  SELECT 1 FROM "ProductPercentageCompletion" c
  WHERE c."productId" = p."id" AND c."kind" = 'ASSEMBLY'
)
AND (p."status" IN ('DELIVERY', 'INSTALLATION', 'DONE')
  OR EXISTS (SELECT 1 FROM "ProductStatusHistory" h
    WHERE h."productId" = p."id" AND h."toStatus" IN ('DELIVERY', 'INSTALLATION', 'DONE')));
