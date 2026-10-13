import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { after, test } from "node:test";
import { Prisma } from "@prisma/client";
import type { TaskTransaction } from "../src/server/tasks/transaction";

type Row = Record<string, unknown>;
const require = createRequire(import.meta.url);
const savedModules = new Map<string, NodeModule | undefined>();
function inject(path: string, exports: Record<string, unknown>) {
  const id = require.resolve(path); savedModules.set(id, require.cache[id]);
  const stub = new Module(id); stub.filename = id; stub.loaded = true; stub.exports = exports; require.cache[id] = stub;
}
function fixture() {
  let state = { entries: [] as Row[], logs: [] as Row[], events: [] as Row[], users: [{ id: "payee", name: "Payee", active: true,
    roles: ["MANAGER"], payScheme: "PERCENT_TURNOVER", payPercent: "3" }], turnover: "10000.00" };
  let activeTransaction = false, failAt = "", gateExpected = 1, waiting = 0, failNumber = 1, failedSteps = 0, onBegin: (() => void) | undefined, releaseGate: (() => void) | undefined;
  let gate = Promise.resolve(), tail = Promise.resolve();
  const effects: string[] = [], reads: string[] = [], writes: string[] = [], effectFailures = new Set<string>();
  function fail(name: string) { writes.push(name); if (failAt === name && ++failedSteps === failNumber) throw new Error("TRANSACTION_FAULT:" + name); }
  function read(name: string) { reads.push((activeTransaction ? "inside:" : "outside:") + name); }
  const db = {
    payment: { aggregate: async () => { read("turnover"); return { _sum: { bynAmount: new Prisma.Decimal(state.turnover) }, _count: { _all: 1 } }; } },
    user: { findMany: async () => { read("rates"); return state.users.filter((user) => user.active && user.payScheme === "PERCENT_TURNOVER" && Number(user.payPercent) > 0).map((user) => ({ ...user })); } },
    payrollEntry: { findMany: async ({ where }: { where: { month: string; scheme: string; userId: { in: string[] } } }) => {
      read("history"); const rows = state.entries.filter((row) => row.month === where.month && row.scheme === where.scheme && where.userId.in.includes(String(row.userId))).map((row) => ({ ...row }));
      if (!activeTransaction && gateExpected > 1) { waiting += 1; if (waiting === gateExpected) releaseGate!(); await gate; }
      return rows;
    }, create: async ({ data }: { data: Row }) => { fail("payroll"); const row = { id: `payroll-${state.entries.length}`, ...data }; state.entries.push(row); return row; } },
    changeLog: { create: async ({ data }: { data: Row }) => { fail("audit"); const row = { id: `audit-${state.logs.length}`, ...data }; state.logs.push(row); return row; } },
    domainEvent: { create: async ({ data }: { data: Row }) => { fail("outbox"); const row = { id: `event-${state.events.length}`, ...data }; state.events.push(row); return row; } },
  };
  const transaction: TaskTransaction = async (operation) => {
    const previous = tail; let release!: () => void; tail = new Promise<void>((resolve) => { release = resolve; }); await previous;
    const before = structuredClone(state); activeTransaction = true;
    try { if (onBegin) { const begin = onBegin; onBegin = undefined; begin(); } fail("transaction"); return await operation(db as unknown as Prisma.TransactionClient); }
    catch (error) { state = before; throw error; }
    finally { activeTransaction = false; release(); }
  };
  async function effect(name: string) { effects.push(name); if (effectFailures.has(name)) throw new Error("POST_COMMIT_FAULT:" + name); }
  return { db, transaction, state: () => state, effects, reads, writes, effectFailures,
    staleGate(expected: number) { gateExpected = expected; gate = new Promise<void>((resolve) => { releaseGate = resolve; }); },
    failOn(name: string, occurrence = 1) { failAt = name; failNumber = occurrence; failedSteps = 0; }, beforeTransaction(begin: () => void) { onBegin = begin; }, effect };
}
let active = fixture();
inject("../src/lib/prisma", { prisma: active.db });
inject("next/cache", { revalidatePath() { active.effects.push("cache"); if (active.effectFailures.has("cache")) throw new Error("CACHE_FAULT"); } });
inject("../src/server/require-role", { requireFinance: async () => ({ user: { id: "accountant", name: "Accountant", roles: ["ACCOUNTANT"] } }) });
inject("../src/server/plugins/changelog", { writeChangeLog: async (data: Row) => active.db.changeLog.create({ data }) });
inject("../src/server/plugins/events", { emitDomainEvent: async (type: string, payload: Row, actor: string) => active.db.domainEvent.create({ data: { type, payload, actor } }), dispatchEvent: async () => active.effect("dispatch") });
inject("../src/server/notifications/notify", { notifyPerson: async () => active.effect("person"), notifyOrg: async () => active.effect("org") });
inject("../src/server/tasks/transaction", { withTaskTransaction: ((operation) => active.transaction(operation)) as TaskTransaction });
const actions = require("../src/server/payroll/actions") as typeof import("../src/server/payroll/actions");
function reset() { active = fixture(); Object.assign((require("../src/lib/prisma") as { prisma: unknown }), { prisma: active.db }); return active; }
after(() => { for (const [id, previous] of savedModules) { if (previous) require.cache[id] = previous; else delete require.cache[id]; } });


