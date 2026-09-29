import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Prisma, type PrismaClient } from "@prisma/client";
import { calculateCashPayout, calculateOrgBalance, parseCashAmount, parseCashRate } from "../src/lib/cash-ledger";
import { issuePayoutCore, readCashBalance } from "../src/server/payroll/cash-core";
import { createTaskTransaction } from "../src/server/tasks/transaction";
import type { Role } from "../src/lib/roles";

const today = new Date().toISOString().slice(0, 10);
const rates = { asOf: today, cash: { currency: "BYN", rate: "1.000000", date: today }, payroll: { currency: "BYN", rate: "1.000000", date: today } } as const;
const input = { userId: "employee", cashAccountId: "cash", cashAmount: "120.00", expectedCashCurrency: "BYN" as const,
  description: "Работа над шкафом", requestId: randomUUID() };
const actor = (roles: Role[]) => ({ id: "actor", name: "Actor", roles, source: "web" as const });
const noDb = new Proxy({}, { get: () => { throw new Error("unauthorized call touched DB"); } }) as Prisma.TransactionClient;

test("money parsing rejects float artifacts, zero, NaN and excessive precision", () => {
  assert.equal(parseCashAmount("120.00"), "120.00");
  for (const amount of ["0", "-1", "NaN", "Infinity", "1e2", "1.001", "999999999999.99"]) {
    assert.throws(() => parseCashAmount(amount), /сумм|значени|знак|предел/i);
  }
});

test("cash FX snapshot and org balance use saved BYN before current conversion", () => {
  const quote = calculateCashPayout("120.00", { asOf: today, cash: { currency: "USD", rate: "3.000000", date: today }, payroll: { currency: "USD", rate: "3.000000", date: today } });
  assert.deepEqual({ cashAmount: quote.cashAmount, amount: quote.amount, bynAmount: quote.bynAmount }, { cashAmount: "120.00", amount: "120.00", bynAmount: "360.00" });
  assert.equal(calculateOrgBalance("1000.00", "360.00", "0.00", "4.000000"), "160.00");
  assert.equal(calculateOrgBalance("1000.00", "360.00", "20.00", "4.000000"), "140.00");
  assert.equal(calculateOrgBalance("1000.00", "0.00", "120.00", "1.000000"), "880.00");
  assert.equal(calculateOrgBalance("20000000000.00", "360.00", "0.00", "4.000000"), "4999999910.00");
  const fractional = calculateCashPayout("1.01", { asOf: today, cash: { currency: "USD", rate: "2.123456", date: today },
    payroll: { currency: "BYN", rate: "1.000000", date: today } });
  assert.equal(fractional.bynAmount, "2.14");
  assert.equal(fractional.cashRate, "2.123456");
  assert.throws(() => parseCashRate("2.1234567", "USD"), /курс/);
  assert.equal(fractional.bynAmount, "2.14"); // saved snapshot is independent of a later quote/rate
});

test("payroll amount uses unrounded physical FX ratio while BYN snapshot rounds independently", () => {
  const same = calculateCashPayout("0.50", { asOf: today, cash: { currency: "RUB", rate: "0.031000", date: today },
    payroll: { currency: "RUB", rate: "0.031000", date: today } });
  assert.equal(same.amount, "0.50");
  assert.equal(same.bynAmount, "0.02");
  const mixed = calculateCashPayout("0.01", { asOf: today, cash: { currency: "USD", rate: "3.111100", date: today },
    payroll: { currency: "RUB", rate: "0.031000", date: today } });
  assert.equal(mixed.amount, "1.00");
  assert.equal(mixed.bynAmount, "0.03");
  const large = calculateCashPayout("9999999999.99", { asOf: today, cash: { currency: "USD", rate: "3.000000", date: today },
    payroll: { currency: "USD", rate: "3.000000", date: today } });
  assert.equal(large.amount, "9999999999.99");
  assert.equal(large.bynAmount, "29999999999.97");
  const minor = calculateCashPayout("0.01", { asOf: today, cash: { currency: "RUB", rate: "0.031000", date: today },
    payroll: { currency: "RUB", rate: "0.031000", date: today } });
  assert.equal(minor.cashAmount, "0.01");
  assert.equal(minor.amount, "0.01");
  assert.equal(minor.bynAmount, "0.00");
});

