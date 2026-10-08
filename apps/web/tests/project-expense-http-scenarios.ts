import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { createTaskTransaction } from "../src/server/tasks/transaction";
import { createExpenseLedgerFixture, deleteExpenseLedgerFixture } from "./helpers/project-expense-fixture";
import { expenseLedgerBaseline } from "./project-expense-native-scenarios";

/** Rendered deployed routes with disposable owned users; caller supplies fresh authenticated requests. */
export async function runProjectExpenseHttp(db: PrismaClient, request: (path: string, userId: string) => Promise<Response>) {
  const before=await expenseLedgerBaseline(db), marker=`qa101-http-${randomUUID()}`;
  try {
    const fixture=await createTaskTransaction(db)(tx=>createExpenseLedgerFixture(tx,marker));
    const financial=await request(`/finance/projects/${fixture.project.id}`,marker);
    assert.equal(financial.status,200);
    const html=await financial.text();
    for(const expected of [fixture.issue.id,fixture.returned.id,"20.000000001","WAREHOUSE_ISSUE","WAREHOUSE_RETURN","QA101 Доставка"])
      assert.ok(html.includes(expected),`RENDER_MISSING:${expected}`);
    assert.ok(!html.includes("PRIVATE_TECH_QA101"));
    await db.user.update({where:{id:marker},data:{roles:["MANAGER"]}});
    const refused=await request(`/finance/projects/${fixture.project.id}`,marker);
    assert.ok([302,303,307,308].includes(refused.status),"MANAGER_NOT_REJECTED");
    await db.user.update({where:{id:marker},data:{roles:["MANAGER","ACCOUNTANT"]}});
    const combined=await request(`/finance/projects/${fixture.project.id}`,marker);
    assert.equal(combined.status,200);assert.ok((await combined.text()).includes(fixture.issue.id));
    const general=await request(`/projects/${fixture.project.id}?tab=finance`,marker);
    assert.equal(general.status,200);
    const generalHtml=await general.text();
    assert.ok(generalHtml.includes(fixture.issue.id));assert.ok(generalHtml.includes("20.000000001"));
    return {status:"PASS",routes:["financial","general"],roles:["accountant","manager-denied","combined"],providerMessages:0};
  } finally {
    await createTaskTransaction(db)(tx=>deleteExpenseLedgerFixture(tx,marker));
    assert.deepEqual(await expenseLedgerBaseline(db),before,"HTTP_ORIGINAL_DATA_CHANGED");
  }
}

