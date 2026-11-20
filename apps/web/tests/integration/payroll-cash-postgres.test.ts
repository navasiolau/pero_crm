import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { Prisma } from "@prisma/client";
import type { CashRates } from "../../src/lib/cash-ledger";
import { guardedModuleCache } from "../helpers/guarded-module-cache";
import { createPostgresFixture, moneyRows, rejectedSql, savedOrgBalance, type PostgresRows } from "./postgres.fixture";

let fixture: Awaited<ReturnType<typeof createPostgresFixture>>;
let cash: typeof import("../../src/server/payroll/cash-core");
let percentage: typeof import("../../src/server/product-percentage-pay/core");
let coordinator: typeof import("../../src/server/transactions/coordinator");
let queries: typeof import("../../src/server/payroll/queries"), scope: ReturnType<typeof guardedModuleCache>;
const readers = new AsyncLocalStorage<Prisma.TransactionClient>();
before(async () => {
  fixture = await createPostgresFixture("payroll-cash");
  scope = guardedModuleCache(new URL("../ci169-payroll-cash-scope.ts", import.meta.url).href, {
    targets: ["../src/server/payroll/queries"], allowedOverrides: [], overrides: {}, prisma: new Proxy({}, { get(_target, key) {
      const db = readers.getStore() ?? fixture.db, value: unknown = Reflect.get(db, key);
      return typeof value === "function" ? value.bind(db) : value;
    } }),
  });
  queries = scope.load("../src/server/payroll/queries");
  [cash, percentage, coordinator] = await Promise.all([import("../../src/server/payroll/cash-core"),
    import("../../src/server/product-percentage-pay/core"), import("../../src/server/transactions/coordinator")]);
});
after(async () => { if (fixture) try { scope?.restore(); await fixture.verifyProtected(); } finally { await fixture.dispose(); } });
const fixedRates: CashRates = { asOf: "2026-10-31", cash: { currency: "BYN", rate: "1.000000", date: "2026-10-31" }, payroll: { currency: "BYN", rate: "1.000000", date: "2026-10-31" } };
const gate = () => { let resolve = () => {}; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; };
async function cashRows(tx: Prisma.TransactionClient, rows: PostgresRows, amount = "1000") {
  const manager = await rows.user("accountant", ["ACCOUNTANT"]), employee = await rows.user("employee", ["WORKER"], { payScheme: "NONE" });
  const account = await tx.cashAccount.create({ data: { id: rows.id("cash"), name: "Синтетическая касса169", currency: "BYN" } });
  await tx.payment.create({ data: { id: rows.id("opening"), cashAccountId: account.id, direction: "INCOME", amount, bynAmount: amount, currency: "BYN" } });
  return { actor: { id: manager.id, name: manager.name, roles: manager.roles, source: "web" as const }, employee, account,
    input: { kind: "ADVANCE" as const, userId: employee.id, cashAccountId: account.id, cashAmount: "120.00", expectedCashCurrency: "BYN" as const, requestId: randomUUID(), description: "Синтетическая работа169" } };
}
async function historicalPayout(tx: Prisma.TransactionClient, rows: PostgresRows, userId: string, bynAmount: "60" | "0" | "200") {
  const stamp = new Date("2020-01-01T00:00:00.000Z"), rate = bynAmount === "200" ? "10.000000" : bynAmount === "60" ? "3.000000" : "0.000001";
  const account = await tx.cashAccount.create({ data: { id: rows.id("historical-usd"), name: "Историческая USD касса169", currency: "USD" } });
  await tx.payment.create({ data: { cashAccountId: account.id, direction: "INCOME", amount: "20", currency: "USD", rate, bynAmount, rateDate: stamp, paidAt: stamp } });
  // Существующий расход прошлого периода компенсирует финансирование старой кассы: заданный баланс организации не меняется.
  if (bynAmount !== "0") await tx.payment.create({ data: { direction: "EXPENSE", amount: bynAmount, currency: "BYN", rate: "1", bynAmount, rateDate: stamp, paidAt: stamp } });
  const payout = await tx.payout.create({ data: { userId, month: "2020-01", kind: "SALARY", amount: "20", payrollCurrency: "USD", bynAmount,
    cashAccountId: account.id, cashAmount: "20", cashCurrency: "USD", cashRate: rate, payrollRate: rate, cashRateDate: stamp, payrollRateDate: stamp } });
  assert.equal((await cash.readCashBalance(tx, account.id)).toFixed(2), "0.00", "HISTORICAL_CASH_FULLY_FUNDED_AND_PAID");
  return payout;
}

