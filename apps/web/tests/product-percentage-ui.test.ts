import assert from "node:assert/strict";
import test from "node:test";
import { previewProductPercentageShare, productStatusTargets, shouldRollbackProductStatus } from "../src/lib/product-percentage-ui";

test("product status UI gives managers all statuses and engineers assigned DESIGN to PRODUCTION without model", () => {
  const context = { from: "DESIGN" as const, assignedEngineer: true, participant: false, hasB3d: false, noModel: false };
  assert.deepEqual(productStatusTargets(["MANAGER", "ENGINEER"] as const, context), ["PREPARATION", "DESIGN", "PRODUCTION", "STORAGE", "INSTALLATION", "DONE"]);
  assert.deepEqual(productStatusTargets(["ENGINEER"] as const, context), ["PRODUCTION"]);
  assert.deepEqual(productStatusTargets(["ENGINEER"] as const, { ...context, hasB3d: true }), ["PRODUCTION"]);
  assert.deepEqual(productStatusTargets(["WORKER"] as const, { ...context, hasB3d: true }), []);
});

test("persisted status with pending finance is successful and must not roll back", () => {
  assert.equal(shouldRollbackProductStatus({ ok: true, result: { financeState: "PENDING_FX" } }), false);
  assert.equal(shouldRollbackProductStatus({ ok: false, error: "rejected" }), true);
});

test("percentage panel previews each person's direct share in product currency", () => {
  assert.equal(previewProductPercentageShare("10000.00", "5", 700_000), "350.00");
  assert.equal(previewProductPercentageShare("10000.00", "5", 300_000), "150.00");
  assert.equal(previewProductPercentageShare("0.00", "5", 1_000_000), "0.00");
  assert.equal(previewProductPercentageShare(null, "5", 1_000_000), null);
  assert.equal(previewProductPercentageShare("10000.00", null, 1_000_000), null);
});
