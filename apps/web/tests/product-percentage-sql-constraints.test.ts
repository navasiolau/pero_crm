import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const prior = readFileSync(new URL("../prisma/migrations/20260928220000_product_engineering_pay/migration.sql", import.meta.url), "utf8");
const enums = readFileSync(new URL("../prisma/migrations/20260930145000_product_percentage_enum_values/migration.sql", import.meta.url), "utf8");
const next = readFileSync(new URL("../prisma/migrations/20260930150000_product_percentage_pay/migration.sql", import.meta.url), "utf8");
const shareCore = readFileSync(new URL("../src/server/tasks/share-core.ts", import.meta.url), "utf8");

function check(sql: string, table: string, name: string): string {
  const marker = `ALTER TABLE "${table}" ADD CONSTRAINT "${name}" CHECK (`;
  const start = sql.indexOf(marker);
  assert.ok(start >= 0, `${name} must exist`);
  const end = sql.indexOf("\n);", start);
  assert.ok(end > start, `${name} must terminate`);
  return sql.slice(start + marker.length, end).replace(/\s+/g, " ").trim();
}

test("enum values commit in a separate earlier migration", () => {
  assert.match(enums, /ALTER TYPE "WorkPaymentKind" ADD VALUE 'INSTALLATION'/);
  assert.match(enums, /ALTER TYPE "TaskAllocationBudgetSource" ADD VALUE 'PHYSICAL_ONLY'/);
  assert.doesNotMatch(enums + next, /\b(?:BEGIN|COMMIT)\s*;/i);
  assert.doesNotMatch(next, /ALTER TYPE "(?:WorkPaymentKind|TaskAllocationBudgetSource)"/);
});

test("new Work/Group/Task checks retain every old accepted branch", () => {
  for (const [table, name] of [
    ["Work", "Work_stage_payment_complete"],
    ["TaskAllocationGroup", "TaskAllocationGroup_budget_source"],
    ["Task", "Task_allocation_complete"],
  ]) {
    assert.ok(check(next, table, name).includes(check(prior, table, name)), `${name} changed an old branch`);
    assert.match(next, new RegExp(`ALTER TABLE "${table}" DROP CONSTRAINT "${name}";`));
  }
});

test("INSTALLATION and PHYSICAL_ONLY SQL admit exactly the new service shape", () => {
  const work = check(next, "Work", "Work_stage_payment_complete");
  assert.match(work, /"paymentKind" = 'INSTALLATION' AND "productId" IS NOT NULL/);
  assert.match(work, /"stagePayPoolId" IS NULL AND "poolWeightUnits" IS NULL/);
  const group = check(next, "TaskAllocationGroup", "TaskAllocationGroup_budget_source");
  assert.match(group, /"budgetSource" = 'PHYSICAL_ONLY' AND "workId" IS NOT NULL/);
  assert.match(group, /"quantity" IS NOT NULL AND "quantity" > 0 AND "budget" IS NULL AND "currency" IS NULL/);
  const task = check(next, "Task", "Task_allocation_complete");
  assert.match(task, /"physicalOnlyShare" AND "allocationGroupId" IS NOT NULL/);
  assert.match(task, /"shareAmount" IS NULL AND "stageShareUnits" IS NULL/);
  assert.match(next, /CREATE TRIGGER "TaskAllocationGroup_physical_source"/);
  assert.match(next, /CREATE TRIGGER "Task_physical_source"/);
  assert.match(next, /source_group_work_id IS DISTINCT FROM NEW\."workId"/);
  assert.match(next, /source_project_id IS DISTINCT FROM NEW\."projectId"/);
  assert.match(next, /source_product_id IS DISTINCT FROM NEW\."productId"/);
});

test("retired split retains historical receipt reads without allocation writers", () => {
  // Runtime denial and exact historical receipt replay are covered by
  // task-share-retirement.test.ts and product-engineering-split.test.ts.
  assert.match(shareCore, /Деление задач и передача долей больше недоступны/);
  assert.match(shareCore, /tx\.changeLog\.findUnique\(/);
  assert.doesNotMatch(shareCore, /tx\.(?:task|taskAllocationGroup|work|changeLog)\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\(/);
});

test("forward migration does not remove old tables, columns, or rows", () => {
  assert.doesNotMatch(enums + next, /\b(?:DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM|UPDATE "(?:PayrollEntry|Payout|Work|Task)")\b/i);
  assert.match(next, /ProductStagePayPool/);
  assert.match(next, /LEGACY_PROTECTED/);
});
