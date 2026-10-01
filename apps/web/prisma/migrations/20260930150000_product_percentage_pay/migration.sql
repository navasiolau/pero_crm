-- CreateEnum
CREATE TYPE "ProductPercentageKind" AS ENUM ('ENGINEERING', 'INSTALLATION');

-- CreateEnum
CREATE TYPE "ProductPercentageCompletionState" AS ENUM ('SKIPPED_ONCE', 'PENDING_FX', 'SETTLED', 'LEGACY_PROTECTED');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "noModel" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PayrollEntry" ADD COLUMN     "percentageCompletionShareId" TEXT;

-- Existing checks from 20260928220000 reject both new enum modes until
-- expanded here. The old ENGINEERING/LEGACY and TASK_FIXED/STAGE_PREVIEW
-- branches retain their original acceptance conditions.
ALTER TABLE "Task" ADD COLUMN "physicalOnlyShare" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Work" DROP CONSTRAINT "Work_stage_payment_complete";
ALTER TABLE "Work" ADD CONSTRAINT "Work_stage_payment_complete" CHECK (
  ("paymentKind" = 'ENGINEERING' AND "productId" IS NOT NULL
    AND "stagePayPoolId" IS NOT NULL AND "poolWeightUnits" IS NOT NULL)
  OR ("paymentKind" = 'LEGACY' AND "stagePayPoolId" IS NULL
    AND "poolWeightUnits" IS NULL AND "priceSnapshot" IS NOT NULL AND "total" IS NOT NULL)
  OR ("paymentKind" = 'INSTALLATION' AND "productId" IS NOT NULL
    AND "stagePayPoolId" IS NULL AND "poolWeightUnits" IS NULL
    AND "priceSnapshot" IS NOT NULL AND "total" IS NOT NULL)
);

ALTER TABLE "TaskAllocationGroup" DROP CONSTRAINT "TaskAllocationGroup_budget_source";
ALTER TABLE "TaskAllocationGroup" ADD CONSTRAINT "TaskAllocationGroup_budget_source" CHECK (
  ("budgetSource" = 'TASK_FIXED' AND "budget" IS NOT NULL AND "budget" >= 0)
  OR ("budgetSource" = 'STAGE_PREVIEW' AND "workId" IS NOT NULL
    AND "quantity" IS NOT NULL AND "quantity" > 0 AND "budget" IS NULL AND "currency" IS NULL)
  OR ("budgetSource" = 'PHYSICAL_ONLY' AND "workId" IS NOT NULL
    AND "quantity" IS NOT NULL AND "quantity" > 0 AND "budget" IS NULL AND "currency" IS NULL)
);

ALTER TABLE "Task" DROP CONSTRAINT "Task_allocation_complete";
ALTER TABLE "Task" ADD CONSTRAINT "Task_allocation_complete" CHECK (
  ("allocationGroupId" IS NULL AND "shareUnits" IS NULL AND "shareAmount" IS NULL)
  OR ("allocationGroupId" IS NOT NULL AND "shareUnits" IS NOT NULL
    AND "shareUnits" BETWEEN 1 AND 1000000
    AND (("shareAmount" IS NOT NULL AND "shareAmount" >= 0)
      OR ("shareAmount" IS NULL AND "stageShareUnits" IS NOT NULL)))
  OR ("physicalOnlyShare" AND "allocationGroupId" IS NOT NULL
    AND "shareUnits" BETWEEN 1 AND 1000000
    AND "shareAmount" IS NULL AND "stageShareUnits" IS NULL)
);
ALTER TABLE "Task" ADD CONSTRAINT "Task_physical_only_complete" CHECK (
  NOT "physicalOnlyShare" OR ("allocationGroupId" IS NOT NULL
    AND "shareUnits" BETWEEN 1 AND 1000000
    AND "shareAmount" IS NULL AND "stageShareUnits" IS NULL)
);

CREATE OR REPLACE FUNCTION "validate_physical_only_group"() RETURNS trigger AS $$
DECLARE
  source_kind "WorkPaymentKind";
  source_product_id TEXT;
