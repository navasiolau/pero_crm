-- Add the unit-price engineering calculation while preserving every historical v1/v2 branch.
BEGIN;
ALTER TABLE "ProductPercentageCompletion" DROP CONSTRAINT "ProductPercentageCompletion_version_shape";
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
  OR ("calculationVersion" = 3 AND "quantitySnapshot" IS NOT NULL AND "quantitySnapshot" > 0
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
          OR "ratePercentSnapshot" > 0 AND "sourceFundExact" = CASE WHEN "kind" = 'ENGINEERING' THEN "priceSnapshot" ELSE "totalSnapshot" END * "ratePercentSnapshot" / 100)
        AND "amount" IS NOT NULL AND "amount" >= 0 AND "amount" <> 'NaN'
        AND "amount" = ROUND("sourceFundExact", 2)
        AND "bynAmount" IS NOT NULL AND "bynAmount" = "amount"
        AND "projectAmount" IS NOT NULL AND "projectAmount" = "amount"
        AND "productRateByn" = 1 AND "productRateByn" IS NOT NULL
        AND "payrollRateByn" = 1 AND "payrollRateByn" IS NOT NULL
        AND "productRateDate" IS NOT NULL AND "payrollRateDate" IS NOT NULL
        AND "settledAt" IS NOT NULL))
);
COMMIT;