for (const vector of [
  { id: "fixed-usd", accruedByn: "300", payoutCurrency: "USD", payoutByn: "60", due: 240, balance: "890.00" },
  { id: "unknown", accruedByn: "300", payoutCurrency: null, payoutByn: null, due: null, balance: null },
  { id: "fixed-zero", accruedByn: "0", payoutCurrency: "USD", payoutByn: "0", due: 0, balance: "950.00" },
] as const) test(`cash/fixed-history-nulls-zero/${vector.id}`, async () => fixture.rollback(async (tx, rows) => {
  const startingOrg = await savedOrgBalance(tx), originalMoney = await moneyRows(tx);
  const c = await cashRows(tx, rows);
  await tx.payment.create({ data: { direction: "EXPENSE", amount: "50", bynAmount: "50", cashAccountId: c.account.id } });
  await tx.payrollEntry.create({ data: { userId: c.employee.id, month: "2020-01", scheme: "PIECE", amount: "100", currency: "USD", bynAmount: vector.accruedByn } });
  if (vector.payoutByn === null) await tx.payout.create({ data: { userId: c.employee.id, month: "2020-01", kind: "SALARY", amount: "20", payrollCurrency: null, bynAmount: null } });
  else await historicalPayout(tx, rows, c.employee.id, vector.payoutByn);
  const entries = await tx.payrollEntry.findMany({ where: { userId: c.employee.id } }), payouts = await tx.payout.findMany({ where: { userId: c.employee.id } });
  assert.equal(payouts[0].payrollCurrency, vector.payoutCurrency);
  await readers.run(tx, async () => {
    const dues = await queries.getEmployeeDues(), own = dues.find(row => row.userId === c.employee.id);
    if (vector.due === 0) assert.equal(own, undefined); else assert.equal(own?.due, vector.due);
    const org = await queries.getOrgBalance();
    assert.equal(org === null ? null : new Prisma.Decimal(org).minus(startingOrg).toFixed(2), vector.balance);
    if (vector.id === "fixed-usd") assert.equal(await queries.getPayrollCurrency(), "BYN");
  });
  if (vector.balance === null) await assert.rejects(cash.readOrgBalance(tx, "9"), /сохранённого BYN/);
  else {
    assert.equal((await cash.readOrgBalance(tx, "9")).minus(startingOrg).toFixed(2), vector.balance);
    if (vector.id === "fixed-usd") assert.equal((await cash.readOrgBalance(tx, "9", "0", "30")).minus(startingOrg).toFixed(2), "860.00");
  }
  assert.deepEqual(await tx.payrollEntry.findMany({ where: { userId: c.employee.id } }), entries);
  assert.deepEqual(await tx.payout.findMany({ where: { userId: c.employee.id } }), payouts);
  const finalMoney = await moneyRows(tx);
  assert.deepEqual(finalMoney.map(group => group.length), originalMoney.map((group, index) => group.length +
    [vector.id === "fixed-usd" ? 4 : vector.id === "fixed-zero" ? 3 : 2, 1, 1, 0, 0][index]));
  for (const [index, beforeRows] of originalMoney.entries())
    assert.deepEqual(finalMoney[index].filter(row => beforeRows.some(before => before.id === row.id)), beforeRows, "FOREIGN_FIXED_HISTORY_MONEY_UNCHANGED");
}));

