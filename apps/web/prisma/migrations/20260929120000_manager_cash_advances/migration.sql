-- Additive only. Review before applying to the existing local/staging databases.
-- Historical Payout rows remain NULL in every new field; no inferred cash/currency.
BEGIN;
ALTER TABLE "Payout"
  ADD COLUMN "cashAccountId" TEXT,
  ADD COLUMN "cashAmount" DECIMAL(12,2),
  ADD COLUMN "cashCurrency" TEXT,
  ADD COLUMN "bynAmount" DECIMAL(18,2),
  ADD COLUMN "cashRate" DECIMAL(14,6),
  ADD COLUMN "payrollRate" DECIMAL(14,6),
  ADD COLUMN "cashRateDate" DATE,
  ADD COLUMN "payrollRateDate" DATE,
  ADD COLUMN "payrollCurrency" TEXT;

ALTER TABLE "Payout"
  ADD CONSTRAINT "Payout_cashAccountId_fkey"
    FOREIGN KEY ("cashAccountId") REFERENCES "CashAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Payout_cash_fields_complete" CHECK (
    ("cashAccountId" IS NULL AND "cashAmount" IS NULL AND "cashCurrency" IS NULL
      AND "bynAmount" IS NULL AND "cashRate" IS NULL AND "payrollRate" IS NULL
      AND "cashRateDate" IS NULL AND "payrollRateDate" IS NULL AND "payrollCurrency" IS NULL)
    OR
    ("cashAccountId" IS NOT NULL AND "cashAmount" IS NOT NULL AND "cashCurrency" IS NOT NULL
      AND "bynAmount" IS NOT NULL AND "cashRate" IS NOT NULL AND "payrollRate" IS NOT NULL
      AND "cashRateDate" IS NOT NULL AND "payrollRateDate" IS NOT NULL AND "payrollCurrency" IS NOT NULL)
  ),
  ADD CONSTRAINT "Payout_cash_values_valid" CHECK (
    "cashAccountId" IS NULL OR
    ("cashAmount" > 0 AND "bynAmount" >= 0 AND "amount" > 0 AND "cashRate" > 0 AND "payrollRate" > 0
      AND "cashAmount" <> 'NaN'::numeric AND "bynAmount" <> 'NaN'::numeric
      AND "amount" <> 'NaN'::numeric AND "cashRate" <> 'NaN'::numeric AND "payrollRate" <> 'NaN'::numeric
      AND "cashCurrency" IN ('BYN', 'RUB', 'USD', 'EUR')
      AND "payrollCurrency" IN ('BYN', 'RUB', 'USD', 'EUR')
      AND ("cashCurrency" <> 'BYN' OR "cashRate" = 1)
      AND ("payrollCurrency" <> 'BYN' OR "payrollRate" = 1)
      AND ("cashCurrency" <> "payrollCurrency" OR "cashRate" = "payrollRate"))
  );

CREATE INDEX "Payout_cashAccountId_idx" ON "Payout"("cashAccountId");
COMMIT;
