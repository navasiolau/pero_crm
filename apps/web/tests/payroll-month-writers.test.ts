import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire, Module } from "node:module";
import { after, test } from "node:test";
import { Prisma } from "@prisma/client";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { payrollMonth, payrollMonthRange, shiftPayrollMonth } from "../src/lib/payroll-month";
import { taskShareFixture } from "./helpers/task-share-fixture";

const require = createRequire(import.meta.url);
const previousModules = new Map<string, NodeModule | undefined>();
function inject(path: string, exports: Record<string, unknown>) {
  const id = require.resolve(path);
  if (!previousModules.has(id)) previousModules.set(id, require.cache[id]);
  const stub = new Module(id); stub.filename = id; stub.loaded = true; stub.exports = exports;
  require.cache[id] = stub;
}
function load<T>(path: string): T {
  const id = require.resolve(path);
  if (!previousModules.has(id)) previousModules.set(id, require.cache[id]);
  return require(id) as T;
}
const previousReact = (globalThis as { React?: typeof React }).React;
Object.assign(globalThis, { React });
after(() => {
  for (const [id, previous] of previousModules) { if (previous) require.cache[id] = previous; else delete require.cache[id]; }
  if (previousReact) Object.assign(globalThis, { React: previousReact }); else delete (globalThis as { React?: typeof React }).React;
});

type Row = Record<string, unknown>;
const accountant = { id: "accountant", name: "Бухгалтер", roles: ["ACCOUNTANT" as const], source: "web" as const };
const manager = { id: "manager", name: "Manager", roles: ["MANAGER" as const], source: "web" as const };
const employee = { id: "employee", name: "Employee", active: true, roles: ["MANAGER"], payScheme: "PERCENT_TURNOVER", payPercent: new Prisma.Decimal(3) };
const ledger: Row[] = [];
let financialReads = 0, auditWrites = 0, eventWrites = 0, payoutServiceCalls = 0;
const database = {
  payment: { aggregate: async () => { financialReads += 1; return { _sum: { bynAmount: new Prisma.Decimal(10000) }, _count: { _all: 1 } }; } },
  payrollEntry: {
    findMany: async ({ where }: { where?: Row }) => ledger.filter((row) => !where || Object.entries(where).every(([key, value]) =>
      key === "userId" && typeof value === "object" ? true : key === "month" && value && typeof value === "object" && "lt" in value ? String(row.month) < String(value.lt) : row[key] === value)),
    create: async ({ data }: { data: Row }) => { const row = { id: `entry-${ledger.length}`, createdAt: new Date(), ...data }; ledger.push(row); return row; },
  },
  changeLog: { create: async () => { auditWrites += 1; return { id: "audit" }; } },
  domainEvent: { create: async () => { eventWrites += 1; return { id: "event" }; } },
  payout: { findMany: async () => [] },
  user: { findMany: async () => [employee] },
};
inject("../src/server/tasks/transaction", { withTaskTransaction: async (operation: (tx: Prisma.TransactionClient) => Promise<unknown>) => operation(database as unknown as Prisma.TransactionClient) });
inject("../src/lib/prisma", { prisma: database });
inject("next/cache", { revalidatePath() {} });
inject("../src/server/require-role", { requireFinance: async () => ({ user: accountant }), requireAdmin: async () => ({ user: accountant }) });
inject("../src/server/plugins/changelog", { writeChangeLog: async () => { auditWrites += 1; } });
inject("../src/server/plugins/events", { emitDomainEvent: async () => { eventWrites += 1; }, dispatchEvent: async () => {} });
inject("../src/server/notifications/notify", { notifyPerson: async () => {}, notifyOrg: async () => {} });
inject("../src/server/payroll/cash-service", { executeCashPayout: async () => { payoutServiceCalls += 1; return { ok: true }; } });
inject("../src/server/payroll/cash-actions", { listAdvanceOptions: async () => ({ users: [], accounts: [] }), issueAdvance: async () => { throw new Error("UNEXPECTED_MUTATION"); }, previewCashPayout: async () => { throw new Error("UNEXPECTED_MUTATION"); } });
inject("../src/auth", { auth: async () => ({ user: accountant }) });
inject("next/navigation", {
  usePathname: () => "/payroll", useRouter: () => ({ replace() {}, refresh() {} }), useSearchParams: () => new URLSearchParams(),
  redirect(path: string) { throw new Error("REDIRECT " + path); },
});
const actions = load<typeof import("../src/server/payroll/actions")>("../src/server/payroll/actions");
const { issuePayoutCore } = load<typeof import("../src/server/payroll/cash-core")>("../src/server/payroll/cash-core");
load<typeof import("../src/server/product-percentage-pay/direct-completion")>("../src/server/product-percentage-pay/direct-completion");
load<typeof import("../src/server/product-percentage-pay/core")>("../src/server/product-percentage-pay/core");
const { changeTaskStatusCore } = load<typeof import("../src/server/tasks/completion-core")>("../src/server/tasks/completion-core");
const monthSwitcher = load<typeof import("../src/components/month-switcher")>("../src/components/month-switcher");
const csv = load<typeof import("../src/app/(app)/finance/payroll/export/route")>("../src/app/(app)/finance/payroll/export/route");
const ownPage = load<typeof import("../src/app/(app)/payroll/page")>("../src/app/(app)/payroll/page");
const financePage = load<typeof import("../src/app/(app)/finance/payroll/page")>("../src/app/(app)/finance/payroll/page");
const cashInput = () => ({ userId: "employee", cashAccountId: "cash", cashAmount: "120.00", expectedCashCurrency: "BYN" as const, requestId: randomUUID(), description: "QA работа" });
const fixedRates = { asOf: "2026-10-31", cash: { currency: "BYN", rate: "1.000000", date: "2026-10-31" }, payroll: { currency: "BYN", rate: "1.000000", date: "2026-10-31" } } as const;

