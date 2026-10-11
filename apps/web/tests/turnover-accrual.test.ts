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

test("ten independent accrual commands create exactly300 and reread all inputs under transaction", async () => {
  const f = reset(); f.staleGate(10);
  const results = await Promise.all(Array.from({ length: 10 }, () => actions.accrueTurnover("2026-01")));
  assert.ok(results.every((result) => result.ok));
  assert.equal(f.state().entries.reduce((sum, row) => sum.plus(String(row.amount)), new Prisma.Decimal(0)).toFixed(2), "300.00");
  assert.equal(f.state().entries.length, 1); assert.equal(f.state().logs.length, 1); assert.equal(f.state().events.length, 1);
  assert.ok(f.reads.length >= 30); assert.ok(f.reads.every((read) => read.startsWith("inside:")));
});

test("failure of audit after payroll leaves no partial money or outbox", async () => {
  const f = reset(); f.failOn("audit");
  const result = await actions.accrueTurnover("2026-01").catch(() => ({ ok: false }));
  assert.equal(result.ok, false); assert.equal(f.state().entries.length, 0); assert.equal(f.state().logs.length, 0); assert.equal(f.state().events.length, 0);
});
const { accrueTurnoverCore } = require("../src/server/payroll/turnover-core") as typeof import("../src/server/payroll/turnover-core");
const { readMonthTurnoverSnapshot } = require("../src/server/payroll/turnover-query") as typeof import("../src/server/payroll/turnover-query");

test("lawful top-up adds only60; replay and lower turnover preserve original records", async () => {
  const f = reset();
  assert.equal((await actions.accrueTurnover("2026-01")).accruedCount, 1);
  const first = JSON.stringify(f.state().entries[0]);
  f.state().turnover = "12000.00";
  assert.equal((await actions.accrueTurnover("2026-01")).accruedCount, 1);
  assert.equal(f.state().entries[1].amount, "60.00"); assert.equal(JSON.stringify(f.state().entries[0]), first);
  const entireHistory = JSON.stringify(f.state().entries);
  assert.equal((await actions.accrueTurnover("2026-01")).accruedCount, 0);
  f.state().turnover = "8000.00";
  assert.equal((await actions.accrueTurnover("2026-01")).accruedCount, 0);
  assert.equal(JSON.stringify(f.state().entries), entireHistory); assert.equal(f.state().logs.length, 2); assert.equal(f.state().events.length, 2);
  assert.match(String(f.state().entries[1].comment), /доначисление/);
});

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

