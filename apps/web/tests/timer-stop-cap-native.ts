// SAFETY D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP on guard mismatch.
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire, Module } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { mock } from "node:test";
import { pathToFileURL } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";
import { existingLocalCrmDatabaseUrl } from "./helpers/local-crm-database";
import { nativeOwnedIds, nativeSnapshot } from "./helpers/native-acceptance-snapshot";
import type { DomainActor } from "../src/server/actor";

const require = createRequire(import.meta.url);
const runId = "9704db7f-d2e2-47c1-b1fb-aba2043ed65d", prefix = "qa132-" + runId;
const containerId = "bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5";
const revision = "cd38cb745759becd58dbbad4d6d37afa03f0ab7a";
const instant = new Date("2026-10-11T12:00:00Z");
const owner = { worker: prefix + "-worker", capworker: prefix + "-capworker", manager: prefix + "-manager", recipient: prefix + "-recipient",
  client: prefix + "-client", project: prefix + "-project", product: prefix + "-product", work: prefix + "-work" };
const elapsedValues = [719, 720, 721, 1200] as const;
const paths = ["stop", "switch", "read", "complete", "reassign"] as const;
const matrix = paths.flatMap(route => elapsedValues.map(elapsed => ({ phase: `matrix-${route}-${elapsed}`, route, elapsed })));
const mainPhases = [...Array.from({ length: 10 }, (_, i) => "same-" + i), ...Array.from({ length: 10 }, (_, i) => "switch-" + i),
  "stop-first", "stop-second", "read-main", "timeout-read", "timeout-stop", "complete-first", "complete-second", "start-while-completing", "audit-fault", "post-fault-stop", "legacy-cas"];
const phases = [...mainPhases, ...matrix.map(row => row.phase)];
const id = (phase: string, kind: string) => { assert.ok(phases.includes(phase), "QA132_PHASE_STOP"); return prefix + "-" + phase + "-" + kind; };
const taskIds = [prefix + "-task-a", prefix + "-task-b", prefix + "-task-c", prefix + "-task-cas", prefix + "-task-fault",
  prefix + "-task-cap-switch", ...matrix.map(row => id(row.phase, "task"))];
const historyIds = [prefix + "-closed-zero", prefix + "-closed-1200", prefix + "-manual-1200"];
const setupTimes = [prefix + "-completion-timer", prefix + "-fault-timer", prefix + "-cas-timer", prefix + "-timeout-race", ...matrix.map(row => id(row.phase, "fixture-timer"))];
export const TIMER_NATIVE_MANIFEST = {
  format: "pero-timer132/v1", runId, prefix, containerId, revision, host: "127.0.0.1", port: 5433, database: "pero_crm", username: "pero",
  instant: instant.toISOString(), projectNumber: "2000013200",
  ids: { User: [owner.worker, owner.capworker, owner.manager, owner.recipient], Client: [owner.client], Project: [owner.project], Product: [owner.product],
    Work: [owner.work], Task: taskIds, TimeEntry: [...historyIds, ...setupTimes, ...phases.map(phase => id(phase, "timer"))],
    PayrollEntry: phases.map(phase => id(phase, "payroll")), DomainEvent: phases.map(phase => id(phase, "event")),
    ChangeLog: phases.flatMap(phase => [id(phase, "audit-0"), id(phase, "audit-1")]) },
  matrix, expected: { clients: 2, sameStarts: 10, mixedSwitches: 10, cap: 720, manualHistory: 1200, closedHistory: [0, 1200], completionByn: "100.00" },
  outputDir: join(tmpdir(), "pero-crm-qa132", runId),
};
type Database = PrismaClient | Prisma.TransactionClient;
type Pins = { file: string; sha256: string }[];
type Compiler = { build(options: Record<string, unknown>): Promise<{ metafile: { inputs: Record<string, unknown> } }> };
export async function timerNativePins(): Promise<Pins> {
  const compiler = createRequire(require.resolve("tsx/package.json"))("esbuild") as Compiler;
  const closure = await compiler.build({ stdin: { contents: ["time/actions", "time/timers", "tasks/actions", "tasks/completion-core", "tasks/transaction", "plugins/registry"]
    .map(file => `import ${JSON.stringify("./src/server/" + file + ".ts")};`).join("\n"), sourcefile: "qa132-closure.ts", resolveDir: process.cwd(), loader: "ts" },
    bundle: true, write: false, metafile: true, packages: "external", platform: "node", format: "cjs", tsconfig: resolve("tsconfig.json"), logLevel: "silent" });
  const files = Object.keys(closure.metafile.inputs).filter(file => file !== "<stdin>" && file !== "qa132-closure.ts");
  files.push("tests/timer-stop-cap-native.ts", "tests/timer-stop-cap.test.ts", "tests/helpers/local-crm-database.ts", "tests/helpers/native-acceptance-snapshot.ts", "prisma/schema.prisma", "package.json", "tsconfig.json",
    "../../pnpm-lock.yaml", "../../package.json", "../../pnpm-workspace.yaml", "../../packages/plugins/demo/src/plugin.ts", "../../packages/plugins/demo/package.json",
    "../../packages/plugin-sdk/src/index.ts", "../../packages/plugin-sdk/package.json");
  const clientRequire = createRequire(require.resolve("@prisma/client"));
  files.push(relative(process.cwd(), clientRequire.resolve("@prisma/client/runtime/library.js")), relative(process.cwd(), clientRequire.resolve(".prisma/client/schema.prisma")));
  return [...new Set(files)].sort().map(file => { assert.ok(!file.startsWith("<") && !file.includes("\0"), "QA132_SOURCE_STOP");
    return { file: file.replaceAll("\\", "/"), sha256: createHash("sha256").update(readFileSync(resolve(file))).digest("hex") }; });
}
export const timerNativeHash = (pins: Pins) => createHash("sha256").update(JSON.stringify(pins)).digest("hex");
export type TimerNativeApproval = { source: "root-reviewed"; operation: "execute"; runId: string; sourceHash: string; containerId: string;
  exclusiveLocalWindow: true; localOutboxInactive: true; observationEvidence: string };