test("sequential alias attempt is refused after the only valid accrual with no additional effects", async () => {
  ledger.length = 0;
  assert.equal((await actions.accrueTurnover("2026-01")).ok, true);
  assert.equal(ledger.length, 1); assert.equal(new Prisma.Decimal(String(ledger[0].amount)).toNumber(), 300);
  const before = { ledger: JSON.stringify(ledger), reads: financialReads, audit: auditWrites, events: eventWrites };
  for (const invalid of ["2025-13", "2026-00", "0000-01", "2026-01\n"])
    assert.equal((await actions.accrueTurnover(invalid)).ok, false);
  assert.deepEqual({ ledger: JSON.stringify(ledger), reads: financialReads, audit: auditWrites, events: eventWrites }, before);
});

test("invalid payout actions and core reject before service or transaction reads", async () => {
  const noDatabase = new Proxy({}, { get() { throw new Error("UNEXPECTED_DATABASE_ACCESS"); } }) as Prisma.TransactionClient;
  for (const month of ["2025-13", "2026-00", "0000-01", "2026-01\n"]) {
    assert.equal((await actions.addPayout({ ...cashInput(), kind: "SALARY", month })).ok, false);
    assert.equal((await actions.settleAll(month, "cash")).ok, false);
    await assert.rejects(issuePayoutCore(accountant, { ...cashInput(), kind: "SALARY", month }, fixedRates, noDatabase), /месяц/);
  }
  assert.equal(payoutServiceCalls, 0);
});

test("piece task completion uses its done instant in Moscow and preserves frozen reward", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-12-31T21:30:00.000Z").getTime() });
  const fixture = taskShareFixture();
  const result = await changeTaskStatusCore(manager, "source", "DONE", undefined, fixture.transaction);
  assert.equal(result.ok, true); assert.equal(fixture.state().entries.length, 1);
  assert.equal(fixture.state().entries[0].month, "2027-01"); assert.equal(fixture.state().entries[0].amount, "1000.00");
  assert.equal(fixture.state().tasks[0].status, "DONE");
});

test("payroll navigation keeps 0001/0099 years and protects the earliest previous month", () => {
  assert.equal(shiftPayrollMonth("0099-12", 1), "0100-01"); assert.equal(shiftPayrollMonth("0001-01", 1), "0001-02");
  assert.throws(() => shiftPayrollMonth("0001-01", -1), /диапазон/); assert.throws(() => shiftPayrollMonth("9999-12", 1), /диапазон/);
  assert.equal(payrollMonth(payrollMonthRange("0001-01").start), "0001-01");
  assert.equal(payrollMonth(payrollMonthRange("0099-12").start), "0099-12");
  const maximum = payrollMonthRange("9999-12"); assert.equal(maximum.end.toISOString(), "9999-12-31T21:00:00.000Z");
  const html = renderToStaticMarkup(React.createElement(monthSwitcher.MonthSwitcher, { month: "0001-01" }));
  assert.match(html, /disabled=""[^>]*aria-label="Предыдущий месяц"/);
});

test("UTC-rendered month switcher agrees with Moscow current month without layout changes", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-31T21:30:00.000Z").getTime() });
  const html = renderToStaticMarkup(React.createElement(monthSwitcher.MonthSwitcher, { month: "2026-11" }));
  assert.match(html, /Ноябрь 2026 г\./); assert.match(html, /disabled=""[^>]*aria-label="Следующий месяц"/);
  assert.match(html, /class="flex items-center gap-1"/);
});

test("explicit invalid CSV is 400 without query; valid/default export keeps canonical period and CSV contract", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-31T21:30:00.000Z").getTime() });
  const reads = financialReads;
  assert.equal((await csv.GET(new Request("http://localhost/finance/payroll/export?month=2025-13"))).status, 400);
  assert.equal(financialReads, reads);
  const result = await csv.GET(new Request("http://localhost/finance/payroll/export"));
  assert.equal(result.status, 200); assert.equal(result.headers.get("Content-Disposition"), 'attachment; filename="payroll-2026-11.csv"');
  assert.equal(result.headers.get("Content-Type"), "text/csv; charset=utf-8");
  assert.match(await result.text(), /"ФИО";"Схема оплаты"/);
});

test("payroll pages redirect invalid keys before data and use canonical Moscow default", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-31T21:30:00.000Z").getTime() });
  const reads = financialReads;
  await assert.rejects(ownPage.default({ searchParams: Promise.resolve({ month: "2025-13" }) }), /REDIRECT \/payroll\?month=2026-11/);
  await assert.rejects(financePage.default({ searchParams: Promise.resolve({ month: "2026-00" }) }), /REDIRECT \/finance\/payroll\?month=2026-11/);
  assert.equal(financialReads, reads);
  const result = await ownPage.default({ searchParams: Promise.resolve({}) });
  assert.equal(result.props.month, "2026-11"); assert.equal(result.props.currentPeriod, "2026-11");
});