import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { allocatedWorkQuantity, personalQuantity, sharePercent, splitAllocation, taskPieceAmount, type TaskAllocationValues } from "../src/lib/work-shares";

const part = (shareUnits: number, shareAmount: string, quantity = "10"): TaskAllocationValues => ({
  quantity, executorShare: "1", allocationGroupId: "group", shareUnits, shareAmount,
});

test("legacy task amounts retain the previous formula before any split", () => {
  assert.equal(taskPieceAmount({ quantity: "10", executorShare: "0.5" }, "100"), "500.00");
  assert.equal(allocatedWorkQuantity([{ quantity: "3" }, { quantity: "7" }]), "10.00");
});

test("30/70 portions consume ten work units only once", () => {
  assert.equal(allocatedWorkQuantity([part(300_000, "300.00"), part(700_000, "700.00")]), "10.00");
});

test("30/70 uses the allocated 300/700 budget without reapplying a percentage", () => {
  assert.equal(taskPieceAmount(part(300_000, "300.00"), "100"), "300.00");
  assert.equal(taskPieceAmount(part(700_000, "700.00"), "100"), "700.00");
});

test("repeated split keeps 35/35/30 portions inside the original thousand", () => {
  const tasks = [part(350_000, "350.00"), part(350_000, "350.00"), part(300_000, "300.00")];
  assert.equal(tasks.reduce((sum, task) => sum + Number(taskPieceAmount(task, "100")), 0), 1000);
  assert.equal(allocatedWorkQuantity(tasks), "10.00");
});

test("the residual cent is not rounded into a second cent", () => {
  const tasks = [part(500_000, "0.01", "1"), part(500_000, "0.00", "1")];
  assert.deepEqual(tasks.map((task) => taskPieceAmount(task, "0.01")), ["0.01", "0.00"]);
});

test("a task without Work has no allocated quantity or generated budget", () => {
  assert.equal(allocatedWorkQuantity([{ quantity: null, allocationGroupId: "unpaid" }, { quantity: null, allocationGroupId: "unpaid" }]), "0.00");
  assert.equal(taskPieceAmount({ quantity: null, executorShare: "1", shareAmount: "0.00", allocationGroupId: "unpaid" }, "0"), "0.00");
});

test("split calculation preserves units and cents across repeated 30 and 50 percent transfers", () => {
  const first = splitAllocation(1_000_000, "1000.00", "30");
  assert.deepEqual(first, { remainingUnits: 700_000, transferredUnits: 300_000, remainingAmount: "700.00", transferredAmount: "300.00", percent: "30.00" });
  const second = splitAllocation(first.remainingUnits, first.remainingAmount, "50");
  assert.deepEqual(second, { remainingUnits: 350_000, transferredUnits: 350_000, remainingAmount: "350.00", transferredAmount: "350.00", percent: "50.00" });
  assert.equal(second.remainingUnits + second.transferredUnits + first.transferredUnits, 1_000_000);
  assert.equal(personalQuantity(part(second.remainingUnits, second.remainingAmount)), "3.5");
  assert.equal(sharePercent(second.remainingUnits), "35");
});

test("residual cent stays with original task and zero budget stays zero", () => {
  assert.deepEqual(splitAllocation(1_000_000, "10.01", 50), { remainingUnits: 500_000, transferredUnits: 500_000, remainingAmount: "5.01", transferredAmount: "5.00", percent: "50.00" });
  assert.equal(splitAllocation(1_000_000, "0.01", 50).transferredAmount, "0.00");
  assert.equal(splitAllocation(1_000_000, "0", "33.33").remainingAmount, "0.00");
  assert.equal(personalQuantity(part(500_000, "0.00", "0.01")), "0.005");
});

test("invalid, excessive and unrepresentable shares are rejected", () => {
  for (const percent of [0, 100, -1, "NaN", "12.345", "1e2"]) assert.throws(() => splitAllocation(1_000_000, "100", percent));
  assert.throws(() => splitAllocation(1, "0.01", 50), /слишком мала/);
  assert.throws(() => taskPieceAmount({ quantity: "1", executorShare: "1", allocationGroupId: "group", shareAmount: null }, "100"), /снимок/);
});

test("additive migration explicitly rejects NULL shares instead of accepting SQL UNKNOWN", () => {
  const sql = readFileSync(new URL("../prisma/migrations/20260928140000_universal_work_shares/migration.sql", import.meta.url), "utf8");
  assert.match(sql, /"allocationGroupId" IS NOT NULL AND "shareUnits" IS NOT NULL AND "shareAmount" IS NOT NULL/);
  assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE FROM|TRUNCATE|DROP)\s+"?(?:Task|PayrollEntry|Payout)/i);
});
