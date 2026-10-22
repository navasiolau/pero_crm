import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { paymentSchema } from "../src/server/payments/contracts";
import { assertExpenseReportDocument } from "../src/server/payments/document-policy";
import { Prisma } from "@prisma/client";
import { deletePaymentInTransaction } from "../src/server/payments/delete-core";
import { readCashBalance, readOrgBalance } from "../src/server/payroll/cash-core";
import { paymentSchema as organizationIncomeLedgerPaymentSchema } from "../src/server/payments/core";
import { readFileSync } from "node:fs";
import { summarizeProjectExpenses } from "../src/server/finance/project-expense-facts";
import { type ProjectStockExpenseRecord } from "../src/server/finance/project-expenses";
import { calendarDateRange } from "../src/lib/calendar-dates";
import { formatExactMoney } from "../src/lib/format";
import { buildCashStatement, type CashStatementFact } from "../src/server/finance/cash-statement";
import { nextExpenseArticleCode, parseExpenseArticleCode, MAX_EXPENSE_ARTICLE_CODE } from "../src/lib/expense-article-code";
import { paymentView } from "../src/server/finance/payment-view";
import { reportDocumentNames } from "../src/lib/report-document-names";

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
}

// Источник: project-expense-ledger.test.ts
const d = (value: string) => new Prisma.Decimal(value);
const issue = { id: "same", type: "EXPENSE", quantity: d("3"), unitPrice: d("20"), totalByn: d("60"), createdAt: new Date("2026-10-08T00:00:00Z"), createdById: "u", comment: null,
  material: { id: "m", name: "Петля", measurementUnit: { name: "шт" } }, product: { id: "p", number: "204.1" }, warehouseValuation: { unitCost: d("20.000000001"), sourceMovementId: null } } satisfies ProjectStockExpenseRecord;
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
test("historical unknown affects dependent totals but not known period movement; no-cash remains explicit",()=>{
 const data=buildCashStatement([account],[fact("unknown","2026-10-01T00:00:00Z",null),
  fact("known","2026-10-07T00:00:00Z","50"),{...fact("unassigned","2026-10-07T00:00:00Z","5","EXPENSE","ADVANCE"),accountId:null}],query);
 assert.equal(data.rows[0].totals.opening,null);assert.equal(data.rows[0].totals.income,"50.00");assert.equal(data.rows[0].totals.closing,null);
 assert.equal(data.rows.find(row=>row.unassigned)?.totals.expense,"-5.00");
 assert.equal(data.rows.find(row=>row.unassigned)?.totals.closing,null);
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

test("three financial reports remain one project/cash expense and every name is searchable", () => {
  const documents = [1,2,3].map(index => ({id:`doc-${index}`,fileName:`Документ-${index}.pdf`,mimeType:"application/pdf",state:"READY" as const}));
  const view = paymentView({...row,reportDocument:documents[0],reportDocuments:documents.map((document,position)=>({document,position}))},new Map());
  assert.deepEqual(view.reportDocuments?.map(file=>file.id),documents.map(file=>file.id));
  assert.ok(reportDocumentNames(view).includes("Документ-3.pdf"));assert.equal(view.amount,10);
  const data = buildCashStatement([account],[{...fact("one-payment","2026-10-07T10:00:00Z","10","EXPENSE"),document:view.reportDocument,documents:view.reportDocuments}],query);
  assert.equal(data.rows[0].entries.length,1);assert.equal(data.rows[0].totals.expense,"-10.00");assert.equal(data.rows[0].entries[0].documents?.length,3);
  assert.equal(summarizeProjectExpenses({payments:[row],stockMovements:[]}).expensesTotal,10);
});

test("logistics financial projection exposes every TTN and uses no ordinary report fallback", () => {
  const documents = [1,2,3].map(index=>({document:{id:`ttn-${index}`,fileName:`ТТН-${index}.pdf`,mimeType:"application/pdf"}}));
  const view = paymentView({...row,logisticsAllocation:{posting:{tripId:"trip",documents}}},new Map());
  assert.deepEqual(view.reportDocuments?.map(file=>file.id),["ttn-1","ttn-2","ttn-3"]);
  assert.ok(view.reportDocuments?.every(file=>file.source==="logistics"));assert.equal(view.amount,10);
});
