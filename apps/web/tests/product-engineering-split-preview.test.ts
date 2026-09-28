import assert from "node:assert/strict";
import { test } from "node:test";
import { previewStageSplit } from "../src/lib/product-stage-split-preview";
const at = "2026-09-01T00:00:00.000Z";

test("50 percent of a 300 BYN engineering work shows 150/150 and independent physical/pay shares", () => {
  const result = previewStageSplit("a", 1_000_000, 1_000_000, "50", { workAmount: "300.00", currency: "BYN", tasks: [{ id: "a", stageShareUnits: 1_000_000, createdAt: at }] });
  assert.equal(result.remainingAmount, "150.00"); assert.equal(result.transferredAmount, "150.00");
  assert.equal(result.remainingUnits, 500_000); assert.equal(result.transferredStageUnits, 500_000);
});
test("two-cent preview recomputes the whole work instead of dividing the old rounded cent", () => {
  const result = previewStageSplit("a", 1_000_000, 333_300, "50", { workAmount: "0.02", currency: "BYN", tasks: [
    { id: "a", stageShareUnits: 333_300, createdAt: at }, { id: "b", stageShareUnits: 333_300, createdAt: at }, { id: "c", stageShareUnits: 333_400, createdAt: at },
  ] });
  assert.equal(result.remainingAmount, "0.00"); assert.equal(result.transferredAmount, "0.00");
  assert.equal(result.remainingStageUnits, 166_650);
});
test("absent FX does not prevent splitting units or pretend money is zero", () => {
  const result = previewStageSplit("a", 1_000_000, 800_000, "50", null);
  assert.equal(result.remainingUnits, 500_000); assert.equal(result.remainingStageUnits, 400_000);
  assert.equal(result.remainingAmount, null); assert.equal(result.transferredAmount, null);
});
test("zero financial share remains zero while physical work can be divided", () => {
  const result = previewStageSplit("a", 1_000_000, 0, "50", { workAmount: "100", currency: "BYN", tasks: [
    { id: "a", stageShareUnits: 0, createdAt: at }, { id: "b", stageShareUnits: 1_000_000, createdAt: at },
  ] });
  assert.equal(result.transferredStageUnits, 0); assert.equal(result.transferredUnits, 500_000); assert.equal(result.transferredAmount, "0.00");
});
test("stale stage-vector and a positive share too small to transfer are rejected", () => {
  assert.throws(() => previewStageSplit("a", 1_000_000, 500_000, "50", { workAmount: "10", currency: "BYN", tasks: [{ id: "a", stageShareUnits: 1_000_000, createdAt: at }] }), /измен|дол/i);
  assert.throws(() => previewStageSplit("a", 1_000_000, 1, "50", null), /мал/i);
});
