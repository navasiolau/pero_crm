import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = join(import.meta.dirname, "..");
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8");
const migrationPath = join(root, "prisma/migrations/20260928220000_product_engineering_pay/migration.sql");

function block(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing ${end}`);
  return source.slice(from, to);
}

test("schema exposes the four additive product engineering payment enums and tables", () => {
  for (const enumName of ["ProductPayStage", "ProductStagePayState", "WorkPaymentKind", "TaskAllocationBudgetSource"]) {
    assert.match(schema, new RegExp(`enum ${enumName}\\s*\\{`));
  }
  for (const modelName of ["ProductStagePayPool", "WorkPaymentConversion", "ProductStageSettlement", "ProductStageSettlementShare"]) {
    assert.match(schema, new RegExp(`model ${modelName}\\s*\\{`));
  }
});

test("allocation completion check explicitly handles nullable legacy and preview branches", () => {
  const sql = readFileSync(migrationPath, "utf8");
  const check = sql.match(/ADD CONSTRAINT "Task_allocation_complete" CHECK \(([\s\S]*?)\);/);
  assert.ok(check, "migration must replace Task_allocation_complete");
  assert.match(check[1], /"allocationGroupId" IS NULL/);
  assert.match(check[1], /"allocationGroupId" IS NOT NULL/);
  assert.match(check[1], /"shareUnits" IS NULL/);
  assert.match(check[1], /"shareAmount" IS NULL/);
  assert.match(check[1], /"shareAmount" IS NOT NULL/);
  assert.match(check[1], /"stageShareUnits" IS NOT NULL/);
  assert.doesNotMatch(check[1], /\bUNKNOWN\b/i);
});

test("migration is a single transaction with only legacy coverage inserts", () => {
  const sql = readFileSync(migrationPath, "utf8");
  assert.match(sql.trim(), /^--[\s\S]*?\nBEGIN;[\s\S]*COMMIT;$/);
  assert.equal((sql.match(/\bINSERT\s+INTO\b/gi) ?? []).length, 1, "only the legacy coverage backfill may insert");
  assert.doesNotMatch(sql, /^\s*(?:UPDATE|DELETE|TRUNCATE)\b|\bCONCURRENTLY\b/im);
  assert.match(sql, /cardinality\("legacyPayrollEntryIds"\)\s*>\s*0/i);
  assert.match(sql, /array_position\("legacyPayrollEntryIds",\s*NULL\)\s+IS\s+NULL/i);
  assert.match(sql, /CREATE UNIQUE INDEX "PayrollEntry_settlementShareId_key"/);
});

test("legacy quantity and money columns stay untouched", () => {
  const sql = readFileSync(migrationPath, "utf8");
  assert.doesNotMatch(sql, /ALTER\s+COLUMN\s+"(?:quantity|shareUnits|shareAmount|allocationGroupId|executorShare)"/i);
  const task = block(schema, "model Task {", "model TaskAllocationGroup {");
  assert.match(task, /quantity\s+Decimal\?/);
  assert.match(task, /shareUnits\s+Int\?/);
  assert.match(task, /shareAmount\s+Decimal\?/);
  assert.match(task, /allocationGroupId\s+String\?/);
  assert.match(task, /executorShare\s+Decimal\s+@default\(1\)/);
});

test("new field indexes are created only after their columns", () => {
  const sql = readFileSync(migrationPath, "utf8");
  for (const [column, index] of [
    ['"stagePayPoolId"', '"Work_stagePayPoolId_idx"'],
    ['"productId"', '"PayrollEntry_productId_idx"'],
    ['"settlementShareId"', '"PayrollEntry_settlementShareId_key"'],
  ]) {
    const columnAt = sql.indexOf(`ADD COLUMN ${column}`);
    const indexAt = sql.indexOf(index);
    assert.notEqual(columnAt, -1, `missing added column ${column}`);
    assert.notEqual(indexAt, -1, `missing index ${index}`);
    assert.ok(columnAt < indexAt, `${index} must follow the addition of ${column}`);
  }
  for (const [table, index] of [
    ['ProductStagePayPool', 'ProductStagePayPool_state_kind_idx'],
    ['ProductStagePayPool', 'ProductStagePayPool_productId_kind_key'],
    ['ProductStageSettlement', 'ProductStageSettlement_projectId_idx'],
    ['ProductStageSettlement', 'ProductStageSettlement_productId_idx'],
    ['ProductStageSettlementShare', 'ProductStageSettlementShare_workId_idx'],
    ['ProductStageSettlementShare', 'ProductStageSettlementShare_userId_idx'],
  ]) {
    const tableAt = sql.indexOf(`CREATE TABLE "${table}"`);
    const indexAt = sql.indexOf(index);
    assert.notEqual(tableAt, -1, `missing table ${table}`);
    assert.notEqual(indexAt, -1, `missing index ${index}`);
    assert.ok(tableAt < indexAt, `${index} must follow creation of ${table}`);
  }
});

test("settlement share guards allow zero financial share but require positive physical units", () => {
  const sql = readFileSync(migrationPath, "utf8");
  const bounds = sql.match(/CONSTRAINT "ProductStageSettlementShare_bounds" CHECK \(([\s\S]*?)\n  \)/);
  assert.ok(bounds, "settlement-share unit bounds must exist");
  assert.match(bounds[1], /"stageShareUnits" BETWEEN 0 AND 1000000/);
  assert.match(bounds[1], /"workWeightUnits" BETWEEN 0 AND 1000000/);
  assert.match(bounds[1], /"quantityShareUnitsSnapshot" BETWEEN 1 AND 1000000/);
  for (const column of ["amount", "bynAmount", "projectAmount"]) {
    assert.match(bounds[1], new RegExp(`"${column}" <> 'NaN'`));
  }
});

test("new payroll and settlement monetary checks reject negative values and NaN", () => {
  const sql = readFileSync(migrationPath, "utf8");
  const payroll = sql.match(/CONSTRAINT "PayrollEntry_settlement_fields" CHECK \(([\s\S]*?)\n\);/);
  assert.ok(payroll, "settlement-linked payroll fields must be guarded");
  for (const column of ["amount", "bynAmount", "projectAmount"]) {
    assert.match(payroll[1], new RegExp(`"${column}" IS NOT NULL`));
    assert.match(payroll[1], new RegExp(`"${column}" >= 0`));
    assert.match(payroll[1], new RegExp(`"${column}" <> 'NaN'`));
  }
  assert.match(payroll[1], /"currency" IN \('BYN','RUB','USD','EUR'\)/);
  assert.match(payroll[1], /"projectCurrency" IN \('BYN','RUB','USD','EUR'\)/);
  const settlement = sql.match(/CONSTRAINT "ProductStageSettlement_nonnegative" CHECK \(([\s\S]*?)\n  \)/);
  assert.ok(settlement);
  for (const column of ["priceSnapshot", "ratePercentSnapshot", "productRateByn", "payrollRateByn", "sourceFundExact", "amount", "bynAmount", "projectAmount"]) {
    assert.match(settlement[1], new RegExp(`"${column}" <> 'NaN'`));
  }
});
