import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire, Module } from "node:module";
import { before, test } from "node:test";
import { Prisma, type PrismaClient } from "@prisma/client";

const require = createRequire(import.meta.url);
function inject(specifier: string, exports: Record<string, unknown>) {
  const filename = require.resolve(specifier), stub = new Module(filename);
  stub.filename = filename; stub.loaded = true; stub.exports = exports; require.cache[filename] = stub;
}

type Money = { id: string; direction?: string; amount: string | number; bynAmount?: string | number;
  cashAmount?: string | number; cashAccountId?: string | null; userId?: string };
let payments: Money[] = [], payouts: Money[] = [], receipts = new Map<string, unknown>();
let activeTransactions = 0, maxActiveTransactions = 0, advisoryCalls = 0;
let serviceErrors: string[] = [];
let createPaymentCore: typeof import("../src/server/payments/core").createPaymentCore;
let issuePayoutCore: typeof import("../src/server/payroll/cash-core").issuePayoutCore;
let withTaskTransaction: typeof import("../src/server/tasks/transaction").withTaskTransaction;
const date = new Date().toISOString().slice(0, 10);

function reset() {
  payments = [{ id: "funding", direction: "INCOME", amount: "1000.00", bynAmount: "1000.00", cashAccountId: "cash" }];
  payouts = []; receipts = new Map(); activeTransactions = 0; maxActiveTransactions = 0; advisoryCalls = 0; serviceErrors = [];
}
const sum = (list: Money[], field: "amount" | "bynAmount" | "cashAmount") =>
  list.reduce((value, row) => value + Number(row[field] ?? 0), 0);

before(() => {
  reset();
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray) => {
      assert.match(strings.join(""), /pg_advisory_xact_lock\(18435, 55001\)/);
      advisoryCalls++; return [{ locked: 1 }];
    },
    project: { findUnique: async () => ({ id: "project", number: "QA-1", currency: "BYN" }) },
    cashAccount: { findUnique: async () => ({ id: "cash", name: "QA cash", currency: "BYN", active: true }) },
    expenseArticle: { findUnique: async () => ({ id: "article", active: true }) },
    orgSetting: { findUnique: async () => ({ value: "BYN" }) },
    user: { findUnique: async () => ({ id: "worker", name: "QA worker", active: true }) },
    payment: {
      groupBy: async ({ where }: { where: { cashAccountId: string } }) => ["INCOME", "EXPENSE"].map((direction) =>
        ({ direction, _sum: { amount: sum(payments.filter((row) => row.cashAccountId === where.cashAccountId &&
          row.direction === direction), "amount") } })),
      aggregate: async ({ where }: { where: { direction: string } }) =>
        ({ _sum: { bynAmount: sum(payments.filter((row) => row.direction === where.direction), "bynAmount") } }),
      create: async ({ data }: { data: Money }) => { const row = { ...data, id: `payment-${payments.length}` }; payments.push(row); return row; },
    },
    payout: {
      findMany: async ({ where }: { where?: { userId?: string } }) => where?.userId ? payouts.filter(row => row.userId === where.userId) : payouts,
      aggregate: async ({ where }: { where: { cashAccountId?: string | { not: null } | null; userId?: string } }) => {
        const found = where.userId ? payouts.filter((row) => row.userId === where.userId) :
          where.cashAccountId === "cash" ? payouts.filter((row) => row.cashAccountId === "cash") :
            where.cashAccountId === null ? payouts.filter((row) => row.cashAccountId == null) : payouts;
        return { _sum: { cashAmount: sum(found, "cashAmount"), bynAmount: sum(found, "bynAmount"), amount: sum(found, "amount") } };
      },
      create: async ({ data }: { data: Money }) => { const row = { ...data, id: `payout-${payouts.length}` }; payouts.push(row); return row; },
      findUnique: async ({ where }: { where: { id: string } }) => payouts.find((row) => row.id === where.id) ?? null,
    },
    changeLog: { findUnique: async ({ where }: { where: { id: string } }) => receipts.get(where.id) ?? null,
      create: async ({ data }: { data: { id: string } }) => { receipts.set(data.id, data); return data; } },
    domainEvent: { create: async () => ({ id: randomUUID() }) },
    payrollEntry: { findMany: async () => [{ amount: "600", currency: "BYN", bynAmount: "600" }], aggregate: async () => ({ _sum: { amount: 600 } }) },
  };
  let tail = Promise.resolve();
  const database = { ...tx, $transaction: async (operation: (transaction: typeof tx) => Promise<unknown>, options: {
    isolationLevel: string }) => {
    assert.equal(options.isolationLevel, Prisma.TransactionIsolationLevel.ReadCommitted);
    const prior = tail; let release!: () => void;
    tail = new Promise<void>((resolve) => { release = resolve; });
    await prior; activeTransactions++; maxActiveTransactions = Math.max(maxActiveTransactions, activeTransactions);
    try { return await operation(tx); } finally { activeTransactions--; release(); }
  } };
  (globalThis as { prisma?: PrismaClient }).prisma = database as unknown as PrismaClient;
  inject("next/cache", { revalidatePath: () => {} });
  inject("../src/server/projects/core", { requireActorRoles: () => {} });
  inject("../src/server/finance/nbrb", { isCurrency: (value: string) => ["BYN", "USD", "RUB", "EUR"].includes(value),
    getNbrbRate: async () => ({ rate: 1, date }), equivalents: (amount: number) => ({ bynAmount: amount, projectAmount: amount }) });
  inject("../src/server/plugins/changelog", { writeChangeLog: async () => {} });
  inject("../src/server/plugins/events", { emitDomainEvent: async () => {} });
  inject("../src/server/notifications/notify", { notifyOrg: async () => {} });
  inject("../src/server/payroll/queries", { getPayrollCurrency: async () => "BYN" });
  const realTransaction = require("../src/server/tasks/transaction");
  withTaskTransaction = realTransaction.createTaskTransaction(database);
  inject("../src/server/tasks/transaction", { withTaskTransaction });
  issuePayoutCore = require("../src/server/payroll/cash-core").issuePayoutCore;
  createPaymentCore = require("../src/server/payments/core").createPaymentCore;
});

