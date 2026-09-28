-- Additive product-stage payment schema. Do not apply without separate approval.
-- Existing financial history and physical quantity values are not rewritten.
BEGIN;

CREATE TYPE "ProductPayStage" AS ENUM ('ENGINEERING', 'ASSEMBLY', 'INSTALLATION');
CREATE TYPE "ProductStagePayState" AS ENUM ('DRAFT', 'SETTLED', 'LEGACY_PROTECTED');
CREATE TYPE "WorkPaymentKind" AS ENUM ('LEGACY', 'ENGINEERING');
CREATE TYPE "TaskAllocationBudgetSource" AS ENUM ('TASK_FIXED', 'STAGE_PREVIEW');

CREATE TABLE "ProductStagePayPool" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "kind" "ProductPayStage" NOT NULL,
  "state" "ProductStagePayState" NOT NULL DEFAULT 'DRAFT',
  "ratePercent" DECIMAL(5,2),
  "revision" INTEGER NOT NULL DEFAULT 0,
  "legacyProjectId" TEXT,
  "legacyPayrollEntryIds" TEXT[] NOT NULL DEFAULT '{}',
  "legacyProtectedAt" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductStagePayPool_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductStagePayPool_ratePercent_range" CHECK ("ratePercent" IS NULL OR "ratePercent" BETWEEN 0 AND 100),
  CONSTRAINT "ProductStagePayPool_revision_nonnegative" CHECK ("revision" >= 0),
  CONSTRAINT "ProductStagePayPool_legacy_state" CHECK (
    ("state" = 'LEGACY_PROTECTED' AND "legacyProjectId" IS NOT NULL
      AND cardinality("legacyPayrollEntryIds") > 0
      AND array_position("legacyPayrollEntryIds", NULL) IS NULL
      AND "legacyProtectedAt" IS NOT NULL AND "ratePercent" IS NULL)
    OR ("state" <> 'LEGACY_PROTECTED' AND "legacyProjectId" IS NULL
      AND cardinality("legacyPayrollEntryIds") = 0
      AND "legacyProtectedAt" IS NULL)
  )
);

CREATE TABLE "WorkPaymentConversion" (
  "id" TEXT NOT NULL,
  "workId" TEXT NOT NULL,
  "poolId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "convertedById" TEXT NOT NULL,
  "convertedAt" TIMESTAMP(3) NOT NULL,
  "sourceSnapshot" JSONB NOT NULL,
  "targetShares" JSONB NOT NULL,
  CONSTRAINT "WorkPaymentConversion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkPaymentConversion_workId_key" UNIQUE ("workId"),
  CONSTRAINT "WorkPaymentConversion_requestId_key" UNIQUE ("requestId")
);

CREATE TABLE "ProductStageSettlement" (
  "id" TEXT NOT NULL,
  "poolId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "closedById" TEXT NOT NULL,
  "closedAt" TIMESTAMP(3) NOT NULL,
  "poolRevision" INTEGER NOT NULL,
  "primaryEngineerIdSnapshot" TEXT NOT NULL,
  "primaryEngineerNameSnapshot" TEXT NOT NULL,
  "priceSnapshot" DECIMAL(12,2) NOT NULL,
  "ratePercentSnapshot" DECIMAL(5,2) NOT NULL,
  "productCurrency" TEXT NOT NULL,
  "payrollCurrency" TEXT NOT NULL,
  "productRateByn" DECIMAL(18,6) NOT NULL,
  "payrollRateByn" DECIMAL(18,6) NOT NULL,
  "productRateDate" DATE NOT NULL,
  "payrollRateDate" DATE NOT NULL,
  "sourceFundExact" DECIMAL(18,6) NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "bynAmount" DECIMAL(18,2) NOT NULL,
  "projectAmount" DECIMAL(12,2) NOT NULL,
  CONSTRAINT "ProductStageSettlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductStageSettlement_poolId_key" UNIQUE ("poolId"),
  CONSTRAINT "ProductStageSettlement_nonnegative" CHECK (
    "priceSnapshot" >= 0 AND "sourceFundExact" >= 0 AND "amount" >= 0
    AND "bynAmount" >= 0 AND "projectAmount" >= 0
    AND "ratePercentSnapshot" BETWEEN 0 AND 100
    AND "productRateByn" > 0 AND "payrollRateByn" > 0
    AND "priceSnapshot" <> 'NaN' AND "sourceFundExact" <> 'NaN'
    AND "amount" <> 'NaN' AND "bynAmount" <> 'NaN' AND "projectAmount" <> 'NaN'
    AND "ratePercentSnapshot" <> 'NaN'
    AND "productRateByn" <> 'NaN' AND "payrollRateByn" <> 'NaN'
    AND "productCurrency" IN ('BYN','RUB','USD','EUR')
    AND "payrollCurrency" IN ('BYN','RUB','USD','EUR')
  )
);