export function assertTimerNativeApproval(approval: TimerNativeApproval, hash: string) {
  assert.equal(approval.source, "root-reviewed", "QA132_APPROVAL_STOP"); assert.equal(approval.operation, "execute", "QA132_APPROVAL_STOP");
  assert.equal(approval.runId, runId, "QA132_RUN_STOP"); assert.equal(approval.sourceHash, hash, "QA132_SOURCE_STOP"); assert.equal(approval.containerId, containerId, "QA132_TARGET_STOP");
  assert.equal(approval.exclusiveLocalWindow, true, "QA132_LEASE_STOP"); assert.equal(approval.localOutboxInactive, true, "QA132_RUNTIME_STOP");
  assert.ok(typeof approval.observationEvidence === "string" && approval.observationEvidence.length > 10 && approval.observationEvidence.length < 2000, "QA132_OBSERVATION_STOP");
}
export type TimerNativeLockRow = { pid: number; locktype: string; database: number; classid: number; objid: number; objsubid: number; mode: string; granted: boolean };
export function timerNativeLockWitness(rows: TimerNativeLockRow[], holderPid: number, waiterPid: number) {
  assert.ok(Number.isSafeInteger(holderPid) && holderPid > 0 && Number.isSafeInteger(waiterPid) && waiterPid > 0 && holderPid !== waiterPid, "QA132_CONNECTION_STOP");
  if (rows.length !== 2) return undefined;
  const matching = rows.every(row => row.locktype === "advisory" && row.classid === 18435 && row.objid === 55001 && row.objsubid === 2 && row.mode === "ExclusiveLock" && Number.isSafeInteger(row.database) && row.database > 0);
  const holder = rows.find(row => row.pid === holderPid && row.granted === true), waiter = rows.find(row => row.pid === waiterPid && row.granted === false);
  return matching && holder && waiter && holder.database === waiter.database ? { holder, waiter } : undefined;
}
export async function timerNativeBounded<T>(operation: Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - performance.now(); assert.ok(Number.isFinite(remaining) && remaining > 0, "QA132_LOCK_BARRIER_TIMEOUT");
  let handle: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
    handle = setTimeout(() => reject(Error("QA132_LOCK_BARRIER_TIMEOUT")), remaining);
  })]); } finally { if (handle) clearTimeout(handle); }
}
export function timerNativeFailureCode(error: unknown) {
  const known = new Set(["QA132_APPROVAL_STOP", "QA132_RUN_STOP", "QA132_SOURCE_STOP", "QA132_TARGET_STOP", "QA132_LEASE_STOP", "QA132_RUNTIME_STOP", "QA132_OBSERVATION_STOP",
    "QA132_IDENTITY_STOP", "QA132_PLUGIN_STOP", "QA132_FRESH_STOP", "QA132_LOGICAL_REFERENCE_STOP", "QA132_WRITE_STOP", "QA132_FOREIGN_REFERENCE_STOP", "QA132_ORIGINAL_STOP", "QA132_CONNECTION_STOP", "QA132_LOCK_WITNESS_STOP", "QA132_LOCK_BARRIER_TIMEOUT"]);
  const code = error instanceof Error ? error.message.match(/^(QA132_[A-Z_]+)/)?.[1] : undefined;
  return code && known.has(code) ? code : "QA132_SCENARIO_STOP";
}
function durable(name: string, value: unknown) {
  const directory = resolve(TIMER_NATIVE_MANIFEST.outputDir); let current = directory;
  while (dirname(current) !== current) { try { assert.equal(lstatSync(current).isSymbolicLink(), false, "QA132_REPARSE_STOP"); }
    catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; } current = dirname(current); }
  mkdirSync(directory, { recursive: true }); const file = join(directory, name + ".json"), bytes = Buffer.from(JSON.stringify(value) + "\n");
  const handle = openSync(file, "wx", 0o600); try { writeFileSync(handle, bytes); fsyncSync(handle); } finally { closeSync(handle); }
  assert.deepEqual(readFileSync(file), bytes, "QA132_DURABLE_STOP");
}
function sqlName(name: string) { assert.match(name, /^[A-Za-z_][A-Za-z0-9_]{0,62}$/, "QA132_SQL_NAME_STOP"); return '"' + name + '"'; }
const ownedIds = (table: string) => (TIMER_NATIVE_MANIFEST.ids as Record<string, string[]>)[table] ?? [];
const fingerprint = (db: Database, excludeOwned = false) =>
  nativeSnapshot(db, excludeOwned ? nativeOwnedIds(TIMER_NATIVE_MANIFEST.ids) : {});
