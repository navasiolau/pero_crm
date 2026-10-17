import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";
import { Prisma, type PrismaClient, type Role } from "@prisma/client";
import { payrollMonth, payrollMonthRange } from "../../src/lib/payroll-month";
import { ADVANCE_ROLES, PAYROLL_MANAGE_ROLES, hasAnyRole } from "../../src/lib/roles";
import type { CashRates } from "../../src/lib/cash-ledger";
import type { CashPayoutInput, PayoutActor } from "../../src/server/payroll/cash-core";
import type { PaymentInput } from "../../src/server/payments/contracts";
import { stockPurchaseSchema } from "../../src/server/warehouse/contracts";
import { activePaymentWhere } from "../../src/server/payments/active-records";
import { guardedModuleCache } from "../helpers/guarded-module-cache";
import { nativeSnapshot } from "../helpers/native-acceptance-snapshot";
import { createPostgresFixture, fixedBynTotal, moneyRows as money, rejectedSql, savedOrgBalance, type PostgresRows } from "./postgres.fixture";
import { verifyDefaultCashAccountNative } from "../helpers/default-cash-native";
import { verifyInlineExpenseArticleNative } from "../helpers/inline-expense-article-native";
import { verifyInlineMaterialNative } from "../helpers/inline-material-native";

let fixture: Awaited<ReturnType<typeof createPostgresFixture>>;
let scope: ReturnType<typeof guardedModuleCache>;
let cash: typeof import("../../src/server/payroll/cash-core");
let actions: typeof import("../../src/server/payroll/actions");
let service: typeof import("../../src/server/payroll/cash-service");
let payroll: typeof import("../../src/server/payroll/queries");
let turnover: typeof import("../../src/server/payroll/turnover-core");
let payments: typeof import("../../src/server/payments/service");
let paymentCore: typeof import("../../src/server/payments/core");
let preparation: typeof import("../../src/server/payments/prepare");
let receipts: typeof import("../../src/server/payments/receipts");
let paymentDelete: typeof import("../../src/server/payments/delete-core");
let ledger: typeof import("../../src/server/finance/organization-ledger");
let direct: typeof import("../../src/server/product-percentage-pay/direct-completion");
let statuses: typeof import("../../src/server/products/status-core");
let stock: typeof import("../../src/server/warehouse/accounting"), purchase: typeof import("../../src/server/warehouse/stock-purchase-core");
let stockDeletion: typeof import("../../src/server/warehouse/deletion-core");
let trips: typeof import("../../src/server/logistics/core"), logistics: typeof import("../../src/server/logistics/posting-core");
let logisticsQueries: typeof import("../../src/server/logistics/money-query-core");
let logisticsDocuments: typeof import("../../src/server/logistics/documents"), logisticsViews: typeof import("../../src/server/logistics/query-core"), logisticsHttp: typeof import("../../src/server/logistics/http");
let economics: typeof import("../../src/server/finance/queries"), productActions: typeof import("../../src/server/products/actions");
let statements: typeof import("../../src/server/finance/cash-statement"), workspaces: typeof import("../../src/server/finance/project-workspace");
let productCore: typeof import("../../src/server/products/core"), projectStages: typeof import("../../src/server/projects/stage-core");
const session = new AsyncLocalStorage<{ db: PrismaClient | Prisma.TransactionClient; actor: PayoutActor }>();
const dispatches: string[] = [], cachePaths: string[] = [];
let rateReads = 0, savepoint = 0;
const on = <T>(db: PrismaClient | Prisma.TransactionClient, actor: PayoutActor, operation: () => T) => session.run({ db, actor }, operation);
const actorFor = (user: { id: string; name: string; roles: Role[] }): PayoutActor => ({ ...user, source: "web" });
const rates = (): CashRates => {
  const day = new Date().toISOString().slice(0, 10);
  return { asOf: day, cash: { currency: "BYN", rate: "1.000000", date: day }, payroll: { currency: "BYN", rate: "1.000000", date: day } };
};

