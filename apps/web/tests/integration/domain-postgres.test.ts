// SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP при несовпадении CI target.
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { Prisma, PrismaClient, ProductStatus, ProjectStage, Role } from "@prisma/client";
import type { DomainActor } from "../../src/server/actor";
import { guardedModuleCache } from "../helpers/guarded-module-cache";
import { nativeOwnedIds, nativeSnapshot } from "../helpers/native-acceptance-snapshot";
import { createPostgresFixture, rejectedSql, type PostgresRows } from "./postgres.fixture";

type Db = PrismaClient | Prisma.TransactionClient;
type MutationProbe = { taskId?: string; workerId?: string; workId?: string; projectId?: string; cashId?: string; paymentId?: string; receiptId?: string; payment: boolean;
  actor: DomainActor; mode?: "lost-ack" | "failed-proof"; fault?: "payroll" | "audit" | "event" | "receipt";
  calls: number; writes: number; partials: number; effects: string[]; connections: { proof: boolean; pid: number }[]; owned: Record<string, string[]>; creates: Set<string> };
type Context = { actor: DomainActor; db: Db; onRequested?: (pid: number) => void;
  onHeld?: (tx: Prisma.TransactionClient, pid: number) => Promise<void>; failAuditId?: string;
  onTimerLookup?: (tx: Prisma.TransactionClient, rows: readonly { id: string }[]) => Promise<void>;
  beforeAudit?: (tx: Prisma.TransactionClient) => Promise<void>; mutation?: MutationProbe };
const contexts = new AsyncLocalStorage<Context>();
const current = () => { const value = contexts.getStore(); assert.ok(value, "SYNTHETIC_ACTOR_CONTEXT_REQUIRED"); return value; };
const run = <T>(actor: DomainActor, db: Db, operation: () => Promise<T>, extra: Partial<Context> = {}) => contexts.run({ actor, db, ...extra }, operation);
const actorOf = (user: { id: string; name: string; roles: Role[] }): DomainActor => ({ ...user, source: "web" });
const gate = () => { let resolve = () => {}; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; };
let fixture: Awaited<ReturnType<typeof createPostgresFixture>>;
let scope: ReturnType<typeof guardedModuleCache>;
let products: typeof import("../../src/server/products/core"), statuses: typeof import("../../src/server/products/status-core");
let stages: typeof import("../../src/server/projects/stage-core"), deletion: typeof import("../../src/server/projects/delete-core");
let productQueries: typeof import("../../src/server/products/queries");
let visibility: typeof import("../../src/server/access/visibility"), notifications: typeof import("../../src/server/access/notification-visibility");
let tasks: typeof import("../../src/server/tasks/actions"), completion: typeof import("../../src/server/tasks/completion-core");
let taskQueries: typeof import("../../src/server/tasks/queries"), workspace: typeof import("../../src/server/tasks/workspace-contract");
let time: typeof import("../../src/server/time/actions");
let units: typeof import("../../src/server/warehouse/unit-core");
let norms: typeof import("../../src/server/warehouse/norm-core"), warehouse: typeof import("../../src/server/warehouse/queries");
let coordinator: typeof import("../../src/server/transactions/coordinator");
let frozenReference: typeof import("../helpers/project-materials-reference");
let payments: typeof import("../../src/server/payments/service");

function mutationTx(tx: Prisma.TransactionClient, probe: MutationProbe, proof: boolean): Prisma.TransactionClient {
  const writeMethods = new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "upsert", "delete", "deleteMany"]);
  const hasTaskId = (where: unknown): boolean => {
    if (!where || typeof where !== "object" || !probe.taskId) return false;
    if ("id" in where && where.id === probe.taskId) return true;
    return "AND" in where && (Array.isArray(where.AND) ? where.AND : [where.AND]).some(hasTaskId);
  };
  return new Proxy(tx, { get(db, table) {
    if (table === "$queryRaw") return (strings: TemplateStringsArray, ...values: unknown[]) => {
      assert.equal(strings.join("?").trim(), "SELECT 1 AS locked FROM pg_advisory_xact_lock(18435, 55001)", "CI133_WRITE_STOP");
      assert.equal(values.length, 0, "CI133_WRITE_STOP"); return db.$queryRaw(strings, ...values);
    };
    if (table === "$executeRaw") return (strings: TemplateStringsArray, ...values: unknown[]) => {
      assert.equal(proof, false, "CI133_WRITE_STOP"); assert.equal(probe.payment, false, "CI133_WRITE_STOP");
      assert.ok(strings.join("?").trim().startsWith('UPDATE "TimeEntry" SET "minutes"'), "CI133_WRITE_STOP");
      assert.equal(values.length, 1, "CI133_WRITE_STOP"); assert.equal(typeof values[0], "string", "CI133_WRITE_STOP");
      assert.ok(values[0] === probe.workerId || values[0] === probe.taskId, "CI133_WRITE_STOP");
      probe.writes++; return db.$executeRaw(strings, ...values);
    };
    assert.ok(!["$executeRawUnsafe", "$queryRawUnsafe"].includes(String(table)), "CI133_WRITE_STOP");
    const delegate = Reflect.get(db, table);
    if (typeof table !== "string" || table.startsWith("$")) return typeof delegate === "function" ? delegate.bind(db) : delegate;
    if (!delegate || typeof delegate !== "object") return delegate;
    return new Proxy(delegate, { get(model, method) {
      const value = Reflect.get(model, method); if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        if (!writeMethods.has(String(method))) {
          if (proof && probe.mode === "failed-proof" && ["changeLog", "domainEvent", "payment"].includes(table)) throw Error("CI133_INJECTED_PROOF_READ");
          return Reflect.apply(value, model, args);
        }
        assert.equal(proof, false, "PROOF_TRANSACTION_MUST_BE_READ_ONLY");
        const { data, where } = args[0] as { data?: Record<string, unknown>; where?: Record<string, unknown> };
        assert.ok(data, "CI133_WRITE_STOP");
        if (table === "task" && method === "update") {
          assert.equal(probe.payment, false, "CI133_WRITE_STOP"); assert.ok(hasTaskId(where), "CI133_WRITE_STOP");
          assert.ok(data.status === "IN_PROGRESS" || data.status === "DONE", "CI133_WRITE_STOP");
          if (data.doneById) assert.equal(data.doneById, probe.actor.id, "CI133_WRITE_STOP");
        } else if (table === "timeEntry" && method === "updateMany") {
          assert.equal(probe.payment, false, "CI133_WRITE_STOP"); assert.ok(where, "CI133_WRITE_STOP");
          assert.ok(where.userId === probe.workerId || where.taskId === probe.taskId, "CI133_WRITE_STOP");
          assert.equal(where.stoppedAt, null, "CI133_WRITE_STOP");
        } else if (table === "timeEntry" && method === "create") {
          assert.equal(probe.payment, false, "CI133_WRITE_STOP"); assert.equal(data.taskId, probe.taskId, "CI133_WRITE_STOP");
          assert.equal(data.userId, probe.workerId, "CI133_WRITE_STOP");
        } else if (table === "payrollEntry" && method === "create") {
          assert.equal(probe.payment, false, "CI133_WRITE_STOP");
          assert.equal(data?.userId, probe.workerId); assert.equal(data?.taskId, probe.taskId);
          assert.equal(data?.workId, probe.workId); assert.equal(data?.projectId, probe.projectId); assert.equal(data?.scheme, "PIECE");
          assert.equal(data?.currency, "BYN"); assert.equal(String(data?.amount), "100.00"); assert.equal(String(data?.bynAmount), "100.00");
        } else if (table === "payment" && method === "create") {
          assert.equal(probe.payment, true, "CI133_WRITE_STOP");
          assert.equal(data?.createdById, probe.actor.id); assert.equal(data?.cashAccountId, probe.cashId);
          assert.equal(data?.currency, "BYN"); assert.equal(data?.projectId, null); assert.equal(data?.direction, "INCOME");
          assert.equal(String(data?.amount), "100.25"); assert.equal(String(data?.bynAmount), "100.25");
        } else if (table === "changeLog" && method === "create") {
          assert.equal(data?.actorId, probe.actor.id); assert.equal(data?.entity, probe.payment ? "payment" : "task");
          assert.equal(data?.entityId, probe.payment ? probe.paymentId : probe.taskId);
          if (data.action === "task.status.request" || data.action === "request") {
            assert.equal(data.action, probe.payment ? "request" : "task.status.request", "CI133_WRITE_STOP");
            assert.equal(typeof probe.receiptId, "string", "CI133_WRITE_STOP"); assert.equal(data.id, probe.receiptId, "CI133_WRITE_STOP");
          } else assert.ok(["time", "status", "create"].includes(String(data.action)), "CI133_WRITE_STOP");
        } else if (table === "domainEvent" && method === "create") {
          assert.equal(data?.actor, probe.actor.id); assert.equal(data?.type, probe.payment ? "payment.created" : "task.statusChanged");
        } else assert.fail("CI133_WRITE_STOP");
        if (method === "create") {
          // Прежний manifest давал один фиксированный ID каждому kind/action; лишнее create отклоняется до SQL.
          const key = table === "changeLog" ? `${table}:${data.action}` : table;
          assert.equal(probe.creates.has(key), false, "CI133_WRITE_STOP"); probe.creates.add(key);
        }
        probe.writes++;
        const receipt = table === "changeLog" && data?.action === "task.status.request";
        const fail = method === "create" && (table === "payrollEntry" && probe.fault === "payroll" ||
          table === "changeLog" && data?.action === "status" && probe.fault === "audit" ||
          table === "domainEvent" && probe.fault === "event" || receipt && probe.fault === "receipt");
        if (fail) {
          if (probe.payment) {
            assert.equal(await tx.payment.count({ where: { id: probe.paymentId } }), 1);
            assert.equal(await tx.changeLog.count({ where: { entityId: probe.paymentId, entity: "payment", action: "create" } }), 1);
          } else {
            assert.equal(await tx.task.count({ where: { id: probe.taskId, status: "DONE" } }), 1);
            assert.equal(await tx.timeEntry.count({ where: { taskId: probe.taskId, minutes: { gt: 0 } } }), 1);
            if (probe.fault !== "payroll") assert.equal(await tx.payrollEntry.count({ where: { taskId: probe.taskId } }), 1);
            if (probe.fault === "event" || probe.fault === "receipt") assert.equal(await tx.changeLog.count({ where: { entityId: probe.taskId, action: "status" } }), 1);
            if (probe.fault === "receipt") assert.equal(await tx.domainEvent.count({ where: { payload: { path: ["taskId"], equals: probe.taskId } } }), 1);
          }
          probe.partials++; throw Error("CI133_INJECTED_MANDATORY_WRITE");
        }
        const result = await Reflect.apply(value, model, args);
        if (method === "create") {
          assert.ok(result && typeof result === "object" && "id" in result && typeof result.id === "string");
          const ids = probe.owned[table[0].toUpperCase() + table.slice(1)] ??= [];
          if (!ids.includes(result.id)) ids.push(result.id);
        }
        if (table === "payment" && method === "create") {
          assert.ok(result && typeof result === "object" && "id" in result && typeof result.id === "string"); probe.paymentId = result.id;
        }
        return result;
      };
    } });
  } });
}