test("fixed foreign BYN history is used once; unknown for one employee blocks whole command", async () => {
  let f = reset(); f.state().turnover = "1000.00"; f.state().users[0].payPercent = "5";
  f.state().entries.push({ id: "prior", userId: "payee", month: "2026-01", scheme: "PERCENT_TURNOVER", amount: "10", currency: "USD", bynAmount: "30" });
  const prior = JSON.stringify(f.state().entries[0]);
  assert.equal((await actions.accrueTurnover("2026-01")).ok, true); assert.equal(f.state().entries[1].amount, "20.00");
  assert.equal(JSON.stringify(f.state().entries[0]), prior);
  f = reset(); f.state().users.push({ ...f.state().users[0], id: "second", name: "Second" });
  f.state().entries.push({ id: "unknown", userId: "second", month: "2026-01", scheme: "PERCENT_TURNOVER", amount: "10", currency: "USD", bynAmount: null });
  const unchanged = JSON.stringify(f.state());
  const result = await actions.accrueTurnover("2026-01");
  assert.equal(result.ok, false); assert.match(result.error!, /BYN/); assert.equal(JSON.stringify(f.state()), unchanged); assert.equal(f.effects.length, 0);
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

test("combined engineer gets chosen turnover alongside frozen history; pure engineer stays excluded", async () => {
  const f = reset(); f.state().users[0].roles = ["ENGINEER", "MANAGER"];
  f.state().users.push({ ...f.state().users[0], id: "pure", name: "Pure", roles: ["ENGINEER"] });
  f.state().entries.push({ id: "frozen", userId: "payee", month: "2026-01", scheme: "PRODUCT_PERCENT_ENGINEERING", amount: "150", currency: "BYN", bynAmount: "150" });
  const frozen = JSON.stringify(f.state().entries[0]);
  assert.equal((await actions.accrueTurnover("2026-01")).accruedCount, 1);
  assert.equal(f.state().entries[1].userId, "payee"); assert.equal(f.state().entries[1].amount, "300.00"); assert.equal(JSON.stringify(f.state().entries[0]), frozen);
});

test("no eligible employee and zero turnover preserve previous API behavior", async () => {
  let f = reset(); f.state().users[0].active = false;
  const empty = await actions.accrueTurnover("2026-01"); assert.equal(empty.ok, false); assert.match(empty.error!, /Нет сотрудников/); assert.equal(f.effects.length, 0);
  f = reset(); f.state().turnover = "0.00";
  const zero = await actions.accrueTurnover("2026-01"); assert.equal(zero.ok, true); assert.equal(zero.accruedCount, 0);
  assert.equal(f.state().entries.length, 0); assert.deepEqual(f.effects, ["cache", "cache"]);
});

test("invalid/current/future periods and unauthorized core refuse before transaction reads", async () => {
  const f = reset(); const actor = { id: "actor", name: "Actor", roles: ["WORKER" as const], source: "web" as const };
  await assert.rejects(accrueTurnoverCore(actor, "2026-01", f.transaction), /прав/);
  for (const month of ["2025-13", "0000-01", "9999-12"]) assert.equal((await actions.accrueTurnover(month)).ok, false);
  assert.equal(f.reads.length, 0); assert.equal(f.writes.length, 0); assert.equal(f.effects.length, 0);
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
const diagnostic = require("./turnover-accrual-native") as typeof import("./turnover-accrual-native");
function diagnosticApproval() {
  return { source: "root-reviewed" as const, operation: "diagnostic" as const, runId: diagnostic.TURNOVER_NATIVE_MANIFEST.runId,
    sourceHash: diagnostic.sourceHash(), containerId: diagnostic.TURNOVER_NATIVE_MANIFEST.containerId,
    exclusiveLocalWindow: true as const, localOutboxInactive: true as const, observationEvidence: "UNIT-only inert fake transaction; no DB connection" };
}
test("guard sanitizer extracts only closed code from multiline assertion and discards raw PII/URL", () => {
  assert.equal(diagnostic.safeNativeFailureCode(new Error("QA130_ENABLED_PLUGIN_STOP\n\nactual 1 expected0 private user secret://dsn")), "QA130_ENABLED_PLUGIN_STOP");
  assert.equal(diagnostic.safeNativeFailureCode(new Error("QA130_PRIVATE_PASSWORD root secret://dsn")), "QA130_SCENARIO_FAILED");
  assert.equal(diagnostic.safeNativeFailureCode(new Error("sensitive database error")), "QA130_SCENARIO_FAILED");
});
test("read-only guard diagnostic stops at plugin count with no writes or private rows", async () => {
  const calls: string[] = [];
  const tx = { $executeRawUnsafe: async (sql: string) => { assert.equal(sql, "SET TRANSACTION READ ONLY"); calls.push("read-only"); },
    $queryRaw: async () => { assert.equal(calls[0], "read-only"); calls.push("identity"); return [{ database: "pero_crm", username: "pero" }]; },
    user: { findMany: async () => { calls.push("payees"); return []; } }, payment: { count: async () => { calls.push("income"); return 0; } },
    plugin: { findMany: async () => { calls.push("plugins"); return [{ id: "unknown" }]; } },
  } as unknown as Prisma.TransactionClient;
  const database = { $transaction: async (operation: (database: Prisma.TransactionClient) => Promise<unknown>) => operation(tx) } as unknown as Pick<import("@prisma/client").PrismaClient, "$transaction">;
  const result = await diagnostic.runReadOnlyGuardDiagnostic(database, diagnosticApproval());
  assert.equal(result.status, "DIAGNOSTIC_GUARD_FAILED"); assert.equal(result.code, "QA130_ENABLED_PLUGIN_ID_STOP");
  assert.deepEqual(result.trace.counts, { identityMatches: true, outsidePayees: 0, outsideIncome: 0, enabledPlugins: 1 });
  assert.equal(result.readOnly, true); assert.equal(result.mutationStarted, false); assert.equal(JSON.stringify(result).includes("username"), false);
  assert.deepEqual(calls, ["read-only", "identity", "payees", "income", "plugins"]);
});
test("plugin inspection is SELECT-only, source-pinned metadata and never invokes enabled hook", async () => {
  const registry = require("../src/server/plugins/registry") as typeof import("../src/server/plugins/registry");
  const manifest = registry.getManifest("demo")!, previousHook = manifest.hooks!.onDomainEvent;
  let hooks = 0; manifest.hooks!.onDomainEvent = async () => { hooks += 1; };
  const calls: string[] = [];
  const tx = { $executeRawUnsafe: async (sql: string) => { assert.equal(sql, "SET TRANSACTION READ ONLY"); calls.push("read-only"); },
    $queryRaw: async () => { assert.equal(calls[0], "read-only"); calls.push("identity"); return [{ database: "pero_crm", username: "pero" }]; },
    plugin: { findMany: async (args: { select: { id: boolean } }) => { assert.deepEqual(args.select, { id: true }); calls.push("plugin-ids"); return [{ id: "demo" }]; } },
  } as unknown as Prisma.TransactionClient;
  const database = { $transaction: async (operation: (database: Prisma.TransactionClient) => Promise<unknown>) => operation(tx) } as unknown as Pick<import("@prisma/client").PrismaClient, "$transaction">;
  try {
    const result = await diagnostic.runReadOnlyPluginInspection(database, { ...diagnosticApproval(), operation: "plugin-inspection" });
    assert.equal(result.readOnly, true); assert.equal(result.mutationStarted, false); assert.equal(result.enabledCount, 1);
    assert.deepEqual(result.plugins, [{ id: "demo", registered: true, hasDomainEventHook: true }]); assert.equal(hooks, 0);
    assert.deepEqual(calls, ["read-only", "identity", "plugin-ids"]); assert.equal(JSON.stringify(result).includes("settings"), false);
  } finally { manifest.hooks!.onDomainEvent = previousHook; }
});
test("narrow legacy gate accepts only exact file-stages metadata and refuses registered/unknown/runtime drift", async () => {
  const registry = require("../src/server/plugins/registry") as typeof import("../src/server/plugins/registry");
  const manifests = registry.listManifests(), originalLength = manifests.length;
  let pluginIds = ["file-stages"];
  const tx = { $executeRawUnsafe: async (sql: string) => { assert.equal(sql, "SET TRANSACTION READ ONLY"); },
    $queryRaw: async () => [{ database: "pero_crm", username: "pero" }], $queryRawUnsafe: async () => [{ count: "0" }],
    user: { findMany: async () => [] }, payment: { count: async () => 0 }, plugin: { findMany: async () => pluginIds.map((id) => ({ id })) },
  } as unknown as Prisma.TransactionClient;
  const database = { $transaction: async (operation: (database: Prisma.TransactionClient) => Promise<unknown>) => operation(tx) } as unknown as Pick<import("@prisma/client").PrismaClient, "$transaction">;
  const approval = diagnosticApproval();
  assert.equal((await diagnostic.runReadOnlyGuardDiagnostic(database, approval)).status, "DIAGNOSTIC_GUARDS_PASS");
  for (const ids of [[], ["demo"], ["file-stages", "unknown"]]) { pluginIds = ids; const result = await diagnostic.runReadOnlyGuardDiagnostic(database, approval); assert.equal(result.status, "DIAGNOSTIC_GUARD_FAILED"); assert.equal(result.code, "QA130_ENABLED_PLUGIN_ID_STOP"); }
  pluginIds = ["file-stages"];
  try {
    manifests.push({ id: "file-stages", name: "inert test", version: "0", apiVersion: 1, permissions: [], hooks: { onDomainEvent: async () => { throw new Error("HOOK_MUST_NOT_EXECUTE"); } } });
    const result = await diagnostic.runReadOnlyGuardDiagnostic(database, approval); assert.equal(result.code, "QA130_REGISTERED_PLUGIN_STOP");
  } finally { manifests.splice(originalLength); }
  await assert.rejects(diagnostic.runReadOnlyGuardDiagnostic(database, { ...approval, sourceHash: "0".repeat(64) }), /DRIFT/);
  await assert.rejects(diagnostic.runReadOnlyGuardDiagnostic(database, { ...approval, localOutboxInactive: false as unknown as true }), /INACTIVE/);
});