before(async () => {
  fixture = await createPostgresFixture("finance");
  // Только auth/cache/FX/dispatch требуют границы без Next request. Все ORM delegate исполняют настоящий SQL.
  const facade = new Proxy({}, { get(_target, key) {
    const db = session.getStore()?.db ?? fixture.db;
    if (key === "$transaction" && !("$transaction" in db)) return async (operation: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      const tx = db as Prisma.TransactionClient, name = `finance169_${++savepoint}`;
      await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
      try { const result = await operation(tx); await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`); return result; }
      catch (error) { await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`); await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`); throw error; }
    };
    const value: unknown = Reflect.get(db, key);
    return typeof value === "function" ? value.bind(db) : value;
  } });
  const anchor = new URL("../ci169-finance-scope.ts", import.meta.url).href, require = createRequire(anchor);
  const targets = ["payroll/actions", "payments/service", "payments/delete-core", "finance/organization-ledger", "finance/queries", "finance/cash-statement", "finance/project-workspace", "products/core", "projects/stage-core", "products/status-core", "products/actions",
    "warehouse/accounting", "warehouse/stock-purchase-core", "warehouse/deletion-core", "logistics/core", "logistics/documents", "logistics/query-core", "logistics/http", "logistics/posting-core", "logistics/money-query-core"].map(path => `../src/server/${path}`);
  scope = guardedModuleCache(anchor, {
    targets, prisma: facade,
    allowedOverrides: ["../src/auth", "next/cache", "../src/server/require-role", "../src/server/finance/nbrb", "../src/server/plugins/events"],
    overrides: {
      "../src/auth": { auth: async () => ({ user: session.getStore()!.actor }) },
      "next/cache": { revalidatePath: (path: string) => cachePaths.push(path) },
      "../src/server/require-role": { requireFinance: async () => ({ user: session.getStore()!.actor }), requireAdmin: async () => ({ user: session.getStore()!.actor }), requireUser: async () => ({ user: session.getStore()!.actor }),
        requirePayrollManagement: async () => {
          const actor = session.getStore()!.actor;
          if (!hasAnyRole(actor.roles, PAYROLL_MANAGE_ROLES)) throw Error("Недостаточно прав");
          return { user: actor };
        },
        requireRole: async (roles: Role[]) => {
          const actor = session.getStore()!.actor;
          if (!hasAnyRole(actor.roles, roles)) throw Error("Недостаточно прав");
          return { user: actor };
        } },
      "../src/server/finance/nbrb": { isCurrency: (value: string) => ["BYN", "USD", "EUR", "RUB"].includes(value),
        getNbrbRate: async (currency: string) => { rateReads++; return { rate: currency === "USD" ? 3 : currency === "RUB" ? 0.03 : 1, date: new Date().toISOString().slice(0, 10) }; } },
      "../src/server/plugins/events": { dispatchEvent: async (id: string) => { dispatches.push(id); } },
    },
  });
  productCore = scope.load("../src/server/products/core"); projectStages = scope.load("../src/server/projects/stage-core"); economics = scope.load("../src/server/finance/queries");
  statements = scope.load("../src/server/finance/cash-statement"); workspaces = scope.load("../src/server/finance/project-workspace");
  stock = scope.load("../src/server/warehouse/accounting"); trips = scope.load("../src/server/logistics/core");
  logisticsDocuments = scope.load("../src/server/logistics/documents"); logisticsViews = scope.load("../src/server/logistics/query-core");
  logisticsHttp = scope.load("../src/server/logistics/http");
  purchase = scope.load("../src/server/warehouse/stock-purchase-core"); stockDeletion = scope.load("../src/server/warehouse/deletion-core");
  logistics = scope.load("../src/server/logistics/posting-core"); logisticsQueries = scope.load("../src/server/logistics/money-query-core");
  actions = scope.load("../src/server/payroll/actions"); payments = scope.load("../src/server/payments/service");
  paymentDelete = scope.load("../src/server/payments/delete-core"); ledger = scope.load("../src/server/finance/organization-ledger");
  statuses = scope.load("../src/server/products/status-core");
  productActions = scope.load("../src/server/products/actions");
  // Эти модули уже загружены дочерними real entrypoints и принадлежат тому же cache scope.
  cash = require("../src/server/payroll/cash-core"); service = require("../src/server/payroll/cash-service");
  payroll = require("../src/server/payroll/queries"); turnover = require("../src/server/payroll/turnover-core");
  paymentCore = require("../src/server/payments/core"); preparation = require("../src/server/payments/prepare");
  receipts = require("../src/server/payments/receipts"); direct = require("../src/server/product-percentage-pay/direct-completion");
});
after(async () => {
  if (fixture) try { await fixture.verifyProtected(); } finally { try { scope?.restore(); } finally { await fixture.dispose(); } }
});

async function cashContext(tx: Prisma.TransactionClient, rows: PostgresRows, amount = "1000") {
  const actor = actorFor(await rows.user("accountant", ["ACCOUNTANT"]));
  const employee = await rows.user("employee", ["WORKER"], { payScheme: "NONE" });
  const account = await tx.cashAccount.create({ data: { id: rows.id("cash"), name: "Касса169", currency: "BYN" } });
  await tx.payment.create({ data: { cashAccountId: account.id, direction: "INCOME", amount, bynAmount: amount, currency: "BYN" } });
  const input = { kind: "ADVANCE" as const, userId: employee.id, cashAccountId: account.id, cashAmount: "120.00",
    expectedCashCurrency: "BYN" as const, description: "Работа над шкафом", requestId: randomUUID() };
  return { actor, employee, account, input };
}
function observed(tx: Prisma.TransactionClient) {
  const calls: string[] = [];
  return { calls, tx: new Proxy(tx, { get(target, key) {
    const value: unknown = Reflect.get(target, key);
    if (typeof value === "function") return (...args: unknown[]) => { calls.push(String(key)); return Reflect.apply(value, target, args); };
    return value && typeof value === "object" ? new Proxy(value, { get(delegate, method) {
      const fn: unknown = Reflect.get(delegate, method);
      return typeof fn === "function" ? (...args: unknown[]) => { calls.push(`${String(key)}.${String(method)}`); return Reflect.apply(fn, delegate, args); } : fn;
    } }) : value;
  } }) };
}

test("cash/default-setting-roles-cas-audit-and-atomic-deactivation", async () => fixture.rollback(async (tx, rows) => {
  const actor = actorFor(await rows.user("default-cash-owner", ["PROCUREMENT"]));
  const account = await tx.cashAccount.create({ data: { id: rows.id("default-cash-rub"), name: "QA175 RUB", currency: "RUB" } });
  const other = await tx.cashAccount.create({ data: { id: rows.id("default-cash-byn"), name: "QA175 BYN", currency: "BYN" } });
  assert.ok(await verifyDefaultCashAccountNative(tx, actor, account.id, other.id));
}));

test("article/inline-option-codes-audit-and-no-money", async () => fixture.rollback(async (tx, rows) => {
  const actor = actorFor(await rows.user("inline-article-owner", ["PROCUREMENT"]));
  assert.ok(await verifyInlineExpenseArticleNative(tx, actor));
}));

test("material/inline-option-existing-unit-warehouse-role-audit-and-no-money", async () => fixture.rollback(async (tx, rows) => {
  const actor = actorFor(await rows.user("inline-material-owner", ["PROCUREMENT"]));
  assert.ok(await verifyInlineMaterialNative(tx, actor));
}));

test("cash/role-union-active-none-current-currencies-and-refusals", async () => fixture.rollback(async (tx, rows) => {
  const startingOrg = await savedOrgBalance(tx);
  const c = await cashContext(tx, rows), watched = observed(tx);
  for (const roles of [["MANAGER"], ["MANAGER", "ENGINEER"], ["ENGINEER"], ["WORKER"], ["MOUNTER"], ["ENGINEER", "WORKER"]] as Role[][])
    await assert.rejects(cash.issuePayoutCore({ ...c.actor, roles }, c.input, rates(), watched.tx), /прав/);
  await assert.rejects(cash.issuePayoutCore(c.actor, { ...c.input, description: " " }, rates(), watched.tx), /описание/);
  assert.equal(watched.calls.length, 0, "ROLE_AND_DESCRIPTION_BEFORE_SQL");
  const previousDay = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await assert.rejects(cash.issuePayoutCore(c.actor, c.input, { ...rates(), asOf: previousDay }, tx), /Дата расчёта/);
  for (const roles of [["ADMIN"], ["DIRECTOR"], ["PROCUREMENT"], ["ACCOUNTANT"], ["MANAGER", "ACCOUNTANT"]] as Role[][]) {
    const request = { ...c.input, requestId: randomUUID() };
    const result = await cash.issuePayoutCore({ ...c.actor, roles }, request, rates(), tx);
    assert.equal(result.cashAmount, "120.00");
    assert.equal((await tx.payout.findUniqueOrThrow({ where: { id: result.payoutId } })).comment, "Работа над шкафом");
  }
  assert.equal(await tx.payrollEntry.count({ where: { userId: c.employee.id } }), 0);
  assert.equal(await tx.payment.count({ where: { cashAccountId: c.account.id } }), 1);
  assert.equal((await cash.readCashBalance(tx, c.account.id)).toFixed(2), "400.00");
  const before = await money(tx);
  for (const field of ["employee", "account"] as const) {
    if (field === "employee") await tx.user.update({ where: { id: c.employee.id }, data: { active: false } });
    else await tx.cashAccount.update({ where: { id: c.account.id }, data: { active: false } });
    await assert.rejects(cash.issuePayoutCore(c.actor, { ...c.input, requestId: randomUUID() }, rates(), tx), /сотрудник|касса/);
    if (field === "employee") await tx.user.update({ where: { id: c.employee.id }, data: { active: true } });
    else await tx.cashAccount.update({ where: { id: c.account.id }, data: { active: true } });
  }
  await assert.rejects(cash.issuePayoutCore(c.actor, { ...c.input, cashAmount: "400.01", requestId: randomUUID() }, rates(), tx), /кассе/);
  const expense = startingOrg.plus("280.01");
  await tx.payment.create({ data: { direction: "EXPENSE", amount: expense, bynAmount: expense } });
  assert.equal((await cash.readOrgBalance(tx, "1")).toFixed(2), "119.99");
  await assert.rejects(cash.issuePayoutCore(c.actor, { ...c.input, requestId: randomUUID() }, rates(), tx), /организации/);
  assert.deepEqual((await money(tx)).slice(1), before.slice(1));
  await tx.cashAccount.update({ where: { id: c.account.id }, data: { currency: "USD" } });
  await assert.rejects(cash.issuePayoutCore(c.actor, { ...c.input, requestId: randomUUID() }, rates(), tx), /Валюта/);
  await assert.rejects(cash.issuePayoutCore(c.actor, { ...c.input, requestId: randomUUID() }, { ...rates(), cash: { ...rates().cash, currency: "USD", rate: "3.000000" } }, tx), /Валюта/);
  await rejectedSql(tx, () => tx.payout.create({ data: { userId: c.employee.id, month: "2020-01", amount: "1", kind: "ADVANCE", cashAccountId: c.account.id } }), /Payout_cash_fields_complete/);
}));

for (const mode of ["usd", "byn-fallback"] as const) test(`cash/operator-full-cycle-delete-bulk-recipients/${mode}`, async () => fixture.rollback(async (tx, rows) => {
  const [office, preferences, previousNotifications, previousMoney] = await Promise.all([
    tx.user.findMany({ where: { active: true, roles: { hasSome: ["ADMIN", "DIRECTOR", "ACCOUNTANT", "PROCUREMENT"] } } }),
    tx.notificationPreference.findMany({ where: { type: { in: ["payroll.orgPayout", "payroll.orgAdvance"] } } }),
    tx.notification.findMany({ orderBy: { id: "asc" } }), money(tx),
  ]);
  const c = await cashContext(tx, rows), procurement = actorFor(await rows.user("procurement", ["PROCUREMENT"]));
  const recipient = await rows.user("director", ["DIRECTOR"]), inactive = await rows.user("inactive", ["WORKER"], { active: false, payScheme: "NONE" });
  const usd = await tx.cashAccount.create({ data: { id: rows.id("usd"), name: "USD169", currency: "USD" } });
  await tx.payment.create({ data: { cashAccountId: mode === "usd" ? usd.id : c.account.id, amount: "1000", currency: mode === "usd" ? "USD" : "BYN", rate: mode === "usd" ? "3" : "1", bynAmount: mode === "usd" ? "3000" : "1000" } });
  const accrued = await tx.payrollEntry.create({ data: { userId: inactive.id, month: "2000-01", amount: "500", currency: "BYN", bynAmount: "500" } });
  const pairs: string[] = [], requests: CashPayoutInput[] = [c.input, { ...c.input, kind: "SALARY" as const, userId: inactive.id, cashAmount: "200.00", month: "2000-01", comment: "Работа169 зарплата", requestId: randomUUID() },
    { ...c.input, cashAmount: "10.00", requestId: randomUUID() }];
  if (mode === "usd") requests.push({ ...c.input, cashAccountId: usd.id, expectedCashCurrency: "USD", cashAmount: "50.00", requestId: randomUUID() });
  const actors = [procurement, c.actor, procurement, procurement];
  const outcomes: { payoutId: string; requestId: string }[] = [];
  for (const [index, request] of requests.entries()) {
    const actor = actors[index], result = await on(tx, actor, () => service.executeCashPayout(actor, request));
    assert.equal(result.ok, true); assert.equal(result.repeated, false); assert.ok(result.payoutId);
    outcomes.push({ payoutId: result.payoutId, requestId: request.requestId });
    if (request.userId === c.employee.id) pairs.push(`payroll.payout|${c.employee.id}`);
    const notificationType = request.kind === "ADVANCE" ? "payroll.orgAdvance" : "payroll.orgPayout";
    const notificationRoles = request.kind === "ADVANCE" ? ADVANCE_ROLES : PAYROLL_MANAGE_ROLES;
    const recipients = [...office, c.actor, procurement, recipient].filter(user => {
      const preference = preferences.find(pref => pref.userId === user.id && pref.type === notificationType) ??
        (request.kind === "ADVANCE" ? preferences.find(pref => pref.userId === user.id && pref.type === "payroll.orgPayout") : undefined);
      return hasAnyRole(user.roles, notificationRoles) && preference?.enabled !== false;
    });
    for (const user of recipients) if (user.id !== actor.id) pairs.push(`${notificationType}|${user.id}`);
    const entry = await tx.payout.findUniqueOrThrow({ where: { id: result.payoutId } });
    assert.equal(entry.cashAmount!.toFixed(2), request.cashAmount); assert.equal(entry.cashCurrency, request.expectedCashCurrency);
    assert.equal(entry.payrollCurrency, "BYN"); assert.equal(entry.bynAmount!.toFixed(2), index === 3 ? "150.00" : request.cashAmount);
    const receipt = await tx.changeLog.findUniqueOrThrow({ where: { id: `payout-issue:${request.requestId}` } });
    assert.equal(receipt.actorId, actor.id); assert.equal(receipt.entityId, entry.id); assert.equal(receipt.action, "issue");
  }
  const effectCounts = [await tx.notification.count(), await tx.domainEvent.count()];
  const rateCount = rateReads, repeated = await on(tx, procurement, () => service.executeCashPayout(procurement, requests[0]));
  assert.equal(repeated.payoutId, outcomes[0].payoutId); assert.equal(repeated.repeated, true); assert.equal(rateReads, rateCount);
  assert.deepEqual([await tx.notification.count(), await tx.domainEvent.count()], effectCounts);
  assert.equal((await on(tx, c.actor, () => actions.deletePayout(outcomes[2].payoutId))).ok, true);
  await assert.rejects(cash.issuePayoutCore(procurement, requests[2], rates(), tx), /отменена/);
  assert.equal(await tx.payout.count({ where: { userId: { in: [c.employee.id, inactive.id] } } }), mode === "usd" ? 3 : 2);
  assert.deepEqual(await tx.payrollEntry.findMany({ where: { userId: { in: [c.employee.id, inactive.id] } } }), [accrued]);
  const allNotifications = await tx.notification.findMany({ orderBy: { id: "asc" } });
  const notifications = allNotifications.filter(row => !previousNotifications.some(before => before.id === row.id));
  assert.deepEqual(notifications.map(row => `${row.type}|${row.userId}`).sort(), pairs.sort());
  assert.equal(allNotifications.length, previousNotifications.length + pairs.length);
  assert.deepEqual(allNotifications.filter(row => previousNotifications.some(before => before.id === row.id)), previousNotifications);
  assert.ok(notifications.every(row => ["/payroll", "/finance/payroll", "/finance/advances"].includes(row.link!)));
  assert.equal(await tx.changeLog.count({ where: { entity: "payout", action: "delete", actorId: c.actor.id, entityId: outcomes[2].payoutId } }), 1);
  const allEvents = await tx.domainEvent.findMany({ orderBy: { id: "asc" } });
  const events = allEvents.filter(row => !previousMoney[4].some(before => before.id === row.id));
  assert.equal(events.length, outcomes.length);
  assert.ok(events.every(row => row.type === "payroll.payout"));
  assert.deepEqual(allEvents.filter(row => previousMoney[4].some(before => before.id === row.id)), previousMoney[4]);
  assert.deepEqual(events.map(row => (row.payload as { payoutId: string }).payoutId).sort(), outcomes.map(row => row.payoutId).sort());
  assert.equal((await cash.readCashBalance(tx, c.account.id)).toFixed(2), mode === "usd" ? "680.00" : "1680.00");
  assert.equal((await cash.readCashBalance(tx, usd.id)).toFixed(2), mode === "usd" ? "950.00" : "0.00");
  assert.equal((await on(tx, c.actor, () => payroll.getEmployeeDues())).find(row => row.userId === inactive.id)?.due, 300);
  // Реальный bulk consumer погашает оставшиеся 300, хотя сотрудник inactive/NONE; новых начислений нет.
  const bulk = await on(tx, c.actor, () => actions.settleAll("2000-01", c.account.id));
  assert.equal(bulk.ok, true); assert.equal(bulk.paidCount, 1); assert.equal(bulk.totalPaid, 300);
  assert.deepEqual(await tx.payrollEntry.findMany({ where: { userId: inactive.id } }), [accrued]);
  const afterMoney = await money(tx);
  for (const [index, beforeRows] of previousMoney.entries())
    assert.deepEqual(afterMoney[index].filter(row => beforeRows.some(before => before.id === row.id)), beforeRows, "FOREIGN_CASH_ROWS_UNCHANGED");
}));

async function paymentContext(tx: Prisma.TransactionClient, rows: PostgresRows, projectLinked: boolean) {
  const c = await cashContext(tx, rows), project = projectLinked ? await rows.project("payment-project") : null;
  const code = ((await tx.expenseArticle.aggregate({ _max: { code: true } }))._max.code ?? 0) + 1;
  const article = await tx.expenseArticle.create({ data: { id: rows.id("article"), name: "Расход169", code } });
  const document = await tx.financeDocument.create({ data: { uploadedById: c.actor.id, clientMutationId: randomUUID(), requestFingerprint: "ci169",
    fileName: "Чек.pdf", mimeType: "application/pdf", size: 12, contentHash: "ci169", storageKey: rows.id("private-key"), storageMode: "s3", state: "READY", readyAt: new Date() } });
  const input: PaymentInput = { projectId: project?.id ?? null, direction: "EXPENSE", amount: 100, currency: "BYN", cashAccountId: c.account.id,
    expenseArticleId: article.id, reportDocumentId: document.id, clientMutationId: randomUUID(), comment: "Расход169" };
  const prepared = await preparation.preparePayment(input, tx);
  return { ...c, project, article, document, input, prepared };
}

for (const linked of [false, true]) test(`payment/report-owner-ready-context-replay-deleted/${linked ? "project" : "organization"}`, async () => fixture.rollback(async (tx, rows) => {
  const startingOrg = await savedOrgBalance(tx), originalMoney = await money(tx);
  const c = await paymentContext(tx, rows, linked), other = actorFor(await rows.user("other", ["PROCUREMENT"])), before = await money(tx);
  for (const change of [{ reportDocumentId: undefined }, { reportDocumentId: randomUUID() }])
    await assert.rejects(payments.createPaymentInTransaction(c.actor, { ...c.input, ...change }, c.prepared, tx), /документ/i);
  for (const forged of [{ skipReportDocument: true }, { source: "warehouse" }]) {
    const watched = observed(tx), input = { ...c.input, ...forged, clientMutationId: randomUUID() };
    await assert.rejects(payments.createPaymentInTransaction(c.actor, { ...input, reportDocumentId: undefined }, c.prepared, watched.tx), { message: "Прикрепите отчетный документ — без него расход создать нельзя" });
    assert.deepEqual(watched.calls, ["changeLog.findUnique"], "CLIENT_FLAGS_CANNOT_BYPASS_DOCUMENT_POLICY_OR_WRITE");
    watched.calls.length = 0;
    await assert.rejects(payments.createPaymentInTransaction(c.actor, input, c.prepared, watched.tx, { movementId: randomUUID() }), error => error instanceof Error && error.name === "ZodError");
    assert.equal(watched.calls.length, 0, "INTERNAL_CONTEXT_REJECTS_CLIENT_POLICY_FLAGS_BEFORE_SQL");
  }
  await assert.rejects(payments.createPaymentInTransaction(other, c.input, c.prepared, tx), /документ/i);
  await tx.financeDocument.update({ where: { id: c.document.id }, data: { state: "PENDING", readyAt: null } });
  const pending = await tx.financeDocument.findUniqueOrThrow({ where: { id: c.document.id }, include: { payment: true } });
  assert.equal(pending.state, "PENDING"); assert.equal(pending.payment, null);
  await assert.rejects(payments.createPaymentInTransaction(c.actor, c.input, c.prepared, tx), { message: "Отчётный документ недоступен или уже прикреплён к другой операции" });
  assert.deepEqual(await money(tx), before);
  await tx.financeDocument.update({ where: { id: c.document.id }, data: { state: "READY", readyAt: c.document.readyAt } });
  const ordinaryInput = { ...c.input, skipReportDocument: true, source: "warehouse" };
  const first = await payments.createPaymentInTransaction(c.actor, ordinaryInput, c.prepared, tx), saved = await money(tx);
  assert.equal(first.payment.logisticsAllocationId, null); assert.equal(await tx.stockMovement.count({ where: { createdById: c.actor.id } }), 0);
  const request = await tx.changeLog.findUniqueOrThrow({ where: { id: receipts.paymentReceiptId(c.input.clientMutationId) } });
  assert.deepEqual(request.newValue, { fingerprint: receipts.paymentFingerprint(c.actor.id, c.input) });
  const repeated = await payments.createPaymentInTransaction(c.actor, c.input, c.prepared, tx);
  assert.equal(repeated.repeated, true); assert.equal(repeated.payment.id, first.payment.id); assert.equal(repeated.eventId, null);
  assert.deepEqual(await money(tx), saved); assert.equal(first.payment.reportDocumentId, c.document.id);
  assert.equal(first.payment.projectId, c.project?.id ?? null); assert.equal(first.payment.projectAmount?.toFixed(2) ?? null, linked ? "100.00" : null);
  const view = await ledger.loadOrganizationPayments(c.actor, "EXPENSE", tx), visible = view.rows.find(row => row.id === first.payment.id)!;
  assert.equal(visible.bynAmount, 100); assert.equal(visible.reportDocument?.id, c.document.id); assert.ok(!JSON.stringify(view).includes(c.document.storageKey));
  assert.equal((await cash.readCashBalance(tx, c.account.id)).toFixed(2), "900.00");
  assert.equal((await cash.readOrgBalance(tx, "1")).minus(startingOrg).toFixed(2), "900.00");
  assert.equal(await tx.domainEvent.count({ where: { actor: c.actor.id, type: "expense.created" } }), 1);
  for (const [actor, input, pattern] of [[c.actor, { ...c.input, comment: "changed" }, /другими данными/], [other, c.input, /другими данными/],
    [c.actor, { ...c.input, clientMutationId: randomUUID() }, /документ/i]] as const)
    await assert.rejects(payments.createPaymentInTransaction(actor, input, c.prepared, tx), pattern);
  await tx.payment.delete({ where: { id: first.payment.id } });
  await assert.rejects(payments.createPaymentInTransaction(c.actor, c.input, c.prepared, tx), /удалена/);
  const legacyInput = { ...c.input, reportDocumentId: undefined, clientMutationId: randomUUID() };
  const historical = await tx.payment.create({ data: { projectId: c.project?.id, projectAmount: linked ? "100" : null, direction: "EXPENSE", amount: "100",
    bynAmount: "100", currency: "BYN", cashAccountId: c.account.id, expenseArticleId: c.article.id, createdById: c.actor.id } });
  await receipts.recordPaymentReceipt(c.actor, legacyInput, historical.id, tx);
  assert.equal((await payments.createPaymentInTransaction(c.actor, legacyInput, c.prepared, tx)).payment.id, historical.id);
  await rejectedSql(tx, () => tx.payment.create({ data: { amount: "1", bynAmount: "1", projectAmount: "1", projectId: null } }), /Payment_project_context_check/);
  // Последний receipt сталкивается с реально существующим PK после Payment/audit/outbox: откат всех записей.
  const snapshot = await money(tx);
  // receipt ID берём из фактического первого запроса, без знания внутреннего префикса.
  const oldReceipt = await tx.changeLog.findFirstOrThrow({ where: { action: "request", entityId: first.payment.id } });
  const collision = new Proxy(tx, { get(target, key) {
    if (key !== "changeLog") return Reflect.get(target, key);
    return new Proxy(tx.changeLog, { get(model, method) { return method === "create" ? (args: Prisma.ChangeLogCreateArgs) => model.create(args.data.action === "request" ? { ...args, data: { ...args.data, id: oldReceipt.id } } : args) : Reflect.get(model, method); } });
  } });
  await rejectedSql(tx, () => payments.createPaymentInTransaction(c.actor, { ...c.input, clientMutationId: randomUUID() }, c.prepared, collision), /Unique constraint/);
  assert.deepEqual(await money(tx), snapshot, "PAYMENT_RECEIPT_SQL_FAILURE_ROLLS_BACK_ALL_MONEY_AUDIT_OUTBOX");
  const finalMoney = await money(tx);
  for (const [index, beforeRows] of originalMoney.entries())
    assert.deepEqual(finalMoney[index].filter(row => beforeRows.some(before => before.id === row.id)), beforeRows, "FOREIGN_PAYMENT_ROWS_UNCHANGED");
}));

test("payment/foreign-preflight-decimal-snapshots-article-fences-and-delete-caps", async () => fixture.rollback(async (tx, rows) => {
  const c = await paymentContext(tx, rows, true), usd = await tx.cashAccount.create({ data: { name: "USD169", currency: "USD" } });
  await tx.payment.create({ data: { cashAccountId: usd.id, amount: "1000", currency: "USD", bynAmount: "3000", rate: "3" } });
  const input = { ...c.input, direction: "INCOME" as const, expenseArticleId: undefined, reportDocumentId: undefined, cashAccountId: usd.id, currency: "USD" };
  await tx.project.update({ where: { id: c.project!.id }, data: { currency: "USD" } });
  for (const direction of ["INCOME", "EXPENSE"] as const) {
    const read = observed(tx), priorRates = rateReads;
    const result = await on(read.tx, c.actor, () => payments.createPaymentCore(c.actor, { ...c.input, direction, cashAccountId: usd.id, currency: "USD", clientMutationId: randomUUID(),
      ...(direction === "INCOME" ? { expenseArticleId: undefined, reportDocumentId: undefined } : {}) }));
    assert.equal(result.ok, false); assert.match(result.error ?? "", /BYN/); assert.equal(rateReads, priorRates);
    assert.ok(!read.calls.some(call => /cashAccount|\.create/.test(call)));
  }
  await tx.project.update({ where: { id: c.project!.id }, data: { currency: "BYN" } });
  for (const projectId of [null, c.project!.id]) {
    const watched = observed(tx), rateCount = rateReads;
    const invalid = await on(watched.tx, c.actor, () => payments.createPaymentCore(c.actor, { ...input, projectId, expenseArticleId: c.article.id, clientMutationId: randomUUID() }));
    assert.equal(invalid.ok, false); assert.equal(watched.calls.length, 0); assert.equal(rateReads, rateCount);
    const success = await on(watched.tx, c.actor, () => payments.createPaymentCore(c.actor, { ...input, projectId, clientMutationId: randomUUID() }));
    assert.equal(success.ok, true); assert.equal(rateReads, rateCount + 1);
    if (projectId === null) assert.ok(!watched.calls.some(call => call.startsWith("project.")));
    const row = await tx.payment.findUniqueOrThrow({ where: { id: success.paymentId! } });
    assert.equal(row.amount.toFixed(2), "100.00"); assert.equal(row.currency, "USD"); assert.equal(row.rate!.toString(), "3"); assert.equal(row.bynAmount.toFixed(2), "300.00"); assert.equal(row.expenseArticleId, null);
    assert.equal(row.projectAmount?.toFixed(2) ?? null, projectId ? "300.00" : null);
  }
  const fractionRates = rateReads;
  const fraction = await on(tx, c.actor, () => payments.createPaymentCore(c.actor, { ...input, amount: 0.05, rate: 0.7, clientMutationId: randomUUID() }));
  assert.equal(fraction.ok, true); assert.equal(rateReads, fractionRates);
  const rounded = await tx.payment.findUniqueOrThrow({ where: { id: fraction.paymentId! } });
  assert.equal(rounded.amount.toFixed(2), "0.05"); assert.equal(rounded.rate.toString(), "0.7"); assert.equal(rounded.bynAmount.toFixed(2), "0.04"); assert.equal(rounded.projectAmount!.toFixed(2), "0.04");
  const expenseWatch = observed(tx), priorRates = rateReads;
  const expenseResult = await on(expenseWatch.tx, c.actor, () => payments.createPaymentCore(c.actor, { ...c.input, cashAccountId: usd.id, currency: "USD", clientMutationId: randomUUID() }));
  assert.equal(expenseResult.ok, true); assert.equal(rateReads, priorRates + 1); assert.ok(!expenseWatch.calls.some(call => call.startsWith("orgSetting.")));
  const expenseRow = await tx.payment.findUniqueOrThrow({ where: { id: expenseResult.paymentId! } });
  assert.equal(expenseRow.currency, "USD"); assert.equal(expenseRow.amount.toFixed(2), "100.00"); assert.equal(expenseRow.bynAmount.toFixed(2), "300.00");
  assert.equal(expenseWatch.calls.filter(call => call === "payment.create").length, 1);
  await rejectedSql(tx, async () => {
    const org = await cash.readOrgBalance(tx, "1");
    await tx.payment.create({ data: { direction: "EXPENSE", amount: org.minus(200), bynAmount: org.minus(200), currency: "BYN" } });
    const report = await tx.financeDocument.create({ data: { uploadedById: c.actor.id, clientMutationId: randomUUID(), requestFingerprint: "cap169",
      fileName: "Чек.pdf", mimeType: "application/pdf", size: 4, contentHash: "cap169", storageKey: rows.id("cap-report"), storageMode: "s3", state: "READY", readyAt: new Date() } });
    const before = await money(tx);
    const denied = await on(tx, c.actor, () => payments.createPaymentCore(c.actor, { ...c.input, cashAccountId: usd.id, currency: "USD", reportDocumentId: report.id, clientMutationId: randomUUID() }));
    assert.equal(denied.ok, false); assert.match(denied.error ?? "", /балансе организации/); assert.deepEqual(await money(tx), before);
    throw Error("EXPECTED_USD_ORG_CAP");
  }, /EXPECTED_USD_ORG_CAP/);
  const { id: priorDocumentId, ...documentFields } = c.document;
  const articleDocument = await tx.financeDocument.create({ data: { ...documentFields, clientMutationId: randomUUID(), storageKey: rows.id("article-fence-document") } });
  assert.notEqual(articleDocument.id, priorDocumentId); assert.equal(articleDocument.state, "READY");
  assert.equal(await tx.payment.count({ where: { reportDocumentId: articleDocument.id } }), 0);
  c.input.reportDocumentId = articleDocument.id;
  const prepared = await preparation.preparePayment(c.input, tx), baseline = await money(tx);
  const forgedIncome = observed(tx);
  await assert.rejects(payments.createPaymentInTransaction(c.actor, { ...c.input, direction: "INCOME", expenseArticleId: c.article.id, reportDocumentId: undefined }, { ...prepared, articleId: c.article.id }, forgedIncome.tx), /стать/i);
  assert.equal(forgedIncome.calls.length, 0, "FORGED_INCOME_ARTICLE_REFUSED_BEFORE_SQL");
  for (const [supplied, expected] of [[undefined, c.article.id], [c.article.id, null], [rows.id("missing"), c.article.id]] as const)
    await assert.rejects(payments.createPaymentInTransaction(c.actor, { ...c.input, expenseArticleId: supplied }, { ...prepared, articleId: expected }, tx), /стат/);
  await tx.expenseArticle.update({ where: { id: c.article.id }, data: { active: false } });
  await assert.rejects(payments.createPaymentInTransaction(c.actor, c.input, prepared, tx), /Реквизиты платежа/);
  assert.deepEqual(await money(tx), baseline);
  const income = await tx.payment.create({ data: { cashAccountId: c.account.id, amount: "100", bynAmount: "100" } });
  await assert.rejects(paymentDelete.deletePaymentInTransaction({ ...c.actor, roles: ["MANAGER"] }, income.id, "INCOME", "BYN", "1", tx), /прав/);
  const spent = await tx.payment.create({ data: { cashAccountId: c.account.id, direction: "EXPENSE", amount: "1000.01", bynAmount: "1000.01" } });
  await assert.rejects(paymentDelete.deletePaymentInTransaction(c.actor, income.id, "INCOME", "BYN", "1", tx), /остаток кассы/);
  await tx.payment.delete({ where: { id: spent.id } });
  assert.equal((await paymentDelete.deletePaymentInTransaction(c.actor, income.id, "INCOME", "BYN", "1", tx)).id, income.id);
  const audit = await tx.changeLog.findFirstOrThrow({ where: { entity: "payment", entityId: income.id, action: "delete" } });
  assert.equal((audit.oldValue as { project: unknown }).project, null);
  assert.equal(await tx.changeLog.count({ where: { entity: "payment", entityId: income.id, action: "delete" } }), 1);
  const archived = await tx.payment.create({ data: { projectId: c.project!.id, projectAmount: "1", direction: "EXPENSE", amount: "1", bynAmount: "1" } });
  await tx.project.update({ where: { id: c.project!.id }, data: { deletedAt: new Date() } });
  await assert.rejects(paymentDelete.deletePaymentInTransaction(c.actor, archived.id, "EXPENSE", "BYN", "1", tx), /только для просмотра/);
}));

test("payment/scenario-minimal-effects-replay-skips-fx", async () => fixture.rollback(async (tx, rows) => {
  const c = await cashContext(tx, rows), input: PaymentInput = { direction: "INCOME", cashAccountId: c.account.id, amount: 100, currency: "BYN", comment: "own", clientMutationId: randomUUID() };
  let prepared = 0;
  const deps = { reader: tx, transaction: async <T>(operation: (inner: Prisma.TransactionClient) => Promise<T>) => operation(tx),
    prepare: async (data: PaymentInput) => { prepared++; assert.equal(prepared, 1); return preparation.preparePayment(data, tx); } };
  const first = await paymentCore.createPaymentScenario(c.actor, input, deps);
  assert.equal(first.ack.ok, true);
  assert.deepEqual(first.effects, { paymentId: first.ack.paymentId, eventId: (await tx.domainEvent.findFirstOrThrow({ where: { actor: c.actor.id } })).id,
    actorId: c.actor.id, project: null, direction: "INCOME", amount: 100, currency: "BYN", comment: "own" });
  assert.deepEqual(await paymentCore.createPaymentScenario(c.actor, input, deps), { ack: { ...first.ack, replayed: true } });
  assert.equal(prepared, 1); assert.equal(await tx.changeLog.count({ where: { actorId: c.actor.id } }), 2);
}));

for (const currency of ["BYN", "USD"] as const) test(`warehouse/paid-receipt-cascade-delete-history-and-rollback/${currency}`, async () => fixture.rollback(async (tx, rows) => {
  const originalMoney = await money(tx), c = await cashContext(tx, rows, "10000");
  const actor = actorFor(await rows.user("stock-admin", ["ADMIN"]));
  const state = await tx.warehouseAccountingState.upsert({ where: { id: "main" },
    create: { id: "main", phase: "ACTIVE", runId: rows.id("stock-run"), beforePrices: [], beforeBalances: [] }, update: {} });
  assert.equal(state.phase, "ACTIVE", "CI_WAREHOUSE_PHASE_MISMATCH");
  const unit = await tx.materialUnit.create({ data: { name: rows.id("stock-unit") } });
  const material = await tx.material.create({ data: { name: rows.id("stock-material"), unitId: unit.id } });
  const project = await rows.project("stock-project"), product = await rows.product("stock-product", project.id, { status: "PRODUCTION" });
  const article = await tx.expenseArticle.create({ data: { name: rows.id("stock-article"), code: ((await tx.expenseArticle.aggregate({ _max: { code: true } }))._max.code ?? 0) + 1 } });
  const account = currency === "BYN" ? c.account : await tx.cashAccount.create({ data: { name: rows.id("stock-usd"), currency } });
  if (currency === "USD") await tx.payment.create({ data: { cashAccountId: account.id, amount: "10000", currency, bynAmount: "30010", rate: "3.001" } });
  const document = await tx.financeDocument.create({ data: { uploadedById: actor.id, clientMutationId: randomUUID(), requestFingerprint: rows.id("stock-report"),
    fileName: "Чек.pdf", mimeType: "application/pdf", size: 4, contentHash: rows.id("stock-report"), storageKey: rows.id("stock-report"), storageMode: "s3", state: "READY", readyAt: new Date() } });
  const data = { clientMutationId: randomUUID(), materialId: material.id, quantity: currency === "BYN" ? "37" : "3", unitPrice: currency === "BYN" ? "100" : "7.33",
    currency, cashAccountId: account.id, expenseArticleId: article.id, ...(currency === "USD" ? { rate: 3.001, reportDocumentId: document.id } : {}) };
  const prepared = (await purchase.prepareStockPurchase(actor, data, tx, async () => assert.fail("UNEXPECTED_NETWORK_FX"))).prepared;
  if (currency === "BYN") {
    const old = stockPurchaseSchema.parse(data);
    const fingerprint = createHash("sha256").update(JSON.stringify({ actorId: actor.id, materialId: old.materialId, quantity: old.quantity, unitPrice: old.unitPrice, currency: old.currency, cashAccountId: old.cashAccountId, expenseArticleId: old.expenseArticleId,
      rate: null, rateDate: null, paidAt: null, comment: old.comment ?? null })).digest("hex");
    assert.equal(purchase.stockPurchaseFingerprint(actor.id, old), fingerprint, "LEGACY_RECEIPT_FINGERPRINT_PROFILE");
  }
  const baseline = await nativeSnapshot(tx);
  await tx.$executeRawUnsafe("CREATE FUNCTION ci169_purchase_failure() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'CI169_PURCHASE_FAILURE'; END; $$ LANGUAGE plpgsql");
  await tx.$executeRawUnsafe('CREATE TRIGGER ci169_purchase_failure BEFORE INSERT ON "StockPurchase" FOR EACH ROW EXECUTE FUNCTION ci169_purchase_failure()');
  const faultBaseline = await nativeSnapshot(tx);
  await rejectedSql(tx, () => purchase.createStockPurchaseInTransaction(actor, data, prepared, tx), /CI169_PURCHASE_FAILURE/);
  assert.deepEqual(await nativeSnapshot(tx), faultBaseline, "PURCHASE_LAST_WRITE_SQL_ROLLBACK");
  await tx.$executeRawUnsafe('DROP TRIGGER ci169_purchase_failure ON "StockPurchase"'); await tx.$executeRawUnsafe("DROP FUNCTION ci169_purchase_failure()");
  assert.deepEqual(await nativeSnapshot(tx), baseline);
  const beforeCash = await cash.readCashBalance(tx, account.id), beforeOrg = await cash.readOrgBalance(tx, "1");
  const first = await purchase.createStockPurchaseInTransaction(actor, data, prepared, tx), receipt = first.receipt;
  const expectedByn = currency === "BYN" ? "3700.00" : "65.99", expectedAmount = currency === "BYN" ? "3700.00" : "21.99";
  assert.equal(receipt.movement.receiptKind, "PAID"); assert.equal(receipt.payment.projectId, null); assert.equal(receipt.payment.projectAmount, null);
  assert.equal(receipt.payment.amount.toFixed(2), expectedAmount); assert.equal(receipt.payment.bynAmount.toFixed(2), expectedByn);
  assert.equal(receipt.movement.totalByn!.toFixed(2), expectedByn); assert.equal(receipt.payment.reportDocumentId, currency === "USD" ? document.id : null);
  const valuation = await tx.warehouseMovementValuation.findUniqueOrThrow({ where: { movementId: receipt.movementId } });
  assert.equal(valuation.valueByn.toFixed(9), currency === "USD" ? "65.990000000" : "3700.000000000");
  assert.equal(valuation.unitCost.toFixed(9), currency === "USD" ? "21.996666667" : "100.000000000");
  assert.equal((await cash.readCashBalance(tx, account.id)).toFixed(2), beforeCash.minus(expectedAmount).toFixed(2));
  const repeat = await purchase.createStockPurchaseInTransaction(actor, data, { ...prepared, rate: 999, bynAmount: 999 }, tx);
  assert.equal(repeat.receipt.id, receipt.id); assert.equal(repeat.repeated, true); assert.deepEqual(repeat.eventIds, []);
  await assert.rejects(purchase.createStockPurchaseInTransaction(actor, { ...data, unitPrice: "101" }, prepared, tx), /другими данными/);
  await assert.rejects(purchase.prepareStockPurchase({ ...actor, roles: ["MANAGER"] }, data, tx), /прав/);
  const visible = (await ledger.loadOrganizationPayments(actor, "EXPENSE", tx)).rows.find(row => row.id === receipt.paymentId);
  assert.equal(visible?.stockPurchase?.movementId, receipt.movementId); assert.ok(!JSON.stringify(visible).includes(receipt.requestFingerprint));
  assert.equal(visible!.stockPurchase!.stockValueByn, Number(expectedByn));
  if (currency === "USD") {
    await assert.rejects(purchase.createStockPurchaseInTransaction(actor, { ...data, reportDocumentId: undefined }, prepared, tx), /другими данными/);
    for (const mode of ["missing", "pending", "owner", "linked"] as const) {
      const invalid = mode === "pending" || mode === "owner" ? await tx.financeDocument.create({ data: { uploadedById: mode === "owner" ? c.actor.id : actor.id, clientMutationId: randomUUID(), requestFingerprint: rows.id(`paid-doc-${mode}`),
        fileName: "Чек.pdf", mimeType: "application/pdf", size: 4, contentHash: "test", storageKey: rows.id(`paid-doc-${mode}`), storageMode: "s3", state: mode === "pending" ? "PENDING" : "READY", readyAt: mode === "pending" ? null : new Date() } }) : null;
      const beforeDocument = await nativeSnapshot(tx);
      await rejectedSql(tx, () => purchase.createStockPurchaseInTransaction(actor, { ...data, clientMutationId: randomUUID(), reportDocumentId: mode === "missing" ? randomUUID() : mode === "linked" ? document.id : invalid!.id }, prepared, tx), /документ/i);
      assert.deepEqual(await nativeSnapshot(tx), beforeDocument, "COMPOSITE_DOCUMENT_DENIAL_ROLLS_BACK_WAREHOUSE_MONEY_AUDIT_OUTBOX");
    }
  }
  await assert.rejects(paymentDelete.deletePaymentInTransaction(actor, receipt.paymentId, "EXPENSE", currency, "1", tx), /связан/);
  await rejectedSql(tx, () => tx.payment.delete({ where: { id: receipt.paymentId } }), /constraint/i);
  const line = await tx.projectMaterial.create({ data: { productId: product.id, materialId: material.id, quantity: "40", quantityPerUnit: "40" } });
  const issued = await stock.warehouseMove(tx, actor, { kind: "EXPENSE", projectMaterialId: line.id, quantity: currency === "BYN" ? "10" : "1", clientMutationId: randomUUID() });
  const returned = await stock.warehouseMove(tx, actor, { kind: "RETURN", projectMaterialId: line.id, sourceMovementId: issued.movement.id,
    quantity: currency === "BYN" ? "3" : "0.3", clientMutationId: randomUUID() });
  await tx.$executeRawUnsafe("SAVEPOINT ci169_project_expenses");
  try {
    await tx.product.update({ where: { id: product.id }, data: { description: "PRIVATE_TECH_FINANCE", quantity: 1, expectedPrice: "1000" } });
    await tx.payment.create({ data: { projectId: project.id, projectAmount: "10", amount: "10", bynAmount: "10", direction: "EXPENSE", expenseArticleId: article.id, createdById: actor.id } });
    const read = (viewer = c.actor) => workspaces.loadFinanceProjectWorkspace(viewer, project.id, tx, (id, facts) => economics.getProjectEconomics(id, tx, facts));
    const beforeRead = await money(tx), view = await read(), expectedStock = currency === "BYN" ? 700 : 15.4;
    assert.equal(view!.expenseRows.length, 3); assert.equal(view!.economics.expensesTotal, expectedStock + 10);
    assert.equal(view!.economics.marginAtFullPrice, 990 - expectedStock);
    assert.equal(view!.economics.expenseBreakdown.find(row => row.key === "warehouse")!.amount, expectedStock);
    assert.equal(view!.expenseRows.find(row => row.source === "WAREHOUSE_ISSUE")!.stock!.unitPrice, valuation.unitCost.toString());
    assert.equal(JSON.stringify(view).includes("PRIVATE_TECH_FINANCE"), false); assert.deepEqual(await money(tx), beforeRead);
    const denied = observed(tx);
    await assert.rejects(workspaces.loadFinanceProjectWorkspace({ ...c.actor, roles: ["MANAGER"] }, project.id, denied.tx, () => { throw Error("UNEXPECTED_ECONOMICS"); }), /прав/);
    assert.equal(denied.calls.length, 0);
    await tx.product.update({ where: { id: product.id }, data: { status: "DRAFT" } });
    for (const roles of [["ACCOUNTANT"], ["MANAGER", "ACCOUNTANT"]] as Role[][]) {
      const hidden = await read({ ...c.actor, roles });
      assert.equal(hidden!.economics.expensesTotal, expectedStock + 10); assert.ok(hidden!.expenseRows.filter(row => row.stock).every(row => row.stock!.product === null));
    }
    assert.ok((await read(actor))!.expenseRows.some(row => row.stock?.product?.id === product.id));
    await tx.product.update({ where: { id: product.id }, data: { status: "PRODUCTION" } });
    const completeReturn = { kind: "RETURN" as const, projectMaterialId: line.id, sourceMovementId: issued.movement.id, quantity: currency === "BYN" ? "7" : "0.7", clientMutationId: randomUUID() };
    await stock.warehouseMove(tx, actor, completeReturn); const full = await read();
    assert.equal(full!.economics.expensesTotal, 10); assert.equal(full!.expenseRows.length, 4);
    const completedRows = full!.expenseRows; assert.equal((await stock.warehouseMove(tx, actor, completeReturn)).repeated, true);
    assert.deepEqual((await read())!.expenseRows, completedRows);
    await tx.stockMovement.create({ data: { materialId: material.id, productId: product.id, type: "EXPENSE", quantity: "1", totalByn: null } });
    const unknown = await read(); assert.equal(unknown!.economics.expensesTotal, null); assert.equal(unknown!.expenseRows.filter(row => row.bynAmount === null).length, 1);
  } finally { await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT ci169_project_expenses"); await tx.$executeRawUnsafe("RELEASE SAVEPOINT ci169_project_expenses"); }
  const independent = await stock.warehouseMove(tx, actor, { kind: "INCOME", materialId: material.id, quantity: "5", unitPrice: "200", clientMutationId: randomUUID() });
  if (currency === "BYN") for (const leaf of [returned.movement, issued.movement]) {
    await tx.$executeRawUnsafe("SAVEPOINT ci169_stock_leaf");
    try {
      const leafPreview = await stockDeletion.previewMovementDeletionInTransaction(tx, actor, leaf.id);
      assert.deepEqual(leafPreview.refunds, []);
      await stockDeletion.deleteMovementInTransaction(tx, actor, { clientMutationId: randomUUID(), movementId: leaf.id, planFingerprint: leafPreview.planFingerprint });
      const position = await tx.warehouseBalance.findUniqueOrThrow({ where: { materialId: material.id } });
      assert.equal(position.quantity.toString(), leaf.type === "RETURN" ? "32" : "42"); assert.equal(position.valueByn.toFixed(2), leaf.type === "RETURN" ? "3700.00" : "4700.00");
      assert.equal((await cash.readCashBalance(tx, account.id)).toFixed(2), "6300.00");
      assert.equal((await tx.payment.findUniqueOrThrow({ where: { id: receipt.paymentId } })).deletionId, null);
      assert.equal((await tx.projectMaterial.findUniqueOrThrow({ where: { id: line.id } })).issuedQty.toString(), leaf.type === "RETURN" ? "10" : "0");
      assert.equal((await economics.getProjectEconomics(project.id, tx))!.expensesTotal, leaf.type === "RETURN" ? 1000 : 0);
    } finally { await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT ci169_stock_leaf"); await tx.$executeRawUnsafe("RELEASE SAVEPOINT ci169_stock_leaf"); }
  }
  const preview = await stockDeletion.previewMovementDeletionInTransaction(tx, actor, receipt.movementId);
  assert.deepEqual(new Set(preview.movements.map(row => row.id)), new Set([receipt.movementId, issued.movement.id, returned.movement.id]));
  assert.equal(preview.refunds[0].amount, expectedAmount); assert.equal(preview.refunds[0].bynAmount, expectedByn);
  for (const role of ["DIRECTOR", "ACCOUNTANT", "PROCUREMENT", "MANAGER"] as const)
    await assert.rejects(stockDeletion.previewMovementDeletionInTransaction(tx, { ...actor, roles: [role] }, receipt.movementId), /администратор/);
  await tx.user.update({ where: { id: actor.id }, data: { roles: ["PROCUREMENT"] } });
  await assert.rejects(stockDeletion.previewMovementDeletionInTransaction(tx, actor, receipt.movementId), /администратор/);
  await tx.user.update({ where: { id: actor.id }, data: { roles: ["ADMIN"] } });
  const input = { clientMutationId: randomUUID(), movementId: receipt.movementId, planFingerprint: preview.planFingerprint };
  await assert.rejects(stockDeletion.deleteMovementInTransaction(tx, actor, { ...input, planFingerprint: "f".repeat(64) }), /изменились/);
  await tx.$executeRawUnsafe("CREATE FUNCTION ci169_delete_failure() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'CI169_DELETE_FAILURE'; END; $$ LANGUAGE plpgsql");
  await tx.$executeRawUnsafe('CREATE TRIGGER ci169_delete_failure BEFORE INSERT ON "DomainEvent" FOR EACH ROW WHEN (NEW.type=\'stock.movement.deleted\') EXECUTE FUNCTION ci169_delete_failure()');
  const deleteBaseline = await nativeSnapshot(tx);
  await rejectedSql(tx, () => stockDeletion.deleteMovementInTransaction(tx, actor, input), /CI169_DELETE_FAILURE/);
  assert.deepEqual(await nativeSnapshot(tx), deleteBaseline, "SOFT_DELETE_LAST_WRITE_SQL_ROLLBACK");
  await tx.$executeRawUnsafe('DROP TRIGGER ci169_delete_failure ON "DomainEvent"'); await tx.$executeRawUnsafe("DROP FUNCTION ci169_delete_failure()");
  const deleted = await stockDeletion.deleteMovementInTransaction(tx, actor, input);
  assert.equal((await stockDeletion.deleteMovementInTransaction(tx, actor, input)).repeated, true);
  await assert.rejects(stockDeletion.deleteMovementInTransaction(tx, actor, { ...input, planFingerprint: "f".repeat(64) }), /другими данными/);
  assert.equal((await tx.payment.findUniqueOrThrow({ where: { id: receipt.paymentId } })).deletionId, deleted.id);
  assert.equal((await tx.stockMovement.findUniqueOrThrow({ where: { id: independent.movement.id } })).deletionId, null);
  const balance = await tx.warehouseBalance.findUniqueOrThrow({ where: { materialId: material.id } });
  assert.equal(balance.quantity.toString(), "5"); assert.equal(balance.valueByn.toFixed(2), "1000.00");
  assert.equal((await tx.projectMaterial.findUniqueOrThrow({ where: { id: line.id } })).issuedQty.toString(), "0");
  assert.equal((await cash.readCashBalance(tx, account.id)).toFixed(2), beforeCash.toFixed(2)); assert.equal((await cash.readOrgBalance(tx, "1")).toFixed(2), beforeOrg.toFixed(2));
  assert.ok(!(await ledger.loadOrganizationPayments(actor, "EXPENSE", tx)).rows.some(row => row.id === receipt.paymentId));
  const cancelledStatement = await statements.loadCashStatement(actor, { from: "2000-01-01", to: "2099-12-31", mode: "NATIVE" }, tx);
  const cancelledCash = cancelledStatement.rows.find(row => row.id === account.id)!;
  assert.ok(!cancelledCash.entries.some(row => row.id === `payment:${receipt.paymentId}`));
  assert.equal(cancelledCash.totals.closing, beforeCash.toFixed(2));
  await assert.rejects(purchase.createStockPurchaseInTransaction(actor, data, prepared, tx), /удалён/);
  await assert.rejects(stock.warehouseMove(tx, actor, { kind: "RETURN", productId: product.id, sourceMovementId: issued.movement.id, quantity: "1", clientMutationId: randomUUID() }), /Исходная выдача/);
  const finalMoney = await money(tx);
  for (const [index, before] of originalMoney.entries()) assert.deepEqual(finalMoney[index].filter(row => before.some(old => old.id === row.id)), before, "FOREIGN_STOCK_MONEY_UNCHANGED");
}));

test("logistics/real-posting-correction-CAS-history-budget-and-SQL-rollback", async () => fixture.rollback(async (tx, rows) => {
  const originalMoney = await money(tx), c = await cashContext(tx, rows, "5000"), actor = actorFor(await rows.user("logistics-procurement", ["PROCUREMENT"]));
  const a = await rows.project("logistics-a", { delivery: "700" }), b = await rows.project("logistics-b", { delivery: "1000" });
  const report = await tx.financeDocument.create({ data: { clientMutationId: randomUUID(), requestFingerprint: rows.id("ordinary-report"), uploadedById: actor.id,
    fileName: "Отчёт.pdf", mimeType: "application/pdf", size: 3, contentHash: "f".repeat(64), storageKey: rows.id("ordinary-report"), storageMode: "s3", state: "READY", readyAt: new Date() } });
  const article = await tx.expenseArticle.create({ data: { name: rows.id("ordinary-article"), code: ((await tx.expenseArticle.aggregate({ _max: { code: true } }))._max.code ?? 0) + 1 } });
  const ordinary = { direction: "EXPENSE" as const, projectId: a.id, amount: 50, currency: "BYN" as const, cashAccountId: c.account.id,
    expenseArticleId: article.id, reportDocumentId: report.id, clientMutationId: randomUUID() };
  await paymentCore.createPaymentInTransaction(actor, ordinary, await preparation.preparePayment(ordinary, tx), tx);
  const products = [await rows.product("logistics-a", a.id, { status: "PRODUCTION" }), await rows.product("logistics-b", b.id, { status: "PRODUCTION" })];
  let savepoint = 0;
  const transaction = async <T>(operation: (db: Prisma.TransactionClient) => Promise<T>) => {
    const name = `logistics169_${++savepoint}`; await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
    try { await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)`;
      const result = await operation(tx); await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE"); await tx.$executeRawUnsafe("SET CONSTRAINTS ALL DEFERRED");
      await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`); return result;
    } catch (error) { await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`); await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`); throw error; }
  };
  const manifest = { date: "2026-10-10", comment: "Рейс169", shares: [{ projectId: a.id, percentBps: 4000 }, { projectId: b.id, percentBps: 6000 }],
    lines: products.map(product => ({ projectId: product.projectId, kind: "PRODUCT" as const, productId: product.id, quantity: 2 })) };
  const draft = await rows.product("logistics-draft", a.id, { status: "DRAFT" }), admin = await rows.user("logistics-admin", ["ADMIN"]);
  const draftInput = { date: manifest.date, shares: [{ projectId: a.id, percentBps: 10000 }], lines: [{ projectId: a.id, kind: "PRODUCT" as const, productId: draft.id, quantity: 1 }], clientMutationId: randomUUID() };
  await assert.rejects(trips.createLogisticsTripCore(actor.id, draftInput, transaction), /не принадлежит/);
  assert.equal((await logisticsViews.getLogisticsOptionsCore(actor.id, transaction)).projects.some(row => row.products.some(item => item.id === draft.id)), false);
  assert.ok(await trips.createLogisticsTripCore(admin.id, { ...draftInput, clientMutationId: randomUUID() }, transaction));
  assert.equal((await logisticsViews.getLogisticsOptionsCore(admin.id, transaction)).projects.some(row => row.products.some(item => item.id === draft.id)), true);
  const tripInput = { ...manifest, clientMutationId: randomUUID() }; let trip = await trips.createLogisticsTripCore(actor.id, tripInput, transaction);
  assert.equal((await trips.createLogisticsTripCore(actor.id, tripInput, transaction)).tripId, trip.tripId);
  await assert.rejects(trips.createLogisticsTripCore(actor.id, { ...tripInput, clientMutationId: randomUUID(), shares: [{ projectId: a.id, percentBps: 4000 }, { projectId: b.id, percentBps: 5000 }] }, transaction), /100%/);
  await assert.rejects(trips.createLogisticsTripCore(actor.id, { ...tripInput, clientMutationId: randomUUID(), lines: [{ ...manifest.lines[0], productId: products[1].id }, manifest.lines[1]] }, transaction), /не принадлежит/);
  const shares = await tx.logisticsProjectShare.findMany({ where: { tripId: trip.tripId }, orderBy: { projectId: "asc" } });
  await rejectedSql(tx, () => tx.logisticsProjectShare.create({ data: { tripId: trip.tripId, projectId: a.id, percentBps: 1 } }));
  await rejectedSql(tx, () => tx.logisticsProjectShare.create({ data: { tripId: trip.tripId, projectId: rows.id("missing-logistics-project"), percentBps: 1 } }));
  await rejectedSql(tx, async () => { await tx.logisticsProjectShare.update({ where: { id: shares[0].id }, data: { percentBps: 1 } }); await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE"); });
  const edited = { ...tripInput, tripId: trip.tripId, expectedRevision: trip.revision, comment: "Рейс169 исправлен", clientMutationId: randomUUID() };
  trip = await trips.updateLogisticsTripCore(actor.id, edited, transaction); assert.equal(trip.revision, 2);
  assert.deepEqual((await tx.logisticsProjectShare.findMany({ where: { tripId: trip.tripId }, orderBy: { projectId: "asc" } })).map(row => row.id), shares.map(row => row.id));
  assert.equal((await trips.updateLogisticsTripCore(actor.id, edited, transaction)).repeated, true);
  await assert.rejects(trips.updateLogisticsTripCore(actor.id, { ...edited, clientMutationId: randomUUID() }, transaction), /уже изменён/);
  let unavailable = true; const contents = new Map<string, Buffer>();
  const documents = logisticsDocuments.createLogisticsDocumentService({ transaction, storage: {
    mode: () => "s3", async put(row, content) { assert.ok(Buffer.isBuffer(content)); if (unavailable) throw Error("CI169_TTN_STORAGE_UNAVAILABLE"); contents.set(row.storageKey, Buffer.from(content)); },
    async open(row) { const bytes = contents.get(row.storageKey); return bytes ? new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }) : null; },
  } });
  const upload = { tripId: trip.tripId, clientMutationId: randomUUID(), stage: "ISSUED" as const, ttnNumber: "CI169", fileName: "ТТН.pdf", mimeType: "application/pdf", bytes: Buffer.from("%PDF-1.4\nCI169") };
  await assert.rejects(documents.upload(actor.id, upload), /CI169_TTN_STORAGE_UNAVAILABLE/);
  const pending = await tx.logisticsDocument.findUniqueOrThrow({ where: { clientMutationId: upload.clientMutationId } });
  assert.equal(pending.state, "PENDING"); assert.equal(await documents.read(c.actor.id, pending.id), null);
  unavailable = false; const ready = await documents.upload(actor.id, upload); assert.equal(ready.document.id, pending.id);
  assert.equal((await documents.upload(actor.id, upload)).repeated, true); await assert.rejects(documents.upload(c.actor.id, { ...upload, clientMutationId: randomUUID() }), /прав/);
  const response = await logisticsHttp.readLogisticsDocumentResponse(new Request(`${fixture.target.baseUrl}/api/logistics/documents/${pending.id}?view=1`), pending.id, { authorize: async () => c.actor.id, service: documents });
  assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), upload.bytes);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff"); assert.ok(response.headers.get("cache-control")?.startsWith("private"));
  const document = await tx.logisticsDocument.findUniqueOrThrow({ where: { id: ready.document.id } });
  const deniedActor = await rows.user("logistics-denied", ["MANAGER"]);
  assert.equal((await logisticsHttp.readLogisticsDocumentResponse(new Request(`${fixture.target.baseUrl}/api/logistics/documents/${pending.id}`), pending.id,
    { authorize: async () => deniedActor.id, service: documents })).status, 403);
  const input = { tripId: trip.tripId, expectedRevision: trip.revision, clientMutationId: randomUUID(), amount: "1000.00", currency: "BYN" as const,
    cashAccountId: c.account.id, documentIds: [document.id] }, dependencies = { db: tx, transaction };
  await assert.rejects(logistics.createLogisticsPostingCore(actor.id, { ...input, documentIds: [randomUUID()] }, "post", dependencies), /сохранённая ТТН/);
  const beforeCash = await cash.readCashBalance(tx, c.account.id), beforeOrg = await cash.readOrgBalance(tx, "1");
  const posted = await logistics.createLogisticsPostingCore(actor.id, input, "post", dependencies);
  const original = await tx.logisticsPosting.findUniqueOrThrow({ where: { id: posted.postingId }, include: { allocations: { orderBy: { projectId: "asc" } } } });
  const oldPayments = await tx.payment.findMany({ where: { logisticsAllocation: { postingId: posted.postingId } }, orderBy: { id: "asc" } });
  assert.deepEqual(new Map(original.allocations.map(row => [row.projectId, row.amount.toFixed(2)])), new Map([[a.id, "400.00"], [b.id, "600.00"]]));
  assert.equal(original.expenseArticleId, null); assert.equal(oldPayments.length, 2); assert.ok(oldPayments.every(row => row.expenseArticleId === null));
  assert.equal((await cash.readCashBalance(tx, c.account.id)).toFixed(2), beforeCash.minus(1000).toFixed(2));
  const postedMoney = await money(tx);
  assert.equal((await logistics.createLogisticsPostingCore(actor.id, input, "post", dependencies)).postingId, posted.postingId);
  assert.deepEqual(await money(tx), postedMoney, "POST_REPLAY_ZERO_WRITES");
  await assert.rejects(logistics.createLogisticsPostingCore(actor.id, { ...input, amount: "1001" }, "post", dependencies), /другими данными/);
  await assert.rejects(logistics.createLogisticsPostingCore(c.actor.id, { ...input, clientMutationId: randomUUID() }, "correct", dependencies), /Недостаточно прав/);
  await assert.rejects(trips.updateLogisticsTripCore(actor.id, { ...manifest, tripId: trip.tripId, expectedRevision: posted.revision, clientMutationId: randomUUID() }, transaction), /Рейс оплачен/);
  await assert.rejects(paymentDelete.deletePaymentInTransaction(actor, oldPayments[0].id, "EXPENSE", "BYN", "1", tx), /общий рейс/);
  await rejectedSql(tx, () => tx.payment.update({ where: { id: oldPayments[0].id }, data: { amount: "1" } }), /IMMUTABLE/);
  await rejectedSql(tx, () => tx.logisticsDocument.delete({ where: { id: document.id } }), /IMMUTABLE/);
  const budget = await logisticsQueries.getLogisticsProjectBudgetCore(actor.id, a.id, tx);
  assert.equal(budget.deliveryBudget, 700); assert.equal(budget.spent, 400); assert.equal(budget.tripSpent, 400); assert.equal(budget.remaining, 300);
  assert.equal((await tx.payment.aggregate({ where: { projectId: a.id, direction: "EXPENSE" }, _sum: { bynAmount: true } }))._sum.bynAmount!.toFixed(2), "450.00");
  const correction = { ...input, amount: "1200.00", expectedRevision: posted.revision, clientMutationId: randomUUID() };
  const empty = await tx.cashAccount.create({ data: { name: rows.id("empty-logistics"), currency: "BYN" } });
  const shortageBefore = await nativeSnapshot(tx);
  await assert.rejects(logistics.createLogisticsPostingCore(actor.id, { ...correction, cashAccountId: empty.id }, "correct", dependencies), /Недостаточно средств/);
  assert.deepEqual(await nativeSnapshot(tx), shortageBefore, "FAILED_CORRECTION_PRESERVES_ACTIVE_HISTORY");
  await tx.$executeRawUnsafe("CREATE FUNCTION ci169_logistics_failure() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'CI169_LOGISTICS_FAILURE'; END; $$ LANGUAGE plpgsql");
  await tx.$executeRawUnsafe('CREATE TRIGGER ci169_logistics_failure BEFORE INSERT ON "ChangeLog" FOR EACH ROW WHEN (NEW.entity=\'logisticsPosting\' AND NEW.action=\'correct\') EXECUTE FUNCTION ci169_logistics_failure()');
  const faultBefore = await nativeSnapshot(tx);
  await assert.rejects(logistics.createLogisticsPostingCore(actor.id, correction, "correct", dependencies), /CI169_LOGISTICS_FAILURE/);
  assert.deepEqual(await nativeSnapshot(tx), faultBefore, "CORRECTION_FINAL_AUDIT_FAILURE_ROLLS_BACK_POSTING_PAYMENT_TRIP");
  await tx.$executeRawUnsafe('DROP TRIGGER ci169_logistics_failure ON "ChangeLog"'); await tx.$executeRawUnsafe("DROP FUNCTION ci169_logistics_failure()");
  const corrected = await logistics.createLogisticsPostingCore(actor.id, correction, "correct", dependencies);
  const signed = await documents.upload(actor.id, { ...upload, clientMutationId: randomUUID(), stage: "SIGNED", bytes: Buffer.from("%PDF-1.4\nSIGNED") });
  assert.notEqual(signed.document.id, document.id); assert.equal((await documents.list(c.actor.id, trip.tripId)).length, 2);
  assert.equal((await logisticsQueries.getLogisticsTripMoneyCore(actor.id, trip.tripId, tx)).current!.id, corrected.postingId);
  const accountantView = await logisticsViews.getLogisticsTripCore(c.actor.id, trip.tripId, transaction);
  assert.equal(accountantView?.mode, "documents"); assert.equal("lines" in accountantView!, false); assert.equal("comment" in accountantView!, false);
  for (const projectId of [a.id, b.id]) assert.ok((await logisticsViews.listLogisticsTripsCore(actor.id, { projectId, query: "Рейс169" }, transaction)).rows.some(row => row.id === trip.tripId));
  const current = await tx.logisticsPosting.findUniqueOrThrow({ where: { id: corrected.postingId }, include: { allocations: true } });
  assert.deepEqual(new Map(current.allocations.map(row => [row.projectId, row.amount.toFixed(2)])), new Map([[a.id, "480.00"], [b.id, "720.00"]]));
  assert.deepEqual(await tx.logisticsPosting.findUnique({ where: { id: original.id }, include: { allocations: { orderBy: { projectId: "asc" } } } }), { ...original, status: "SUPERSEDED" });
  assert.deepEqual(await tx.payment.findMany({ where: { id: { in: oldPayments.map(row => row.id) } }, orderBy: { id: "asc" } }), oldPayments);
  assert.equal(await tx.payment.count({ where: { AND: [activePaymentWhere, { id: { in: oldPayments.map(row => row.id) } }] } }), 0);
  assert.equal((await cash.readCashBalance(tx, c.account.id)).toFixed(2), beforeCash.minus(1200).toFixed(2));
  assert.equal((await cash.readOrgBalance(tx, "1")).toFixed(2), beforeOrg.minus(1200).toFixed(2));
  const correctedStatement = await statements.loadCashStatement(actor, { from: "2000-01-01", to: "2099-12-31", mode: "NATIVE" }, tx);
  const correctedCash = correctedStatement.rows.find(row => row.id === c.account.id)!;
  assert.ok(!correctedCash.entries.some(row => oldPayments.some(old => row.id === `payment:${old.id}`)));
  assert.equal(correctedCash.totals.closing, beforeCash.minus(1200).toFixed(2));
  const afterCorrection = await money(tx);
  assert.equal((await logistics.createLogisticsPostingCore(actor.id, correction, "correct", dependencies)).repeated, true); assert.deepEqual(await money(tx), afterCorrection);
  await assert.rejects(logistics.createLogisticsPostingCore(actor.id, { ...correction, clientMutationId: randomUUID() }, "correct", dependencies), /уже изменён/);
  const replaced = await logistics.createLogisticsPostingCore(actor.id, { ...correction, expectedRevision: corrected.revision, clientMutationId: randomUUID(),
    manifest: { ...manifest, shares: [{ projectId: b.id, percentBps: 10000 }], lines: [manifest.lines[1]] } }, "correct", dependencies);
  assert.equal(replaced.revision, corrected.revision + 1); assert.equal((await logisticsQueries.getLogisticsProjectBudgetCore(actor.id, a.id, tx)).spent, 0);
  assert.equal(await tx.logisticsPosting.count({ where: { tripId: trip.tripId, status: "SUPERSEDED" } }), 2);
  await tx.user.update({ where: { id: actor.id }, data: { roles: ["MANAGER"] } });
  await assert.rejects(documents.read(actor.id, document.id), /прав/);
  const finalMoney = await money(tx);
  for (const [index, before] of originalMoney.entries()) assert.deepEqual(finalMoney[index].filter(row => before.some(old => old.id === row.id)), before, "FOREIGN_LOGISTICS_MONEY_UNCHANGED");
}));

test("payroll/native-moscow-boundaries-invalid-period-zero-writes", async () => fixture.rollback(async (tx, rows) => {
  const c = await cashContext(tx, rows, "0"), watched = observed(tx);
  for (const month of ["2025-13", "2026-00", "0000-01", "2026-1", "2026-01\n"]) {
    await assert.rejects(cash.issuePayoutCore(c.actor, { ...c.input, kind: "SALARY", month }, rates(), watched.tx), /месяц/);
    await assert.rejects(payroll.getMonthTurnover(month, watched.tx), /месяц/);
    await on(watched.tx, c.actor, async () => {
      await assert.rejects(payroll.getMyPayroll(c.employee.id, month), /месяц/);
      await assert.rejects(payroll.getPayrollSummary(month), /месяц/);
      await assert.rejects(payroll.getTurnoverAccruals(month), /месяц/);
    });
  }
  assert.equal(watched.calls.length, 0);
  for (const month of ["2024-02", "2026-01", "2014-10", "1981-03", "1981-04"]) {
    const { start, end } = payrollMonthRange(month);
    for (const [index, instant] of [start.getTime() - 1, start.getTime(), end.getTime() - 1, end.getTime()].entries()) {
      const amount = index === 1 ? "1.01" : index === 2 ? "3.21" : "99.00";
      await tx.payment.create({ data: { cashAccountId: c.account.id, paidAt: new Date(instant), amount, bynAmount: amount } });
    }
    assert.deepEqual(await payroll.getMonthTurnover(month, tx), { total: 4.22, paymentsCount: 2, currency: "BYN" });
    await tx.payment.deleteMany({ where: { cashAccountId: c.account.id } });
  }
}));

test("payroll/shared-native-inputs-consumer-dto-1-5-20-tenfold-history", async () => fixture.rollback(async (tx, rows) => {
  const [originalUsers, originalEntries, originalPayouts] = await Promise.all([
    tx.user.findMany({ orderBy: { id: "asc" } }), tx.payrollEntry.findMany({ orderBy: { id: "asc" } }), tx.payout.findMany({ orderBy: { id: "asc" } }),
  ]);
  const actor = actorFor(await rows.user("reader", ["ACCOUNTANT"])), current = payrollMonth();
  // До-case DTO строим из сохранённых Decimal-фактов, не из проверяемого summary reader.
  const foreign = originalUsers.map(user => {
    const ledger = originalEntries.filter(row => row.userId === user.id), payouts = originalPayouts.filter(row => row.userId === user.id);
    const past = fixedBynTotal(ledger.filter(row => row.month < current)), paid = fixedBynTotal(payouts);
    const due = past === null || paid === null ? null : past.minus(paid).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber();
    return { userId: user.id, name: user.name, activeScheme: user.active && user.payScheme !== "NONE",
      selectedEntries: ledger.some(row => row.month === "2020-01"), selectedPayouts: payouts.some(row => row.month === "2020-01"),
      accrued: fixedBynTotal(ledger.filter(row => row.month === "2020-01"))?.toNumber() ?? null,
      paid: fixedBynTotal(payouts.filter(row => row.month === "2020-01"))?.toNumber() ?? null,
      advance: fixedBynTotal(payouts.filter(row => row.month === "2020-01" && row.kind === "ADVANCE"))?.toNumber() ?? null, due };
  });
  const foreignSummary = foreign.filter(row => row.activeScheme || row.selectedEntries || row.selectedPayouts || row.due !== 0)
    .map(({ userId, accrued, paid, advance, due }) => ({ userId, accrued, paid, advance, due }));
  const foreignDues = foreign.filter(row => row.due !== 0).map(({ userId, name, due }) => ({ userId, name, due }));
  const users = Array.from({ length: 20 }, (_, index) => ({ id: rows.id(`reader-${index}`), name: `Зарплата ${String(index).padStart(2, "0")}`, email: `${rows.id(`reader-${index}`)}@example.invalid`, passwordHash: "CI_NO_LOGIN",
    roles: index === 3 ? ["ENGINEER" as const] : ["MANAGER" as const, "ENGINEER" as const], active: index !== 0,
    payScheme: index === 0 ? "NONE" as const : index % 3 === 0 ? "PERCENT_TURNOVER" as const : "PIECE" as const, payPercent: index % 3 === 0 ? "3" : null }));
  const account = await tx.cashAccount.create({ data: { name: "Историческая касса RUB", currency: "RUB" } });
  const entries: Prisma.PayrollEntryCreateManyInput[] = [], paid: Prisma.PayoutCreateManyInput[] = [];
  for (const [index, user] of users.entries()) {
    for (const [position, pattern] of [
      { month: "2020-01", amount: "100", currency: "BYN", bynAmount: null, scheme: "PIECE" },
      { month: "2020-01", amount: "-0.03", currency: "BYN", bynAmount: "-0.03", scheme: "PIECE" },
      { month: "2020-01", amount: "0.03", currency: "BYN", bynAmount: "0.03", scheme: "PIECE" },
      { month: "2020-01", amount: "10", currency: "USD", bynAmount: "30", scheme: "PERCENT_TURNOVER" },
      { month: "2020-01", amount: "999", currency: "USD", bynAmount: "0", scheme: "PIECE" },
      { month: current, amount: "6", currency: "BYN", bynAmount: "6", scheme: "PIECE" },
      { month: current, amount: "9", currency: "USD", bynAmount: index === 0 ? null : "27", scheme: "PIECE" },
      { month: "2999-01", amount: "7", currency: "BYN", bynAmount: "7", scheme: "PIECE" },
    ].entries()) entries.push({ id: rows.id(`entry-${index}-${position}`), userId: user.id, ...pattern });
    for (let position = 0; position < 3; position++) {
      const legacy = index === 0 && position === 2, amount = position === 1 ? "0.01" : "2";
      paid.push({ id: rows.id(`paid-${index}-${position}`), userId: user.id, createdById: actor.id, amount, kind: position === 1 ? "ADVANCE" : "SALARY", month: position === 2 ? "2999-01" : "2020-01",
        cashAccountId: legacy ? null : account.id, cashAmount: legacy ? null : amount, cashCurrency: legacy ? null : "RUB", payrollCurrency: legacy ? null : "RUB", bynAmount: legacy ? null : position === 1 ? "0" : "0.06",
        cashRate: legacy ? null : "0.030000", payrollRate: legacy ? null : "0.030000", cashRateDate: legacy ? null : new Date("2020-01-03"), payrollRateDate: legacy ? null : new Date("2020-01-03") });
    }
  }
  const fence = async () => {
    const marker = randomUUID(); await tx.$queryRaw`SELECT ${marker}::text AS "finance169Fence"`;
    const deadline = performance.now() + 5000;
    let index = -1;
    while ((index = fixture.queryEvents.findIndex(event => event.query.includes('"finance169Fence"') && event.params.includes(marker))) < 0) {
      assert.ok(performance.now() < deadline, "SQL_QUERY_LOG_FENCE_TIMEOUT"); await new Promise(resolve => setTimeout(resolve, 1));
    }
    return index;
  };
  const measure = async <T>(read: () => Promise<T>) => { const start = await fence(), value = await read(), end = await fence(); return { value, count: end - start - 1, queries: fixture.queryEvents.slice(start + 1, end) }; };
  let inserted = 0;
  const counts: number[] = [], consumerCounts: number[] = [];
  const verify = async (size: number, multiplier: number) => on(tx, actor, async () => {
    const measured = await measure(() => payroll.readPayrollSummary("2020-01")), model = measured.value;
    assert.equal(measured.count, 2); counts.push(measured.count);
    for (const [index, user] of users.slice(0, size).entries()) {
      assert.equal(model.accrued.get(user.id), 130 * multiplier); assert.equal(model.paid.get(user.id), 0.06 * multiplier);
      assert.equal(model.advances.get(user.id), 0); assert.equal(model.pastAccrued.get(user.id), 130 * multiplier);
      assert.equal(model.estimates.get(user.id), index === 0 ? null : 33 * multiplier); assert.equal(model.turnoverAccrued.get(user.id), 30 * multiplier);
      assert.equal(model.totalPaid.get(user.id), index === 0 ? null : 0.12 * multiplier);
    }
    assert.equal(model.allPaid, null);
    const consumer = await measure(async () => {
      const snapshot = await payroll.readPayrollSummary("2020-01");
      return Promise.all([payroll.getPayrollSummary("2020-01", snapshot), payroll.getEmployeeDues(snapshot), payroll.getCurrentMonthEstimates(snapshot),
        payroll.getOrgBalance(snapshot), payroll.getTurnoverAccruals("2020-01", snapshot), payroll.listPayrollUsers(snapshot)]);
    });
    consumerCounts.push(consumer.count);
    const [summary, dues, estimates, balance, accruals, eligible] = consumer.value;
    assert.deepEqual(new Map(summary.rows.map(({ userId, accrued, paid, advance, due }) => [userId, { userId, accrued, paid, advance, due }])),
      new Map([...foreignSummary, ...users.slice(0, size).map((user, index) => ({ userId: user.id, accrued: 130 * multiplier, paid: 0.06 * multiplier, advance: 0, due: index === 0 ? null : 129.88 * multiplier }))].map(row => [row.userId, row])));
    assert.equal(summary.rows.length, foreignSummary.length + size);
    assert.deepEqual(await payroll.getPayrollSummary("2020-01"), summary);
    assert.deepEqual(new Map(dues.map(row => [row.userId, row])), new Map([...foreignDues,
      ...users.slice(0, size).map((user, index) => ({ userId: user.id, name: user.name, due: index === 0 ? null : 129.88 * multiplier }))].map(row => [row.userId, row])));
    assert.equal(dues.length, foreignDues.length + size);
    assert.equal(estimates[users[0].id], null); assert.equal(balance, null); assert.ok(eligible.some(user => user.id === users[0].id));
    assert.ok(!accruals.some(user => user.userId === users[3].id));
    const personalRead = await measure(() => payroll.getMyPayroll(users[0].id, "2020-01")), personal = personalRead.value;
    const models = ["PayrollEntry", "Payout", "CashAccount", "User"].map(table => personalRead.queries.filter(event => event.query.includes(`FROM "public"."${table}"`)).length);
    assert.deepEqual([personalRead.count, ...models], [6, 2, 2, 1, 1], "TWO_PAYROLL_TWO_PAYOUT_CASH_ACCOUNT_AND_CREATOR_SQL_READS");
    assert.deepEqual({ accrued: personal.accrued, paid: personal.paid, debt: personal.debt, estimate: personal.estimate }, { accrued: 130 * multiplier, paid: 0.06 * multiplier, debt: null, estimate: null });
    assert.equal(personal.entries.length, 5 * multiplier); assert.equal(personal.payouts.length, 2 * multiplier);
    const savedForeign = personal.entries.find(row => row.id === rows.id("entry-0-3"))!;
    assert.deepEqual({ currency: savedForeign.currency, amount: savedForeign.amount, byn: savedForeign.bynAmount }, { currency: "USD", amount: 10, byn: 30 });
    if (size > 1) for (const selected of ["2020-01", current, "2999-01"]) {
      const own = await payroll.getMyPayroll(users[1].id, selected);
      assert.deepEqual({ accrued: own.accrued, paid: own.paid, debt: own.debt, estimate: own.estimate }, {
        accrued: (selected === "2020-01" ? 130 : selected === current ? 33 : 7) * multiplier,
        paid: (selected === current ? 0 : 0.06) * multiplier, debt: 129.88 * multiplier, estimate: 33 * multiplier,
      });
    }
  });
  for (const size of [1, 5, 20]) {
    const incoming = users.slice(inserted, size), ids = incoming.map(user => user.id);
    await tx.user.createMany({ data: incoming }); await tx.payrollEntry.createMany({ data: entries.filter(row => ids.includes(row.userId)) });
    await tx.payout.createMany({ data: paid.filter(row => ids.includes(row.userId)) }); inserted = size;
    await verify(size, 1);
  }
  assert.deepEqual(counts, [2, 2, 2]); assert.ok(consumerCounts[2] <= consumerCounts[0] + 2);
  for (let copy = 0; copy < 9; copy++) {
    await tx.payrollEntry.createMany({ data: entries.map(row => ({ ...row, id: `${row.id}-copy-${copy}` })) });
    await tx.payout.createMany({ data: paid.map(row => ({ ...row, id: `${row.id}-copy-${copy}` })) });
  }
  await verify(20, 10);
  assert.equal(await tx.payrollEntry.count(), originalEntries.length + 1600); assert.equal(await tx.payout.count(), originalPayouts.length + 600);
  assert.equal(await tx.payrollEntry.count({ where: { userId: { in: users.map(user => user.id) } } }), 1600);
  assert.equal(await tx.payout.count({ where: { userId: { in: users.map(user => user.id) } } }), 600);
  assert.deepEqual(await tx.payrollEntry.findMany({ where: { id: { in: originalEntries.map(row => row.id) } }, orderBy: { id: "asc" } }), originalEntries);
  assert.deepEqual(await tx.payout.findMany({ where: { id: { in: originalPayouts.map(row => row.id) } }, orderBy: { id: "asc" } }), originalPayouts);
  assert.deepEqual(await tx.user.findMany({ where: { id: { in: originalUsers.map(row => row.id) } }, orderBy: { id: "asc" } }), originalUsers);
  const former = await Promise.all(["owed", "paid"].map(label => rows.user(`former-${label}`, ["WORKER"], { active: false, payScheme: "NONE" })));
  const formerCash = await tx.cashAccount.create({ data: { name: rows.id("former-cash"), currency: "BYN" } });
  for (const [index, employee] of former.entries()) {
    await tx.payrollEntry.create({ data: { userId: employee.id, amount: "100", currency: "BYN", month: "2001-01" } });
    await tx.payout.create({ data: { userId: employee.id, amount: index ? "100" : "20", payrollCurrency: "BYN", bynAmount: index ? "100" : "20", month: "2001-01",
      cashAccountId: formerCash.id, cashAmount: index ? "100" : "20", cashCurrency: "BYN", cashRate: "1", payrollRate: "1", cashRateDate: new Date("2001-01-01"), payrollRateDate: new Date("2001-01-01") } });
  }
  const eligibleFormer = await on(tx, actor, () => payroll.listPayrollUsers());
  assert.equal(eligibleFormer.some(user => user.id === former[0].id), true); assert.equal(eligibleFormer.some(user => user.id === former[1].id), false);
  const formerSummary = await on(tx, actor, () => payroll.getPayrollSummary(current));
  assert.equal(formerSummary.rows.find(row => row.userId === former[0].id)!.due, 80);
}));

test("finance/cash-statement-real-Moscow-edges-saved-FX-no-cash-and-role-boundary", async () => fixture.rollback(async (tx, rows) => {
  const actor = actorFor(await rows.user("statement-reader", ["PROCUREMENT"]));
  const accounts = await Promise.all(["BYN", "USD", "EUR"].map(currency => tx.cashAccount.create({ data: { name: rows.id(`statement-${currency.toLowerCase()}`), currency, active: currency !== "USD" } })));
  await tx.payment.createMany({ data: [
    { cashAccountId: accounts[0].id, amount: "100", bynAmount: "100", paidAt: new Date("2026-10-06T20:59:59.999Z") },
    { cashAccountId: accounts[0].id, amount: "50", bynAmount: "50", paidAt: new Date("2026-10-06T21:00:00.000Z") },
    { cashAccountId: accounts[0].id, direction: "EXPENSE", amount: "10", bynAmount: "10", paidAt: new Date("2026-10-07T08:00:00Z") },
    { cashAccountId: accounts[0].id, amount: "999", bynAmount: "999", paidAt: new Date("2026-10-07T21:00:00.000Z") },
    { cashAccountId: accounts[1].id, amount: "100", currency: "USD", bynAmount: "300", rate: "3", paidAt: new Date("2026-10-06T20:59:59.999Z") },
    { cashAccountId: accounts[1].id, direction: "EXPENSE", amount: "10", currency: "USD", bynAmount: "33", rate: "3.3", paidAt: new Date("2026-10-07T08:00:00Z") },
  ] });
  const rateFields = { cashRate: "1", payrollRate: "1", cashRateDate: new Date("2026-10-07"), payrollRateDate: new Date("2026-10-07"), payrollCurrency: "BYN" };
  await tx.payout.createMany({ data: [
    { ...rateFields, userId: actor.id, kind: "SALARY", month: "2026-09", amount: "20", cashAccountId: accounts[0].id, cashAmount: "20", cashCurrency: "BYN", bynAmount: "20", createdAt: new Date("2026-10-07T10:00:00Z") },
    { ...rateFields, userId: actor.id, kind: "ADVANCE", month: "2026-10", amount: "5", cashAccountId: accounts[0].id, cashAmount: "5", cashCurrency: "BYN", bynAmount: "5", createdAt: new Date("2026-10-07T20:59:59.999Z") },
    { ...rateFields, cashRate: "3", userId: actor.id, kind: "SALARY", month: "2026-09", amount: "15", cashAccountId: accounts[1].id, cashAmount: "5", cashCurrency: "USD", bynAmount: "15", createdAt: new Date("2026-10-07T10:00:00Z") },
    { id: rows.id("statement-unassigned"), userId: actor.id, amount: "3", month: "2026-10", kind: "ADVANCE", createdAt: new Date("2026-10-07T10:00:00Z") },
  ] });
  await tx.payrollEntry.create({ data: { userId: actor.id, amount: "999999", bynAmount: "999999", currency: "BYN", month: "2026-10" } });
  const query = { from: "2026-10-07", to: "2026-10-07", mode: "BYN" as const }, before = await money(tx), rateCount = rateReads;
  const valuationRates = [{ currency: "USD", date: "2026-10-06", rate: "3", issue: null }, { currency: "USD", date: "2026-10-07", rate: "3.3", issue: null }];
  const byn = await statements.loadCashStatement(actor, query, tx, valuationRates), native = await statements.loadCashStatement(actor, { ...query, mode: "NATIVE" }, tx);
  assert.deepEqual(byn.rows.find(row => row.id === accounts[0].id)!.totals, { opening: "100.00", income: "50.00", expense: "-35.00", revaluation: "0.00", closing: "115.00" });
  assert.equal(byn.rows.find(row => row.id === accounts[0].id)!.entries.length, 4);
  assert.equal(byn.rows.find(row => row.id === accounts[1].id)!.totals.closing, "280.50");
  assert.equal(byn.rows.find(row => row.id === accounts[1].id)!.totals.revaluation, "28.50");
  assert.equal(native.rows.find(row => row.id === accounts[1].id)!.totals.closing, "85.00"); assert.equal(native.rows.find(row => row.id === accounts[1].id)!.active, false);
  assert.equal(byn.rows.find(row => row.id === accounts[2].id)!.totals.closing, "0.00");
  for (const result of [byn, native]) assert.ok(result.rows.some(row => row.unassigned && row.totals.closing === null && row.entries.some(entry => entry.id === `payout:${rows.id("statement-unassigned")}` && entry.change === null)));
  const denied = observed(tx); await assert.rejects(statements.loadCashStatement({ ...actor, roles: ["MANAGER"] }, query, denied.tx), /прав/); assert.equal(denied.calls.length, 0);
  assert.deepEqual(await statements.loadCashStatement({ ...actor, roles: ["MANAGER", "ACCOUNTANT"] }, query, tx, valuationRates), byn);
  assert.equal(JSON.stringify(byn).includes("CI_NO_LOGIN"), false); assert.deepEqual(await money(tx), before); assert.equal(rateReads, rateCount);
}));

test("finance/economics-saved-BYN-unknown-zero-and-legacy-settlement-cents-once", async () => fixture.rollback(async (tx, rows) => {
  const reader = actorFor(await rows.user("economics-reader", ["MANAGER", "ACCOUNTANT"])), engineer = await rows.user("economics-engineer", ["ENGINEER"]);
  const bootstrap = await rows.project("economics-bootstrap", { stage: "CONTRACT", managerId: reader.id });
  await tx.user.update({ where: { id: engineer.id }, data: { payScheme: "PERCENT_PROJECT", payPercent: "5" } });
  const inactive = await rows.user("bootstrap-inactive", ["ENGINEER"], { active: false }), wrongRole = await rows.user("bootstrap-worker", ["WORKER"]);
  for (const engineerId of [inactive.id, wrongRole.id]) {
    const rejected = await productCore.createProductCore(reader, { projectId: bootstrap.id, title: "Недоступный инженер", engineerId }, operation => operation(tx));
    assert.equal(rejected.ok, false); if (!rejected.ok) assert.match(rejected.error ?? "", /активного.*инженера/);
    assert.equal(await tx.product.count({ where: { projectId: bootstrap.id } }), 0);
  }
  const created = await productCore.createProductCore(reader, { projectId: bootstrap.id, title: "Новое изделие", engineerId: engineer.id, expectedPrice: 100 }, operation => operation(tx));
  assert.equal(created.ok, true); if (!created.ok) return;
  assert.equal(created.product.status, "PREPARATION"); assert.equal(await tx.productStagePayPool.count({ where: { productId: created.product.id } }), 0);
  const noPrice = await rows.product("bootstrap-zero", bootstrap.id, { expectedPrice: "0", engineerId: engineer.id });
  const oldPool = await tx.productStagePayPool.create({ data: { productId: noPrice.id, kind: "ENGINEERING", state: "DRAFT", ratePercent: "5", createdById: reader.id } });
  await tx.payrollEntry.create({ data: { userId: engineer.id, projectId: bootstrap.id, scheme: "PERCENT_PROJECT", amount: "321", currency: "USD", month: "2000-01" } });
  const oldPayroll = await tx.payrollEntry.findMany({ where: { projectId: bootstrap.id } });
  const patch = { projectId: bootstrap.id, expectedStage: "CONTRACT", toStage: "IN_WORK", clientMutationId: randomUUID() };
  const advanced = await projectStages.patchProjectStageTransaction(reader, patch, tx); assert.equal(advanced.result.ok, true);
  const replayed = await projectStages.patchProjectStageTransaction(reader, patch, tx); assert.equal(replayed.result.ok, true); assert.equal(replayed.result.replayed, true);
  assert.equal(await tx.projectStageHistory.count({ where: { projectId: bootstrap.id } }), 1);
  assert.equal(await tx.changeLog.count({ where: { id: `project-stage:${patch.clientMutationId}` } }), 1); assert.equal(advanced.eventIds.length, 1); assert.equal(replayed.eventIds.length, 0);
  assert.deepEqual(await tx.payrollEntry.findMany({ where: { projectId: bootstrap.id } }), oldPayroll);
  assert.deepEqual(await tx.productStagePayPool.findMany({ where: { productId: { in: [created.product.id, noPrice.id] } } }), [oldPool]);
  const invalidDelete = await on(tx, reader, () => productActions.deleteProduct(created.product.id)); assert.equal(invalidDelete.ok, false); assert.equal(invalidDelete.kind, "validation");
  assert.equal(await tx.product.count({ where: { projectId: bootstrap.id } }), 2);
  for (const mode of ["unknown", "zero", "missing-price"] as const) {
    const project = await rows.project(`economics-${mode}`), product = await rows.product(`economics-${mode}`, project.id, { expectedPrice: mode === "missing-price" ? null : "0" });
    await tx.payment.create({ data: { projectId: project.id, amount: "100", currency: "USD", rate: "3", bynAmount: "300", projectAmount: "100" } });
    await tx.payrollEntry.create({ data: { userId: engineer.id, projectId: project.id, amount: mode === "unknown" ? "1" : "0", currency: "USD", bynAmount: mode === "unknown" ? null : "0", month: "2000-01" } });
    const result = await economics.getProjectEconomics(project.id, tx);
    assert.deepEqual({ paid: result!.paidTotal, payroll: result!.payrollTotal, margin: result!.margin, full: result!.marginAtFullPrice },
      { paid: 300, payroll: mode === "unknown" ? null : 0, margin: mode === "unknown" ? null : 300, full: mode === "zero" ? 0 : null });
    assert.equal((await tx.product.findUniqueOrThrow({ where: { id: product.id } })).expectedPrice?.toString() ?? null, mode === "missing-price" ? null : "0");
  }
  const project = await rows.project("economics-frozen"), stamp = new Date("2020-01-01");
  await tx.payment.create({ data: { projectId: project.id, amount: "100", currency: "USD", rate: "3", bynAmount: "300", projectAmount: "100" } });
  for (const v of [
    { label: "frozen", price: "1000", rate: "5", productCurrency: "USD", payrollCurrency: "BYN", productRate: "3", payrollRate: "1", exact: "50", amount: "150", byn: "150", project: "50", parts: [["150", "150", "50"]] },
    { label: "residual", price: "0.03", rate: "100", productCurrency: "BYN", payrollCurrency: "USD", productRate: "1", payrollRate: "3", exact: "0.03", amount: "0.01", byn: "0.03", project: "0.03", parts: [["0.01", "0.02", "0.02"], ["0", "0.01", "0.01"]] },
  ]) {
    const product = await rows.product(`economics-${v.label}`, project.id, { expectedPrice: v.price, quantity: 1, status: "DESIGN" });
    const pool = await tx.productStagePayPool.create({ data: { productId: product.id, kind: "ENGINEERING", state: "SETTLED", revision: 1, ratePercent: v.rate, createdById: reader.id } });
    const work = await tx.work.create({ data: { projectId: project.id, productId: product.id, title: v.label, paymentKind: "ENGINEERING", stagePayPoolId: pool.id, poolWeightUnits: 1000000, quantity: "1" } });
    const settlement = await tx.productStageSettlement.create({ data: { poolId: pool.id, productId: product.id, projectId: project.id, closedById: reader.id, closedAt: stamp, poolRevision: 1,
      primaryEngineerIdSnapshot: engineer.id, primaryEngineerNameSnapshot: engineer.name, priceSnapshot: v.price, ratePercentSnapshot: v.rate, productCurrency: v.productCurrency, payrollCurrency: v.payrollCurrency,
      productRateByn: v.productRate, payrollRateByn: v.payrollRate, productRateDate: stamp, payrollRateDate: stamp, sourceFundExact: v.exact, amount: v.amount, bynAmount: v.byn, projectAmount: v.project } });
    for (const [index, [amount, byn, projectAmount]] of v.parts.entries()) {
      const task = await tx.task.create({ data: { projectId: project.id, productId: product.id, workId: work.id, title: `Сохранённая доля ${index}`, assigneeId: engineer.id, quantity: "1" } });
      const share = await tx.productStageSettlementShare.create({ data: { settlementId: settlement.id, taskId: task.id, workId: work.id, userId: engineer.id, taskTitleSnapshot: task.title,
        workTitleSnapshot: work.title, userNameSnapshot: engineer.name, workWeightUnits: 1000000, stageShareUnits: v.parts.length === 1 ? 1000000 : 500000, quantitySnapshot: "1", quantityShareUnitsSnapshot: 1000000, amount, bynAmount: byn, projectAmount } });
      if (amount !== "0") await tx.payrollEntry.create({ data: { userId: engineer.id, projectId: project.id, productId: product.id, workId: work.id, taskId: task.id, settlementShareId: share.id,
        scheme: "PRODUCT_ENGINEERING", month: "2000-01", amount, currency: v.payrollCurrency, bynAmount: byn, projectAmount, projectCurrency: v.productCurrency } });
    }
    const savedShare = await tx.productStageSettlementShare.findFirstOrThrow({ where: { settlementId: settlement.id } });
    for (const [index, invalid] of [{ stageShareUnits: -1 }, { quantityShareUnitsSnapshot: 0 }, { amount: "-0.01" }].entries())
      await rejectedSql(tx, () => tx.productStageSettlementShare.create({ data: { ...savedShare, id: rows.id(`share-invalid-${v.label}-${index}`), ...invalid } }), /ProductStageSettlementShare_bounds/);
    await rejectedSql(tx, () => tx.$executeRaw`INSERT INTO "ProductStageSettlementShare" ("id","settlementId","taskId","workId","userId","taskTitleSnapshot","workTitleSnapshot","userNameSnapshot","workWeightUnits","stageShareUnits","quantityShareUnitsSnapshot","amount","bynAmount","projectAmount")
      SELECT ${rows.id(`share-nan-${v.label}`)},"settlementId","taskId","workId","userId","taskTitleSnapshot","workTitleSnapshot","userNameSnapshot","workWeightUnits","stageShareUnits","quantityShareUnitsSnapshot",'NaN'::numeric,"bynAmount","projectAmount"
      FROM "ProductStageSettlementShare" WHERE "id"=${savedShare.id}`, /ProductStageSettlementShare_bounds/);
    await rejectedSql(tx, () => tx.payrollEntry.create({ data: { userId: engineer.id, productId: product.id, projectId: project.id, settlementShareId: savedShare.id,
      scheme: "PRODUCT_ENGINEERING", amount: "1", currency: "BYN", bynAmount: null, projectAmount: "1", projectCurrency: "BYN", month: "2000-01" } }), /PayrollEntry_settlement_fields/);
    const group = await tx.taskAllocationGroup.create({ data: { workId: work.id, quantity: "1", budget: "1", currency: "BYN", createdById: reader.id } });
    await rejectedSql(tx, () => tx.task.create({ data: { projectId: project.id, productId: product.id, workId: work.id, title: "Неполный старый снимок", quantity: "1", allocationGroupId: group.id, shareUnits: null, shareAmount: "1" } }), /Task_allocation_complete/);
    const nextPrice = new Prisma.Decimal(v.price).plus(1).toNumber();
    assert.equal((await productCore.updateProductCore(reader, product.id, { expectedPrice: nextPrice }, { expectedPrice: v.price }, operation => operation(tx))).ok, true);
    assert.deepEqual(await tx.productStagePayPool.findUnique({ where: { id: pool.id } }), pool); assert.deepEqual(await tx.productStageSettlement.findUnique({ where: { id: settlement.id } }), settlement);
    await tx.product.update({ where: { id: product.id }, data: { expectedPrice: v.price } });
  }
  const draft = await rows.product("economics-draft-pool", project.id, { status: "DESIGN", expectedPrice: "0", quantity: 1 });
  const draftPool = await tx.productStagePayPool.create({ data: { productId: draft.id, kind: "ENGINEERING", state: "DRAFT", createdById: reader.id } });
  assert.equal((await productCore.updateProductCore(reader, draft.id, { expectedPrice: 1 }, { expectedPrice: "0" }, operation => operation(tx))).ok, true);
  assert.equal((await tx.productStagePayPool.findUniqueOrThrow({ where: { id: draftPool.id } })).revision, 1);
  await tx.product.update({ where: { id: draft.id }, data: { expectedPrice: "0" } });
  await tx.payrollEntry.create({ data: { userId: engineer.id, projectId: project.id, amount: "30", currency: "BYN", month: "2000-01" } });
  const original = await money(tx), rateCount = rateReads;
  await tx.project.update({ where: { id: project.id }, data: { currency: "USD" } });
  const frozen = await economics.getProjectEconomics(project.id, tx);
  assert.equal(frozen!.paidTotal, 300); assert.equal(frozen!.payrollTotal, 180.03); assert.equal(frozen!.margin, 119.97); assert.equal(frozen!.expectedPrice, null);
  await tx.project.update({ where: { id: project.id }, data: { currency: "BYN" } });
  const current = await economics.getProjectEconomics(project.id, tx);
  assert.equal(current!.payrollTotal, 180.03); assert.equal(current!.expectedPrice, 1000.03); assert.equal(current!.marginAtFullPrice, 820);
  const facts = { payments: await tx.payment.findMany({ where: { projectId: project.id }, include: { expenseArticle: true } }), stockMovements: [] };
  const watched = observed(tx); assert.deepEqual(await economics.getProjectEconomics(project.id, watched.tx, facts), current);
  assert.ok(!watched.calls.some(call => call === "payment.findMany" || call === "stockMovement.findMany"));
  assert.deepEqual(await money(tx), original); assert.equal(rateReads, rateCount);
}));

test("percentage/native-v1-v2-v3-v4-shape-immutable-and-ceiling-overflow", async () => fixture.rollback(async (tx, rows) => {
  const manager = actorFor(await rows.user("percentage-manager", ["MANAGER"])), engineer = await rows.user("engineer", ["ENGINEER"]), assembler = await rows.user("assembler", ["WORKER"]);
  const project = await rows.project("percentage-project", { managerId: manager.id });
  const product = await rows.product("shape", project.id, { expectedPrice: "999.30", engineerId: engineer.id, status: "DESIGN" }), stamp = new Date();
  const valid = { productId: product.id, kind: "ENGINEERING" as const, state: "SETTLED" as const, statusAtCompletion: "PRODUCTION" as const, calculationVersion: 4,
    quantitySnapshot: 1, priceSnapshot: "999.30", totalSnapshot: "999.30", ratePercentSnapshot: "100", recipientId: engineer.id,
    productCurrency: "BYN", payrollCurrency: "BYN", productRateByn: "1", payrollRateByn: "1", productRateDate: stamp, payrollRateDate: stamp,
    sourceFundExact: "999.30", amount: "1000.00", bynAmount: "1000.00", projectAmount: "1000.00", settledAt: stamp };
  for (const bad of [{ amount: "999.30", bynAmount: "999.30", projectAmount: "999.30" }, { amount: "1001.00", bynAmount: "1001.00", projectAmount: "1001.00" },
    { quantitySnapshot: 0 }, { totalSnapshot: "1998.60" }, { recipientId: null }])
    await rejectedSql(tx, () => tx.productPercentageCompletion.create({ data: { ...valid, ...bad } }), /ProductPercentageCompletion_version_shape/);
  const saved = await tx.productPercentageCompletion.create({ data: valid });
  await rejectedSql(tx, () => tx.productPercentageCompletion.update({ where: { id: saved.id }, data: { priceSnapshot: "1000" } }), /append-only|immutable/);
  await rejectedSql(tx, () => tx.productPercentageCompletion.delete({ where: { id: saved.id } }), /append-only|immutable/);
  for (const version of [1, 2, 3]) {
    const prior = await rows.product(`v${version}`, project.id, { status: "PRODUCTION", expectedPrice: "999.30", engineerId: engineer.id });
    const old = await tx.productPercentageCompletion.create({ data: version === 1 ? { productId: prior.id, kind: "ENGINEERING", state: "LEGACY_PROTECTED", statusAtCompletion: "PRODUCTION", calculationVersion: 1,
      priceSnapshot: "999.30", productCurrency: "BYN" } : { ...valid, productId: prior.id, calculationVersion: version, amount: "999.30", bynAmount: "999.30", projectAmount: "999.30" } });
    await tx.product.update({ where: { id: prior.id }, data: { expectedPrice: "1", quantity: 3 } });
    for (const status of ["DESIGN", "PRODUCTION"] as const) assert.equal((await statuses.changeProductStatusTransaction(tx, manager, prior.id, status)).ok, true);
    assert.deepEqual(await tx.productPercentageCompletion.findUnique({ where: { id: old.id } }), old);
  }
  const overflow = await rows.product("overflow", project.id, { status: "PRODUCTION", expectedPrice: "8333333332.51", quantity: 8, assemblerId: assembler.id });
  await tx.productPercentageConfig.create({ data: { productId: overflow.id, kind: "ASSEMBLY", ratePercent: "15" } });
  await assert.rejects(statuses.changeProductStatusTransaction(tx, manager, overflow.id, "STORAGE"), /превышает допустимую/);
  assert.equal(await tx.productPercentageCompletion.count({ where: { productId: overflow.id } }), 0);
}));

test("percentage/status-action-rolls-back-earlier-engineering-on-invalid-assembly", async () => fixture.rollback(async (tx, rows) => {
  const manager = actorFor(await rows.user("partial-manager", ["MANAGER"]));
  const engineer = await rows.user("partial-engineer", ["ENGINEER"]), assembler = await rows.user("partial-assembler", ["WORKER"], { active: false });
  const project = await rows.project("partial-project", { managerId: manager.id });
  const product = await rows.product("partial-product", project.id, { status: "DESIGN", quantity: 3, expectedPrice: "1000", engineerId: engineer.id, assemblerId: assembler.id });
  await tx.productPercentageConfig.createMany({ data: [{ productId: product.id, kind: "ENGINEERING", ratePercent: "2" }, { productId: product.id, kind: "ASSEMBLY", ratePercent: "5" }] });
  const before = await money(tx), trace = observed(tx);
  const result = await on(trace.tx, manager, () => productActions.changeProductStatus(product.id, "DONE"));
  assert.equal(result.ok, false); assert.match(result.error ?? "", /активного сборщика.*рабочего/);
  assert.ok(trace.calls.includes("productPercentageCompletion.create") && trace.calls.includes("payrollEntry.create"), "EARLIER_ENGINEERING_SQL_WRITES_REQUIRED");
  assert.deepEqual(await tx.product.findUnique({ where: { id: product.id } }), product);
  assert.equal(await tx.productPercentageCompletion.count({ where: { productId: product.id } }), 0);
  assert.deepEqual(await money(tx), before);
  await tx.user.update({ where: { id: assembler.id }, data: { active: true } });
  const collisionId = rows.id("product-status-audit-collision"), collision = { id: collisionId, actorType: "user", actorId: manager.id, entity: "test", entityId: product.id, action: "collision" };
  await tx.changeLog.create({ data: collision }); const auditBefore = await money(tx);
  const auditFault = new Proxy(tx, { get(db, table) {
    if (table === "changeLog") return new Proxy(db.changeLog, { get(model, method) {
      if (method === "create") return async (args: Prisma.ChangeLogCreateArgs) => {
        const saved = await model.create(args);
        if (args.data.action === "status") {
          assert.equal(await tx.productPercentageCompletion.count({ where: { productId: product.id } }), 3);
          assert.equal(await tx.payrollEntry.count({ where: { productId: product.id } }), 2);
          await tx.changeLog.create({ data: collision });
        }
        return saved;
      };
      const value = Reflect.get(model, method); return typeof value === "function" ? value.bind(model) : value;
    } });
    const value = Reflect.get(db, table); return typeof value === "function" ? value.bind(db) : value;
  } });
  const failedAudit = await on(auditFault, manager, () => productActions.changeProductStatus(product.id, "DONE"));
  assert.equal(failedAudit.ok, false); assert.match(failedAudit.error ?? "", /Unique constraint/);
  assert.deepEqual(await tx.product.findUnique({ where: { id: product.id } }), product);
  assert.equal(await tx.productPercentageCompletion.count({ where: { productId: product.id } }), 0); assert.deepEqual(await money(tx), auditBefore);
}));

test("percentage/direct-late-adjustment-moscow-month", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-31T21:30:00.000Z").getTime() });
  await fixture.rollback(async (tx, rows) => {
    const manager = actorFor(await rows.user("manager", ["MANAGER"])), worker = await rows.user("worker", ["WORKER"]), project = await rows.project("month-project", { managerId: manager.id });
    for (const skipped of [false, true]) {
      const product = await rows.product(skipped ? "late" : "direct", project.id, { status: "PRODUCTION", expectedPrice: "1000", assemblerId: worker.id });
      await tx.productPercentageConfig.create({ data: { productId: product.id, kind: "ASSEMBLY", ratePercent: skipped ? null : "3", revision: 1 } });
      assert.equal(await direct.captureDirectPercentage(tx, manager, product.id, "ASSEMBLY", "STORAGE"), skipped ? "SKIPPED_ONCE" : "SETTLED");
      if (skipped) {
        await tx.productPercentageConfig.update({ where: { productId_kind: { productId: product.id, kind: "ASSEMBLY" } }, data: { ratePercent: "3", revision: 2 } });
        assert.equal(await direct.settleSkippedPercentage(tx, manager, product.id, "ASSEMBLY", "STORAGE"), "SETTLED");
      }
      const original = await tx.productPercentageCompletion.findUniqueOrThrow({ where: { productId_kind: { productId: product.id, kind: "ASSEMBLY" } } });
      const first = await tx.payrollEntry.findFirstOrThrow({ where: { productId: product.id } });
      assert.equal(first.month, "2026-11"); assert.equal(first.amount.toFixed(2), "30.00");
      await tx.productPercentageConfig.update({ where: { productId_kind: { productId: product.id, kind: "ASSEMBLY" } }, data: { ratePercent: "4", revision: { increment: 1 } } });
      assert.equal((await direct.adjustSettledPercentage(tx, manager, product.id, "ASSEMBLY", "4", randomUUID())).delta, "10.00");
      const adjustment = await tx.payrollEntry.findFirstOrThrow({ where: { productId: product.id, percentageAdjustmentId: { not: null } } });
      assert.equal(adjustment.month, "2026-11"); assert.equal(adjustment.amount.toFixed(2), "10.00");
      assert.deepEqual(await tx.productPercentageCompletion.findUnique({ where: { id: original.id } }), original);
    }
  });
});

async function turnoverContext(tx: Prisma.TransactionClient, rows: PostgresRows, total = "10000", percent = "3") {
  const c = await cashContext(tx, rows, "0"), employee = await rows.user("turnover-payee", ["MANAGER", "ENGINEER"], { payScheme: "PERCENT_TURNOVER", payPercent: percent });
  const paidAt = new Date("2000-01-15T09:00:00Z"), split = total === "19999999999.98", amount = split ? "9999999999.99" : total;
  // Два максимальных Decimal(12,2) дают больший SUM; отдельные amount/BYN остаются допустимыми.
  const payment = await tx.payment.create({ data: { cashAccountId: c.account.id, amount, bynAmount: amount, paidAt } });
  if (split) await tx.payment.create({ data: { cashAccountId: c.account.id, amount, bynAmount: amount, paidAt } });
  const transaction = async <T>(operation: (inner: Prisma.TransactionClient) => Promise<T>) => operation(tx);
  return { ...c, employee, payment, transaction };
}

for (const vector of [
  { id: "topup", total: "10000", percent: "3", prior: null, amount: "300.00" },
  { id: "saved-foreign", total: "1000", percent: "5", prior: "30", amount: "20.00" },
  { id: "decimal-large", total: "19999999999.98", percent: "0.01", prior: null, amount: "2000000.00" },
  { id: "zero", total: "0", percent: "3", prior: null, amount: null },
]) test(`turnover/immutable-history-basis/${vector.id}`, async () => fixture.rollback(async (tx, rows) => {
  const c = await turnoverContext(tx, rows, vector.total, vector.percent);
  const frozen = await tx.payrollEntry.create({ data: { userId: c.employee.id, month: "2000-01", scheme: "PRODUCT_PERCENT_ENGINEERING", amount: "150", bynAmount: "150", currency: "BYN" } });
  if (vector.prior) await tx.payrollEntry.create({ data: { userId: c.employee.id, month: "2000-01", scheme: "PERCENT_TURNOVER", amount: "10", bynAmount: vector.prior, currency: "USD" } });
  await rows.user("pure-engineer", ["ENGINEER"], { payScheme: "PERCENT_TURNOVER", payPercent: vector.percent });
  const first = await turnover.accrueTurnoverCore(c.actor, "2000-01", c.transaction);
  assert.equal(first.ok, true); if (!first.ok) return;
  assert.equal(first.accruedCount, vector.amount === null ? 0 : 1);
  if (vector.amount) {
    assert.equal(first.earnings[0].amount, vector.amount); assert.equal(first.earnings[0].userId, c.employee.id);
    const audit = await tx.changeLog.findFirstOrThrow({ where: { entityId: first.earnings[0].payrollEntryId } });
    assert.deepEqual((audit.newValue as { basis: unknown }).basis, { start: "1999-12-31T21:00:00.000Z", end: "2000-01-31T21:00:00.000Z", currency: "BYN",
      totalByn: new Prisma.Decimal(vector.total).toFixed(2), paymentsCount: vector.id === "decimal-large" ? 2 : 1, percent: vector.percent, priorByn: vector.prior ? "30.00" : "0.00",
      expectedByn: vector.prior ? "50.00" : vector.amount, deltaByn: vector.amount });
    const event = await tx.domainEvent.findUniqueOrThrow({ where: { id: first.earnings[0].eventId } });
    assert.equal((event.payload as { payrollEntryId: string }).payrollEntryId, audit.entityId); assert.equal((event.payload as { basis?: unknown }).basis, undefined);
  }
  assert.deepEqual(await tx.payrollEntry.findUnique({ where: { id: frozen.id } }), frozen);
  if (vector.id === "topup") {
    const initial = await money(tx);
    await tx.payment.update({ where: { id: c.payment.id }, data: { amount: "12000", bynAmount: "12000" } });
    const topup = await turnover.accrueTurnoverCore(c.actor, "2000-01", c.transaction);
    assert.ok(topup.ok); assert.equal(topup.earnings[0].amount, "60.00"); assert.equal(topup.earnings[0].isTopUp, true);
    const history = await tx.payrollEntry.findMany({ orderBy: { id: "asc" } });
    assert.equal((await turnover.accrueTurnoverCore(c.actor, "2000-01", c.transaction)).ok, true);
    await tx.payment.update({ where: { id: c.payment.id }, data: { amount: "8000", bynAmount: "8000" } });
    const decrease = await turnover.accrueTurnoverCore(c.actor, "2000-01", c.transaction);
    assert.ok(decrease.ok); assert.equal(decrease.accruedCount, 0); assert.deepEqual(await tx.payrollEntry.findMany({ orderBy: { id: "asc" } }), history);
    for (const row of initial[1]) assert.ok(history.some(actual => actual.id === row.id && actual.amount.eq(row.amount)));
  }
}));

test("turnover/combined-estimate-debt-pure-engineer-unknown-and-period-refusal", async () => fixture.rollback(async (tx, rows) => {
  const c = await turnoverContext(tx, rows, "2000", "5"), now = payrollMonth();
  const frozen = await tx.payrollEntry.createMany({ data: [
    { userId: c.employee.id, month: "2000-01", scheme: "PRODUCT_PERCENT_ENGINEERING", amount: "150", bynAmount: "150" },
    { userId: c.employee.id, month: "2000-01", scheme: "PIECE", amount: "1000", bynAmount: "1000" },
    { userId: c.employee.id, month: now, scheme: "PRODUCT_PERCENT_ENGINEERING", amount: "50", bynAmount: "50" },
    { userId: c.employee.id, month: now, scheme: "PIECE", amount: "25", bynAmount: "25" },
  ] }); assert.equal(frozen.count, 4);
  const stamp = new Date("2000-01-02T00:00:00.000Z");
  await tx.payout.create({ data: { userId: c.employee.id, amount: "100", month: "2000-01", payrollCurrency: "BYN", bynAmount: "100",
    cashAccountId: c.account.id, cashAmount: "100", cashCurrency: "BYN", cashRate: "1", payrollRate: "1", cashRateDate: stamp, payrollRateDate: stamp } });
  const originalHistory = await tx.payrollEntry.findMany({ where: { userId: c.employee.id }, orderBy: { id: "asc" } });
  await turnover.accrueTurnoverCore(c.actor, "2000-01", c.transaction);
  assert.deepEqual(await tx.payrollEntry.findMany({ where: { id: { in: originalHistory.map(row => row.id) } }, orderBy: { id: "asc" } }), originalHistory);
  assert.equal((await tx.user.findUniqueOrThrow({ where: { id: c.employee.id } })).payScheme, "PERCENT_TURNOVER");
  await on(tx, c.actor, async () => {
    assert.equal((await payroll.getCurrentMonthEstimates())[c.employee.id], 75);
    assert.equal((await payroll.getEmployeeDues()).find(user => user.userId === c.employee.id)?.due, 1150);
    await tx.user.update({ where: { id: c.employee.id }, data: { roles: ["ENGINEER"] } });
    const prior = await money(tx), pure = await turnover.accrueTurnoverCore(c.actor, "2000-01", c.transaction);
    assert.equal(pure.ok, false); assert.deepEqual(await payroll.getTurnoverAccruals("2000-01"), []); assert.deepEqual(await money(tx), prior);
    assert.equal((await payroll.getEmployeeDues()).find(user => user.userId === c.employee.id)?.due, 1150);
  });
  const second = await rows.user("unknown-payee", ["MANAGER"], { payScheme: "PERCENT_TURNOVER", payPercent: "3" });
  await tx.payrollEntry.create({ data: { userId: second.id, month: "2000-01", scheme: "PERCENT_TURNOVER", amount: "10", currency: "USD", bynAmount: null } });
  const before = await money(tx), unknown = await turnover.accrueTurnoverCore(c.actor, "2000-01", c.transaction);
  assert.equal(unknown.ok, false); if (!unknown.ok) assert.match(unknown.error, /BYN/); assert.deepEqual(await money(tx), before);
  let entered = 0;
  const forbidden = async <T>(operation: (inner: Prisma.TransactionClient) => Promise<T>): Promise<T> => { void operation; entered++; throw Error("UNEXPECTED_TRANSACTION"); };
  await assert.rejects(turnover.accrueTurnoverCore({ ...c.actor, roles: ["WORKER"] }, "2000-01", forbidden), /прав/);
  for (const month of ["2025-13", "0000-01", now, "9999-12"]) assert.equal((await turnover.accrueTurnoverCore(c.actor, month, forbidden)).ok, false);
  assert.equal(entered, 0);
}));

for (const step of ["payrollEntry", "changeLog", "domainEvent"] as const) test(`turnover/second-payee-native-${step}-failure-whole-command-rollback`, async () => fixture.rollback(async (tx, rows) => {
  const c = await turnoverContext(tx, rows), second = await rows.user("turnover-second", ["MANAGER"], { payScheme: "PERCENT_TURNOVER", payPercent: "3" }), before = await money(tx);
  let creates = 0, firstId = "", witnessed = false;
  const fault = new Proxy(tx, { get(target, key) {
    if (key !== step) return Reflect.get(target, key);
    return new Proxy(target[step], { get(model, method) {
      if (method !== "create") return Reflect.get(model, method);
      return async (args: { data: Record<string, unknown> }) => {
        const create = Reflect.get(model, "create") as unknown as (data: { data: Record<string, unknown> }) => Promise<{ id: string }>;
        if (++creates === 2) {
          assert.equal(await tx.payrollEntry.count({ where: { userId: { in: [c.employee.id, second.id] } } }), step === "payrollEntry" ? 1 : 2);
          assert.equal(await tx.domainEvent.count({ where: { actor: c.actor.id } }), 1); witnessed = true;
          return Reflect.apply(create, model, [{ ...args, data: { ...args.data, id: firstId } }]);
        }
        const saved = await Reflect.apply(create, model, [args]); firstId = saved.id; return saved;
      };
    } });
  } });
  await rejectedSql(tx, () => turnover.accrueTurnoverCore(c.actor, "2000-01", async operation => operation(fault)), /Unique constraint/);
  assert.equal(witnessed, true, "FIRST_PAYEE_WRITES_EXISTED_BEFORE_SECOND_FAILED"); assert.deepEqual(await money(tx), before);
}));

const gate = () => { let resolve = () => {}; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; };
function observedClient(db: PrismaClient, begin: (tx: Prisma.TransactionClient) => Promise<void>) {
  return new Proxy(db, { get(target, key) {
    if (key === "$transaction") return <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>, options?: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel }) =>
      target.$transaction(async tx => { await begin(tx); return operation(tx); }, options);
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}
async function waitForMoneyLock(holder: Prisma.TransactionClient, pid: number) {
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline) {
    const rows = await holder.$queryRaw<{ pid: number }[]>`SELECT l.pid FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid
      WHERE l.pid=${pid} AND l.locktype='advisory' AND l.classid=18435 AND l.objid=55001 AND NOT l.granted AND a.wait_event_type='Lock'`;
    if (rows.length) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail("REAL_DISTINCT_BACKEND_LOCK_WAIT_NOT_OBSERVED");
}

test("cash/payment-stock-logistics-versus-advance-real-lock-both-orders", async () => {
  const coordinator = await import("../../src/server/transactions/coordinator");
  for (const mode of ["payment", "stock", "logistics"] as const) for (const expenseFirst of [false, true]) {
    const label = `${mode}-${expenseFirst ? "expense-first" : "advance-first"}`, rows = { ...fixture, id: (name: string) => fixture.id(`${label}-${name}`),
      user: (name: string, roles: Role[]) => fixture.user(`${label}-${name}`, roles), project: (name: string) => fixture.project(`${label}-${name}`) };
    const c = await paymentContext(fixture.db, rows, true), ready = gate(), release = gate(), secondStarted = gate();
    let holder: Prisma.TransactionClient | undefined, firstPid = 0, secondPid = 0, entered = false;
    const advanceInput: CashPayoutInput = { kind: "ADVANCE", userId: c.employee.id, cashAccountId: c.account.id, cashAmount: "600.00", expectedCashCurrency: "BYN", requestId: randomUUID(), description: "Шкаф169" };
    const advance = (tx: Prisma.TransactionClient) => cash.issuePayoutCore(c.actor, advanceInput, rates(), tx);
    let expense: (tx: Prisma.TransactionClient) => Promise<unknown> = tx => payments.createPaymentInTransaction(c.actor, { ...c.input, amount: 500 }, { ...c.prepared, amount: 500, bynAmount: 500 }, tx);
    if (mode !== "payment") {
      await fixture.db.user.update({ where: { id: c.actor.id }, data: { roles: ["PROCUREMENT"] } }); c.actor.roles = ["PROCUREMENT"];
      if (mode === "stock") {
        const state = await fixture.db.warehouseAccountingState.upsert({ where: { id: "main" },
          create: { id: "main", phase: "ACTIVE", runId: fixture.id("concurrent-stock-run"), beforePrices: [], beforeBalances: [] }, update: {} });
        assert.equal(state.phase, "ACTIVE", "CI_WAREHOUSE_PHASE_MISMATCH");
        const unit = await fixture.db.materialUnit.create({ data: { name: rows.id("unit") } });
        const material = await fixture.db.material.create({ data: { name: rows.id("material"), unitId: unit.id } });
        const input = { clientMutationId: randomUUID(), materialId: material.id, quantity: "5", unitPrice: "100", currency: "BYN" as const,
          cashAccountId: c.account.id, expenseArticleId: c.article.id };
        const prepared = (await purchase.prepareStockPurchase(c.actor, input, fixture.db)).prepared;
        expense = tx => purchase.createStockPurchaseInTransaction(c.actor, input, prepared, tx);
      } else {
        const product = await fixture.product(`${label}-shipment`, c.project!.id, { status: "PRODUCTION" });
        const date = new Date().toISOString().slice(0, 10);
        const trip = await trips.createLogisticsTripCore(c.actor.id, { date, clientMutationId: randomUUID(), shares: [{ projectId: c.project!.id, percentBps: 10000 }],
          lines: [{ projectId: c.project!.id, kind: "PRODUCT", productId: product.id, quantity: 1 }] }, coordinator.createMutationTransaction(fixture.db));
        const document = await fixture.db.logisticsDocument.create({ data: { tripId: trip.tripId, clientMutationId: randomUUID(), requestFingerprint: rows.id("ttn"), uploadedById: c.actor.id,
          fileName: "ТТН.pdf", mimeType: "application/pdf", size: 4, contentHash: rows.id("ttn"), storageKey: rows.id("ttn"), storageMode: "s3", state: "READY", stage: "ISSUED", readyAt: new Date() } });
        const input = { tripId: trip.tripId, expectedRevision: trip.revision, clientMutationId: randomUUID(), amount: "500.00", currency: "BYN" as const,
          cashAccountId: c.account.id, documentIds: [document.id] };
        const prepare = await import("../../src/server/logistics/prepare-payment");
        const prepared = await prepare.prepareLogisticsPayment(input, date, fixture.db);
        expense = tx => logistics.postLogisticsInTransaction(c.actor.id, input, "post", prepared, tx);
      }
    }
    const originalEvents = await fixture.db.domainEvent.findMany({ where: { actor: c.actor.id }, select: { id: true } });
    const first = coordinator.createMutationTransaction(fixture.db)(async tx => {
      holder = tx; firstPid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0].pid;
      const result = await (expenseFirst ? expense(tx) : advance(tx)); ready.resolve(); await release.promise; return result;
    });
    void first.catch(() => ready.resolve());
    let second: Promise<{ ok: boolean; error?: string; outcome?: string }> | undefined;
    try {
      await ready.promise; assert.ok(holder);
      const peer = observedClient(fixture.peer, async tx => {
        secondPid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0].pid;
        secondStarted.resolve();
      });
      second = on(peer, c.actor, () => expenseFirst ? service.executeCashPayout(c.actor, advanceInput)
        : mode === "payment" ? payments.createPaymentCore(c.actor, { ...c.input, amount: 500 })
          : coordinator.createMutationTransaction(peer)(expense).then(() => ({ ok: true }), error => ({ ok: false, error: error instanceof Error ? error.message : String(error) })));
      void second.then(() => { entered = true; secondStarted.resolve(); }, () => secondStarted.resolve());
      await secondStarted.promise; assert.notEqual(firstPid, secondPid); await waitForMoneyLock(holder, secondPid); assert.equal(entered, false);
      release.resolve(); await first;
      const loser = await second;
      assert.equal(loser.ok, false); assert.match(loser.error ?? "", /Недостаточно средств/);
      if (!expenseFirst && mode === "payment") assert.equal(loser.outcome, "ROLLED_BACK");
      assert.equal(await fixture.db.payout.count({ where: { userId: c.employee.id } }), expenseFirst ? 0 : 1);
      assert.equal(await fixture.db.payment.count({ where: { cashAccountId: c.account.id, direction: "EXPENSE" } }), expenseFirst ? 1 : 0);
      assert.equal((await cash.readCashBalance(fixture.db, c.account.id)).toFixed(2), expenseFirst ? "500.00" : "400.00");
      const expectedEventTypes = !expenseFirst ? ["payroll.payout"] : mode === "stock" ? ["stock.movement.created", "expense.created"]
        : mode === "logistics" ? ["logistics.trip.posted"] : ["expense.created"];
      const newEvents = await fixture.db.domainEvent.findMany({ where: { actor: c.actor.id, id: { notIn: originalEvents.map(row => row.id) } }, select: { type: true } });
      assert.deepEqual(newEvents.map(row => row.type).sort(), expectedEventTypes.sort());
      if (mode === "stock") assert.equal(await fixture.db.stockPurchase.count({ where: { actorId: c.actor.id } }), expenseFirst ? 1 : 0);
      if (mode === "logistics") assert.equal(await fixture.db.logisticsPosting.count({ where: { actorId: c.actor.id } }), expenseFirst ? 1 : 0);
    } finally { release.resolve(); await Promise.allSettled([first, ...(second ? [second] : [])]); }
  }
});

test("warehouse/paid-and-delete-real-replay-capacity-stale-preview-and-held-issue", async () => {
  const coordinator = await import("../../src/server/transactions/coordinator");
  const rows = { ...fixture, id: (name: string) => fixture.id(`stock-race-${name}`), user: (name: string, roles: Role[]) => fixture.user(`stock-race-${name}`, roles) };
  const c = await cashContext(fixture.db, rows, "100");
  await fixture.db.user.update({ where: { id: c.actor.id }, data: { roles: ["ADMIN"] } }); c.actor.roles = ["ADMIN"];
  const state = await fixture.db.warehouseAccountingState.upsert({ where: { id: "main" }, create: { id: "main", phase: "ACTIVE", runId: rows.id("run"), beforePrices: [], beforeBalances: [] }, update: {} });
  assert.equal(state.phase, "ACTIVE", "CI_WAREHOUSE_PHASE_MISMATCH");
  const unit = await fixture.db.materialUnit.create({ data: { name: rows.id("unit") } }), material = await fixture.db.material.create({ data: { name: rows.id("material"), unitId: unit.id } });
  const article = await fixture.db.expenseArticle.create({ data: { name: rows.id("article"), code: ((await fixture.db.expenseArticle.aggregate({ _max: { code: true } }))._max.code ?? 0) + 1 } });
  const project = await fixture.project("stock-race-project"), product = await fixture.product("stock-race-product", project.id, { status: "PRODUCTION" });
  const input = { clientMutationId: randomUUID(), materialId: material.id, quantity: "3", unitPrice: "20", currency: "BYN" as const, cashAccountId: c.account.id, expenseArticleId: article.id };
  const prepared = (await purchase.prepareStockPurchase(c.actor, input, fixture.db)).prepared;
  for (const mode of ["purchase-replay", "purchase-cap", "delete-replay", "delete-issue"] as const) {
    if (mode === "purchase-cap") await fixture.db.payment.create({ data: { cashAccountId: c.account.id, direction: "INCOME", amount: "60", bynAmount: "60" } });
    let firstOperation: (tx: Prisma.TransactionClient) => Promise<unknown>, secondOperation: (tx: Prisma.TransactionClient) => Promise<unknown>;
    if (mode.startsWith("purchase")) {
      const data = mode === "purchase-replay" ? input : { ...input, clientMutationId: randomUUID() };
      firstOperation = tx => purchase.createStockPurchaseInTransaction(c.actor, data, prepared, tx);
      secondOperation = tx => purchase.createStockPurchaseInTransaction(c.actor, mode === "purchase-replay" ? data : { ...data, clientMutationId: randomUUID() }, prepared, tx);
    } else {
      const receipt = await fixture.db.stockPurchase.findFirstOrThrow({ where: { actorId: c.actor.id, movement: { deletionId: null } } });
      if (mode === "delete-issue") {
        const stale = await stockDeletion.previewMovementDeletionInTransaction(fixture.db, c.actor, receipt.movementId);
        await coordinator.createMutationTransaction(fixture.db)(tx => stock.warehouseMove(tx, c.actor, { kind: "INCOME", materialId: material.id, quantity: "1", unitPrice: "20", clientMutationId: randomUUID() }));
        const before = await money(fixture.db), balance = await fixture.db.warehouseBalance.findUnique({ where: { materialId: material.id } });
        await assert.rejects(coordinator.createMutationTransaction(fixture.db)(tx => stockDeletion.deleteMovementInTransaction(tx, c.actor, { movementId: receipt.movementId, planFingerprint: stale.planFingerprint, clientMutationId: randomUUID() })), /Обновите расчёт/);
        assert.deepEqual(await money(fixture.db), before); assert.deepEqual(await fixture.db.warehouseBalance.findUnique({ where: { materialId: material.id } }), balance);
      }
      const preview = await stockDeletion.previewMovementDeletionInTransaction(fixture.db, c.actor, receipt.movementId);
      const data = { movementId: receipt.movementId, planFingerprint: preview.planFingerprint, clientMutationId: randomUUID() };
      firstOperation = tx => stockDeletion.deleteMovementInTransaction(tx, c.actor, data);
      secondOperation = mode === "delete-replay" ? firstOperation : tx => stock.warehouseMove(tx, c.actor, { kind: "EXPENSE", productId: product.id, materialId: material.id, quantity: "2", clientMutationId: randomUUID() });
    }
    const ready = gate(), release = gate(), entered = gate(); let holder: Prisma.TransactionClient | undefined, firstPid = 0, secondPid = 0;
    const first = fixture.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)`;
      holder = tx; firstPid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0].pid;
      const value = await firstOperation(tx); ready.resolve(); await release.promise; return value;
    }, { maxWait: 5000, timeout: 15000 });
    void first.catch(() => ready.resolve()); let second: Promise<unknown> | undefined;
    try {
      await ready.promise; assert.ok(holder);
      const peer = observedClient(fixture.peer, async tx => { secondPid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0].pid; entered.resolve(); });
      second = coordinator.createMutationTransaction(peer)(secondOperation); void second.catch(() => entered.resolve());
      await entered.promise; assert.ok(firstPid > 0 && secondPid > 0 && firstPid !== secondPid); await waitForMoneyLock(holder, secondPid);
      release.resolve(); const results = await Promise.allSettled([first, second]);
      assert.equal(results[0].status, "fulfilled");
      if (mode.endsWith("replay")) {
        const values = results.map(result => { assert.equal(result.status, "fulfilled"); return result.value as { id?: string; receipt?: { id: string }; repeated: boolean }; });
        const id = values[0].receipt?.id ?? values[0].id; assert.equal(typeof id, "string"); assert.equal(values[1].receipt?.id ?? values[1].id, id);
        assert.equal(values.filter(value => !value.repeated).length, 1);
      } else {
        assert.equal(results[1].status, "rejected"); if (results[1].status === "rejected") assert.match(String(results[1].reason), mode === "purchase-cap" ? /Недостаточно средств в выбранной кассе/ : /Недостаточно материала/);
      }
    } finally { release.resolve(); await Promise.allSettled([first, ...(second ? [second] : [])]); }
    assert.equal((await cash.readCashBalance(fixture.db, c.account.id)).toFixed(2), mode.startsWith("purchase") ? "40.00" : mode === "delete-replay" ? "100.00" : "160.00");
  }
  assert.equal(await fixture.db.stockPurchase.count({ where: { actorId: c.actor.id } }), 2);
  assert.equal(await fixture.db.warehouseMovementDeletion.count({ where: { actorId: c.actor.id } }), 2);
  const balance = await fixture.db.warehouseBalance.findUniqueOrThrow({ where: { materialId: material.id } });
  assert.equal(balance.quantity.toString(), "1"); assert.equal(balance.valueByn.toFixed(2), "20.00");
});

