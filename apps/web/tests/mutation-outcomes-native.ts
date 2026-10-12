// SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP on guard mismatch.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire, Module } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";
import { existingLocalCrmDatabaseUrl } from "./helpers/local-crm-database";
import type { DomainActor } from "../src/server/actor";
import type { TaskTransaction } from "../src/server/tasks/transaction";

const require = createRequire(import.meta.url);
const runId = "d2a3378e-4798-42b8-821b-6130a01b848b";
const prefix = "qa133-" + runId;
const containerId = "bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5";
const revision = "cd38cb745759becd58dbbad4d6d37afa03f0ab7a";
const owner = { manager: prefix + "-manager", worker: prefix + "-worker", accountant: prefix + "-accountant",
  client: prefix + "-client", project: prefix + "-project", product: prefix + "-product", work: prefix + "-work", cash: prefix + "-cash" };
const taskPhases = ["start", "done", "legacy", "unknown", "fault-payroll", "fault-audit", "fault-event", "fault-receipt"] as const;
const paymentPhases = ["payment", "payment-unknown", "payment-fault"] as const;
type Phase = typeof taskPhases[number] | typeof paymentPhases[number];
const phases: readonly Phase[] = [...taskPhases, ...paymentPhases];
const id = (phase: Phase, suffix: string) => prefix + "-" + phase + "-" + suffix;
const taskId = (phase: Phase) => id(phase === "done" ? "start" : phase, "task");
const uuid = (phase: Phase) => `00000133-0000-4000-8000-${String(phases.indexOf(phase) + 1).padStart(12, "0")}`;
const taskReceipt = (phase: Phase) => "task-status:" + uuid(phase);
const paymentReceipt = (phase: Phase) => "payment-request:" + uuid(phase);
export const MUTATION_NATIVE_MANIFEST = {
  format: "pero-mutation133/v1", runId, prefix, containerId, revision,
  database: "pero_crm", username: "pero", host: "127.0.0.1", port: 5433, projectNumber: "2000013300",
  ids: { User: [owner.manager, owner.worker, owner.accountant], Client: [owner.client], Project: [owner.project], Product: [owner.product],
    Work: [owner.work], Task: [...new Set(taskPhases.map(taskId))], CashAccount: [owner.cash],
    TimeEntry: taskPhases.map(phase => id(phase, "time")), PayrollEntry: taskPhases.map(phase => id(phase, "payroll")),
    Payment: paymentPhases.map(phase => id(phase, "payment")),
    ChangeLog: [...taskPhases.flatMap(phase => [id(phase, "audit-time"), id(phase, "audit-status"), taskReceipt(phase)]),
      ...paymentPhases.flatMap(phase => [id(phase, "audit-create"), paymentReceipt(phase)])],
    DomainEvent: phases.map(phase => id(phase, "event")) },
  expected: { independentConnections: 2, taskPieceByn: "100.00", paymentByn: "100.25", rollbackFaults: 5,
    enabledPlugins: ["file-stages"], optionalEffectAdapters: ["dispatch", "org", "next-cache"] },
  outputDir: join(tmpdir(), "pero-crm-qa133", runId),
};
type Database = PrismaClient | Prisma.TransactionClient;
type Pins = { file: string; sha256: string }[];
type Compiler = { build(options: Record<string, unknown>): Promise<{ metafile: { inputs: Record<string, unknown> } }> };
export async function nativeSourcePins(): Promise<Pins> {
  const compiler = createRequire(require.resolve("tsx/package.json"))("esbuild") as Compiler;
  const compiled = await compiler.build({ stdin: { contents: ["tasks/completion-core", "tasks/transaction", "payments/core", "plugins/registry"]
    .map(name => `import ${JSON.stringify("./src/server/" + name + ".ts")};`).join("\n"), resolveDir: process.cwd(), sourcefile: "qa133-source-closure.ts", loader: "ts" },
    bundle: true, write: false, metafile: true, packages: "external", platform: "node", format: "cjs", logLevel: "silent", tsconfig: resolve("tsconfig.json") });
  const files = Object.keys(compiled.metafile.inputs).filter(name => name !== "qa133-source-closure.ts" && name !== "<stdin>");
  files.push("tests/mutation-outcomes-native.ts", "tests/helpers/local-crm-database.ts", "prisma/schema.prisma", "package.json", "tsconfig.json",
    "../../package.json", "../../pnpm-lock.yaml", "../../pnpm-workspace.yaml", "tests/mutation-outcomes.test.ts",
    "../../packages/plugins/demo/package.json", "../../packages/plugins/demo/src/plugin.ts", "../../packages/plugin-sdk/package.json", "../../packages/plugin-sdk/src/index.ts");
  // Pinned runtime объясняет callback/commit/catch; generated schema должна соответствовать own source.
  const clientRequire = createRequire(require.resolve("@prisma/client"));
  files.push(relative(process.cwd(), clientRequire.resolve("@prisma/client/runtime/library.js")),
    relative(process.cwd(), clientRequire.resolve(".prisma/client/schema.prisma")));
  return [...new Set(files)].sort().map(file => {
    assert.ok(!file.startsWith("<") && !file.includes("\0"), "QA133_SOURCE_INPUT_STOP");
    return { file: file.replaceAll("\\", "/"), sha256: createHash("sha256").update(readFileSync(resolve(file))).digest("hex") };
  });
}
export const nativeSourceHash = (pins: Pins) => createHash("sha256").update(JSON.stringify(pins)).digest("hex");
export type MutationNativeApproval = { source: "root-reviewed"; operation: "execute"; runId: string; sourceHash: string; containerId: string;
  exclusiveLocalWindow: true; localOutboxInactive: true; observationEvidence: string };
