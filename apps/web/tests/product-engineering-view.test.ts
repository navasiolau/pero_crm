import assert from "node:assert/strict";
import { test } from "node:test";
import { getEngineeringFundView } from "../src/server/products/engineering-view";
import { percentToStageUnits } from "../src/lib/engineering-fund-view";

test("settled fund shows saved names, weights and physical quantities instead of later mutable records", async () => {
  const task = { id: "task", workId: "work", productId: "product", projectId: "project", title: "Новое название задачи", status: "DONE", assigneeId: "user", assignee: { name: "Новое имя" }, quantity: "10", executorShare: "1", allocationGroupId: null, shareUnits: null, stageShareUnits: 1_000_000, splitRevision: 9 };
  const work = { id: "work", title: "Новое название работы", projectId: "project", paymentKind: "ENGINEERING", stagePayPoolId: "pool", quantity: "10", poolWeightUnits: 1_000_000, tasks: [task] };
  const settlement = { priceSnapshot: "10000", ratePercentSnapshot: "5", amount: "500", payrollCurrency: "BYN", productCurrency: "BYN", closedAt: new Date("2026-09-01"), shares: [{ taskId: "task", workId: "work", taskTitleSnapshot: "Задача при начислении", workTitleSnapshot: "Работа при начислении", userNameSnapshot: "Имя при начислении", stageShareUnits: 500_000, workWeightUnits: 600_000, quantitySnapshot: "5", quantityShareUnitsSnapshot: 500_000, amount: "150", bynAmount: "150", projectAmount: "150" }] };
  const product = { id: "product", projectId: "project", status: "PRODUCTION", engineerId: "user", expectedPrice: "12000", project: { currency: "BYN" }, works: [work], stagePayPools: [{ id: "pool", state: "SETTLED", revision: 4, ratePercent: "5", settlement, works: [work] }] };
  const db = { product: { findUnique: async () => product } } as unknown as Parameters<typeof getEngineeringFundView>[0];
  const result = await getEngineeringFundView(db, "product", false);
  assert.equal(result.priceBasis, "10000"); assert.equal(result.ratePercent, "5"); assert.equal(result.amount, "500");
  assert.equal(result.works[0].title, "Работа при начислении"); assert.equal(result.works[0].weightUnits, 600_000);
  assert.equal(result.works[0].tasks[0].title, "Задача при начислении"); assert.equal(result.works[0].tasks[0].assigneeName, "Имя при начислении");
  assert.equal(result.works[0].tasks[0].quantity, "2.5"); assert.equal(result.works[0].tasks[0].units, 500_000);
  assert.equal(result.canClose, false);
});

test("percentage input preserves zero and minimum share precision without binary arithmetic", () => {
  assert.equal(percentToStageUnits("0"), 0); assert.equal(percentToStageUnits("0,0001"), 1);
  assert.equal(percentToStageUnits("33.3333"), 333_333); assert.equal(percentToStageUnits("100"), 1_000_000);
  for (const value of ["", "1e2", "0.00001", "100.01", "-1"]) assert.throws(() => percentToStageUnits(value));
});
