// SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP on guard mismatch.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, openSync, closeSync, fsyncSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";
import { existingLocalCrmDatabaseUrl } from "./helpers/local-crm-database";
import { nativeOwnedIds, nativeSnapshot } from "./helpers/native-acceptance-snapshot";
import { createTaskTransaction } from "../src/server/tasks/transaction";
import { accrueTurnoverCore } from "../src/server/payroll/turnover-core";
import { payrollMonthRange } from "../src/lib/payroll-month";
import { canAccrueOrdinarySalary } from "../src/lib/compensation-policy";
import { activePaymentWhere } from "../src/server/payments/active-records";
import { getManifest } from "../src/server/plugins/registry";

const runId = "af699a65-8480-4338-9654-829e41d2be10";
const prefix = "qa130-" + runId;
const month = "2000-01";
const containerId = "bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5";
const actorId = prefix + "-actor", payeeId = prefix + "-payee", secondaryId = prefix + "-second", cashId = prefix + "-cash";
const paymentIds = [prefix + "-income", prefix + "-topup", prefix + "-growth"];
const phases = [...Array.from({ length: 10 }, (_, index) => "concurrent-" + index), "topup", "replay", "decline", "fault-payroll", "fault-audit", "fault-outbox"];
const idsFor = (phase: string, userId: string) => {
  assert.ok(phases.includes(phase), "QA130_PHASE_GUARD"); assert.ok([payeeId, secondaryId].includes(userId), "QA130_PAYEE_GUARD");
  const key = prefix + "-" + phase + (userId === payeeId ? "-primary" : "-secondary");
  return { payroll: key + "-payroll", audit: key + "-audit", event: key + "-event" };
};
const writeSets = phases.flatMap((phase) => [idsFor(phase, payeeId), idsFor(phase, secondaryId)]);
export const TURNOVER_NATIVE_MANIFEST = {
  format: "pero-turnover130/v1", runId, month, containerId, database: "pero_crm", user: "pero", host: "127.0.0.1", port: 5433,
  ids: { User: [actorId, payeeId, secondaryId], CashAccount: [cashId], Payment: paymentIds,
    PayrollEntry: writeSets.map((ids) => ids.payroll), ChangeLog: writeSets.map((ids) => ids.audit), DomainEvent: writeSets.map((ids) => ids.event) },
  expected: { concurrentRequests: 10, minimumConnections: 2, initial: "300.00", topup: "60.00", faultPrimary: "60.00", faultSecondary: "420.00" },
  outputDir: join(tmpdir(), "pero-crm-qa130", runId),
};
const protectedSource = ["src/server/payroll/turnover-core.ts", "src/server/payroll/turnover-query.ts", "src/server/tasks/transaction.ts",
  "src/server/actor.ts", "src/server/payments/active-records.ts", "src/lib/payroll-month.ts", "src/lib/compensation-policy.ts", "src/lib/roles.ts", "src/lib/history-byn.ts", "tests/turnover-accrual-native.ts", "tests/helpers/local-crm-database.ts", "src/server/plugins/registry.ts", "../../packages/plugins/demo/src/plugin.ts", "../../packages/plugin-sdk/src/index.ts", "src/lib/calendar-dates.ts", "src/lib/internal-currency.ts", "src/lib/format.ts", "src/lib/work-shares.ts", "package.json", "tsconfig.json", "../../pnpm-lock.yaml"];
protectedSource.push("tests/helpers/native-acceptance-snapshot.ts");
export const sourceHash = () => createHash("sha256").update(protectedSource.map((name) => name + "\n" + readFileSync(resolve(name))).join("\n")).digest("hex");
function durable(name: string, value: unknown) {
  const directory = resolve(TURNOVER_NATIVE_MANIFEST.outputDir);
  let current = directory;
  while (dirname(current) !== current) { try { assert.equal(lstatSync(current).isSymbolicLink(), false, "QA130_REPARSE_GUARD"); } catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; } current = dirname(current); }
  mkdirSync(directory, { recursive: true });
  const file = join(directory, name + ".json"), bytes = Buffer.from(JSON.stringify(value) + "\n");
  const fd = openSync(file, "wx", 0o600); try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  assert.deepEqual(readFileSync(file), bytes, "QA130_DURABLE_READBACK");
}
const fingerprint = (db: PrismaClient | Prisma.TransactionClient, excludeOwned = false) =>
  nativeSnapshot(db, excludeOwned ? nativeOwnedIds(TURNOVER_NATIVE_MANIFEST.ids) : {});
