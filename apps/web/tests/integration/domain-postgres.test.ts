// SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP при несовпадении CI target.
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { Prisma, PrismaClient, ProductStatus, ProjectStage, Role } from "@prisma/client";
import type { DomainActor } from "../../src/server/actor";
import { deliverPaymentEffects } from "../../src/server/payments/post-commit";
import { guardedModuleCache } from "../helpers/guarded-module-cache";
import { nativeOwnedIds, nativeSnapshot } from "../helpers/native-acceptance-snapshot";
import { createPostgresFixture, rejectedSql, type PostgresRows } from "./postgres.fixture";
import { summarizeCalendarEntries } from "../../src/lib/calendar-summary";
import { verifyCounterpartyNative } from "../helpers/counterparty-native";
import { productDraftAccessRelations } from "../../src/server/access/product-draft-context";
import { verifyProposalCompositionNative } from "../helpers/kp-proposal-native";
import { requestProposalPdfInTransaction, recordPendingPdfArtifactInTransaction, publishSourcePdfInTransaction,
  completeRenderJobInTransaction, type LifecycleSecurity } from "../../src/server/kp/lifecycle-store";
import { createPrismaRenderQueue } from "../../src/server/kp/render-queue";
import type { ActorBinding, LifecyclePorts } from "../../src/server/kp/lifecycle-contract";
import { pieceworkPlanRevision } from "../../src/server/tasks/piecework-revision";
import { allocatedWorkQuantity, moneyAtoms } from "../../src/lib/work-shares";

type Db = PrismaClient | Prisma.TransactionClient;
type MutationProbe = { taskId?: string; workerId?: string; workId?: string; projectId?: string; cashId?: string; paymentId?: string; receiptId?: string; payment: boolean;
  actor: DomainActor; mode?: "lost-ack" | "failed-proof"; fault?: "payroll" | "audit" | "event" | "receipt";
  calls: number; writes: number; partials: number; effects: string[]; connections: { proof: boolean; pid: number }[]; owned: Record<string, string[]>; creates: Set<string> };
type Context = { actor: DomainActor; db: Db; unauthenticated?: boolean; onRequested?: (pid: number) => void;
  onHeld?: (tx: Prisma.TransactionClient, pid: number) => Promise<void>; lockProjectId?: string; failAuditId?: string; failEventId?: string;
  createFault?: { kind: "event" | "receipt"; collisionId: string; title: string }; createAck?: { lost: boolean; transactions: number };
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
let productDeletion: typeof import("../../src/server/products/delete-core");
let productQueries: typeof import("../../src/server/products/queries");
let projectQueries: typeof import("../../src/server/projects/queries");
let changelog: typeof import("../../src/server/changelog/queries");
let calendar: typeof import("../../src/server/calendar/core"), calendarAnalytics: typeof import("../../src/server/calendar/analytics");
let visibility: typeof import("../../src/server/access/visibility"), notifications: typeof import("../../src/server/access/notification-visibility");
let tasks: typeof import("../../src/server/tasks/actions"), completion: typeof import("../../src/server/tasks/completion-core");
let worksCore: typeof import("../../src/server/works/core");
let workUpdate: typeof import("../../src/server/works/update-core"), workQueries: typeof import("../../src/server/works/queries");
let priceActions: typeof import("../../src/server/prices/actions");
let percentageQueries: typeof import("../../src/server/product-percentage-pay/queries");
let workerAllocation: typeof import("../../src/server/tasks/worker-allocation-core"), warehouseActions: typeof import("../../src/server/warehouse/actions");
let pieceworkAllocation: typeof import("../../src/server/tasks/piecework-core");
let taskQueries: typeof import("../../src/server/tasks/queries"), workspace: typeof import("../../src/server/tasks/workspace-contract");
let time: typeof import("../../src/server/time/actions");
let units: typeof import("../../src/server/warehouse/unit-core");
let norms: typeof import("../../src/server/warehouse/norm-core"), warehouse: typeof import("../../src/server/warehouse/queries");
let coordinator: typeof import("../../src/server/transactions/coordinator");
let frozenReference: typeof import("../helpers/project-materials-reference");
let payments: typeof import("../../src/server/payments/service");
let stock: typeof import("../../src/server/warehouse/accounting");
let proposals: typeof import("../../src/server/kp/proposal-core");
let projectCore: typeof import("../../src/server/projects/core");

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
    if (table === "$executeRaw" || table === "timeEntry") throw Error("CI190_RETIRED_TIME_ACCESS");
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
          } else assert.ok(["status", "create"].includes(String(data.action)), "CI133_WRITE_STOP");
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
            assert.equal(await tx.timeEntry.count({ where: { taskId: probe.taskId } }), 0);
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
    if (key === "domainEvent" && context.failEventId) return new Proxy(db.domainEvent, { get(model, method) {
      const value = Reflect.get(model, method); if (method !== "create") return typeof value === "function" ? value.bind(model) : value;
      return async (...args: unknown[]) => {
        const row = await Reflect.apply(value, model, args);
        await tx.domainEvent.create({ data: { id: context.failEventId, type: "ci.unique-collision", actor: context.actor.id, payload: {} } });
        return row;
      };
    } });
    if (context.createFault && ["domainEvent", "changeLog"].includes(String(key))) return new Proxy(Reflect.get(db, key), { get(model, method) {
      const value = Reflect.get(model, method); if (method !== "create") return typeof value === "function" ? value.bind(model) : value;
      return async (...args: unknown[]) => {
        const data = (args[0] as { data: { action?: string } }).data, fault = context.createFault!;
        const row = await Reflect.apply(value, model, args);
        if (fault.kind === "event" && key === "domainEvent" || fault.kind === "receipt" && data.action === "task.create.request") {
          assert.equal(await tx.task.count({ where: { title: fault.title, createdById: context.actor.id } }), 1, "TASK_PARTIAL_SQL_WRITE_REQUIRED");
          await tx.changeLog.create({ data: { id: fault.collisionId, actorType: "user", actorId: context.actor.id, entity: "test", entityId: fault.collisionId, action: "collision" } });
        }
        return row;
      };
    } });
    if (key === "$queryRaw") return async (...args: unknown[]) => {
      const sql = Array.isArray(args[0]) ? args[0].join("") : "";
      const locked = context.lockProjectId
        ? /FROM "Project".*FOR UPDATE/.test(sql) && args[1] === context.lockProjectId
        : /pg_advisory_xact_lock\(18435,\s*55001\)|FROM "(?:Project|Product|Work|User)".*FOR UPDATE/.test(sql);
      const pid = locked && (context.onRequested || context.onHeld)
        ? (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0].pid : 0;
      if (locked) context.onRequested?.(pid);
      const value = await Reflect.apply(tx.$queryRaw, tx, args);
      if (locked) await context.onHeld?.(tx, pid);
      return value;
    };
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
    if (context.mutation && key === "domainEvent") return new Proxy(value, { get(model, method) {
      if (method === "create") return () => { throw Error("OUTSIDE_DOMAIN_EVENT_WRITE"); };
      const member = Reflect.get(model, method); return typeof member === "function" ? member.bind(model) : member;
    } });
    if (key === "$transaction" && typeof value === "function") return async (operation: (tx: Prisma.TransactionClient) => Promise<unknown>, options: unknown) => {
      const probe = context.mutation, proof = probe ? probe.calls++ > 0 : false, createProof = context.createAck ? context.createAck.transactions++ > 0 : false;
      const connection = proof || createProof ? fixture.peer : context.db;
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
      if (context.createAck?.lost) { context.createAck.lost = false; throw Error("CI165_LOST_ACK_AFTER_REAL_COMMIT"); }
      return result;
    };
    return typeof value === "function" ? value.bind(context.db) : value;
  } });
  // Child targets загружаются раньше родителей: guardedModuleCache сохраняет installed entry каждого target.
  const names = ["transactions/coordinator", "time/timers", "access/visibility", "access/notification-visibility", "tasks/workspace-contract", "prices/actions", "works/core", "works/update-core", "works/queries", "tasks/worker-allocation-core", "tasks/piecework-core",
    "tasks/queries", "warehouse/unit-core", "warehouse/norm-core", "warehouse/queries", "products/delete-core", "products/core", "projects/stage-core", "projects/delete-core",
    "products/status-core", "products/queries", "projects/queries", "product-percentage-pay/queries", "changelog/queries", "calendar/core", "calendar/analytics", "tasks/completion-core", "tasks/actions", "warehouse/accounting", "warehouse/actions", "time/actions", "payments/service", "projects/core", "kp/proposal-core"];
  const effect = (name: string) => () => { const probe = current().mutation; if (probe) { probe.effects.push(name); throw Error("CI133_INJECTED_OPTIONAL_EFFECT"); } };
  const overrides = { "../src/auth": { auth: async () => current().unauthenticated ? null : ({ user: current().actor }) },
    "next/cache": { revalidatePath: effect("cache"), revalidateTag: effect("cache") },
    "../src/server/payments/post-commit": { deliverPaymentEffects: (effects: Parameters<typeof deliverPaymentEffects>[0], dependencies: Parameters<typeof deliverPaymentEffects>[1]) =>
      deliverPaymentEffects(effects, current().mutation ? { ...dependencies, dispatchEvent: async () => effect("dispatch")() } : dependencies) },
    "../src/server/notifications/notify": { notifyOrg: effect("org"), notifyPerson: effect("person") } };
  scope = guardedModuleCache(new URL("../ci169-domain-scope.ts", import.meta.url).href,
    { targets: [...names.map(name => `../src/server/${name}`), "./helpers/project-materials-reference"], allowedOverrides: Object.keys(overrides), overrides, prisma: facade });
  coordinator = scope.load("../src/server/transactions/coordinator"); scope.load("../src/server/time/timers");
  visibility = scope.load("../src/server/access/visibility"); notifications = scope.load("../src/server/access/notification-visibility");
  stock = scope.load("../src/server/warehouse/accounting");
  priceActions = scope.load("../src/server/prices/actions");
  worksCore = scope.load("../src/server/works/core");
  workUpdate = scope.load("../src/server/works/update-core"); workQueries = scope.load("../src/server/works/queries");
  workerAllocation = scope.load("../src/server/tasks/worker-allocation-core");
  pieceworkAllocation = scope.load("../src/server/tasks/piecework-core");
  workspace = scope.load("../src/server/tasks/workspace-contract"); taskQueries = scope.load("../src/server/tasks/queries");
  units = scope.load("../src/server/warehouse/unit-core"); norms = scope.load("../src/server/warehouse/norm-core"); warehouse = scope.load("../src/server/warehouse/queries");
  productDeletion = scope.load("../src/server/products/delete-core"); products = scope.load("../src/server/products/core"); stages = scope.load("../src/server/projects/stage-core"); deletion = scope.load("../src/server/projects/delete-core");
  statuses = scope.load("../src/server/products/status-core"); productQueries = scope.load("../src/server/products/queries"); projectQueries = scope.load("../src/server/projects/queries");
  changelog = scope.load("../src/server/changelog/queries");
  calendar = scope.load("../src/server/calendar/core"); calendarAnalytics = scope.load("../src/server/calendar/analytics");
  percentageQueries = scope.load("../src/server/product-percentage-pay/queries");
  completion = scope.load("../src/server/tasks/completion-core"); tasks = scope.load("../src/server/tasks/actions"); warehouseActions = scope.load("../src/server/warehouse/actions"); time = scope.load("../src/server/time/actions");
  frozenReference = scope.load("./helpers/project-materials-reference");
  payments = scope.load("../src/server/payments/service");
  projectCore = scope.load("../src/server/projects/core"); proposals = scope.load("../src/server/kp/proposal-core");
});
after(async () => { if (fixture) try { scope?.restore(); await fixture.verifyProtected(); } finally { await fixture.dispose(); } });

