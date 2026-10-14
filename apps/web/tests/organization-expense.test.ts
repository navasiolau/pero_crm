import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { paymentSchema } from "../src/server/payments/contracts";
import { assertExpenseReportDocument } from "../src/server/payments/document-policy";
import { Prisma } from "@prisma/client";
import { loadOrganizationPayments } from "../src/server/finance/organization-ledger";
import { deletePaymentInTransaction } from "../src/server/payments/delete-core";
import { readCashBalance, readOrgBalance } from "../src/server/payroll/cash-core";
import { loadOrganizationIncome } from "../src/server/finance/income-ledger";
import { paymentSchema as organizationIncomeLedgerPaymentSchema } from "../src/server/payments/core";
import { readFileSync } from "node:fs";
import { summarizeProjectExpenses } from "../src/server/finance/project-expense-facts";
import { projectExpenseRows, loadProjectStockExpenses, type ProjectStockExpenseRecord } from "../src/server/finance/project-expenses";
import { calendarDateRange } from "../src/lib/calendar-dates";
import { formatExactMoney } from "../src/lib/format";
import { buildCashStatement, loadCashStatement, type CashStatementFact } from "../src/server/finance/cash-statement";
import { nextExpenseArticleCode, parseExpenseArticleCode, MAX_EXPENSE_ARTICLE_CODE } from "../src/lib/expense-article-code";
import { paymentView } from "../src/server/finance/payment-view";

// Источник: organization-expense.test.ts
test("ordinary expense can have no project, while document remains required", () => {
  const input = { projectId: null, direction: "EXPENSE" as const, amount: 100, currency: "BYN", cashAccountId: "cash",
    expenseArticleId: "article", reportDocumentId: randomUUID(), clientMutationId: randomUUID() };
  assert.equal(paymentSchema.safeParse(input).success, true);
  assert.doesNotThrow(() => assertExpenseReportDocument(input));
  assert.throws(() => assertExpenseReportDocument({ ...input, reportDocumentId: undefined }), /документ/);
});

test("general income still cannot disguise an expense article", () => {
  const input = { direction: "INCOME", amount: 100, currency: "BYN", cashAccountId: "cash", clientMutationId: "00000134-0000-4000-8000-000000000011" };
  assert.equal(paymentSchema.safeParse(input).success, true);
  assert.equal(paymentSchema.safeParse({ ...input, expenseArticleId: "article" }).success, false);
});

test("expense reader includes safe document and nullable project but rejects nonfinance before data read", async () => {
  let reads = 0;
  const db = { payment: { findMany: async ({ where }: { where: { direction: string } }) => { reads++; assert.equal(where.direction, "EXPENSE"); return [{
    id: "payment", direction: "EXPENSE", amount: new Prisma.Decimal(100), rate: new Prisma.Decimal(1), bynAmount: new Prisma.Decimal(100), projectAmount: null,
    currency: "BYN", rateDate: null, paidAt: new Date(), comment: "Общий расход", createdById: null, project: null, cashAccount: { name: "Касса" }, expenseArticle: { name: "Логистика" },
    reportDocument: { id: "document", state: "READY", fileName: "Чек.pdf", mimeType: "application/pdf", storageKey: "SECRET" },
  }]; } }, cashAccount: { findMany: async () => [] }, project: { findMany: async () => [] } } as unknown as Parameters<typeof loadOrganizationPayments>[2];
  await assert.rejects(loadOrganizationPayments({ id: "manager", roles: ["MANAGER"] }, "EXPENSE", db), /прав/); assert.equal(reads, 0);
  const result = await loadOrganizationPayments({ id: "finance", roles: ["ACCOUNTANT"] }, "EXPENSE", db);
  assert.equal(result.rows[0].project, null); assert.equal(result.rows[0].projectAmount, null);
  assert.equal(result.rows[0].reportDocument?.source, "finance"); assert.equal(result.rows[0].expenseArticleName, "Логистика");
  assert.ok(!JSON.stringify(result).includes("SECRET"));
});