test("cash/journal-preserves-payout-and-restores-the-original-advance-with-its-cash-guard", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-31T21:30:00.000Z").getTime() });
  await fixture.rollback(async (tx, rows) => {
    const c = await cashRows(tx, rows, "120");
    const admin = await rows.user("advance-undo-admin", ["ADMIN"]);
    const { deletePayoutInTransaction } = await import("../../src/server/payroll/payout-reversal");
    const { reverseJournalActionInTransaction } = await import("../../src/server/changelog/reversal-core");
    const issued = await cash.issuePayoutCore(c.actor, c.input, fixedRates, tx);
    const before = await tx.payout.findUniqueOrThrow({ where: { id: issued.payoutId } });
    await deletePayoutInTransaction(tx, c.actor, issued.payoutId);
    assert.equal((await cash.readCashBalance(tx, c.account.id)).toFixed(2), "120.00");
    await assert.rejects(cash.issuePayoutCore(c.actor, c.input, fixedRates, tx), /отменена/);
    const hidden = await tx.payout.findUniqueOrThrow({ where: { id: issued.payoutId } });
    assert.ok(hidden.deletedAt);
    const expense = await tx.payment.create({ data: { direction: "EXPENSE", cashAccountId: c.account.id, amount: "1", bynAmount: "1" } });
    const request = { entryId: hidden.lastActionId!, requestId: randomUUID(), scope: { kind: "global" } };
    await assert.rejects(reverseJournalActionInTransaction(tx, admin.id, request), /Недостаточно средств в выбранной кассе/);
    assert.ok((await tx.payout.findUniqueOrThrow({ where: { id: issued.payoutId } })).deletedAt);
    await tx.payment.update({ where: { id: expense.id }, data: { deletedAt: new Date(), deletedById: admin.id } });
    await reverseJournalActionInTransaction(tx, admin.id, request);
    assert.deepEqual(await tx.payout.findUnique({ where: { id: issued.payoutId } }), before);
    assert.equal((await cash.readCashBalance(tx, c.account.id)).toFixed(2), "0.00");
    assert.equal(await tx.payout.count({ where: { userId: c.employee.id } }), 1);
  });
});

test("cash/batch-reverses-exact-partial-membership-and-retains-accrual-snapshots", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-31T21:30:00.000Z").getTime() });
  await fixture.rollback(async (tx, rows) => {
    const c = await cashRows(tx, rows, "30");
    const second = await rows.user("batch-second", ["WORKER"]);
    const skipped = await rows.user("batch-skipped", ["WORKER"]);
    const admin = await rows.user("batch-undo-admin", ["ADMIN"]);
    const debtors = [c.employee, second, skipped];
    for (const [index, row] of debtors.entries()) await tx.payrollEntry.create({ data: { userId: row.id,
      id: rows.id(`batch-accrual-${index}`), month: "2026-10", amount: "20", bynAmount: "20" } });
    const { settlePayoutBatch } = await import("../../src/server/payroll/payout-batch");
    const { reverseJournalActionInTransaction } = await import("../../src/server/changelog/reversal-core");
    const input = { id: randomUUID(), month: "2026-10", cashAccountId: c.account.id };
    const people = debtors.map(({ id: userId, name }) => ({ userId, name }));
    const { result } = await settlePayoutBatch(tx, c.actor, input, people, fixedRates, "Пакет");
    assert.equal(result.totalPaid, "30.00");
    assert.equal(result.paidIds.length, 2);
    assert.deepEqual(result.shortPaid, [second.name, skipped.name]);
    const replay = await settlePayoutBatch(tx, c.actor, input, [], fixedRates, "Пакет");
    assert.deepEqual(replay.result, result);
    assert.equal(replay.effects.length, 0);
    const request = { entryId: `payout-batch:${input.id}`, requestId: randomUUID(), scope: { kind: "global" } };
    const undo = await reverseJournalActionInTransaction(tx, admin.id, request);
    assert.equal((await cash.readCashBalance(tx, c.account.id)).toFixed(2), "30.00");
    assert.equal(await tx.payout.count({ where: { batchId: input.id, deletedAt: { not: null } } }), 2);
    assert.equal(await tx.payout.count({ where: { userId: skipped.id } }), 0);
    await assert.rejects(settlePayoutBatch(tx, c.actor, input, people, fixedRates, "Пакет"), /уже изменён/);
    await reverseJournalActionInTransaction(tx, admin.id, { ...request, entryId: undo.reversalId, requestId: randomUUID() });
    assert.equal((await cash.readCashBalance(tx, c.account.id)).toFixed(2), "0.00");
    assert.equal(await tx.payout.count({ where: { batchId: input.id, deletedAt: null } }), 2);
    assert.equal(await tx.payrollEntry.count({ where: { userId: { in: debtors.map(row => row.id) } } }), 3);
    await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
  });
});

