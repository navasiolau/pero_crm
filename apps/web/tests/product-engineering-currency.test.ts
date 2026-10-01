import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { before, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import type { DomainActor } from "../src/server/projects/core";
import type { TaskTransaction } from "../src/server/tasks/transaction";

const require = createRequire(import.meta.url);
const actor: DomainActor = { id: "admin", name: "Admin", roles: ["ADMIN"], source: "web" };
let projectCurrency = "BYN", payrollCurrency: string | null = null, inside = false;
let settlements: { id: string; projectId: string; currency: string }[] = [];
let percentageCompletions: { projectId: string; state: "PENDING_FX" | "SETTLED" | "SKIPPED_ONCE"; payrollCurrency: string; productCurrency: string }[] = [];
let cashPayouts = 0;
let tail = Promise.resolve();
let project: typeof import("../src/server/projects/core"), payroll: typeof import("../src/server/payroll/actions");
let transaction: TaskTransaction;
function reset() { projectCurrency = "BYN"; payrollCurrency = null; settlements = []; percentageCompletions = []; cashPayouts = 0; tail = Promise.resolve(); }
const db = {
  $queryRaw: async () => [{ locked: 1 }],
  project: {
    findUnique: async () => ({ id: "project", currency: projectCurrency }),
    update: async ({ data }: { data: { currency?: string } }) => { if (data.currency) projectCurrency = data.currency; return { id: "project", currency: projectCurrency }; },
  },
  orgSetting: {
    findUnique: async () => payrollCurrency === null ? null : { value: payrollCurrency },
    upsert: async ({ update }: { update: { value: string } }) => { payrollCurrency = update.value; return { value: payrollCurrency }; },
  },
  productStageSettlement: {
    count: async (query?: { where?: { projectId?: string } }) => {
      assert.ok(inside, "Settlement guard must run inside the shared transaction");
      return settlements.filter((item) => !query?.where?.projectId || item.projectId === query.where.projectId).length;
    },
    create: async () => { const row = { id: "earned", projectId: "project", currency: payrollCurrency ?? "BYN" }; settlements.push(row); return row; },
  },
  productPercentageCompletion: { count: async (query: { where: { product?: { projectId?: string }; state: { in: string[] };
    payrollCurrency?: { not: string }; productCurrency?: { not: string } } }) => {
    assert.ok(inside, "Direct-percentage currency guard must run inside the shared transaction");
    return percentageCompletions.filter((item) => query.where.state.in.includes(item.state) &&
      (!query.where.product?.projectId || item.projectId === query.where.product.projectId) &&
      (!query.where.payrollCurrency || item.payrollCurrency !== query.where.payrollCurrency.not) &&
      (!query.where.productCurrency || item.productCurrency !== query.where.productCurrency.not)).length;
  } },
  payout: { count: async () => cashPayouts },
  changeLog: { create: async () => ({ id: "log" }) },
  $transaction: async (operation: (tx: unknown) => Promise<unknown>) => {
    const previous = tail; let release!: () => void; tail = new Promise<void>((resolve) => { release = resolve; });
    await previous; inside = true;
    const old = { projectCurrency, payrollCurrency, settlements: structuredClone(settlements), percentageCompletions: structuredClone(percentageCompletions) };
    try { return await operation(db); }
    catch (error) { projectCurrency = old.projectCurrency; payrollCurrency = old.payrollCurrency; settlements = old.settlements; percentageCompletions = old.percentageCompletions; throw error; }
    finally { inside = false; release(); }
  },
};
function inject(path: string, exports: Record<string, unknown>) {
  const filename = require.resolve(path), stub = new Module(filename); stub.exports = exports; stub.filename = filename; stub.loaded = true; require.cache[filename] = stub;
}
before(() => {
  reset(); (globalThis as { prisma?: PrismaClient }).prisma = db as unknown as PrismaClient;
  inject("next/cache", { revalidatePath: () => {} });
  inject("../src/server/require-role", { requireAdmin: async () => ({ user: actor }) });
  inject("../src/server/plugins/changelog", { writeChangeLog: async () => {} });
  inject("../src/server/plugins/events", { emitDomainEvent: async () => {}, dispatchEvent: async () => {} });
  inject("../src/server/notifications/notify", { notifyOrg: async () => {}, notifyPerson: async () => {} });
  inject("../src/server/payroll/queries", { getPayrollCurrency: async () => payrollCurrency ?? "BYN" });
  project = require("../src/server/projects/core"); payroll = require("../src/server/payroll/actions");
  transaction = require("../src/server/tasks/transaction").withTaskTransaction;
});

test("project currency is frozen by its own settlement while same-value save remains allowed", async () => {
  reset(); settlements.push({ id: "old", projectId: "project", currency: "BYN" });
  assert.equal((await project.updateProjectCore(actor, "project", { currency: "USD" })).ok, false);
  assert.equal(projectCurrency, "BYN");
  assert.ok((await project.updateProjectCore(actor, "project", { currency: "BYN" })).ok);
  assert.equal(settlements[0].currency, "BYN");
});

test("a different project settlement does not bypass the internal BYN policy", async () => {
  reset(); settlements.push({ id: "other", projectId: "other-project", currency: "BYN" });
  assert.equal((await project.updateProjectCore(actor, "project", { currency: "USD" })).ok, false);
  assert.equal(projectCurrency, "BYN");
});

test("payroll currency is frozen organization-wide, including its implicit BYN default", async () => {
  reset(); settlements.push({ id: "old", projectId: "other-project", currency: "BYN" });
  assert.equal((await payroll.setPayrollCurrency("USD")).ok, false);
  assert.equal(payrollCurrency, null);
  assert.ok((await payroll.setPayrollCurrency("BYN")).ok);
  assert.equal(payrollCurrency, null);
});

test("payroll currency is BYN even before the first settlement", async () => {
  reset(); assert.equal((await payroll.setPayrollCurrency("USD")).ok, false); assert.equal(payrollCurrency, null);
});

test("a cash-linked payout freezes payroll currency without rewriting its saved amount", async () => {
  reset(); cashPayouts = 1;
  assert.equal((await payroll.setPayrollCurrency("USD")).ok, false);
  assert.equal(payrollCurrency, null);
});

test("a settlement committing first blocks the competing currency change under the same lock", async () => {
  reset();
  const close = transaction(async (tx) => tx.productStageSettlement.create({ data: {} as never }));
  const change = payroll.setPayrollCurrency("USD");
  await close;
  assert.equal((await change).ok, false);
  assert.equal(payrollCurrency, null);
  assert.equal(settlements[0].currency, "BYN");
});

test("direct percentage pending/settled freezes payroll and project currency; skipped does not", async () => {
  for (const state of ["PENDING_FX", "SETTLED"] as const) {
    reset(); percentageCompletions.push({ projectId: "project", state, payrollCurrency: "BYN", productCurrency: "BYN" });
    assert.equal((await payroll.setPayrollCurrency("USD")).ok, false);
    assert.equal((await project.updateProjectCore(actor, "project", { currency: "USD" })).ok, false);
    assert.equal(payrollCurrency, null); assert.equal(projectCurrency, "BYN");
  }
  reset(); percentageCompletions.push({ projectId: "project", state: "SKIPPED_ONCE", payrollCurrency: "BYN", productCurrency: "BYN" });
  assert.equal((await payroll.setPayrollCurrency("USD")).ok, false);
  assert.equal((await project.updateProjectCore(actor, "project", { currency: "USD" })).ok, false);
});


test("project create schema rejects explicit foreign currency and defaults missing currency to BYN", () => {
  const data = { title: "Заказ", clientId: "client" };
  assert.equal(project.createProjectSchema.parse(data).currency, "BYN");
  for (const currency of ["USD", "EUR", "RUB", "", "byn"]) assert.equal(project.createProjectSchema.safeParse({ ...data, currency }).success, false);
});

test("combined management role still rejects foreign input and worker has no new currency rights", async () => {
  reset();
  const combined = { ...actor, roles: ["MANAGER", "ENGINEER"] as DomainActor["roles"] };
  assert.equal((await project.updateProjectCore(combined, "project", { currency: "USD" })).ok, false);
  await assert.rejects(project.updateProjectCore({ ...actor, roles: ["WORKER"] }, "project", { currency: "BYN" }), /Недостаточно прав/);
  assert.equal(projectCurrency, "BYN");
});
