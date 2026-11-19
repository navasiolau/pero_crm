import assert from "node:assert/strict";
import { test } from "node:test";
import { allocateLogisticsMoney } from "../src/server/logistics/allocation";
import { reallocateLogisticsMoney } from "../src/server/logistics/reallocation-money";

const equal = [{ projectId: "a", percentBps: 5000 }, { projectId: "b", percentBps: 5000 }];

test("перераспределение сохраняет исходный валютный и BYN итоги с явной поправкой", () => {
  assert.equal(allocateLogisticsMoney("0.02", equal, "1.500000").bynAmount, "0.04");
  const result = reallocateLogisticsMoney("0.02", "0.03", "1.500000", equal);
  assert.equal(result.amount, "0.02");
  assert.equal(result.bynAmount, "0.03");
  assert.equal(result.difference, "-0.01");
  assert.deepEqual(result.allocations.map(row => [row.amount, row.bynAmount, row.roundingAdjustment]), [
    ["0.01", "0.01", "-0.01"], ["0.01", "0.02", "0.00"],
  ]);
  assert.deepEqual(reallocateLogisticsMoney("0.02", "0.03", "1.500000", [...equal].reverse()), result);
});

test("поправка обоих знаков и нулевая денежная доля", () => {
  const addition = reallocateLogisticsMoney("0.02", "0.04", "1.500000", [{ projectId: "c", percentBps: 10000 }]);
  assert.equal(addition.allocations[0].roundingAdjustment, "0.01");
  const zero = reallocateLogisticsMoney("0.01", "0.02", "1.500000", equal);
  assert.deepEqual(zero.allocations.map(row => [row.projectId, row.amount, row.bynAmount]),
    [["a", "0.01", "0.02"], ["b", "0.00", "0.00"]]);
  assert.equal(reallocateLogisticsMoney("10.00", "10.00", "1.000000", equal).difference, "0.00");
});