BEGIN
  IF NEW."budgetSource" = 'PHYSICAL_ONLY' THEN
    SELECT "paymentKind", "productId" INTO source_kind, source_product_id FROM "Work" WHERE "id" = NEW."workId";
    IF source_kind IS DISTINCT FROM 'INSTALLATION' OR source_product_id IS NULL THEN
      RAISE EXCEPTION 'physical-only group requires installation work on a product';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "TaskAllocationGroup_physical_source" BEFORE INSERT OR UPDATE ON "TaskAllocationGroup"
  FOR EACH ROW EXECUTE FUNCTION "validate_physical_only_group"();

CREATE OR REPLACE FUNCTION "validate_physical_only_task"() RETURNS trigger AS $$
DECLARE
  source_group_work_id TEXT;
  source_group_kind "TaskAllocationBudgetSource";
  source_project_id TEXT;
  source_product_id TEXT;
  source_work_kind "WorkPaymentKind";
BEGIN
  IF NEW."physicalOnlyShare" THEN
    SELECT "workId", "budgetSource" INTO source_group_work_id, source_group_kind
      FROM "TaskAllocationGroup" WHERE "id" = NEW."allocationGroupId";
    SELECT "projectId", "productId", "paymentKind" INTO source_project_id, source_product_id, source_work_kind
      FROM "Work" WHERE "id" = NEW."workId";
    IF source_group_kind IS DISTINCT FROM 'PHYSICAL_ONLY'
      OR source_group_work_id IS DISTINCT FROM NEW."workId"
      OR source_project_id IS DISTINCT FROM NEW."projectId"
      OR source_product_id IS NULL OR source_product_id IS DISTINCT FROM NEW."productId"
      OR source_work_kind IS DISTINCT FROM 'INSTALLATION' THEN
      RAISE EXCEPTION 'physical-only task must match installation work and product';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "Task_physical_source" BEFORE INSERT OR UPDATE ON "Task"
  FOR EACH ROW EXECUTE FUNCTION "validate_physical_only_task"();

