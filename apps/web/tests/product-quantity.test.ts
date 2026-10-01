import assert from "node:assert/strict";
import test from "node:test";
import { assertProductQuantity, inputNorm, planQuantityChange, productLineTotal, projectTotal, scaleNorm, workBudget,
  materialDebt, type QuantityWork, type QuantityMaterial } from "../src/lib/product-quantity";
import { calculateStageFund } from "../src/lib/product-stage-pay";
import { taskPieceAmount } from "../src/lib/work-shares";

const work = (): QuantityWork => ({ id: "w", title: "Сборка", quantity: "5.00", quantityPerUnit: "1.00",
  priceSnapshot: "30.00", paymentKind: "LEGACY", tasks: [
    { quantity: "4", allocationGroupId: "g" }, { quantity: "4", allocationGroupId: "g" }] });
const material = (): QuantityMaterial => ({ id: "m", quantity: "20", quantityPerUnit: "4", issuedQty: "8", material: { name: "Петли" } });

test("five chairs keep unit price and add shared services once", () => {
  assert.equal(productLineTotal("200", 5), "1000.00");
  assert.equal(projectTotal([{ expectedPrice: "200", quantity: 5 }], { delivery: "100" }), 1100);
  const project = { delivery: "100", id: "project", currency: "BYN", products: [] };
  assert.equal(projectTotal([{ expectedPrice: "200", quantity: 5 }], project), 1100);
});
test("decimal money, work and material quantities are exact", () => {
  assert.equal(productLineTotal("0.10", 3), "0.30");
  assert.equal(scaleNorm("0.30", 5, 2, 10), "1.50");
  assert.equal(scaleNorm("0.125", 5, 3, 12), "0.625");
  assert.equal(materialDebt("0.300", "0.200"), 0.1);
  assert.equal(materialDebt("0.625", "0.100"), 0.525);
});
test("null and explicit zero prices keep their meaning", () => {
  assert.equal(productLineTotal(null, 5), null);
  assert.equal(productLineTotal("0", 5), "0.00");
});
test("count, precision and overflow are rejected before writing", () => {
  for (const value of [0, -1, 1.5, NaN, Infinity, 2147483648]) assert.throws(() => assertProductQuantity(value));
  assert.throws(() => scaleNorm("0.001", 5, 2, 10));
  assert.throws(() => scaleNorm("99999999.99", 2, 2, 10));
  assert.throws(() => productLineTotal("9999999999.99", 2));
});
test("unambiguous per-unit inputs and legacy quantity=1 compatibility", () => {
  assert.equal(inputNorm({ quantityPerUnit: 4 }, 5, 3, 12), "4.000");
  assert.equal(inputNorm({ quantity: 4 }, 1, 3, 12), "4.000");
  assert.throws(() => inputNorm({ quantity: 4 }, 5, 3, 12), /обновите форму/);
  assert.throws(() => inputNorm({ quantity: 4, quantityPerUnit: 4 }, 1, 3, 12));
});
test("piecework uses full batch and task quantity is not multiplied twice", () => {
  assert.equal(workBudget("30", scaleNorm("1", 5, 2, 10)), "150.00");
  assert.equal(taskPieceAmount({ quantity: "2", executorShare: "1" }, "30"), "60.00");
});
test("percent engineering and installation still use one chair", () => {
  const product = { expectedPrice: "200", quantity: 5 };
  assert.equal(productLineTotal(product.expectedPrice, product.quantity), "1000.00");
  assert.equal(calculateStageFund({ price: product.expectedPrice, ratePercent: "5", productCurrency: "BYN",
    payrollCurrency: "BYN", productRateByn: "1", payrollRateByn: "1" }).amount, "10.00");
});
test("increasing count recalculates only plans and preserves every input fact", () => {
  const works = [work()]; const materials = [material()]; const before = JSON.stringify({ works, materials });
  const plan = planQuantityChange(5, 6, works, materials);
  assert.equal(plan.works[0].quantity, "6.00");
  assert.equal(plan.works[0].total, "180.00");
  assert.equal(plan.materials[0].quantity, "24.000");
  assert.equal(JSON.stringify({ works, materials }), before);
});
test("group allocations count once when reducing to four chairs", () => {
  const plan = planQuantityChange(5, 4, [work()], [material()]);
  assert.equal(plan.works[0].quantity, "4.00");
  assert.equal(plan.materials[0].quantity, "16.000");
});
test("reduction below allocated work or issued material is rejected", () => {
  assert.throws(() => planQuantityChange(5, 3, [work()], [material()]), /Сборка/);
  assert.throws(() => planQuantityChange(5, 1, [], [material()]), /Петли/);
});
test("legacy percent work and immutable snapshots do not acquire a batch multiplier", () => {
  const frozen = { priceSnapshot: "200.00", amount: "10.00", state: "PENDING_FX" };
  const legacy = { ...work(), paymentKind: "INSTALLATION" };
  const before = JSON.stringify({ frozen, legacy });
  assert.deepEqual(planQuantityChange(5, 6, [legacy], []).works, []);
  assert.equal(JSON.stringify({ frozen, legacy }), before);
});
test("old application rows can establish a norm only at count one", () => {
  const old = { ...work(), quantityPerUnit: null, tasks: [] };
  assert.equal(planQuantityChange(1, 2, [old], []).works[0].quantity, "10.00");
  assert.throws(() => planQuantityChange(5, 6, [old], []), /отсутствует норма/);
});