test("counterparties/native-create-revision-CAS-audit-rollback", async () => fixture.rollback(async (tx, rows) => {
  const manager = await rows.user("counterparty-manager", ["MANAGER"]);
  const checks = await verifyCounterpartyNative(tx, actorOf(manager));
  assert.equal(checks.realSqlRollback, true); assert.equal(checks.revisionCas, true);
}));

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
test("warehouse/real-weighted-movements-replay-return-rounding-and-SQL-rollback", async () => fixture.rollback(async (tx, rows) => {
  const c = await tree(tx, rows, "stock-writers"), originalMaterial = c.material;
  await warehouseState(tx, rows);
  const line = await tx.projectMaterial.create({ data: { productId: c.product.id, materialId: c.material.id, quantity: "100", quantityPerUnit: "20" } });
  const requests = ["5", "7", "10"].map(unitPrice => ({ kind: "INCOME" as const, clientMutationId: randomUUID(), materialId: c.material.id, quantity: "10", unitPrice }));
  for (const input of requests) await stock.warehouseMove(tx, c.admin, input);
  const material = await tx.material.findUniqueOrThrow({ where: { id: c.material.id } });
  assert.equal(material.purchasePrice!.toFixed(2), "7.33"); assert.deepEqual(material.updatedAt, originalMaterial.updatedAt);
  assert.equal((await stock.warehouseMove(tx, c.admin, { ...requests[0], clientMutationId: requests[0].clientMutationId.toUpperCase() })).repeated, true);
  await assert.rejects(stock.warehouseMove(tx, c.admin, { ...requests[0], quantity: "11" }), /другими данными/);
  await assert.rejects(stock.warehouseMove(tx, c.worker, { ...requests[0], clientMutationId: randomUUID() }), /прав/);
  const stable = await nativeSnapshot(tx);
  const ownedMaterial = nativeOwnedIds({ Material: [c.material.id] }), excluded = await nativeSnapshot(tx, ownedMaterial);
  const materialCount = (snapshot: typeof stable) => BigInt((snapshot.snapshot.rows.Material as { count: string }[])[0].count);
  assert.equal(materialCount(excluded), materialCount(stable) - BigInt(1), "SNAPSHOT_EXCLUDES_EXACT_OWNED_ROW");
  await tx.$executeRawUnsafe("SAVEPOINT ci169_snapshot_sensitivity");
  try {
    await tx.material.update({ where: { id: c.material.id }, data: { name: rows.id("snapshot-probe") } });
    const changed = await nativeSnapshot(tx);
    assert.notDeepEqual(changed.snapshot.rows.Material, stable.snapshot.rows.Material, "SNAPSHOT_DATA_FINGERPRINT_SENSITIVE");
    assert.notEqual(changed.digest, stable.digest, "SNAPSHOT_DATA_DIGEST_SENSITIVE");
    assert.deepEqual(await nativeSnapshot(tx, ownedMaterial), excluded, "SNAPSHOT_EXCLUDES_ONLY_OWNED_CHANGE");
  } finally {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT ci169_snapshot_sensitivity");
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT ci169_snapshot_sensitivity");
  }
  assert.deepEqual(await nativeSnapshot(tx), stable, "SNAPSHOT_SAVEPOINT_RESTORES_DATA");
  await tx.$executeRawUnsafe("CREATE FUNCTION ci169_stock_failure() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'CI169_STOCK_FAILURE'; END; $$ LANGUAGE plpgsql");
  const withFunction = await nativeSnapshot(tx);
  assert.notDeepEqual(withFunction.snapshot.functions, stable.snapshot.functions, "SNAPSHOT_FUNCTION_FINGERPRINT_SENSITIVE");
  assert.deepEqual(withFunction.snapshot.triggers, stable.snapshot.triggers);
  for (const table of ["ProjectMaterial", "DomainEvent"] as const) {
    await tx.$executeRawUnsafe(`CREATE TRIGGER ci169_stock_failure BEFORE ${table === "ProjectMaterial" ? "UPDATE" : "INSERT"} ON "${table}" FOR EACH ROW EXECUTE FUNCTION ci169_stock_failure()`);
    const before = await nativeSnapshot(tx);
    assert.notDeepEqual(before.snapshot.triggers, withFunction.snapshot.triggers, "SNAPSHOT_TRIGGER_FINGERPRINT_SENSITIVE");
    assert.deepEqual(before.snapshot.functions, withFunction.snapshot.functions);
    await rejectedSql(tx, () => stock.warehouseMove(tx, c.admin, table === "ProjectMaterial"
      ? { kind: "EXPENSE", clientMutationId: randomUUID(), projectMaterialId: line.id, quantity: "1" }
      : { ...requests[0], clientMutationId: randomUUID() }), /CI169_STOCK_FAILURE/);
    assert.deepEqual(await nativeSnapshot(tx), before, "MOVEMENT_FAILURE_ROLLS_BACK_ALL_ROWS");
    await tx.$executeRawUnsafe(`DROP TRIGGER ci169_stock_failure ON "${table}"`);
  }
  await tx.$executeRawUnsafe("DROP FUNCTION ci169_stock_failure()");
  assert.deepEqual(await nativeSnapshot(tx), stable);
  const issued = await stock.warehouseMove(tx, c.admin, { kind: "EXPENSE", clientMutationId: randomUUID(), projectMaterialId: line.id, quantity: "10" });
  assert.equal(issued.movement.totalByn!.toFixed(2), "73.33");
  assert.equal((await stock.warehouseReadPositions(tx, [c.material.id])).positions.get(c.material.id)!.quantity, "20");
  assert.equal((await tx.material.findUniqueOrThrow({ where: { id: c.material.id } })).purchasePrice!.toFixed(2), "7.33");
  await assert.rejects(stock.warehouseMove(tx, c.admin, { kind: "EXPENSE", clientMutationId: randomUUID(), projectMaterialId: line.id, quantity: "21" }), /Недостаточно/);
  await stock.warehouseMove(tx, c.admin, { kind: "RETURN", clientMutationId: randomUUID(), projectMaterialId: line.id, quantity: "10", sourceMovementId: issued.movement.id });
  assert.equal((await tx.warehouseBalance.findUniqueOrThrow({ where: { materialId: c.material.id } })).valueByn.toFixed(9), "220.000000000");
  assert.equal((await tx.projectMaterial.findUniqueOrThrow({ where: { id: line.id } })).issuedQty.toString(), "0");
  await tx.projectMaterial.update({ where: { id: line.id }, data: { issuedQty: "5" } });
  await assert.rejects(stock.warehouseMove(tx, c.admin, { kind: "RETURN", clientMutationId: randomUUID(), projectMaterialId: line.id, quantity: "2", unitPrice: "0" }), /Цена должна/);
  await stock.warehouseMove(tx, c.admin, { kind: "RETURN", clientMutationId: randomUUID(), projectMaterialId: line.id, quantity: "2", unitPrice: "11" });
  assert.equal((await tx.warehouseBalance.findUniqueOrThrow({ where: { materialId: c.material.id } })).quantity.toString(), "32");
  assert.equal((await tx.projectMaterial.findUniqueOrThrow({ where: { id: line.id } })).issuedQty.toString(), "3");
  const tiny = await tx.material.create({ data: { name: rows.id("tiny-stock"), unitId: c.unit.id } });
  const tinyLine = await tx.projectMaterial.create({ data: { productId: c.product.id, materialId: tiny.id, quantity: "1" } });
  await stock.warehouseMove(tx, c.admin, { kind: "INCOME", materialId: tiny.id, quantity: "1", unitPrice: "0.02", clientMutationId: randomUUID() });
  const tinyIssue = await stock.warehouseMove(tx, c.admin, { kind: "EXPENSE", projectMaterialId: tinyLine.id, quantity: "1", clientMutationId: randomUUID() });
  for (let part = 0; part < 4; part++) await stock.warehouseMove(tx, c.admin, { kind: "RETURN", projectMaterialId: tinyLine.id,
    quantity: "0.25", sourceMovementId: tinyIssue.movement.id, clientMutationId: randomUUID() });
  assert.equal((await tx.warehouseMovementValuation.findUniqueOrThrow({ where: { movementId: tinyIssue.movement.id } })).returnedMoneyByn.toFixed(2), "0.02");
  assert.equal((await tx.warehouseBalance.findUniqueOrThrow({ where: { materialId: tiny.id } })).valueByn.toFixed(9), "0.020000000");
  assert.equal(await tx.stockMovement.count({ where: { materialId: c.material.id } }), 6);
  assert.equal(await tx.changeLog.count({ where: { actorId: c.admin.id, entity: "stockMovement" } }), 12);
  assert.equal(await tx.domainEvent.count({ where: { actor: c.admin.id, type: "stock.movement.created" } }), 12);
}));
test("warehouse/two-connection-issue-replay-return-real-lock-and-exact-facts", async () => {
  const c = await tree(fixture.db, fixture, "stock-race"); await warehouseState(fixture.db, fixture);
  const line = await fixture.db.projectMaterial.create({ data: { productId: c.product.id, materialId: c.material.id, quantity: "100" } });
  const pids = new Set<number>();
  const move = (db: PrismaClient, input: Parameters<typeof stock.warehouseMove>[2]) => db.$transaction(async tx => {
    pids.add((await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0].pid);
    return stock.warehouseMove(tx, c.admin, input);
  }, { maxWait: 10_000, timeout: 15_000 });
  await move(fixture.db, { kind: "INCOME", materialId: c.material.id, quantity: "5", unitPrice: "5", clientMutationId: randomUUID() });
  // Пул может выдать подготовке другое соединение; считаем PID только конкурентной пары.
  pids.clear();
  const issue = await Promise.allSettled([fixture.db, fixture.peer].map(db => move(db, { kind: "EXPENSE", projectMaterialId: line.id, quantity: "4", clientMutationId: randomUUID() })));
  assert.equal(issue.filter(row => row.status === "fulfilled").length, 1); assert.equal(pids.size, 2);
  const refused = issue.find(row => row.status === "rejected"); assert.ok(refused && refused.status === "rejected"); assert.match(String(refused.reason), /Недостаточно/);
  assert.equal((await fixture.db.warehouseBalance.findUniqueOrThrow({ where: { materialId: c.material.id } })).quantity.toString(), "1");
  const input = { kind: "INCOME" as const, materialId: c.material.id, quantity: "2", unitPrice: "9", clientMutationId: randomUUID() };
  const repeated = await Promise.all([move(fixture.db, input), move(fixture.peer, input)]);
  assert.equal(repeated.filter(row => row.repeated).length, 1); assert.equal(repeated[0].movement.id, repeated[1].movement.id);
  const issued = await fixture.db.stockMovement.findFirstOrThrow({ where: { materialId: c.material.id, type: "EXPENSE" } });
  const returned = await Promise.allSettled([fixture.db, fixture.peer].map(db => move(db, { kind: "RETURN", projectMaterialId: line.id, sourceMovementId: issued.id, quantity: "3", clientMutationId: randomUUID() })));
  assert.equal(returned.filter(row => row.status === "fulfilled").length, 1);
  const returnRefusal = returned.find(row => row.status === "rejected"); assert.ok(returnRefusal && returnRefusal.status === "rejected");
  assert.equal((await fixture.db.warehouseMovementValuation.findUniqueOrThrow({ where: { movementId: issued.id } })).returnedQuantity.toString(), "3");
  assert.equal((await fixture.db.warehouseBalance.findUniqueOrThrow({ where: { materialId: c.material.id } })).quantity.toString(), "6");
  assert.equal((await fixture.db.projectMaterial.findUniqueOrThrow({ where: { id: line.id } })).issuedQty.toString(), "1");
  assert.equal(await fixture.db.stockMovement.count({ where: { materialId: c.material.id } }), 4);
  assert.equal(await fixture.db.warehouseMovementValuation.count({ where: { movement: { materialId: c.material.id } } }), 4);
  assert.equal(await fixture.db.domainEvent.count({ where: { actor: c.admin.id, type: "stock.movement.created" } }), 4);
  assert.equal(await fixture.db.changeLog.count({ where: { actorId: c.admin.id, entity: "stockMovement" } }), 4);
});
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
async function overlap<A, B>(actor: DomainActor, firstOperation: () => Promise<A>, secondOperation: () => Promise<B>, timerLock = false, lockProjectId?: string) {
  const ready = gate(), requested = gate(), release = gate(); let holder: Prisma.TransactionClient | undefined, holderPid = 0, waiterPid = 0;
  const first = run(actor, fixture.db, firstOperation, { lockProjectId, onHeld: async (tx, pid) => { holder = tx; holderPid = pid; ready.resolve(); await release.promise; } });
  void first.catch(() => {}); let second: Promise<B> | undefined;
  try {
    await Promise.race([ready.promise, first.then(() => assert.fail("REAL_HELD_LOCK_REQUIRED"))]);
    second = run(actor, fixture.peer, secondOperation, { lockProjectId, onRequested: pid => { waiterPid = pid; requested.resolve(); } });
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
  assert.equal((await tx.product.findUniqueOrThrow({ where: { id: deleted.id } })).status, "DRAFT");
  const afterRows = await tx.product.findMany({ where: { projectId: c.project.id }, orderBy: { id: "asc" } });
  const business = ({ status: _status, statusChangedAt: _changed, updatedAt: _updated, ...row }: typeof c.product) => { void _status; void _changed; void _updated; return row; };
  assert.deepEqual(afterRows.map(business), before.map(business));
  assert.equal(await tx.productStatusHistory.count({ where: { productId: c.product.id } }), 1);
  assert.equal(await tx.productStatusHistory.count({ where: { productId: deleted.id, fromStatus: "DRAFT", toStatus: "PREPARATION" } }), 0);
  assert.equal(result.eventIds.length, 2);
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
  const failing = await tree(tx, rows, "promotion-fault", "ESTIMATE", "DRAFT");
  const event = await tx.domainEvent.create({ data: { type: "ci.promotion-collision", actor: c.manager.id, payload: {} } });
  const snapshot = await nativeSnapshot(tx);
  await rejectedSql(tx, () => stages.patchProjectStageTransaction(c.manager,
    { projectId: failing.project.id, expectedStage: "ESTIMATE", toStage: "CONTRACT", clientMutationId: randomUUID() },
    commandTx(tx, { actor: c.manager, db: tx, failEventId: event.id })), /Unique constraint/);
  assert.deepEqual(await nativeSnapshot(tx), snapshot);
}));

