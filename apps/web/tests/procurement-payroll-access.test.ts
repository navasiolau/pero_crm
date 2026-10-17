import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Prisma, type Role } from "@prisma/client";
import type { Session } from "next-auth";
import type { NextRequest } from "next/server";

import { authConfig } from "../src/auth.config";
import { assertPayoutRole, issuePayoutCore, type CashPayoutInput, type PayoutActor } from "../src/server/payroll/cash-core";
import { accrueTurnoverCore } from "../src/server/payroll/turnover-core";
import { canReceiveNotificationContent } from "../src/lib/notification-access";
import { scopeNotificationContent } from "../src/server/access/notification-visibility";
import { guardedModuleCache } from "./helpers/guarded-module-cache";

Object.assign(globalThis, { React });

const deniedRoles: Role[][] = [["PROCUREMENT"], ["PROCUREMENT", "MANAGER"]];
const allowedRoles: Role[][] = [["ADMIN"], ["DIRECTOR"], ["ACCOUNTANT"], ["PROCUREMENT", "ACCOUNTANT"]];
const actor = (roles: Role[]): PayoutActor => ({ id: "actor", name: "Сотрудник", roles, source: "web" });
const salary: CashPayoutInput = { kind: "SALARY", userId: "employee", month: "2000-01", cashAccountId: "cash",
  cashAmount: "5.00", expectedCashCurrency: "BYN", requestId: "e1441829-7cef-4e8d-b039-54e6caec2645" };
const advance: CashPayoutInput = { ...salary, kind: "ADVANCE", description: "Сборка шкафа" };
const today = new Date().toISOString().slice(0, 10);
const rates = { asOf: today, cash: { currency: "BYN" as const, rate: "1.000000", date: today },
  payroll: { currency: "BYN" as const, rate: "1.000000", date: today } };
const forbidden = () => { throw Error("FORBIDDEN_FINANCIAL_READ"); };

function sessionFixture(roles: Role[], targets: string[], extra: Record<string, Record<string, unknown>> = {}, prisma: object = {}) {
  const overrides = {
    "../src/auth": { auth: async () => ({ user: actor(roles) }) },
    "next/navigation": { redirect: (path: string) => { throw Error("REDIRECT " + path); } },
    "next/cache": { revalidatePath: () => {} },
    ...extra,
  };
  return guardedModuleCache(import.meta.url, { targets, overrides, allowedOverrides: Object.keys(overrides), prisma });
}

test("procurement keeps finance, advances and own payroll routes while salary management follows role union", () => {
  const authorize = (roles: Role[], path: string) => authConfig.callbacks.authorized({
    auth: { user: { id: "actor", roles, sessionVersion: 1 }, expires: "2099-01-01" } as Session,
    request: { nextUrl: new URL("https://crm.example.invalid" + path) } as NextRequest,
  });
  for (const roles of deniedRoles) {
    for (const path of ["/finance/payroll", "/finance/payroll/export"]) assert.notEqual(authorize(roles, path), true);
    for (const path of ["/finance", "/finance/accounts", "/finance/expenses", "/finance/advances", "/payroll"])
      assert.equal(authorize(roles, path), true);
  }
  for (const roles of allowedRoles) assert.equal(authorize(roles, "/finance/payroll"), true);
});

test("finance overview hides only payroll management card for procurement and respects accountant union", async () => {
  for (const roles of [...deniedRoles, ...allowedRoles]) {
    const fixture = sessionFixture(roles, ["../src/app/(app)/finance/page"]);
    await fixture.run(async () => {
      const { default: Page } = fixture.load<typeof import("../src/app/(app)/finance/page")>("../src/app/(app)/finance/page");
      const html = renderToStaticMarkup(await Page());
      assert.equal(html.includes('href="/finance/payroll"'), allowedRoles.includes(roles));
      for (const path of ["/finance/accounts", "/finance/expenses", "/finance/advances"])
        assert.ok(html.includes(`href="${path}"`));
    });
  }
});