async function captureOwned(db: Database) {
  const result: Record<string, unknown> = {};
  for (const [table, ids] of Object.entries(TIMER_NATIVE_MANIFEST.ids))
    result[table] = await db.$queryRawUnsafe(`SELECT row_to_json(t) AS row FROM ${sqlName(table)} t WHERE id = ANY($1::text[]) ORDER BY id`, ids);
  return result;
}
async function foreignReferenceGuard(db: Database) {
  const relations = await db.$queryRaw<{ child: string; parent: string; child_columns: string[]; parent_columns: string[] }[]>`
    SELECT child.relname::text AS child,parent.relname::text AS parent,array_agg(ca.attname::text ORDER BY k.ord) AS child_columns,array_agg(pa.attname::text ORDER BY k.ord) AS parent_columns
    FROM pg_constraint c JOIN pg_class child ON child.oid=c.conrelid JOIN pg_class parent ON parent.oid=c.confrelid JOIN pg_namespace n ON n.oid=child.relnamespace
    JOIN LATERAL unnest(c.conkey,c.confkey) WITH ORDINALITY AS k(child_att,parent_att,ord) ON true
    JOIN pg_attribute ca ON ca.attrelid=child.oid AND ca.attnum=k.child_att JOIN pg_attribute pa ON pa.attrelid=parent.oid AND pa.attnum=k.parent_att
    WHERE c.contype='f' AND n.nspname='public' GROUP BY c.oid,child.relname,parent.relname ORDER BY child.relname,parent.relname,c.oid`;
  for (const relation of relations) { const parent = ownedIds(relation.parent); if (!parent.length) continue; const child = ownedIds(relation.child);
    const matches = relation.child_columns.map((column, i) => `child.${sqlName(column)}=parent.${sqlName(relation.parent_columns[i])}`).join(" AND ");
    const [count] = await db.$queryRawUnsafe<{ count: string }[]>(`SELECT count(*)::text AS count FROM ${sqlName(relation.child)} child JOIN ${sqlName(relation.parent)} parent ON ${matches} WHERE parent.id = ANY($1::text[])${child.length ? " AND child.id <> ALL($2::text[])" : ""}`, parent, ...child.length ? [child] : []);
    assert.equal(count.count, "0", "QA132_FOREIGN_REFERENCE_STOP");
  }
}
async function logicalReferenceGuard(db: Database) {
  // TimeEntry.userId/actor snapshots не являются FK: не трогаем даже случайную чужую scalar-ссылку.
  assert.equal(await db.timeEntry.count({ where: { userId: { in: TIMER_NATIVE_MANIFEST.ids.User }, id: { notIn: TIMER_NATIVE_MANIFEST.ids.TimeEntry } } }), 0, "QA132_LOGICAL_REFERENCE_STOP");
  assert.equal(await db.changeLog.count({ where: { actorId: { in: TIMER_NATIVE_MANIFEST.ids.User }, id: { notIn: TIMER_NATIVE_MANIFEST.ids.ChangeLog } } }), 0, "QA132_LOGICAL_REFERENCE_STOP");
  assert.equal(await db.domainEvent.count({ where: { actor: { in: TIMER_NATIVE_MANIFEST.ids.User }, id: { notIn: TIMER_NATIVE_MANIFEST.ids.DomainEvent } } }), 0, "QA132_LOGICAL_REFERENCE_STOP");
}
async function guards(db: Database) {
  const [identity] = await db.$queryRaw<{ database: string; username: string; schema: string; primary: boolean }[]>`SELECT current_database() AS database,current_user AS username,current_schema() AS schema,NOT pg_is_in_recovery() AS primary`;
  assert.deepEqual(identity, { database: "pero_crm", username: "pero", schema: "public", primary: true }, "QA132_IDENTITY_STOP");
  const plugins = await db.plugin.findMany({ where: { enabled: true }, select: { id: true }, orderBy: { id: "asc" } });
  const { getManifest } = require("../src/server/plugins/registry") as typeof import("../src/server/plugins/registry");
  assert.deepEqual(plugins.map(row => row.id), ["file-stages"], "QA132_PLUGIN_STOP"); const plugin = getManifest("file-stages");
  assert.equal(Boolean(plugin), false, "QA132_PLUGIN_STOP"); assert.equal(typeof plugin?.hooks?.onDomainEvent === "function", false, "QA132_PLUGIN_STOP");
  assert.ok((await db.orgSetting.findUnique({ where: { key: "payrollCurrency" } }))?.value === "BYN" || await db.orgSetting.count({ where: { key: "payrollCurrency" } }) === 0, "QA132_CURRENCY_STOP");
  for (const [table, ids] of Object.entries(TIMER_NATIVE_MANIFEST.ids)) { const [count] = await db.$queryRawUnsafe<{ count: string }[]>(`SELECT count(*)::text AS count FROM ${sqlName(table)} WHERE id = ANY($1::text[])`, ids);
    assert.equal(count.count, "0", "QA132_FRESH_STOP"); }
  assert.equal(await db.project.count({ where: { number: TIMER_NATIVE_MANIFEST.projectNumber } }), 0, "QA132_FRESH_STOP");
  assert.equal(await db.product.count({ where: { number: TIMER_NATIVE_MANIFEST.projectNumber + ".1" } }), 0, "QA132_FRESH_STOP"); await logicalReferenceGuard(db);
}
type Command = { phase: string; client: PrismaClient; actor: DomainActor; taskId: string; auditCount: number; transactionCalls: number; partialAuditFault: boolean; legacyRace: boolean; raceTriggered: boolean;
  onLockAcquired?: (tx: Prisma.TransactionClient) => void | Promise<void>; onLockRequested?: () => void };