test("cash/journal-accrual-adjustment-preserves-raw-entry-and-protects-paid-salary", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-31T21:30:00.000Z").getTime() });
  await fixture.rollback(async (tx, rows) => {
    const c = await cashRows(tx, rows, "200");
    const admin = await rows.user("accrual-undo-admin", ["ADMIN"]);
    const source = await tx.payrollEntry.create({ data: { userId: c.employee.id, month: "2026-10", amount: "100", bynAmount: "100" } });
    const { payrollCompensationCommand } = await import("../../src/server/payroll/accrual-reversal");
    const { writeChangeLogInTransaction } = await import("../../src/server/changelog/writer");
    const { reverseJournalActionInTransaction } = await import("../../src/server/changelog/reversal-core");
    const audit = await writeChangeLogInTransaction(tx, { entity: "payrollEntry", entityId: source.id, action: "accrue",
      actorType: "user", actorId: admin.id, actorName: admin.name, newValue: { amount: "100" },
      reversal: payrollCompensationCommand(source.id, [source]) }, { entity: { label: "Синтетическое начисление" }, contexts: [] });
    const command = { entryId: audit.id, requestId: randomUUID(), scope: { kind: "global" } };
    const undo = await reverseJournalActionInTransaction(tx, admin.id, command);
    const adjustment = await tx.payrollEntry.findFirstOrThrow({ where: { compensatesId: source.id } });
    assert.equal(adjustment.amount.toFixed(2), "-100.00");
    await rejectedSql(tx, () => tx.payrollEntry.update({ where: { id: adjustment.id }, data: { amount: "0" } }), /immutable/);
    assert.equal((await cash.readPayoutDebt(tx, c.employee.id)).toFixed(2), "0.00");
    const redo = await reverseJournalActionInTransaction(tx, admin.id, { ...command, entryId: undo.reversalId, requestId: randomUUID() });
    assert.deepEqual(await tx.payrollEntry.findUnique({ where: { id: source.id } }), source);
    await cash.issuePayoutCore(c.actor, { ...c.input, kind: "SALARY", cashAmount: "60", month: "2026-10" }, fixedRates, tx);
    await assert.rejects(reverseJournalActionInTransaction(tx, admin.id,
      { ...command, entryId: redo.reversalId, requestId: randomUUID() }), /проведённой выплаты/);
    assert.equal((await cash.readPayoutDebt(tx, c.employee.id)).toFixed(2), "40.00");
    assert.equal(await tx.payrollEntry.count({ where: { compensatesId: source.id } }), 2);
  });
});

test("cash/advance-month-replay-and-rollback-outbox", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-31T21:30:00.000Z").getTime() });
  await fixture.rollback(async (tx, rows) => {
    const startingOrg = await savedOrgBalance(tx), originalMoney = await moneyRows(tx);
    const c = await cashRows(tx, rows), first = await cash.issuePayoutCore(c.actor, c.input, fixedRates, tx);
    assert.equal(first.repeated, false); assert.equal(first.month, "2026-11"); assert.equal(first.amount, "120.00"); assert.equal(first.bynAmount, "120.00");
    const payout = await tx.payout.findUniqueOrThrow({ where: { id: first.payoutId } });
    assert.equal(payout.cashRateDate!.toISOString(), "2026-10-31T00:00:00.000Z"); assert.equal(payout.payrollRateDate!.toISOString(), "2026-10-31T00:00:00.000Z");
    assert.equal(payout.payrollCurrency, "BYN"); assert.equal(payout.comment, "Синтетическая работа169");
    assert.equal((await cash.readCashBalance(tx, c.account.id)).toFixed(2), "880.00");
    assert.equal((await cash.readOrgBalance(tx, "1")).minus(startingOrg).toFixed(2), "880.00");
    const receipt = await tx.changeLog.findUniqueOrThrow({ where: { id: `payout-issue:${c.input.requestId}` } });
    t.mock.timers.setTime(new Date("2026-11-30T21:30:00.000Z").getTime());
    const repeated = await cash.issuePayoutCore(c.actor, c.input, fixedRates, tx);
    assert.equal(repeated.repeated, true); assert.equal(repeated.month, "2026-11"); assert.equal(repeated.payoutId, first.payoutId); assert.equal(repeated.eventId, null);
    assert.equal(await tx.payout.count({ where: { userId: c.employee.id } }), 1);
    assert.equal(await tx.payment.count({ where: { cashAccountId: c.account.id } }), 1); assert.equal(await tx.payrollEntry.count({ where: { userId: c.employee.id } }), 0);
    assert.equal(await tx.domainEvent.count({ where: { actor: c.actor.id, type: "payroll.payout" } }), 1);
    assert.deepEqual(await tx.changeLog.findUnique({ where: { id: receipt.id } }), receipt);
    await assert.rejects(cash.issuePayoutCore(c.actor, { ...c.input, cashAmount: "121.00" }, fixedRates, tx), /уже использован/);
    const finalMoney = await moneyRows(tx);
    assert.deepEqual(finalMoney.map(group => group.length), originalMoney.map((group, index) => group.length + [1, 0, 1, 1, 1][index]));
    for (const [index, beforeRows] of originalMoney.entries())
      assert.deepEqual(finalMoney[index].filter(row => beforeRows.some(before => before.id === row.id)), beforeRows, "FOREIGN_ADVANCE_MONEY_UNCHANGED");
    // Общая fixture после abort сравнивает все строки и SQL schema: payout, receipt и outbox не сохраняются.
  });
});