test("common ledger cannot delete financial history of an archived project", async () => {
  let writes = 0;
  const tx = { payment: { findUnique: async () => ({ project: { id: "archived", deletedAt: new Date() }, direction: "EXPENSE" }), delete: async () => { writes++; } } } as unknown as Prisma.TransactionClient;
  await assert.rejects(deletePaymentInTransaction({ id: "actor", name: "Actor", roles: ["ACCOUNTANT"], source: "web" }, "payment", "EXPENSE", "BYN", "1", tx), /только для просмотра/);
  assert.equal(writes, 0);
});

{ // Источник: organization-income-ledger.test.ts
const paymentSchema = organizationIncomeLedgerPaymentSchema;
test('actual cash/org aggregates include general income once and preserve unknown historic payout refusal',async()=>{
 const rows=[{projectId:null,direction:'INCOME',cashAccountId:'cash',amount:100,bynAmount:300},{projectId:'j',direction:'INCOME',cashAccountId:'cash',amount:10,bynAmount:30}];let unknown=false;
 const db={payment:{aggregate:async({where}:{where:{direction:string}})=>({_sum:{bynAmount:rows.filter(r=>r.direction===where.direction).reduce((a,r)=>a+r.bynAmount,0)}}),groupBy:async()=>[{direction:'INCOME',_sum:{amount:110}}]},payout:{aggregate:async()=>({_sum:{cashAmount:0}}),findMany:async()=>unknown?[{amount:1,payrollCurrency:null,bynAmount:null}]:[]}} as unknown as Prisma.TransactionClient;
 assert.equal((await readCashBalance(db,'cash')).toFixed(2),'110.00');assert.equal((await readOrgBalance(db,'1')).toFixed(2),'330.00');unknown=true;await assert.rejects(readOrgBalance(db,'1'),/BYN/);
});
test('general payment context is accepted and forward migration preserves nullable pair without rewriting history',()=>{
 for(const direction of ['INCOME','EXPENSE'])assert.equal(paymentSchema.safeParse({direction,amount:1,currency:'BYN',cashAccountId:'cash',clientMutationId:'00000134-0000-4000-8000-000000000012'}).success,true);
 const sql=readFileSync('prisma/migrations/20261008120000_organization_expenses/migration.sql','utf8');
 assert.match(sql,/"projectId" IS NULL\) = \("projectAmount" IS NULL/);assert.doesNotMatch(sql,/UPDATE|DELETE|TRUNCATE/i);
});
test('income loader refuses nonfinance before read and keeps general project nullable',async()=>{let reads=0;const db={payment:{findMany:async()=>{reads++;return[{id:'pay',amount:new Prisma.Decimal(100),currency:'USD',rate:new Prisma.Decimal(3),rateDate:null,bynAmount:new Prisma.Decimal(300),paidAt:new Date(),comment:null,project:null,cashAccount:{name:'USD'}}]}},cashAccount:{findMany:async()=>[]},expenseArticle:{findMany:async()=>{throw Error('income loader must not query expense articles')}},project:{findMany:async()=>[]}} as unknown as Parameters<typeof loadOrganizationIncome>[1];await assert.rejects(loadOrganizationIncome({id:'m',roles:['MANAGER']},db),/прав/);assert.equal(reads,0);const result=await loadOrganizationIncome({id:'a',roles:['ACCOUNTANT']},db);assert.equal('expenseArticles' in result,false);assert.equal(result.rows[0].project,null);assert.equal(result.rows[0].amount,100);assert.equal(result.rows[0].bynAmount,300);});
}

// Источник: project-expense-ledger.test.ts
const d = (value: string) => new Prisma.Decimal(value);
const issue = { id: "same", type: "EXPENSE", quantity: d("3"), unitPrice: d("20"), totalByn: d("60"), createdAt: new Date("2026-10-08T00:00:00Z"), createdById: "u", comment: null,
  material: { id: "m", name: "Петля", measurementUnit: { name: "шт" } }, product: { id: "p", number: "204.1" }, warehouseValuation: { unitCost: d("20.000000001"), sourceMovementId: null } } satisfies ProjectStockExpenseRecord;
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