const commands = new AsyncLocalStorage<Command>();
const writeMethods = new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "upsert", "delete", "deleteMany"]);
function ownedTransaction(tx: Prisma.TransactionClient, command: Command, second: PrismaClient, isHalted: () => boolean) {
  return new Proxy(tx, { get(db, table: string | symbol) {
    if (table === "$executeRaw" || table === "$executeRawUnsafe" || table === "$queryRawUnsafe") return () => { assert.fail("QA132_WRITE_STOP"); };
    if (table === "$queryRaw") return async (strings: TemplateStringsArray, ...values: unknown[]) => {
      assert.equal(strings.join("?").trim(), "SELECT 1 AS locked FROM pg_advisory_xact_lock(18435, 55001)", "QA132_WRITE_STOP"); assert.equal(values.length, 0);
      command.onLockRequested?.(); const result = await db.$queryRaw(strings, ...values);
      assert.equal(isHalted(), false, "QA132_ABORT_STOP"); await command.onLockAcquired?.(tx); assert.equal(isHalted(), false, "QA132_ABORT_STOP"); return result;
    };
    if (typeof table !== "string" || table.startsWith("$")) return Reflect.get(db, table);
    const delegate = Reflect.get(db, table) as Record<string | symbol, unknown>; if (!delegate || typeof delegate !== "object") return delegate;
    return new Proxy(delegate, { get(model, method: string | symbol) { const actual = Reflect.get(model, method); if (typeof actual !== "function") return actual;
      return async (args: Record<string, unknown>) => {
        if (!writeMethods.has(String(method))) {
          const rows = await Reflect.apply(actual, model, [args]);
          if (table === "timeEntry" && method === "findMany" && command.legacyRace && !command.raceTriggered) {
            assert.ok(Array.isArray(rows) && rows.some(row => row.id === prefix + "-cas-timer"), "QA132_CAS_LOOKUP_STOP");
            assert.equal(isHalted(), false, "QA132_ABORT_STOP");
            // Owned-only legacy writer injection после реального SELECT, до actual helper CAS.
            const changed = await second.timeEntry.updateMany({ where: { id: prefix + "-cas-timer", userId: owner.worker, taskId: taskIds[3], source: "timer", stoppedAt: null },
              data: { minutes: 720, autoStopped: true, stoppedAt: new Date(instant.getTime() - 480 * 60000) } });
            assert.equal(changed.count, 1); command.raceTriggered = true;
          }
          return rows;
        }
        assert.equal(isHalted(), false, "QA132_ABORT_STOP");
        const data = args.data as Record<string, unknown>, where = args.where as Record<string, unknown> | undefined; let assigned: string | undefined;
        if (table === "timeEntry" && method === "create") {
          assert.ok(TIMER_NATIVE_MANIFEST.ids.Task.includes(String(data.taskId)), "QA132_WRITE_STOP"); assert.ok(TIMER_NATIVE_MANIFEST.ids.User.includes(String(data.userId)), "QA132_WRITE_STOP");
          assert.equal(data.source, "timer", "QA132_WRITE_STOP"); assert.equal((data.startedAt as Date).getTime(), instant.getTime(), "QA132_WRITE_STOP"); assigned = id(command.phase, "timer");
        } else if (table === "timeEntry" && method === "updateMany") {
          assert.ok(typeof where?.id === "string" && TIMER_NATIVE_MANIFEST.ids.TimeEntry.includes(where.id) && !historyIds.includes(where.id), "QA132_WRITE_STOP");
          assert.equal(where.stoppedAt, null, "QA132_WRITE_STOP"); assert.equal(where.source, "timer", "QA132_WRITE_STOP");
          assert.ok(Number.isInteger(data.minutes) && Number(data.minutes) >= 1 && Number(data.minutes) <= 720, "QA132_WRITE_STOP");
          assert.equal(typeof data.autoStopped, "boolean", "QA132_WRITE_STOP"); assert.ok(Number.isFinite((data.stoppedAt as Date).getTime()), "QA132_WRITE_STOP");
        } else if (table === "task" && method === "update") {
          assert.equal(where?.id, command.taskId, "QA132_WRITE_STOP"); if (data.assigneeId) assert.ok(TIMER_NATIVE_MANIFEST.ids.User.includes(String(data.assigneeId)), "QA132_WRITE_STOP");
        } else if (table === "changeLog" && method === "create") {
          assert.equal(data.actorId, command.actor.id, "QA132_WRITE_STOP"); assert.equal(data.entity, "task", "QA132_WRITE_STOP"); assert.equal(data.entityId, command.taskId, "QA132_WRITE_STOP");
          assert.ok(["status", "update"].includes(String(data.action)), "QA132_WRITE_STOP");
          if (command.partialAuditFault && data.action === "update") {
            assert.equal(await tx.task.count({ where: { id: command.taskId, assigneeId: owner.recipient } }), 1, "QA132_PARTIAL_TASK_STOP");
            assert.equal(await tx.timeEntry.count({ where: { id: prefix + "-fault-timer", stoppedAt: { not: null }, minutes: 720, autoStopped: true } }), 1, "QA132_PARTIAL_TIME_STOP");
            command.auditCount++; throw Error("QA132_INJECTED_AUDIT");
          }
          assert.ok(command.auditCount < 2, "QA132_WRITE_STOP"); assigned = id(command.phase, "audit-" + command.auditCount++);
        } else if (table === "domainEvent" && method === "create") {
          assert.equal(data.actor, command.actor.id, "QA132_WRITE_STOP"); assert.equal(data.type, "task.statusChanged", "QA132_WRITE_STOP"); assigned = id(command.phase, "event");
        } else if (table === "payrollEntry" && method === "create") {
          assert.equal(data.userId, owner.worker, "QA132_WRITE_STOP"); assert.equal(data.taskId, command.taskId, "QA132_WRITE_STOP"); assert.equal(data.projectId, owner.project, "QA132_WRITE_STOP"); assert.equal(data.workId, owner.work, "QA132_WRITE_STOP");
          assert.equal(data.scheme, "PIECE"); assert.equal(data.currency, "BYN"); assert.equal(new Prisma.Decimal(data.amount as Prisma.Decimal.Value).toFixed(2), "100.00");
          assert.equal(new Prisma.Decimal(data.bynAmount as Prisma.Decimal.Value).toFixed(2), "100.00"); assigned = id(command.phase, "payroll");
        } else assert.fail("QA132_WRITE_STOP");
        if (assigned) assert.ok(ownedIds(table[0].toUpperCase() + table.slice(1)).includes(assigned), "QA132_WRITE_STOP");
        return Reflect.apply(actual, model, [{ ...args, data: assigned ? { ...data, id: assigned } : data }]);
      };
    } });
  } }) as Prisma.TransactionClient;
}