test("direct payroll page and CSV refuse procurement before any financial read", async () => {
  const blockedQueries = Object.fromEntries(["currentMonth", "getPayrollCurrency", "getPayrollSummary", "readPayrollSummary",
    "getMonthTurnover", "getTurnoverAccruals", "listPayrollUsers", "getOrgBalance", "getEmployeeDues", "getCurrentMonthEstimates"]
    .map(name => [name, forbidden]));
  for (const roles of deniedRoles) {
    const fixture = sessionFixture(roles, ["../src/app/(app)/finance/payroll/page", "../src/app/(app)/finance/payroll/export/route"], {
      "../src/server/payroll/queries": { ...blockedQueries, isValidMonth: () => true },
      "../src/server/payroll/cash-actions": { listAdvanceOptions: forbidden },
      "../src/app/(app)/finance/payroll/finance-payroll-view": { FinancePayrollView: () => null },
    });
    await fixture.run(async () => {
      const { default: Page } = fixture.load<typeof import("../src/app/(app)/finance/payroll/page")>("../src/app/(app)/finance/payroll/page");
      await assert.rejects(Page({ searchParams: Promise.resolve({ month: "2000-01" }) }), /REDIRECT \//);
      const { GET } = fixture.load<typeof import("../src/app/(app)/finance/payroll/export/route")>("../src/app/(app)/finance/payroll/export/route");
      const response = await GET(new Request("https://crm.example.invalid/finance/payroll/export?month=2000-01"));
      assert.equal(response.status, 403);
      assert.equal(await response.text(), "Недостаточно прав");
    });
  }
});

test("payroll CSV permits accountant combinations and preserves exported values", async () => {
  for (const roles of allowedRoles) {
    let reads = 0;
    const fixture = sessionFixture(roles, ["../src/app/(app)/finance/payroll/export/route"], {
      "../src/server/payroll/queries": { currentMonth: () => "2000-01", isValidMonth: () => true, getPayrollCurrency: async () => "BYN",
        getPayrollSummary: async () => { reads++; return { rows: [{ name: "Сотрудник", payScheme: "PIECE", accrued: 10,
          paid: 3, advance: 2, due: 5 }], totals: { accrued: 10, paid: 3, advance: 2, due: 5 } }; } },
    });
    await fixture.run(async () => {
      const { GET } = fixture.load<typeof import("../src/app/(app)/finance/payroll/export/route")>("../src/app/(app)/finance/payroll/export/route");
      const response = await GET(new Request("https://crm.example.invalid/finance/payroll/export"));
      assert.equal(response.status, 200); assert.equal(reads, 1);
      assert.match(await response.text(), /"10,00";"3,00";"2,00";"5,00"/);
    });
  }
});

test("direct salary actions deny procurement before service, rates, summaries or writes", async () => {
  for (const roles of deniedRoles) {
    const fixture = sessionFixture(roles, ["../src/server/payroll/actions"], {
      "../src/server/payroll/cash-service": { executeCashPayout: forbidden },
      "../src/server/payroll/turnover-core": { accrueTurnoverCore: forbidden },
      "../src/server/payroll/queries": { isValidMonth: () => true, readPayrollSummary: forbidden, getEmployeeDues: forbidden,
        getOrgBalance: forbidden, getPayrollCurrency: forbidden },
      "../src/server/finance/queries": { listCashAccounts: forbidden },
      "../src/server/tasks/transaction": { withTaskTransaction: forbidden },
    });
    await fixture.run(async () => {
      const actions = fixture.load<typeof import("../src/server/payroll/actions")>("../src/server/payroll/actions");
      await assert.rejects(actions.addPayout({ ...salary, month: "2000-01" }), /Недостаточно прав/);
      await assert.rejects(actions.addPayout({ ...salary, month: "2000-01", kind: undefined }), /Недостаточно прав/);
      await assert.rejects(actions.accrueTurnover("2000-01"), /Недостаточно прав/);
      await assert.rejects(actions.settleAll("2000-01", "cash"), /Недостаточно прав/);
    });
  }
});

test("salary actions allow payroll managers including procurement plus accountant", async () => {
  for (const roles of allowedRoles) {
    const calls: string[] = [];
    const fixture = sessionFixture(roles, ["../src/server/payroll/actions"], {
      "../src/server/payroll/cash-service": { executeCashPayout: async (who: PayoutActor, input: CashPayoutInput) => {
        assert.deepEqual(who.roles, roles); assert.equal(input.kind, "SALARY"); calls.push("payout"); return { ok: true, payoutId: "saved" };
      } },
      "../src/server/payroll/turnover-core": { accrueTurnoverCore: async (who: PayoutActor) => {
        assert.deepEqual(who.roles, roles); calls.push("accrue"); return { ok: true, accruedCount: 0, earnings: [] };
      } },
      "../src/server/payroll/queries": { isValidMonth: () => true, readPayrollSummary: async () => ({}),
        getEmployeeDues: async () => { calls.push("dues"); return []; }, getOrgBalance: async () => 100 },
      "../src/server/finance/queries": { listCashAccounts: async () => [{ id: "cash", active: true, currency: "BYN" }] },
    });
    await fixture.run(async () => {
      const actions = fixture.load<typeof import("../src/server/payroll/actions")>("../src/server/payroll/actions");
      assert.equal((await actions.addPayout({ ...salary, month: "2000-01" })).ok, true);
      assert.deepEqual(await actions.accrueTurnover("2000-01"), { ok: true, accruedCount: 0 });
      assert.match((await actions.settleAll("2000-01", "cash")).error!, /Задолженности.*нет/);
      assert.deepEqual(calls, ["payout", "accrue", "dues"]);
    });
  }
});

test("payout deletion reads only kind before rejecting salary and still deletes procurement advances", async () => {
  for (const roles of [...deniedRoles, ["PROCUREMENT", "ACCOUNTANT"] as Role[]]) {
    for (const kind of ["SALARY", "ADVANCE"] as const) {
      const calls: string[] = [];
      const tx = { payout: {
        findUnique: async (args: { select?: { kind: boolean } }) => {
          if (args.select) { assert.deepEqual(args.select, { kind: true }); calls.push("kind"); return { kind }; }
          calls.push("details"); return { kind, user: { name: "Сотрудник" }, amount: new Prisma.Decimal(5), cashAmount: new Prisma.Decimal(5), cashCurrency: "BYN", month: "2000-01" };
        },
        delete: async () => { calls.push("delete"); },
      }, changeLog: { create: async () => { calls.push("audit"); } } };
      const fixture = sessionFixture(roles, ["../src/server/payroll/actions"], {
        "../src/server/tasks/transaction": { withTaskTransaction: async (operation: (tx: object) => Promise<unknown>) => operation(tx) },
      });
      await fixture.run(async () => {
        const { deletePayout } = fixture.load<typeof import("../src/server/payroll/actions")>("../src/server/payroll/actions");
        if (kind === "SALARY" && !roles.includes("ACCOUNTANT")) {
          await assert.rejects(deletePayout("payout"), /Недостаточно прав/);
          assert.deepEqual(calls, ["kind"]);
        } else {
          assert.deepEqual(await deletePayout("payout"), { ok: true });
          assert.deepEqual(calls, ["kind", "details", "delete", "audit"]);
        }
      });
    }
  }
});

test("salary payout core and turnover core refuse procurement before transaction or DB access", async () => {
  const blockedTx = new Proxy({} as Prisma.TransactionClient, { get: forbidden });
  for (const roles of deniedRoles) {
    assert.throws(() => assertPayoutRole(actor(roles), "SALARY"), /Недостаточно прав/);
    assert.doesNotThrow(() => assertPayoutRole(actor(roles), "ADVANCE"));
    await assert.rejects(issuePayoutCore(actor(roles), salary, rates, blockedTx), /Недостаточно прав/);
    await assert.rejects(accrueTurnoverCore(actor(roles), "2000-01", forbidden), /Недостаточно прав/);
  }
  for (const roles of allowedRoles) {
    assert.doesNotThrow(() => assertPayoutRole(actor(roles), "SALARY"));
    assert.doesNotThrow(() => assertPayoutRole(actor(roles), "ADVANCE"));
  }
});

test("salary service refuses procurement before reading even existing request receipts", async () => {
  for (const roles of deniedRoles) {
    const fixture = sessionFixture(roles, ["../src/server/payroll/cash-service"], {
      "../src/server/tasks/transaction": { withTaskTransaction: forbidden },
      "../src/server/finance/nbrb": { getNbrbRate: forbidden },
    }, { changeLog: { findUnique: forbidden }, cashAccount: { findUnique: forbidden } });
    await fixture.run(async () => {
      const { executeCashPayout } = fixture.load<typeof import("../src/server/payroll/cash-service")>("../src/server/payroll/cash-service");
      const result = await executeCashPayout(actor(roles), salary);
      assert.equal(result.ok, false); assert.match(result.error!, /Недостаточно прав/);
    });
  }
});

test("procurement advance add, issue and quote adapters retain original rights and payload", async () => {
  const submitted: CashPayoutInput[] = [];
  const fixture = sessionFixture(["PROCUREMENT"], ["../src/server/payroll/actions", "../src/server/payroll/cash-actions"], {
    "../src/server/payroll/cash-service": { executeCashPayout: async (who: PayoutActor, input: CashPayoutInput) => {
      assert.deepEqual(who.roles, ["PROCUREMENT"]); submitted.push(input); return { ok: true, payoutId: "saved" };
    }, preparedRates: async () => rates },
  });
  await fixture.run(async () => {
    const { addPayout } = fixture.load<typeof import("../src/server/payroll/actions")>("../src/server/payroll/actions");
    assert.equal((await addPayout({ ...advance, month: "2000-01", comment: advance.description })).ok, true);
    const { issueAdvance, previewCashPayout } = fixture.load<typeof import("../src/server/payroll/cash-actions")>("../src/server/payroll/cash-actions");
    assert.equal((await issueAdvance({ ...advance, description: advance.description! })).ok, true);
    const preview = await previewCashPayout(advance);
    assert.equal(preview.ok, true);
    if (preview.ok) assert.equal(preview.preview.cashAmount, "5.00");
    assert.equal(submitted.length, 2); assert.ok(submitted.every(input => input.kind === "ADVANCE"));
  });
});

test("personal payroll remains scoped to the procurement session user", async () => {
  const calls: string[] = [];
  const fixture = sessionFixture(["PROCUREMENT"], ["../src/app/(app)/payroll/page"], {
    "../src/server/payroll/queries": { currentMonth: () => "2000-01", isValidMonth: () => true, getPayrollCurrency: async () => "BYN",
      getMyPayroll: async (id: string) => { calls.push(id); return {}; } },
    "../src/app/(app)/payroll/payroll-view": { PayrollView: () => null },
  });
  await fixture.run(async () => {
    const { default: Page } = fixture.load<typeof import("../src/app/(app)/payroll/page")>("../src/app/(app)/payroll/page");
    await Page({ searchParams: Promise.resolve({ month: "2000-01", userId: "other-employee" }) });
    assert.deepEqual(calls, ["actor"]);
  });
});

test("historical mixed and accrual notifications are filtered without altering stored rows", async () => {
  const items = ["payroll.orgPayout", "payroll.orgAccrued", "payroll.orgAdvance", "payroll.payout"].map(type => ({
    id: type, type, title: "Сумма", body: "5 BYN", link: "/finance/payroll",
  }));
  const baseline = JSON.stringify(items);
  const db = {} as Parameters<typeof scopeNotificationContent>[2];
  for (const roles of deniedRoles) {
    const scoped = await scopeNotificationContent(actor(roles), items, db);
    assert.deepEqual(scoped.map(row => row.type), ["payroll.orgAdvance", "payroll.payout"]);
    assert.equal(canReceiveNotificationContent(roles, "payroll.orgPayout"), false);
  }
  const scoped = await scopeNotificationContent(actor(["PROCUREMENT", "ACCOUNTANT"]), items, db);
  assert.deepEqual(scoped, items); assert.equal(JSON.stringify(items), baseline);
});

test("new salary and advance notifications select different recipients and retain accountant union", async () => {
  const users = [{ id: "supply", roles: ["PROCUREMENT"] }, { id: "both", roles: ["PROCUREMENT", "ACCOUNTANT"] },
    { id: "accountant", roles: ["ACCOUNTANT"] }];
  const recipients: { userId: string; type: string; link: string }[] = [];
  const fixture = sessionFixture(["ACCOUNTANT"], ["../src/server/payroll/cash-post-commit", "../src/server/notifications/notify"], {}, {
    user: { findMany: async (args: { where: { roles: { hasSome: string[] } } }) => users.filter(user =>
      user.roles.some(role => args.where.roles.hasSome.includes(role))) },
    notificationPreference: { findMany: async () => [] },
    notification: { create: async ({ data }: { data: typeof recipients[number] }) => { recipients.push(data); } },
  });
  await fixture.run(async () => {
    const { deliverCashPayout } = fixture.load<typeof import("../src/server/payroll/cash-post-commit")>("../src/server/payroll/cash-post-commit");
    const { notifyOrg, receivableTypesFor } = fixture.load<typeof import("../src/server/notifications/notify")>("../src/server/notifications/notify");
    for (const kind of ["ADVANCE", "SALARY"] as const) await deliverCashPayout({ repeated: false, payoutId: "saved", amount: "5.00",
      cashAmount: "5.00", currency: "BYN", payrollCurrency: "BYN", userId: "employee", userName: "Работник", month: "2000-01", eventId: null },
    { kind, description: "Сборка" }, "issuer", { dispatchEvent: async () => {}, notifyPerson: async () => {}, notifyOrg, revalidatePath: () => {} });
    assert.deepEqual(recipients.map(row => `${row.type}:${row.userId}`), ["payroll.orgAdvance:supply", "payroll.orgAdvance:both",
      "payroll.orgAdvance:accountant", "payroll.orgPayout:both", "payroll.orgPayout:accountant"]);
    assert.ok(recipients.filter(row => row.type === "payroll.orgAdvance").every(row => row.link === "/finance/advances"));
    assert.equal(receivableTypesFor(["PROCUREMENT"]).some(type => type.id === "payroll.orgPayout"), false);
    assert.equal(receivableTypesFor(["PROCUREMENT", "ACCOUNTANT"]).some(type => type.id === "payroll.orgPayout"), true);
  });
});

const advancePreferences = [
  { name: "disabled legacy", legacy: false, explicit: undefined, enabled: false },
  { name: "enabled legacy", legacy: true, explicit: undefined, enabled: true },
  { name: "explicit opt-in", legacy: false, explicit: true, enabled: true },
  { name: "explicit opt-out", legacy: true, explicit: false, enabled: false },
  { name: "default", legacy: undefined, explicit: undefined, enabled: true },
];

function preferenceDatabase(legacy: boolean | undefined, explicit: boolean | undefined, emitted: string[]) {
  const stored = [
    ...(legacy === undefined ? [] : [{ type: "payroll.orgPayout", enabled: legacy }]),
    ...(explicit === undefined ? [] : [{ type: "payroll.orgAdvance", enabled: explicit }]),
  ];
  return { stored, database: {
    user: { findMany: async () => [{ id: "actor" }] },
    notificationPreference: {
      findUnique: async ({ where }: { where: { userId_type: { userId: string; type: string } } }) => {
        assert.equal(where.userId_type.userId, "actor");
        return stored.find(row => row.type === where.userId_type.type) ?? null;
      },
      findMany: async ({ where }: { where: { userId: string; type: { in: string[] } } }) => {
        assert.equal(where.userId, "actor");
        return stored.filter(row => where.type.in.includes(row.type));
      },
    },
    notification: { create: async ({ data }: { data: { type: string } }) => { emitted.push(data.type); } },
  } };
}

test("sending advances preserves disabled legacy preference and honors explicit overrides without rewriting preferences", async () => {
  for (const scenario of advancePreferences) {
    const emitted: string[] = [];
    const { stored, database } = preferenceDatabase(scenario.legacy, scenario.explicit, emitted);
    const baseline = JSON.stringify(stored);
    const fixture = sessionFixture(["PROCUREMENT"], ["../src/server/notifications/notify"], {}, database);
    await fixture.run(async () => {
      const { notifyOrg } = fixture.load<typeof import("../src/server/notifications/notify")>("../src/server/notifications/notify");
      await notifyOrg({ type: "payroll.orgAdvance", title: "Аванс", link: "/finance/advances" });
      assert.deepEqual(emitted, scenario.enabled ? ["payroll.orgAdvance"] : [], scenario.name);
      assert.equal(JSON.stringify(stored), baseline);
    });
  }
});

test("advance settings display inherited preference even when procurement cannot see old mixed type", async () => {
  for (const scenario of advancePreferences) {
    const { stored, database } = preferenceDatabase(scenario.legacy, scenario.explicit, []);
    const baseline = JSON.stringify(stored);
    const fixture = sessionFixture(["PROCUREMENT"], ["../src/server/notifications/actions"], {
      "../src/server/calendar/reminder-visibility": { currentReminderNamespace: async () => null },
    }, database);
    await fixture.run(async () => {
      const { getMyPreferences } = fixture.load<typeof import("../src/server/notifications/actions")>("../src/server/notifications/actions");
      const { prefs } = await getMyPreferences();
      assert.equal(prefs.find(row => row.id === "payroll.orgAdvance")?.enabled, scenario.enabled, scenario.name);
      assert.equal(prefs.some(row => row.id === "payroll.orgPayout"), false);
      assert.equal(prefs.find(row => row.id === "payment.added")?.enabled, true);
      assert.equal(JSON.stringify(stored), baseline);
    });
  }
});
