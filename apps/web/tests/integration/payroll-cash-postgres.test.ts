import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { Prisma } from "@prisma/client";
import type { CashRates } from "../../src/lib/cash-ledger";
import { summarizePayrollHistory } from "../../src/server/payroll/summary-read-model";
import { createPostgresFixture, type PostgresRows } from "./postgres.fixture";

let fixture: Awaited<ReturnType<typeof createPostgresFixture>>;
let cash: typeof import("../../src/server/payroll/cash-core");
let percentage: typeof import("../../src/server/product-percentage-pay/core");
let coordinator: typeof import("../../src/server/transactions/coordinator");
before(async () => {
  fixture = await createPostgresFixture("payroll-cash");
  [cash, percentage, coordinator] = await Promise.all([import("../../src/server/payroll/cash-core"),
    import("../../src/server/product-percentage-pay/core"), import("../../src/server/transactions/coordinator")]);
});
after(async () => { if (fixture) try { await fixture.verifyProtected(); } finally { await fixture.dispose(); } });
const fixedRates: CashRates = { asOf: "2026-10-31", cash: { currency: "BYN", rate: "1.000000", date: "2026-10-31" }, payroll: { currency: "BYN", rate: "1.000000", date: "2026-10-31" } };
const gate = () => { let resolve = () => {}; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; };
async function cashRows(tx: Prisma.TransactionClient, rows: PostgresRows, amount = "1000") {
  const manager = await rows.user("accountant", ["ACCOUNTANT"]), employee = await rows.user("employee", ["WORKER"], { payScheme: "NONE" });
  const account = await tx.cashAccount.create({ data: { id: rows.id("cash"), name: "Синтетическая касса169", currency: "BYN" } });
  await tx.payment.create({ data: { id: rows.id("opening"), cashAccountId: account.id, direction: "INCOME", amount, bynAmount: amount, currency: "BYN" } });
  return { actor: { id: manager.id, name: manager.name, roles: manager.roles, source: "web" as const }, employee, account,
    input: { kind: "ADVANCE" as const, userId: employee.id, cashAccountId: account.id, cashAmount: "120.00", expectedCashCurrency: "BYN" as const, requestId: randomUUID(), description: "Синтетическая работа169" } };
}

for (const vector of [
  { id: "fixed-usd", accruedByn: "300", payoutCurrency: "USD", payoutByn: "60", due: 240, balance: "890.00" },
  { id: "unknown", accruedByn: "300", payoutCurrency: null, payoutByn: null, due: null, balance: null },
  { id: "fixed-zero", accruedByn: "0", payoutCurrency: null, payoutByn: "0", due: 0, balance: "950.00" },
]) test(`cash/fixed-history-nulls-zero/${vector.id}`, async () => fixture.rollback(async (tx, rows) => {
  const c = await cashRows(tx, rows);
  await tx.payment.create({ data: { direction: "EXPENSE", amount: "50", bynAmount: "50", cashAccountId: c.account.id } });
  await tx.payrollEntry.create({ data: { userId: c.employee.id, month: "2020-01", scheme: "PIECE", amount: "100", currency: "USD", bynAmount: vector.accruedByn } });
  await tx.payout.create({ data: { userId: c.employee.id, month: "2020-01", kind: "SALARY", amount: "20", payrollCurrency: vector.payoutCurrency, bynAmount: vector.payoutByn } });
  const entries = await tx.payrollEntry.findMany({ where: { userId: c.employee.id } }), payouts = await tx.payout.findMany({ where: { userId: c.employee.id } });
  const model = summarizePayrollHistory(entries, payouts, "2020-01", "2026-11", c.employee.id);
  const due = model.pastAccrued.get(c.employee.id) === null || model.totalPaid.get(c.employee.id) === null ? null : new Prisma.Decimal(model.pastAccrued.get(c.employee.id)!).sub(model.totalPaid.get(c.employee.id)!).toNumber();
  assert.equal(due, vector.due); assert.equal(model.allPaid, vector.payoutByn === null ? null : Number(vector.payoutByn));
  if (vector.balance === null) await assert.rejects(cash.readOrgBalance(tx, "9"), /сохранённого BYN/);
  else { assert.equal((await cash.readOrgBalance(tx, "9")).toFixed(2), vector.balance); if (vector.id === "fixed-usd") assert.equal((await cash.readOrgBalance(tx, "9", "0", "30")).toFixed(2), "860.00"); }
  assert.deepEqual(await tx.payrollEntry.findMany({ where: { userId: c.employee.id } }), entries);
  assert.deepEqual(await tx.payout.findMany({ where: { userId: c.employee.id } }), payouts);
}));

