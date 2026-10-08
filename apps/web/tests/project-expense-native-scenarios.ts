import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { createTaskTransaction } from "../src/server/tasks/transaction";
import { getProjectEconomics } from "../src/server/finance/queries";
import { loadFinanceProjectWorkspace } from "../src/server/finance/project-workspace";
import { createExpenseLedgerFixture } from "./helpers/project-expense-fixture";

export async function expenseLedgerBaseline(db: PrismaClient) {
  const result: Record<string, unknown> = {};
  for (const table of ["Client","Project","Product","User","Material","ExpenseArticle","Payment","StockMovement","WarehouseMovementValuation","WarehouseBalance","ChangeLog","DomainEvent"])
    result[table] = await db.$queryRawUnsafe(`SELECT count(*)::text AS count,md5(COALESCE(string_agg(md5(row_to_json(t)::text),'' ORDER BY ${table === "WarehouseBalance" ? '"materialId"' : "id"}),'')) AS digest FROM "${table}" t`);
  return result;
}
export async function runProjectExpenseNative(db: PrismaClient) {
  const before = await expenseLedgerBaseline(db), rollback = new Error("QA101_ROLLBACK");
  let verified = false;
  try {
    await createTaskTransaction(db)(async tx => {
      const marker = `qa101-${randomUUID()}`, fixture = await createExpenseLedgerFixture(tx, marker);
      const actor = { id: fixture.user.id, roles: fixture.user.roles };
      const load = () => loadFinanceProjectWorkspace(actor, fixture.project.id, tx, (id, facts) => getProjectEconomics(id, tx, facts));
      const initial = await load(); assert.ok(initial);
      assert.equal(initial.expenseRows.length, 3);
      assert.equal(initial.economics.expensesTotal, 50);
      assert.equal(initial.economics.marginAtFullPrice, 950);
      assert.equal(initial.expenseRows.reduce((sum,row)=>sum + row.bynAmount!,0), 50);
      assert.equal(initial.economics.expenseBreakdown.find(row=>row.key==="warehouse")?.amount,40);
      assert.equal(initial.expenseRows.find(row=>row.source==="WAREHOUSE_ISSUE")?.stock?.unitPrice,"20.000000001");
      assert.ok(!JSON.stringify(initial).includes("PRIVATE_TECH_QA101"));
      const payments = await tx.payment.count({ where: { projectId: fixture.project.id } });
      await tx.material.update({ where: { id: fixture.material.id }, data: { purchasePrice: 100 } });
      await tx.stockMovement.create({ data: { materialId: fixture.material.id, type: "INCOME", quantity: 10, unitPrice: 100, totalByn: 1000 } });
      assert.deepEqual((await load())?.expenseRows,initial.expenseRows);
      assert.equal((await load())?.economics.expensesTotal,50);
      await tx.stockMovement.create({ data: { materialId: fixture.material.id, productId: fixture.product.id, type: "RETURN", quantity: 2, unitPrice: 20, totalByn: 40 } });
      assert.equal((await load())?.economics.expensesTotal,10);
      assert.equal(await tx.payment.count({ where: { projectId: fixture.project.id } }),payments);
      await tx.product.update({ where: { id: fixture.product.id }, data: { deletedAt: new Date() } });
      assert.equal((await load())?.expenseRows.length,4);
      await tx.stockMovement.create({ data: { materialId: fixture.material.id, productId: fixture.product.id, type: "EXPENSE", quantity: 1, unitPrice: null, totalByn: null } });
      const incomplete=await load(); assert.equal(incomplete?.economics.expensesTotal,null);
      assert.equal(incomplete?.expenseRows.filter(row=>row.bynAmount===null).length,1);
      await assert.rejects(loadFinanceProjectWorkspace({id:actor.id,roles:["MANAGER"]},fixture.project.id,tx,()=>Promise.reject("must not read")),/прав/);
      verified = true; throw rollback;
    });
  } catch(error) { if(error!==rollback)throw error; }
  assert.ok(verified); assert.deepEqual(await expenseLedgerBaseline(db),before);
  return { status: "PASS", issue:60,partialReturn:-20,fullReturn:-40,paymentCount:1,repricing:"UNCHANGED",history:"EXPLICIT_NULL",originalData:"MATCH",qaRows:"ROLLED_BACK" };
}