test("cash/actual-bulk-settlement-solo-and-held-expense-race", async () => {
  const coordinator = await import("../../src/server/transactions/coordinator");
  for (const race of [false, true]) {
    const label = race ? "bulk-race" : "bulk-solo", rows = { ...fixture, id: (name: string) => fixture.id(`${label}-${name}`),
      user: (name: string, roles: Role[]) => fixture.user(`${label}-${name}`, roles), project: (name: string) => fixture.project(`${label}-${name}`) };
    const c = await paymentContext(fixture.db, rows, true);
    const accrued = await fixture.db.payrollEntry.create({ data: { userId: c.employee.id, month: "2000-01", amount: "600", bynAmount: "600" } });
    if (!race) {
      const solo = await on(fixture.db, c.actor, () => actions.settleAll(payrollMonth(), c.account.id));
      assert.equal(solo.ok, true); assert.equal(solo.paidCount, 1); assert.equal(solo.totalPaid, 600);
      assert.equal((await cash.readCashBalance(fixture.db, c.account.id)).toFixed(2), "400.00");
      continue;
    }
    const ready = gate(), release = gate(), started = gate();
    let holder: Prisma.TransactionClient | undefined, holderPid = 0, waiterPid = 0, complete = false;
    const expense = coordinator.createMutationTransaction(fixture.db)(async tx => {
      holder = tx; holderPid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0].pid;
      await payments.createPaymentInTransaction(c.actor, { ...c.input, amount: 500 }, { ...c.prepared, amount: 500, bynAmount: 500 }, tx);
      ready.resolve(); await release.promise;
    });
    void expense.catch(() => ready.resolve());
    let bulk: Promise<Awaited<ReturnType<typeof actions.settleAll>>> | undefined;
    try {
      await ready.promise; assert.ok(holder);
      const peer = observedClient(fixture.peer, async tx => {
        waiterPid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0].pid; started.resolve();
      });
      bulk = on(peer, c.actor, () => actions.settleAll(payrollMonth(), c.account.id));
      void bulk.then(() => { complete = true; started.resolve(); }, () => started.resolve());
      await started.promise; assert.notEqual(holderPid, waiterPid); await waitForMoneyLock(holder, waiterPid); assert.equal(complete, false);
      release.resolve(); await expense;
      const result = await bulk;
      assert.equal(result.ok, true); assert.equal(result.paidCount, 0); assert.ok(result.shortPaid?.includes(c.employee.name));
      assert.equal(await fixture.db.payout.count({ where: { userId: c.employee.id } }), 0);
      assert.deepEqual(await fixture.db.payrollEntry.findUnique({ where: { id: accrued.id } }), accrued);
      assert.equal((await cash.readCashBalance(fixture.db, c.account.id)).toFixed(2), "500.00");
    } finally { release.resolve(); await Promise.allSettled([expense, ...(bulk ? [bulk] : [])]); }
  }
});

