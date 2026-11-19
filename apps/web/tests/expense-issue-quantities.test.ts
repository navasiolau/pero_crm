import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { warehouseMove, type WarehouseMovementInput } from "../src/server/warehouse/accounting";

import { expenseIssueInput, expenseIssueQuantities, receiptLineQuantities } from "../src/server/warehouse/expense-issue-contracts";

const line = (movementId: string, receiptQuantity: string, issuedQuantity: string) => ({
  movementId, materialId: "material", materialName: "Одна плита", unit: "шт",
  ...receiptLineQuantities(receiptQuantity, issuedQuantity),
});

test("узкий сценарий из чека не расширяет обычные складские права", async () => {
  const tx = {} as Prisma.TransactionClient;
  const input: WarehouseMovementInput = { kind: "EXPENSE", clientMutationId: "bbced9b6-d975-40c2-ABE4-1ae8c97c360a", productId: "product", quantity: "1" };
  await assert.rejects(warehouseMove(tx, { id: "u1", roles: ["ACCOUNTANT"] }, input), /Недостаточно прав/);
  await assert.rejects(warehouseMove(tx, { id: "u2", roles: ["PROCUREMENT"] }, input, undefined, { projectId: "project" }), /Недостаточно прав/);
  await assert.rejects(warehouseMove(tx, { id: "u1", roles: ["ACCOUNTANT"] }, { ...input, kind: "INCOME" }, undefined, { projectId: "project" }), /Некорректный контекст/);
});

test("частичная выдача использует подтверждённый остаток строки и текущую средневзвешенную стоимость", () => {
  const sources = [line("line-a", "10", "4")];
  const positions = new Map([["material", { quantity: "8", value: "40" }]]);
  const [quote] = expenseIssueQuantities([{ sourceMovementId: "line-a", quantity: "5" }], sources, positions);
  assert.equal(quote.receiptQuantity, "10.000");
  assert.equal(quote.issuedQuantity, "4.000");
  assert.equal(quote.remainingQuantity, "6.000");
  assert.equal(quote.warehouseAfter, "3.000");
  assert.equal(quote.moneyByn, "25.00");
  assert.throws(() => expenseIssueQuantities([{ sourceMovementId: "line-a", quantity: "7" }], sources, positions), /по строке чека/);
});

test("несколько строк одного материала совместно расходуют запас и не допускают повтор строки", () => {
  const sources = [line("line-a", "5", "2"), line("line-b", "5", "2")];
  const lines = [{ sourceMovementId: "line-b", quantity: "2" }, { sourceMovementId: "line-a", quantity: "1" }];
  const positions = new Map([["material", { quantity: "3", value: "10" }]]);
  const quote = expenseIssueQuantities(lines, sources, positions);
  assert.deepEqual(quote.map(row => [row.movementId, row.warehouseAfter, row.moneyByn]),
    [["line-a", "2.000", "3.33"], ["line-b", "0.000", "6.67"]]);
  positions.set("material", { quantity: "2", value: "10" });
  assert.throws(() => expenseIssueQuantities(lines, sources, positions), /на складе/);
  assert.equal(expenseIssueInput.safeParse({ paymentId: "p", projectId: "w", productId: "x", lines: [lines[0], lines[0]] }).success, false);
});