export type GuardTrace = { stage: "identity" | "outside-payees" | "outside-income" | "plugins" | "fresh-ids" | "complete";
  counts: Partial<{ identityMatches: boolean; outsidePayees: number; outsideIncome: number; enabledPlugins: number; freshIdRows: number }> };
const knownGuardCodes = new Set(["QA130_DATABASE_GUARD", "QA130_OUTSIDE_ELIGIBLE_PAYEE_STOP", "QA130_OUTSIDE_INCOME_STOP", "QA130_ENABLED_PLUGIN_STOP", "QA130_FRESH_IDS_GUARD", "QA130_ENABLED_PLUGIN_ID_STOP", "QA130_REGISTERED_PLUGIN_STOP", "QA130_RUNTIME_HOOK_STOP"]);
export function safeNativeFailureCode(error: unknown): string {
  const first = error instanceof Error ? error.message.match(/^(QA130_[A-Z0-9_]+)/)?.[1] : undefined;
  return first && knownGuardCodes.has(first) ? first : "QA130_SCENARIO_FAILED";
}
async function guard(db: PrismaClient | Prisma.TransactionClient, prepared: boolean, trace: GuardTrace = { stage: "identity", counts: {} }) {
  trace.stage = "identity";
  const [identity] = await db.$queryRaw<{ database: string; username: string }[]>`SELECT current_database() AS database,current_user AS username`;
  trace.counts.identityMatches = identity?.database === "pero_crm" && identity?.username === "pero";
  assert.deepEqual(identity, { database: "pero_crm", username: "pero" }, "QA130_DATABASE_GUARD");
  trace.stage = "outside-payees";
  const eligible = await db.user.findMany({ where: { active: true, payScheme: "PERCENT_TURNOVER", payPercent: { gt: 0 } }, select: { id: true, roles: true } });
  trace.counts.outsidePayees = eligible.filter((row) => canAccrueOrdinarySalary(row.roles) && ![payeeId, secondaryId].includes(row.id)).length;
  assert.equal(trace.counts.outsidePayees, 0, "QA130_OUTSIDE_ELIGIBLE_PAYEE_STOP");
  trace.stage = "outside-income";
  const { start, end } = payrollMonthRange(month);
  trace.counts.outsideIncome = await db.payment.count({ where: { ...activePaymentWhere, direction: "INCOME", paidAt: { gte: start, lt: end }, id: { notIn: paymentIds } } });
  assert.equal(trace.counts.outsideIncome, 0, "QA130_OUTSIDE_INCOME_STOP");
  trace.stage = "plugins";
  // Точный наблюдённый legacy ID не зарегистрирован в runtime; конфигурация не меняется.
  const plugins = await db.plugin.findMany({ where: { enabled: true }, select: { id: true }, orderBy: { id: "asc" } });
  trace.counts.enabledPlugins = plugins.length;
  assert.deepEqual(plugins.map((plugin) => plugin.id), ["file-stages"], "QA130_ENABLED_PLUGIN_ID_STOP");
  const legacy = getManifest("file-stages");
  assert.equal(Boolean(legacy), false, "QA130_REGISTERED_PLUGIN_STOP");
  assert.equal(typeof legacy?.hooks?.onDomainEvent === "function", false, "QA130_RUNTIME_HOOK_STOP");
  if (!prepared) {
    trace.stage = "fresh-ids"; trace.counts.freshIdRows = 0;
    for (const [table, ids] of Object.entries(TURNOVER_NATIVE_MANIFEST.ids)) {
      const result = await db.$queryRawUnsafe<{ count: string }[]>(`SELECT count(*)::text AS count FROM "${table}" WHERE id = ANY($1::text[])`, ids);
      trace.counts.freshIdRows += Number(result[0].count);
      assert.equal(result[0].count, "0", "QA130_FRESH_IDS_GUARD:" + table);
    }
  }
  trace.stage = "complete";
}function ownedTransaction(db: PrismaClient, phase: string, failStep?: "payroll" | "audit" | "outbox") {
  const transaction = createTaskTransaction(db);
  return async <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> => transaction(async (tx) => {
    async function assertPrimaryCommittedWithinTransaction() {
      const primary = idsFor(phase, payeeId);
      assert.equal(await tx.payrollEntry.count({ where: { id: primary.payroll, userId: payeeId } }), 1, "QA130_PRIMARY_PAYROLL_BEFORE_FAULT");
      assert.equal(await tx.changeLog.count({ where: { id: primary.audit, actorId, entityId: primary.payroll } }), 1, "QA130_PRIMARY_AUDIT_BEFORE_FAULT");
      assert.equal(await tx.domainEvent.count({ where: { id: primary.event, actor: actorId } }), 1, "QA130_PRIMARY_EVENT_BEFORE_FAULT");
    }
    function payrollDelegate() { return new Proxy(tx.payrollEntry, { get(delegate, key) {
      if (key !== "create") return Reflect.get(delegate, key);
      return async (args: Prisma.PayrollEntryCreateArgs) => {
        const data = args.data as Prisma.PayrollEntryUncheckedCreateInput;
        assert.ok([payeeId, secondaryId].includes(data.userId), "QA130_WRITE_PAYEE_GUARD");
        assert.equal(data.month, month); assert.equal(data.scheme, "PERCENT_TURNOVER"); assert.equal(data.currency, "BYN");
        for (const field of ["projectId", "productId", "taskId", "workId", "settlementShareId", "percentageCompletionShareId", "percentageAdjustmentId"] as const)
          assert.ok(data[field] == null, "QA130_REAL_RELATION_FORBIDDEN:" + field);
        const expected = phase.startsWith("concurrent-") ? "300.00" : phase === "topup" ? "60.00" : phase.startsWith("fault-") ? data.userId === payeeId ? "60.00" : "420.00" : "0.00";
        assert.equal(new Prisma.Decimal(data.amount as Prisma.Decimal.Value).toFixed(2), expected, "QA130_AMOUNT_GUARD");
        assert.equal(new Prisma.Decimal(data.bynAmount as Prisma.Decimal.Value).toFixed(2), expected, "QA130_BYN_GUARD");
        if (failStep === "payroll" && data.userId === secondaryId) { await assertPrimaryCommittedWithinTransaction(); throw new Error("QA130_FAULT_PAYROLL"); }
        return delegate.create({ ...args, data: { ...data, id: idsFor(phase, data.userId).payroll } });
      };
    } }); }
    function auditDelegate() { return new Proxy(tx.changeLog, { get(delegate, key) {
      if (key !== "create") return Reflect.get(delegate, key);
      return async (args: Prisma.ChangeLogCreateArgs) => {
        assert.equal(args.data.actorId, actorId); assert.equal(args.data.entity, "payrollEntry");
        const userId = [payeeId, secondaryId].find((id) => idsFor(phase, id).payroll === args.data.entityId);
        assert.ok(userId, "QA130_AUDIT_LINK_GUARD");
        if (failStep === "audit" && userId === secondaryId) { await assertPrimaryCommittedWithinTransaction(); throw new Error("QA130_FAULT_AUDIT"); }
        return delegate.create({ ...args, data: { ...args.data, id: idsFor(phase, userId).audit } });
      };
    } }); }
    function eventDelegate() { return new Proxy(tx.domainEvent, { get(delegate, key) {
      if (key !== "create") return Reflect.get(delegate, key);
      return async (args: Prisma.DomainEventCreateArgs) => {
        const payload = args.data.payload;
        assert.equal(args.data.actor, actorId); assert.equal(args.data.type, "payroll.accrued");
        assert.ok(payload && typeof payload === "object" && !Array.isArray(payload) && "userId" in payload && typeof payload.userId === "string", "QA130_EVENT_PAYLOAD_GUARD");
        assert.ok([payeeId, secondaryId].includes(payload.userId));
        assert.ok("payrollEntryId" in payload && payload.payrollEntryId === idsFor(phase, payload.userId).payroll);
        if (failStep === "outbox" && payload.userId === secondaryId) { await assertPrimaryCommittedWithinTransaction(); throw new Error("QA130_FAULT_OUTBOX"); }
        return delegate.create({ ...args, data: { ...args.data, id: idsFor(phase, payload.userId).event } });
      };
    } }); }
    const users = new Proxy(tx.user, { get(delegate, key) {
      if (key !== "findMany") return Reflect.get(delegate, key);
      return async (args: Prisma.UserFindManyArgs) => {
        const rows = await delegate.findMany(args);
        assert.ok(rows.every((row) => [payeeId, secondaryId].includes(row.id)), "QA130_READ_PAYEE_GUARD");
        return rows.sort((left, right) => left.id.localeCompare(right.id));
      };
    } });
    const owned = new Proxy(tx, { get(delegate, key) {
      if (key === "user") return users;
      if (key === "payrollEntry") return payrollDelegate(); if (key === "changeLog") return auditDelegate(); if (key === "domainEvent") return eventDelegate();
      return Reflect.get(delegate, key);
    } });
    return operation(owned);
  });
}
async function captureOwned(db: PrismaClient) {
  const entries = await db.payrollEntry.findMany({ orderBy: { id: "asc" }, where: { id: { in: TURNOVER_NATIVE_MANIFEST.ids.PayrollEntry } }, select: { id: true, userId: true, amount: true, bynAmount: true, month: true, currency: true, scheme: true } });
  const logs = await db.changeLog.findMany({ orderBy: { id: "asc" }, where: { id: { in: TURNOVER_NATIVE_MANIFEST.ids.ChangeLog } }, select: { id: true, actorId: true, entity: true, entityId: true, newValue: true } });
  const events = await db.domainEvent.findMany({ orderBy: { id: "asc" }, where: { id: { in: TURNOVER_NATIVE_MANIFEST.ids.DomainEvent } }, select: { id: true, actor: true, type: true, payload: true } });
  for (const row of entries) { assert.equal(row.userId, payeeId); assert.equal(row.month, month); assert.equal(row.currency, "BYN"); assert.equal(row.scheme, "PERCENT_TURNOVER"); }
  assert.equal(entries.length, logs.length); assert.equal(entries.length, events.length);
  for (const entry of entries) {
    assert.equal(logs.filter((log) => log.actorId === actorId && log.entity === "payrollEntry" && log.entityId === entry.id).length, 1);
    assert.equal(events.filter((event) => event.actor === actorId && event.type === "payroll.accrued" && event.payload && typeof event.payload === "object" && !Array.isArray(event.payload) && "payrollEntryId" in event.payload && event.payload.payrollEntryId === entry.id).length, 1);
  }
  return { entries: entries.map((row) => ({ ...row, amount: row.amount.toFixed(2), bynAmount: row.bynAmount?.toFixed(2) })), logs, events };
}
export type TurnoverNativeApproval = { source: "root-reviewed"; operation: "execute" | "diagnostic" | "plugin-inspection"; runId: string; sourceHash: string; containerId: string;
  exclusiveLocalWindow: true; localOutboxInactive: true; observationEvidence: string };