test("cash/salary-past-moscow-month-and-current-record-currencies", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-31T21:30:00.000Z").getTime() });
  await fixture.rollback(async (tx, rows) => {
    const startingOrg = await savedOrgBalance(tx), originalMoney = await moneyRows(tx);
    const c = await cashRows(tx, rows);
    await tx.payrollEntry.createMany({ data: [
      { userId: c.employee.id, month: "2026-10", amount: "1000", currency: "BYN", bynAmount: "1000" },
      { userId: c.employee.id, month: "2026-11", amount: "99999", currency: "BYN", bynAmount: "99999" },
    ] });
    await historicalPayout(tx, rows, c.employee.id, "60");
    const input = { ...c.input, kind: "SALARY" as const, month: "2026-10" };
    const first = await cash.issuePayoutCore(c.actor, input, fixedRates, tx);
    assert.equal(first.month, "2026-10"); assert.equal(first.amount, "120.00");
    assert.equal((await cash.readOrgBalance(tx, "9")).minus(startingOrg).toFixed(2), "820.00");
    assert.equal((await cash.readCashBalance(tx, c.account.id)).toFixed(2), "880.00");
    const currentMonth = await cash.issuePayoutCore(c.actor, { ...input, month: "2026-11", requestId: randomUUID() }, fixedRates, tx);
    assert.equal(currentMonth.month, "2026-11"); assert.equal(currentMonth.amount, "120.00");
    await tx.payment.create({ data: { cashAccountId: c.account.id, direction: "INCOME", amount: "500", bynAmount: "500", currency: "BYN" } });
    assert.equal((await cash.readCashBalance(tx, c.account.id)).toFixed(2), "1260.00");
    const accruedPast = await tx.payrollEntry.findMany({ where: { userId: c.employee.id, month: { lt: "2026-11" } } });
    const paid = await tx.payout.findMany({ where: { userId: c.employee.id } });
    assert.equal(accruedPast.reduce((sum, row) => sum.plus(row.bynAmount!), new Prisma.Decimal(0))
      .minus(paid.reduce((sum, row) => sum.plus(row.bynAmount!), new Prisma.Decimal(0))).toFixed(2), "700.00");
    await assert.rejects(cash.issuePayoutCore(c.actor, { ...input, requestId: randomUUID(), cashAmount: "821.00" }, fixedRates, tx), /долг/);
    await tx.cashAccount.update({ where: { id: c.account.id }, data: { currency: "USD" } });
    await assert.rejects(cash.issuePayoutCore(c.actor, { ...c.input, requestId: randomUUID() }, fixedRates, tx), /Валюта или состояние/);
    assert.equal(await tx.payout.count({ where: { userId: c.employee.id } }), 3);
    const finalMoney = await moneyRows(tx);
    assert.deepEqual(finalMoney.map(group => group.length), originalMoney.map((group, index) => group.length + [4, 2, 3, 2, 2][index]));
    for (const [index, beforeRows] of originalMoney.entries())
      assert.deepEqual(finalMoney[index].filter(row => beforeRows.some(before => before.id === row.id)), beforeRows, "FOREIGN_SALARY_MONEY_UNCHANGED");
  });
});