test("FX dates reject impossible calendar days and future provider dates", () => {
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  for (const date of ["2026-02-30", tomorrow]) {
    assert.throws(() => calculateCashPayout("1.00", { asOf: today, cash: { currency: "USD", rate: "3.000000", date },
      payroll: { currency: "BYN", rate: "1.000000", date: today } }), /дат/);
  }
});

test("writer refuses a quote prepared on an earlier UTC day", async () => {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const stale = { asOf: yesterday, cash: { currency: "BYN" as const, rate: "1.000000", date: yesterday },
    payroll: { currency: "BYN" as const, rate: "1.000000", date: yesterday } };
  const f = cashFixture();
  await assert.rejects(issuePayoutCore(actor(["MANAGER"]), { ...input, requestId: randomUUID(), kind: "ADVANCE" }, stale, f.tx), /Дата расчёта/);
  assert.equal(f.payouts.size, 0);
});

test("advance writer enforces narrow role before DB access", async () => {
  await assert.rejects(issuePayoutCore(actor(["WORKER"]), { ...input, kind: "ADVANCE" }, rates, noDb), /прав/i);
  await assert.rejects(issuePayoutCore(actor(["MANAGER"]), { ...input, kind: "SALARY", month: "2026-08" }, rates, noDb), /прав/i);
});

test("all authorized roles and combined manager roles can issue, other roles cannot read the ledger", async () => {
  for (const roles of [["ADMIN"], ["DIRECTOR"], ["MANAGER"], ["ACCOUNTANT"], ["MANAGER", "ENGINEER"]] as Role[][]) {
    const f = cashFixture();
    const result = await issuePayoutCore(actor(roles), { ...input, requestId: randomUUID(), kind: "ADVANCE" }, rates, f.tx);
    assert.equal(result.cashAmount, "120.00");
    assert.equal(f.payouts.size, 1);
  }
  for (const roles of [["ENGINEER"], ["WORKER"], ["MOUNTER"], ["ENGINEER", "WORKER"]] as Role[][]) {
    await assert.rejects(issuePayoutCore(actor(roles), { ...input, requestId: randomUUID(), kind: "ADVANCE" }, rates, noDb), /прав/);
  }
});

function cashFixture(options: { employeeActive?: boolean; accountActive?: boolean; accountCurrency?: string; payrollCurrency?: string;
  accountFunds?: string; orgFunds?: string; legacyPaid?: string; pastAccrued?: string } = {}) {
  const payouts = new Map<string, Record<string, unknown>>();
  const receipts = new Map<string, Record<string, unknown>>();
  const events: Record<string, unknown>[] = [];
  const accountFunds = options.accountFunds ?? "1000.00";
  const orgFunds = options.orgFunds ?? "1000.00";
  const tx = {
    changeLog: { findUnique: async ({ where }: { where: { id: string } }) => receipts.get(where.id) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => { receipts.set(data.id as string, data); return data; } },
    user: { findUnique: async () => ({ id: "employee", name: "Employee", active: options.employeeActive ?? true }) },
    cashAccount: { findUnique: async () => ({ id: "cash", name: "Main", currency: options.accountCurrency ?? "BYN", active: options.accountActive ?? true }) },
    orgSetting: { findUnique: async () => options.payrollCurrency ? { value: options.payrollCurrency } : null },
    payment: {
      groupBy: async () => [{ direction: "INCOME", _sum: { amount: accountFunds } }],
      aggregate: async ({ where }: { where: { direction: string } }) => ({ _sum: { bynAmount: where.direction === "INCOME" ? orgFunds : "0.00" } }),
    },
    payout: {
      findUnique: async ({ where }: { where: { id: string } }) => payouts.get(where.id) ?? null,
      aggregate: async ({ where }: { where: { cashAccountId?: unknown; userId?: string } }) => {
        const rows = [...payouts.values()];
        if (where.cashAccountId === null) return { _sum: { amount: options.legacyPaid ?? "0.00" } };
        if (where.cashAccountId) return { _sum: { cashAmount: rows.reduce((sum, row) => sum + Number(row.cashAmount), 0).toFixed(2),
          bynAmount: rows.reduce((sum, row) => sum + Number(row.bynAmount), 0).toFixed(2) } };
        if (where.userId) return { _sum: { amount: rows.reduce((sum, row) => sum + Number(row.amount), 0).toFixed(2) } };
        return { _sum: { amount: "0.00" } };
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { ...data, id: `payout-${payouts.size + 1}`, amount: new Prisma.Decimal(data.amount as string),
          cashAmount: new Prisma.Decimal(data.cashAmount as string) };
        payouts.set(row.id, row); return row;
      },
    },
    payrollEntry: { aggregate: async () => ({ _sum: { amount: options.pastAccrued ?? "500.00" } }) },
    domainEvent: { create: async ({ data }: { data: Record<string, unknown> }) => { events.push(data); return { id: `event-${events.length}` }; } },
  } as unknown as Prisma.TransactionClient;
  return { tx, payouts, receipts, events };
}

