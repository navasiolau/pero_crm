import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { before, test } from "node:test";
import type { PrismaClient } from "@prisma/client";

const require = createRequire(import.meta.url);
let history: { userId: string; amount: string; currency: string; bynAmount: string | null }[] = [];
let due: number | null = 10;
let balance: number | null = 100;
const writes: { amount: number; bynAmount: number; currency: string }[] = [];
const actor = { id: "accountant", name: "Бухгалтер", roles: ["ACCOUNTANT"] };
let actions: typeof import("../src/server/payroll/actions");
function inject(path: string, exports: Record<string, unknown>) {
  const filename = require.resolve(path), stub = new Module(filename);
  stub.exports = exports; stub.filename = filename; stub.loaded = true; require.cache[filename] = stub;
}
before(() => {
  (globalThis as { prisma?: PrismaClient }).prisma = {
    user: { findMany: async () => [{ id: "u", name: "U", roles: ["MANAGER"], payPercent: "5" }] },
    payrollEntry: { findMany: async () => history, create: async ({ data }: { data: typeof writes[number] }) => { writes.push(data); return {}; } },
  } as unknown as PrismaClient;
  inject("next/cache", { revalidatePath: () => {} });
  inject("../src/server/require-role", { requireAdmin: async () => ({ user: actor }), requireFinance: async () => ({ user: actor }) });
  inject("../src/server/plugins/changelog", { writeChangeLog: async () => {} });
  inject("../src/server/plugins/events", { emitDomainEvent: async () => {} });
  inject("../src/server/notifications/notify", { notifyOrg: async () => {}, notifyPerson: async () => {} });
  inject("../src/server/finance/queries", { listCashAccounts: async () => [{ id: "cash", active: true, currency: "BYN", balance: 100 }] });
  inject("../src/server/payroll/queries", {
    currentMonth: () => "2026-10", isValidMonth: () => true,
    getMonthTurnover: async () => ({ total: 1000, currency: "BYN" }),
    getEmployeeDues: async () => [{ userId: "u", name: "U", due }], getOrgBalance: async () => balance,
    getPayrollCurrency: async () => "BYN", round2: (amount: number) => Math.round(amount * 100) / 100,
  });
  actions = require("../src/server/payroll/actions");
});

test("unknown turnover history stops new accrual without writes", async () => {
  history = [{ userId: "u", amount: "10", currency: "USD", bynAmount: null }]; writes.length = 0;
  const result = await actions.accrueTurnover("2026-09");
  assert.equal(result.ok, false); assert.match(result.error!, /BYN/); assert.equal(writes.length, 0);
});

test("turnover top-up uses fixed BYN equivalent, writes a BYN snapshot and Decimal rounding", async () => {
  history = [{ userId: "u", amount: "10", currency: "USD", bynAmount: "30" }]; writes.length = 0;
  assert.equal((await actions.accrueTurnover("2026-09")).ok, true);
  assert.equal(writes.length, 1); assert.equal(writes[0].amount, 20);
  assert.equal(writes[0].bynAmount, 20); assert.equal(writes[0].currency, "BYN");
});

test("unknown debt or organization balance stops settleAll before rates or money writes", async () => {
  writes.length = 0; due = null; balance = 100;
  assert.equal((await actions.settleAll("2026-09", "cash")).ok, false);
  due = 10; balance = null;
  assert.equal((await actions.settleAll("2026-09", "cash")).ok, false);
  assert.equal(writes.length, 0);
});