function commandTx(tx: Prisma.TransactionClient, context: Context): Prisma.TransactionClient {
  return new Proxy(tx, { get(db, key) {
    if (key === "$queryRaw") return async (...args: unknown[]) => {
      const sql = Array.isArray(args[0]) ? args[0].join("") : "";
      const locked = /pg_advisory_xact_lock\(18435,\s*55001\)|FROM "Project".*FOR UPDATE/.test(sql);
      const pid = locked && (context.onRequested || context.onHeld)
        ? (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0].pid : 0;
      if (locked) context.onRequested?.(pid);
      const value = await Reflect.apply(tx.$queryRaw, tx, args);
      if (locked) await context.onHeld?.(tx, pid);
      return value;
    };
    if (key === "timeEntry" && context.onTimerLookup) return new Proxy(db.timeEntry, { get(model, method) {
      if (method === "findMany") return async (...args: unknown[]) => {
        const rows: { id: string }[] = await Reflect.apply(model.findMany, model, args);
        await context.onTimerLookup?.(tx, rows); return rows;
      };
      const value = Reflect.get(model, method); return typeof value === "function" ? value.bind(model) : value;
    } });
    if (key === "changeLog" && context.failAuditId) return new Proxy(db.changeLog, { get(model, method) {
      if (method === "create") return async (...args: unknown[]) => {
        if ((args[0] as Prisma.ChangeLogCreateArgs).data.action === "update") await context.beforeAudit?.(tx);
        const value = await Reflect.apply(model.create, model, args);
        // Настоящая SQL unique-ошибка после записи audit; enclosing transaction обязан откатить всё.
        await tx.changeLog.create({ data: { id: context.failAuditId, actorType: "user", actorId: context.actor.id, entity: "test", entityId: "ci169", action: "collision" } });
        return value;
      };
      const value = Reflect.get(model, method); return typeof value === "function" ? value.bind(model) : value;
    } });
    const value = Reflect.get(db, key); return typeof value === "function" ? value.bind(db) : value;
  } });
}
before(async () => {
  fixture = await createPostgresFixture("domain");
  const facade = new Proxy({}, { get(_db, key) {
    const context = current(), value = Reflect.get(context.db, key);
    if (key === "$transaction" && typeof value === "function") return async (operation: (tx: Prisma.TransactionClient) => Promise<unknown>, options: unknown) => {
      const probe = context.mutation, proof = probe ? probe.calls++ > 0 : false, connection = proof ? fixture.peer : context.db;
      const result = await Reflect.apply(Reflect.get(connection, "$transaction"), connection, [async (tx: Prisma.TransactionClient) => {
        if (probe) {
          if (proof) await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
          const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
          if (proof) assert.ok(!probe.connections.some(row => !row.proof && row.pid === pid), "INDEPENDENT_COMMIT_PROOF_CONNECTION_REQUIRED");
          probe.connections.push({ proof, pid });
        }
        return operation(commandTx(probe ? mutationTx(tx, probe, proof) : tx, context));
      }, options]);
      // Потеря ACK вводится только ПОСЛЕ resolve настоящего SQL COMMIT.
      if (probe?.mode && !proof) throw Error("CI133_INJECTED_LOST_ACK_AFTER_COMMIT");
      return result;
    };
    return typeof value === "function" ? value.bind(context.db) : value;
  } });
  // Child targets загружаются раньше родителей: guardedModuleCache сохраняет installed entry каждого target.
  const names = ["transactions/coordinator", "time/timers", "access/visibility", "access/notification-visibility", "tasks/workspace-contract",
    "tasks/queries", "warehouse/unit-core", "warehouse/norm-core", "warehouse/queries", "products/core", "projects/stage-core", "projects/delete-core",
    "products/status-core", "products/queries", "projects/queries", "tasks/completion-core", "tasks/actions", "warehouse/actions", "time/actions", "payments/service"];
  const effect = (name: string) => () => { const probe = current().mutation; if (probe) { probe.effects.push(name); throw Error("CI133_INJECTED_OPTIONAL_EFFECT"); } };
  const overrides = { "../src/auth": { auth: async () => ({ user: current().actor }) },
    "next/cache": { revalidatePath: effect("cache"), revalidateTag: effect("cache") },
    "../src/server/plugins/events": { dispatchEvent: effect("dispatch"), emitDomainEvent: () => { throw Error("OUTSIDE_DOMAIN_EVENT_WRITE"); } },
    "../src/server/notifications/notify": { notifyOrg: effect("org"), notifyPerson: effect("person") } };
  scope = guardedModuleCache(new URL("../ci169-domain-scope.ts", import.meta.url).href,
    { targets: [...names.map(name => `../src/server/${name}`), "./helpers/project-materials-reference"], allowedOverrides: Object.keys(overrides), overrides, prisma: facade });
  coordinator = scope.load("../src/server/transactions/coordinator"); scope.load("../src/server/time/timers");
  visibility = scope.load("../src/server/access/visibility"); notifications = scope.load("../src/server/access/notification-visibility");
  workspace = scope.load("../src/server/tasks/workspace-contract"); taskQueries = scope.load("../src/server/tasks/queries");
  units = scope.load("../src/server/warehouse/unit-core"); norms = scope.load("../src/server/warehouse/norm-core"); warehouse = scope.load("../src/server/warehouse/queries");
  products = scope.load("../src/server/products/core"); stages = scope.load("../src/server/projects/stage-core"); deletion = scope.load("../src/server/projects/delete-core");
  statuses = scope.load("../src/server/products/status-core"); productQueries = scope.load("../src/server/products/queries"); scope.load("../src/server/projects/queries");
  completion = scope.load("../src/server/tasks/completion-core"); tasks = scope.load("../src/server/tasks/actions"); scope.load("../src/server/warehouse/actions"); time = scope.load("../src/server/time/actions");
  frozenReference = scope.load("./helpers/project-materials-reference");
  payments = scope.load("../src/server/payments/service");
});
after(async () => { if (fixture) try { scope?.restore(); await fixture.verifyProtected(); } finally { await fixture.dispose(); } });