test("actual expense writer and actual advance core share ReadCommitted lock; only one fits 1000 BYN", async () => {
  const actor = { id: "manager", name: "QA manager", roles: ["ADMIN"], source: "web" } as const;
  for (const expenseFirst of [false, true]) {
    reset();
    const advance = () => withTaskTransaction((tx) => issuePayoutCore(actor as never,
      { kind: "ADVANCE", userId: "worker", cashAccountId: "cash", cashAmount: "600.00",
        expectedCashCurrency: "BYN", description: "QA work", requestId: randomUUID() },
      { asOf: date, cash: { currency: "BYN", rate: "1.000000", date },
        payroll: { currency: "BYN", rate: "1.000000", date } } as const, tx));
    const expense = () => createPaymentCore(actor as never, { projectId: "project", direction: "EXPENSE",
      amount: 500, currency: "BYN", cashAccountId: "cash", expenseArticleId: "article" });
    const first = expenseFirst ? expense() : advance();
    const second = expenseFirst ? advance() : expense();
    const outcomes = await Promise.allSettled([first, second]);
    const success = outcomes.filter((row) => row.status === "fulfilled" &&
      (row.value as { ok?: boolean }).ok !== false);
    assert.equal(success.length, 1);
    assert.equal(payments.length - 1 + payouts.length, 1);
    assert.ok(sum(payments.filter((row) => row.direction === "EXPENSE"), "amount") + sum(payouts, "cashAmount") <= 1000);
    assert.equal(advisoryCalls, 2);
    assert.equal(maxActiveTransactions, 1);
  }
});

test("actual settleAll delegates each payout to the same guarded core while an expense races", async () => {
  reset();
  const actor = { id: "accountant", name: "QA accountant", roles: ["ACCOUNTANT"], source: "web" } as const;
  const currentMonth = new Date().toISOString().slice(0, 7);
  inject("../src/server/require-role", { requireFinance: async () => ({ user: actor }), requireAdmin: async () => ({ user: actor }) });
  inject("../src/server/finance/queries", { listCashAccounts: async () => [{ id: "cash", active: true,
    currency: "BYN", balance: 1000 - sum(payments.filter((row) => row.direction === "EXPENSE"), "amount") -
      sum(payouts, "cashAmount") }] });
  inject("../src/server/payroll/queries", { getPayrollCurrency: async () => "BYN",
    getEmployeeDues: async () => [{ userId: "worker", name: "QA worker", due: 600 - sum(payouts, "amount") }],
    getOrgBalance: async () => 1000 - sum(payments.filter((row) => row.direction === "EXPENSE"), "bynAmount") -
      sum(payouts, "bynAmount"), isValidMonth: (value: string) => /^\d{4}-\d{2}$/.test(value),
    currentMonth: () => currentMonth, round2: (value: number) => Math.round(value * 100) / 100 });
  inject("../src/server/product-stage-pay/core", { assertPayrollCurrencyChange: async () => {} });
  inject("../src/server/payroll/cash-service", { executeCashPayout: async (writer: unknown, input: unknown) => {
    try {
      const saved = await withTaskTransaction((tx) => issuePayoutCore(writer as never, input as never,
        { asOf: date, cash: { currency: "BYN", rate: "1.000000", date },
          payroll: { currency: "BYN", rate: "1.000000", date } } as const, tx));
      return { ok: true, payoutId: saved.payoutId };
    } catch (error) { serviceErrors.push(String(error)); return { ok: false, error: String(error) }; }
  } });
  const { settleAll } = require("../src/server/payroll/actions") as typeof import("../src/server/payroll/actions");
  const solo = await settleAll(currentMonth, "cash");
  assert.equal(solo.ok, true);
  assert.equal(solo.paidCount, 1);
  assert.equal(Number(payouts[0].cashAmount), 600);
  assert.equal(advisoryCalls, 1);
  reset();
  const expense = createPaymentCore(actor as never, { projectId: "project", direction: "EXPENSE",
    amount: 500, currency: "BYN", cashAccountId: "cash", expenseArticleId: "article" });
  const bulk = settleAll(currentMonth, "cash");
  const results = await Promise.all([expense, bulk]);
  assert.equal(results[1].ok, true);
  assert.equal(maxActiveTransactions, 1);
  assert.equal(advisoryCalls, 2);
  assert.ok(sum(payments.filter((row) => row.direction === "EXPENSE"), "bynAmount") +
    sum(payouts, "bynAmount") <= 1000);
  assert.ok(payouts.length <= 1, JSON.stringify({ results, payments, payouts, serviceErrors }));
  if (payouts.length) assert.ok(Number(payouts[0].amount) <= 600);
  else assert.ok(results[1].shortPaid?.includes("QA worker") && serviceErrors.some((error) => error.includes("Недостаточно средств")));
});
