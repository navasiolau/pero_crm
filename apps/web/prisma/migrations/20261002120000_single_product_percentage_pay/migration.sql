-- Version 1 financial facts remain unchanged, including their unknown quantity.
ALTER TABLE "ProductPercentageConfig" ADD COLUMN "workReview" JSONB;
ALTER TABLE "Product" ADD COLUMN "mounterId" TEXT;
CREATE INDEX "Product_mounterId_idx" ON "Product"("mounterId");
ALTER TABLE "Product" ADD CONSTRAINT "Product_mounterId_fkey"
  FOREIGN KEY ("mounterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductPercentageCompletion"
  ADD COLUMN "calculationVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "quantitySnapshot" INTEGER,
  ADD COLUMN "totalSnapshot" DECIMAL(18,2),
  ADD COLUMN "recipientId" TEXT;
ALTER TABLE "ProductPercentageCompletion" ADD CONSTRAINT "ProductPercentageCompletion_recipientId_fkey"
  FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductPercentageCompletion" ADD CONSTRAINT "ProductPercentageCompletion_version_shape" CHECK (
  ("calculationVersion" = 1 AND "quantitySnapshot" IS NULL AND "totalSnapshot" IS NULL AND "recipientId" IS NULL)
  OR ("calculationVersion" = 2 AND "quantitySnapshot" IS NOT NULL AND "quantitySnapshot" > 0
    AND "productCurrency" = 'BYN' AND "payrollCurrency" IS NOT NULL AND "payrollCurrency" = 'BYN'
    AND ("priceSnapshot" IS NULL OR ("priceSnapshot" >= 0 AND "priceSnapshot" <> 'NaN'))
    AND ("priceSnapshot" IS NULL OR "totalSnapshot" IS NOT NULL)
    AND ("totalSnapshot" IS NULL OR ("totalSnapshot" >= 0 AND "totalSnapshot" <> 'NaN'
      AND "priceSnapshot" IS NOT NULL AND "totalSnapshot" = "priceSnapshot" * "quantitySnapshot"))
    AND ("state" = 'LEGACY_PROTECTED' AND "amount" IS NULL AND "bynAmount" IS NULL AND "projectAmount" IS NULL
      OR "state" = 'SKIPPED_ONCE' AND "ratePercentSnapshot" IS NULL
        AND "amount" IS NULL AND "bynAmount" IS NULL AND "projectAmount" IS NULL
      OR "state" = 'SETTLED' AND "ratePercentSnapshot" IS NOT NULL
        AND "ratePercentSnapshot" >= 0 AND "ratePercentSnapshot" <= 100 AND "ratePercentSnapshot" <> 'NaN'
        AND ("ratePercentSnapshot" = 0 OR ("recipientId" IS NOT NULL AND "priceSnapshot" IS NOT NULL AND "totalSnapshot" IS NOT NULL))
        AND "sourceFundExact" IS NOT NULL AND "sourceFundExact" >= 0 AND "sourceFundExact" <> 'NaN'
        AND ("ratePercentSnapshot" = 0 AND "sourceFundExact" = 0
          OR "ratePercentSnapshot" > 0 AND "sourceFundExact" = "totalSnapshot" * "ratePercentSnapshot" / 100)
        AND "amount" IS NOT NULL AND "amount" >= 0 AND "amount" <> 'NaN'
        AND "amount" = ROUND("sourceFundExact", 2)
        AND "bynAmount" IS NOT NULL AND "bynAmount" = "amount"
        AND "projectAmount" IS NOT NULL AND "projectAmount" = "amount"
        AND "productRateByn" = 1 AND "productRateByn" IS NOT NULL
        AND "payrollRateByn" = 1 AND "payrollRateByn" IS NOT NULL
        AND "productRateDate" IS NOT NULL AND "payrollRateDate" IS NOT NULL
        AND "settledAt" IS NOT NULL))
);

-- Only a single eligible DISTINCT participant can supply a missing current assignment.
WITH candidates AS (
  SELECT c."productId", c."kind", MIN(u."id") AS "userId"
  FROM "ProductPercentageConfig" c
  JOIN "ProductPercentageParticipant" pp ON pp."configId" = c."id"
  JOIN "User" u ON u."id" = pp."userId"
  WHERE u."active" AND (
    c."kind" = 'ENGINEERING' AND 'ENGINEER' = ANY(u."roles")
    OR c."kind" = 'INSTALLATION' AND 'MOUNTER' = ANY(u."roles"))
    AND (SELECT COUNT(DISTINCT all_pp."userId") FROM "ProductPercentageParticipant" all_pp WHERE all_pp."configId" = c."id") = 1
  GROUP BY c."productId", c."kind" HAVING COUNT(DISTINCT pp."userId") = 1
)
UPDATE "Product" p SET "engineerId" = c."userId" FROM candidates c
WHERE c."productId" = p."id" AND c."kind" = 'ENGINEERING' AND p."engineerId" IS NULL;
WITH candidates AS (
  SELECT c."productId", MIN(u."id") AS "userId"
  FROM "ProductPercentageConfig" c
  JOIN "ProductPercentageParticipant" pp ON pp."configId" = c."id"
  JOIN "User" u ON u."id" = pp."userId"
  WHERE c."kind" = 'INSTALLATION' AND u."active" AND 'MOUNTER' = ANY(u."roles")
    AND (SELECT COUNT(DISTINCT all_pp."userId") FROM "ProductPercentageParticipant" all_pp WHERE all_pp."configId" = c."id") = 1
  GROUP BY c."productId" HAVING COUNT(DISTINCT pp."userId") = 1
)
UPDATE "Product" p SET "mounterId" = c."userId" FROM candidates c
WHERE c."productId" = p."id" AND p."mounterId" IS NULL;