async function people(rows: PostgresRows, tag: string) {
  const [manager, engineer, worker, mounter, admin] = await Promise.all([
    rows.user(`${tag}-manager`, ["MANAGER"]), rows.user(`${tag}-engineer`, ["ENGINEER"]),
    rows.user(`${tag}-worker`, ["WORKER"], { payScheme: "PIECE" }), rows.user(`${tag}-mounter`, ["MOUNTER"]), rows.user(`${tag}-admin`, ["ADMIN"]),
  ]);
  return { manager: actorOf(manager), engineer: actorOf(engineer), worker: actorOf(worker), mounter: actorOf(mounter), admin: actorOf(admin) };
}
async function tree(db: Db, rows: PostgresRows, tag: string, stage: ProjectStage = "CONTRACT", status: ProductStatus = "PRODUCTION") {
  const actors = await people(rows, tag), project = await rows.project(`${tag}-project`, { stage, managerId: actors.manager.id });
  const product = await rows.product(`${tag}-product`, project.id, { status, quantity: 5, expectedPrice: "200", engineerId: actors.engineer.id,
    assemblerId: actors.worker.id, mounterId: actors.mounter.id });
  const work = await db.work.create({ data: { id: rows.id(`${tag}-work`), projectId: project.id, productId: product.id, title: "Сборка",
    paymentKind: "LEGACY", quantity: "5", quantityPerUnit: "1", priceSnapshot: "30", total: "150" } });
  const unit = await db.materialUnit.create({ data: { id: rows.id(`${tag}-unit`), name: rows.id(`${tag}-unit`) } });
  const material = await db.material.create({ data: { id: rows.id(`${tag}-material`), name: "Петли", unitId: unit.id, purchasePrice: "2" } });
  return { ...actors, project, product, work, unit, material };
}
async function warehouseState(tx: Prisma.TransactionClient, rows: PostgresRows, phase = "ACTIVE") {
  return tx.warehouseAccountingState.upsert({ where: { id: "main" }, create: { id: "main", phase, runId: rows.id("warehouse-run"), beforePrices: [], beforeBalances: [] }, update: { phase } });
}
const transactionIn = (tx: Prisma.TransactionClient) => async <T>(operation: (db: Prisma.TransactionClient) => Promise<T>) => {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)`; return operation(tx);
};
async function fence(label: string) {
  const marker = fixture.id(label); await current().db.$queryRaw`SELECT ${marker}::text AS "ci169Fence"`;
  const deadline = performance.now() + 5000;
  while (!fixture.queryEvents.some(event => event.query.includes('"ci169Fence"') && event.params.includes(marker))) {
    assert.ok(performance.now() < deadline, "REAL_QUERY_TRACE_REQUIRED"); await new Promise(resolve => setTimeout(resolve, 1));
  }
  return fixture.queryEvents.findLastIndex(event => event.query.includes('"ci169Fence"') && event.params.includes(marker));
}
const realTransaction = (db: PrismaClient) => async <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) =>
  db.$transaction(tx => operation(commandTx(tx, current())), { timeout: 15_000, maxWait: 5000 });
async function overlap<A, B>(actor: DomainActor, firstOperation: () => Promise<A>, secondOperation: () => Promise<B>, timerLock = false) {
  const ready = gate(), requested = gate(), release = gate(); let holder: Prisma.TransactionClient | undefined, holderPid = 0, waiterPid = 0;
  const first = run(actor, fixture.db, firstOperation, { onHeld: async (tx, pid) => { holder = tx; holderPid = pid; ready.resolve(); await release.promise; } });
  void first.catch(() => {}); let second: Promise<B> | undefined;
  try {
    await Promise.race([ready.promise, first.then(() => assert.fail("REAL_HELD_LOCK_REQUIRED"))]);
    second = run(actor, fixture.peer, secondOperation, { onRequested: pid => { waiterPid = pid; requested.resolve(); } });
    void second.catch(() => {});
    await Promise.race([requested.promise, second.then(() => assert.fail("REAL_WAITING_QUERY_REQUIRED"))]);
    assert.ok(holder && holderPid > 0 && waiterPid > 0 && holderPid !== waiterPid);
    const deadline = performance.now() + 5000; let witnessed = false;
    while (!witnessed && performance.now() < deadline) {
      const [row] = await holder.$queryRaw<{ waiting: boolean }[]>`SELECT ${holderPid}::int4 = ANY(pg_blocking_pids(${waiterPid}::int4)) AS waiting`;
      witnessed = row.waiting; if (!witnessed) await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(witnessed, true, "DISTINCT_BACKENDS_HELD_LOCK_AND_ACTUAL_WAITER");
    if (timerLock) {
      const locks = await holder.$queryRaw<{ pid: number; locktype: string; database: number; classid: number;
        objid: number; objsubid: number; mode: string; granted: boolean }[]>`SELECT pid,locktype,database::integer AS database,classid::integer AS classid,
          objid::integer AS objid,objsubid,mode,granted
          FROM pg_locks WHERE pid IN (${holderPid}::int4,${waiterPid}::int4) AND locktype='advisory'`;
      assert.equal(locks.length, 2);
      assert.ok(locks.every(row => row.locktype === "advisory" && row.classid === 18435 && row.objid === 55001 &&
        row.objsubid === 2 && row.mode === "ExclusiveLock" && Number.isSafeInteger(row.database) && row.database > 0));
      const granted = locks.find(row => row.pid === holderPid && row.granted), waiting = locks.find(row => row.pid === waiterPid && !row.granted);
      assert.ok(granted && waiting); assert.equal(granted.database, waiting.database);
    }
    release.resolve(); return await Promise.all([first, second]);
  } finally { release.resolve(); await Promise.allSettled([first, ...(second ? [second] : [])]); }
}

test("draft/bootstrap-history-defaults-numbering-and-stage-promotion", async () => fixture.rollback(async (tx, rows) => {
  const actors = await people(rows, "bootstrap");
  for (const stage of ["LEAD", "ESTIMATE", "CONTRACT", "IN_WORK", "DONE", "RECLAMATION"] as const) {
    const project = await rows.project(`stage-${stage.toLowerCase().replaceAll("_", "-")}`, { stage }), result = await products.createProductCore(actors.manager,
      { projectId: project.id, title: "Новое", quantity: 3, expectedPrice: 123.45 }, transactionIn(tx));
    assert.equal(result.ok, true); if (!result.ok) assert.fail("PRODUCT_CREATE_REQUIRED");
    const expected = stage === "LEAD" || stage === "ESTIMATE" ? "DRAFT" : "PREPARATION";
    assert.equal(result.product.status, expected); assert.equal(result.product.number, `${project.number}.1`);
    assert.equal((await tx.productStatusHistory.findFirstOrThrow({ where: { productId: result.product.id } })).toStatus, expected);
    assert.equal(await tx.productPercentageConfig.count({ where: { productId: result.product.id } }), 3);
    assert.equal(await tx.payrollEntry.count({ where: { productId: result.product.id } }), 0);
  }
  for (const stage of ["PAUSED", "REFUSED"] as const) for (const prior of ["ESTIMATE", "CONTRACT", null] as const) {
    const project = await rows.project(`held-${stage.toLowerCase()}-${prior?.toLowerCase() ?? "none"}`, { stage });
    if (prior) await tx.projectStageHistory.createMany({ data: [
      { projectId: project.id, fromStage: "LEAD", toStage: "ESTIMATE", createdAt: new Date(0) },
      { projectId: project.id, fromStage: prior, toStage: stage, createdAt: new Date(1) },
    ] });
    const result = await products.createProductCore(actors.manager, { projectId: project.id, title: "Импорт" }, transactionIn(tx));
    assert.equal(result.ok && result.product.status, prior === "CONTRACT" ? "PREPARATION" : "DRAFT");
  }
  const c = await tree(tx, rows, "promote", "ESTIMATE", "DRAFT");
  const design = await rows.product("existing-design", c.project.id, { status: "DESIGN", quantity: 5, expectedPrice: "250" });
  const deleted = await rows.product("deleted-draft", c.project.id, { status: "DRAFT", deletedAt: new Date(0) });
  const before = await tx.product.findMany({ where: { projectId: c.project.id }, orderBy: { id: "asc" } });
  const input = { projectId: c.project.id, expectedStage: "ESTIMATE", toStage: "CONTRACT", clientMutationId: randomUUID() };
  const result = await stages.patchProjectStageTransaction(c.manager, input, tx); assert.equal(result.result.ok, true);
  assert.equal((await tx.product.findUniqueOrThrow({ where: { id: c.product.id } })).status, "PREPARATION");
  assert.equal((await tx.product.findUniqueOrThrow({ where: { id: design.id } })).status, "DESIGN");
  assert.equal((await tx.product.findUniqueOrThrow({ where: { id: deleted.id } })).status, "PREPARATION");
  const afterRows = await tx.product.findMany({ where: { projectId: c.project.id }, orderBy: { id: "asc" } });
  const business = ({ status: _status, statusChangedAt: _changed, updatedAt: _updated, ...row }: typeof c.product) => { void _status; void _changed; void _updated; return row; };
  assert.deepEqual(afterRows.map(business), before.map(business));
  assert.equal(await tx.productStatusHistory.count({ where: { productId: c.product.id } }), 1);
  assert.equal(await tx.productStatusHistory.count({ where: { productId: deleted.id, fromStatus: "DRAFT", toStatus: "PREPARATION" } }), 1);
  assert.equal(result.eventIds.length, 3);
  assert.equal(await tx.productPercentageCompletion.count({ where: { productId: { in: [c.product.id, deleted.id] } } }), 0);
  assert.equal(await tx.payrollEntry.count({ where: { productId: { in: [c.product.id, deleted.id] } } }), 0);
  const later = await rows.product("imported-after-receipt", c.project.id, { status: "DRAFT" });
  assert.equal((await stages.patchProjectStageTransaction(c.manager, input, tx)).result.replayed, true);
  assert.equal((await stages.patchProjectStageTransaction(c.manager, { ...input, expectedStage: "CONTRACT", clientMutationId: randomUUID() }, tx)).result.noOp, true);
  assert.equal((await tx.product.findUniqueOrThrow({ where: { id: later.id } })).status, "DRAFT");
  const stale = await stages.patchProjectStageTransaction(c.manager, { ...input, clientMutationId: randomUUID() }, tx);
  assert.equal(stale.result.kind, "conflict");
  for (const [from, to] of [["CONTRACT", "LEAD"], ["LEAD", "ESTIMATE"], ["ESTIMATE", "IN_WORK"]] as const) {
    assert.equal((await stages.patchProjectStageTransaction(c.manager, { ...input, expectedStage: from, toStage: to, clientMutationId: randomUUID() }, tx)).result.ok, true);
    assert.equal((await tx.product.findUniqueOrThrow({ where: { id: later.id } })).status, "DRAFT");
  }
  const next = await products.createProductCore(c.manager, { projectId: c.project.id, title: "Номер после удалённого" }, transactionIn(tx));
  assert.equal(next.ok, true); if (next.ok) assert.ok(next.product.suffixInt! > deleted.suffixInt!);
}));

test("draft/privacy-real-readers-joins-notifications-and-operational-denials", async () => fixture.rollback(async (tx, rows) => {
  const c = await tree(tx, rows, "privacy", "ESTIMATE", "DRAFT"), assigned = c.engineer.id;
  const task = await tx.task.create({ data: { projectId: c.project.id, productId: c.product.id, workId: c.work.id, assigneeId: assigned, title: "Черновая задача", quantity: "1" } });
  const files = await Promise.all([true, false].map(direct => tx.file.create({ data: { projectId: c.project.id, productId: direct ? c.product.id : null,
    taskId: direct ? null : task.id, fileName: "draft.pdf", storedName: randomUUID(), mimeType: "application/pdf", size: 1, uploadedById: assigned } })));
  for (const roles of [["MANAGER"], ["MANAGER", "ENGINEER"], ["MANAGER", "WORKER"], ["ENGINEER"], ["ACCOUNTANT"], ["PROCUREMENT"],
    ["WORKER"], ["MOUNTER"], ["ACCOUNTANT", "ENGINEER"], ["ADMIN"], ["DIRECTOR"]] as Role[][]) {
    const actor = { ...c.engineer, roles }, allowed = roles.includes("ADMIN") || roles.includes("DIRECTOR");
    const checks = [tx.product.count({ where: { AND: [{ id: c.product.id }, visibility.productVisibilityWhere(actor)] } }),
      tx.task.count({ where: { AND: [{ id: task.id }, visibility.taskVisibilityWhere(actor)] } }),
      tx.task.count({ where: { AND: [{ id: task.id }, visibility.taskExecutionWhere(actor)] } }),
      tx.work.count({ where: { AND: [{ id: c.work.id }, visibility.workVisibilityWhere(actor)] } }),
      tx.file.count({ where: { AND: [{ id: { in: files.map(row => row.id) } }, visibility.fileVisibilityWhere(actor)] } })];
    assert.deepEqual(await Promise.all(checks), [allowed ? 1 : 0, allowed ? 1 : 0, allowed ? 1 : 0, allowed ? 1 : 0, allowed ? 2 : 0]);
    await run(actor, tx, async () => {
      for (const key of [c.product.id, c.product.number]) assert.equal(Boolean(await productQueries.getProductFor(actor.id, roles, key)), allowed);
      const selected = await productQueries.listProductOptions(c.project.id, actor); assert.equal(selected.some(row => row.id === c.product.id), allowed);
    });
  }
  await run(c.manager, tx, async () => {
    const message = { type: "product.statusChanged", title: "Черновой шкаф", body: "Secret", link: `/products/${c.product.id}` };
    const normal = { type: "project.stageChanged", title: "Договор", body: "Normal", link: `/projects/${c.project.id}` };
    const masked = await notifications.scopeNotificationContent(c.manager, [message, normal], tx as unknown as PrismaClient);
    assert.equal(JSON.stringify(masked[0]).includes("Черновой шкаф"), false); assert.deepEqual(masked[1], normal);
  });
  for (const actor of [c.manager, c.admin]) {
    assert.equal((await statuses.changeProductStatusTransaction(tx, actor, c.product.id, "PREPARATION")).ok, false);
  }
  await assert.rejects(norms.addMaterialNorm(tx, { productId: c.product.id, materialId: c.material.id, quantityPerUnit: 1 }, c.manager), /Изделие не найдено/);
  await stages.patchProjectStageTransaction(c.manager, { projectId: c.project.id, expectedStage: "ESTIMATE", toStage: "CONTRACT", clientMutationId: randomUUID() }, tx);
  await run(c.manager, tx, async () => assert.ok(await productQueries.getProductFor(c.manager.id, c.manager.roles, c.product.id)));
  assert.equal((await tx.product.findUniqueOrThrow({ where: { id: c.product.id } })).expectedPrice!.toFixed(2), "200.00");
  assert.equal((await tx.product.findUniqueOrThrow({ where: { id: c.product.id } })).quantity, 5);
}));

test("draft/create-contract-number-races-real-project-lock", async () => {
  const actors = await people(fixture, "draft-races");
  for (const direction of ["create-first", "contract-first"] as const) {
    const project = await fixture.project(direction, { stage: "ESTIMATE", managerId: actors.manager.id });
    const create = (db: PrismaClient) => products.createProductCore(actors.manager, { projectId: project.id, title: "Новый шкаф", quantity: 3, expectedPrice: 123.45 }, realTransaction(db));
    const contract = (db: PrismaClient) => realTransaction(db)(tx => stages.patchProjectStageTransaction(actors.manager,
      { projectId: project.id, expectedStage: "ESTIMATE", toStage: "CONTRACT", clientMutationId: randomUUID() }, tx));
    if (direction === "create-first") {
      const [created, changed] = await overlap(actors.manager, () => create(fixture.db), () => contract(fixture.peer));
      assert.equal(created.ok, true); assert.equal(changed.result.ok, true); if (created.ok) assert.equal(created.product.status, "DRAFT");
    } else {
      const [changed, created] = await overlap(actors.manager, () => contract(fixture.db), () => create(fixture.peer));
      assert.equal(changed.result.ok, true); assert.equal(created.ok, true); if (created.ok) assert.equal(created.product.status, "PREPARATION");
    }
    const product = await fixture.db.product.findFirstOrThrow({ where: { projectId: project.id } });
    assert.equal(product.status, "PREPARATION"); assert.equal(product.quantity, 3); assert.equal(product.expectedPrice!.toFixed(2), "123.45");
    assert.equal(await fixture.db.payrollEntry.count({ where: { projectId: project.id } }), 0);
    assert.equal(await fixture.db.productPercentageCompletion.count({ where: { productId: product.id } }), 0);
  }
  const project = await fixture.project("number-race", { stage: "ESTIMATE" });
  const created = await overlap(actors.manager,
    () => products.createProductCore(actors.manager, { projectId: project.id, title: "Один" }, realTransaction(fixture.db)),
    () => products.createProductCore(actors.manager, { projectId: project.id, title: "Два" }, realTransaction(fixture.peer)));
  assert.ok(created.every(row => row.ok));
  assert.deepEqual((await fixture.db.product.findMany({ where: { projectId: project.id }, orderBy: { suffixInt: "asc" } })).map(row => row.number), [`${project.number}.1`, `${project.number}.2`]);
});

test("delete/product-project-CAS-replay-live-children-timers-and-history", async () => fixture.rollback(async (tx, rows) => {
  const c = await tree(tx, rows, "delete"), task = await tx.task.create({ data: { projectId: c.project.id, productId: c.product.id, workId: c.work.id,
    assigneeId: c.worker.id, title: "История", quantity: "1", status: "DONE" } });
  await tx.payrollEntry.create({ data: { userId: c.worker.id, taskId: task.id, productId: c.product.id, amount: "100", bynAmount: "100", month: "2020-01" } });
  const facts = await tx.payrollEntry.findMany({ where: { productId: c.product.id } });
  const baseline = { expectedUpdatedAt: c.product.updatedAt.toISOString(), clientMutationId: randomUUID() };
  for (const roles of [["ENGINEER"], ["ACCOUNTANT"], ["PROCUREMENT"]] as Role[][]) assert.equal((await products.deleteProductCore({ ...c.manager, roles }, c.product.id, transactionIn(tx), baseline)).ok, false);
  assert.equal((await products.deleteProductCore(c.manager, c.product.id, transactionIn(tx))).ok, false);
  const stale = await products.deleteProductCore(c.manager, c.product.id, transactionIn(tx), { ...baseline, expectedUpdatedAt: new Date(0).toISOString() });
  assert.equal(stale.ok, false); if (!stale.ok) assert.equal(stale.kind, "conflict");
  const active = await tx.timeEntry.create({ data: { taskId: task.id, userId: c.worker.id, source: "timer" } });
  const blocked = await products.deleteProductCore(c.manager, c.product.id, transactionIn(tx), baseline);
  assert.equal(blocked.ok, false); if (!blocked.ok) assert.equal(blocked.kind, "active-timer");
  await tx.timeEntry.update({ where: { id: active.id }, data: { stoppedAt: new Date(), minutes: 42 } });
  const deleted = await products.deleteProductCore({ ...c.manager, roles: ["MANAGER", "ENGINEER"] }, c.product.id, transactionIn(tx), baseline); assert.equal(deleted.ok, true);
  const repeat = await products.deleteProductCore(c.manager, c.product.id, transactionIn(tx), baseline); assert.equal(repeat.ok, true); if (repeat.ok) assert.equal(repeat.repeated, true);
  assert.deepEqual(await tx.payrollEntry.findMany({ where: { productId: c.product.id } }), facts);
  assert.equal(await tx.work.count({ where: { id: c.work.id } }), 1); assert.equal(await tx.task.count({ where: { id: task.id } }), 1);
  const prior = await tx.product.findUniqueOrThrow({ where: { id: c.product.id } });
  const sibling = await rows.product("live-delete-child", c.project.id, { status: "PRODUCTION" });
  const currentProject = await tx.project.findUniqueOrThrow({ where: { id: c.project.id } });
  const children = await tx.product.findMany({ where: { projectId: c.project.id } });
  assert.equal(deletion.projectProductsVersion(children), deletion.projectProductsVersion([...children].reverse()));
  const input = { projectId: c.project.id, expectedUpdatedAt: currentProject.updatedAt.toISOString(), expectedProductsVersion: deletion.projectProductsVersion(children), clientMutationId: randomUUID() };
  const conflict = await deletion.softDeleteProjectCore(tx, c.manager, { ...input, expectedProductsVersion: "f".repeat(64) });
  assert.equal(conflict.ok, false); if (!conflict.ok) assert.equal(conflict.kind, "conflict");
  assert.equal((await deletion.softDeleteProjectCore(tx, c.manager, input)).ok, true);
  assert.deepEqual(await tx.product.findUnique({ where: { id: prior.id } }), prior);
  assert.ok((await tx.product.findUniqueOrThrow({ where: { id: sibling.id } })).deletedAt);
  const projectReplay = await deletion.softDeleteProjectCore(tx, c.manager, input); assert.equal(projectReplay.ok, true); if (projectReplay.ok) assert.equal(projectReplay.repeated, true);
  assert.equal((await products.deleteProductCore(c.manager, prior.id, transactionIn(tx), baseline)).ok, false);
}));

test("quantity/locked-rescaling-group-floor-frozen-state-and-facts", async () => fixture.rollback(async (tx, rows) => {
  const c = await tree(tx, rows, "quantity"), group = await tx.taskAllocationGroup.create({ data: { workId: c.work.id, quantity: "4", budget: "120", currency: "BYN", createdById: c.manager.id } });
  await tx.task.createMany({ data: [c.worker, c.mounter].map(user => ({ projectId: c.project.id, productId: c.product.id, workId: c.work.id, title: "Доля", assigneeId: user.id,
    quantity: "4", allocationGroupId: group.id, shareUnits: 500000, shareAmount: "60" })) });
  const line = await tx.projectMaterial.create({ data: { productId: c.product.id, materialId: c.material.id, quantity: "20", quantityPerUnit: "4", issuedQty: "8" } });
  const history = await tx.timeEntry.create({ data: { taskId: (await tx.task.findFirstOrThrow({ where: { workId: c.work.id } })).id, userId: c.worker.id,
    source: "manual", minutes: 42, stoppedAt: new Date() } });
  const movement = await tx.stockMovement.create({ data: { materialId: c.material.id, productId: c.product.id, projectMaterialId: line.id, type: "EXPENSE", quantity: "8", unitPrice: "2", totalByn: "16" } });
  const pay = await tx.payrollEntry.create({ data: { userId: c.worker.id, productId: c.product.id, amount: "10", bynAmount: "10", month: "2020-01" } });
  const taskFacts = await tx.task.findMany({ where: { workId: c.work.id }, orderBy: { id: "asc" } });
  assert.equal((await products.updateProductCore(c.manager, c.product.id, { quantity: 6 }, { quantity: 5 }, transactionIn(tx))).ok, true);
  assert.equal((await tx.work.findUniqueOrThrow({ where: { id: c.work.id } })).quantity.toFixed(2), "6.00");
  assert.equal((await tx.work.findUniqueOrThrow({ where: { id: c.work.id } })).total!.toFixed(2), "180.00");
  assert.equal((await tx.projectMaterial.findUniqueOrThrow({ where: { id: line.id } })).quantity.toFixed(3), "24.000");
  assert.deepEqual(await tx.task.findMany({ where: { workId: c.work.id }, orderBy: { id: "asc" } }), taskFacts);
  assert.deepEqual(await tx.timeEntry.findUnique({ where: { id: history.id } }), history);
  assert.deepEqual(await tx.stockMovement.findUnique({ where: { id: movement.id } }), movement);
  assert.deepEqual(await tx.payrollEntry.findUnique({ where: { id: pay.id } }), pay);
  const baseline = await tx.product.findUniqueOrThrow({ where: { id: c.product.id } });
  for (const quantity of [0, -1, 1.5, 3]) assert.equal((await products.updateProductCore(c.manager, c.product.id, { quantity }, { quantity: 6 }, transactionIn(tx))).ok, false);
  assert.deepEqual(await tx.product.findUnique({ where: { id: c.product.id } }), baseline);
  assert.equal((await products.updateProductCore(c.engineer, c.product.id, { quantity: 7 }, { quantity: 6 }, transactionIn(tx))).ok, false);
  for (const phase of ["FROZEN", "VERIFYING"]) {
    await warehouseState(tx, rows, phase);
    const denied = await products.updateProductCore(c.manager, c.product.id, { quantity: 7 }, { quantity: 6 }, transactionIn(tx));
    assert.equal(denied.ok, false); assert.match(denied.error!, /Склад временно закрыт/);
  }
  await warehouseState(tx, rows, "ACTIVE");
  assert.equal((await products.updateProductCore(c.manager, c.product.id, { quantity: 4 }, { quantity: 6 }, transactionIn(tx))).ok, true);
  assert.equal((await tx.work.findUniqueOrThrow({ where: { id: c.work.id } })).quantity.toFixed(2), "4.00");
  assert.equal((await tx.projectMaterial.findUniqueOrThrow({ where: { id: line.id } })).quantity.toFixed(3), "16.000");
  await norms.addMaterialNorm(tx, { productId: c.product.id, materialId: c.material.id, quantityPerUnit: 1 }, c.manager);
  assert.equal((await tx.projectMaterial.findUniqueOrThrow({ where: { id: line.id } })).quantityPerUnit!.toFixed(3), "5.000");
  await assert.rejects(norms.updateMaterialNorm(tx, { id: line.id, quantityPerUnit: 1 }, c.manager), /выданного/);
  await norms.updateMaterialNorm(tx, { id: line.id, quantityPerUnit: 2 }, c.manager);
  assert.equal((await tx.projectMaterial.findUniqueOrThrow({ where: { id: line.id } })).quantity.toFixed(3), "8.000");
  assert.equal((await tx.projectMaterial.findUniqueOrThrow({ where: { id: line.id } })).issuedQty.toFixed(3), "8.000");
}));

test("task/workspace-31-scope-ACL-counts-10000-foreign-constant-SQL-and-EXPLAIN", async t => fixture.rollback(async (tx, rows) => {
  const before = await nativeSnapshot(tx);
  const own = await rows.user("workspace-own", ["ENGINEER", "WORKER"]), foreignUser = await rows.user("workspace-foreign", ["ENGINEER", "WORKER"]);
  const projects = await Promise.all(["own", "foreign", "deleted"].map((label, index) => rows.project(`workspace-${label}`, {
    stage: "IN_WORK", managerId: own.id, ...(index === 2 ? { deletedAt: new Date(0) } : {}),
  })));
  const products = await Promise.all([
    { status: "DESIGN" as const, engineerId: own.id }, { status: "PRODUCTION" as const, engineerId: own.id },
    { status: "DRAFT" as const }, { status: "PRODUCTION" as const, deletedAt: new Date(0) },
    { status: "PRODUCTION" as const, engineerId: foreignUser.id }, { status: "PRODUCTION" as const },
  ].map((fields, index) => rows.product(`workspace-product-${index}`, projects[index === 4 ? 1 : index === 5 ? 2 : 0].id,
    { ...fields, assemblerId: index === 4 ? foreignUser.id : own.id })));
  const pools = await Promise.all(products.slice(0, 2).map(product => tx.productStagePayPool.create({ data: {
    id: rows.id(`workspace-pool-${product.status.toLowerCase()}`), productId: product.id, kind: "ENGINEERING", state: "DRAFT", createdById: own.id,
  } })));
  const works = await Promise.all(products.map((product, index) => tx.work.create({ data: {
    id: rows.id(`workspace-work-${index}`), projectId: product.projectId, productId: product.id, title: "Проверка147",
    quantity: "1", priceSnapshot: "0", total: "0", paymentKind: index === 0 ? "ENGINEERING" : "LEGACY",
    stagePayPoolId: index === 0 ? pools[0].id : null, poolWeightUnits: index === 0 ? 1_000_000 : null,
  } })));
  const unpriced = await tx.work.create({ data: { id: rows.id("workspace-work-unpriced"), projectId: projects[0].id,
    productId: products[1].id, title: "Без расценки", quantity: "1", paymentKind: "ENGINEERING", stagePayPoolId: pools[1].id, poolWeightUnits: 1_000_000 } });
  const unbound = await tx.work.create({ data: { id: rows.id("workspace-work-unbound"), projectId: projects[0].id,
    title: "Без изделия", quantity: "1", priceSnapshot: "0", total: "0", paymentKind: "LEGACY" } });
  const groups = await Promise.all(([
    { workId: unpriced.id, budget: "17.89", currency: "BYN" }, { workId: null, budget: "17.89", currency: "BYN" },
    { workId: unpriced.id, budget: null, currency: null, budgetSource: "STAGE_PREVIEW" },
  ] as const).map((fields, index) => tx.taskAllocationGroup.create({ data: { ...fields, id: rows.id(`workspace-group-${index}`), quantity: "1", createdById: own.id } })));
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const task = (label: string, patch: Partial<Prisma.TaskCreateManyInput> = {}): Prisma.TaskCreateManyInput => ({
    id: rows.id(label), projectId: projects[0].id, productId: products[0].id, workId: works[0].id,
    assigneeId: own.id, title: "Поиск147", quantity: "1", dueAt: today, ...patch,
  });
  const variants = [
    task("workspace-zero"), task("workspace-production", { productId: products[1].id, workId: works[1].id }),
    task("workspace-other-assignee", { productId: products[1].id, workId: works[1].id, assigneeId: foreignUser.id }),
    task("workspace-draft", { productId: products[2].id, workId: works[2].id }),
    task("workspace-frozen", { productId: products[1].id, workId: unpriced.id, allocationGroupId: groups[0].id, shareUnits: 1_000_000, shareAmount: "17.89" }),
    task("workspace-done", { status: "DONE" }), task("workspace-no-date", { dueAt: null }),
    task("workspace-orphan", { productId: null, workId: null, allocationGroupId: groups[1].id, shareUnits: 1_000_000, shareAmount: "17.89" }),
    task("workspace-no-work", { workId: null }), task("workspace-unbound-work", { workId: unbound.id }),
    task("workspace-cross-product", { workId: works[1].id }), task("workspace-cross-project", { workId: works[4].id }),
    task("workspace-cross-parent", { productId: products[4].id, workId: works[4].id }),
    task("workspace-deleted-product", { productId: products[3].id, workId: works[3].id }),
    task("workspace-deleted-project", { projectId: projects[2].id, productId: products[5].id, workId: works[5].id }),
    task("workspace-no-assignee", { assigneeId: null }), task("workspace-unknown-price", { productId: products[1].id, workId: unpriced.id }),
    task("workspace-frozen-no-amount", { productId: products[1].id, workId: unpriced.id, allocationGroupId: groups[2].id, shareUnits: 1_000_000, stageShareUnits: 1_000_000 }),
  ];
  await tx.task.createMany({ data: variants });
  const foreign = (index: number) => task(`workspace-foreign-task-${index}`, { projectId: projects[1].id,
    productId: products[4].id, workId: works[4].id, assigneeId: foreignUser.id, title: "Чужая147" });
  await tx.task.create({ data: foreign(0) });
  const admin = { ...actorOf(own), roles: ["ADMIN"] as Role[] };
  const probe = () => run(admin, tx, async () => {
    const begin = await fence("workspace-probe-begin");
    const where = await taskQueries.taskWorkspaceWhere(admin, { projectId: projects[0].id });
    const selected = await tx.task.findMany({ where, select: { id: true, projectId: true }, orderBy: { id: "asc" } });
    const end = await fence("workspace-probe-end"), queries = fixture.queryEvents.slice(begin + 1, end);
    assert.equal(queries.length, 2, "EXPECTED_COORDINATE_AND_FINAL_SQL");
    return { queries, profile: { rows: selected, predicateBytes: Buffer.byteLength(JSON.stringify(where)),
      queryBytes: queries.map(event => Buffer.byteLength(event.query)), parameterBytes: queries.map(event => Buffer.byteLength(event.params)) } };
  });
  const small = await probe(), additionalForeign = Array.from({ length: 9999 }, (_, index) => foreign(index + 1));
  await tx.task.createMany({ data: additionalForeign });
  const large = await probe();
  assert.deepEqual(large.profile, small.profile, "FOREIGN_TASKS_CHANGED_SCOPED_RESULT_OR_QUERY_SIZE");
  type Plan = { "Node Type"?: string; "Relation Name"?: string; "Index Name"?: string; "Plan Rows"?: number; "Total Cost"?: number; Plans?: Plan[] };
  const safePlan = (node: Plan): unknown => ({ node: node["Node Type"], relation: node["Relation Name"], index: node["Index Name"],
    estimatedRows: node["Plan Rows"], cost: node["Total Cost"], children: node.Plans?.map(safePlan) });
  const plans = [];
  for (const event of large.queries) {
    assert.match(event.query, /^SELECT\s/i, "EXPLAIN_SELECT_ONLY");
    const parameters = JSON.parse(event.params) as unknown[];
    assert.ok(parameters.every(value => value === null || ["string", "number", "boolean"].includes(typeof value)), "EXPLAIN_SCALAR_PARAMETERS_REQUIRED");
    const result = await tx.$queryRawUnsafe<{ "QUERY PLAN": { Plan: Plan }[] }[]>("EXPLAIN (FORMAT JSON) " + event.query, ...parameters);
    plans.push(safePlan(result[0]["QUERY PLAN"][0].Plan));
  }
  // Независимый SQL baseline сохраняет прежний JOIN, включая несовпадающие связи fixture.
  const legacy = await tx.$queryRaw<{ id: string }[]>`
    SELECT t.id FROM "Task" t
    JOIN "Work" w ON w.id=t."workId" AND w."projectId"=t."projectId" AND w."productId"=t."productId"
    JOIN "Product" p ON p.id=t."productId" AND p.id=w."productId" AND p."projectId"=t."projectId"
    JOIN "Project" j ON j.id=t."projectId"
    WHERE t."assigneeId" IS NOT NULL AND p."deletedAt" IS NULL AND j."deletedAt" IS NULL
      AND (w."priceSnapshot" IS NOT NULL OR (t."allocationGroupId" IS NOT NULL AND t."shareAmount" IS NOT NULL))
    ORDER BY t.id`;
  const baseline: Prisma.TaskWhereInput = { AND: [workspace.taskWorkspaceBindings, { id: { in: legacy.map(row => row.id) } }] };
  let matrixCases = 0;
  for (const roles of [["ADMIN"], ["MANAGER"], ["PROCUREMENT"], ["ENGINEER"], ["WORKER"], ["WORKER", "ACCOUNTANT"], ["ENGINEER", "ACCOUNTANT"], ["ACCOUNTANT"], []] as Role[][]) {
    const actor = await visibility.resolveVisibilityActor(tx, { id: own.id, roles });
    const projectIds = projects.slice(0, 2).map(project => project.id);
    const scopes: [string, Parameters<typeof taskQueries.taskWorkspaceWhere>[1], Prisma.TaskWhereInput][] = [
      ["project", { projectId: projects[0].id }, { projectId: projects[0].id }],
      ["product", { productKey: products[0].id }, { productId: products[0].id }],
      ["selected-projects", { projectIds }, { projectId: { in: projectIds } }],
    ];
    if (roles[0] === "ADMIN") {
      const search = { title: { contains: "Поиск147", mode: "insensitive" as const } };
      scopes.push(["product-number", { productKey: products[0].number }, { productId: products[0].id }],
        ["search", { tasks: search }, search], ["my", { tasks: { assigneeId: own.id } }, { assigneeId: own.id }], ["global", { tasks: {} }, {}]);
    }
    await run({ ...actorOf(own), roles }, tx, async () => {
      for (const [name, limit, expectedLimit] of scopes) {
        const where = await taskQueries.taskWorkspaceWhere(actor, limit);
        const expected = await tx.task.findMany({ where: { AND: [baseline, expectedLimit, visibility.taskVisibilityWhere(actor)] }, select: { id: true, projectId: true }, orderBy: { id: "asc" } });
        const actual = await tx.task.findMany({ where, select: { id: true, projectId: true }, orderBy: { id: "asc" } });
        assert.deepEqual(actual, expected, `NATIVE_SCOPE_OR_ACL_MISMATCH:${roles.join("+") || "EMPTY"}:${name}`);
        if (name === "selected-projects") {
          const counts = await tx.task.groupBy({ by: ["projectId"], where, _count: { _all: true } });
          for (const projectId of projectIds) assert.equal(counts.find(row => row.projectId === projectId)?._count._all ?? 0, expected.filter(row => row.projectId === projectId).length, "SELECTED_COUNT_MISMATCH");
        }
        matrixCases++;
      }
    });
  }
  assert.equal(matrixCases, 31);
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
  const dashboard = { status: { not: "DONE" as const }, dueAt: { lte: todayEnd }, project: { deletedAt: null } };
  const dashboardCount = await tx.task.count({ where: await workspace.taskWorkspaceEligibility(tx, { tasks: dashboard }) });
  assert.equal(dashboardCount, await tx.task.count({ where: { AND: [baseline, dashboard] } }), "DASHBOARD_COUNT_MISMATCH");
  assert.equal(await tx.task.count({ where: await workspace.taskWorkspaceEligibility(tx, { projectIds: [] }) }), 0, "EMPTY_SCOPE_DENY_REQUIRED");
  const owned = nativeOwnedIds({ User: [own.id, foreignUser.id], Client: projects.map(project => project.clientId), Project: projects.map(project => project.id),
    Product: products.map(product => product.id), Work: [...works, unpriced, unbound].map(work => work.id), ProductStagePayPool: pools.map(pool => pool.id),
    TaskAllocationGroup: groups.map(group => group.id), Task: [...variants, foreign(0), ...additionalForeign].map(row => row.id!) });
  assert.deepEqual(await nativeSnapshot(tx, owned), before, "ORIGINAL_CHANGED_INSIDE_FIXTURE_TX");
  t.diagnostic(JSON.stringify({ matrixCases, dashboardCount, foreignTasks: [1, 10000], profile: { ...large.profile, rows: large.profile.rows.length }, plans }));
}));

test("warehouse/unit-catalog-CRUD-current-admin-inactive-usage-and-unchanged-numbers", async () => fixture.rollback(async (tx, rows) => {
  const c = await tree(tx, rows, "units"), before = await tx.material.update({ where: { id: c.material.id }, data: { active: false, purchasePrice: "15.55" } });
  const name = `л-${rows.id("litre").slice(-18)}`;
  const created = await units.createMaterialUnitInTransaction(tx, c.admin, { name: `  ${name}  ` });
  assert.equal(created.name, name);
  await units.renameMaterialUnitInTransaction(tx, c.admin, c.unit.id, { name: `1/10-${rows.id("tenth-sheet").slice(-18)}` });
  assert.deepEqual(await tx.material.findUnique({ where: { id: c.material.id } }), before);
  await assert.rejects(units.deleteMaterialUnitInTransaction(tx, c.admin, c.unit.id), /используется/);
  for (const role of ["DIRECTOR", "MANAGER", "ENGINEER", "PROCUREMENT", "ACCOUNTANT", "WORKER", "MOUNTER"] as Role[]) {
    const actor = { ...c.admin, roles: [role] }, start = fixture.queryEvents.length;
    await assert.rejects(units.createMaterialUnitInTransaction(tx, actor, { name: "л" }), /только администратор/);
    await assert.rejects(units.renameMaterialUnitInTransaction(tx, actor, c.unit.id, { name: "л" }), /только администратор/);
    await assert.rejects(units.deleteMaterialUnitInTransaction(tx, actor, c.unit.id), /только администратор/);
    assert.equal(fixture.queryEvents.length, start, "ROLE_REFUSAL_BEFORE_REAL_SQL");
  }
  await tx.user.update({ where: { id: c.admin.id }, data: { roles: ["DIRECTOR"] } });
  await assert.rejects(units.createMaterialUnitInTransaction(tx, c.admin, { name: "л" }), /только администратор/);
  await tx.user.update({ where: { id: c.admin.id }, data: { roles: ["ADMIN"], active: false } });
  await assert.rejects(units.deleteMaterialUnitInTransaction(tx, c.admin, c.unit.id), /только администратор/);
  await tx.user.update({ where: { id: c.admin.id }, data: { active: true } });
  await tx.material.update({ where: { id: c.material.id }, data: { unitId: created.id } });
  await units.deleteMaterialUnitInTransaction(tx, c.admin, c.unit.id);
  assert.equal(await tx.materialUnit.findUnique({ where: { id: c.unit.id } }), null);
  await assert.rejects(units.renameMaterialUnitInTransaction(tx, c.admin, rows.id("missing"), { name: "л" }), /не найдена/);
  await assert.rejects(units.createMaterialUnitInTransaction(tx, c.admin, { name: "  " }));
  await rejectedSql(tx, () => tx.material.update({ where: { id: c.material.id }, data: { unitId: c.unit.id } }), /Foreign key constraint/);
}));

test("mutation/real-COMMIT-lost-ACK-UNKNOWN-readonly-peer-replay-and-five-partial-rollbacks", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-11T12:00:00Z").getTime() });
  const original = await nativeSnapshot(fixture.db);
  const c = await tree(fixture.db, fixture, "mutation133");
  await fixture.db.work.update({ where: { id: c.work.id }, data: { quantity: "10", quantityPerUnit: "2", priceSnapshot: "100", total: "1000" } });
  const accountant = actorOf(await fixture.user("mutation133-accountant", ["ACCOUNTANT"]));
  const cash = await fixture.db.cashAccount.create({ data: { id: fixture.id("mutation133-cash"), name: "Проверка133", currency: "BYN" } });
  const owned: Record<string, string[]> = { User: [c.manager.id, c.engineer.id, c.worker.id, c.mounter.id, c.admin.id, accountant.id],
    Client: [c.project.clientId], Project: [c.project.id], Product: [c.product.id], Work: [c.work.id], MaterialUnit: [c.unit.id], Material: [c.material.id], CashAccount: [cash.id], Task: [] };
  const task = async (label: string) => {
    const created = await fixture.db.task.create({ data: { id: fixture.id(`mutation133-${label}`), projectId: c.project.id,
      productId: c.product.id, workId: c.work.id, assigneeId: c.worker.id, quantity: "1", title: label, createdById: c.manager.id } });
    owned.Task.push(created.id); return created;
  };
  const makeProbe = (actor: DomainActor, taskId?: string, options: Pick<MutationProbe, "mode" | "fault"> = {}): MutationProbe => ({
    actor, taskId, workerId: c.worker.id, workId: c.work.id, projectId: c.project.id, cashId: cash.id, payment: !taskId,
    ...options, calls: 0, writes: 0, partials: 0, effects: [], connections: [], owned, creates: new Set(),
  });
  const status = (probe: MutationProbe, to: "IN_PROGRESS" | "DONE", context?: { clientMutationId: string; expectedActorId: string }) => {
    probe.receiptId = context ? `task-status:${context.clientMutationId}` : undefined;
    return run(probe.actor, fixture.db, () => completion.changeTaskStatusCore(probe.actor, probe.taskId!, to, to === "DONE" && probe.actor.id === c.manager.id ? 20 : undefined,
      coordinator.withMutationTransaction, context), { mutation: probe });
  };
  const capture = async (taskId: string) => {
    // Сначала независимая SELECT-проверка committed facts; UNKNOWN не инициирует новую запись.
    const observed = await fixture.peer.task.findUniqueOrThrow({ where: { id: taskId } });
    assert.equal(observed.status, "IN_PROGRESS");
    assert.equal(await fixture.peer.domainEvent.count({ where: { payload: { path: ["taskId"], equals: taskId } } }), 1);
    assert.equal(await fixture.peer.timeEntry.count({ where: { taskId } }), 1);
  };
  const startedTask = await task("started"), startContext = { clientMutationId: randomUUID(), expectedActorId: c.worker.id };
  const lost = makeProbe(c.worker, startedTask.id, { mode: "lost-ack" }), started = await status(lost, "IN_PROGRESS", startContext);
  assert.ok(started.ok); assert.equal(started.outcome, "COMMITTED"); assert.equal(started.resultId, startedTask.id); assert.equal(started.recovered, true); assert.equal(lost.calls, 2);
  assert.equal(lost.connections.length, 2); assert.equal(lost.connections[1].proof, true); assert.notEqual(lost.connections[0].pid, lost.connections[1].pid);
  t.mock.timers.tick(60_000);
  const done = await status(makeProbe(c.worker, startedTask.id), "DONE", { clientMutationId: randomUUID(), expectedActorId: c.worker.id });
  assert.ok(done.ok); assert.equal(done.payroll?.amount, "100.00");
  const completed = await nativeSnapshot(fixture.db), historicalProbe = makeProbe(c.worker, startedTask.id);
  const historical = await status(historicalProbe, "IN_PROGRESS", startContext);
  assert.ok(historical.ok && historical.repeated); assert.equal(historicalProbe.writes, 0); assert.deepEqual(await nativeSnapshot(fixture.db), completed);
  const switchedProbe = makeProbe(c.manager, startedTask.id), switched = await status(switchedProbe, "IN_PROGRESS", startContext);
  assert.ok(!switched.ok && switched.kind === "actor-changed"); assert.equal(switchedProbe.calls, 0); assert.equal(switchedProbe.writes, 0);
  const legacyTask = await task("legacy"), legacyProbe = makeProbe(c.manager, legacyTask.id, { mode: "lost-ack" });
  const legacy = await status(legacyProbe, "IN_PROGRESS");
  assert.ok(legacy.ok && legacy.recovered); assert.equal(legacy.resultId, legacyTask.id); assert.equal(legacyProbe.calls, 2);
  const uncertainTask = await task("unknown"), uncertainContext = { clientMutationId: randomUUID(), expectedActorId: c.manager.id };
  const uncertainProbe = makeProbe(c.manager, uncertainTask.id, { mode: "failed-proof" }), uncertain = await status(uncertainProbe, "IN_PROGRESS", uncertainContext);
  assert.ok(!uncertain.ok && uncertain.outcome === "UNKNOWN"); assert.equal(uncertainProbe.calls, 2);
  await capture(uncertainTask.id);
  const unknownBefore = await nativeSnapshot(fixture.db), verifyProbe = makeProbe(c.manager, uncertainTask.id);
  const verified = await status(verifyProbe, "IN_PROGRESS", uncertainContext);
  assert.ok(verified.ok && verified.repeated); assert.equal(verifyProbe.writes, 0); assert.deepEqual(await nativeSnapshot(fixture.db), unknownBefore);
  for (const fault of ["payroll", "audit", "event", "receipt"] as const) {
    const failedTask = await task(`fault-${fault}`), before = await nativeSnapshot(fixture.db), probe = makeProbe(c.manager, failedTask.id, { fault });
    await assert.rejects(status(probe, "DONE", { clientMutationId: randomUUID(), expectedActorId: c.manager.id }), /CI133_INJECTED_MANDATORY_WRITE/);
    assert.equal(probe.partials, 1); assert.equal(probe.calls, 2); assert.deepEqual(await nativeSnapshot(fixture.db), before);
  }
  const payment = (clientMutationId: string) => ({ direction: "INCOME" as const, amount: 100.25, currency: "BYN", cashAccountId: cash.id,
    comment: "Проверка133", paidAt: "2000-01-15", clientMutationId });
  const pay = (probe: MutationProbe, input: ReturnType<typeof payment>) => {
    probe.receiptId = `payment-request:${input.clientMutationId}`;
    return run(accountant, fixture.db, () => payments.createPaymentCore(accountant, input), { mutation: probe });
  };
  const paymentInput = payment(randomUUID()), paymentProbe = makeProbe(accountant, undefined, { mode: "lost-ack" }), paid = await pay(paymentProbe, paymentInput);
  assert.ok(paid.ok); assert.equal(paid.resultId, paid.paymentId); assert.equal(paid.paymentId, paymentProbe.paymentId); assert.equal(paid.outcome, "COMMITTED"); assert.equal(paymentProbe.calls, 2);
  assert.deepEqual(paymentProbe.effects, ["dispatch", "org", "cache", "cache", "cache", "cache"]);
  const paidBefore = await nativeSnapshot(fixture.db), replayProbe = makeProbe(accountant), paidAgain = await pay(replayProbe, paymentInput);
  assert.ok(paidAgain.ok && paidAgain.paymentId === paid.paymentId); assert.equal(replayProbe.calls, 0); assert.equal(replayProbe.writes, 0); assert.deepEqual(await nativeSnapshot(fixture.db), paidBefore);
  const unknownInput = payment(randomUUID()), unknownProbe = makeProbe(accountant, undefined, { mode: "failed-proof" }), unknownPayment = await pay(unknownProbe, unknownInput);
  assert.ok(!unknownPayment.ok && unknownPayment.outcome === "UNKNOWN"); assert.equal(unknownProbe.calls, 2); assert.equal(unknownProbe.effects.length, 0);
  const committedPayment = await fixture.peer.payment.findUniqueOrThrow({ where: { id: unknownProbe.paymentId } });
  assert.equal(committedPayment.amount.toFixed(2), "100.25"); assert.equal(committedPayment.bynAmount.toFixed(2), "100.25");
  assert.equal(committedPayment.createdById, accountant.id); assert.equal(committedPayment.cashAccountId, cash.id);
  const unknownPaymentBefore = await nativeSnapshot(fixture.db), inspectedProbe = makeProbe(accountant), inspected = await pay(inspectedProbe, unknownInput);
  assert.ok(inspected.ok && inspected.paymentId === committedPayment.id); assert.equal(inspectedProbe.writes, 0); assert.deepEqual(await nativeSnapshot(fixture.db), unknownPaymentBefore);
  const faultBefore = await nativeSnapshot(fixture.db), paymentFault = makeProbe(accountant, undefined, { fault: "event" }), refused = await pay(paymentFault, payment(randomUUID()));
  assert.ok(!refused.ok && refused.outcome === "ROLLED_BACK"); assert.equal(paymentFault.partials, 1); assert.equal(paymentFault.calls, 2); assert.deepEqual(await nativeSnapshot(fixture.db), faultBefore);
  assert.deepEqual(await nativeSnapshot(fixture.db, nativeOwnedIds(owned)), original, "MUTATION_ORIGINAL_DATA_SCHEMA_CHANGED");
  t.diagnostic(JSON.stringify({ independentCommitProofConnections: 2, lostAckRecovery: true, unknownInspectedBeforeReplay: true, rollbackFaults: 5, optionalEffects: paymentProbe.effects.length }));
});

test("task/create-ten-identical-receipts-collisions-revocation-deleted-ACK-and-SQL-rollback", async () => {
  const c = await tree(fixture.db, fixture, "commands");
  await fixture.db.work.update({ where: { id: c.work.id }, data: { quantity: "10", quantityPerUnit: "2", priceSnapshot: "100", total: "1000" } });
  const predecessor = await fixture.db.task.create({ data: { projectId: c.project.id, productId: c.product.id, title: "Предшественник", status: "DONE" } });
  const input = { clientMutationId: randomUUID(), expectedActorId: c.manager.id, projectId: c.project.id, productId: c.product.id,
    workId: c.work.id, assigneeId: c.worker.id, title: "Один запрос", type: "Производство", quantity: 1, dueAt: "2026-10-12", estimateMinutes: 10, dependencyIds: [predecessor.id] };
  const results = await Promise.all(Array.from({ length: 10 }, (_, index) => run(c.manager, index % 2 ? fixture.peer : fixture.db, () => tasks.createTask(input))));
  assert.ok(results.every(row => row.ok)); const first = results[0]; if (!first.ok) assert.fail("REAL_CREATE_ACK_REQUIRED");
  assert.ok(results.every(row => row.ok && row.resultId === first.resultId));
  const saved = await fixture.db.task.findUniqueOrThrow({ where: { id: first.resultId }, include: { dependencies: true } });
  assert.equal(saved.quantity!.toFixed(2), "1.00"); assert.deepEqual(saved.dependencies.map(row => row.dependsOnId), [predecessor.id]);
  assert.equal(await fixture.db.task.count({ where: { workId: c.work.id } }), 1);
  assert.equal(await fixture.db.changeLog.count({ where: { actorId: c.manager.id, action: "task.create.request" } }), 1);
  assert.equal(await fixture.db.domainEvent.count({ where: { actor: c.manager.id, type: "task.assigned" } }), 1);
  assert.equal((await run(c.manager, fixture.db, () => tasks.createTask({ ...input, quantity: 2 }))).ok, false);
  const other = actorOf(await fixture.user("other-command-manager", ["MANAGER"]));
  const switched = await run(other, fixture.db, () => tasks.createTask(input));
  assert.equal(switched.ok, false); if (!switched.ok) assert.equal(switched.kind, "actor-changed");
  assert.equal((await run(other, fixture.db, () => tasks.createTask({ ...input, expectedActorId: other.id }))).ok, false);
  await fixture.db.user.update({ where: { id: c.manager.id }, data: { roles: ["ENGINEER"] } });
  const revoked = await run(c.manager, fixture.db, () => tasks.createTask(input));
  assert.equal(revoked.ok, false); if (!revoked.ok) assert.equal(revoked.kind, "forbidden");
  await fixture.db.user.update({ where: { id: c.manager.id }, data: { roles: ["MANAGER"] } });
  const collision = await fixture.db.changeLog.create({ data: { id: fixture.id("audit-collision"), actorType: "user", actorId: c.manager.id, entity: "test", entityId: "ci169", action: "fixture" } });
  const failed = await run(c.manager, fixture.db, () => tasks.createTask({ ...input, title: "Откат audit", clientMutationId: randomUUID() }), { failAuditId: collision.id });
  assert.equal(failed.ok, false); assert.equal(failed.outcome, "ROLLED_BACK");
  assert.equal(await fixture.db.task.count({ where: { projectId: c.project.id, title: "Откат audit" } }), 0);
  assert.equal(await fixture.db.changeLog.count({ where: { actorId: c.manager.id, action: "create" } }), 1);
  const receipt = await fixture.db.changeLog.findUniqueOrThrow({ where: { id: `task-create:${input.clientMutationId}` } });
  await fixture.db.task.delete({ where: { id: saved.id } });
  const historical = await run(c.manager, fixture.db, () => tasks.createTask(input));
  assert.equal(historical.ok, true); assert.equal(historical.outcome, "COMMITTED");
  if (historical.ok) { assert.equal(historical.replayed, true); assert.equal(historical.resultId, saved.id); }
  assert.equal(await fixture.db.task.count({ where: { workId: c.work.id } }), 0);
  assert.deepEqual(await fixture.db.changeLog.findUnique({ where: { id: receipt.id } }), receipt);
  assert.equal(await fixture.db.domainEvent.count({ where: { actor: c.manager.id, type: "task.assigned" } }), 1);
});

test("task/status-real-receipts-start-after-DONE-and-changed-context-refusal", async () => {
  const c = await tree(fixture.db, fixture, "status-command"), task = await fixture.db.task.create({ data: { projectId: c.project.id,
    productId: c.product.id, workId: c.work.id, assigneeId: c.worker.id, title: "Статус", quantity: "1", status: "NEW" } });
  const start = { clientMutationId: randomUUID(), expectedActorId: c.worker.id };
  assert.equal((await run(c.worker, fixture.db, () => tasks.changeTaskStatus(task.id, "IN_PROGRESS", undefined, start))).ok, true);
  const done = { clientMutationId: randomUUID(), expectedActorId: c.manager.id };
  const committed = await run(c.manager, fixture.db, () => tasks.changeTaskStatus(task.id, "DONE", 20, done));
  assert.equal(committed.ok, true); assert.equal(committed.outcome, "COMMITTED");
  const frozen = await fixture.db.task.findUniqueOrThrow({ where: { id: task.id } }), payroll = await fixture.db.payrollEntry.findMany({ where: { taskId: task.id } });
  assert.equal(payroll.length, 1); assert.equal(payroll[0].amount.toFixed(2), "30.00");
  const replay = await run(c.worker, fixture.db, () => tasks.changeTaskStatus(task.id, "IN_PROGRESS", undefined, start));
  assert.equal(replay.ok, true); if (replay.ok) assert.equal(replay.replayed, true);
  assert.equal("task" in replay, false); assert.equal("status" in replay, false);
  assert.deepEqual(await fixture.db.task.findUnique({ where: { id: task.id } }), frozen);
  assert.deepEqual(await fixture.db.payrollEntry.findMany({ where: { taskId: task.id } }), payroll);
  assert.equal((await run(c.manager, fixture.db, () => tasks.changeTaskStatus(task.id, "DONE", 30, done))).ok, false);
  const other = await fixture.db.task.create({ data: { projectId: c.project.id, productId: c.product.id, workId: c.work.id, assigneeId: c.worker.id, title: "Другой", quantity: "1" } });
  assert.equal((await run(c.manager, fixture.db, () => tasks.changeTaskStatus(other.id, "DONE", 20, done))).ok, false);
});

test("timer/all-stop-switch-read-complete-reassign-routes-boundaries-and-closed-history", async t => {
  const instant = new Date("2026-10-11T12:00:00.000Z"); t.mock.timers.enable({ apis: ["Date"], now: instant.getTime() });
  const actors = await people(fixture, "timer-matrix"), project = await fixture.project("timer-matrix-project", { stage: "IN_WORK", managerId: actors.manager.id });
  const product = await fixture.product("timer-matrix-product", project.id, { status: "PRODUCTION", assemblerId: actors.worker.id });
  const recipient = actorOf(await fixture.user("timer-recipient", ["WORKER"], { payScheme: "PIECE" }));
  const task = async (label: string, quantity = "10") => {
    const work = await fixture.db.work.create({ data: { projectId: project.id, productId: product.id, title: label, quantity: "10", quantityPerUnit: "10", priceSnapshot: "100", total: "1000" } });
    return fixture.db.task.create({ data: { projectId: project.id, productId: product.id, workId: work.id, assigneeId: actors.worker.id, title: label,
      quantity, status: "IN_PROGRESS", estimateMinutes: 10, dueAt: new Date("2026-10-12T00:00:00.000Z") } });
  };
  const historicalTask = await task("История");
  const closed = await fixture.db.timeEntry.createManyAndReturn({ data: [
    ...[0, 1200].map(minutes => ({ taskId: historicalTask.id, userId: actors.worker.id, source: "timer", minutes, startedAt: new Date(0), stoppedAt: new Date(1) })),
    { taskId: historicalTask.id, userId: actors.worker.id, source: "manual", minutes: 1200, stoppedAt: new Date(1) },
  ] });
  for (const route of ["stop", "switch", "read", "complete", "reassign"] as const) for (const elapsed of [719, 720, 721, 1200]) {
    const source = await task(`${route}-${elapsed}`), start = new Date(instant.getTime() - elapsed * 60000);
    const row = await fixture.db.timeEntry.create({ data: { taskId: source.id, userId: actors.worker.id, source: "timer", startedAt: start } });
    if (route === "stop") assert.equal((await run(actors.worker, fixture.db, () => time.stopTimer())).ok, true);
    if (route === "switch") {
      const next = await task(`switch-next-${elapsed}`);
      assert.equal((await run(actors.worker, fixture.db, () => time.startTimer(next.id))).ok, true);
      assert.equal((await run(actors.worker, fixture.db, () => time.stopTimer())).ok, true);
    }
    if (route === "read") {
      const active = await run(actors.worker, fixture.db, () => time.getActiveTimer());
      assert.equal(active?.id ?? null, elapsed < 720 ? row.id : null);
      if (active) assert.equal((await run(actors.worker, fixture.db, () => time.stopTimer())).ok, true);
    }
    if (route === "complete") {
      const result = await run(actors.worker, fixture.db, () => completion.changeTaskStatusCore(actors.worker, source.id, "DONE", undefined, coordinator.withMutationTransaction));
      assert.equal(result.ok, true);
      const paid = await fixture.db.payrollEntry.findMany({ where: { taskId: source.id } }); assert.equal(paid.length, 1); assert.equal(paid[0].amount.toFixed(2), "1000.00");
    }
    if (route === "reassign") {
      const previous = await fixture.db.task.findUniqueOrThrow({ where: { id: source.id } });
      const input = { title: "Уточнено", dueAt: "2026-10-12", estimateMinutes: 15, assigneeId: recipient.id };
      assert.equal((await run(actors.manager, fixture.db, () => tasks.updateTask(source.id, input))).ok, true);
      const changed = await fixture.db.task.findUniqueOrThrow({ where: { id: source.id } }); assert.equal(changed.status, "IN_PROGRESS"); assert.equal(changed.assigneeId, recipient.id);
      const audit = await fixture.db.changeLog.findFirstOrThrow({ where: { entityId: source.id, action: "update" } });
      assert.deepEqual(audit.oldValue, JSON.parse(JSON.stringify({ title: previous.title, type: previous.type, assigneeId: previous.assigneeId, dueAt: previous.dueAt, status: previous.status })));
      assert.deepEqual(audit.newValue, { ...input, status: "IN_PROGRESS" });
      assert.equal(await fixture.db.timeEntry.count({ where: { taskId: source.id, stoppedAt: null } }), 0);
    }
    const saved = await fixture.db.timeEntry.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(saved.minutes, elapsed < 720 ? 719 : 720); assert.equal(saved.autoStopped, elapsed >= 720);
    assert.equal(saved.stoppedAt!.getTime(), elapsed >= 720 ? start.getTime() + 720 * 60000 : instant.getTime());
    assert.deepEqual(await fixture.db.timeEntry.findMany({ where: { id: { in: closed.map(item => item.id) } }, orderBy: { id: "asc" } }), [...closed].sort((a, b) => a.id.localeCompare(b.id)));
  }
  for (const minutes of [721, 1200, 1440]) {
    const source = await task(`manual-${minutes}`);
    assert.equal((await run(actors.manager, fixture.db, () => completion.changeTaskStatusCore(actors.manager, source.id, "DONE", minutes, coordinator.withMutationTransaction))).ok, true);
    assert.equal((await fixture.db.timeEntry.findFirstOrThrow({ where: { taskId: source.id, source: "manual" } })).minutes, minutes);
  }
  const manual = await task("manual-roles");
  for (const roles of [["WORKER"], ["MOUNTER"], ["WORKER", "MANAGER"]] as Role[][]) {
    const result = await run({ ...actors.worker, roles }, fixture.db, () => time.addManualTime({ taskId: manual.id, minutes: 1200 }));
    assert.equal(result.ok, roles.includes("MANAGER"));
  }
  const started = await task("start-closes-prior"); await fixture.db.task.update({ where: { id: started.id }, data: { status: "NEW" } });
  const previous = await task("prior-running");
  const priorTimer = await fixture.db.timeEntry.create({ data: { taskId: previous.id, userId: actors.worker.id, source: "timer", startedAt: new Date(instant.getTime() - 1200 * 60000) } });
  assert.equal((await run(actors.worker, fixture.db, () => completion.changeTaskStatusCore(actors.worker, started.id, "IN_PROGRESS", undefined, coordinator.withMutationTransaction))).ok, true);
  assert.equal((await fixture.db.timeEntry.findUniqueOrThrow({ where: { id: priorTimer.id } })).minutes, 720);
  assert.equal((await fixture.db.timeEntry.findFirstOrThrow({ where: { taskId: started.id, stoppedAt: null } })).startedAt.getTime(), instant.getTime());
  await run(actors.worker, fixture.db, () => time.stopTimer());
  const generated = await fixture.db.timeEntry.findMany({ where: { userId: actors.worker.id, source: "timer", id: { notIn: closed.map(row => row.id) } } });
  assert.ok(generated.every(row => Number.isInteger(row.minutes) && row.minutes >= 1 && row.minutes <= 720 && row.stoppedAt !== null));
  assert.equal(await fixture.db.timeEntry.count({ where: { userId: actors.worker.id, stoppedAt: null } }), 0);
});

test("timer/parallel-same-start-switch-expiry-start-DONE-and-audit-rollback", async t => {
  const instant = new Date("2026-10-11T12:00:00.000Z"); t.mock.timers.enable({ apis: ["Date"], now: instant.getTime() });
  const c = await tree(fixture.db, fixture, "timer-races");
  await fixture.db.work.update({ where: { id: c.work.id }, data: { quantity: "100", quantityPerUnit: "20", priceSnapshot: "100", total: "10000" } });
  const seed = (title: string) => fixture.db.task.create({ data: { projectId: c.project.id, productId: c.product.id, workId: c.work.id,
    assigneeId: c.worker.id, title, quantity: "1", status: "IN_PROGRESS" } });
  const a = await seed("Один"), b = await seed("Два");
  const same = await Promise.all(Array.from({ length: 10 }, (_, index) => run(c.worker, index % 2 ? fixture.db : fixture.peer, () => time.startTimer(a.id))));
  assert.ok(same.every(row => row.ok)); assert.equal(await fixture.db.timeEntry.count({ where: { userId: c.worker.id, stoppedAt: null } }), 1);
  const original = await fixture.db.timeEntry.findFirstOrThrow({ where: { userId: c.worker.id, stoppedAt: null } });
  assert.equal(original.startedAt.getTime(), instant.getTime());
  assert.equal(await fixture.db.timeEntry.count({ where: { taskId: a.id, userId: c.worker.id, source: "timer" } }), 1);
  await Promise.all(Array.from({ length: 10 }, (_, index) => run(c.worker, index % 2 ? fixture.db : fixture.peer, () => time.startTimer(index % 2 ? a.id : b.id))));
  assert.equal(await fixture.db.timeEntry.count({ where: { userId: c.worker.id, stoppedAt: null } }), 1);
  assert.equal((await fixture.db.timeEntry.findUniqueOrThrow({ where: { id: original.id } })).minutes, 1);
  const closedBeforeStops = await fixture.db.timeEntry.findMany({ where: { userId: c.worker.id, stoppedAt: { not: null } }, orderBy: { id: "asc" } });
  await Promise.all([run(c.worker, fixture.db, () => time.stopTimer()), run(c.worker, fixture.peer, () => time.stopTimer()), run(c.worker, fixture.peer, () => time.getActiveTimer())]);
  assert.equal(await fixture.db.timeEntry.count({ where: { userId: c.worker.id, stoppedAt: null } }), 0);
  assert.deepEqual(await fixture.db.timeEntry.findMany({ where: { id: { in: closedBeforeStops.map(row => row.id) } }, orderBy: { id: "asc" } }), closedBeforeStops);
  const expired = await fixture.db.timeEntry.create({ data: { taskId: a.id, userId: c.worker.id, source: "timer", startedAt: new Date(instant.getTime() - 1200 * 60000) } });
  await Promise.all([run(c.worker, fixture.db, () => time.getActiveTimer()), run(c.worker, fixture.peer, () => time.stopTimer())]);
  const savedExpired = await fixture.db.timeEntry.findUniqueOrThrow({ where: { id: expired.id } });
  assert.equal(savedExpired.minutes, 720); assert.equal(savedExpired.autoStopped, true);
  assert.equal(savedExpired.stoppedAt!.getTime(), instant.getTime() - 480 * 60000);
  const completing = await seed("Гонка завершения");
  await fixture.db.timeEntry.create({ data: { taskId: completing.id, userId: c.worker.id, source: "timer", startedAt: new Date(instant.getTime() - 1200 * 60000) } });
  const results = await overlap(c.worker, () => time.startTimer(completing.id),
    () => completion.changeTaskStatusCore(c.worker, completing.id, "DONE", undefined, coordinator.withMutationTransaction), true);
  assert.ok(results.every(row => row.ok));
  await run(c.worker, fixture.peer, () => completion.changeTaskStatusCore(c.worker, completing.id, "DONE", undefined, coordinator.withMutationTransaction));
  assert.equal(await fixture.db.payrollEntry.count({ where: { taskId: completing.id } }), 1);
  assert.equal((await fixture.db.payrollEntry.findFirstOrThrow({ where: { taskId: completing.id } })).amount.toFixed(2), "100.00");
  assert.equal(await fixture.db.timeEntry.count({ where: { taskId: completing.id, stoppedAt: null } }), 0);
  const fault = await seed("Ошибка audit"), timer = await fixture.db.timeEntry.create({ data: { taskId: fault.id, userId: c.worker.id, source: "timer", startedAt: new Date(instant.getTime() - 1200 * 60000) } });
  const collision = await fixture.db.changeLog.create({ data: { id: fixture.id("timer-audit-collision"), actorType: "user", actorId: c.manager.id, entity: "test", entityId: "ci169", action: "fixture" } });
  const before = await fixture.db.task.findUniqueOrThrow({ where: { id: fault.id } });
  const recipient = await fixture.user("timer-fault-recipient", ["WORKER"], { payScheme: "PIECE" });
  const faultBefore = await nativeSnapshot(fixture.db); let partialBeforeFault = 0;
  await assert.rejects(run(c.manager, fixture.db, () => tasks.updateTask(fault.id, { assigneeId: recipient.id }), {
    failAuditId: collision.id, beforeAudit: async tx => {
      assert.equal(await tx.task.count({ where: { id: fault.id, assigneeId: recipient.id } }), 1);
      assert.equal(await tx.timeEntry.count({ where: { id: timer.id, stoppedAt: { not: null }, minutes: 720, autoStopped: true } }), 1);
      partialBeforeFault++;
    },
  }));
  assert.equal(partialBeforeFault, 1); assert.deepEqual(await nativeSnapshot(fixture.db), faultBefore);
  assert.deepEqual(await fixture.db.task.findUnique({ where: { id: fault.id } }), before);
  assert.deepEqual(await fixture.db.timeEntry.findUnique({ where: { id: timer.id } }), timer);
  await run(c.worker, fixture.db, () => time.stopTimer());
  const casTask = await seed("CAS после чужого закрытия"), casTimer = await fixture.db.timeEntry.create({ data: {
    taskId: casTask.id, userId: c.worker.id, source: "timer", startedAt: new Date(instant.getTime() - 1200 * 60000),
  } }); let raceTriggered = false;
  const cas = await run(c.worker, fixture.db, () => time.stopTimer(), { onTimerLookup: async (_tx, seen) => {
    if (raceTriggered) return; assert.ok(seen.some(row => row.id === casTimer.id));
    const changed = await fixture.peer.timeEntry.updateMany({ where: { id: casTimer.id, taskId: casTask.id, userId: c.worker.id, source: "timer", stoppedAt: null },
      data: { minutes: 720, autoStopped: true, stoppedAt: new Date(instant.getTime() - 480 * 60000) } });
    assert.equal(changed.count, 1); raceTriggered = true;
  } });
  assert.equal(raceTriggered, true); assert.equal(cas.ok, false);
  const late = await fixture.db.timeEntry.findUniqueOrThrow({ where: { id: casTimer.id } });
  assert.equal(late.minutes, 720); assert.equal(late.autoStopped, true); assert.equal(late.stoppedAt!.getTime(), instant.getTime() - 480 * 60000);
  const generated = await fixture.db.timeEntry.findMany({ where: { userId: c.worker.id, source: "timer" } });
  assert.ok(generated.every(row => Number.isInteger(row.minutes) && row.minutes >= 1 && row.minutes <= 720 && row.stoppedAt !== null));
  assert.equal(await fixture.db.timeEntry.count({ where: { userId: c.worker.id, stoppedAt: null } }), 0);
});

async function materialsFixture(tx: Prisma.TransactionClient, rows: PostgresRows) {
  const roleSets: [string, Role[]][] = [["admin", ["ADMIN"]], ["director", ["DIRECTOR"]], ["engineer", ["ENGINEER"]],
    ["procurement", ["PROCUREMENT"]], ["manager", ["MANAGER"]], ["manager-accountant", ["MANAGER", "ACCOUNTANT"]],
    ["foreign-engineer", ["ENGINEER"]], ["accountant", ["ACCOUNTANT"]]];
  const users = Object.fromEntries(await Promise.all(roleSets.map(async ([name, roles]) => [name, actorOf(await rows.user(`materials-${name}`, roles))] as const)));
  const state = await warehouseState(tx, rows), project = await rows.project("materials-project", { stage: "CONTRACT", managerId: users.manager.id });
  const deleted = await rows.project("materials-deleted-project", { stage: "CONTRACT", deletedAt: new Date(0) });
  const items: Awaited<ReturnType<PostgresRows["product"]>>[] = [];
  for (let index = 1; index <= 25; index++) items.push(await rows.product(`materials-item-${index}`, index === 22 ? deleted.id : project.id, {
    quantity: index === 1 ? 4 : 2, status: index === 23 ? "PRODUCTION" : index === 25 ? "DRAFT" : "DESIGN",
    engineerId: [1, 2, 23, 25].includes(index) ? users.engineer.id : users["foreign-engineer"].id, deletedAt: index === 21 ? new Date(0) : null,
  }));
  const unit = await tx.materialUnit.create({ data: { id: rows.id("materials-unit"), name: rows.id("materials-unit") } });
  const [a, b] = await Promise.all(["a", "b"].map(suffix => tx.material.create({ data: { id: rows.id(`materials-${suffix}`), name: `Материал ${suffix}`,
    unitId: unit.id, purchasePrice: suffix === "a" ? "9.99" : "12.34", active: suffix === "b" } })));
  const needs = new Map<string, string>(), at = (offset: number) => new Date(Date.UTC(2026, 9, 11, 0, 0, 0, offset));
  for (const [offset, product] of items.entries()) {
    const index = offset + 1; if (index === 20) continue;
    for (const [suffix, material] of [["a", a], ["b", b]] as const) {
      const line = await tx.projectMaterial.create({ data: { productId: product.id, materialId: material.id,
        quantity: suffix === "b" ? index === 1 ? "1.250" : "0.500" : index === 1 ? "5.000" : index === 2 ? "7.000" : "2.000",
        quantityPerUnit: suffix === "b" ? index === 1 ? null : "0.250" : index === 1 ? "1.250" : index === 2 ? "3.500" : "1.000",
        issuedQty: suffix === "b" ? index === 1 ? "1.200" : "0" : index === 1 ? "4" : index === 2 ? "2" : "0", createdAt: at(index * 100) } });
      needs.set(`${index}-${suffix}`, line.id);
    }
  }
  const movement = (label: string, index: number | null, type: "EXPENSE" | "RETURN" | "INCOME", quantity: string,
    unitPrice: string | null, totalByn: string | null, offset: number, material = a): Prisma.StockMovementCreateManyInput => ({
    id: rows.id(label), materialId: material.id, type, receiptKind: type === "INCOME" ? label === "latest-income" ? "PAID" : "INVENTORY" : null,
    quantity, unitPrice, totalByn, productId: index === null ? null : items[index - 1].id,
    projectMaterialId: index === null || index === 20 || type === "INCOME" ? null : needs.get(`${index}-${material.id === a.id ? "a" : "b"}`),
    createdById: label === "expense-001" ? rows.id("missing-author") : users.engineer.id, createdAt: at(offset),
  });
  await tx.stockMovement.createMany({ data: [
    ...Array.from({ length: 501 }, (_, offset) => { const index = offset + 1; return movement(`expense-${String(index).padStart(3, "0")}`, 1, "EXPENSE",
      index === 501 ? "3" : "1", index === 1 ? null : "1", index === 1 ? null : index === 501 ? "3" : "1", index); }),
    movement("return-heavy", 1, "RETURN", "2", "1", "2", 650), movement("latest-income", 1, "INCOME", "7", "1", "7", 9999),
    movement("deleted-expense", 1, "EXPENSE", "999", "1", "999", 10000),
    ...Array.from({ length: 24 }, (_, offset) => movement(`expense-p${offset + 2}`, offset + 2, "EXPENSE", "1", "1", "1", 702 + offset)),
    movement("return-p2", 2, "RETURN", "0.5", "1", "0.5", 702),
    movement("global-income-a", null, "INCOME", "519.5", "2.5", "1298.75", 0), movement("global-income-b", null, "INCOME", "0.025", "12.34", "0.31", 0, b),
  ] });
  const cancelled = await tx.warehouseMovementDeletion.create({ data: { clientMutationId: randomUUID(), actorId: users.admin.id,
    rootMovementId: rows.id("deleted-expense"), planFingerprint: "a".repeat(64) } });
  await tx.stockMovement.update({ where: { id: rows.id("deleted-expense") }, data: { deletionId: cancelled.id } });
  for (const vector of [{ movement: "expense-501", quantity: "3", returned: "2" }, { movement: "expense-p2", quantity: "1", returned: "0.5" },
    { movement: "expense-p20", quantity: "1", returned: "0" }, { movement: "expense-p21", quantity: "1", returned: "0" }]) {
    await tx.warehouseMovementValuation.create({ data: { id: rows.id(`valuation-${vector.movement}`), movementId: rows.id(vector.movement), runId: state.runId,
      clientMutationId: randomUUID(), requestFingerprint: "b".repeat(64), actorId: users.admin.id, quantity: vector.quantity, unitCost: "1",
      valueByn: vector.quantity, moneyByn: vector.quantity, returnedQuantity: vector.returned, returnedValueByn: vector.returned, returnedMoneyByn: vector.returned } });
  }
  await tx.warehouseBalance.createMany({ data: [{ materialId: a.id, runId: state.runId, quantity: "2", valueByn: "5", revision: 7 },
    { materialId: b.id, runId: state.runId, quantity: "0.025", valueByn: "0.308500000", revision: 1 }] });
  return { users, items, project, a, b, state };
}

test("materials/frozen-501-costs-batch-scalar-positional-ACL-1-5-20-real-SQL-budget", async () => fixture.rollback(async (tx, rows) => {
  const c = await materialsFixture(tx, rows), ids = c.items.map(row => row.id), counts: number[] = [];
  const protectedBefore = await nativeSnapshot(tx), state = await tx.warehouseAccountingState.findUnique({ where: { id: "main" } });
  await run(c.users.admin, tx, async () => {
    for (const size of [1, 5, 20]) {
      const selected = ids.slice(0, size), expected = await Promise.all(selected.map(id => frozenReference.frozenGetProjectMaterials(id, c.users.admin, tx)));
      const begin = await fence(`materials-begin-${size}`), actual = await warehouse.getProjectMaterialsBatch(selected, c.users.admin, tx), end = await fence(`materials-end-${size}`);
      counts.push(end - begin - 1); assert.deepEqual(actual, expected);
      assert.deepEqual(await warehouse.getProjectMaterials(selected[0], c.users.admin, tx), expected[0]);
    }
    assert.ok(counts[0] > 0 && counts[2] <= counts[0] + 2, `SQL_READ_BUDGET:${counts.join(",")}`);
    const facts = await warehouse.getProjectMaterialsBatch([ids[0], ids[1], ids[19]], c.users.admin, tx);
    assert.equal(facts[0].movements.length, 499); assert.equal(facts[0].materialsTotalByn, null);
    assert.equal(facts[0].movements.some(row => [rows.id("expense-001"), rows.id("latest-income"), rows.id("deleted-expense")].includes(row.id)), false);
    assert.equal(facts[0].lines.length, 2); assert.ok(facts[0].lines.some(row => row.quantityPerUnit === 1.25)); assert.equal(facts[2].lines.length, 0);
    assert.equal(facts[0].warehouseReady, true); assert.equal(facts[0].lines.find(row => row.materialId === c.a.id)!.purchasePrice, 2.5);
    assert.equal(facts[1].movements[0].id, rows.id("return-p2"), "TIED_CREATED_AT_USES_ID_DESC");
  });
  for (const name of ["admin", "director", "engineer", "procurement", "manager", "manager-accountant"]) await run(c.users[name], tx, async () => {
    const who = c.users[name], selected = [ids[22], ids[0], ids[22], ids[19], ids[20], ids[21], ids[23], ids[24], rows.id("missing-product")];
    assert.deepEqual(await warehouse.getProjectMaterialsBatch(selected, who, tx), await Promise.all(selected.map(id => frozenReference.frozenGetProjectMaterials(id, who, tx))));
  });
  const begin = fixture.queryEvents.length;
  assert.deepEqual(await warehouse.getProjectMaterialsBatch([], c.users.accountant, tx), []); assert.equal(fixture.queryEvents.length, begin);
  await assert.rejects(warehouse.getProjectMaterialsBatch([ids[0]], c.users.accountant, tx), /Недостаточно прав/);
  assert.deepEqual(await nativeSnapshot(tx), protectedBefore, "F148_ORIGINAL_INSIDE");
  assert.deepEqual(await tx.warehouseAccountingState.findUnique({ where: { id: "main" } }), state, "F148_GLOBAL_WAREHOUSE_CHANGED");
  for (const phase of ["VERIFYING", "FROZEN", "RESTORED"]) {
    await tx.warehouseAccountingState.update({ where: { id: "main" }, data: { phase } });
    const observedState = await tx.warehouseAccountingState.findUnique({ where: { id: "main" } });
    assert.deepEqual(await warehouse.getProjectMaterialsBatch([ids[0], ids[1]], c.users.admin, tx),
      await Promise.all([ids[0], ids[1]].map(id => frozenReference.frozenGetProjectMaterials(id, c.users.admin, tx))));
    assert.deepEqual(await tx.warehouseAccountingState.findUnique({ where: { id: "main" } }), observedState, "F148_GLOBAL_WAREHOUSE_CHANGED");
  }
}));
