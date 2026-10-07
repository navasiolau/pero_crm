import assert from "node:assert/strict";
import test from "node:test";
import { percentageCompletionKinds, decideProductPercentageStatus } from "../src/lib/product-percentage-status";
import { entrySchemeLabels } from "../src/lib/labels";

test("STORAGE closes engineering and assembly in order on a direct manager jump", () => {
  assert.deepEqual(percentageCompletionKinds("DESIGN", "STORAGE", true), ["ENGINEERING", "ASSEMBLY"]);
  assert.deepEqual(percentageCompletionKinds("DESIGN", "DONE", true), ["ENGINEERING", "ASSEMBLY", "INSTALLATION"]);
});
test("assembly completion is reached at delivery and later manager transitions, never production", () => {
  assert.deepEqual(percentageCompletionKinds("PRODUCTION", "STORAGE", true), ["ENGINEERING", "ASSEMBLY"]);
  assert.deepEqual(percentageCompletionKinds("STORAGE", "INSTALLATION", true), ["ENGINEERING", "ASSEMBLY"]);
  assert.deepEqual(percentageCompletionKinds("RECLAMATION", "DONE", true), ["ENGINEERING", "ASSEMBLY", "INSTALLATION"]);
  assert.deepEqual(percentageCompletionKinds("DESIGN", "PRODUCTION", true), ["ENGINEERING"]);
  assert.deepEqual(percentageCompletionKinds("DONE", "PRODUCTION", true), ["ENGINEERING"]);
});
test("assigned worker read rights do not confer product status write rights", () => {
  assert.equal(decideProductPercentageStatus(["WORKER"], {from:"PRODUCTION",to:"STORAGE",assignedEngineer:false,participant:false,hasB3d:false,noModel:false}).allowed, false);
  assert.deepEqual(percentageCompletionKinds("PRODUCTION", "STORAGE", false), []);
});
test("assembly payroll has its own readable label", () => {
  assert.equal(entrySchemeLabels.PRODUCT_PERCENT_ASSEMBLY, "Процентные отчисления сборщика");
});
test("manager late transition closes every reached missing threshold", () => {
  assert.deepEqual(percentageCompletionKinds("INSTALLATION", "DONE", true), ["ENGINEERING", "ASSEMBLY", "INSTALLATION"]);
});
