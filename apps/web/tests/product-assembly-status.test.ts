import assert from "node:assert/strict";
import test from "node:test";
import { percentageCompletionKinds, decideProductPercentageStatus } from "../src/lib/product-percentage-status";
import { entrySchemeLabels } from "../src/lib/labels";

test("DELIVERY closes engineering and assembly in order on a direct manager jump", () => {
  assert.deepEqual(percentageCompletionKinds("DESIGN", "DELIVERY", true), ["ENGINEERING", "ASSEMBLY"]);
  assert.deepEqual(percentageCompletionKinds("DESIGN", "DONE", true), ["ENGINEERING", "ASSEMBLY", "INSTALLATION"]);
});
test("assembly completion is reached at delivery and later manager transitions, never production", () => {
  assert.deepEqual(percentageCompletionKinds("PRODUCTION", "DELIVERY", true), ["ENGINEERING", "ASSEMBLY"]);
  assert.deepEqual(percentageCompletionKinds("DELIVERY", "INSTALLATION", true), ["ENGINEERING", "ASSEMBLY"]);
  assert.deepEqual(percentageCompletionKinds("RECLAMATION", "DONE", true), ["ENGINEERING", "ASSEMBLY", "INSTALLATION"]);
  assert.deepEqual(percentageCompletionKinds("DESIGN", "PRODUCTION", true), ["ENGINEERING"]);
  assert.deepEqual(percentageCompletionKinds("DONE", "PRODUCTION", true), ["ENGINEERING"]);
});
test("assigned worker read rights do not confer product status write rights", () => {
  assert.equal(decideProductPercentageStatus(["WORKER"], {from:"PRODUCTION",to:"DELIVERY",assignedEngineer:false,participant:false,hasB3d:false,noModel:false}).allowed, false);
  assert.deepEqual(percentageCompletionKinds("PRODUCTION", "DELIVERY", false), []);
});
test("assembly payroll has its own readable label", () => {
  assert.equal(entrySchemeLabels.PRODUCT_PERCENT_ASSEMBLY, "Процент за сборку");
});
test("manager late transition closes every reached missing threshold", () => {
  assert.deepEqual(percentageCompletionKinds("INSTALLATION", "DONE", true), ["ENGINEERING", "ASSEMBLY", "INSTALLATION"]);
});
