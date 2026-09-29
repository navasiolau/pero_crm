import assert from "node:assert/strict";
import { test } from "node:test";
import { assertCashMigrationData, cashMigrationProjection } from "./cash-local-migrate.mjs";

test("cash migration preserves every original table, row count and raw-value digest", () => {
  const before = { Payout: { count: "3", hash: "original-money" }, User: { count: "18", hash: "original-users" } };
  assert.doesNotThrow(() => assertCashMigrationData(before, structuredClone(before)));
  for (const after of [{ ...before, Payout: { count: "3", hash: "changed-money" } },
    { ...before, User: { count: "19", hash: "original-users" } }, { Payout: before.Payout },
    { ...before, Unexpected: { count: "0", hash: "empty" } }]) {
    assert.throws(() => assertCashMigrationData(before, after), /LEGACY_DATA_CHANGED/);
  }
});

test("cash migration projection excludes only the nine newly added nullable fields", () => {
  const projection = cashMigrationProjection("Payout");
  assert.match(projection, /'cashAccountId'/);
  assert.match(projection, /'payrollCurrency'/);
  assert.doesNotMatch(projection, /'amount'|'month'|'kind'|'userId'/);
  for (const table of ["PayrollEntry", "Payment", "CashAccount", "User"]) {
    assert.equal(cashMigrationProjection(table), "to_jsonb(t)");
  }
});