test("failure of audit after payroll leaves no partial money or outbox", async () => {
  const f = reset(); f.failOn("audit");
  const result = await actions.accrueTurnover("2026-01").catch(() => ({ ok: false }));
  assert.equal(result.ok, false); assert.equal(f.state().entries.length, 0); assert.equal(f.state().logs.length, 0); assert.equal(f.state().events.length, 0);
});
const { accrueTurnoverCore } = require("../src/server/payroll/turnover-core") as typeof import("../src/server/payroll/turnover-core");
const { readMonthTurnoverSnapshot } = require("../src/server/payroll/turnover-query") as typeof import("../src/server/payroll/turnover-query");


test("payroll/audit/outbox and transaction rejection all fail without partial rows/effects", async () => {
  for (const step of ["payroll", "audit", "outbox", "transaction"]) {
    const f = reset(); f.failOn(step);
    const result = await actions.accrueTurnover("2026-01");
    assert.equal(result.ok, false, step); assert.equal(f.state().entries.length, 0, step);
    assert.equal(f.state().logs.length, 0, step); assert.equal(f.state().events.length, 0, step); assert.equal(f.effects.length, 0, step);
  }
});

test("fault on second employee audit rolls back the first employee too", async () => {
  const f = reset(); f.state().users.push({ ...f.state().users[0], id: "second", name: "Second" }); f.failOn("audit", 2);
  assert.equal((await actions.accrueTurnover("2026-01")).ok, false);
  assert.equal(f.state().entries.length, 0); assert.equal(f.state().logs.length, 0); assert.equal(f.state().events.length, 0);
});

test("rate and turnover are reread after entering transaction; audit keeps exact basis and entry link", async () => {
  const f = reset(); f.beforeTransaction(() => { f.state().turnover = "12000.00"; f.state().users[0].payPercent = "5"; });
  assert.equal((await actions.accrueTurnover("2026-01")).ok, true); assert.equal(f.state().entries[0].amount, "600.00");
  const audit = f.state().logs[0]; assert.equal(audit.entityId, f.state().entries[0].id);
  const value = audit.newValue as { amount: number; basis: Row };
  assert.deepEqual(value.basis, { start: "2025-12-31T21:00:00.000Z", end: "2026-01-31T21:00:00.000Z", currency: "BYN",
    totalByn: "12000.00", paymentsCount: 1, percent: "5", priorByn: "0.00", expectedByn: "600.00", deltaByn: "600.00" });
  const payload = f.state().events[0].payload as Row;
  assert.equal(payload.payrollEntryId, f.state().entries[0].id); assert.equal(payload.amount, 600); assert.equal(payload.basis, undefined);
});

test("Decimal aggregate remains exact in money basis even beyond JS fractional precision", async () => {
  const f = reset(); f.state().turnover = "90071992547409.99"; f.state().users[0].payPercent = "0.01";
  const snapshot = await readMonthTurnoverSnapshot("2026-01", f.db as unknown as Pick<Prisma.TransactionClient, "payment">);
  assert.equal(snapshot.total.toFixed(2), "90071992547409.99");
  assert.equal((await actions.accrueTurnover("2026-01")).ok, true);
  const basis = (f.state().logs[0].newValue as { basis: Row }).basis;
  assert.equal(basis.totalByn, "90071992547409.99"); assert.equal(f.state().entries[0].amount, "9007199254.74");
});
test("no eligible employee and zero turnover preserve previous API behavior", async () => {
  let f = reset(); f.state().users[0].active = false;
  const empty = await actions.accrueTurnover("2026-01"); assert.equal(empty.ok, false); assert.match(empty.error!, /Нет сотрудников/); assert.equal(f.effects.length, 0);
  f = reset(); f.state().turnover = "0.00";
  const zero = await actions.accrueTurnover("2026-01"); assert.equal(zero.ok, true); assert.equal(zero.accruedCount, 0);
  assert.equal(f.state().entries.length, 0); assert.deepEqual(f.effects, ["cache", "cache"]);
});

test("dispatch/person/org/cache faults do not turn confirmed commit into failed ACK or duplicate money", async () => {
  for (const effect of ["dispatch", "person", "org", "cache"]) {
    const f = reset(); f.effectFailures.add(effect);
    const first = await actions.accrueTurnover("2026-01"); assert.equal(first.ok, true, effect); assert.equal(first.accruedCount, 1);
    assert.equal(f.state().entries.length, 1); assert.equal(f.state().logs.length, 1); assert.equal(f.state().events.length, 1);
    const repeated = await actions.accrueTurnover("2026-01"); assert.equal(repeated.ok, true); assert.equal(repeated.accruedCount, 0);
    assert.equal(f.state().entries.length, 1); assert.equal(f.state().events.length, 1);
  }
});
