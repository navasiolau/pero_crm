import assert from "node:assert/strict";
import { test } from "node:test";
import { assertEngineeringMigrationData, engineeringMigrationProjection } from "./engineering-local-migrate.mjs";

test("engineering migration preserves all previous columns and every legacy row", () => {
  const before = { Work: { count: "2", hash: "old-work" }, Task: { count: "3", hash: "old-task" } };
  const after = { ...before, ProductStagePayPool: { count: "0", hash: "" }, WorkPaymentConversion: { count: "0", hash: "" }, ProductStageSettlement: { count: "0", hash: "" }, ProductStageSettlementShare: { count: "0", hash: "" } };
  assertEngineeringMigrationData(before, after);
  assert.throws(() => assertEngineeringMigrationData(before, { ...after, Work: { count: "2", hash: "changed" } }), /LEGACY_DATA/);
  assert.throws(() => assertEngineeringMigrationData(before, { ...after, ProductStagePayPool: { count: "1", hash: "new" } }), /NEW_TABLE/);
  assert.throws(() => assertEngineeringMigrationData(before, { ...after, Unexpected: { count: "0", hash: "" } }), /LEGACY_DATA/);
});

test("projection removes only this migration's additions, preserving feature5 shares and money", () => {
  assert.equal(engineeringMigrationProjection("Task"), "to_jsonb(t) - ARRAY['stageShareUnits']");
  assert.match(engineeringMigrationProjection("Work"), /paymentKind.*stagePayPoolId.*poolWeightUnits/);
  assert.doesNotMatch(engineeringMigrationProjection("Work"), /priceSnapshot|total|quantity/);
  assert.equal(engineeringMigrationProjection("ApiToken"), "to_jsonb(t)");
  assert.equal(engineeringMigrationProjection("File"), "to_jsonb(t)");
});
