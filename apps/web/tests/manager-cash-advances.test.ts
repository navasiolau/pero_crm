import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateCashPayout, calculateOrgBalance, parseCashAmount, parseCashRate } from "../src/lib/cash-ledger";
import { didSettleAnything, settlementConfirmationDisabled, settlementPreviewDisclosure } from "../src/app/(app)/finance/payroll/settlement-preview";
import { buildSalaryPayoutRetry, salaryRetryBlockedByLimit } from "../src/app/(app)/advances/cash-payout-operation";
import { type Session } from "next-auth";
import { type NextRequest } from "next/server";
import { authConfig } from "../src/auth.config";
import { navItemsForRole } from "../src/lib/nav";
import { type Role } from "../src/lib/roles";
import { deliverCashPayout } from "../src/server/payroll/cash-post-commit";

// Источник: manager-cash-advances.test.ts
const today = new Date().toISOString().slice(0, 10);

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

// Источник: manager-cash-advances-bulk-ui.test.ts
test("bulk settlement labels cross-currency debt estimates as an upper bound", () => {
  const disclosure = settlementPreviewDisclosure("BYN", "USD");
  assert.match(disclosure, /верхняя граница/i);
  assert.match(disclosure, /USD/);
  assert.match(disclosure, /курс/i);
});

test("empty cash prevents confirming bulk settlement", () => {
  assert.equal(settlementConfirmationDisabled(0, 100, false), true);
  assert.equal(settlementConfirmationDisabled(0, 0, false), true);
  assert.equal(settlementConfirmationDisabled(10, 100, false), false);
  assert.equal(settlementConfirmationDisabled(10, 100, true), true);
});

test("a zero-recipient result is not reported as a successful settlement", () => {
  assert.equal(didSettleAnything({ ok: true, paidCount: 0, totalPaid: 0 }), false);
  assert.equal(didSettleAnything({ ok: true, paidCount: 2, totalPaid: 45 }), true);
  assert.equal(didSettleAnything({ ok: false, paidCount: 2, totalPaid: 45 }), false);
});

// Источник: manager-cash-advances-retry.test.ts
test("salary retry keeps the submitted month and request id despite live month changes", () => {
  const frozen = {
    requestId: "frozen-request-id",
    month: "2026-09",
    payload: {
      userId: "employee-1",
      cashAccountId: "cash-usd",
      cashAmount: "12.50",
      expectedCashCurrency: "USD" as const,
      description: "Работа по заказу",
    },
  };

  assert.deepEqual(buildSalaryPayoutRetry(frozen, "2026-10"), {
    userId: "employee-1",
    cashAccountId: "cash-usd",
    cashAmount: "12.50",
    expectedCashCurrency: "USD",
    requestId: "frozen-request-id",
    month: "2026-09",
    kind: "SALARY",
    comment: "Работа по заказу",
  });
});

test("mutable salary cap cannot block retry of an already submitted request", () => {
  assert.equal(salaryRetryBlockedByLimit(false, true), true);
  assert.equal(salaryRetryBlockedByLimit(true, true), false);
  assert.equal(salaryRetryBlockedByLimit(false, false), false);
});

// Источник: manager-cash-advances-ui.test.ts
function session(roles: Role[]): Session {
  return { user: { id: "cash-ui", name: "Cash UI", roles, sessionVersion: 1 }, expires: "2099-01-01" };
}

function authorize(roles: Role[], pathname: string) {
  return authConfig.callbacks.authorized({
    auth: session(roles),
    request: { nextUrl: new URL(`https://crm.example.invalid${pathname}`) } as NextRequest,
  });
}

test("pure manager has neither advance nor finance navigation or route access", () => {
  const items = navItemsForRole(["MANAGER"]);
  assert.equal(items.some((item) => item.href === "/advances"), false);
  assert.equal(items.some((item) => item.href === "/finance"), false);
  assert.notEqual(authorize(["MANAGER"], "/advances"), true);
  assert.notEqual(authorize(["MANAGER"], "/finance/payroll"), true);
});

test("field roles cannot see or directly open advances", () => {
  assert.equal(navItemsForRole(["WORKER"]).some((item) => item.href === "/advances"), false);
  assert.notEqual(authorize(["WORKER"], "/advances"), true);
});

test("advances live within finance for financial and combined roles", () => {
  for (const roles of [["ADMIN"], ["DIRECTOR"], ["ACCOUNTANT"], ["PROCUREMENT"], ["MANAGER", "ACCOUNTANT"]] as Role[][]) {
    assert.equal(navItemsForRole(roles).some((item) => item.href === "/advances"), false);
    assert.ok(navItemsForRole(roles).some((item) => item.href === "/finance"));
    assert.equal(authorize(roles, "/finance/advances"), true);
    assert.equal(authorize(roles, "/advances"), true);
  }
  for (const role of ["MANAGER", "ENGINEER", "WORKER", "MOUNTER"] as Role[]) {
    assert.notEqual(authorize([role], "/finance/advances"), true);
  }
});

// Источник: manager-cash-post-commit.test.ts
test("post-commit cache failures never turn a persisted payout into an error response", async () => {
  const calls: string[] = [];
  await deliverCashPayout({ repeated: false, payoutId: "payout", amount: "120.00", cashAmount: "120.00",
    currency: "BYN", payrollCurrency: "BYN", userId: "employee", userName: "Employee", month: "2026-09", eventId: "event" },
  { kind: "ADVANCE", description: "Сборка шкафа" }, "manager", {
    dispatchEvent: async () => { calls.push("event"); },
    notifyPerson: async () => { calls.push("person"); },
    notifyOrg: async () => { calls.push("org"); },
    revalidatePath: () => { calls.push("cache"); throw new Error("cache unavailable"); },
  });
  assert.deepEqual(calls.slice(0, 3), ["event", "person", "org"]);
  assert.equal(calls.filter((call) => call === "cache").length, 4);
});

test("replayed payout creates no post-commit effects", async () => {
  let effects = 0;
  const increment = async () => { effects += 1; };
  await deliverCashPayout({ repeated: true, payoutId: "payout", amount: "120.00", cashAmount: "120.00",
    currency: "BYN", payrollCurrency: "BYN", userId: "employee", month: "2026-09", eventId: null },
  { kind: "ADVANCE", description: "Сборка шкафа" }, "manager", {
    dispatchEvent: increment, notifyPerson: increment, notifyOrg: increment, revalidatePath: () => { effects += 1; },
  });
  assert.equal(effects, 0);
});
