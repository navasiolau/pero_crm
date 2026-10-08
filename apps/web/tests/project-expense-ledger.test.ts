import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { summarizeProjectExpenses } from "../src/server/finance/project-expense-facts";
import { projectExpenseRows, loadProjectStockExpenses, type ProjectStockExpenseRecord } from "../src/server/finance/project-expenses";
const d = (value: string) => new Prisma.Decimal(value);
const issue = { id: "same", type: "EXPENSE", quantity: d("3"), unitPrice: d("20"), totalByn: d("60"), createdAt: new Date("2026-10-08T00:00:00Z"), createdById: "u", comment: null,
  material: { id: "m", name: "Петля", unit: "шт" }, product: { id: "p", number: "204.1" }, warehouseValuation: { unitCost: d("20.000000001"), sourceMovementId: null } } satisfies ProjectStockExpenseRecord;
test("issue, partial and full return use saved costs exactly once with stable source identity", () => {
  const returned = { ...issue, id: "return", type: "RETURN" as const, quantity: d("1"), totalByn: d("20"), warehouseValuation: { unitCost: d("20.000000001"), sourceMovementId: issue.id } };
  const facts = { payments: [], stockMovements: [issue, returned] };
  const rows = projectExpenseRows([], facts.stockMovements, new Map([["u", "Снабженец"]]));
  assert.deepEqual(rows.map(row => row.bynAmount).sort((a,b) => a!-b!), [-20,60]);
  assert.equal(summarizeProjectExpenses(facts).expensesTotal, 40);
  assert.equal(rows.find(row => row.source === "WAREHOUSE_ISSUE")?.stock?.unitPrice, "20.000000001");
  assert.equal(rows.find(row => row.source === "WAREHOUSE_RETURN")?.stock?.sourceMovementId, issue.id);
  assert.equal(rows[0].createdByName, "Снабженец");
  assert.equal(summarizeProjectExpenses({ ...facts, stockMovements: [...facts.stockMovements, { ...returned, id: "full", totalByn: d("40") }] }).expensesTotal, 0);
  assert.equal(issue.totalByn.toString(), "60");
});
test("article IDs distinguish equal labels and warehouse group; unknown history stays unknown", () => {
  const payments = ["a", "b"].map((id) => ({ direction: "EXPENSE" as const, bynAmount: d("10.01"), expenseArticle: { id, name: "Материалы (склад)" } }));
  const result = summarizeProjectExpenses({ payments, stockMovements: [issue] });
  assert.equal(result.expensesTotal, 80.02);
  assert.equal(result.expenseBreakdown.length, 3);
  assert.equal(new Set(result.expenseBreakdown.map(row => row.key)).size, 3);
  const unknown = summarizeProjectExpenses({ payments, stockMovements: [{ ...issue, totalByn: null }] });
  assert.equal(unknown.expensesTotal, null);
  assert.equal(unknown.expenseBreakdown.find(row => row.key === "warehouse")?.amount, null);
  assert.equal(unknown.expenseBreakdown.find(row => row.key === "article:a")?.amount, 10.01);
});
test("financial stock reader rejects manager before query and permits accountant role union without technical fields", async () => {
  let reads = 0;
  const db = { stockMovement: { findMany: async (args: unknown) => { reads++; const text=JSON.stringify(args); assert.ok(!text.includes("description")); assert.ok(!text.includes("purchasePrice")); assert.ok(text.includes("projectId")); return [issue]; } } } as unknown as Parameters<typeof loadProjectStockExpenses>[2];
  await assert.rejects(loadProjectStockExpenses({id:"u",roles:["MANAGER"]}, "j", db), /прав/);
  assert.equal(reads,0);
  assert.equal((await loadProjectStockExpenses({id:"u",roles:["MANAGER","ACCOUNTANT"]}, "j", db)).length,1);
  assert.equal(reads,1);
});