test("financial DRAFT product references are private while expense facts and amounts remain unchanged", async () => {
  const { fixtureModel } = await import("./helpers/visibility-fixture");
  const row = { ...issue, deletionId: null, product: { ...issue.product, projectId: "j", status: "DRAFT", deletedAt: null } };
  const db = { stockMovement: fixtureModel([row]) } as unknown as Parameters<typeof loadProjectStockExpenses>[2];
  for (const roles of [["ACCOUNTANT"], ["MANAGER", "ACCOUNTANT"], ["ADMIN"], ["DIRECTOR"]] as import("@prisma/client").Role[][]) {
    const movements = await loadProjectStockExpenses({ id: "u", roles }, "j", db);
    assert.equal(movements.length, 1);
    const allowed = roles.includes("ADMIN") || roles.includes("DIRECTOR");
    assert.equal(movements[0].product !== null, allowed);
    const view = projectExpenseRows([], movements, new Map());
    assert.equal(view[0].stock?.product !== null, allowed);
    assert.equal(view[0].bynAmount, 60);
    assert.equal(view[0].stock?.quantity, "3");
    assert.equal(summarizeProjectExpenses({ payments: [], stockMovements: movements }).expensesTotal, 60);
  }
  assert.equal(row.product.id, "p");
  assert.equal(row.totalByn.toString(), "60");
});

// Источник: cash-statement.test.ts
const account={id:"cash",name:"Касса",currency:"BYN",active:true};
const query={from:"2026-10-07",to:"2026-10-07",mode:"BYN" as const};
function fact(id:string,at:string,amount:string|null,direction:"INCOME"|"EXPENSE"="INCOME",source:"PAYMENT"|"SALARY"|"ADVANCE"="PAYMENT"):CashStatementFact {
 return {id,source,accountId:"cash",at,direction,nativeAmount:amount,nativeCurrency:"BYN",bynAmount:amount,label:source,comment:null,project:null,document:null};
}
test("MSK inclusive days include both midnight edges and validate calendar dates",()=>{
 const range=calendarDateRange(query.from,query.to);
 assert.equal(range.start.toISOString(),"2026-10-06T21:00:00.000Z");
 assert.equal(range.end.toISOString(),"2026-10-07T21:00:00.000Z");
 assert.throws(()=>calendarDateRange("2026-02-30","2026-03-01"));
 assert.throws(()=>calendarDateRange("2026-10-08","2026-10-07"));
});
test("opening plus income minus payment/salary/advance gives closing once",()=>{
 const data=buildCashStatement([account],[
  fact("opening","2026-10-06T20:59:59.999Z","100"),
  fact("in","2026-10-06T21:00:00.000Z","50"),
  fact("out","2026-10-07T00:00:00.000Z","10","EXPENSE"),
  fact("salary","2026-10-07T10:00:00.000Z","20","EXPENSE","SALARY"),
  fact("advance","2026-10-07T20:59:59.999Z","5","EXPENSE","ADVANCE"),
  fact("tomorrow","2026-10-07T21:00:00.000Z","999"),
 ],query);
 assert.deepEqual(data.rows[0].totals,{opening:"100.00",income:"50.00",expense:"-35.00",closing:"115.00"});
 assert.equal(data.rows[0].entries.length,4);
 assert.equal(data.totals[0].closing,"115.00");
});
test("native currencies stay separate and BYN uses the fixed saved equivalent",()=>{
 const usd={...account,id:"usd",currency:"USD",active:false};
 const facts=[fact("byn","2026-10-07T10:00:00Z","10"),{...fact("usd","2026-10-07T10:00:00Z","100"),accountId:"usd",nativeCurrency:"USD",bynAmount:"300"}];
 const native=buildCashStatement([account,usd],facts,{...query,mode:"NATIVE"});
 assert.deepEqual(native.totals.map(row=>[row.currency,row.closing]),[["BYN","10.00"],["USD","100.00"]]);
 assert.equal(buildCashStatement([account,usd],facts,query).totals[0].closing,"310.00");
});
test("historical unknown affects dependent totals but not known period movement; no-cash remains explicit",()=>{
 const data=buildCashStatement([account],[fact("unknown","2026-10-01T00:00:00Z",null),
  fact("known","2026-10-07T00:00:00Z","50"),{...fact("unassigned","2026-10-07T00:00:00Z","5","EXPENSE","ADVANCE"),accountId:null}],query);
 assert.equal(data.rows[0].totals.opening,null);assert.equal(data.rows[0].totals.income,"50.00");assert.equal(data.rows[0].totals.closing,null);
 assert.equal(data.rows.find(row=>row.unassigned)?.totals.closing,"-5.00");
 const mismatch=buildCashStatement([account],[{...fact("foreign","2026-10-07T00:00:00Z","10"),nativeCurrency:"USD"}],{...query,mode:"NATIVE"});
 assert.equal(mismatch.rows[0].totals.closing,null);
 assert.ok(mismatch.rows[0].entries[0].issues.length>0);
});
test("empty accounts have confirmed zeros and exact money formatting retains large cents",()=>{
 assert.equal(buildCashStatement([account],[],query).rows[0].totals.closing,"0.00");
 const data=buildCashStatement([account],[fact("big","2026-10-07T00:00:00Z","90071992547409.91"),fact("cents","2026-10-07T00:00:00Z","0.02")],query);
 assert.equal(data.rows[0].totals.closing,"90071992547409.93");
 assert.match(formatExactMoney(data.rows[0].totals.closing,"BYN"),/409,93 BYN$/);
 assert.match(formatExactMoney("-0.01","BYN"),/−0,01/);
});
test("nonfinancial loader refuses before reading money",async()=>{
 let reads=0;const db=new Proxy({},{get(){reads++;throw Error("unexpected query");}}) as Parameters<typeof loadCashStatement>[2];
 await assert.rejects(loadCashStatement({id:"m",roles:["MANAGER"]},query,db),/прав/);assert.equal(reads,0);
});

