import assert from "node:assert/strict";
import { test } from "node:test";
import { groupHistoricalByn, requirePayrollReadScope, summarizePayrollHistory, type PayrollHistoryRow } from "../src/server/payroll/summary-read-model";

test("unknown BYN short-circuits its group and unrelated future amounts are never read", () => {
  const ledger: PayrollHistoryRow[] = [
    { userId: "unknown", month: "2026-09", scheme: "PIECE", amount: "10", currency: "USD", bynAmount: null },
    { userId: "unknown", month: "2026-09", scheme: "PIECE", currency: "BYN", bynAmount: null, get amount(): string { throw Error("LATE_UNKNOWN_AMOUNT_READ"); } },
    { userId: "future", month: "2026-11", scheme: "PIECE", currency: "BYN", bynAmount: null, get amount(): string { throw Error("UNRELATED_FUTURE_AMOUNT_READ"); } },
  ];
  assert.equal(groupHistoricalByn(ledger.slice(0, 2)).get("unknown"), null);
  const model = summarizePayrollHistory(ledger, [], "2026-09", "2026-10");
  assert.equal(model.accrued.get("unknown"), null); assert.equal(model.pastAccrued.get("unknown"), null);
  assert.equal(model.accrued.has("future"), false); assert.equal(model.allPaid, 0);
});

test("request snapshot rejects selected-month and employee-scope mismatch", () => {
  const model = summarizePayrollHistory([], [], "2026-09", "2026-10", "one");
  assert.doesNotThrow(() => requirePayrollReadScope(model, "2026-09", "one"));
  assert.throws(() => requirePayrollReadScope(model, "2026-10", "one"), /другому периоду/);
  assert.throws(() => requirePayrollReadScope(model, "2026-09"), /сотруднику/);
  assert.throws(() => requirePayrollReadScope(model, "2026-09", "one", "2026-11"), /другому периоду/);
});

test("row visits stay linear as employees and history grow tenfold", () => {
  const visits: number[] = [];
  for (const size of [20, 200]) {
    let count = 0;
    const ledger: PayrollHistoryRow[] = Array.from({ length: size * 10 }, (_, index) => ({ get userId() { count++; return "employee-" + index % size; }, month: "2026-09", scheme: "PIECE", amount: "0.015", currency: "BYN", bynAmount: null }));
    const groups = groupHistoricalByn(ledger); assert.equal(groups.size, size); assert.ok([...groups.values()].every(amount => amount === 0.15));
    assert.ok(count <= ledger.length * 2); visits.push(count); count = 0;
    summarizePayrollHistory(ledger, [], "2026-09", "2026-10"); assert.ok(count <= ledger.length * 2);
  }
  assert.equal(visits[1], visits[0] * 10);
});
