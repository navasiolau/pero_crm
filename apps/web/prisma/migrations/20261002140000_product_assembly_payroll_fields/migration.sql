-- Forward-only extension: preserve every existing percentage payroll invariant.
ALTER TABLE "PayrollEntry" DROP CONSTRAINT "PayrollEntry_percentage_fields";
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_percentage_fields" CHECK (
  "percentageCompletionShareId" IS NULL OR
  ("settlementShareId" IS NULL AND "scheme" IN ('PRODUCT_PERCENT_ENGINEERING','PRODUCT_PERCENT_INSTALLATION','PRODUCT_PERCENT_ASSEMBLY')
    AND "productId" IS NOT NULL AND "projectId" IS NOT NULL
    AND "currency" IN ('BYN','RUB','USD','EUR') AND "projectCurrency" IN ('BYN','RUB','USD','EUR')
    AND "amount" IS NOT NULL AND "amount" > 0 AND "amount" <> 'NaN'
    AND "bynAmount" IS NOT NULL AND "bynAmount" >= 0 AND "bynAmount" <> 'NaN'
    AND "projectAmount" IS NOT NULL AND "projectAmount" >= 0 AND "projectAmount" <> 'NaN')
);