export function assertNativeApproval(approval: MutationNativeApproval, hash: string) {
  assert.equal(approval.source, "root-reviewed", "QA133_APPROVAL_STOP"); assert.equal(approval.operation, "execute", "QA133_APPROVAL_STOP");
  assert.equal(approval.runId, runId, "QA133_RUN_STOP"); assert.equal(approval.containerId, containerId, "QA133_CONTAINER_STOP");
  assert.equal(approval.sourceHash, hash, "QA133_SOURCE_STOP");
  assert.equal(approval.exclusiveLocalWindow, true, "QA133_EXCLUSIVE_STOP"); assert.equal(approval.localOutboxInactive, true, "QA133_RUNTIME_STOP");
  assert.ok(typeof approval.observationEvidence === "string" && approval.observationEvidence.length > 10 && approval.observationEvidence.length < 2000, "QA133_OBSERVATION_STOP");
}
export function assertNativePluginPolicy(ids: string[], registered: boolean, hasHook: boolean) {
  assert.deepEqual(ids, ["file-stages"], "QA133_PLUGIN_STOP");
  assert.equal(registered, false, "QA133_PLUGIN_STOP"); assert.equal(hasHook, false, "QA133_PLUGIN_STOP");
}
const safeCodes = new Set(["QA133_APPROVAL_STOP", "QA133_RUN_STOP", "QA133_CONTAINER_STOP", "QA133_SOURCE_STOP", "QA133_EXCLUSIVE_STOP",
  "QA133_RUNTIME_STOP", "QA133_OBSERVATION_STOP", "QA133_IDENTITY_STOP", "QA133_PLUGIN_STOP", "QA133_CURRENCY_STOP", "QA133_FRESH_STOP",
  "QA133_ORIGINAL_DRIFT_STOP", "QA133_FOREIGN_REFERENCE_STOP", "QA133_WRITE_STOP", "QA133_UNRESOLVED_STOP"]);