-- Preserve the old one-way FX retry; freeze every new input column too.
CREATE OR REPLACE FUNCTION "protect_product_percentage_completion"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'product percentage completion is append-only'; END IF;
  IF OLD."state" <> 'PENDING_FX' OR NEW."state" <> 'SETTLED'
    OR OLD."amount" IS NOT NULL OR OLD."bynAmount" IS NOT NULL OR OLD."projectAmount" IS NOT NULL
    OR NEW."amount" IS NULL OR NEW."bynAmount" IS NULL OR NEW."projectAmount" IS NULL
    OR NEW."productRateByn" IS NULL OR NEW."payrollRateByn" IS NULL
    OR NEW."productRateDate" IS NULL OR NEW."payrollRateDate" IS NULL OR NEW."settledAt" IS NULL
    OR ROW(NEW."id",NEW."productId",NEW."kind",NEW."completedAt",NEW."completedById",NEW."statusAtCompletion",
      NEW."reason",NEW."priceSnapshot",NEW."ratePercentSnapshot",NEW."productCurrency",NEW."payrollCurrency",NEW."configRevision",
      NEW."calculationVersion",NEW."quantitySnapshot",NEW."totalSnapshot",NEW."recipientId")
       IS DISTINCT FROM
       ROW(OLD."id",OLD."productId",OLD."kind",OLD."completedAt",OLD."completedById",OLD."statusAtCompletion",
      OLD."reason",OLD."priceSnapshot",OLD."ratePercentSnapshot",OLD."productCurrency",OLD."payrollCurrency",OLD."configRevision",
      OLD."calculationVersion",OLD."quantitySnapshot",OLD."totalSnapshot",OLD."recipientId")
  THEN RAISE EXCEPTION 'product percentage completion inputs are immutable'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Missing protective markers only: existing completions and all payroll rows are untouched.
INSERT INTO "ProductPercentageCompletion"
  ("id","productId","kind","state","statusAtCompletion","reason","priceSnapshot","productCurrency")
SELECT 'single-legacy-engineering:' || p."id", p."id", 'ENGINEERING', 'LEGACY_PROTECTED', p."status",
  'Исторически завершённый или оплаченный этап: запрет повторной оплаты', p."expectedPrice", pr."currency"
FROM "Product" p JOIN "Project" pr ON pr."id" = p."projectId"
WHERE NOT EXISTS (SELECT 1 FROM "ProductPercentageCompletion" c WHERE c."productId" = p."id" AND c."kind" = 'ENGINEERING')
AND (p."status" IN ('PRODUCTION','DELIVERY','INSTALLATION','DONE')
  OR EXISTS (SELECT 1 FROM "ProductStatusHistory" h WHERE h."productId" = p."id" AND h."toStatus" IN ('PRODUCTION','DELIVERY','INSTALLATION','DONE'))
  OR EXISTS (SELECT 1 FROM "ProductStagePayPool" pool WHERE pool."productId" = p."id" AND pool."kind" = 'ENGINEERING' AND pool."state" IN ('SETTLED','LEGACY_PROTECTED'))
  OR EXISTS (SELECT 1 FROM "PayrollEntry" pay WHERE pay."projectId" = p."projectId" AND pay."scheme" = 'PERCENT_PROJECT'));
INSERT INTO "ProductPercentageCompletion"
  ("id","productId","kind","state","statusAtCompletion","reason","priceSnapshot","productCurrency")
SELECT 'single-legacy-installation:' || p."id", p."id", 'INSTALLATION', 'LEGACY_PROTECTED', p."status",
  'Исторически завершённый монтаж: запрет повторной оплаты', p."expectedPrice", pr."currency"
FROM "Product" p JOIN "Project" pr ON pr."id" = p."projectId"
WHERE NOT EXISTS (SELECT 1 FROM "ProductPercentageCompletion" c WHERE c."productId" = p."id" AND c."kind" = 'INSTALLATION')
AND (p."status" = 'DONE' OR EXISTS (SELECT 1 FROM "ProductStatusHistory" h WHERE h."productId" = p."id" AND h."toStatus" = 'DONE'));