function assertApproval(approval: TurnoverNativeApproval, operation: "execute" | "diagnostic" | "plugin-inspection") {
  assert.equal(approval.source, "root-reviewed"); assert.equal(approval.operation, operation); assert.equal(approval.runId, runId); assert.equal(approval.containerId, containerId);
  assert.equal(approval.sourceHash, sourceHash(), "QA130_APPROVED_SOURCE_DRIFT");
  assert.equal(approval.exclusiveLocalWindow, true, "QA130_EXCLUSIVE_WINDOW_REQUIRED");
  assert.equal(approval.localOutboxInactive, true, "QA130_LOCAL_OUTBOX_INACTIVE_PROOF_REQUIRED");
  assert.ok(typeof approval.observationEvidence === "string" && approval.observationEvidence.length > 10 && approval.observationEvidence.length < 2000, "QA130_ROOT_OBSERVATION_REQUIRED");
}
export async function runReadOnlyGuardDiagnostic(database: Pick<PrismaClient, "$transaction">, approval: TurnoverNativeApproval) {
  assertApproval(approval, "diagnostic");
  const trace: GuardTrace = { stage: "identity", counts: {} };
  try {
    return await database.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      try {
        await guard(tx, false, trace);
        return { status: "DIAGNOSTIC_GUARDS_PASS", runId, sourceHash: sourceHash(), readOnly: true, mutationStarted: false, trace };
      } catch (error) {
        return { status: "DIAGNOSTIC_GUARD_FAILED", code: safeNativeFailureCode(error), runId, sourceHash: sourceHash(), readOnly: true, mutationStarted: false, trace };
      }
    });
  } catch (error) {
    return { status: "DIAGNOSTIC_GUARD_FAILED", code: safeNativeFailureCode(error), runId, sourceHash: sourceHash(), readOnly: true, mutationStarted: false, trace };
  }
}
export async function diagnoseTurnoverNative(approval: TurnoverNativeApproval) {
  assertApproval(approval, "diagnostic");
  assert.equal(process.env.CRM_LOCAL_CONTAINER_ID, containerId, "QA130_EXPECTED_CONTAINER_GUARD");
  const database = new PrismaClient({ datasourceUrl: existingLocalCrmDatabaseUrl() });
  try { return await runReadOnlyGuardDiagnostic(database, approval); } finally { await database.$disconnect(); }
}
export async function runReadOnlyPluginInspection(database: Pick<PrismaClient, "$transaction">, approval: TurnoverNativeApproval) {
  assertApproval(approval, "plugin-inspection");
  return database.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const [identity] = await tx.$queryRaw<{ database: string; username: string }[]>`SELECT current_database() AS database,current_user AS username`;
    assert.deepEqual(identity, { database: "pero_crm", username: "pero" }, "QA130_DATABASE_GUARD");
    const rows = await tx.plugin.findMany({ where: { enabled: true }, select: { id: true }, orderBy: { id: "asc" } });
    const plugins = rows.map((row) => {
      const manifest = getManifest(row.id);
      return { id: row.id, registered: !!manifest, hasDomainEventHook: typeof manifest?.hooks?.onDomainEvent === "function" };
    });
    return { status: "READ_ONLY_PLUGIN_INSPECTION", runId, sourceHash: sourceHash(), readOnly: true, mutationStarted: false, enabledCount: plugins.length, plugins };
  });
}
export async function inspectTurnoverNativePlugins(approval: TurnoverNativeApproval) {
  assertApproval(approval, "plugin-inspection");
  assert.equal(process.env.CRM_LOCAL_CONTAINER_ID, containerId, "QA130_EXPECTED_CONTAINER_GUARD");
  const database = new PrismaClient({ datasourceUrl: existingLocalCrmDatabaseUrl() });
  try { return await runReadOnlyPluginInspection(database, approval); } finally { await database.$disconnect(); }
}export async function executeTurnoverNative(approval: TurnoverNativeApproval) {
  assertApproval(approval, "execute");  assert.equal(process.env.CRM_LOCAL_CONTAINER_ID, containerId, "QA130_EXPECTED_CONTAINER_GUARD");
  const url = existingLocalCrmDatabaseUrl(), db = new PrismaClient({ datasourceUrl: url }), second = new PrismaClient({ datasourceUrl: url });
  const beforeFetch = globalThis.fetch; let outbound = 0; globalThis.fetch = async () => { outbound += 1; throw new Error("QA130_OUTBOUND_FORBIDDEN"); };
  let mutationStarted = false;
  try {
    await guard(db, false);
    const before = await fingerprint(db), hash = sourceHash();
    durable("approval", approval); durable("manifest", { ...TURNOVER_NATIVE_MANIFEST, sourceHash: hash }); durable("baseline", before);
    const actor = { id: actorId, name: "QA130", roles: ["ACCOUNTANT" as const], source: "web" as const };
    mutationStarted = true;
    await db.$transaction(async (tx) => {
      await tx.user.createMany({ data: [{ id: actorId, email: actorId + "@invalid.local", name: "QA130 actor", passwordHash: "QA130_LOGIN_DISABLED", roles: ["ACCOUNTANT"], payScheme: "NONE" },
        { id: payeeId, email: payeeId + "@invalid.local", name: "QA130 payee", passwordHash: "QA130_LOGIN_DISABLED", roles: ["MANAGER"], payScheme: "PERCENT_TURNOVER", payPercent: "3" }] });
      await tx.cashAccount.create({ data: { id: cashId, name: prefix, currency: "BYN" } });
      await tx.payment.create({ data: { id: paymentIds[0], cashAccountId: cashId, amount: "10000", bynAmount: "10000", currency: "BYN", rate: 1, paidAt: new Date("2000-01-15T09:00:00Z"), comment: prefix } });
    });
    await guard(db, true);
    const pids = await Promise.all([db, second].map((client) => client.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`));
    assert.notEqual(pids[0][0].pid, pids[1][0].pid, "QA130_DISTINCT_CONNECTIONS_GUARD");
    const concurrent = await Promise.all(Array.from({ length: 10 }, (_, index) => accrueTurnoverCore(actor, month, ownedTransaction(index % 2 ? second : db, "concurrent-" + index))));
    assert.ok(concurrent.every((result) => result.ok)); assert.equal(concurrent.reduce((count, result) => count + (result.ok ? result.accruedCount : 0), 0), 1);
    let captured = await captureOwned(db); assert.equal(captured.entries.length, 1); assert.equal(captured.entries[0].amount, "300.00");
    const initialRow = JSON.stringify(captured.entries[0]); durable("initial-capture", captured);
    await db.payment.create({ data: { id: paymentIds[1], cashAccountId: cashId, amount: "2000", bynAmount: "2000", currency: "BYN", rate: 1, paidAt: new Date("2000-01-15T09:00:00Z"), comment: prefix } });
    assert.equal((await accrueTurnoverCore(actor, month, ownedTransaction(db, "topup"))).ok, true);
    captured = await captureOwned(db); assert.equal(captured.entries.length, 2); assert.equal(captured.entries.find((row) => row.id === idsFor("topup", payeeId).payroll)?.amount, "60.00");
    assert.ok(captured.entries.some((row) => JSON.stringify(row) === initialRow));
    const replay = await accrueTurnoverCore(actor, month, ownedTransaction(db, "replay")); assert.ok(replay.ok); assert.equal(replay.accruedCount, 0);
    await db.payment.update({ where: { id: paymentIds[1] }, data: { direction: "EXPENSE" } });
    const decline = await accrueTurnoverCore(actor, month, ownedTransaction(db, "decline")); assert.ok(decline.ok); assert.equal(decline.accruedCount, 0);
    await db.payment.update({ where: { id: paymentIds[1] }, data: { direction: "INCOME" } });
    await db.payment.create({ data: { id: paymentIds[2], cashAccountId: cashId, amount: "2000", bynAmount: "2000", currency: "BYN", rate: 1, paidAt: new Date("2000-01-15T09:00:00Z"), comment: prefix } });
    await db.user.create({ data: { id: secondaryId, email: secondaryId + "@invalid.local", name: "QA130 second", passwordHash: "QA130_LOGIN_DISABLED", roles: ["MANAGER"], payScheme: "PERCENT_TURNOVER", payPercent: "3" } });
    for (const step of ["payroll", "audit", "outbox"] as const) {
      const preFault = await fingerprint(db);
      await assert.rejects(accrueTurnoverCore(actor, month, ownedTransaction(db, "fault-" + step, step)), /QA130_FAULT_/);
      assert.deepEqual(await fingerprint(db), preFault, "QA130_FAULT_PARTIAL_WRITE:" + step);
    }
    assert.deepEqual(await captureOwned(db), captured, "QA130_ORIGINAL_ACCRUAL_CHANGED");
    durable("final-capture", { ...captured, sourceHash: hash, outbound, connectionCount: 2, faults: 3 });
    assert.equal(sourceHash(), hash, "QA130_SOURCE_DRIFT_STOP"); assert.equal(outbound, 0, "QA130_OUTBOUND_STOP");
    assert.deepEqual(await fingerprint(db, true), before, "QA130_PRE_CLEANUP_ORIGINAL_DRIFT_STOP");
    // Exact reviewed IDs only. Any failed scenario above stops before cleanup.
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435, 55001)`;
      assert.deepEqual(await fingerprint(tx, true), before, "QA130_CLEANUP_ORIGINAL_DRIFT_STOP");
      assert.equal(await tx.payrollEntry.count({ where: { userId: { in: [payeeId, secondaryId] }, id: { notIn: TURNOVER_NATIVE_MANIFEST.ids.PayrollEntry } } }), 0, "QA130_UNATTRIBUTED_PAYROLL_STOP");
      assert.equal(await tx.changeLog.count({ where: { actorId, id: { notIn: TURNOVER_NATIVE_MANIFEST.ids.ChangeLog } } }), 0, "QA130_UNATTRIBUTED_AUDIT_STOP");
      assert.equal(await tx.domainEvent.count({ where: { actor: actorId, id: { notIn: TURNOVER_NATIVE_MANIFEST.ids.DomainEvent } } }), 0, "QA130_UNATTRIBUTED_EVENT_STOP");
      await tx.payrollEntry.deleteMany({ where: { id: { in: TURNOVER_NATIVE_MANIFEST.ids.PayrollEntry }, userId: { in: [payeeId, secondaryId] }, scheme: "PERCENT_TURNOVER", month } });
      await tx.changeLog.deleteMany({ where: { id: { in: TURNOVER_NATIVE_MANIFEST.ids.ChangeLog }, actorId, entity: "payrollEntry" } });
      await tx.domainEvent.deleteMany({ where: { id: { in: TURNOVER_NATIVE_MANIFEST.ids.DomainEvent }, actor: actorId, type: "payroll.accrued" } });
      await tx.payment.deleteMany({ where: { id: { in: paymentIds }, cashAccountId: cashId, comment: prefix } });
      await tx.cashAccount.deleteMany({ where: { id: cashId, name: prefix, currency: "BYN" } });
      await tx.user.deleteMany({ where: { id: { in: [actorId, payeeId, secondaryId] }, email: { in: [actorId, payeeId, secondaryId].map((id) => id + "@invalid.local") } } });
    });
    assert.deepEqual(await fingerprint(db), before, "QA130_POST_CLEANUP_ORIGINAL_DRIFT_STOP");
    durable("cleanup-proof", { originalsUnchanged: true, sourceHash: hash, persistentFixtureRows: 0 });
    return { status: "NATIVE_PASS", runId, commands: 10, connectionCount: 2, initial: "300.00", topup: "60.00", faults: 3, protectedFingerprintsUnchanged: true, persistentFixtureRows: 0 };
  } catch (error) {
    durable("stop", { status: "STOP", mutationStarted, code: safeNativeFailureCode(error), stage: mutationStarted ? "execute" : "pre-setup", cleanupRequiresRootReview: mutationStarted });
    throw error;
  } finally { globalThis.fetch = beforeFetch; await Promise.all([db.$disconnect(), second.$disconnect()]); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [mode, approvalPath] = process.argv.slice(2);
  if (!["--execute-reviewed-local", "--diagnose-reviewed-local", "--inspect-plugins-reviewed-local"].includes(mode) || !approvalPath) console.log(JSON.stringify({ status: "DRY_RUN", connectionOpened: false, manifest: TURNOVER_NATIVE_MANIFEST, sourceHash: sourceHash() }));
  else {
    const approval = JSON.parse(readFileSync(resolve(approvalPath), "utf8")) as TurnoverNativeApproval;
    const operation = mode === "--diagnose-reviewed-local" ? diagnoseTurnoverNative(approval) : mode === "--inspect-plugins-reviewed-local" ? inspectTurnoverNativePlugins(approval) : executeTurnoverNative(approval);
    operation.then((result) => console.log(JSON.stringify(result))).catch((error: unknown) => { console.error(JSON.stringify({ status: "STOP", code: safeNativeFailureCode(error), runId, outputDir: TURNOVER_NATIVE_MANIFEST.outputDir, cleanupRequiresRootReview: mode === "--execute-reviewed-local" })); process.exitCode = 1; });
  }
}