test("cash/current-month-salary-cannot-use-current-accrual-or-ignore-saved-org-payout", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-31T21:30:00.000Z").getTime() });
  await fixture.rollback(async (tx, rows) => {
    const c = await cashRows(tx, rows), month = "2026-11";
    await tx.payrollEntry.create({ data: { userId: c.employee.id, month, amount: "99999", currency: "BYN", bynAmount: "99999" } });
    await assert.rejects(cash.issuePayoutCore(c.actor, { ...c.input, kind: "SALARY", month }, fixedRates, tx), /долг/);
    await historicalPayout(tx, rows, c.employee.id, "200");
    const adjustment = (await cash.readOrgBalance(tx, "1")).minus(800);
    if (!adjustment.isZero()) await tx.payment.create({ data: { direction: adjustment.gt(0) ? "EXPENSE" : "INCOME",
      amount: adjustment.abs(), bynAmount: adjustment.abs(), currency: "BYN" } });
    assert.equal((await cash.readCashBalance(tx, c.account.id)).toFixed(2), "1000.00");
    assert.equal((await cash.readOrgBalance(tx, "1")).toFixed(2), "800.00");
    await assert.rejects(cash.issuePayoutCore(c.actor, { ...c.input, requestId: randomUUID(), cashAmount: "850.00" }, fixedRates, tx), /организации/);
    assert.equal(await tx.domainEvent.count({ where: { actor: c.actor.id } }), 0);
    assert.equal(await tx.changeLog.count({ where: { actorId: c.actor.id } }), 0);
  });
});

test("percentage/frozen-fx-retry-original-month-after-commit", async () => {
  const [manager, a, b] = await Promise.all([fixture.user("fx-manager", ["MANAGER"]), fixture.user("fx-a", ["ENGINEER"]), fixture.user("fx-b", ["ENGINEER"])]);
  const project = await fixture.project("fx-project", { managerId: manager.id }), product = await fixture.product("fx-product", project.id, { status: "PRODUCTION", expectedPrice: "9000" });
  const completedAt = new Date("2026-09-30T21:30:00.000Z");
  const pending = await fixture.db.productPercentageCompletion.create({ data: {
    productId: product.id, kind: "ENGINEERING", state: "PENDING_FX", calculationVersion: 1, completedAt, completedById: manager.id,
    statusAtCompletion: "PRODUCTION", priceSnapshot: "1000", ratePercentSnapshot: "5", productCurrency: "USD", payrollCurrency: "EUR",
    shares: { create: [a, b].map(user => ({ userId: user.id, userNameSnapshot: user.name, shareUnits: 500000 })) },
  }, include: { shares: true } });
  let deliveries = 0, ratesRead = 0;
  const deps = { db: fixture.db, transaction: coordinator.createMutationTransaction(fixture.db),
    resolveRates: async (productCurrency: string, payrollCurrency: string, instant: Date) => {
      ratesRead++; assert.equal(productCurrency, "USD"); assert.equal(payrollCurrency, "EUR"); assert.equal(instant.toISOString(), completedAt.toISOString());
      return { asOf: "2026-09-30", product: { currency: "USD" as const, rate: "3.000000", date: "2026-09-30" }, payroll: { currency: "EUR" as const, rate: "4.000000", date: "2026-09-30" } };
    },
    deliver: async (eventIds: string[]) => {
      deliveries++;
      assert.equal((await fixture.peer.productPercentageCompletion.findUniqueOrThrow({ where: { id: pending.id } })).state, "SETTLED", "DELIVERY_OBSERVES_REAL_COMMIT");
      assert.equal(await fixture.peer.payrollEntry.count({ where: { productId: product.id } }), 2);
      assert.equal(await fixture.peer.domainEvent.count({ where: { id: { in: eventIds } } }), 2);
    },
  };
  await assert.rejects(percentage.settlePendingProductPercentage(product.id, "ENGINEERING", { ...deps, resolveRates: async () => { throw Error("CI_FX_UNAVAILABLE"); } }), /CI_FX_UNAVAILABLE/);
  assert.deepEqual(await fixture.db.productPercentageCompletion.findUnique({ where: { id: pending.id }, include: { shares: true } }), pending);
  assert.equal(await fixture.db.payrollEntry.count({ where: { productId: product.id } }), 0); assert.equal(deliveries, 0);
  assert.equal(await fixture.db.domainEvent.count({ where: { actor: manager.id } }), 0, "FX_FAILURE_HAS_NO_OUTBOX");
  assert.equal(await percentage.settlePendingProductPercentage(product.id, "ENGINEERING", deps), "SETTLED");
  const settled = await fixture.db.productPercentageCompletion.findUniqueOrThrow({ where: { id: pending.id }, include: { shares: true } });
  assert.equal(settled.amount!.toFixed(2), "37.50"); assert.equal(settled.bynAmount!.toFixed(2), "150.00"); assert.equal(settled.projectAmount!.toFixed(2), "50.00");
  for (const key of ["id", "productId", "kind", "completedAt", "completedById", "statusAtCompletion", "priceSnapshot", "ratePercentSnapshot", "productCurrency", "payrollCurrency"] as const)
    assert.deepEqual(settled[key], pending[key]);
  assert.equal(settled.productRateDate!.toISOString(), "2026-09-30T00:00:00.000Z"); assert.equal(settled.payrollRateDate!.toISOString(), "2026-09-30T00:00:00.000Z");
  const entries = await fixture.db.payrollEntry.findMany({ where: { productId: product.id }, orderBy: { userId: "asc" } });
  assert.equal(entries.length, 2);
  for (const row of entries) {
    assert.equal(row.currency, "EUR"); assert.equal(row.projectCurrency, "USD"); assert.equal(row.month, "2026-10");
    assert.equal(row.amount.toFixed(2), "18.75"); assert.equal(row.bynAmount!.toFixed(2), "75.00"); assert.equal(row.projectAmount!.toFixed(2), "25.00");
  }
  assert.equal(await percentage.settlePendingProductPercentage(product.id, "ENGINEERING", deps), "SETTLED");
  assert.equal(ratesRead, 1); assert.equal(deliveries, 1);
  assert.deepEqual(await fixture.db.payrollEntry.findMany({ where: { productId: product.id }, orderBy: { userId: "asc" } }), entries);
});