CREATE TABLE "ProductStageSettlementShare" (
  "id" TEXT NOT NULL,
  "settlementId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "workId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "taskTitleSnapshot" TEXT NOT NULL,
  "workTitleSnapshot" TEXT NOT NULL,
  "userNameSnapshot" TEXT NOT NULL,
  "workWeightUnits" INTEGER NOT NULL,
  "stageShareUnits" INTEGER NOT NULL,
  "quantitySnapshot" DECIMAL(10,2),
  "quantityShareUnitsSnapshot" INTEGER NOT NULL,
  "allocationGroupIdSnapshot" TEXT,
  "amount" DECIMAL(12,2) NOT NULL,
  "bynAmount" DECIMAL(18,2) NOT NULL,
  "projectAmount" DECIMAL(12,2) NOT NULL,
  CONSTRAINT "ProductStageSettlementShare_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductStageSettlementShare_settlementId_taskId_key" UNIQUE ("settlementId", "taskId"),
  CONSTRAINT "ProductStageSettlementShare_bounds" CHECK (
    "workWeightUnits" BETWEEN 0 AND 1000000
    AND "stageShareUnits" BETWEEN 0 AND 1000000
    AND "quantityShareUnitsSnapshot" BETWEEN 1 AND 1000000
    AND "amount" >= 0 AND "bynAmount" >= 0 AND "projectAmount" >= 0
    AND "amount" <> 'NaN' AND "bynAmount" <> 'NaN' AND "projectAmount" <> 'NaN'
  )
);