test("turnover/ten-real-commands-serialized-reread-rate-and-turnover", async () => {
  const c = await turnoverContext(fixture.db, { ...fixture, user: (label: string, roles: Role[], fields = {}) => fixture.user(`concurrent-${label}`, roles, fields),
    id: (label: string) => fixture.id(`concurrent-${label}`) }), coordinator = await import("../../src/server/transactions/coordinator");
  const initial = await Promise.all(Array.from({ length: 10 }, (_, index) => turnover.accrueTurnoverCore(c.actor, "2000-01", coordinator.createMutationTransaction(index % 2 ? fixture.db : fixture.peer))));
  assert.ok(initial.every(result => result.ok)); assert.equal(initial.reduce((sum, result) => sum + (result.ok ? result.accruedCount : 0), 0), 1);
  const original = await fixture.db.payrollEntry.findFirstOrThrow({ where: { userId: c.employee.id, month: "2000-01" } });
  assert.equal(original.amount.toFixed(2), "300.00");
  assert.equal(await fixture.db.payrollEntry.count({ where: { userId: c.employee.id } }), 1);
  const ready = gate(), release = gate(), started = gate(); let holder: Prisma.TransactionClient | undefined, holderPid = 0, waiterPid = 0;
  const held = fixture.db.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435, 55001)`;
    holder = tx; holderPid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0].pid; ready.resolve(); await release.promise;
    await tx.payment.update({ where: { id: c.payment.id }, data: { amount: "12000", bynAmount: "12000" } });
    await tx.user.update({ where: { id: c.employee.id }, data: { payPercent: "5" } });
  }, { timeout: 15000 });
  void held.catch(() => ready.resolve());
  let first: Promise<Awaited<ReturnType<typeof turnover.accrueTurnoverCore>>> | undefined;
  try {
    await ready.promise; assert.ok(holder);
    first = turnover.accrueTurnoverCore(c.actor, "2000-01", async operation => fixture.peer.$transaction(async tx => {
      waiterPid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0].pid; started.resolve();
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435, 55001)`; return operation(tx);
    }, { isolationLevel: "ReadCommitted", maxWait: 5000, timeout: 15000 }));
    void first.catch(() => started.resolve());
    await started.promise; assert.notEqual(holderPid, waiterPid); await waitForMoneyLock(holder, waiterPid); release.resolve(); await held;
    const result = await first; assert.ok(result.ok); assert.equal(result.accruedCount, 1); assert.equal(result.earnings[0].amount, "300.00");
    const audit = await fixture.db.changeLog.findFirstOrThrow({ where: { actorId: c.actor.id, entityId: result.earnings[0].payrollEntryId } });
    assert.equal((audit.newValue as { basis: { expectedByn: string } }).basis.expectedByn, "600.00");
    assert.deepEqual(await fixture.db.payrollEntry.findUnique({ where: { id: original.id } }), original);
    assert.equal((await fixture.db.payrollEntry.aggregate({ where: { userId: c.employee.id }, _sum: { amount: true } }))._sum.amount!.toFixed(2), "600.00");
    assert.equal(await fixture.db.payrollEntry.count({ where: { userId: c.employee.id } }), 2);
    assert.equal(await fixture.db.changeLog.count({ where: { actorId: c.actor.id } }), 2); assert.equal(await fixture.db.domainEvent.count({ where: { actor: c.actor.id } }), 2);
  } finally { release.resolve(); await Promise.allSettled([held, ...(first ? [first] : [])]); }
});