export function nativeFailureCode(error: unknown) {
  const code = error instanceof Error ? error.message.match(/^(QA133_[A-Z_]+)/)?.[1] : undefined;
  return code && safeCodes.has(code) ? code : "QA133_SCENARIO_STOP";
}
function durable(name: string, value: unknown) {
  const folder = resolve(MUTATION_NATIVE_MANIFEST.outputDir); let current = folder;
  while (dirname(current) !== current) {
    try { assert.equal(lstatSync(current).isSymbolicLink(), false, "QA133_REPARSE_STOP"); }
    catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
    current = dirname(current);
  }
  mkdirSync(folder, { recursive: true }); const file = join(folder, name + ".json"), bytes = Buffer.from(JSON.stringify(value) + "\n");
  const fd = openSync(file, "wx", 0o600); try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  assert.deepEqual(readFileSync(file), bytes, "QA133_DURABLE_STOP");
}
function sqlName(name: string) { assert.match(name, /^[A-Za-z_][A-Za-z0-9_]{0,62}$/, "QA133_SQL_NAME_STOP"); return '"' + name + '"'; }
const ownedIds = (table: string) => (MUTATION_NATIVE_MANIFEST.ids as Record<string, string[]>)[table] ?? [];
async function fingerprints(db: Database, excludeOwned = false) {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
  const result: Record<string, unknown> = {};
  for (const { tablename } of tables) {
    const ids = excludeOwned ? ownedIds(tablename) : [], where = ids.length ? "WHERE id <> ALL($1::text[])" : "";
    result[tablename] = await db.$queryRawUnsafe(`SELECT count(*)::text AS count,md5(COALESCE(string_agg(row_to_json(t)::text,'' ORDER BY row_to_json(t)::text),'')) AS digest FROM ${sqlName(tablename)} t ${where}`, ...ids.length ? [ids] : []);
  }
  result.constraints = await db.$queryRaw`SELECT md5(COALESCE(string_agg(pg_get_constraintdef(c.oid),'' ORDER BY t.relname,c.conname),'')) AS digest FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public'`;
  return result;
}
async function captureOwned(db: Database) {
  const result: Record<string, unknown> = {};
  for (const [table, ids] of Object.entries(MUTATION_NATIVE_MANIFEST.ids))
    result[table] = await db.$queryRawUnsafe(`SELECT row_to_json(t) AS row FROM ${sqlName(table)} t WHERE id = ANY($1::text[]) ORDER BY id`, ids);
  return result;
}
async function assertNoForeignReferences(db: Database) {
  const relations = await db.$queryRaw<{ child: string; parent: string; child_columns: string[]; parent_columns: string[] }[]>`
    SELECT child.relname::text AS child,parent.relname::text AS parent,
      array_agg(ca.attname::text ORDER BY k.ord) AS child_columns,array_agg(pa.attname::text ORDER BY k.ord) AS parent_columns
    FROM pg_constraint c JOIN pg_class child ON child.oid=c.conrelid JOIN pg_class parent ON parent.oid=c.confrelid
      JOIN pg_namespace n ON n.oid=child.relnamespace
      JOIN LATERAL unnest(c.conkey,c.confkey) WITH ORDINALITY AS k(child_att,parent_att,ord) ON true
      JOIN pg_attribute ca ON ca.attrelid=child.oid AND ca.attnum=k.child_att
      JOIN pg_attribute pa ON pa.attrelid=parent.oid AND pa.attnum=k.parent_att
    WHERE c.contype='f' AND n.nspname='public' GROUP BY c.oid,child.relname,parent.relname ORDER BY child.relname,parent.relname,c.oid`;
  for (const relation of relations) {
    const parentIds = ownedIds(relation.parent); if (!parentIds.length) continue;
    const childIds = ownedIds(relation.child);
    const match = relation.child_columns.map((column, index) => `child.${sqlName(column)}=parent.${sqlName(relation.parent_columns[index])}`).join(" AND ");
    const exclusion = childIds.length ? " AND child.id <> ALL($2::text[])" : "";
    const [count] = await db.$queryRawUnsafe<{ count: string }[]>(`SELECT count(*)::text AS count FROM ${sqlName(relation.child)} child JOIN ${sqlName(relation.parent)} parent ON ${match} WHERE parent.id = ANY($1::text[])${exclusion}`, parentIds, ...childIds.length ? [childIds] : []);
    assert.equal(count.count, "0", "QA133_FOREIGN_REFERENCE_STOP");
  }
}
async function guard(db: Database) {
  const [identity] = await db.$queryRaw<{ database: string; username: string }[]>`SELECT current_database() AS database,current_user AS username`;
  assert.deepEqual(identity, { database: "pero_crm", username: "pero" }, "QA133_IDENTITY_STOP");
  const registry = require("../src/server/plugins/registry") as typeof import("../src/server/plugins/registry");
  const plugins = await db.plugin.findMany({ where: { enabled: true }, select: { id: true }, orderBy: { id: "asc" } });
  const manifest = registry.getManifest("file-stages");
  assertNativePluginPolicy(plugins.map(row => row.id), Boolean(manifest), typeof manifest?.hooks?.onDomainEvent === "function");
  const currency = await db.orgSetting.findUnique({ where: { key: "payrollCurrency" } });
  assert.ok(!currency || currency.value === "BYN", "QA133_CURRENCY_STOP");
  for (const [table, ids] of Object.entries(MUTATION_NATIVE_MANIFEST.ids)) {
    const [count] = await db.$queryRawUnsafe<{ count: string }[]>(`SELECT count(*)::text AS count FROM ${sqlName(table)} WHERE id = ANY($1::text[])`, ids);
    assert.equal(count.count, "0", "QA133_FRESH_STOP");
  }
  assert.equal(await db.project.count({ where: { number: MUTATION_NATIVE_MANIFEST.projectNumber } }), 0, "QA133_FRESH_STOP");
  assert.equal(await db.product.count({ where: { number: MUTATION_NATIVE_MANIFEST.projectNumber + ".1" } }), 0, "QA133_FRESH_STOP");
}

type Run = { phase: Phase; mode?: "lost-ack" | "failed-proof"; fault?: "payroll" | "audit" | "event" | "receipt";
  transactionCalls: number; writes: number; partialBeforeFault: number; effects: string[] };
