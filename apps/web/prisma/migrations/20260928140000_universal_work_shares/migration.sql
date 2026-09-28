-- Additive only. Do not run until the owner approves this migration explicitly.
-- Existing Task/PayrollEntry/Payout history is not converted or recalculated.
BEGIN;

CREATE TABLE "TaskAllocationGroup" (
  "id" TEXT NOT NULL,
  "workId" TEXT,
  "quantity" DECIMAL(10,2),
  "budget" DECIMAL(12,2) NOT NULL,
  "currency" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskAllocationGroup_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TaskAllocationGroup_budget_nonnegative" CHECK ("budget" >= 0),
  CONSTRAINT "TaskAllocationGroup_quantity_positive" CHECK ("quantity" IS NULL OR "quantity" > 0)
);

ALTER TABLE "Task"
  ADD COLUMN "allocationGroupId" TEXT,
  ADD COLUMN "shareUnits" INTEGER,
  ADD COLUMN "shareAmount" DECIMAL(12,2),
  ADD COLUMN "splitRevision" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Task" ADD CONSTRAINT "Task_allocation_complete" CHECK (
  ("allocationGroupId" IS NULL AND "shareUnits" IS NULL AND "shareAmount" IS NULL)
  OR ("allocationGroupId" IS NOT NULL AND "shareUnits" IS NOT NULL AND "shareAmount" IS NOT NULL
      AND "shareUnits" BETWEEN 1 AND 1000000 AND "shareAmount" >= 0)
);
ALTER TABLE "Task" ADD CONSTRAINT "Task_splitRevision_nonnegative" CHECK ("splitRevision" >= 0);

CREATE INDEX "TaskAllocationGroup_workId_idx" ON "TaskAllocationGroup"("workId");
CREATE INDEX "Task_allocationGroupId_idx" ON "Task"("allocationGroupId");
ALTER TABLE "TaskAllocationGroup" ADD CONSTRAINT "TaskAllocationGroup_workId_fkey"
  FOREIGN KEY ("workId") REFERENCES "Work"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_allocationGroupId_fkey"
  FOREIGN KEY ("allocationGroupId") REFERENCES "TaskAllocationGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