test("cash/serialized-concurrency-distinct-pids-held-wait", async () => {
  const c = await cashRows(fixture.db, fixture, "1000"), day = new Date().toISOString().slice(0, 10);
  const rates: CashRates = { asOf: day, cash: { currency: "BYN", rate: "1.000000", date: day }, payroll: { currency: "BYN", rate: "1.000000", date: day } };
  const ready = gate(), release = gate(); let held = false, firstPid = 0, secondPid = 0, secondEntered = false, firstFailure: unknown;
  const first = coordinator.createMutationTransaction(fixture.db)(async tx => {
    firstPid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0].pid;
    const result = await cash.issuePayoutCore(c.actor, { ...c.input, cashAmount: "600.00" }, rates, tx);
    held = true; ready.resolve(); await release.promise; held = false; return result;
  }).catch(error => { firstFailure = error; ready.resolve(); throw error; });
  void first.catch(() => {});
  let second: Promise<{ error: unknown }> | undefined;
  try {
    await ready.promise; if (firstFailure) throw firstFailure;
    second = coordinator.createMutationTransaction(fixture.peer)(async tx => {
      secondEntered = true; secondPid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0].pid;
      return cash.issuePayoutCore(c.actor, { ...c.input, cashAmount: "600.00", requestId: randomUUID() }, rates, tx);
    }).then(() => ({ error: null }), error => ({ error }));
    const deadline = performance.now() + 3000; let waiterPid = 0;
    while (performance.now() < deadline && !waiterPid) {
      const waiting = await fixture.db.$queryRaw<{ pid: number }[]>`SELECT pid FROM pg_locks WHERE locktype='advisory' AND classid=18435 AND objid=55001 AND NOT granted`;
      waiterPid = waiting[0]?.pid ?? 0; if (!waiterPid) await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(held && waiterPid > 0 && waiterPid !== firstPid, "DISTINCT_REAL_BACKENDS_WAIT_WHILE_FIRST_HELD"); assert.equal(secondEntered, false);
    release.resolve(); const winner = await first, loser = await second;
    assert.equal(winner.repeated, false); assert.equal(secondPid, waiterPid);
    assert.ok(loser.error instanceof Error); assert.match(loser.error.message, /Недостаточно средств/);
    assert.equal(await fixture.db.payout.count({ where: { userId: c.employee.id } }), 1);
    assert.equal(await fixture.db.changeLog.count({ where: { actorId: c.actor.id, entity: "payout", action: "issue" } }), 1);
    assert.equal(await fixture.db.domainEvent.count({ where: { actor: c.actor.id, type: "payroll.payout" } }), 1);
    assert.equal((await cash.readCashBalance(fixture.db, c.account.id)).toFixed(2), "400.00");
  } finally { release.resolve(); await Promise.allSettled([first, ...(second ? [second] : [])]); }
});