ALTER TABLE "ProductStagePayPool" ADD CONSTRAINT "ProductStagePayPool_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductStagePayPool" ADD CONSTRAINT "ProductStagePayPool_legacyProjectId_fkey"
  FOREIGN KEY ("legacyProjectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductStagePayPool" ADD CONSTRAINT "ProductStagePayPool_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkPaymentConversion" ADD CONSTRAINT "WorkPaymentConversion_workId_fkey"
  FOREIGN KEY ("workId") REFERENCES "Work"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkPaymentConversion" ADD CONSTRAINT "WorkPaymentConversion_poolId_fkey"
  FOREIGN KEY ("poolId") REFERENCES "ProductStagePayPool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkPaymentConversion" ADD CONSTRAINT "WorkPaymentConversion_convertedById_fkey"
  FOREIGN KEY ("convertedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductStageSettlement" ADD CONSTRAINT "ProductStageSettlement_poolId_fkey"
  FOREIGN KEY ("poolId") REFERENCES "ProductStagePayPool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductStageSettlement" ADD CONSTRAINT "ProductStageSettlement_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductStageSettlement" ADD CONSTRAINT "ProductStageSettlement_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductStageSettlement" ADD CONSTRAINT "ProductStageSettlement_closedById_fkey"
  FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductStageSettlement" ADD CONSTRAINT "ProductStageSettlement_primaryEngineerIdSnapshot_fkey"
  FOREIGN KEY ("primaryEngineerIdSnapshot") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductStageSettlementShare" ADD CONSTRAINT "ProductStageSettlementShare_settlementId_fkey"
  FOREIGN KEY ("settlementId") REFERENCES "ProductStageSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductStageSettlementShare" ADD CONSTRAINT "ProductStageSettlementShare_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductStageSettlementShare" ADD CONSTRAINT "ProductStageSettlementShare_workId_fkey"
  FOREIGN KEY ("workId") REFERENCES "Work"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductStageSettlementShare" ADD CONSTRAINT "ProductStageSettlementShare_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "ProductStagePayPool_state_kind_idx" ON "ProductStagePayPool"("state", "kind");
CREATE UNIQUE INDEX "ProductStagePayPool_productId_kind_key" ON "ProductStagePayPool"("productId", "kind");
CREATE INDEX "Task_workId_idx" ON "Task"("workId");
CREATE INDEX "ProductStageSettlement_projectId_idx" ON "ProductStageSettlement"("projectId");
CREATE INDEX "ProductStageSettlement_productId_idx" ON "ProductStageSettlement"("productId");
CREATE INDEX "ProductStageSettlementShare_workId_idx" ON "ProductStageSettlementShare"("workId");
CREATE INDEX "ProductStageSettlementShare_userId_idx" ON "ProductStageSettlementShare"("userId");

ALTER TABLE "Work" ALTER COLUMN "priceSnapshot" DROP NOT NULL;
ALTER TABLE "Work" ALTER COLUMN "total" DROP NOT NULL;
ALTER TABLE "Work" ADD COLUMN "paymentKind" "WorkPaymentKind" NOT NULL DEFAULT 'LEGACY';
ALTER TABLE "Work" ADD COLUMN "stagePayPoolId" TEXT;
ALTER TABLE "Work" ADD COLUMN "poolWeightUnits" INTEGER;
ALTER TABLE "Work" ADD CONSTRAINT "Work_stage_payment_complete" CHECK (
  ("paymentKind" = 'ENGINEERING' AND "productId" IS NOT NULL
    AND "stagePayPoolId" IS NOT NULL AND "poolWeightUnits" IS NOT NULL)
  OR ("paymentKind" = 'LEGACY' AND "stagePayPoolId" IS NULL
    AND "poolWeightUnits" IS NULL AND "priceSnapshot" IS NOT NULL AND "total" IS NOT NULL)
);
ALTER TABLE "Work" ADD CONSTRAINT "Work_poolWeightUnits_bounds" CHECK (
  "poolWeightUnits" IS NULL OR "poolWeightUnits" BETWEEN 0 AND 1000000
);
ALTER TABLE "Work" ADD CONSTRAINT "Work_stagePayPoolId_fkey"
  FOREIGN KEY ("stagePayPoolId") REFERENCES "ProductStagePayPool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Work_stagePayPoolId_idx" ON "Work"("stagePayPoolId");

ALTER TABLE "TaskAllocationGroup" ALTER COLUMN "budget" DROP NOT NULL;
ALTER TABLE "TaskAllocationGroup" ADD COLUMN "budgetSource" "TaskAllocationBudgetSource" NOT NULL DEFAULT 'TASK_FIXED';
ALTER TABLE "TaskAllocationGroup" ADD CONSTRAINT "TaskAllocationGroup_budget_source" CHECK (
  ("budgetSource" = 'TASK_FIXED' AND "budget" IS NOT NULL AND "budget" >= 0)
  OR ("budgetSource" = 'STAGE_PREVIEW' AND "workId" IS NOT NULL
    AND "quantity" IS NOT NULL AND "quantity" > 0 AND "budget" IS NULL AND "currency" IS NULL)
);

ALTER TABLE "Task" ADD COLUMN "stageShareUnits" INTEGER;
ALTER TABLE "Task" ADD CONSTRAINT "Task_stageShareUnits_bounds" CHECK (
  "stageShareUnits" IS NULL OR "stageShareUnits" BETWEEN 0 AND 1000000
);
ALTER TABLE "Task" DROP CONSTRAINT "Task_allocation_complete";
ALTER TABLE "Task" ADD CONSTRAINT "Task_allocation_complete" CHECK (
  ("allocationGroupId" IS NULL AND "shareUnits" IS NULL AND "shareAmount" IS NULL)
  OR ("allocationGroupId" IS NOT NULL AND "shareUnits" IS NOT NULL
    AND "shareUnits" BETWEEN 1 AND 1000000
    AND (("shareAmount" IS NOT NULL AND "shareAmount" >= 0)
      OR ("shareAmount" IS NULL AND "stageShareUnits" IS NOT NULL)))
);

ALTER TABLE "PayrollEntry" ADD COLUMN "productId" TEXT;
ALTER TABLE "PayrollEntry" ADD COLUMN "settlementShareId" TEXT;
ALTER TABLE "PayrollEntry" ADD COLUMN "bynAmount" DECIMAL(18,2);
ALTER TABLE "PayrollEntry" ADD COLUMN "projectAmount" DECIMAL(12,2);
ALTER TABLE "PayrollEntry" ADD COLUMN "projectCurrency" TEXT;
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_settlement_fields" CHECK (
  "settlementShareId" IS NULL OR
  ("scheme" = 'PRODUCT_ENGINEERING' AND "productId" IS NOT NULL
    AND "currency" IN ('BYN','RUB','USD','EUR')
    AND "projectCurrency" IN ('BYN','RUB','USD','EUR')
    AND "amount" IS NOT NULL AND "amount" >= 0 AND "amount" <> 'NaN'
    AND "bynAmount" IS NOT NULL AND "bynAmount" >= 0 AND "bynAmount" <> 'NaN'
    AND "projectAmount" IS NOT NULL AND "projectAmount" >= 0 AND "projectAmount" <> 'NaN')
);
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_settlementShareId_fkey"
  FOREIGN KEY ("settlementShareId") REFERENCES "ProductStageSettlementShare"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "PayrollEntry_productId_idx" ON "PayrollEntry"("productId");
CREATE UNIQUE INDEX "PayrollEntry_settlementShareId_key" ON "PayrollEntry"("settlementShareId");

CREATE OR REPLACE FUNCTION "reject_product_payment_history_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'product payment history is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "WorkPaymentConversion_append_only" BEFORE UPDATE OR DELETE ON "WorkPaymentConversion"
  FOR EACH ROW EXECUTE FUNCTION "reject_product_payment_history_mutation"();
CREATE TRIGGER "ProductStageSettlement_append_only" BEFORE UPDATE OR DELETE ON "ProductStageSettlement"
  FOR EACH ROW EXECUTE FUNCTION "reject_product_payment_history_mutation"();
CREATE TRIGGER "ProductStageSettlementShare_append_only" BEFORE UPDATE OR DELETE ON "ProductStageSettlementShare"
  FOR EACH ROW EXECUTE FUNCTION "reject_product_payment_history_mutation"();

CREATE OR REPLACE FUNCTION "protect_settled_product_payroll_entry"() RETURNS trigger AS $$
BEGIN
  IF OLD."settlementShareId" IS NOT NULL THEN
    RAISE EXCEPTION 'product engineering payroll entry is append-only';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "PayrollEntry_product_settlement_append_only" BEFORE UPDATE OR DELETE ON "PayrollEntry"
  FOR EACH ROW EXECUTE FUNCTION "protect_settled_product_payroll_entry"();

-- Legacy coverage only: retain actual PERCENT_PROJECT entry IDs; never infer old rates or amounts.
INSERT INTO "ProductStagePayPool" (
  "id", "productId", "kind", "state", "legacyProjectId",
  "legacyPayrollEntryIds", "legacyProtectedAt", "createdAt", "updatedAt"
)
SELECT
  'legacy-engineering:' || product."id",
  product."id",
  'ENGINEERING',
  'LEGACY_PROTECTED',
  project."id",
  array_agg(payroll."id" ORDER BY payroll."id"),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Product" AS product
JOIN "Project" AS project ON project."id" = product."projectId"
JOIN "PayrollEntry" AS payroll ON payroll."projectId" = project."id" AND payroll."scheme" = 'PERCENT_PROJECT'
GROUP BY product."id", project."id"
ON CONFLICT ("productId", "kind") DO NOTHING;

COMMIT;