test("manager issues to active NONE payee once, with work description and no Payment or PayrollEntry write", async () => {
  const f = cashFixture();
  const request = { ...input, requestId: randomUUID(), kind: "ADVANCE" as const };
  const first = await issuePayoutCore(actor(["MANAGER"]), request, rates, f.tx);
  assert.equal(first.repeated, false);
  assert.equal(first.amount, "120.00");
  assert.equal(f.payouts.size, 1);
  assert.equal(f.events.length, 1);
  assert.equal(typeof (f.events[0].payload as { amount: unknown }).amount, "number");
  assert.equal((await readCashBalance(f.tx, "cash")).toFixed(2), "880.00");
  const row = [...f.payouts.values()][0];
  assert.equal(row.comment, "Работа над шкафом");
  assert.equal(row.bynAmount, "120.00");
  assert.equal(row.cashCurrency, "BYN");
  const replay = await issuePayoutCore(actor(["MANAGER"]), request, rates, f.tx);
  assert.equal(replay.repeated, true);
  assert.equal(f.payouts.size, 1);
  assert.equal(f.events.length, 1);
  await assert.rejects(issuePayoutCore(actor(["MANAGER"]), { ...request, cashAmount: "130.00" }, rates, f.tx), /использован/);
  f.payouts.clear();
  await assert.rejects(issuePayoutCore(actor(["MANAGER"]), request, rates, f.tx), /отменена/);
});

test("server rejects missing work, inactive parties, account overdraft and organization overdraft", async () => {
  const request = { ...input, requestId: randomUUID(), kind: "ADVANCE" as const };
  await assert.rejects(issuePayoutCore(actor(["MANAGER"]), { ...request, description: " " }, rates, noDb), /описание/);
  for (const [fixtureOptions, message] of [
    [{ employeeActive: false }, /сотрудник/], [{ accountActive: false }, /касса/],
    [{ accountFunds: "119.99" }, /кассе/], [{ orgFunds: "119.99" }, /организации/],
  ] as const) {
    const f = cashFixture(fixtureOptions);
    await assert.rejects(issuePayoutCore(actor(["MANAGER"]), request, rates, f.tx), message);
    assert.equal(f.payouts.size, 0);
  }
});

test("a negative organization balance cannot disappear when converted and rounded for display", async () => {
  const f = cashFixture({ payrollCurrency: "USD", orgFunds: "119.99" });
  const quoteRates = { ...rates, payroll: { currency: "USD" as const, rate: "4.000000", date: today } };
  await assert.rejects(issuePayoutCore(actor(["MANAGER"]), {
    ...input, requestId: randomUUID(), kind: "ADVANCE", cashAmount: "120.00",
  }, quoteRates, f.tx), /организации/);
  assert.equal(f.payouts.size, 0);
  assert.equal(f.receipts.size, 0);
  assert.equal(f.events.length, 0);
});