test("draft/privacy-real-readers-joins-notifications-and-operational-denials", async () => fixture.rollback(async (tx, rows) => {
  const c = await tree(tx, rows, "privacy", "ESTIMATE", "DRAFT"), assigned = c.engineer.id;
  const visible = await rows.product("privacy-normal", c.project.id, { status: "DESIGN", engineerId: assigned, expectedPrice: "30.00", quantity: 2 });
  const task = await tx.task.create({ data: { projectId: c.project.id, productId: c.product.id, workId: c.work.id, assigneeId: assigned, title: "Черновая задача", quantity: "1" } });
  const files = await Promise.all([true, false].map(direct => tx.file.create({ data: { projectId: c.project.id, productId: direct ? c.product.id : null,
    taskId: direct ? null : task.id, fileName: "draft.pdf", storedName: randomUUID(), mimeType: "application/pdf", size: 1, uploadedById: assigned } })));
  for (const roles of [["MANAGER"], ["MANAGER", "ENGINEER"], ["MANAGER", "WORKER"], ["ENGINEER"], ["ACCOUNTANT"], ["PROCUREMENT"],
    ["WORKER"], ["MOUNTER"], ["ACCOUNTANT", "ENGINEER"], ["ADMIN"], ["DIRECTOR"]] as Role[][]) {
    const actor = { ...c.engineer, roles }, allowed = roles.includes("ADMIN") || roles.includes("DIRECTOR");
    assert.equal(visibility.canEditProductTechnicalBlock(actor, { id: c.product.id, engineerId: assigned, status: "DRAFT" }), allowed);
    const checks = [tx.product.count({ where: { AND: [{ id: c.product.id }, visibility.productVisibilityWhere(actor)] } }),
      tx.task.count({ where: { AND: [{ id: task.id }, visibility.taskVisibilityWhere(actor)] } }),
      tx.task.count({ where: { AND: [{ id: task.id }, visibility.taskExecutionWhere(actor)] } }),
      tx.work.count({ where: { AND: [{ id: c.work.id }, visibility.workVisibilityWhere(actor)] } }),
      tx.file.count({ where: { AND: [{ id: { in: files.map(row => row.id) } }, visibility.fileVisibilityWhere(actor)] } })];
    assert.deepEqual(await Promise.all(checks), [allowed ? 1 : 0, allowed ? 1 : 0, allowed ? 1 : 0, allowed ? 1 : 0, allowed ? 2 : 0]);
    await run(actor, tx, async () => {
      for (const key of [c.product.id, c.product.number]) assert.equal(Boolean(await productQueries.getProductFor(actor.id, roles, key)), allowed);
      const selected = await productQueries.listProductOptions(c.project.id, actor); assert.equal(selected.some(row => row.id === c.product.id), allowed);
      assert.equal((await productQueries.listProducts(actor.id, roles, { activeOnly: false, projectId: c.project.id, statuses: ["DRAFT"] })).total, allowed ? 1 : 0);
      if (roles.includes("MANAGER")) {
        const detail = await projectQueries.getProjectFor(actor.id, roles, c.project.id); assert.ok(detail);
        assert.deepEqual(detail.products.map(row => row.id), [visible.id]);
        const summary = (await projectQueries.listProjects(actor.id, roles, { activeOnly: false })).rows.find(row => row.id === c.project.id)!;
        assert.equal(summary._count.products, 1); assert.equal(summary.totalPrice, 1060);
      }
    });
  }
  const currentProduction = await rows.product("engineer-current-production", c.project.id, { status: "PRODUCTION", engineerId: assigned });
  const hidden = await rows.product("engineer-foreign-design", c.project.id, { status: "DESIGN", engineerId: c.worker.id });
  const ownPool = await tx.productStagePayPool.create({ data: { id: rows.id("engineer-visibility-pool"), productId: visible.id, kind: "ENGINEERING", state: "DRAFT", createdById: assigned } });
  const ownWork = await tx.work.create({ data: { projectId: c.project.id, productId: visible.id, title: "Инженерная", paymentKind: "ENGINEERING",
    stagePayPoolId: ownPool.id, poolWeightUnits: 1_000_000, quantity: "1", priceSnapshot: "30", total: "30" } });
  const ownTask = await tx.task.create({ data: { projectId: c.project.id, productId: visible.id, workId: ownWork.id, assigneeId: assigned, title: "Инженерная задача", quantity: "1" } });
  const visibleFiles = await Promise.all([visible.id, null].map(productId => tx.file.create({ data: { projectId: c.project.id, productId,
    fileName: "visible.pdf", storedName: randomUUID(), mimeType: "application/pdf", size: 1, uploadedById: assigned } })));
  await tx.file.create({ data: { projectId: c.project.id, productId: hidden.id, fileName: "hidden.pdf", storedName: randomUUID(), mimeType: "application/pdf", size: 1, uploadedById: assigned } });
  await tx.project.update({ where: { id: c.project.id }, data: { initialPrice: "900", delivery: "10", unloading: "20", installation: "30" } });
  await run(c.engineer, tx, async () => {
    assert.equal((await productQueries.listProducts(assigned, c.engineer.roles, { activeOnly: false, projectId: c.project.id, statuses: ["PRODUCTION"] })).total, 1);
    assert.equal((await productQueries.listProducts(assigned, c.engineer.roles, { activeOnly: false, projectId: c.project.id, engineerId: c.worker.id })).total, 0);
    assert.deepEqual((await productQueries.listProductFilterOptions(assigned, c.engineer.roles)).projects.map(row => row.id), [c.project.id]);
    const detail = await projectQueries.getProjectFor(assigned, c.engineer.roles, c.project.id); assert.ok(detail);
    assert.deepEqual(detail.products.map(row => row.id).sort(), [visible.id, currentProduction.id].sort());
    assert.ok(detail.products.every(row => row.expectedPrice === null));
    assert.deepEqual(detail.tasks.map(row => row.id), [ownTask.id]); assert.deepEqual(detail.files.map(row => row.id).sort(), visibleFiles.map(row => row.id).sort());
    for (const key of ["initialPrice", "delivery", "unloading", "installation"] as const) assert.equal(detail[key], null);
    const summary = (await projectQueries.listProjects(assigned, c.engineer.roles, { activeOnly: false })).rows.find(row => row.id === c.project.id)!;
    assert.equal(summary._count.products, 2); assert.equal(summary.totalPrice, null);
    assert.equal(await productQueries.getProductFor(assigned, c.engineer.roles, hidden.id), null);
  });
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

test("kp181/draft-per-item-native-relations-readers-and-revocation", async () => fixture.rollback(async (tx, rows) => {
  const c = await tree(tx, rows, "kp181-draft", "LEAD", "DRAFT");
  const sibling = await rows.product("kp181-crm-only", c.project.id, { status: "DRAFT", expectedPrice: "50", quantity: 2 });
  const otherProject = await rows.project("kp181-other-project");
  const proposal = await tx.commercialProposal.create({ data: { id: rows.id("kp181-proposal"), projectId: c.project.id, state: { items: [] } } });
  const item = await tx.proposalItem.create({ data: { id: rows.id("kp181-item"), proposalId: proposal.id, productId: c.product.id, position: 1, state: {} } });
  const task = await tx.task.create({ data: { projectId: c.project.id, productId: c.product.id, workId: c.work.id,
    assigneeId: c.engineer.id, title: "Черновая задача КП181", quantity: "1" } });
  const files = await Promise.all([true, false].map(direct => tx.file.create({ data: { projectId: c.project.id, productId: direct ? c.product.id : null,
    taskId: direct ? null : task.id, fileName: "kp181.pdf", storedName: randomUUID(), mimeType: "application/pdf", size: 1, uploadedById: c.engineer.id } })));
  const selected = await tx.product.findUniqueOrThrow({ where: { id: c.product.id }, include: productDraftAccessRelations });
  for (const roles of [["MANAGER"], ["MANAGER", "ENGINEER"], ["MANAGER", "WORKER"], ["MANAGER", "ACCOUNTANT"],
    ["ENGINEER"], ["ACCOUNTANT"], ["PROCUREMENT"], ["WORKER"], ["MOUNTER"], ["ADMIN"], ["DIRECTOR"]] as Role[][]) {
    const actor = { ...c.engineer, roles }, allowed = roles.some(role => ["ADMIN", "DIRECTOR", "MANAGER"].includes(role));
    assert.equal(visibility.canEditProductTechnicalBlock(actor, selected), allowed);
    assert.deepEqual(await Promise.all([
      tx.product.count({ where: { id: c.product.id, AND: [visibility.productVisibilityWhere(actor)] } }),
      tx.task.count({ where: { id: task.id, AND: [visibility.taskVisibilityWhere(actor)] } }),
      tx.work.count({ where: { id: c.work.id, AND: [visibility.workVisibilityWhere(actor)] } }),
      tx.file.count({ where: { id: { in: files.map(file => file.id) }, AND: [visibility.fileVisibilityWhere(actor)] } }),
    ]), [allowed ? 1 : 0, allowed ? 1 : 0, allowed ? 1 : 0, allowed ? 2 : 0]);
    if (!roles.includes("MANAGER")) continue;
    await run(actor, tx, async () => {
      assert.equal((await productQueries.getProductFor(actor.id, roles, c.product.id))?.canAccessDraft, true);
      assert.equal(await productQueries.getProductFor(actor.id, roles, sibling.id), null);
      const list = await productQueries.listProducts(actor.id, roles, { activeOnly: false, projectId: c.project.id, statuses: ["DRAFT"], q: "Проверка169" });
      assert.deepEqual(list.rows.map(row => row.id), [c.product.id]); assert.equal(list.total, 1);
      const project = await projectQueries.getProjectFor(actor.id, roles, c.project.id); assert.ok(project);
      assert.deepEqual(project.products.map(row => row.id), [c.product.id]);
      const summary = (await projectQueries.listProjects(actor.id, roles, { activeOnly: false })).rows.find(row => row.id === c.project.id)!;
      assert.equal(summary._count.products, 1); assert.equal(summary.totalPrice, 1100, "project finance still includes the hidden sibling");
    });
  }
  assert.equal((await statuses.changeProductStatusTransaction(tx, c.manager, c.product.id, "PREPARATION")).ok, false);
  const managerCount = () => tx.product.count({ where: { id: c.product.id, AND: [visibility.productVisibilityWhere(c.manager)] } });
  for (const [revoke, restore] of [
    [() => tx.proposalItem.update({ where: { id: item.id }, data: { deletedAt: new Date(0) } }), () => tx.proposalItem.update({ where: { id: item.id }, data: { deletedAt: null } })],
    [() => tx.commercialProposal.update({ where: { id: proposal.id }, data: { deletedAt: new Date(0) } }), () => tx.commercialProposal.update({ where: { id: proposal.id }, data: { deletedAt: null } })],
    [() => tx.commercialProposal.update({ where: { id: proposal.id }, data: { isArchive: true } }), () => tx.commercialProposal.update({ where: { id: proposal.id }, data: { isArchive: false } })],
    [() => tx.project.update({ where: { id: c.project.id }, data: { deletedAt: new Date(0) } }), () => tx.project.update({ where: { id: c.project.id }, data: { deletedAt: null } })],
  ]) {
    await revoke(); assert.equal(await managerCount(), 0); await restore(); assert.equal(await managerCount(), 1);
  }
  // Межтабличное равенство для реляционного grant обязана защищать сама БД.
  await rejectedSql(tx, () => tx.product.update({ where: { id: c.product.id }, data: { projectId: otherProject.id } }));
  await rejectedSql(tx, () => tx.commercialProposal.update({ where: { id: proposal.id }, data: { projectId: otherProject.id } }));
  const foreignProduct = await rows.product("kp181-foreign", otherProject.id, { status: "DRAFT" });
  await rejectedSql(tx, () => tx.proposalItem.update({ where: { id: item.id }, data: { productId: foreignProduct.id } }));
}));

test("kp181/native-composition-stable-ids-active-number-swap-client-mirror-replay-and-rollback", async () => fixture.rollback(async (tx, rows) => {
  const actor = actorOf(await rows.user("kp181-domain-manager", ["MANAGER"]));
  const result = await run(actor, tx, () => verifyProposalCompositionNative(tx, actor, proposals));
  assert.equal(result.sameIdRestore, true); assert.equal(result.rollbackNoNumberSpent, true); assert.equal(result.atomicFailureRollback, true);
}));

test("kp181/shared-project-quote-allocation-real-advisory-waiter-and-repeated-request", async () => {
  const actor = actorOf(await fixture.user("kp181-number-manager", ["MANAGER"]));
  const temporary = await fixture.db.client.create({ data: { id: fixture.id("kp181-number-temporary"), name: "Временный", phone: "KP181_SYNTHETIC" } });
  const hooks = { environment: { PERO_KP_TEMP_CLIENT_ID: temporary.id }, applyPricing: async () => ({ changed: false }) };
  const input = { operationId: randomUUID(), state: { items: [] } };
  const [normal, quote] = await overlap(actor,
    () => realTransaction(fixture.db)(tx => projectCore.createProjectInTransaction(tx, actor, { title: "КП181 обычный проект", clientId: temporary.id })),
    () => realTransaction(fixture.peer)(tx => proposals.createProposalInTransaction(tx, actor, input, hooks)), true);
  assert.equal(quote.result.number, String(normal.project.numberInt + 1));
  const results = await Promise.all(Array.from({ length: 5 }, () => run(actor, fixture.db,
    () => realTransaction(fixture.db)(tx => proposals.createProposalInTransaction(tx, actor, input, hooks)))));
  assert.ok(results.every(result => result.result.repeated && result.result.proposalId === quote.result.proposalId));
  assert.equal(await fixture.db.commercialProposal.count({ where: { projectId: quote.result.projectId } }), 1);
  assert.equal(await fixture.db.domainEvent.count({ where: { actor: actor.id, type: "kp.created" } }), 1);
});

for (const order of ["save-first", "stage-first"] as const) {
  test(`kp185/proposal-save-vs-lead-exit-${order}-real-advisory-waiter`, async () => {
    const user = await fixture.user(`kp185-${order}-manager`, ["MANAGER"]), actor = actorOf(user);
    const temporary = await fixture.db.client.create({ data: { id: fixture.id(`kp185-${order}-temporary`), name: "Временный", phone: "CI185_SYNTHETIC" } });
    const hooks = { environment: { PERO_KP_TEMP_CLIENT_ID: temporary.id }, applyPricing: async () => ({ changed: false }) };
    const binding: ActorBinding = { id: actor.id, source: "web", sessionVersion: user.sessionVersion };
    const ports: LifecyclePorts & LifecycleSecurity = {
      enabled: true,
      templateIdentity: () => ({ templateHash: "a".repeat(64), fontManifestHash: "b".repeat(64), sourceManifestHash: "c".repeat(64), chromium: "CI-SQL-only", puppeteer: "CI-SQL-only" }),
      pricingSnapshot: () => ({ scope: "concurrency metadata only; no pricing acceptance" }), mediaIds: () => [],
      authorizeSource: async (_tx, requested) => assert.deepEqual(requested, binding, "KP185_OWNED_ACTOR_BINDING_REQUIRED"),
    };
    const source = { order: { project: `КП185 ${order}` }, items: [
      { id: randomUUID(), name: "Исходная первая", qty: 2 }, { id: randomUUID(), name: "Исходная вторая", qty: 1 },
    ] };
    // Только SQL-метаданные выпуска, через настоящие server wrappers и очередь.
    // Stand-in не рендерится и не загружается: физический PDF/S3 этим сценарием не принимаются.
    const prepared = await run(actor, fixture.db, () => realTransaction(fixture.db)(async tx => {
      const created = await proposals.createProposalInTransaction(tx, actor, { operationId: randomUUID(), state: source }, hooks);
      const proposalId = created.result.proposalId;
      const requested = await requestProposalPdfInTransaction(tx, binding, { proposalId, expectedRevision: created.result.revision, operationId: randomUUID() }, ports);
      assert.equal(requested.kind, "job"); if (requested.kind !== "job") assert.fail("KP185_NEW_RELEASE_JOB_REQUIRED");
      const claim = await createPrismaRenderQueue(async operation => operation(tx)).claim(["PDF"], randomUUID(), 60_000, requested.jobId);
      assert.ok(claim, "KP185_REAL_LEASE_REQUIRED");
      const standIn = Buffer.from("%PDF-1.7\nCI SQL concurrency metadata only; not rendered or uploaded");
      const artifact = await recordPendingPdfArtifactInTransaction(tx, { claim, proposalId, artifact: {
        storageBinding: { endpoint: "http://127.0.0.1:9000", bucket: "native-sql-only" }, sha256: createHash("sha256").update(standIn).digest("hex"), size: standIn.length,
      } }, ports);
      const version = await publishSourcePdfInTransaction(tx, { claim, proposalId, artifactId: artifact.id, verified: artifact }, ports);
      await completeRenderJobInTransaction(tx, claim, { proposalId, versionId: version.id, pdfArtifactId: artifact.id }, ports);
      return { created: created.result, versionId: version.id, artifactId: artifact.id, jobId: claim.id };
    }));
    const { proposalId, projectId, revision } = prepared.created;
    const snapshot = async () => ({
      proposal: await fixture.db.commercialProposal.findUniqueOrThrow({ where: { id: proposalId } }),
      project: await fixture.db.project.findUniqueOrThrow({ where: { id: projectId } }),
      products: await fixture.db.product.findMany({ where: { projectId }, orderBy: { id: "asc" } }),
      items: await fixture.db.proposalItem.findMany({ where: { proposalId }, orderBy: { id: "asc" } }),
      statusHistory: await fixture.db.productStatusHistory.findMany({ where: { product: { projectId } }, orderBy: { id: "asc" } }),
      stageHistory: await fixture.db.projectStageHistory.findMany({ where: { projectId }, orderBy: { id: "asc" } }),
      receipts: await fixture.db.changeLog.findMany({ where: { entity: "commercialProposal", entityId: proposalId, action: "kp.write.receipt" }, orderBy: { id: "asc" } }),
      version: await fixture.db.proposalVersion.findUniqueOrThrow({ where: { id: prepared.versionId } }),
      artifact: await fixture.db.proposalArtifact.findUniqueOrThrow({ where: { id: prepared.artifactId } }),
      job: await fixture.db.proposalJob.findUniqueOrThrow({ where: { id: prepared.jobId } }),
    });
    const before = await snapshot();
    assert.equal(before.project.stage, "LEAD"); assert.equal(before.proposal.acceptedVersionId, null); assert.equal(before.proposal.acceptedAt, null);
    assert.equal(before.proposal.retentionEpoch, 0); assert.equal(before.version.revision, revision); assert.equal(before.artifact.state, "READY"); assert.equal(before.job.state, "SUCCEEDED");
    assert.deepEqual(before.version.state, before.proposal.state); assert.equal(before.receipts.length, 1); assert.equal(before.stageHistory.length, 1);
    const newItemId = randomUUID();
    const saveInput = { proposalId, expectedRevision: revision, operationId: randomUUID(), state: {
      ...prepared.created.state, order: { ...(prepared.created.state.order as Prisma.JsonObject), project: "Редакция после сохранения КП185" },
      items: [{ ...prepared.created.state.items[1], name: "Вторая стала первой" }, { id: newItemId, name: "Новая позиция КП185", qty: 3 }],
    } };
    const stageInput = { projectId, expectedStage: "LEAD", toStage: "ESTIMATE", clientMutationId: randomUUID() };
    const save = (db: PrismaClient) => realTransaction(db)(tx => proposals.saveProposalInTransaction(tx, actor, saveInput, hooks));
    const leaveLead = (db: PrismaClient) => realTransaction(db)(tx => stages.patchProjectStageTransaction(actor, stageInput, tx));
    const isLocked = (error: unknown) => typeof error === "object" && error !== null && "kind" in error && error.kind === "locked";
    const firstQuery = await run(actor, fixture.db, () => fence(`kp185-${order}-before-project-lock`));
    const assertProjectRowLock = async () => {
      // В каждом порядке producer работает на наблюдаемом db: проверяем настоящий FOR UPDATE,
      // отделённый fence от setup/replay; ожидающий peer уже доказан через pg_locks в overlap.
      await run(actor, fixture.db, () => fence(`kp185-${order}-project-lock`));
      assert.ok(fixture.queryEvents.slice(firstQuery).some(event => event.query.includes('FROM "Project"') && event.query.includes("FOR UPDATE") &&
        (JSON.parse(event.params) as unknown[]).includes(projectId)), "KP185_REAL_PROJECT_ROW_LOCK_REQUIRED");
    };

    if (order === "save-first") {
      // overlap требует двух PID, pg_blocking_pids и точный granted/waiting advisory tuple.
      const [saved, rejectedStage] = await overlap(actor, () => save(fixture.db), () => leaveLead(fixture.peer), true);
      await assertProjectRowLock();
      assert.equal(saved.result.revision, revision + 1); assert.equal(saved.result.noOp, false);
      assert.equal(rejectedStage.result.ok, false); assert.equal(rejectedStage.result.kind, "validation");
      assert.match(rejectedStage.result.error ?? "", /PDF актуальной редакции/); assert.deepEqual(rejectedStage.eventIds, []);
      const after = await snapshot();
      assert.equal(after.project.stage, "LEAD"); assert.equal(after.project.title, saveInput.state.order.project);
      assert.deepEqual(after.project.stageChangedAt, before.project.stageChangedAt, "KP185_REJECTED_EXIT_CHANGED_STAGE_TIMESTAMP");
      assert.equal(after.proposal.revision, revision + 1); assert.deepEqual(after.proposal.state, saved.result.state);
      assert.equal(after.proposal.acceptedVersionId, null); assert.equal(after.proposal.acceptedAt, null); assert.equal(after.proposal.retentionEpoch, 0);
      assert.deepEqual(after.stageHistory, before.stageHistory); assert.equal(after.receipts.length, 2);
      const removedProduct = before.products.find(product => product.id === prepared.created.items[0].productId)!;
      const removed = after.products.find(product => product.id === removedProduct.id)!;
      assert.ok(removed.deletedAt); assert.equal(removed.createdAt.toISOString(), removedProduct.createdAt.toISOString());
      const active = after.items.filter(item => !item.deletedAt).sort((a, b) => a.position - b.position);
      assert.deepEqual(active.map(item => ({ id: item.id, productId: item.productId, position: item.position })), [
        { id: source.items[1].id, productId: prepared.created.items[1].productId, position: 1 },
        { id: newItemId, productId: saved.result.items[1].productId, position: 2 },
      ]);
      assert.equal(after.products.filter(product => !product.deletedAt).length, 2);
      assert.ok(after.products.every(product => product.status === "DRAFT"));
      assert.deepEqual(after.statusHistory.filter(history => before.products.some(product => product.id === history.productId)), before.statusHistory);
      assert.equal(after.statusHistory.length, before.statusHistory.length + 1);
      assert.equal(await fixture.db.changeLog.findUnique({ where: { id: `project-stage:${stageInput.clientMutationId}` } }), null);
      assert.equal(await fixture.db.domainEvent.count({ where: { actor: actor.id, type: "project.stageChanged" } }), 0);
      assert.equal(await fixture.db.domainEvent.count({ where: { actor: actor.id, type: "kp.updated" } }), 1);
      const stable = await nativeSnapshot(fixture.db);
      const replay = await run(actor, fixture.db, () => save(fixture.db)); assert.equal(replay.result.repeated, true);
      assert.equal(replay.result.revision, revision + 1); assert.deepEqual(replay.result.items, saved.result.items);
      const repeatedStage = await run(actor, fixture.db, () => leaveLead(fixture.db)); assert.equal(repeatedStage.result.ok, false);
      assert.deepEqual(await nativeSnapshot(fixture.db), stable, "KP185_REJECTED_EXIT_OR_SAVE_REPLAY_WROTE_DATA");
    } else {
      const [changed] = await overlap(actor, () => leaveLead(fixture.db), () => assert.rejects(save(fixture.peer), isLocked), true);
      await assertProjectRowLock();
      assert.equal(changed.result.ok, true); assert.equal(changed.result.stage, "ESTIMATE"); assert.equal(changed.eventIds.length, 1);
      const after = await snapshot();
      assert.equal(after.project.stage, "ESTIMATE"); assert.equal(after.project.title, before.project.title);
      assert.equal(after.proposal.revision, revision); assert.deepEqual(after.proposal.state, before.proposal.state);
      assert.equal(after.proposal.acceptedVersionId, prepared.versionId); assert.ok(after.proposal.acceptedAt);
      assert.equal(after.proposal.retentionEpoch, before.proposal.retentionEpoch + 1);
      assert.deepEqual(after.products, before.products); assert.deepEqual(after.items, before.items); assert.deepEqual(after.statusHistory, before.statusHistory);
      assert.deepEqual(after.receipts, before.receipts, "KP185_REJECTED_SAVE_MUST_NOT_CREATE_RECEIPT");
      assert.equal(after.stageHistory.length, before.stageHistory.length + 1);
      assert.equal(after.stageHistory.filter(row => row.fromStage === "LEAD" && row.toStage === "ESTIMATE" && row.changedById === actor.id).length, 1);
      const receipt = await fixture.db.changeLog.findUniqueOrThrow({ where: { id: `project-stage:${stageInput.clientMutationId}` } });
      assert.equal(receipt.actorId, actor.id); assert.equal(receipt.entityId, projectId); assert.equal(receipt.action, "stage"); assert.equal(receipt.field, "stage");
      assert.equal(await fixture.db.domainEvent.count({ where: { actor: actor.id, type: "project.stageChanged" } }), 1);
      assert.equal(await fixture.db.domainEvent.count({ where: { actor: actor.id, type: "kp.updated" } }), 0);
      const stable = await nativeSnapshot(fixture.db);
      await assert.rejects(run(actor, fixture.db, () => save(fixture.db)), isLocked);
      const replay = await run(actor, fixture.db, () => leaveLead(fixture.db)); assert.equal(replay.result.replayed, true); assert.deepEqual(replay.eventIds, []);
      assert.deepEqual(await nativeSnapshot(fixture.db), stable, "KP185_REJECTED_SAVE_OR_STAGE_REPLAY_WROTE_DATA");
    }
    const final = await snapshot();
    assert.deepEqual(final.version, before.version); assert.deepEqual(final.artifact, before.artifact); assert.deepEqual(final.job, before.job);
    assert.equal(await fixture.db.proposalVersion.count({ where: { proposalId } }), 1, "KP185_RACE_MUST_NOT_MANUFACTURE_RELEASE");
  });
}

test("draft/create-contract-number-races-real-project-lock", async () => {
  const actors = await people(fixture, "draft-races");
  for (const direction of ["create-first", "contract-first"] as const) {
    const project = await fixture.project(direction, { stage: "ESTIMATE", managerId: actors.manager.id });
    const create = (db: PrismaClient) => products.createProductCore(actors.manager, { projectId: project.id, title: "Новый шкаф", quantity: 3, expectedPrice: 123.45 }, realTransaction(db));
    const contract = (db: PrismaClient) => realTransaction(db)(tx => stages.patchProjectStageTransaction(actors.manager,
      { projectId: project.id, expectedStage: "ESTIMATE", toStage: "CONTRACT", clientMutationId: randomUUID() }, tx));
    // Оба порядка ждут строку этого проекта; advisory этапа не блокирует создание изделия.
    if (direction === "create-first") {
      const [created, changed] = await overlap(actors.manager, () => create(fixture.db), () => contract(fixture.peer), false, project.id);
      assert.equal(created.ok, true); assert.equal(changed.result.ok, true); if (created.ok) assert.equal(created.product.status, "DRAFT");
    } else {
      const [changed, created] = await overlap(actors.manager, () => contract(fixture.db), () => create(fixture.peer), false, project.id);
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
  const firstPrice = await fixture.product("capture-race", project.id, { status: "PREPARATION", expectedPrice: null, initialPrice: null, initialPriceCaptureEligible: true });
  const prices = await overlap(actors.manager,
    () => products.updateProductCore(actors.manager, firstPrice.id, { expectedPrice: 10 }, { expectedPrice: null }, realTransaction(fixture.db)),
    () => products.updateProductCore(actors.manager, firstPrice.id, { expectedPrice: 20 }, { expectedPrice: null }, realTransaction(fixture.peer)));
  assert.equal(prices.filter(row => row.ok).length, 1); assert.equal(prices.filter(row => !row.ok).length, 1);
  const captured = await fixture.db.product.findUniqueOrThrow({ where: { id: firstPrice.id } });
  assert.equal(captured.initialPrice!.toFixed(2), captured.expectedPrice!.toFixed(2));
  assert.equal(await fixture.db.changeLog.count({ where: { entityId: firstPrice.id, action: "initialPrice.capture" } }), 1);
  const failedPrice = await fixture.product("capture-rollback", project.id, { status: "PREPARATION", expectedPrice: null, initialPrice: null, initialPriceCaptureEligible: true });
  const collision = await fixture.db.changeLog.create({ data: { actorType: "user", actorId: actors.manager.id, entity: "test", entityId: failedPrice.id, action: "fixture" } });
  const before = await nativeSnapshot(fixture.db);
  assert.equal((await run(actors.manager, fixture.db, () => products.updateProductCore(actors.manager, failedPrice.id, { expectedPrice: 25 }, { expectedPrice: null }, realTransaction(fixture.db)), { failAuditId: collision.id })).ok, false);
  assert.deepEqual(await nativeSnapshot(fixture.db), before);
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
  const deleted = await products.deleteProductCore({ ...c.manager, roles: ["MANAGER", "ENGINEER"] }, c.product.id, transactionIn(tx), baseline); assert.equal(deleted.ok, true);
  assert.deepEqual(await tx.timeEntry.findUnique({ where: { id: active.id } }), active);
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
  const liveProject = await rows.project("delete-audit-project"), liveProduct = await rows.product("delete-audit-product", liveProject.id, { status: "PREPARATION" });
  const collision = await tx.changeLog.create({ data: { actorType: "user", actorId: c.manager.id, entity: "test", entityId: liveProduct.id, action: "fixture" } });
  const before = await nativeSnapshot(tx);
  await rejectedSql(tx, () => productDeletion.softDeleteProductCore(commandTx(tx, { actor: c.manager, db: tx, failAuditId: collision.id }), c.manager,
    { productId: liveProduct.id, expectedUpdatedAt: liveProduct.updatedAt.toISOString(), clientMutationId: randomUUID() }), /Unique constraint/);
  assert.deepEqual(await nativeSnapshot(tx), before);
}));

test("quantity/locked-rescaling-group-floor-frozen-state-and-facts", async () => fixture.rollback(async (tx, rows) => {
  const c = await tree(tx, rows, "quantity"), group = await tx.taskAllocationGroup.create({ data: { workId: c.work.id, quantity: "4", budget: "120", currency: "BYN", createdById: c.manager.id } });
  const first = await rows.product("initial-eligible", c.project.id, { status: "PREPARATION", expectedPrice: null, initialPrice: null, initialPriceCaptureEligible: true });
  assert.equal((await products.updateProductCore(c.manager, first.id, { expectedPrice: 120 }, { expectedPrice: null }, transactionIn(tx))).ok, true);
  assert.equal((await tx.product.findUniqueOrThrow({ where: { id: first.id } })).initialPrice!.toFixed(2), "120.00");
  assert.equal((await products.updateProductCore(c.manager, first.id, { expectedPrice: 150 }, { expectedPrice: "120" }, transactionIn(tx))).ok, true);
  assert.equal((await tx.product.findUniqueOrThrow({ where: { id: first.id } })).initialPrice!.toFixed(2), "120.00");
  const legacy = await rows.product("initial-legacy", c.project.id, { status: "PREPARATION", expectedPrice: null, initialPrice: null, initialPriceCaptureEligible: false });
  assert.equal((await products.updateProductCore(c.manager, legacy.id, { expectedPrice: 120 }, { expectedPrice: null }, transactionIn(tx))).ok, true);
  assert.equal((await tx.product.findUniqueOrThrow({ where: { id: legacy.id } })).initialPrice, null);
  const zero = await rows.product("initial-zero", c.project.id, { status: "PREPARATION", expectedPrice: null, initialPrice: null, initialPriceCaptureEligible: true });
  assert.equal((await products.patchProductCore(c.manager, { productId: zero.id, field: "expectedPrice", value: "0", expectedValue: null, clientMutationId: randomUUID() }, transactionIn(tx))).kind, "saved");
  assert.equal((await tx.product.findUniqueOrThrow({ where: { id: zero.id } })).initialPrice!.toFixed(2), "0.00");
  const tariff = await tx.priceItem.create({ data: { name: rows.id("quantity-tariff"), unit: "шт.", price: "30", active: true } });
  const add = { projectId: c.project.id, productId: c.product.id, priceItemId: tariff.id, clientMutationId: randomUUID() };
  assert.equal((await worksCore.addWorkCore(c.manager, { ...add, quantity: 1 }, transactionIn(tx))).ok, false);
  const added = await worksCore.addWorkCore(c.manager, { ...add, quantityPerUnit: 1 }, transactionIn(tx)); assert.ok(added.ok);
  const work = await tx.work.findUniqueOrThrow({ where: { id: added.workId } });
  assert.equal(work.quantity.toFixed(2), "5.00"); assert.equal(work.total!.toFixed(2), "150.00");
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
    await assert.rejects(norms.updateMaterialNorm(tx, { id: line.id, quantityPerUnit: 5 }, c.manager), /Склад временно закрыт/);
    const current = await tx.product.findUniqueOrThrow({ where: { id: c.product.id } });
    assert.equal((await products.updateProductCore(c.manager, c.product.id, { title: phase }, { title: current.title }, transactionIn(tx))).ok, true);
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
  const onlyMaterial = await rows.product("quantity-only-material", c.project.id, { status: "PRODUCTION", quantity: 5 });
  await tx.projectMaterial.create({ data: { productId: onlyMaterial.id, materialId: c.material.id, quantity: "10", quantityPerUnit: "2", issuedQty: "8" } });
  assert.equal((await products.updateProductCore(c.manager, onlyMaterial.id, { quantity: 3 }, { quantity: 5 }, transactionIn(tx))).ok, false);
  assert.equal((await tx.product.findUniqueOrThrow({ where: { id: onlyMaterial.id } })).quantity, 5);
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
  const legacyIds = new Set(legacy.map(row => row.id));
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
        const eligible = await tx.task.findMany({ where: { AND: [workspace.taskWorkspaceBindings, expectedLimit, visibility.taskVisibilityWhere(actor)] }, select: { id: true, projectId: true }, orderBy: { id: "asc" } });
        const expected = eligible.filter(row => legacyIds.has(row.id));
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
  const dashboardEligible = await tx.task.findMany({ where: { AND: [workspace.taskWorkspaceBindings, dashboard] }, select: { id: true } });
  assert.equal(dashboardCount, dashboardEligible.filter(row => legacyIds.has(row.id)).length, "DASHBOARD_COUNT_MISMATCH");
  assert.equal(await tx.task.count({ where: await workspace.taskWorkspaceEligibility(tx, { projectIds: [] }) }), 0, "EMPTY_SCOPE_DENY_REQUIRED");
  const owned = nativeOwnedIds({ User: [own.id, foreignUser.id], Client: projects.map(project => project.clientId), Project: projects.map(project => project.id),
    Product: products.map(product => product.id), Work: [...works, unpriced, unbound].map(work => work.id), ProductStagePayPool: pools.map(pool => pool.id),
    TaskAllocationGroup: groups.map(group => group.id), Task: [...variants, foreign(0), ...additionalForeign].map(row => row.id!) });
  assert.deepEqual(await nativeSnapshot(tx, owned), before, "ORIGINAL_CHANGED_INSIDE_FIXTURE_TX");
  t.diagnostic(JSON.stringify({ matrixCases, dashboardCount, foreignTasks: [1, 10000], profile: { ...large.profile, rows: large.profile.rows.length }, plans }));
}));

test("warehouse/unit-catalog-CRUD-current-admin-inactive-usage-and-unchanged-numbers", async () => {
 await fixture.rollback(async (tx, rows) => {
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
  const collision = await tx.changeLog.create({ data: { actorType: "user", actorId: c.admin.id, entity: "test", entityId: created.id, action: "fixture" } });
  const snapshot = await nativeSnapshot(tx);
  await rejectedSql(tx, () => units.renameMaterialUnitInTransaction(commandTx(tx, { actor: c.admin, db: tx, failAuditId: collision.id }), c.admin, created.id, { name: "audit rollback" }), /Unique constraint/);
  assert.deepEqual(await nativeSnapshot(tx), snapshot);
 });
 const c = await tree(fixture.db, fixture, "unit-material-actions");
 await warehouseState(fixture.db, fixture);
 const alternate = await fixture.db.materialUnit.create({ data: { name: fixture.id("unit-material-alternate") } });
 await fixture.db.material.update({ where: { id: c.material.id }, data: { active: false, purchasePrice: "15.55" } });
 const norm = await fixture.db.projectMaterial.create({ data: { productId: c.product.id, materialId: c.material.id, quantity: "1.250", quantityPerUnit: "0.250", issuedQty: "0.125" } });
 const stock = await fixture.db.stockMovement.create({ data: { materialId: c.material.id, type: "INCOME", quantity: "10.325", unitPrice: "15.55", totalByn: "160.55" } });
 for (const role of ["ADMIN", "DIRECTOR", "MANAGER", "PROCUREMENT"] as Role[]) {
   assert.equal((await run({ ...c.manager, roles: [role] }, fixture.db, () => warehouseActions.updateMaterial(c.material.id, { name: c.material.name, unitId: alternate.id }))).ok, true);
   const material = await fixture.db.material.findUniqueOrThrow({ where: { id: c.material.id } });
   assert.equal(material.active, false); assert.equal(material.purchasePrice!.toFixed(2), "15.55"); assert.equal(material.unitId, alternate.id);
   assert.deepEqual(await fixture.db.projectMaterial.findUnique({ where: { id: norm.id } }), norm);
   assert.deepEqual(await fixture.db.stockMovement.findUnique({ where: { id: stock.id } }), stock);
 }
 const before = await fixture.db.material.findUniqueOrThrow({ where: { id: c.material.id } });
 for (const invalid of [{ name: c.material.name, unitId: fixture.id("missing-unit") }, { name: c.material.name, unitId: alternate.id, unit: "л" }, { name: c.material.name, unitId: alternate.id, purchasePrice: 1 }])
   assert.equal((await run(c.manager, fixture.db, () => warehouseActions.updateMaterial(c.material.id, invalid))).ok, false);
 await assert.rejects(run(c.engineer, fixture.db, () => warehouseActions.updateMaterial(c.material.id, { name: c.material.name, unitId: alternate.id })), /прав/);
 assert.deepEqual(await fixture.db.material.findUnique({ where: { id: c.material.id } }), before);
});

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
    return run(probe.actor, fixture.db, () => completion.changeTaskStatusCore(probe.actor, probe.taskId!, to, undefined,
      coordinator.withMutationTransaction, context), { mutation: probe });
  };
  const capture = async (taskId: string) => {
    // Сначала независимая SELECT-проверка committed facts; UNKNOWN не инициирует новую запись.
    const observed = await fixture.peer.task.findUniqueOrThrow({ where: { id: taskId } });
    assert.equal(observed.status, "IN_PROGRESS");
    assert.equal(await fixture.peer.domainEvent.count({ where: { payload: { path: ["taskId"], equals: taskId } } }), 1);
    assert.equal(await fixture.peer.timeEntry.count({ where: { taskId } }), 0);
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
    // Отдельный fixture месяц сохраняет receipts и real COMMIT, не попадая в turnover vectors за 2000-01.
    comment: "Проверка133", paidAt: "1900-01-15", clientMutationId });
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

test("task/piecework-real-two-connection-share-CAS-keeps-frozen-budget", async () => {
  const c = await tree(fixture.db, fixture, "piecework-race");
  const second = await fixture.user("piecework-race-second", ["WORKER"], { payScheme: "PIECE" });
  const third = await fixture.user("piecework-race-third", ["WORKER"], { payScheme: "PIECE" });
  const work = await fixture.db.work.update({ where: { id: c.work.id }, data: { quantity: "10", quantityPerUnit: "2", priceSnapshot: "100", total: "1000" },
    include: { tasks: { select: { id: true, quantity: true, allocationGroupId: true } } } });
  const created = await run(c.manager, fixture.db, () => pieceworkAllocation.createPieceworkAllocationCore(c.manager, {
    projectId: c.project.id, productId: c.product.id, workId: work.id, title: work.title, type: "Производство", quantity: "10", dueAt: "2026-11-01",
    expectedRevision: pieceworkPlanRevision(work), clientMutationId: randomUUID(),
    participants: [{ userId: c.worker.id, percent: "50" }, { userId: second.id, percent: "30" }, { userId: third.id, percent: "20" }],
  }));
  assert.ok(created.ok, "PIECEWORK191_INITIAL_GROUP_REQUIRED");
  const source = await fixture.db.task.findUniqueOrThrow({ where: { id: created.taskIds[0] } });
  const neighbours = await fixture.db.task.findMany({ where: { id: { in: created.taskIds.slice(1) } }, orderBy: { id: "asc" } });
  const input = { taskId: source.id, recipientId: second.id, percent: "50", expectedRevision: source.splitRevision, clientMutationId: randomUUID() };
  // Default adapter команды — withTaskTransaction; facade выбирает fixture.db/peer из каждого run.
  // overlap(..., true) доказывает разные backend PID, pg_blocking_pids и held/waiting advisory 18435/55001.
  const results = await overlap(c.worker,
    () => pieceworkAllocation.transferPieceworkShareCore(c.worker, input),
    () => pieceworkAllocation.transferPieceworkShareCore(c.worker, { ...input, clientMutationId: randomUUID() }), true);
  assert.equal(results.filter(result => result.ok).length, 1);
  const refused = results.find(result => !result.ok); assert.ok(refused && !refused.ok && refused.kind === "conflict");
  assert.deepEqual(await fixture.db.task.findMany({ where: { id: { in: created.taskIds.slice(1) } }, orderBy: { id: "asc" } }), neighbours);
  const parts = await fixture.db.task.findMany({ where: { allocationGroupId: created.groupId } });
  assert.equal(parts.length, 4); assert.equal(allocatedWorkQuantity(parts), "10.00");
  assert.equal(parts.reduce((sum, task) => sum + (task.shareUnits ?? 0), 0), 1000000);
  assert.equal(parts.reduce((sum, task) => sum + moneyAtoms(task.shareAmount!), BigInt(0)), BigInt(100000));
  assert.equal((await fixture.db.task.findUniqueOrThrow({ where: { id: source.id } })).shareAmount!.toFixed(2), "250.00");
  assert.equal(await fixture.db.payrollEntry.count({ where: { workId: work.id } }), 0);
  assert.equal(await fixture.db.changeLog.count({ where: { entityId: created.groupId, action: "piecework.v1" } }), 2);
  const committed = await nativeSnapshot(fixture.db);
  const replay = await run(c.worker, fixture.peer, () => pieceworkAllocation.transferPieceworkShareCore(c.worker, input));
  assert.ok(replay.ok && replay.repeated); assert.deepEqual(await nativeSnapshot(fixture.db), committed);
});

test("task/create-ten-identical-receipts-collisions-revocation-deleted-ACK-and-SQL-rollback", async () => {
  const c = await tree(fixture.db, fixture, "commands");
  await fixture.db.work.update({ where: { id: c.work.id }, data: { quantity: "10", quantityPerUnit: "2", priceSnapshot: "100", total: "1000" } });
  const predecessor = await fixture.db.task.create({ data: { projectId: c.project.id, productId: c.product.id, title: "Предшественник", status: "DONE" } });
  const input = { clientMutationId: randomUUID(), expectedActorId: c.manager.id, projectId: c.project.id, productId: c.product.id,
    workId: c.work.id, assigneeId: c.worker.id, title: "Один запрос", type: "Производство", quantity: 1, dueAt: "2026-10-12", dependencyIds: [predecessor.id] };
  const results = await Promise.all(Array.from({ length: 10 }, (_, index) => run(c.manager, index % 2 ? fixture.peer : fixture.db, () => tasks.createTask(input))));
  assert.ok(results.every(row => row.ok)); const first = results[0]; if (!first.ok) assert.fail("REAL_CREATE_ACK_REQUIRED");
  assert.ok(results.every(row => row.ok && row.resultId === first.resultId));
  const saved = await fixture.db.task.findUniqueOrThrow({ where: { id: first.resultId }, include: { dependencies: true } });
  assert.equal(saved.estimateMinutes, null);
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
  for (const kind of ["event", "receipt"] as const) {
    const title = `Откат ${kind}`, snapshot = await nativeSnapshot(fixture.db);
    const refused = await run(c.manager, fixture.db, () => tasks.createTask({ ...input, title, clientMutationId: randomUUID() }),
      { createFault: { kind, collisionId: collision.id, title } });
    assert.equal(refused.ok, false); assert.equal(refused.outcome, "ROLLED_BACK"); assert.deepEqual(await nativeSnapshot(fixture.db), snapshot);
  }
  const ackInput = { ...input, title: "SQL ACK", clientMutationId: randomUUID() }, ack = { lost: true, transactions: 0 };
  const recovered = await run(c.manager, fixture.db, () => tasks.createTask(ackInput), { createAck: ack });
  assert.equal(recovered.ok, true); assert.equal(recovered.outcome, "COMMITTED"); if (!recovered.ok) assert.fail("REAL_TASK_ACK_RECOVERY_REQUIRED");
  assert.equal(recovered.replayed, true); assert.ok(ack.transactions >= 2);
  const repeat = await run(c.manager, fixture.peer, () => tasks.createTask(ackInput)); assert.ok(repeat.ok && repeat.replayed);
  if (repeat.ok) assert.equal(repeat.resultId, recovered.resultId);
  assert.equal(await fixture.db.task.count({ where: { projectId: c.project.id, title: "SQL ACK" } }), 1);
  assert.equal(await fixture.db.changeLog.count({ where: { id: `task-create:${ackInput.clientMutationId}` } }), 1);
  assert.equal(await fixture.db.domainEvent.count({ where: { actor: c.manager.id, type: "task.assigned" } }), 2);
  const w = await tree(fixture.db, fixture, "worker-native"), recipient = await fixture.user("allocation-recipient", ["WORKER"]);
  const group = await fixture.db.taskAllocationGroup.create({ data: { workId: w.work.id, quantity: "2", budget: "60", currency: "BYN", createdById: w.manager.id } });
  const parts = await fixture.db.task.createManyAndReturn({ data: [w.worker, recipient].map(person => ({ projectId: w.project.id, productId: w.product.id, workId: w.work.id,
    title: "Старые доли", quantity: "2", allocationGroupId: group.id, assigneeId: person.id, shareUnits: 500000, shareAmount: "30" })) });
  const request = { projectId: w.project.id, productId: w.product.id, workId: w.work.id, assigneeId: recipient.id, title: w.work.title,
    type: "Производство", quantity: "2.00", dueAt: "2026-10-10", dependencyIds: [parts[0].id], clientMutationId: randomUUID() };
  await fixture.db.task.update({ where: { id: parts[1].id }, data: { projectId: c.project.id, productId: c.product.id } });
  assert.equal((await run(w.worker, fixture.db, () => workerAllocation.createWorkerTaskAllocationCore(w.worker, request, realTransaction(fixture.db)))).ok, false);
  assert.equal(await fixture.db.task.count({ where: { createdById: w.worker.id } }), 0);
  assert.equal(await fixture.db.changeLog.count({ where: { actorId: w.worker.id } }), 0);
  assert.equal(await fixture.db.domainEvent.count({ where: { actor: w.worker.id } }), 0);
  await fixture.db.task.update({ where: { id: parts[1].id }, data: { projectId: w.project.id, productId: w.product.id } });
  const allocation = await run(w.worker, fixture.db, () => workerAllocation.createWorkerTaskAllocationCore(w.worker, request, realTransaction(fixture.db))); assert.ok(allocation.ok);
  const original = await fixture.db.task.findUniqueOrThrow({ where: { id: allocation.id } });
  assert.equal(original.estimateMinutes, null);
  assert.equal(original.assigneeId, recipient.id); assert.equal(original.createdById, w.worker.id); assert.equal(original.quantity!.toFixed(2), "2.00"); assert.equal(original.allocationGroupId, null);
  assert.deepEqual((await fixture.db.taskDependency.findMany({ where: { taskId: original.id }, orderBy: { dependsOnId: "asc" } })).map(row => row.dependsOnId), parts.map(row => row.id).sort());
  const repeatedAllocation = await run(w.worker, fixture.db, () => workerAllocation.createWorkerTaskAllocationCore(w.worker, request, realTransaction(fixture.db))); assert.ok(repeatedAllocation.ok && repeatedAllocation.repeated);
  for (const invalid of [{ quantity: "3.00", clientMutationId: request.clientMutationId }, { assigneeId: w.engineer.id }, { quantity: "1.001" }, { quantity: "11" },
    { executorShare: 0.5 }, { estimateMinutes: 0 }, { dependencyIds: ["missing"] }]) {
    assert.equal((await run(w.worker, fixture.db, () => workerAllocation.createWorkerTaskAllocationCore(w.worker, { ...request, clientMutationId: randomUUID(), ...invalid }, realTransaction(fixture.db)))).ok, false);
  }
  await fixture.db.user.update({ where: { id: w.worker.id }, data: { roles: ["MANAGER"] } });
  assert.equal((await run(w.worker, fixture.db, () => workerAllocation.createWorkerTaskAllocationCore(w.worker, request, realTransaction(fixture.db)))).ok, false);
  await fixture.db.user.update({ where: { id: w.worker.id }, data: { roles: ["WORKER"] } });
  const allocationCollision = await fixture.db.domainEvent.create({ data: { actor: w.worker.id, type: "ci.allocation-collision", payload: {} } });
  const beforeAllocationFault = await nativeSnapshot(fixture.db);
  const fault = await run(w.worker, fixture.db, () => workerAllocation.createWorkerTaskAllocationCore(w.worker,
    { ...request, quantity: "1", dependencyIds: [], clientMutationId: randomUUID() }, realTransaction(fixture.db)), { failEventId: allocationCollision.id });
  assert.equal(fault.ok, false); assert.deepEqual(await nativeSnapshot(fixture.db), beforeAllocationFault);
  const race = await overlap(w.worker,
    () => workerAllocation.createWorkerTaskAllocationCore(w.worker, { ...request, quantity: "1", dependencyIds: [], clientMutationId: randomUUID() }, realTransaction(fixture.db)),
    () => workerAllocation.createWorkerTaskAllocationCore(w.worker, { ...request, quantity: "1", dependencyIds: [], clientMutationId: randomUUID() }, realTransaction(fixture.peer)));
  assert.equal(race.filter(row => row.ok).length, 1); assert.equal(race.filter(row => !row.ok).length, 1);
  await fixture.db.task.update({ where: { id: allocation.id }, data: { quantity: "3" } });
  const changedAllocation = await run(w.worker, fixture.db, () => workerAllocation.createWorkerTaskAllocationCore(w.worker, request, realTransaction(fixture.db)));
  assert.ok(!changedAllocation.ok && changedAllocation.kind === "conflict");
  const measuredWork = await fixture.db.work.create({ data: { projectId: w.project.id, productId: w.product.id, title: "Замер", paymentKind: "LEGACY", quantity: "1", priceSnapshot: "30", total: "30" } });
  const measure = { ...request, workId: measuredWork.id, quantity: "1", type: "Замер", dependencyIds: [], requiresPhoto: false, clientMutationId: randomUUID() };
  await fixture.db.user.update({ where: { id: recipient.id }, data: { active: false } });
  assert.equal((await run(w.worker, fixture.db, () => workerAllocation.createWorkerTaskAllocationCore(w.worker, measure, realTransaction(fixture.db)))).ok, false);
  await fixture.db.user.update({ where: { id: recipient.id }, data: { active: true } });
  const measuredPool = await fixture.db.productStagePayPool.create({ data: { id: fixture.id("measurement-legacy-pool"), productId: w.product.id, kind: "ENGINEERING", state: "DRAFT", createdById: w.manager.id } });
  await fixture.db.work.update({ where: { id: measuredWork.id }, data: { paymentKind: "ENGINEERING", stagePayPoolId: measuredPool.id, poolWeightUnits: 1_000_000 } });
  assert.equal((await run(w.worker, fixture.db, () => workerAllocation.createWorkerTaskAllocationCore(w.worker, measure, realTransaction(fixture.db)))).ok, false);
  await fixture.db.work.update({ where: { id: measuredWork.id }, data: { paymentKind: "LEGACY", stagePayPoolId: null, poolWeightUnits: null } });
  const measured = await run(w.worker, fixture.db, () => workerAllocation.createWorkerTaskAllocationCore(w.worker, measure, realTransaction(fixture.db))); assert.ok(measured.ok);
  const measuredTask = await fixture.db.task.findUniqueOrThrow({ where: { id: measured.id } }); assert.equal(measuredTask.requiresPhoto, true); assert.equal(measuredTask.status, "NEW");
  assert.equal(await fixture.db.changeLog.count({ where: { actorId: w.worker.id, action: "worker-allocation.receipt" } }), 3);
  assert.equal(await fixture.db.domainEvent.count({ where: { actor: w.worker.id, type: "task.assigned" } }), 3);
  await fixture.db.task.create({ data: { projectId: w.project.id, productId: w.product.id, workId: measuredWork.id, title: "Неизвестный старый объём", quantity: null } });
  const unknown = await run(w.worker, fixture.db, () => workerAllocation.createWorkerTaskAllocationCore(w.worker, { ...measure, quantity: "0.01", clientMutationId: randomUUID() }, realTransaction(fixture.db)));
  assert.ok(!unknown.ok); assert.match(unknown.error, /не определён объём/);
  await fixture.db.taskDependency.deleteMany({ where: { taskId: allocation.id } });
  await fixture.db.task.delete({ where: { id: allocation.id } });
  const missing = await run(w.worker, fixture.db, () => workerAllocation.createWorkerTaskAllocationCore(w.worker, request, realTransaction(fixture.db)));
  assert.ok(!missing.ok && missing.kind === "conflict"); assert.equal(await fixture.db.task.count({ where: { id: allocation.id } }), 0);
  const reader = actorOf(await fixture.user("journal-reader", ["ADMIN"])), businessId = fixture.id("journal-business"), stamp = new Date();
  await fixture.db.changeLog.createMany({ data: [
    ...Array.from({ length: 205 }, (_, index) => ({ id: `${index % 2 ? "task-create:" : "task-status:"}${randomUUID()}`, actorType: "user", actorId: reader.id,
      actorName: reader.name, entity: "task", entityId: fixture.id("journal-source"), action: index % 2 ? "task.create.request" : "task.status.request",
      newValue: { fingerprint: "PRIVATE_RECEIPT" }, createdAt: new Date(stamp.getTime() + 1000) })),
    { id: businessId, actorType: "user", actorId: reader.id, entity: "task", entityId: fixture.id("journal-source"), action: "create", createdAt: stamp },
  ] });
  assert.deepEqual((await run(reader, fixture.db, () => changelog.listGlobalChangeLog({ actor: reader.id, entity: "task" }))).map(row => row.id), [businessId]);
  assert.equal(await fixture.db.changeLog.count({ where: { actorId: reader.id } }), 206);
});

test("task/status-real-receipts-start-after-DONE-and-changed-context-refusal", async () => {
  const c = await tree(fixture.db, fixture, "status-command"), task = await fixture.db.task.create({ data: { projectId: c.project.id,
    productId: c.product.id, workId: c.work.id, assigneeId: c.worker.id, title: "Статус", quantity: "1", status: "NEW" } });
  const start = { clientMutationId: randomUUID(), expectedActorId: c.worker.id };
  assert.equal((await run(c.worker, fixture.db, () => tasks.changeTaskStatus(task.id, "IN_PROGRESS", undefined, start))).ok, true);
  const done = { clientMutationId: randomUUID(), expectedActorId: c.manager.id };
  const committed = await run(c.manager, fixture.db, () => tasks.changeTaskStatus(task.id, "DONE", undefined, done));
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
  const ownReceipt = { clientMutationId: randomUUID(), expectedActorId: c.worker.id };
  assert.equal((await run(c.worker, fixture.db, () => tasks.changeTaskStatus(other.id, "IN_PROGRESS", undefined, ownReceipt))).ok, true);
  const recipient = actorOf(await fixture.user("receipt-next-worker", ["WORKER"]));
  assert.equal((await run(c.manager, fixture.db, () => tasks.updateTask(other.id, { assigneeId: recipient.id }))).ok, true);
  const before = await nativeSnapshot(fixture.db);
  assert.equal((await run(c.worker, fixture.db, () => tasks.changeTaskStatus(other.id, "IN_PROGRESS"))).ok, false);
  const repeated = await run(c.worker, fixture.db, () => tasks.changeTaskStatus(other.id, "IN_PROGRESS", undefined, ownReceipt));
  assert.ok(repeated.ok && repeated.replayed);
  for (const key of ["task", "status", "payroll"]) assert.equal(key in repeated, false);
  assert.deepEqual(await nativeSnapshot(fixture.db), before);
});

test("task/time-retired-actions-read-start-complete-reassign-preserve-open-and-closed-history", async () => {
  const c = await tree(fixture.db, fixture, "retired-time");
  const recipient = actorOf(await fixture.user("retired-time-recipient", ["WORKER"], { payScheme: "PIECE" }));
  const task = await fixture.db.task.create({ data: { projectId: c.project.id, productId: c.product.id, workId: c.work.id,
    title: "Без учёта времени", quantity: "1", assigneeId: c.worker.id, status: "NEW", estimateMinutes: 45 } });
  const history = await fixture.db.timeEntry.createManyAndReturn({ data: [
    { taskId: task.id, userId: c.worker.id, source: "timer", startedAt: new Date(0) },
    { taskId: task.id, userId: c.worker.id, source: "timer", minutes: 1200, startedAt: new Date(0), stoppedAt: new Date(1) },
    { taskId: task.id, userId: c.worker.id, source: "manual", minutes: 0, stoppedAt: new Date(1) },
  ] });
  const before = [...history].sort((a, b) => a.id.localeCompare(b.id));
  await assert.rejects(run(c.worker, fixture.db, () => time.getActiveTimer(), { unauthenticated: true }), /Не авторизован/);
  assert.equal(await run(c.worker, fixture.db, () => time.getActiveTimer()), null);
  assert.equal((await run(c.worker, fixture.db, () => time.startTimer(task.id))).ok, false);
  assert.equal((await run(c.worker, fixture.db, () => time.stopTimer())).ok, false);
  assert.equal((await run(c.manager, fixture.db, () => time.addManualTime({ taskId: task.id, minutes: 20 }))).ok, false);
  assert.equal((await run(c.manager, fixture.db, () => tasks.deleteTask(task.id))).ok, false);
  assert.equal((await run(c.worker, fixture.db, () => tasks.changeTaskStatus(task.id, "IN_PROGRESS"))).ok, true);
  assert.equal((await run(c.manager, fixture.db, () => tasks.updateTask(task.id, { assigneeId: recipient.id, title: "Уточнено" }))).ok, true);
  const preserved = await fixture.db.task.findUniqueOrThrow({ where: { id: task.id } });
  assert.equal(preserved.estimateMinutes, 45); assert.equal(preserved.assigneeId, recipient.id);
  assert.equal((await run(c.manager, fixture.db, () => tasks.updateTask(task.id, { estimateMinutes: null }))).ok, false);
  assert.equal((await run(recipient, fixture.db, () => tasks.changeTaskStatus(task.id, "DONE"))).ok, true);
  assert.equal((await run(recipient, fixture.peer, () => tasks.changeTaskStatus(task.id, "DONE"))).ok, true);
  assert.equal(await fixture.db.payrollEntry.count({ where: { taskId: task.id } }), 1);
  assert.deepEqual(await fixture.db.timeEntry.findMany({ where: { taskId: task.id }, orderBy: { id: "asc" } }), before);
  assert.equal((await fixture.db.task.findUniqueOrThrow({ where: { id: task.id } })).estimateMinutes, 45);
});

test("task/parallel-DONE-and-reassignment-audit-rollback-leave-historical-timer-untouched", async () => {
  const c = await tree(fixture.db, fixture, "retired-time-races");
  await fixture.db.work.update({ where: { id: c.work.id }, data: { quantity: "100", quantityPerUnit: "20", priceSnapshot: "100", total: "10000" } });
  const seed = (title: string) => fixture.db.task.create({ data: { projectId: c.project.id, productId: c.product.id, workId: c.work.id,
    assigneeId: c.worker.id, title, quantity: "1", status: "NEW" } });
  const completing = await seed("Гонка завершения");
  const timer = await fixture.db.timeEntry.create({ data: { taskId: completing.id, userId: c.worker.id, source: "timer", startedAt: new Date(0) } });
  const results = await overlap(c.worker,
    () => completion.changeTaskStatusCore(c.worker, completing.id, "DONE", undefined, coordinator.withMutationTransaction),
    () => completion.changeTaskStatusCore(c.worker, completing.id, "DONE", undefined, coordinator.withMutationTransaction), true);
  assert.ok(results.every(row => row.ok));
  assert.equal(await fixture.db.payrollEntry.count({ where: { taskId: completing.id } }), 1);
  assert.equal((await fixture.db.payrollEntry.findFirstOrThrow({ where: { taskId: completing.id } })).amount.toFixed(2), "100.00");
  assert.deepEqual(await fixture.db.timeEntry.findUnique({ where: { id: timer.id } }), timer);
  const fault = await seed("Ошибка audit"), oldTimer = await fixture.db.timeEntry.create({ data: { taskId: fault.id, userId: c.worker.id, source: "timer", startedAt: new Date(0) } });
  const collision = await fixture.db.changeLog.create({ data: { id: fixture.id("retired-audit-collision"), actorType: "user", actorId: c.manager.id, entity: "test", entityId: "ci190", action: "fixture" } });
  const recipient = await fixture.user("retired-fault-recipient", ["WORKER"], { payScheme: "PIECE" });
  const before = await nativeSnapshot(fixture.db); let partial = 0;
  await assert.rejects(run(c.manager, fixture.db, () => tasks.updateTask(fault.id, { assigneeId: recipient.id }), {
    failAuditId: collision.id, beforeAudit: async tx => {
      assert.equal(await tx.task.count({ where: { id: fault.id, assigneeId: recipient.id } }), 1);
      assert.deepEqual(await tx.timeEntry.findUnique({ where: { id: oldTimer.id } }), oldTimer); partial++;
    },
  }));
  assert.equal(partial, 1); assert.deepEqual(await nativeSnapshot(fixture.db), before);
});

test("work/field-edit-self-assignment-CAS-current-roles-and-preserved-facts", async () => fixture.rollback(async (tx, rows) => {
  const transaction = transactionIn(tx);
  const worker = await rows.user("field-worker", ["WORKER"], { payScheme: "PIECE" }), mounter = await rows.user("field-mounter", ["MOUNTER"], { payScheme: "PIECE" });
  const combined = await rows.user("field-combined", ["WORKER", "MOUNTER"], { payScheme: "PIECE" }), actors = [worker, mounter, combined].map(actorOf);
  const project = await rows.project("field-works", { stage: "CONTRACT", currency: "BYN" });
  const production = await rows.product("field-production", project.id, { status: "PRODUCTION", quantity: 2 });
  const storage = await rows.product("field-storage", project.id, { status: "STORAGE", quantity: 2 });
  const installation = await rows.product("field-installation", project.id, { status: "INSTALLATION", quantity: 2 });
  const first = await tx.priceItem.create({ data: { name: "Первая", unit: "шт", price: "10" } });
  const next = await tx.priceItem.create({ data: { name: "Следующая", unit: "м.п.", price: "20" } });
  const create = { projectId: project.id, productId: storage.id, priceItemId: first.id, quantityPerUnit: 5, clientMutationId: randomUUID() };
  const added = await worksCore.addWorkCore(actors[0], create, transaction); assert.ok(added.ok); const workId = added.workId;
  assert.deepEqual(await worksCore.addWorkCore(actors[0], create, transaction), { ok: true, workId, repeated: true });
  assert.equal(await tx.work.count({ where: { productId: storage.id } }), 1);
  for (const [actor, productId] of [[actors[0], production.id], [actors[1], installation.id], [actors[2], production.id], [actors[2], storage.id], [actors[2], installation.id]] as const)
    assert.ok((await worksCore.addWorkCore(actor, { ...create, productId, clientMutationId: randomUUID() }, transaction)).ok);
  for (const [actor, productId] of [[actors[0], installation.id], [actors[1], production.id], [actors[1], storage.id]] as const)
    assert.equal((await worksCore.addWorkCore(actor, { ...create, productId, clientMutationId: randomUUID() }, transaction)).ok, false);
  assert.equal((await worksCore.addWorkCore(actors[0], { ...create, clientMutationId: randomUUID(), priceSnapshot: 1 }, transaction)).ok, false);
  assert.deepEqual(await workQueries.listWorkPriceOptions({ id: mounter.id, roles: ["MOUNTER"] }, production.id, tx), []);
  let operations = await workQueries.listProductWorkOperations(actors[0], storage.id, tx);
  assert.ok((await workUpdate.updateWorkCore(actors[0], { projectId: project.id, productId: storage.id, workId, quantityPerUnit: 5, priceItemId: next.id,
    expectedRevision: operations[workId].revision, clientMutationId: randomUUID() }, transaction)).ok);
  const repriced = await tx.work.findUniqueOrThrow({ where: { id: workId } });
  assert.equal(repriced.priceSnapshot!.toString(), "20"); assert.equal(repriced.unitSnapshot, "м.п."); assert.equal(repriced.quantity.toString(), "10");
  await tx.priceItem.update({ where: { id: next.id }, data: { price: "99" } });
  assert.equal((await tx.work.findUniqueOrThrow({ where: { id: workId } })).priceSnapshot!.toString(), "20");
  const self = { projectId: project.id, productId: storage.id, workId, title: "Своя задача", type: "Производство", quantity: "6.00", dueAt: "2026-10-12", dependencyIds: [], clientMutationId: randomUUID() };
  const taken = await workerAllocation.createOwnWorkTaskCore(actors[0], self, transaction); assert.ok(taken.ok); assert.equal(taken.assigneeId, worker.id);
  const repeated = await workerAllocation.createOwnWorkTaskCore(actors[0], self, transaction); assert.ok(repeated.ok && repeated.repeated);
  assert.equal((await workerAllocation.createOwnWorkTaskCore(actors[0], { ...self, clientMutationId: randomUUID(), assigneeId: mounter.id }, transaction)).ok, false);
  await tx.task.update({ where: { id: taken.id }, data: { status: "DONE", doneAt: new Date("2026-09-30T09:00Z"), doneById: worker.id } });
  await tx.timeEntry.create({ data: { taskId: taken.id, userId: worker.id, source: "manual", minutes: 30, startedAt: new Date("2026-09-30T08:30Z"), stoppedAt: new Date("2026-09-30T09:00Z") } });
  await tx.payrollEntry.create({ data: { userId: worker.id, taskId: taken.id, workId, productId: storage.id, projectId: project.id, amount: "120", bynAmount: "120", currency: "BYN", month: "2026-09", scheme: "PIECE" } });
  const snapshot = () => tx.task.findUniqueOrThrow({ where: { id: taken.id }, include: { timeEntries: true, payrollEntries: true } }), before = await snapshot();
  operations = await workQueries.listProductWorkOperations(actors[0], storage.id, tx);
  assert.equal(operations[workId].allocated, "6.00"); assert.equal(operations[workId].remaining, "4.00"); assert.equal(operations[workId].canChangePrice, false);
  assert.equal("priceSnapshot" in operations[workId], false); assert.equal("tasks" in operations[workId], false);
  const edit = { projectId: project.id, productId: storage.id, workId, quantityPerUnit: 6, expectedRevision: operations[workId].revision, clientMutationId: randomUUID() };
  assert.ok((await workUpdate.updateWorkCore(actors[0], edit, transaction)).ok);
  const editRepeat = await workUpdate.updateWorkCore(actors[0], edit, transaction); assert.ok(editRepeat.ok && editRepeat.repeated);
  operations = await workQueries.listProductWorkOperations(actors[0], storage.id, tx);
  assert.equal(operations[workId].allocated, "6.00"); assert.equal(operations[workId].remaining, "6.00");
  assert.equal((await tx.work.findUniqueOrThrow({ where: { id: workId } })).total!.toString(), "240");
  for (const denied of [{ ...edit, quantityPerUnit: 2.5, expectedRevision: operations[workId].revision }, { ...edit, priceItemId: first.id, expectedRevision: operations[workId].revision }, { ...edit }, { ...edit, priceSnapshot: "0" }])
    assert.equal((await workUpdate.updateWorkCore(actors[0], { ...denied, clientMutationId: randomUUID() }, transaction)).ok, false);
  assert.deepEqual(await snapshot(), before);
  const last = { ...self, quantity: "6.00", clientMutationId: randomUUID() }; assert.ok((await workerAllocation.createOwnWorkTaskCore(actors[0], last, transaction)).ok);
  assert.equal((await workerAllocation.createOwnWorkTaskCore(actors[0], { ...last, quantity: "0.01", clientMutationId: randomUUID() }, transaction)).ok, false);
  const lastRepeat = await workerAllocation.createOwnWorkTaskCore(actors[0], last, transaction); assert.ok(lastRepeat.ok && lastRepeat.repeated); assert.deepEqual(await snapshot(), before);
  const special = await tx.work.findFirstOrThrow({ where: { productId: storage.id, createdById: combined.id } });
  await tx.work.update({ where: { id: special.id }, data: { paymentKind: "INSTALLATION" } });
  const refused = await workUpdate.updateWorkCore(actors[0], { ...edit, workId: special.id, clientMutationId: randomUUID() }, transaction);
  assert.ok(!refused.ok); assert.equal(refused.kind, "validation");
  assert.equal((await workerAllocation.createOwnWorkTaskCore(actors[0], { ...last, workId: special.id, clientMutationId: randomUUID() }, transaction)).ok, false);
  const coordinator = await rows.user("field-coordinator", ["WORKER", "WORK_COORDINATOR"], { payScheme: "PIECE" }), coordinatorActor = actorOf(coordinator);
  const priceInput = { name: rows.id("coordinator-price"), unit: "шт.", price: 100 };
  const createdPrice = await run(coordinatorActor, tx, () => priceActions.createPriceItem(priceInput)); assert.ok(createdPrice.ok && createdPrice.id);
  const assigned = { projectId: project.id, productId: production.id, priceItemId: createdPrice.id, quantityPerUnit: 1 };
  const priorWork = await worksCore.addWorkCore(coordinatorActor, assigned, transaction); assert.ok(priorWork.ok);
  assert.equal((await run(coordinatorActor, tx, () => priceActions.updatePriceItem(createdPrice.id!, { ...priceInput, price: 125 }))).ok, true);
  const nextWork = await worksCore.addWorkCore(coordinatorActor, assigned, transaction); assert.ok(nextWork.ok);
  assert.equal((await tx.work.findUniqueOrThrow({ where: { id: priorWork.workId } })).priceSnapshot!.toString(), "100");
  const changedWork = await tx.work.findUniqueOrThrow({ where: { id: nextWork.workId } });
  assert.equal(changedWork.priceSnapshot!.toString(), "125"); assert.equal(changedWork.total!.toString(), "250");
  assert.equal(await tx.changeLog.count({ where: { entity: "priceItem", entityId: createdPrice.id, actorId: coordinator.id } }), 2);
  assert.equal(await tx.product.count({ where: { AND: [{ id: production.id }, visibility.productVisibilityWhere({ id: coordinator.id, roles: ["MOUNTER", "WORK_COORDINATOR"] })] } }), 0);
  const revoked = await tx.user.update({ where: { id: coordinator.id }, data: { roles: ["WORKER"] } });
  await assert.rejects(run(actorOf(revoked), tx, () => priceActions.updatePriceItem(createdPrice.id!, { ...priceInput, price: 999 })), /Недостаточно прав/);
  assert.equal((await tx.priceItem.findUniqueOrThrow({ where: { id: createdPrice.id } })).price.toString(), "125");
  for (const [actor, statuses] of [[actors[0], ["PRODUCTION", "STORAGE"]], [actors[1], ["INSTALLATION"]], [actors[2], ["PRODUCTION", "STORAGE", "INSTALLATION"]]] as [DomainActor, ProductStatus[]][]) {
    for (const product of [production, storage, installation]) {
      const work = await tx.work.findFirstOrThrow({ where: { productId: product.id } });
      const assigned = await tx.task.create({ data: { projectId: project.id, productId: product.id, workId: work.id, assigneeId: actor.id, title: "Назначение не расширяет статусы", quantity: "1" } });
      await tx.file.create({ data: { projectId: project.id, productId: product.id, taskId: assigned.id, fileName: "field.pdf", storedName: randomUUID(), mimeType: "application/pdf", size: 1, uploadedById: actor.id } });
    }
    const resolved = await visibility.resolveVisibilityActor(tx, actor);
    const selected = await tx.product.findMany({ where: { AND: [{ projectId: project.id }, visibility.productVisibilityWhere(resolved)] }, select: { id: true }, orderBy: { id: "asc" } });
    assert.deepEqual(selected.map(row => row.id), [production, storage, installation].filter(row => statuses.includes(row.status)).map(row => row.id).sort());
    assert.equal(await tx.task.count({ where: { AND: [{ projectId: project.id, product: { status: { notIn: statuses } } }, visibility.taskExecutionWhere(resolved)] } }), 0);
    assert.equal(await tx.work.count({ where: { AND: [{ projectId: project.id, product: { status: { notIn: statuses } } }, visibility.workVisibilityWhere(resolved)] } }), 0);
    assert.equal(await tx.file.count({ where: { AND: [{ projectId: project.id, OR: [{ product: { status: { notIn: statuses } } }, { task: { product: { status: { notIn: statuses } } } }] }, visibility.fileVisibilityWhere(resolved)] } }), 0);
  }
  const engineer = await rows.user("privacy-assigned-engineer", ["ENGINEER"]);
  const paidProduct = await rows.product("privacy-shares", project.id, { status: "PRODUCTION", quantity: 3, expectedPrice: "1000", initialPrice: "1200", engineerId: engineer.id, assemblerId: worker.id, mounterId: mounter.id });
  await tx.productPercentageConfig.createMany({ data: (["ENGINEERING", "ASSEMBLY", "INSTALLATION"] as const).map(kind => ({ productId: paidProduct.id, kind, ratePercent: "5", revision: 1 })) });
  for (const [person, ownKind, amount, status] of [[engineer, "ENGINEERING", 50, "PRODUCTION"], [worker, "ASSEMBLY", 150, "PRODUCTION"], [mounter, "INSTALLATION", 150, "INSTALLATION"]] as const) {
    await tx.product.update({ where: { id: paidProduct.id }, data: { status } });
    const view = await percentageQueries.getProductPercentageView(actorOf(person), paidProduct.id, tx);
    for (const [kind, section] of Object.entries(view.sections)) {
      for (const key of ["price", "unitPrice", "productTotal", "ratePercent", "currentRatePercent"] as const) assert.equal(section[key], null);
      assert.equal(Number(section.total), kind === ownKind ? amount : 0);
      if (kind !== ownKind) assert.deepEqual(section.members, []);
    }
  }
  const manager = actorOf(await rows.user("privacy-manager", ["MANAGER"]));
  await run(manager, tx, async () => assert.equal((await productQueries.getProductFor(manager.id, manager.roles, paidProduct.id))!.expectedPrice!.toString(), "1000"));
  await tx.product.update({ where: { id: paidProduct.id }, data: { deletedAt: new Date() } });
  for (const person of [manager, actorOf(engineer), actors[0], actors[1]]) await run(person, tx, async () => assert.equal(await productQueries.getProductFor(person.id, person.roles, paidProduct.id), null));
}));

test("calendar/real-duration-CAS-Moscow-boundaries-owner-analytics-and-totals", async () => fixture.rollback(async (tx, rows) => {
  const transaction = <T>(operation: (db: Prisma.TransactionClient) => Promise<T>) => operation(tx);
  const duration = await rows.user("calendar-duration", ["PROCUREMENT"], { calendarEnabled: true });
  const foreign = await rows.user("calendar-foreign", ["ADMIN"], { calendarEnabled: true });
  const input = { operation: "create" as const, entryId: randomUUID(), title: "Часы", localDateTime: "2026-10-07T09:00", plannedMinutes: 90, reminderOffsetMinutes: null };
  const created = await calendar.mutateCalendarCore(duration.id, input, transaction); assert.ok(created.ok); assert.equal(created.entry.plannedMinutes, 90);
  const repeated = await calendar.mutateCalendarCore(duration.id, input, transaction); assert.ok(repeated.ok && repeated.repeated);
  const conflict = await calendar.mutateCalendarCore(duration.id, { ...input, plannedMinutes: 60 }, transaction); assert.ok(!conflict.ok && conflict.kind === "conflict");
  const { plannedMinutes: omitted, ...oldInput } = input; assert.equal(omitted, 90);
  const old = await calendar.mutateCalendarCore(duration.id, { ...oldInput, operation: "update", expectedRevision: 0 }, transaction); assert.ok(old.ok); assert.equal(old.entry.plannedMinutes, 90);
  const done = await calendar.mutateCalendarCore(duration.id, { operation: "state", entryId: input.entryId, expectedRevision: 1, state: "COMPLETED" }, transaction); assert.ok(done.ok); assert.equal(done.entry.plannedMinutes, 90);
  for (const [revision, value] of [[2, null], [3, 0]] as const) {
    const reply = await calendar.mutateCalendarCore(duration.id, { ...input, operation: "update", expectedRevision: revision, plannedMinutes: value }, transaction);
    assert.ok(reply.ok); assert.equal(reply.entry.plannedMinutes, value);
  }
  const stale = await calendar.mutateCalendarCore(duration.id, { ...input, operation: "update", expectedRevision: 3 }, transaction); assert.ok(!stale.ok && stale.kind === "conflict");
  assert.deepEqual(await calendar.listCalendarMonthCore(foreign.id, "2026-10", transaction), []);
  const denied = await calendar.mutateCalendarCore(foreign.id, { ...input, operation: "update", expectedRevision: 4 }, transaction); assert.ok(!denied.ok); assert.equal(denied.code, "CALENDAR_ENTRY_NOT_FOUND");
  const legacy = await calendar.mutateCalendarCore(duration.id, { ...oldInput, entryId: randomUUID() }, transaction); assert.ok(legacy.ok); assert.equal(legacy.entry.plannedMinutes, null);
  assert.deepEqual((await calendar.listCalendarMonthCore(duration.id, "2026-10", transaction)).map(row => row.plannedMinutes).sort(), [0, null].sort());
  await rejectedSql(tx, () => tx.calendarEntry.update({ where: { id: input.entryId }, data: { plannedMinutes: -1 } }), /plannedMinutes_nonnegative/);
  await tx.user.update({ where: { id: duration.id }, data: { calendarEnabled: false } });
  await assert.rejects(calendar.listCalendarMonthCore(duration.id, "2026-10", transaction), /CALENDAR_DISABLED/);
  const disabled = await calendar.mutateCalendarCore(duration.id, { ...input, operation: "update", expectedRevision: 4 }, transaction); assert.ok(!disabled.ok); assert.equal(disabled.code, "CALENDAR_DISABLED");
  const owner = await rows.user("calendar-totals", ["PROCUREMENT"], { calendarEnabled: true }), plannedId = randomUUID();
  await tx.calendarEntry.createMany({ data: [
    { id: randomUUID(), ownerId: owner.id, title: "Начало месяца", startsAt: new Date("2026-09-30T21:00Z"), plannedMinutes: 30 },
    { id: plannedId, ownerId: owner.id, title: "Запланировано", startsAt: new Date("2026-10-07T06:00Z"), plannedMinutes: 90 },
    { id: randomUUID(), ownerId: owner.id, title: "Выполнено", startsAt: new Date("2026-10-07T07:00Z"), state: "COMPLETED", plannedMinutes: 60 },
    { id: randomUUID(), ownerId: owner.id, title: "Отменено", startsAt: new Date("2026-10-07T08:00Z"), state: "CANCELLED", plannedMinutes: 120 },
    { id: randomUUID(), ownerId: owner.id, title: "Пусто", startsAt: new Date("2026-10-07T09:00Z"), state: "COMPLETED", plannedMinutes: null },
    { id: randomUUID(), ownerId: owner.id, title: "Ноль", startsAt: new Date("2026-10-07T10:00Z"), plannedMinutes: 0 },
    { id: randomUUID(), ownerId: owner.id, title: "OUTSIDE_BEFORE", startsAt: new Date("2026-09-30T20:59:59.999Z"), plannedMinutes: 999 },
    { id: randomUUID(), ownerId: owner.id, title: "OUTSIDE_AFTER", startsAt: new Date("2026-10-31T21:00Z"), plannedMinutes: 999 },
    { id: randomUUID(), ownerId: foreign.id, title: "FOREIGN_SECRET", startsAt: new Date("2026-10-07T06:00Z"), plannedMinutes: 9999 },
  ] });
  const load = async () => summarizeCalendarEntries(await calendar.listCalendarMonthCore(owner.id, "2026-10", transaction));
  const initial = await load(); assert.equal(initial.total.hours.minutes, 180); assert.equal(initial.total.hours.missingCount, 1);
  assert.equal(initial.total.completedHours.minutes, 60); assert.equal(initial.total.completedCount, 2); assert.equal(initial.total.totalCount, 6);
  assert.equal(initial.days.find(day => day.date === "2026-10-07")?.summary.hours.minutes, 150);
  const extraIds = Array.from({ length: 4 }, () => randomUUID());
  await tx.calendarEntry.createMany({ data: [
    { id: extraIds[0], ownerId: owner.id, title: "Начало диапазона", startsAt: new Date("2026-10-06T21:00Z"), plannedMinutes: 15 },
    { id: extraIds[1], ownerId: owner.id, title: "Конец диапазона", startsAt: new Date("2026-10-08T20:59:59.999Z"), plannedMinutes: 45, state: "COMPLETED", updatedAt: new Date("2026-11-01") },
    { id: extraIds[2], ownerId: owner.id, title: "BEFORE_SECRET", startsAt: new Date("2026-10-06T20:59:59.999Z"), plannedMinutes: 111 },
    { id: extraIds[3], ownerId: owner.id, title: "AFTER_SECRET", startsAt: new Date("2026-10-08T21:00Z"), plannedMinutes: 111 },
  ] });
  const range = { from: "2026-10-07", to: "2026-10-08" }, result = await calendarAnalytics.loadCalendarAnalyticsCore(owner.id, range, transaction);
  assert.equal(result.entries.length, 7); assert.equal(result.summary.total.hours.minutes, 210); assert.equal(result.summary.total.completedCount, 3);
  assert.equal(result.summary.total.completedHours.minutes, 105); assert.equal(result.summary.total.hours.missingCount, 1);
  assert.deepEqual(result.summary.days.map(day => [day.date, day.summary.hours.minutes]), [["2026-10-07", 165], ["2026-10-08", 45]]);
  for (const secret of ["BEFORE_SECRET", "AFTER_SECRET", "FOREIGN_SECRET"]) assert.ok(!JSON.stringify(result).includes(secret));
  assert.equal((await calendarAnalytics.loadCalendarAnalyticsCore(foreign.id, range, transaction)).summary.total.hours.minutes, 9999);
  await assert.rejects(calendarAnalytics.loadCalendarAnalyticsCore(owner.id, { ...range, ownerId: foreign.id }, transaction));
  assert.deepEqual((await calendarAnalytics.loadCalendarAnalyticsCore(owner.id, { from: "2026-10-01", to: "2026-10-31" }, transaction)).summary, await load());
  const empty = await calendarAnalytics.loadCalendarAnalyticsCore(owner.id, { from: "2026-12-01", to: "2026-12-02" }, transaction);
  assert.equal(empty.summary.total.hours.minutes, 0); assert.equal(empty.entries.length, 0);
  await tx.calendarEntry.deleteMany({ where: { ownerId: owner.id, id: { in: extraIds } } });
  for (const [revision, state, minutes] of [[0, "CANCELLED", 90], [1, "PLANNED", 180]] as const) {
    assert.ok((await calendar.mutateCalendarCore(owner.id, { operation: "state", entryId: plannedId, expectedRevision: revision, state }, transaction)).ok);
    assert.equal((await load()).total.hours.minutes, minutes);
  }
  assert.ok((await calendar.mutateCalendarCore(owner.id, { operation: "update", entryId: plannedId, expectedRevision: 2, title: "Изменено", localDateTime: "2026-10-08T09:00", plannedMinutes: 120, reminderOffsetMinutes: null }, transaction)).ok);
  const moved = await load(); assert.equal(moved.total.hours.minutes, 210); assert.equal(moved.days.find(day => day.date === "2026-10-07")?.summary.hours.minutes, 60);
  assert.equal(moved.days.find(day => day.date === "2026-10-08")?.summary.hours.minutes, 120);
  await tx.user.update({ where: { id: owner.id }, data: { calendarEnabled: false } });
  await assert.rejects(calendarAnalytics.loadCalendarAnalyticsCore(owner.id, range, transaction), /CALENDAR_DISABLED/);
}));

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
  await tx.stockMovement.update({ where: { id: rows.id("expense-001") }, data: { unitPrice: "1", totalByn: "1" } });
  assert.equal((await warehouse.getProjectMaterialsBatch([ids[0]], c.users.admin, tx))[0].materialsTotalByn, 501);
  await tx.stockMovement.update({ where: { id: rows.id("expense-001") }, data: { unitPrice: null, totalByn: null } });
}));