test("cash/advance-month-replay-and-rollback-outbox", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-31T21:30:00.000Z").getTime() });
  await fixture.rollback(async (tx, rows) => {
    const c = await cashRows(tx, rows), first = await cash.issuePayoutCore(c.actor, c.input, fixedRates, tx);
    assert.equal(first.repeated, false); assert.equal(first.month, "2026-11"); assert.equal(first.amount, "120.00"); assert.equal(first.bynAmount, "120.00");
    const payout = await tx.payout.findUniqueOrThrow({ where: { id: first.payoutId } });
    assert.equal(payout.cashRateDate!.toISOString(), "2026-10-31T00:00:00.000Z"); assert.equal(payout.payrollRateDate!.toISOString(), "2026-10-31T00:00:00.000Z");
    assert.equal(payout.payrollCurrency, "BYN"); assert.equal(payout.comment, "Синтетическая работа169");
    assert.equal((await cash.readCashBalance(tx, c.account.id)).toFixed(2), "880.00");
    assert.equal((await cash.readOrgBalance(tx, "1")).toFixed(2), "880.00");
    const receipt = await tx.changeLog.findUniqueOrThrow({ where: { id: `payout-issue:${c.input.requestId}` } });
    t.mock.timers.setTime(new Date("2026-11-30T21:30:00.000Z").getTime());
    const repeated = await cash.issuePayoutCore(c.actor, c.input, fixedRates, tx);
    assert.equal(repeated.repeated, true); assert.equal(repeated.month, "2026-11"); assert.equal(repeated.payoutId, first.payoutId); assert.equal(repeated.eventId, null);
    assert.equal(await tx.payout.count({ where: { userId: c.employee.id } }), 1);
    assert.equal(await tx.payment.count({ where: { cashAccountId: c.account.id } }), 1); assert.equal(await tx.payrollEntry.count({ where: { userId: c.employee.id } }), 0);
    assert.equal(await tx.domainEvent.count({ where: { actor: c.actor.id, type: "payroll.payout" } }), 1);
    assert.deepEqual(await tx.changeLog.findUnique({ where: { id: receipt.id } }), receipt);
    await assert.rejects(cash.issuePayoutCore(c.actor, { ...c.input, cashAmount: "121.00" }, fixedRates, tx), /уже использован/);
    // Общая fixture после abort сравнивает все строки и SQL schema: payout, receipt и outbox не сохраняются.
  });
});

test("cash/salary-past-moscow-month-and-current-record-currencies", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-31T21:30:00.000Z").getTime() });
  await fixture.rollback(async (tx, rows) => {
    const c = await cashRows(tx, rows);
    await tx.payrollEntry.createMany({ data: [
      { userId: c.employee.id, month: "2026-10", amount: "1000", currency: "BYN", bynAmount: "1000" },
      { userId: c.employee.id, month: "2026-11", amount: "99999", currency: "BYN", bynAmount: "99999" },
    ] });
    await tx.payout.create({ data: { userId: c.employee.id, month: "2020-01", amount: "20", payrollCurrency: "USD", bynAmount: "60" } });
    const input = { ...c.input, kind: "SALARY" as const, month: "2026-10" };
    const first = await cash.issuePayoutCore(c.actor, input, fixedRates, tx);
    assert.equal(first.month, "2026-10"); assert.equal(first.amount, "120.00");
    assert.equal((await cash.readOrgBalance(tx, "9")).toFixed(2), "820.00");
    await assert.rejects(cash.issuePayoutCore(c.actor, { ...input, requestId: randomUUID(), cashAmount: "821.00" }, fixedRates, tx), /долг|балансе организации/);
    await tx.cashAccount.update({ where: { id: c.account.id }, data: { currency: "USD" } });
    await assert.rejects(cash.issuePayoutCore(c.actor, { ...c.input, requestId: randomUUID() }, fixedRates, tx), /Валюта или состояние/);
    assert.equal(await tx.payout.count({ where: { userId: c.employee.id } }), 2);
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
