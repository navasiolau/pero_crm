import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import test from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { PayrollView as PayrollViewType } from "../src/app/(app)/payroll/payroll-view";

Object.assign(globalThis, { React });
const require = createRequire(import.meta.url);
function stubModule(name: string, exports: unknown) {
  const filename = require.resolve(name);
  const stub = new Module(filename);
  stub.filename = filename;
  stub.loaded = true;
  stub.exports = exports;
  require.cache[filename] = stub;
}

type ViewProps = React.ComponentProps<typeof PayrollViewType>;
const common = {
  currentPeriod: "2026-10",
  currency: "BYN",
  debt: -300,
  estimate: 450,
};
const fixtures: Record<string, ViewProps> = {
  "2026-09": {
    ...common,
    month: "2026-09",
    accrued: 275.45,
    paid: 27.55,
    entries: [{
      id: "own-entry-past", amount: 100, currency: "USD", bynAmount: 275.45,
      scheme: "PIECEWORK", comment: "Моя работа за сентябрь", createdAt: "2026-09-15T09:00:00Z",
    }],
    payouts: [{
      id: "own-payout-past", amount: 10, payrollCurrency: "USD", bynAmount: 27.55,
      cashAmount: "10.00", cashCurrency: "USD", cashAccountName: "Касса USD",
      kind: "SALARY", comment: "Получено за прошлый месяц", createdByName: "Бухгалтер",
      createdAt: "2026-09-20T09:00:00Z",
    }],
  },
  "2026-10": {
    ...common,
    month: "2026-10",
    accrued: 450,
    paid: 50,
    entries: [{
      id: "own-entry-current", amount: 450, currency: "BYN", bynAmount: 450,
      scheme: "PIECEWORK", comment: "Моя работа за октябрь", createdAt: "2026-10-02T09:00:00Z",
    }],
    payouts: [{
      id: "own-payout-current", amount: 50, payrollCurrency: "BYN", bynAmount: 50,
      cashAmount: "20.00", cashCurrency: "USD", cashAccountName: "Касса USD",
      kind: "ADVANCE", comment: "Полученный аванс", createdByName: "Бухгалтер",
      createdAt: "2026-10-03T09:00:00Z",
    }],
  },
  "2026-08": {
    ...common,
    month: "2026-08",
    debt: null,
    estimate: null,
    accrued: null,
    paid: null,
    entries: [{
      id: "own-entry-unknown", amount: 120, currency: "USD", bynAmount: null,
      scheme: "PIECEWORK", comment: "Историческое начисление", createdAt: "2026-08-10T09:00:00Z",
    }],
    payouts: [{
      id: "own-payout-unknown", amount: 20, payrollCurrency: null, bynAmount: null,
      cashAmount: null, cashCurrency: null, cashAccountName: null,
      kind: "SALARY", comment: null, createdByName: null, createdAt: "2026-08-20T09:00:00Z",
    }],
  },
};
const calls: { userId: string; month: string }[] = [];
let roles = ["WORKER"];
stubModule("next/navigation", {
  usePathname: () => "/payroll",
  useRouter: () => ({ replace: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  redirect: (path: string) => { throw new Error("REDIRECT " + path); },
});
stubModule("../src/auth", { auth: async () => ({ user: { id: "own-user", roles } }) });
stubModule("../src/server/payroll/queries", {
  currentMonth: () => common.currentPeriod,
  isValidMonth: (month: string | undefined) => !!month && /^\d{4}-\d{2}$/.test(month),
  getPayrollCurrency: async () => "BYN",
  getMyPayroll: async (userId: string, month: string) => {
    calls.push({ userId, month });
    return fixtures[month];
  },
});
const { PayrollView } = require("../src/app/(app)/payroll/payroll-view") as {
  PayrollView: typeof PayrollViewType;
};
const { default: PayrollPage } = require("../src/app/(app)/payroll/page") as typeof import("../src/app/(app)/payroll/page");

function region(html: string, id: string): string {
  const start = html.indexOf('<section aria-labelledby="' + id + '"');
  assert.ok(start >= 0, "Missing payroll region " + id);
  const end = html.indexOf("</section>", start);
  return html.slice(start, end + "</section>".length);
}

test("personal payroll separates current values from month history, preserves own records and exposes cash details without revaluing history", async () => {
  const baseline = JSON.stringify(fixtures);
  const rendered = new Map<string, string>();
  for (const month of ["2026-09", "2026-10", "2026-08"]) {
    const view = await PayrollPage({
      searchParams: Promise.resolve({ month, userId: "another-user" }),
    });
    const html = renderToStaticMarkup(view);
    rendered.set(month, html);
    const bodies = [...html.matchAll(/<tbody[^>]*>([\s\S]*?)<\/tbody>/g)];
    assert.equal(bodies.length, 2);
    assert.equal((bodies[0][1].match(/data-slot="table-row"/g) ?? []).length, fixtures[month].entries.length);
    assert.equal((bodies[1][1].match(/data-slot="table-row"/g) ?? []).length, fixtures[month].payouts.length);
    assert.match(html, /<details[^>]*><summary[^>]*>Детали<\/summary>/);
    assert.match(html, /data-slot="mobile-list-card"/);
    assert.equal((region(html, "payroll-now").match(/data-slot="card"/g) ?? []).length, 2);
    assert.doesNotMatch(region(html, "payroll-now"), /Предыдущий месяц/);
    assert.match(region(html, "payroll-history"), /Предыдущий месяц/);
  }

  const past = rendered.get("2026-09")!;
  const current = rendered.get("2026-10")!;
  assert.equal(region(past, "payroll-now"), region(current, "payroll-now"));
  assert.match(region(past, "payroll-now"), />0 BYN</);
  assert.match(region(past, "payroll-now"), /Выплачено вперёд: 300 BYN/);
  assert.match(region(past, "payroll-now"), /За октябрь 2026/);
  assert.match(region(past, "payroll-now"), /≈ 450 BYN/);
  assert.match(region(past, "payroll-history"), /Начислено: <strong>275,45 BYN/);
  assert.match(region(past, "payroll-history"), /Выплачено: <strong>27,55 BYN/);
  assert.match(past, /100 \$/);
  assert.match(past, /10 \$/);
  assert.match(past, /Касса USD/);
  assert.match(past, /Бухгалтер/);
  assert.doesNotMatch(region(past, "payroll-history"), /Месяц ещё идёт/);
  assert.match(region(current, "payroll-history"), /Месяц ещё идёт/);
  assert.match(current, /Аванс/);
  assert.match(current, /20 \$/);

  const unknown = rendered.get("2026-08")!;
  assert.match(region(unknown, "payroll-now"), /Сумма неизвестна/);
  assert.doesNotMatch(region(unknown, "payroll-now"), />0 BYN</);
  assert.match(region(unknown, "payroll-history"), /Начислено: <strong>Сумма неизвестна/);
  assert.match(unknown, /валюта неизвестна/);
  assert.match(unknown, /120 \$/);
  assert.match(unknown, /Точную сумму нельзя определить/);
  assert.deepEqual(calls, ["2026-09", "2026-10", "2026-08"].map(month => ({ userId: "own-user", month })));
  assert.equal(JSON.stringify(fixtures), baseline);

  roles = ["DIRECTOR"];
  await assert.rejects(PayrollPage({ searchParams: Promise.resolve({ month: "2026-09" }) }), /REDIRECT \//);
  assert.equal(calls.length, 3);
  const ownDirectView = renderToStaticMarkup(React.createElement(PayrollView, fixtures["2026-09"]));
  assert.equal(region(ownDirectView, "payroll-now"), region(past, "payroll-now"));
});
