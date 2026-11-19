import assert from "node:assert/strict";
import test from "node:test";
import { allocateExpenseReceipt } from "../src/server/warehouse/expense-receipt-allocation";
import { planWarehouseDeletion } from "../src/server/warehouse/deletion-plan";

test("распределяет весь сохранённый BYN по копейкам с устойчивым порядком равных остатков", () => {
  const rows = ["a", "b", "c"].map(materialId => ({ materialId, quantity: "0,123", amount: "1" }));
  assert.deepEqual(allocateExpenseReceipt(rows, "3.00", "1.00"), [
    { materialId: "a", quantity: "0.123", amount: "1.00", bynAmount: "0.34" },
    { materialId: "b", quantity: "0.123", amount: "1.00", bynAmount: "0.33" },
    { materialId: "c", quantity: "0.123", amount: "1.00", bynAmount: "0.33" },
  ]);
});

test("отклоняет неполный чек и нулевую стоимость позиции в BYN", () => {
  const rows = [{ quantity: "1", amount: "1" }, { quantity: "2", amount: "1" }];
  assert.throws(() => allocateExpenseReceipt(rows, "3", "3"), /совпадать/);
  assert.throws(() => allocateExpenseReceipt(rows, "2", "0.01"), /меньше 0,01 BYN/);
});

test("выделяет позднюю зависимую выдачу при отмене нескольких строк одного материала", () => {
  const rows = [
    { id: "purchase1", type: "INCOME" as const, quantity: "1", unitCost: "2", value: "2", money: "2", revision: 1 },
    { id: "purchase2", type: "INCOME" as const, quantity: "1", unitCost: "4", value: "4", money: "4", revision: 2 },
    { id: "issue", type: "EXPENSE" as const, quantity: "1", unitCost: "3", value: "3", money: "3", revision: 3 },
  ].map(row => ({ ...row, sourceId: null, createdAt: "2026-11-20T12:00:00.000Z" }));
  const result = planWarehouseDeletion(rows, { quantity: "1", value: "3" }, ["purchase1", "purchase2"]);
  assert.deepEqual(result.deleted, [
    { id: "purchase1", reason: "ROOT" }, { id: "purchase2", reason: "ROOT" }, { id: "issue", reason: "STOCK" },
  ]);
});
