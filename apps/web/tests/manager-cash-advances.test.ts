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
      findMany: async () => [...payouts.values(), ...(options.legacyPaid ? [{amount: options.legacyPaid, payrollCurrency: "BYN", bynAmount: null}] : [])],
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
    payrollEntry: { findMany: async () => [{amount: options.pastAccrued ?? "500.00", currency: "BYN", bynAmount: null}], aggregate: async () => ({ _sum: { amount: options.pastAccrued ?? "500.00" } }) },
    domainEvent: { create: async ({ data }: { data: Record<string, unknown> }) => { events.push(data); return { id: `event-${events.length}` }; } },
  } as unknown as Prisma.TransactionClient;
  return { tx, payouts, receipts, events };
}

test("sequential payouts cannot consume the same cash twice; salary checks existing past debt", async () => {
  const f = cashFixture();
  const first = { ...input, cashAmount: "600.00", requestId: randomUUID(), kind: "ADVANCE" as const };
  await issuePayoutCore(actor(["PROCUREMENT"]), first, rates, f.tx);
  await assert.rejects(issuePayoutCore(actor(["ACCOUNTANT"]), { ...first, requestId: randomUUID(), cashAmount: "600.00" }, rates, f.tx), /кассе|организации/);
  const salaryFixture = cashFixture();
  await issuePayoutCore(actor(["ACCOUNTANT"]), { ...input, requestId: randomUUID(), kind: "SALARY", month: "2026-08" }, rates, salaryFixture.tx);
  await issuePayoutCore(actor(["ACCOUNTANT"]), { ...input, requestId: randomUUID(), kind: "SALARY", month: new Date().toISOString().slice(0, 7) }, rates, cashFixture().tx);
  await assert.rejects(issuePayoutCore(actor(["ACCOUNTANT"]), { ...input, requestId: randomUUID(), kind: "SALARY", month: new Date().toISOString().slice(0, 7) },
    rates, cashFixture({ pastAccrued: "0.00" }).tx), /долг/);
  await assert.rejects(issuePayoutCore(actor(["ACCOUNTANT"]), { ...input, requestId: randomUUID(), cashAmount: "500.01", kind: "SALARY", month: "2026-08" }, rates, cashFixture().tx), /долг/);
});

test("legacy payouts remain in org cap, and two serialized advances cannot overspend", async () => {
  const legacy = cashFixture({ legacyPaid: "200.00" });
  await assert.rejects(issuePayoutCore(actor(["PROCUREMENT"]), { ...input, requestId: randomUUID(), kind: "ADVANCE", cashAmount: "850.00" }, rates, legacy.tx), /организации/);
  const f = cashFixture();
});