const writeMethods = new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "upsert", "delete", "deleteMany"]);
export function hasOwnedId(value: unknown, expected: string): boolean {
  if (!value || typeof value !== "object") return false;
  if ("id" in value && value.id === expected) return true;
  if ("AND" in value) return (Array.isArray(value.AND) ? value.AND : [value.AND]).some(item => hasOwnedId(item, expected));
  return false;
}
function scopedTransaction(tx: Prisma.TransactionClient, run: Run, proof: boolean) {
  const nativeTask = taskId(run.phase);
  const ownedActor = run.phase === "start" || run.phase === "done" ? owner.worker : owner.manager;
  const partial = async () => {
    assert.equal(await tx.task.count({ where: { id: nativeTask, status: "DONE" } }), 1, "QA133_PARTIAL_TASK_STOP");
    assert.equal(await tx.timeEntry.count({ where: { taskId: nativeTask, minutes: { gt: 0 } } }), 1, "QA133_PARTIAL_TIME_STOP");
    if (run.fault !== "payroll") assert.equal(await tx.payrollEntry.count({ where: { id: id(run.phase, "payroll") } }), 1, "QA133_PARTIAL_PAYROLL_STOP");
    if (run.fault === "event" || run.fault === "receipt") assert.equal(await tx.changeLog.count({ where: { id: id(run.phase, "audit-status") } }), 1, "QA133_PARTIAL_AUDIT_STOP");
    if (run.fault === "receipt") assert.equal(await tx.domainEvent.count({ where: { id: id(run.phase, "event") } }), 1, "QA133_PARTIAL_EVENT_STOP");
    run.partialBeforeFault++;
  };
  return new Proxy(tx, { get(database, table: string | symbol) {
    if (table === "$queryRaw") return async (strings: TemplateStringsArray, ...values: unknown[]) => {
      assert.equal(strings.join("?").trim(), "SELECT 1 AS locked FROM pg_advisory_xact_lock(18435, 55001)", "QA133_WRITE_STOP");
      assert.equal(values.length, 0, "QA133_WRITE_STOP"); return database.$queryRaw(strings, ...values);
    };
    if (table === "$executeRaw") return async (strings: TemplateStringsArray, ...values: unknown[]) => {
      assert.equal(proof, false, "QA133_WRITE_STOP");
      assert.ok(strings.join("?").trim().startsWith('UPDATE "TimeEntry" SET "minutes"'), "QA133_WRITE_STOP");
      assert.equal(values.length, 1, "QA133_WRITE_STOP"); assert.ok(values[0] === owner.worker || values[0] === nativeTask, "QA133_WRITE_STOP");
      run.writes++; return database.$executeRaw(strings, ...values);
    };
    if (typeof table !== "string" || table.startsWith("$")) {
      assert.ok(!["$executeRawUnsafe", "$queryRawUnsafe"].includes(String(table)), "QA133_WRITE_STOP");
      return Reflect.get(database, table);
    }
    const delegate = Reflect.get(database, table) as Record<string | symbol, unknown>;
    if (!delegate || typeof delegate !== "object") return delegate;
    return new Proxy(delegate, { get(model, method: string | symbol) {
      const original = Reflect.get(model, method); if (typeof original !== "function") return original;
      return async (args: Record<string, unknown>) => {
        if (!writeMethods.has(String(method))) {
          if (proof && run.mode === "failed-proof" && ["changeLog", "domainEvent", "payment"].includes(table)) throw Error("QA133_INJECTED_PROOF_READ");
          return Reflect.apply(original, model, [args]);
        }
        assert.equal(proof, false, "QA133_WRITE_STOP");
        const data = args.data as Record<string, unknown>, where = args.where as Record<string, unknown> | undefined;
        let assigned: string | undefined;
        if (table === "task" && method === "update") { assert.ok(hasOwnedId(where, nativeTask), "QA133_WRITE_STOP");
          assert.ok(data.status === "IN_PROGRESS" || data.status === "DONE", "QA133_WRITE_STOP"); if (data.doneById) assert.equal(data.doneById, ownedActor, "QA133_WRITE_STOP"); }
        else if (table === "timeEntry" && method === "updateMany") {
          assert.ok(where?.userId === owner.worker || where?.taskId === nativeTask, "QA133_WRITE_STOP");
          assert.equal(where.stoppedAt, null, "QA133_WRITE_STOP");
        } else if (table === "timeEntry" && method === "create") {
          assert.equal(data.taskId, nativeTask, "QA133_WRITE_STOP"); assert.equal(data.userId, owner.worker, "QA133_WRITE_STOP"); assigned = id(run.phase, "time");
        } else if (table === "payrollEntry" && method === "create") {
          assert.equal(data.userId, owner.worker, "QA133_WRITE_STOP"); assert.equal(data.taskId, nativeTask, "QA133_WRITE_STOP");
          assert.equal(data.workId, owner.work, "QA133_WRITE_STOP"); assert.equal(data.projectId, owner.project, "QA133_WRITE_STOP"); assert.equal(data.scheme, "PIECE", "QA133_WRITE_STOP");
          assert.equal(data.currency, "BYN", "QA133_WRITE_STOP"); assert.equal(new Prisma.Decimal(data.amount as Prisma.Decimal.Value).toFixed(2), "100.00", "QA133_WRITE_STOP");
          assert.equal(new Prisma.Decimal(data.bynAmount as Prisma.Decimal.Value).toFixed(2), "100.00", "QA133_WRITE_STOP");
          if (run.fault === "payroll") { await partial(); throw Error("QA133_INJECTED_PAYROLL"); } assigned = id(run.phase, "payroll");
        } else if (table === "payment" && method === "create") {
          assert.equal(data.createdById, owner.accountant, "QA133_WRITE_STOP"); assert.equal(data.cashAccountId, owner.cash, "QA133_WRITE_STOP");
          assert.equal(data.currency, "BYN", "QA133_WRITE_STOP"); assert.equal(data.projectId, null, "QA133_WRITE_STOP"); assert.equal(data.direction, "INCOME", "QA133_WRITE_STOP");
          assert.equal(new Prisma.Decimal(data.amount as Prisma.Decimal.Value).toFixed(2), "100.25", "QA133_WRITE_STOP");
          assert.equal(new Prisma.Decimal(data.bynAmount as Prisma.Decimal.Value).toFixed(2), "100.25", "QA133_WRITE_STOP"); assigned = id(run.phase, "payment");
        } else if (table === "changeLog" && method === "create") {
          const isPayment = paymentPhases.includes(run.phase as typeof paymentPhases[number]);
          assert.equal(data.actorId, isPayment ? owner.accountant : ownedActor, "QA133_WRITE_STOP");
          assert.equal(data.entity, isPayment ? "payment" : "task", "QA133_WRITE_STOP"); assert.equal(data.entityId, isPayment ? id(run.phase, "payment") : nativeTask, "QA133_WRITE_STOP");
          if (data.action === "task.status.request" || data.action === "request") {
            assert.equal(data.id, isPayment ? paymentReceipt(run.phase) : taskReceipt(run.phase), "QA133_WRITE_STOP");
            if (run.fault === "receipt") { await partial(); throw Error("QA133_INJECTED_RECEIPT"); }
          } else {
            assert.ok(["time", "status", "create"].includes(String(data.action)), "QA133_WRITE_STOP"); assigned = id(run.phase, "audit-" + data.action);
            if (run.fault === "audit" && data.action === "status") { await partial(); throw Error("QA133_INJECTED_AUDIT"); }
          }
        } else if (table === "domainEvent" && method === "create") {
          const isPayment = paymentPhases.includes(run.phase as typeof paymentPhases[number]);
          assert.equal(data.actor, isPayment ? owner.accountant : ownedActor, "QA133_WRITE_STOP");
          assert.equal(data.type, isPayment ? "payment.created" : "task.statusChanged", "QA133_WRITE_STOP");
          if (run.fault === "event") {
            if (isPayment) { assert.equal(await tx.payment.count({ where: { id: id(run.phase, "payment") } }), 1); assert.equal(await tx.changeLog.count({ where: { id: id(run.phase, "audit-create") } }), 1); run.partialBeforeFault++; }
            else await partial(); throw Error("QA133_INJECTED_EVENT");
          } assigned = id(run.phase, "event");
        } else assert.fail("QA133_WRITE_STOP");
        if (assigned) assert.ok(ownedIds(table[0].toUpperCase() + table.slice(1)).includes(assigned), "QA133_WRITE_STOP");
        run.writes++; return Reflect.apply(original, model, [{ ...args, data: assigned ? { ...data, id: assigned } : data }]);
      };
    } });
  } }) as Prisma.TransactionClient;
}