export async function executeTimerNative(approval: TimerNativeApproval) {
  const pins = await timerNativePins(), hash = timerNativeHash(pins); assertTimerNativeApproval(approval, hash);
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim(), revision, "QA132_SOURCE_STOP");
  assert.equal(execFileSync("git", ["branch", "--show-current"], { encoding: "utf8", windowsHide: true }).trim(), "bugfix/132", "QA132_SOURCE_STOP");
  assert.equal(process.env.CRM_LOCAL_CONTAINER_ID, containerId, "QA132_TARGET_STOP"); assert.equal(process.env.CRM_EVENT_DISPATCHER_ENABLED, undefined, "QA132_RUNTIME_STOP");
  durable("manifest", { ...TIMER_NATIVE_MANIFEST, pins, sourceHash: hash, approval });
  const url = new URL(existingLocalCrmDatabaseUrl()); url.searchParams.set("connection_limit", "1");
  const first = new PrismaClient({ datasourceUrl: url.toString() }), second = new PrismaClient({ datasourceUrl: url.toString() });
  const originals = new Map<string, NodeJS.Module | undefined>(), originalFetch = globalThis.fetch;
  const http = require("node:http") as typeof import("node:http"), https = require("node:https") as typeof import("node:https");
  const networking = { httpRequest: http.request, httpGet: http.get, httpsRequest: https.request, httpsGet: https.get };
  let mutationStarted = false, clockEnabled = false, outbound = 0, halted = false, before: Awaited<ReturnType<typeof fingerprint>> | undefined;
  const pending = new Set<Promise<unknown>>();
  const connectionTrace: { phase: string; pid: number }[] = [];
  let overlapWitness: ReturnType<typeof timerNativeLockWitness>;
  const deny = () => { outbound++; throw Error("QA132_OUTBOUND_STOP"); };
  globalThis.fetch = async () => deny(); http.request = deny; http.get = deny; https.request = deny; https.get = deny;
  const inject = (name: string, exports: Record<string, unknown>) => { const file = require.resolve(name); originals.set(file, require.cache[file]); const stub = new Module(file);
    stub.filename = file; stub.loaded = true; stub.exports = exports; require.cache[file] = stub; };
  const facade = new Proxy(first, { get(db, key) {
    if (key === "$transaction") return async <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>, options: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel }) => {
      const command = commands.getStore(); assert.ok(command, "QA132_CONTEXT_STOP"); command.transactionCalls++;
      assert.equal(halted, false, "QA132_ABORT_STOP");
      return command.client.$transaction(async tx => { const [connection] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        connectionTrace.push({ phase: command.phase, pid: connection.pid }); const value = await operation(ownedTransaction(tx, command, second, () => halted));
        assert.equal(halted, false, "QA132_ABORT_STOP"); return value; }, options);
    }; return Reflect.get(db, key);
  } });
  const actor = (key: "worker" | "capworker" | "manager"): DomainActor => ({ id: owner[key], name: prefix + "-" + key, roles: [key === "manager" ? "MANAGER" : "WORKER"], source: "web" });
  const run = <T>(phase: string, client: PrismaClient, person: DomainActor, task: string, operation: () => Promise<T>, flags: Partial<Pick<Command, "partialAuditFault" | "legacyRace" | "onLockAcquired" | "onLockRequested">> = {}) => {
    assert.ok(phases.includes(phase), "QA132_PHASE_STOP"); const command: Command = { phase, client, actor: person, taskId: task, auditCount: 0, transactionCalls: 0,
      partialAuditFault: false, legacyRace: false, raceTriggered: false, ...flags };
    const tracked = commands.run(command, async () => ({ result: await operation(), command })).finally(() => { pending.delete(tracked); });
    pending.add(tracked); return tracked;
  };
  try {
    await first.$connect(); await second.$connect();
    const [one] = await first.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`, [two] = await second.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    assert.notEqual(one.pid, two.pid, "QA132_CONNECTION_STOP");
    await first.$transaction(async tx => { await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY"); await guards(tx); });
    before = await fingerprint(first); durable("before", { fingerprint: before, sourceHash: hash, backendPids: [one.pid, two.pid] });
    assert.equal(timerNativeHash(await timerNativePins()), hash, "QA132_SOURCE_STOP"); mutationStarted = true;
    await first.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435, 55001)`;
      for (const key of ["worker", "capworker", "manager", "recipient"] as const)
        await tx.user.create({ data: { id: owner[key], email: owner[key] + "@invalid.local", name: prefix + "-" + key, passwordHash: "QA132_LOGIN_DISABLED",
          roles: [key === "manager" ? "MANAGER" : "WORKER"], payScheme: key === "worker" ? "PIECE" : "NONE" } });
      await tx.client.create({ data: { id: owner.client, name: prefix, phone: "QA132_NO_PHONE" } });
      await tx.project.create({ data: { id: owner.project, number: TIMER_NATIVE_MANIFEST.projectNumber, numberInt: 2000013200, title: prefix, clientId: owner.client, managerId: owner.manager, currency: "BYN", createdById: owner.manager } });
      await tx.product.create({ data: { id: owner.product, projectId: owner.project, number: TIMER_NATIVE_MANIFEST.projectNumber + ".1", suffixInt: 1, title: prefix, status: "PRODUCTION", createdById: owner.manager } });
      await tx.work.create({ data: { id: owner.work, projectId: owner.project, productId: owner.product, title: prefix, quantity: 64, priceSnapshot: 100, total: 6400, paymentKind: "LEGACY", createdById: owner.manager } });
      for (const task of taskIds) await tx.task.create({ data: { id: task, projectId: owner.project, productId: owner.product, workId: owner.work, title: prefix, quantity: 1,
        assigneeId: task.includes("-matrix-") || task === taskIds[5] ? owner.capworker : owner.worker,
        status: task === taskIds[4] || task.includes("-matrix-reassign-") ? "IN_PROGRESS" : "NEW", createdById: owner.manager } });
      for (const [index, minutes] of [0, 1200, 1200].entries()) await tx.timeEntry.create({ data: { id: historyIds[index], taskId: taskIds[0], userId: owner.worker,
        source: index === 2 ? "manual" : "timer", startedAt: new Date("2000-01-01T00:00:00Z"), stoppedAt: new Date(index === 2 ? "2000-01-01T00:00:00Z" : "2000-01-01T20:00:00Z"), minutes } });
    });
    const history = await first.timeEntry.findMany({ where: { id: { in: historyIds } }, orderBy: { id: "asc" } });
    inject("../src/lib/prisma", { prisma: facade }); inject("../src/auth", { auth: async () => { const context = commands.getStore(); assert.ok(context, "QA132_CONTEXT_STOP"); return { user: context.actor }; } });
    // Только delivery IO. Auth — declared owned actor context; настоящий sign-in/HTTP здесь не заявляются.
    inject("next/cache", { revalidatePath: () => {} }); inject("../src/server/plugins/events", { emitDomainEvent: async () => {}, dispatchEvent: async () => {} });
    inject("../src/server/notifications/notify", { notifyOrg: async () => {}, notifyPerson: async () => {} });
    inject("../src/server/products/revalidate", { revalidateProductPaths: async () => {} });
    const time = require("../src/server/time/actions") as typeof import("../src/server/time/actions");
    const task = require("../src/server/tasks/actions") as typeof import("../src/server/tasks/actions");
    const { changeTaskStatusCore } = require("../src/server/tasks/completion-core") as typeof import("../src/server/tasks/completion-core");
    const { createTaskTransaction } = require("../src/server/tasks/transaction") as typeof import("../src/server/tasks/transaction");
    const transaction = createTaskTransaction(facade);
    mock.timers.enable({ apis: ["Date"], now: instant.getTime() }); clockEnabled = true;
    const starts = await Promise.all(Array.from({ length: 10 }, (_, i) => run("same-" + i, i % 2 ? second : first, actor("worker"), taskIds[0], () => time.startTimer(taskIds[0]))));
    assert.ok(starts.every(row => row.result.ok));
    const active = await first.timeEntry.findMany({ where: { userId: owner.worker, stoppedAt: null } }); assert.equal(active.length, 1); const firstTimer = active[0];
    const startedIds = mainPhases.filter(phase => phase.startsWith("same-")).map(phase => id(phase, "timer"));
    assert.equal(await first.timeEntry.count({ where: { id: { in: startedIds }, userId: owner.worker } }), 1, "QA132_SAME_START_NOT_IDEMPOTENT");
    assert.equal(firstTimer.startedAt.getTime(), instant.getTime());
    const switches = await Promise.all(Array.from({ length: 10 }, (_, i) => run("switch-" + i, i % 2 ? second : first, actor("worker"), taskIds[i % 2], () => time.startTimer(taskIds[i % 2]))));
    assert.ok(switches.every(row => row.result.ok)); assert.equal(await first.timeEntry.count({ where: { userId: owner.worker, stoppedAt: null } }), 1);
    assert.equal((await first.timeEntry.findUniqueOrThrow({ where: { id: firstTimer.id } })).minutes, 1);
    const closedBeforeStops = await first.timeEntry.findMany({ where: { userId: owner.worker, stoppedAt: { not: null } }, orderBy: { id: "asc" } });
    await Promise.all([run("stop-first", first, actor("worker"), taskIds[0], () => time.stopTimer()), run("stop-second", second, actor("worker"), taskIds[0], () => time.stopTimer()),
      run("read-main", second, actor("worker"), taskIds[0], () => time.getActiveTimer())]);
    assert.equal(await first.timeEntry.count({ where: { userId: owner.worker, stoppedAt: null } }), 0);
    assert.deepEqual(await first.timeEntry.findMany({ where: { id: { in: closedBeforeStops.map(row => row.id) } }, orderBy: { id: "asc" } }), closedBeforeStops);
    await first.timeEntry.create({ data: { id: prefix + "-timeout-race", userId: owner.worker, taskId: taskIds[0], source: "timer", startedAt: new Date(instant.getTime() - 1200 * 60000) } });
    await Promise.all([run("timeout-read", first, actor("worker"), taskIds[0], () => time.getActiveTimer()), run("timeout-stop", second, actor("worker"), taskIds[0], () => time.stopTimer())]);
    const timeout = await first.timeEntry.findUniqueOrThrow({ where: { id: prefix + "-timeout-race" } });
    assert.equal(timeout.minutes, 720); assert.equal(timeout.autoStopped, true); assert.equal(timeout.stoppedAt?.getTime(), instant.getTime() - 480 * 60000);
    for (const entry of matrix) {
      assert.equal(await first.timeEntry.count({ where: { userId: owner.capworker, stoppedAt: null } }), 0);
      const fixtureId = id(entry.phase, "fixture-timer"), nativeTask = id(entry.phase, "task"), start = new Date(instant.getTime() - entry.elapsed * 60000);
      await first.timeEntry.create({ data: { id: fixtureId, userId: owner.capworker, taskId: nativeTask, source: "timer", startedAt: start } });
      const person = actor(entry.route === "reassign" ? "manager" : "capworker");
      const observed = await run(entry.phase, first, person, nativeTask, async () => {
        if (entry.route === "stop") return time.stopTimer();
        if (entry.route === "switch") return time.startTimer(taskIds[5]);
        if (entry.route === "read") { const looked = await time.getActiveTimer(); if (entry.elapsed < 720) { assert.equal(looked?.id, fixtureId); return time.stopTimer(); } assert.equal(looked, null); return { ok: true }; }
        if (entry.route === "complete") return changeTaskStatusCore(person, nativeTask, "DONE", undefined, transaction);
        return task.updateTask(nativeTask, { assigneeId: owner.recipient });
      });
      assert.equal(observed.result.ok, true); const saved = await first.timeEntry.findUniqueOrThrow({ where: { id: fixtureId } });
      assert.equal(saved.minutes, entry.elapsed >= 720 ? 720 : 719); assert.equal(saved.autoStopped, entry.elapsed >= 720);
      assert.equal(saved.stoppedAt?.getTime(), entry.elapsed >= 720 ? start.getTime() + 720 * 60000 : instant.getTime());
      if (entry.route === "switch") await run(entry.phase, first, actor("capworker"), taskIds[5], () => time.stopTimer());
    }
    await first.timeEntry.create({ data: { id: prefix + "-completion-timer", userId: owner.worker, taskId: taskIds[2], source: "timer", startedAt: new Date(instant.getTime() - 1200 * 60000) } });
    let signalHeld!: (tx: Prisma.TransactionClient) => void, releaseStart!: () => void, signalRequested!: () => void;
    const held = new Promise<Prisma.TransactionClient>(resolveLock => { signalHeld = resolveLock; });
    const startBarrier = new Promise<void>(release => { releaseStart = release; });
    const requested = new Promise<void>(signal => { signalRequested = signal; });
    const deadline = performance.now() + 5000;
    const starting = run("start-while-completing", second, actor("worker"), taskIds[2], () => time.startTimer(taskIds[2]), {
      onLockAcquired: async tx => { signalHeld(tx); await startBarrier; },
    });
    try {
      const holderTx = await timerNativeBounded(Promise.race([held, starting.then(() => { throw Error("QA132_LOCK_WITNESS_STOP"); })]), deadline);
      const finishing = run("complete-first", first, actor("worker"), taskIds[2], () => changeTaskStatusCore(actor("worker"), taskIds[2], "DONE", undefined, transaction),
        { onLockRequested: signalRequested });
      await timerNativeBounded(Promise.race([requested, finishing.then(() => { throw Error("QA132_LOCK_WITNESS_STOP"); })]), deadline);
      const holderPid = connectionTrace.find(row => row.phase === "start-while-completing")?.pid, waiterPid = connectionTrace.find(row => row.phase === "complete-first")?.pid;
      assert.ok(holderPid && waiterPid && holderPid !== waiterPid, "QA132_CONNECTION_STOP");
      for (let attempt = 0; attempt < 100 && performance.now() < deadline; attempt++) {
        // Реальный SQL waiter — доказательство overlap; ни JS-флаг, ни задержка не считаются proof.
        const locks = await timerNativeBounded(holderTx.$queryRaw<TimerNativeLockRow[]>`
          SELECT pid,locktype,database::integer AS database,classid::integer AS classid,objid::integer AS objid,objsubid,mode,granted
          FROM pg_locks WHERE locktype='advisory' AND database=(SELECT oid FROM pg_database WHERE datname=current_database())
            AND classid=18435 AND objid=55001 AND objsubid=2 AND pid IN (${holderPid},${waiterPid}) ORDER BY pid,granted`, deadline);
        overlapWitness = timerNativeLockWitness(locks, holderPid, waiterPid); if (overlapWitness) break;
      }
      assert.ok(overlapWitness, "QA132_LOCK_WITNESS_STOP"); durable("lock-overlap-witness", { sourceHash: hash, witness: overlapWitness, sameDatabase: true, beforeRelease: true });
      releaseStart(); const completed = await Promise.all([starting, finishing]); assert.ok(completed.every(row => row.result.ok));
    } catch (error) { halted = true; throw error; }
    finally { releaseStart(); }

    assert.equal((await run("complete-second", second, actor("worker"), taskIds[2], () => changeTaskStatusCore(actor("worker"), taskIds[2], "DONE", undefined, transaction))).result.ok, true);
    assert.equal(await first.payrollEntry.count({ where: { taskId: taskIds[2] } }), 1);
    assert.equal(await first.timeEntry.count({ where: { taskId: taskIds[2], stoppedAt: null } }), 0);
    await first.timeEntry.create({ data: { id: prefix + "-fault-timer", userId: owner.worker, taskId: taskIds[4], source: "timer", startedAt: new Date(instant.getTime() - 1200 * 60000) } });
    const faultBefore = await fingerprint(first);
    await assert.rejects(run("audit-fault", first, actor("manager"), taskIds[4], () => task.updateTask(taskIds[4], { assigneeId: owner.recipient }), { partialAuditFault: true }), /QA132_INJECTED_AUDIT/);
    assert.deepEqual(await fingerprint(first), faultBefore);
    assert.equal((await run("post-fault-stop", first, actor("worker"), taskIds[4], () => time.stopTimer())).result.ok, true);
    await first.timeEntry.create({ data: { id: prefix + "-cas-timer", userId: owner.worker, taskId: taskIds[3], source: "timer", startedAt: new Date(instant.getTime() - 1200 * 60000) } });
    const cas = await run("legacy-cas", first, actor("worker"), taskIds[3], () => time.stopTimer(), { legacyRace: true });
    assert.equal(cas.command.raceTriggered, true); assert.equal(cas.result.ok, false); const late = await first.timeEntry.findUniqueOrThrow({ where: { id: prefix + "-cas-timer" } });
    assert.equal(late.minutes, 720); assert.equal(late.autoStopped, true); assert.equal(late.stoppedAt?.getTime(), instant.getTime() - 480 * 60000);
    assert.deepEqual(await first.timeEntry.findMany({ where: { id: { in: historyIds } }, orderBy: { id: "asc" } }), history);
    const generated = await first.timeEntry.findMany({ where: { id: { in: TIMER_NATIVE_MANIFEST.ids.TimeEntry, notIn: historyIds } } });
    assert.ok(generated.every(row => row.minutes <= 720)); assert.equal(await first.timeEntry.count({ where: { userId: { in: TIMER_NATIVE_MANIFEST.ids.User }, stoppedAt: null } }), 0);
    assert.ok(connectionTrace.some(row => row.pid === one.pid) && connectionTrace.some(row => row.pid === two.pid));
    const captured = await captureOwned(first); durable("final-capture", { captured, connectionTrace, matrixCases: matrix.length, overlapWitness });
    assert.equal(timerNativeHash(await timerNativePins()), hash, "QA132_SOURCE_STOP"); assert.equal(outbound, 0, "QA132_OUTBOUND_STOP");
    assert.deepEqual(await fingerprint(first, true), before, "QA132_ORIGINAL_STOP");
    await first.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435, 55001)`;
      for (const table of Object.keys(TIMER_NATIVE_MANIFEST.ids).sort()) await tx.$queryRawUnsafe(`SELECT id FROM ${sqlName(table)} WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE`, ownedIds(table));
      await foreignReferenceGuard(tx); await logicalReferenceGuard(tx); assert.deepEqual(await fingerprint(tx, true), before, "QA132_ORIGINAL_STOP");
      assert.deepEqual(await captureOwned(tx), captured, "QA132_OWNED_DRIFT_STOP");
      for (const table of ["PayrollEntry", "TimeEntry", "ChangeLog", "DomainEvent", "Task", "Work", "Product", "Project", "Client", "User"])
        await tx.$executeRawUnsafe(`DELETE FROM ${sqlName(table)} WHERE id = ANY($1::text[])`, ownedIds(table));
      assert.deepEqual(await fingerprint(tx), before, "QA132_ORIGINAL_STOP");
    }, { maxWait: 5000, timeout: 30000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    assert.deepEqual(await fingerprint(first), before, "QA132_ORIGINAL_STOP");
    assert.ok(Object.values(await captureOwned(first)).every(rows => Array.isArray(rows) && rows.length === 0));
    durable("cleanup-proof", { sourceHash: hash, persistentFixtureRows: 0, protectedUnchanged: true, outbound, clients: 2, matrixCases: matrix.length, injectedClock: true });
    return { status: "NATIVE_PASS", runId, sourceHash: hash, clients: 2, matrixCases: matrix.length, sameStarts: 10, mixedSwitches: 10, completionDuplicatePayroll: 0, sqlLockOverlapProven: true,
      lateStopOverwrites: 0, historicalFactsUnchanged: true, auditRollback: true, protectedUnchanged: true, persistentFixtureRows: 0, outbound, injectedClock: true };
  } catch (error) {
    halted = true; await Promise.allSettled([...pending]);
    durable("stop", { status: "STOP", code: timerNativeFailureCode(error), mutationStarted, cleanupRequiresRootReview: mutationStarted });
    if (mutationStarted) try { durable("stop-owned-capture", await captureOwned(first)); } catch { /* Не скрывать STOP и не выполнять auto-cleanup. */ }
    throw error;
  } finally {
    let inspectionFailed = false;
    if (before) try { const current = await fingerprint(first, true); durable("protected-finally", { protectedUnchanged: JSON.stringify(current) === JSON.stringify(before), sourceHash: hash });
      assert.deepEqual(current, before, "QA132_ORIGINAL_STOP"); } catch { inspectionFailed = true; }
    if (clockEnabled) mock.timers.reset(); for (const [file, original] of originals) if (original) require.cache[file] = original; else delete require.cache[file];
    globalThis.fetch = originalFetch; http.request = networking.httpRequest; http.get = networking.httpGet; https.request = networking.httpsRequest; https.get = networking.httpsGet;
    await Promise.all([first.$disconnect(), second.$disconnect()]); if (inspectionFailed) throw Error("QA132_ORIGINAL_STOP");
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [mode, approvalFile] = process.argv.slice(2);
  if (mode !== "--execute-reviewed-local" || !approvalFile) timerNativePins().then(pins => console.log(JSON.stringify({ status: "DRY_RUN", connectionOpened: false, manifest: TIMER_NATIVE_MANIFEST, sourceHash: timerNativeHash(pins), pins })));
  else executeTimerNative(JSON.parse(readFileSync(resolve(approvalFile), "utf8")) as TimerNativeApproval).then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(JSON.stringify({ status: "STOP", code: timerNativeFailureCode(error), runId, outputDir: TIMER_NATIVE_MANIFEST.outputDir })); process.exitCode = 1; });
}