test("sequential payouts cannot consume the same cash twice; salary checks existing past debt", async () => {
  const f = cashFixture();
  const first = { ...input, cashAmount: "600.00", requestId: randomUUID(), kind: "ADVANCE" as const };
  await issuePayoutCore(actor(["MANAGER"]), first, rates, f.tx);
  await assert.rejects(issuePayoutCore(actor(["ACCOUNTANT"]), { ...first, requestId: randomUUID(), cashAmount: "600.00" }, rates, f.tx), /кассе|организации/);
  const salaryFixture = cashFixture();
  await issuePayoutCore(actor(["ACCOUNTANT"]), { ...input, requestId: randomUUID(), kind: "SALARY", month: "2026-08" }, rates, salaryFixture.tx);
  await issuePayoutCore(actor(["ACCOUNTANT"]), { ...input, requestId: randomUUID(), kind: "SALARY", month: new Date().toISOString().slice(0, 7) }, rates, cashFixture().tx);
  await assert.rejects(issuePayoutCore(actor(["ACCOUNTANT"]), { ...input, requestId: randomUUID(), kind: "SALARY", month: new Date().toISOString().slice(0, 7) },
    rates, cashFixture({ pastAccrued: "0.00" }).tx), /долг/);
  await assert.rejects(issuePayoutCore(actor(["ACCOUNTANT"]), { ...input, requestId: randomUUID(), cashAmount: "500.01", kind: "SALARY", month: "2026-08" }, rates, cashFixture().tx), /долг/);
});

test("server derives cash and payroll currencies from current records, not client quote", async () => {
  const f = cashFixture({ accountCurrency: "USD", payrollCurrency: "BYN", accountFunds: "100.00", orgFunds: "300.00" });
  const usdRates = { asOf: today, cash: { currency: "USD", rate: "3.000000", date: today },
    payroll: { currency: "BYN", rate: "1.000000", date: today } } as const;
  const result = await issuePayoutCore(actor(["MANAGER"]), { ...input, requestId: randomUUID(), kind: "ADVANCE", cashAmount: "50.00",
    expectedCashCurrency: "USD" }, usdRates, f.tx);
  assert.equal(result.amount, "150.00");
  assert.equal([...f.payouts.values()][0].bynAmount, "150.00");
  assert.equal([...f.payouts.values()][0].cashCurrency, "USD");
  assert.equal(calculateCashPayout("50.00", { ...usdRates, cash: { ...usdRates.cash, rate: "4.000000" } }).bynAmount, "200.00");
  assert.equal([...f.payouts.values()][0].bynAmount, "150.00");
  await assert.rejects(issuePayoutCore(actor(["MANAGER"]), { ...input, requestId: randomUUID(), kind: "ADVANCE" }, rates, f.tx), /валюта/i);
  await assert.rejects(issuePayoutCore(actor(["MANAGER"]), { ...input, requestId: randomUUID(), kind: "ADVANCE",
    cashAmount: "50.00", expectedCashCurrency: "BYN" } as Parameters<typeof issuePayoutCore>[1], usdRates, f.tx), /валют/i);
});

test("legacy payouts remain in org cap, and two serialized advances cannot overspend", async () => {
  const legacy = cashFixture({ legacyPaid: "200.00" });
  await assert.rejects(issuePayoutCore(actor(["MANAGER"]), { ...input, requestId: randomUUID(), kind: "ADVANCE", cashAmount: "850.00" }, rates, legacy.tx), /организации/);
  const f = cashFixture();
  Object.assign(f.tx, { $queryRaw: async (sql: TemplateStringsArray) => {
    assert.match(sql.join(""), /pg_advisory_xact_lock\(18435, 55001\)/);
    return [{ locked: 1 }];
  } });
  let queue = Promise.resolve();
  const database = { $transaction: async (operation: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
    const previous = queue;
    let release!: () => void;
    queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(f.tx); } finally { release(); }
  } } as unknown as Pick<PrismaClient, "$transaction">;
  const transaction = createTaskTransaction(database);
  const requests = [randomUUID(), randomUUID()].map((requestId) => transaction((tx) => issuePayoutCore(actor(["MANAGER"]),
    { ...input, requestId, kind: "ADVANCE", cashAmount: "600.00" }, rates, tx)));
  const results = await Promise.allSettled(requests);
  assert.deepEqual(results.map((row) => row.status).sort(), ["fulfilled", "rejected"]);
  assert.equal(f.payouts.size, 1);
  assert.equal(f.events.length, 1);
});
