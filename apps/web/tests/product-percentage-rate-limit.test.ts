import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { acceptsPercentageDraft, parsePercentageInput, stepPercentageDraft } from "../src/lib/percentage-rate-input";
import { parsePercentageRate, transferOwnPercentageShare } from "../src/lib/product-percentage-pay";
import { defaultsPatchSchema, defaultsSnapshotSchema, EMPTY_DEFAULTS } from "../src/server/product-percentage-defaults/contracts";

test("product input accepts 15, NULL and zero but refuses typed/pasted values above 15", () => {
  for (const value of ["", "0", "0.05", "5.05", "14.99", "15", "15.00"]) assert.equal(acceptsPercentageDraft(value), true);
  for (const value of ["15.01", "15.1", "16", "100"]) {
    assert.equal(acceptsPercentageDraft(value), false);
    assert.throws(() => parsePercentageInput(value), /15/);
  }
  assert.equal(parsePercentageInput(""), null);
  assert.equal(parsePercentageInput("0"), "0.00");
  assert.equal(parsePercentageInput("15"), "15.00");
});
test("arrows stop at 15 and repair a previously stored higher rate", () => {
  assert.equal(stepPercentageDraft("15", 1), "15");
  assert.equal(stepPercentageDraft("14.99", 1), "15");
  assert.equal(stepPercentageDraft("100", -1), "15");
  assert.equal(stepPercentageDraft("100", 1), "15");
});
test("new defaults are bounded; old snapshot/CAS baselines can still be repaired", () => {
  const historical = { revision: 3, rates: { ENGINEERING: "100", ASSEMBLY: "20", INSTALLATION: "16" } };
  assert.equal(defaultsSnapshotSchema.safeParse(historical).success, true);
  for (const kind of ["ENGINEERING", "ASSEMBLY", "INSTALLATION"] as const) {
    assert.equal(defaultsPatchSchema.safeParse({ rates: { ...EMPTY_DEFAULTS.rates, [kind]: "15.1" }, expectedRates: EMPTY_DEFAULTS.rates, expectedRevision: 0, clientMutationId: randomUUID() }).success, false);
  }
  assert.equal(defaultsPatchSchema.safeParse({ rates: { ENGINEERING: "15", ASSEMBLY: "15", INSTALLATION: "15" }, expectedRates: historical.rates, expectedRevision: 3, clientMutationId: randomUUID() }).success, true);
});
test("generic historical rates and own-share transfers retain the original 100% range", () => {
  assert.equal(parsePercentageRate("100"), "100.00");
  assert.deepEqual(transferOwnPercentageShare([{ userId: "a", shareUnits: 1_000_000 }], "a", "b", "100"), [{ userId: "b", shareUnits: 1_000_000 }]);
});