-- CreateTable
CREATE TABLE "ProductPercentageConfig" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "kind" "ProductPercentageKind" NOT NULL,
    "ratePercent" DECIMAL(5,2),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "reviewedLegacyWorkIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductPercentageConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductPercentageParticipant" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "shareUnits" INTEGER NOT NULL,

    CONSTRAINT "ProductPercentageParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductPercentageCompletion" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "kind" "ProductPercentageKind" NOT NULL,
    "state" "ProductPercentageCompletionState" NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedById" TEXT,
    "statusAtCompletion" "ProductStatus" NOT NULL,
    "reason" TEXT,
    "priceSnapshot" DECIMAL(12,2),
    "ratePercentSnapshot" DECIMAL(5,2),
    "productCurrency" TEXT NOT NULL,
    "payrollCurrency" TEXT,
    "configRevision" INTEGER,
    "productRateByn" DECIMAL(18,6),
    "payrollRateByn" DECIMAL(18,6),
    "productRateDate" DATE,
    "payrollRateDate" DATE,
    "sourceFundExact" DECIMAL(18,6),
    "amount" DECIMAL(12,2),
    "bynAmount" DECIMAL(18,2),
    "projectAmount" DECIMAL(12,2),
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "ProductPercentageCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductPercentageCompletionShare" (
    "id" TEXT NOT NULL,
    "completionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userNameSnapshot" TEXT NOT NULL,
    "shareUnits" INTEGER NOT NULL,
    "amount" DECIMAL(12,2),
    "bynAmount" DECIMAL(18,2),
    "projectAmount" DECIMAL(12,2),

    CONSTRAINT "ProductPercentageCompletionShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductPercentageConfig_productId_kind_key" ON "ProductPercentageConfig"("productId", "kind");

-- CreateIndex
CREATE INDEX "ProductPercentageParticipant_userId_idx" ON "ProductPercentageParticipant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductPercentageParticipant_configId_userId_key" ON "ProductPercentageParticipant"("configId", "userId");

-- CreateIndex
CREATE INDEX "ProductPercentageCompletion_state_idx" ON "ProductPercentageCompletion"("state");

-- CreateIndex
CREATE UNIQUE INDEX "ProductPercentageCompletion_productId_kind_key" ON "ProductPercentageCompletion"("productId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ProductPercentageCompletionShare_completionId_userId_key" ON "ProductPercentageCompletionShare"("completionId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollEntry_percentageCompletionShareId_key" ON "PayrollEntry"("percentageCompletionShareId");

-- AddForeignKey
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_percentageCompletionShareId_fkey" FOREIGN KEY ("percentageCompletionShareId") REFERENCES "ProductPercentageCompletionShare"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPercentageConfig" ADD CONSTRAINT "ProductPercentageConfig_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPercentageParticipant" ADD CONSTRAINT "ProductPercentageParticipant_configId_fkey" FOREIGN KEY ("configId") REFERENCES "ProductPercentageConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPercentageParticipant" ADD CONSTRAINT "ProductPercentageParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPercentageCompletion" ADD CONSTRAINT "ProductPercentageCompletion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPercentageCompletionShare" ADD CONSTRAINT "ProductPercentageCompletionShare_completionId_fkey" FOREIGN KEY ("completionId") REFERENCES "ProductPercentageCompletion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPercentageCompletionShare" ADD CONSTRAINT "ProductPercentageCompletionShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Ограничения для прямой конфигурации: сумма долей проверяется в одной серверной транзакции.
ALTER TABLE "ProductPercentageConfig" ADD CONSTRAINT "ProductPercentageConfig_rate_range"
  CHECK ("ratePercent" IS NULL OR ("ratePercent" >= 0 AND "ratePercent" <= 100));
ALTER TABLE "ProductPercentageParticipant" ADD CONSTRAINT "ProductPercentageParticipant_share_range"
  CHECK ("shareUnits" > 0 AND "shareUnits" <= 1000000);
ALTER TABLE "ProductPercentageCompletionShare" ADD CONSTRAINT "ProductPercentageCompletionShare_share_range"
  CHECK ("shareUnits" > 0 AND "shareUnits" <= 1000000);
ALTER TABLE "ProductPercentageCompletion" ADD CONSTRAINT "ProductPercentageCompletion_rate_range"
  CHECK ("ratePercentSnapshot" IS NULL OR ("ratePercentSnapshot" >= 0 AND "ratePercentSnapshot" <= 100));

-- Снимки закрыты для переписывания. При FX retry разрешено только заполнение
-- выходных сумм/курсов на переходе PENDING_FX → SETTLED.
CREATE OR REPLACE FUNCTION "protect_product_percentage_completion"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'product percentage completion is append-only'; END IF;
  IF OLD."state" <> 'PENDING_FX' OR NEW."state" <> 'SETTLED'
    OR OLD."amount" IS NOT NULL OR OLD."bynAmount" IS NOT NULL OR OLD."projectAmount" IS NOT NULL
    OR NEW."amount" IS NULL OR NEW."bynAmount" IS NULL OR NEW."projectAmount" IS NULL
    OR NEW."productRateByn" IS NULL OR NEW."payrollRateByn" IS NULL
    OR NEW."productRateDate" IS NULL OR NEW."payrollRateDate" IS NULL OR NEW."settledAt" IS NULL
    OR ROW(NEW."id",NEW."productId",NEW."kind",NEW."completedAt",NEW."completedById",NEW."statusAtCompletion",
      NEW."reason",NEW."priceSnapshot",NEW."ratePercentSnapshot",NEW."productCurrency",NEW."payrollCurrency",NEW."configRevision")
       IS DISTINCT FROM
       ROW(OLD."id",OLD."productId",OLD."kind",OLD."completedAt",OLD."completedById",OLD."statusAtCompletion",
      OLD."reason",OLD."priceSnapshot",OLD."ratePercentSnapshot",OLD."productCurrency",OLD."payrollCurrency",OLD."configRevision")
  THEN RAISE EXCEPTION 'product percentage completion inputs are immutable'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ProductPercentageCompletion_frozen" BEFORE UPDATE OR DELETE ON "ProductPercentageCompletion"
  FOR EACH ROW EXECUTE FUNCTION "protect_product_percentage_completion"();

CREATE OR REPLACE FUNCTION "protect_product_percentage_share"() RETURNS trigger AS $$
DECLARE current_state "ProductPercentageCompletionState";
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'product percentage share is append-only'; END IF;
  SELECT "state" INTO current_state FROM "ProductPercentageCompletion" WHERE "id" = OLD."completionId";
  IF current_state <> 'PENDING_FX' OR OLD."amount" IS NOT NULL OR OLD."bynAmount" IS NOT NULL OR OLD."projectAmount" IS NOT NULL
    OR NEW."amount" IS NULL OR NEW."bynAmount" IS NULL OR NEW."projectAmount" IS NULL
    OR ROW(NEW."id",NEW."completionId",NEW."userId",NEW."userNameSnapshot",NEW."shareUnits")
       IS DISTINCT FROM ROW(OLD."id",OLD."completionId",OLD."userId",OLD."userNameSnapshot",OLD."shareUnits")
  THEN RAISE EXCEPTION 'product percentage share inputs are immutable'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ProductPercentageCompletionShare_frozen" BEFORE UPDATE OR DELETE ON "ProductPercentageCompletionShare"
  FOR EACH ROW EXECUTE FUNCTION "protect_product_percentage_share"();

CREATE OR REPLACE FUNCTION "protect_settled_product_payroll_entry"() RETURNS trigger AS $$
BEGIN
  IF OLD."settlementShareId" IS NOT NULL OR OLD."percentageCompletionShareId" IS NOT NULL THEN
    RAISE EXCEPTION 'product percentage payroll entry is append-only';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_percentage_fields" CHECK (
  "percentageCompletionShareId" IS NULL OR
  ("settlementShareId" IS NULL AND "scheme" IN ('PRODUCT_PERCENT_ENGINEERING','PRODUCT_PERCENT_INSTALLATION')
    AND "productId" IS NOT NULL AND "projectId" IS NOT NULL
    AND "currency" IN ('BYN','RUB','USD','EUR') AND "projectCurrency" IN ('BYN','RUB','USD','EUR')
    AND "amount" IS NOT NULL AND "amount" > 0 AND "amount" <> 'NaN'
    AND "bynAmount" IS NOT NULL AND "bynAmount" >= 0 AND "bynAmount" <> 'NaN'
    AND "projectAmount" IS NOT NULL AND "projectAmount" >= 0 AND "projectAmount" <> 'NaN')
);

-- До внедрения прямых долей уже пройденные этапы и оплаченные старые пулы
-- получают только защитные маркеры. Старые деньги и распределения не изменяются.
INSERT INTO "ProductPercentageCompletion"
  ("id", "productId", "kind", "state", "statusAtCompletion", "reason", "priceSnapshot", "productCurrency")
SELECT 'legacy-engineering:' || p."id", p."id", 'ENGINEERING', 'LEGACY_PROTECTED', p."status",
  'Этап пройден до прямых долей или уже оплачен прежним способом', p."expectedPrice", pr."currency"
FROM "Product" p JOIN "Project" pr ON pr."id" = p."projectId"
WHERE p."status" IN ('PRODUCTION', 'DELIVERY', 'INSTALLATION', 'DONE')
   OR EXISTS (SELECT 1 FROM "ProductStatusHistory" h WHERE h."productId" = p."id" AND h."toStatus" IN ('PRODUCTION', 'DELIVERY', 'INSTALLATION', 'DONE'))
   OR EXISTS (SELECT 1 FROM "ProductStagePayPool" pool WHERE pool."productId" = p."id" AND pool."kind" = 'ENGINEERING' AND pool."state" IN ('SETTLED', 'LEGACY_PROTECTED'))
   OR EXISTS (SELECT 1 FROM "PayrollEntry" pay WHERE pay."projectId" = p."projectId" AND pay."scheme" = 'PERCENT_PROJECT');

INSERT INTO "ProductPercentageCompletion"
  ("id", "productId", "kind", "state", "statusAtCompletion", "reason", "priceSnapshot", "productCurrency")
SELECT 'legacy-installation:' || p."id", p."id", 'INSTALLATION', 'LEGACY_PROTECTED', p."status",
  'Готовность изделия была зафиксирована до прямых долей', p."expectedPrice", pr."currency"
FROM "Product" p JOIN "Project" pr ON pr."id" = p."projectId"
WHERE p."status" = 'DONE'
   OR EXISTS (SELECT 1 FROM "ProductStatusHistory" h WHERE h."productId" = p."id" AND h."toStatus" = 'DONE');
