import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { before, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { matches, queryRows, type FixtureRow as Row } from "./helpers/visibility-fixture";

const require = createRequire(import.meta.url);
let entries: Row[] = [], payouts: Row[] = [], settlements: Row[] = [], users: Row[] = [];
let currency = "BYN", fx = 3, rateCalls = 0;
let payroll: typeof import("../src/server/payroll/queries");
let finance: typeof import("../src/server/finance/queries");
const month = new Date().toISOString().slice(0, 7);
const oldMonth = "2001-01";
type Query = { where?: Row; select?: Row; include?: Row; _sum?: Row; by?: string[] };

function model(source: () => Row[]) {
  return {
    findMany: async (query: Query = {}) => queryRows(source(), query),
    aggregate: async (query: Query = {}) => ({ _sum: { amount: source().filter((row) => matches(row, query.where)).reduce((sum, row) => sum + Number(row.amount), 0) } }),
    groupBy: async (query: Query = {}) => {
      const grouped = new Map<string, number>();
      for (const row of source().filter((item) => matches(item, query.where))) grouped.set(String(row.userId), (grouped.get(String(row.userId)) ?? 0) + Number(row.amount));
      return [...grouped].map(([userId, amount]) => ({ userId, _sum: { amount } }));
    },
  };
}
function reset() {
  entries = []; payouts = []; settlements = []; users = []; currency = "BYN"; fx = 3; rateCalls = 0;
}
function user(id: string, active: boolean, payScheme = "NONE") {
  users.push({ id, name: id, active, payScheme, payPercent: null, position: null });
}
function earned(userId: string, amount: string, earnedMonth = oldMonth) {
  entries.push({ id: `pay-${userId}`, userId, projectId: "project", month: earnedMonth, amount, currency: "BYN", scheme: "PRODUCT_ENGINEERING", settlementShareId: `share-${userId}`, projectAmount: amount, bynAmount: amount, percentageCompletionShareId: null, comment: null, createdAt: new Date() });
}

before(() => {
  (globalThis as { prisma?: PrismaClient }).prisma = {
    payrollEntry: model(() => entries), payout: model(() => payouts),
    user: model(() => users.map((row) => ({ ...row, payrollEntries: entries.filter((entry) => entry.userId === row.id) }))),
    project: { findUnique: async () => ({ id: "project", currency, products: [{ expectedPrice: "1000" }], delivery: null, unloading: null, installation: null }) },
    productStageSettlement: model(() => settlements),
    productPercentageCompletion: model(() => []),
    payment: model(() => []), stockMovement: model(() => []),
  } as unknown as PrismaClient;
  const filename = require.resolve("../src/server/finance/nbrb");
  const stubModule = new Module(filename);
  stubModule.exports = { getNbrbRate: async (code: string) => { rateCalls++; return { rate: code === "BYN" ? 1 : fx, date: "2026-09-28" }; } };
  stubModule.filename = filename; stubModule.loaded = true; require.cache[filename] = stubModule;
  payroll = require("../src/server/payroll/queries");
  finance = require("../src/server/finance/queries");
});

test("payroll entries retain their own saved currency", async () => {
  reset(); user("engineer", true); earned("engineer", "150", month);
  entries[0].currency = "USD";
  const result = await payroll.getMyPayroll("engineer", month);
  assert.equal((result.entries[0] as { currency?: string }).currency, "USD");
});

test("salary picker includes NONE recipients and inactive earned debt, but not paid inactive history", async () => {
  reset();
  user("current", true); earned("current", "10", month);
  user("inactive-owed", false); earned("inactive-owed", "100");
  user("inactive-paid", false); earned("inactive-paid", "100");
  payouts.push({ userId: "inactive-paid", amount: "100", payrollCurrency: "BYN", month: oldMonth });
  user("piece", true, "PIECE"); user("empty", true);
  assert.deepEqual((await payroll.listPayrollUsers()).map((row) => row.id).sort(), ["current", "inactive-owed", "piece"]);
});

test("an inactive NONE recipient remains in next month summary while debt is unpaid", async () => {
  reset(); user("former", false); earned("former", "100");
  payouts.push({ userId: "former", amount: "20", payrollCurrency: "BYN", month: oldMonth });
  const summary = await payroll.getPayrollSummary(month);
  assert.equal(summary.rows.length, 1);
  assert.equal(summary.rows[0].due, 80);
  assert.equal(summary.rows[0].accrued, 0);
});

test("project economics use frozen settlement equivalents and never convert its payroll again", async () => {
  reset(); currency = "USD"; earned("engineer", "150");
  entries[0].projectAmount = "50";
  settlements.push({ projectId: "project", productCurrency: "USD", projectAmount: "50", bynAmount: "150" });
  assert.equal((await finance.getProjectEconomics("project"))?.payrollTotal, 150);
  fx = 6;
  assert.equal((await finance.getProjectEconomics("project"))?.payrollTotal, 150);
  assert.equal(rateCalls, 0);
});

test("full settlement includes equivalent cents belonging to zero-payout shares", async () => {
  reset(); earned("positive", "0.01"); entries[0].currency = "USD"; entries[0].projectAmount = "0.02";
  settlements.push({ projectId: "project", productCurrency: "BYN", projectAmount: "0.03", bynAmount: "0.03" });
  const result = await finance.getProjectEconomics("project");
  assert.equal(result?.payrollTotal, 0.03);
  assert.equal(result?.marginAtFullPrice, 999.97);
  assert.equal(rateCalls, 0);
});

test("legacy explicit BYN payroll combines with fixed BYN settlement without conversion", async () => {
  reset(); currency = "USD";
  entries.push({ id: "old", projectId: "project", userId: "old", amount: "30", currency: "BYN", settlementShareId: null, percentageCompletionShareId: null });
  settlements.push({ projectId: "project", productCurrency: "USD", projectAmount: "50", bynAmount: "150" });
  assert.equal((await finance.getProjectEconomics("project"))?.payrollTotal, 180);
});

test("foreign settlement retains its fixed BYN projection regardless of current project currency", async () => {
  reset(); settlements.push({ projectId: "project", productCurrency: "USD", projectAmount: "50", bynAmount: "150" });
  assert.equal((await finance.getProjectEconomics("project"))?.payrollTotal, 150);
  assert.equal(rateCalls, 0);
});