// Источник: expense-article-code-ui.test.ts
test('UI parser accepts digits only, distinguishes exhausted auto code from a free custom code',()=>{assert.equal(nextExpenseArticleCode(null),1);assert.equal(nextExpenseArticleCode(9),10);assert.equal(parseExpenseArticleCode('0012'),12);for(const input of ['','0','-1','+2','1.2','1e2','１２','2147483648'])assert.throws(()=>parseExpenseArticleCode(input));assert.throws(()=>nextExpenseArticleCode(MAX_EXPENSE_ARTICLE_CODE));assert.equal(parseExpenseArticleCode('2147483647'),MAX_EXPENSE_ARTICLE_CODE);});
test('migration numbers missing articles deterministically and leaves Payment and existing codes intact',()=>{const sql=readFileSync(new URL('../prisma/migrations/20261003020000_expense_article_codes/migration.sql',import.meta.url),'utf8');assert.match(sql,/ROW_NUMBER\(\) OVER \(ORDER BY "createdAt", "id"\)/);assert.match(sql,/a\."code" IS NULL/);assert.match(sql,/MAX\("code"\)/);assert.match(sql,/CHECK \("code" > 0\)/);assert.match(sql,/CREATE UNIQUE INDEX/);assert.doesNotMatch(sql,/WHERE[^;]*"active"/);assert.doesNotMatch(sql,/(?:ALTER TABLE|UPDATE|DELETE FROM) "(?:Payment|CashAccount|PayrollEntry)"/);});

// Источник: finance-payment-view.test.ts
const row = { id: "payment", direction: "EXPENSE" as const, amount: new Prisma.Decimal(10), currency: "BYN",
  rate: new Prisma.Decimal(1), bynAmount: new Prisma.Decimal(10), projectAmount: null,
  paidAt: new Date("2026-10-08T09:00:00Z"), comment: null, createdById: "actor", cashAccount: { name: "Касса" },
  expenseArticle: { id: "materials", name: "Материалы" } };
test("shared financial projection retains unknown amounts and exposes only safe ready document fields", () => {
  const document = { id: "doc", fileName: "Чек.pdf", mimeType: "application/pdf", state: "READY" as const, storageKey: "SECRET", uploadedById: "SECRET" };
  const view = paymentView({ ...row, reportDocument: document }, new Map([["actor", "Бухгалтер"]]));
  assert.equal(view.projectAmount, null); assert.equal(view.createdByName, "Бухгалтер");
  assert.deepEqual(view.reportDocument, { id: "doc", fileName: "Чек.pdf", mimeType: "application/pdf", source: "finance" });
  assert.ok(!JSON.stringify(view).includes("SECRET"));
  assert.equal(paymentView({ ...row, reportDocument: { ...document, state: "PENDING" } }, new Map()).reportDocument, null);
  assert.equal(paymentView(row, new Map()).reportDocument, null);
});
