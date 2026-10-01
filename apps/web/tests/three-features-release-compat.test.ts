import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("project IN_WORK retains the legacy, once-per-project engineer percentage writer", () => {
  const core = source("../src/server/projects/core.ts");
  assert.match(core, /if \(toStage === "IN_WORK"\)/);
  assert.match(core, /where: \{ projectId, scheme: "PERCENT_PROJECT" \}/);
  assert.match(core, /product\.findMany\([\s\S]*engineerId: \{ not: null \}/);
  assert.match(core, /payScheme !== "PERCENT_PROJECT"/);
  assert.match(core, /prisma\.payrollEntry\.create\(/);
});

test("cash payroll currency lock covers cash-linked payouts without importing the later fund system", () => {
  const actions = source("../src/server/payroll/actions.ts");
  assert.match(actions, /cashAccountId: \{ not: null \}/);
  assert.doesNotMatch(actions, /product-stage-pay|product-percentage-pay/);
});

test("cash schema migration leaves historical payout snapshots nullable", () => {
  const sql = source("../prisma/migrations/20260929120000_manager_cash_advances/migration.sql");
  assert.match(sql, /ADD COLUMN "cashAccountId" TEXT/);
  assert.match(sql, /"cashAccountId" IS NULL/);
  assert.doesNotMatch(sql, /UPDATE "Payout"/);
});