export async function executeMutationNative(approval: MutationNativeApproval) {
  const pins = await nativeSourcePins(), hash = nativeSourceHash(pins); assertNativeApproval(approval, hash);
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim(), revision, "QA133_SOURCE_STOP");
  assert.equal(execFileSync("git", ["branch", "--show-current"], { encoding: "utf8", windowsHide: true }).trim(), "bugfix/133", "QA133_SOURCE_STOP");
  assert.equal(process.env.CRM_LOCAL_CONTAINER_ID, containerId, "QA133_CONTAINER_STOP");
  assert.equal(process.env.CRM_EVENT_DISPATCHER_ENABLED, undefined, "QA133_RUNTIME_STOP");
  durable("manifest", { ...MUTATION_NATIVE_MANIFEST, sourceHash: hash, pins, approval });
  const url = existingLocalCrmDatabaseUrl(), first = new PrismaClient({ datasourceUrl: url }), second = new PrismaClient({ datasourceUrl: url });
  let run: Run = { phase: "start", transactionCalls: 0, writes: 0, partialBeforeFault: 0, effects: [] }, mutationStarted = false, outbound = 0;
  const originalFetch = globalThis.fetch, originalModules = new Map<string, NodeJS.Module | undefined>();
  const before = {} as { fingerprint?: Awaited<ReturnType<typeof fingerprints>> };
  const connections: { phase: Phase; proof: boolean; pid: number }[] = [];
  const http = require("node:http") as typeof import("node:http"), https = require("node:https") as typeof import("node:https");
  const originalNetwork = { httpRequest: http.request, httpGet: http.get, httpsRequest: https.request, httpsGet: https.get };
  const denyOutgoing = () => { outbound++; throw Error("QA133_OUTBOUND_STOP"); };
  globalThis.fetch = async () => { outbound++; throw Error("QA133_OUTBOUND_STOP"); };
  http.request = denyOutgoing; http.get = denyOutgoing; https.request = denyOutgoing; https.get = denyOutgoing;
  function inject(file: string, value: Record<string, unknown>) {
    const location = require.resolve(file); originalModules.set(location, require.cache[location]);
    const stubModule = new Module(location); stubModule.filename = location; stubModule.loaded = true; stubModule.exports = value; require.cache[location] = stubModule;
  }
  const facade = new Proxy(first, { get(database, key) {
    if (key === "$transaction") return async <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>, options: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel }) => {
      const proof = run.transactionCalls++ > 0, connection = proof ? second : database;
      const value = await connection.$transaction(async tx => {
        if (proof) await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        const [connectionId] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        if (proof) assert.ok(!connections.some(row => row.phase === run.phase && !row.proof && row.pid === connectionId.pid), "QA133_INDEPENDENT_CONNECTIONS_STOP");
        connections.push({ phase: run.phase, proof, pid: connectionId.pid });
        return callback(scopedTransaction(tx, run, proof));
      }, options);
      // Инъекция только после resolve настоящего SQL COMMIT, не внутри outer rollback.
      if (!proof && run.mode) throw Error("QA133_INJECTED_LOST_ACK");
      return value;
    };
    return Reflect.get(database, key);
  } });
  try {
    await first.$connect(); await second.$connect();
    const [one] = await first.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`, [two] = await second.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    assert.ok(one.pid !== two.pid, "QA133_INDEPENDENT_CONNECTIONS_STOP");
    await first.$transaction(async tx => { await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY"); await guard(tx); });
    before.fingerprint = await fingerprints(first); durable("before", { fingerprint: before.fingerprint, backendPids: [one.pid, two.pid], sourceHash: hash });
    assert.equal(nativeSourceHash(await nativeSourcePins()), hash, "QA133_SOURCE_STOP");
    mutationStarted = true;
    await first.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435, 55001)`;
      for (const [key, roles, payScheme] of [["manager", ["MANAGER"], "NONE"], ["worker", ["WORKER"], "PIECE"], ["accountant", ["ACCOUNTANT"], "NONE"]] as const)
        await tx.user.create({ data: { id: owner[key], email: owner[key] + "@invalid.local", name: prefix + "-" + key, passwordHash: "QA133_LOGIN_DISABLED", roles: [...roles], payScheme } });
      await tx.client.create({ data: { id: owner.client, name: prefix, phone: "QA133_NO_PHONE" } });
      await tx.project.create({ data: { id: owner.project, number: MUTATION_NATIVE_MANIFEST.projectNumber, numberInt: 2000013300, title: prefix, currency: "BYN", clientId: owner.client, managerId: owner.manager, createdById: owner.manager } });
      await tx.product.create({ data: { id: owner.product, projectId: owner.project, number: MUTATION_NATIVE_MANIFEST.projectNumber + ".1", title: prefix, suffixInt: 1, status: "PRODUCTION", createdById: owner.manager } });
      await tx.work.create({ data: { id: owner.work, projectId: owner.project, productId: owner.product, title: prefix, quantity: 10, priceSnapshot: 100, total: 1000, paymentKind: "LEGACY", createdById: owner.manager } });
      for (const nativeTask of MUTATION_NATIVE_MANIFEST.ids.Task)
        await tx.task.create({ data: { id: nativeTask, projectId: owner.project, productId: owner.product, workId: owner.work, assigneeId: owner.worker, title: prefix, quantity: 1, createdById: owner.manager } });
      await tx.cashAccount.create({ data: { id: owner.cash, name: prefix, currency: "BYN" } });
    });
    // Только IO-bound adapters. Ядро, prepare, receipt, audit/outbox и lock исполняют actual source/SQL.
    inject("../src/lib/prisma", { prisma: facade });
    inject("next/cache", { revalidatePath: (path: string) => { run.effects.push("cache:" + path); throw Error("QA133_INJECTED_EFFECT"); } });
    inject("../src/server/plugins/events", { dispatchEvent: async () => { run.effects.push("dispatch"); throw Error("QA133_INJECTED_EFFECT"); } });
    inject("../src/server/notifications/notify", { notifyOrg: async () => { run.effects.push("org"); throw Error("QA133_INJECTED_EFFECT"); } });
    const { createTaskTransaction } = require("../src/server/tasks/transaction") as typeof import("../src/server/tasks/transaction");
    const { changeTaskStatusCore } = require("../src/server/tasks/completion-core") as typeof import("../src/server/tasks/completion-core");
    const { createPaymentCore } = require("../src/server/payments/service") as typeof import("../src/server/payments/service");
    const transaction: TaskTransaction = createTaskTransaction(facade);
    const actor = (key: "worker" | "manager" | "accountant"): DomainActor => ({ id: owner[key], name: prefix + "-" + key, roles: [key === "worker" ? "WORKER" : key === "manager" ? "MANAGER" : "ACCOUNTANT"], source: "web" });
    const begin = (phase: Phase, options: Pick<Run, "mode" | "fault"> = {}) => { run = { phase, ...options, transactionCalls: 0, writes: 0, partialBeforeFault: 0, effects: [] }; };
    const context = (phase: Phase, key: "worker" | "manager" = "manager") => ({ clientMutationId: uuid(phase), expectedActorId: owner[key] });
    const payment = (phase: typeof paymentPhases[number]) => ({ direction: "INCOME" as const, amount: 100.25, currency: "BYN", cashAccountId: owner.cash, comment: prefix, paidAt: "2000-01-15", clientMutationId: uuid(phase) });
    begin("start", { mode: "lost-ack" });
    const started = await changeTaskStatusCore(actor("worker"), taskId("start"), "IN_PROGRESS", undefined, transaction, context("start", "worker"));
    assert.ok(started.ok); assert.equal(started.outcome, "COMMITTED"); assert.equal(started.resultId, taskId("start")); assert.equal(started.recovered, true); assert.equal(run.transactionCalls, 2);
    begin("done"); const done = await changeTaskStatusCore(actor("worker"), taskId("done"), "DONE", undefined, transaction, context("done", "worker"));
    assert.ok(done.ok); assert.equal(done.payroll?.amount, "100.00");
    const completed = await fingerprints(first);
    begin("start"); const old = await changeTaskStatusCore(actor("worker"), taskId("start"), "IN_PROGRESS", undefined, transaction, context("start", "worker"));
    assert.ok(old.ok && old.repeated); assert.equal(run.writes, 0); assert.deepEqual(await fingerprints(first), completed);
    begin("start"); const changedActor = await changeTaskStatusCore(actor("manager"), taskId("start"), "IN_PROGRESS", undefined, transaction, context("start", "worker"));
    assert.ok(!changedActor.ok && changedActor.kind === "actor-changed"); assert.equal(run.transactionCalls, 0); assert.equal(run.writes, 0);
    begin("legacy", { mode: "lost-ack" }); const legacy = await changeTaskStatusCore(actor("manager"), taskId("legacy"), "IN_PROGRESS", undefined, transaction);
    assert.ok(legacy.ok && legacy.recovered); assert.equal(legacy.resultId, taskId("legacy"));
    begin("unknown", { mode: "failed-proof" }); const unknown = await changeTaskStatusCore(actor("manager"), taskId("unknown"), "IN_PROGRESS", undefined, transaction, context("unknown"));
    assert.ok(!unknown.ok && unknown.outcome === "UNKNOWN"); assert.equal(run.transactionCalls, 2);
    // Не запускаем запись заново: сначала SELECT-only exact owned capture, затем тот же UUID.
    const unknownCaptured = await captureOwned(second); durable("expected-unknown-inspection", unknownCaptured);
    const unknownBefore = await fingerprints(first); begin("unknown");
    const verified = await changeTaskStatusCore(actor("manager"), taskId("unknown"), "IN_PROGRESS", undefined, transaction, context("unknown"));
    assert.ok(verified.ok && verified.repeated, "QA133_UNRESOLVED_STOP"); assert.equal(run.writes, 0); assert.deepEqual(await fingerprints(first), unknownBefore);
    for (const fault of ["payroll", "audit", "event", "receipt"] as const) {
      const phase = ("fault-" + fault) as Phase, previous = await fingerprints(first); begin(phase, { fault });
      await assert.rejects(changeTaskStatusCore(actor("manager"), taskId(phase), "DONE", 20, transaction, context(phase)), /QA133_INJECTED_/);
      assert.equal(run.partialBeforeFault, 1); assert.equal(run.transactionCalls, 2); assert.deepEqual(await fingerprints(first), previous);
    }
    begin("payment", { mode: "lost-ack" }); const paid = await createPaymentCore(actor("accountant"), payment("payment"));
    assert.ok(paid.ok); assert.equal(paid.paymentId, id("payment", "payment")); assert.equal(paid.resultId, paid.paymentId); assert.equal(paid.outcome, "COMMITTED"); assert.equal(run.transactionCalls, 2); assert.equal(run.effects.length, 6);
    const paidBefore = await fingerprints(first); begin("payment"); const samePayment = await createPaymentCore(actor("accountant"), payment("payment"));
    assert.ok(samePayment.ok && samePayment.paymentId === paid.paymentId); assert.equal(run.transactionCalls, 0); assert.equal(run.writes, 0); assert.deepEqual(await fingerprints(first), paidBefore);
    begin("payment-unknown", { mode: "failed-proof" }); const uncertainPayment = await createPaymentCore(actor("accountant"), payment("payment-unknown"));
    assert.ok(!uncertainPayment.ok && uncertainPayment.outcome === "UNKNOWN"); assert.equal(run.effects.length, 0);
    const uncertainBefore = await fingerprints(first); begin("payment-unknown"); const inspectedPayment = await createPaymentCore(actor("accountant"), payment("payment-unknown"));
    assert.ok(inspectedPayment.ok && inspectedPayment.paymentId === id("payment-unknown", "payment"), "QA133_UNRESOLVED_STOP");
    assert.equal(run.writes, 0); assert.deepEqual(await fingerprints(first), uncertainBefore);
    const faultBefore = await fingerprints(first); begin("payment-fault", { fault: "event" }); const rejected = await createPaymentCore(actor("accountant"), payment("payment-fault"));
    assert.ok(!rejected.ok && rejected.outcome === "ROLLED_BACK"); assert.equal(run.partialBeforeFault, 1); assert.equal(run.transactionCalls, 2); assert.deepEqual(await fingerprints(first), faultBefore);
    const captured = await captureOwned(first); durable("final-capture", { captured, connections });
    assert.equal(nativeSourceHash(await nativeSourcePins()), hash, "QA133_SOURCE_STOP"); assert.equal(outbound, 0, "QA133_OUTBOUND_STOP");
    assert.deepEqual(await fingerprints(first, true), before.fingerprint, "QA133_ORIGINAL_DRIFT_STOP");
    await first.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435, 55001)`;
      // FK writers берут KEY SHARE: FOR UPDATE всех owned родителей закрывает гонку до DELETE.
      for (const table of Object.keys(MUTATION_NATIVE_MANIFEST.ids).sort())
        await tx.$queryRawUnsafe(`SELECT id FROM ${sqlName(table)} WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE`, ownedIds(table));
      assert.deepEqual(await fingerprints(tx, true), before.fingerprint, "QA133_ORIGINAL_DRIFT_STOP"); await assertNoForeignReferences(tx);
      assert.deepEqual(await captureOwned(tx), captured, "QA133_UNATTRIBUTED_OWNED_STOP");
      // Точный immutable manifest, child-first; никаких prefix delete/cascade reliance/авто-cleanup при STOP.
      for (const table of ["PayrollEntry", "TimeEntry", "ChangeLog", "DomainEvent", "Payment", "Task", "Work", "Product", "Project", "Client", "CashAccount", "User"])
        await tx.$executeRawUnsafe(`DELETE FROM ${sqlName(table)} WHERE id = ANY($1::text[])`, ownedIds(table));
      // Любое удаление/trigger/cascade чужой строки отклоняется до cleanup COMMIT.
      assert.deepEqual(await fingerprints(tx), before.fingerprint, "QA133_ORIGINAL_DRIFT_STOP");
    }, { maxWait: 5000, timeout: 30000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    assert.deepEqual(await fingerprints(first), before.fingerprint, "QA133_ORIGINAL_DRIFT_STOP");
    const empty = await captureOwned(first); assert.ok(Object.values(empty).every(rows => Array.isArray(rows) && rows.length === 0), "QA133_FIXTURE_REMAINS_STOP");
    durable("cleanup-proof", { sourceHash: hash, persistentFixtureRows: 0, protectedFingerprintsUnchanged: true, outbound, connectionCount: 2 });
    return { status: "NATIVE_PASS", runId, sourceHash: hash, connectionCount: 2, taskHistoricalReplay: true, commitAckRecovery: true,
      expectedUnknownVerified: true, rollbackFaults: 5, stableTaskId: true, stablePaymentId: true, persistentFixtureRows: 0, protectedFingerprintsUnchanged: true, outbound };
  } catch (error) {
    durable("stop", { status: "STOP", code: nativeFailureCode(error), mutationStarted, cleanupRequiresRootReview: mutationStarted });
    if (mutationStarted) {
      try { durable("stop-owned-capture", await captureOwned(first)); }
      catch { try { durable("stop-owned-capture-unknown", { status: "STOP", code: "QA133_INSPECTION_UNKNOWN" }); } catch { /* Сохранить STOP и закрыть connections. */ } }
    }
    throw error;
  } finally {
    let inspectionFailed = false;
    if (before.fingerprint) {
      try { const actual = await fingerprints(first, true);
        durable("protected-finally", { protectedUnchanged: JSON.stringify(actual) === JSON.stringify(before.fingerprint), sourceHash: hash });
        assert.deepEqual(actual, before.fingerprint, "QA133_ORIGINAL_DRIFT_STOP");
      } catch { inspectionFailed = true;
        try { durable("protected-finally-unknown", { status: "STOP", code: "QA133_INSPECTION_UNKNOWN", sourceHash: hash }); } catch { /* STOP остаётся, соединения закрываются даже при отказе evidence IO. */ }
      }
    }
    for (const [file, original] of originalModules) if (original) require.cache[file] = original; else delete require.cache[file];
    globalThis.fetch = originalFetch; http.request = originalNetwork.httpRequest; http.get = originalNetwork.httpGet;
    https.request = originalNetwork.httpsRequest; https.get = originalNetwork.httpsGet;
    await Promise.all([first.$disconnect(), second.$disconnect()]);
    if (inspectionFailed) throw Error("QA133_ORIGINAL_DRIFT_STOP");
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [mode, approvalFile] = process.argv.slice(2);
  if (mode !== "--execute-reviewed-local" || !approvalFile) nativeSourcePins().then(pins => console.log(JSON.stringify({ status: "DRY_RUN", connectionOpened: false, manifest: MUTATION_NATIVE_MANIFEST, sourceHash: nativeSourceHash(pins), pins })));
  else executeMutationNative(JSON.parse(readFileSync(resolve(approvalFile), "utf8")) as MutationNativeApproval)
    .then(result => console.log(JSON.stringify(result))).catch(error => { console.error(JSON.stringify({ status: "STOP", code: nativeFailureCode(error), runId, outputDir: MUTATION_NATIVE_MANIFEST.outputDir })); process.exitCode = 1; });
}
