import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Prisma } from "@prisma/client";
import type { DomainActor } from "../src/server/projects/core";
import { configureEngineeringPool, configureEngineeringTaskShares, createEngineeringWorkCore, convertUnpaidWorkToEngineering, closeEngineeringStageCore, prepareEngineeringQuote } from "../src/server/product-stage-pay/core";
import { deliverEngineeringClosed, deliverEngineeringCreated } from "../src/server/product-stage-pay/post-commit";

const manager: DomainActor = { id: "manager", name: "Manager", roles: ["MANAGER"], source: "web" };
const worker: DomainActor = { id: "worker", name: "Worker", roles: ["WORKER"], source: "web" };
const noDb = new Proxy({}, { get: () => { throw new Error("unauthorized operation touched database"); } }) as Prisma.TransactionClient;

test("all engineering writers reject a non-manager before database access", async () => {
  await assert.rejects(configureEngineeringPool(worker, { productId: "p", ratePercent: "5.00", workWeights: [], expectedPoolRevision: 0 }, noDb), /прав/i);
  await assert.rejects(convertUnpaidWorkToEngineering(worker, { workId: "w", poolId: "pool", poolWeights: [], taskShares: [], expectedPoolRevision: 0, requestId: randomUUID() }, noDb), /прав/i);
  await assert.rejects(closeEngineeringStageCore(worker, { productId: "p", expectedPoolRevision: 0, requestId: randomUUID() }, {
    fingerprint: "test", rates: { asOf: "2026-09-28", product: { currency: "BYN", rate: "1.000000", date: "2026-09-28" },
      payroll: { currency: "BYN", rate: "1.000000", date: "2026-09-28" } },
  }, noDb), /прав/i);
});

test("configure requires an existing product", async () => {
  const tx = { product: { findUnique: async () => null } } as unknown as Prisma.TransactionClient;
  await assert.rejects(configureEngineeringPool(manager, { productId: "missing", ratePercent: "0.00", workWeights: [], expectedPoolRevision: 0 }, tx), /изделие/i);
});

test("manager explicitly enables a draft on an existing design product; legacy protection refuses", async () => {
  const f = fixture();
  f.product.stagePayPools.length = 0;
  f.pool.works.length = 0;
  f.db.productStagePayPool.create = (async () => { f.writes.push("pool.create"); return f.pool; }) as never;
  f.db.productStagePayPool.findUnique = (async () => null) as never;
  await configureEngineeringPool(manager, { productId: "p", ratePercent: "0.00", workWeights: [], expectedPoolRevision: 0 }, f.db);
  assert.deepEqual(f.writes, ["pool.create", "pool"]);
  f.product.stagePayPools.push(f.pool);
  f.pool.state = "LEGACY_PROTECTED";
  f.writes.length = 0;
  await assert.rejects(configureEngineeringPool(manager, { productId: "p", ratePercent: "5.00", workWeights: [{ workId: "w", units: 1_000_000 }], expectedPoolRevision: 0 }, f.db), /историческим/);
  assert.deepEqual(f.writes, []);
});

function fixture() {
  const writes: string[] = [];
  const task = { id: "t", workId: "w", projectId: "j", productId: "p", status: "DONE", assigneeId: "u", assignee: { id: "u", name: "User" },
    stageShareUnits: 1_000_000, splitRevision: 0, quantity: { toString: () => "1.00" }, shareUnits: 1_000_000, allocationGroupId: "g",
    allocationGroup: { id: "g", workId: "w", quantity: { toString: () => "1.00" } }, createdAt: new Date("2026-01-01"), title: "Task" };
  const work = { id: "w", projectId: "j", productId: "p", paymentKind: "ENGINEERING", stagePayPoolId: "pool", poolWeightUnits: 1_000_000,
    createdAt: new Date("2026-01-01"), title: "Work", tasks: [task] };
  const pool = { id: "pool", kind: "ENGINEERING", state: "DRAFT", revision: 0, ratePercent: { toString: () => "5.00" },
    legacyPayrollEntryIds: [], works: [work] };
  const product = { id: "p", number: "205.1", title: "Desk", projectId: "j", status: "DESIGN", expectedPrice: { toString: () => "100.00" }, engineerId: "u",
    engineer: { id: "u", name: "User" }, project: { id: "j", number: "205", currency: "BYN" }, works: [work], stagePayPools: [pool] };
  const db = { product: { findUnique: async () => product }, orgSetting: { findUnique: async () => null },
    work: { update: async () => { writes.push("work"); } },
    productStagePayPool: { update: async () => { writes.push("pool"); return pool; } },
    productStageSettlement: { count: async () => 0, create: async () => ({ id: "s" }) },
    productStageSettlementShare: { create: async () => ({ id: "ss" }) },
    payrollEntry: { count: async () => 0, create: async () => ({ id: "e" }) },
    productStatusHistory: { create: async () => ({ id: "h" }) },
    domainEvent: { create: async () => ({ id: "event" }) },
    changeLog: { findUnique: async () => null, create: async () => ({ id: "receipt" }) } } as unknown as Prisma.TransactionClient;
  return { db, product, pool, work, task, writes };
}

test("configure enforces complete weights and optimistic pool revision before any write", async () => {
  const f = fixture();
  const audits: unknown[] = [];
  f.db.changeLog.create = (async ({ data }: { data: unknown }) => { audits.push(data); f.writes.push("audit"); return { id: "audit" }; }) as never;
  await assert.rejects(configureEngineeringPool(manager, { productId: "p", ratePercent: "0.00", workWeights: [{ workId: "w", units: 999_999 }], expectedPoolRevision: 0 }, f.db), /100/);
  await assert.rejects(configureEngineeringPool(manager, { productId: "p", ratePercent: "0.00", workWeights: [{ workId: "w", units: 1_000_000 }], expectedPoolRevision: 1 }, f.db), /изменились/);
  assert.deepEqual(f.writes, []);
  await configureEngineeringPool(manager, { productId: "p", ratePercent: "0.00", workWeights: [{ workId: "w", units: 1_000_000 }], expectedPoolRevision: 0 }, f.db);
  assert.deepEqual(f.writes, ["work", "pool", "audit"]);
  assert.deepEqual((audits[0] as { oldValue: unknown; newValue: unknown }).oldValue, { ratePercent: "5.00", workWeights: [{ workId: "w", units: 1_000_000 }] });
  assert.deepEqual((audits[0] as { newValue: unknown }).newValue, { ratePercent: "0.00", workWeights: [{ workId: "w", units: 1_000_000 }] });
});

test("task share configuration requires full 100 percent mapping and current revisions", async () => {
  const f = fixture();
  f.db.payrollEntry.count = (async () => 0) as never;
  const base = { productId: "p", workId: "w", shares: [{ taskId: "t", units: 1_000_000, expectedRevision: 0 }], expectedPoolRevision: 0 };
  await assert.rejects(configureEngineeringTaskShares(manager, { ...base, shares: [] }, f.db), /всех задач/);
  await assert.rejects(configureEngineeringTaskShares(manager, { ...base, shares: [{ ...base.shares[0], expectedRevision: 1 }] }, f.db), /изменились/);
  assert.deepEqual(f.writes, []);
});

test("manager can assign zero and full task shares without changing completed task facts", async () => {
  const f = fixture();
  const second = { ...f.task, id: "t2", assigneeId: "other", stageShareUnits: 0, splitRevision: 2, title: "Second" };
  f.work.tasks.push(second);
  f.db.payrollEntry.count = (async () => 0) as never;
  const audits: unknown[] = [];
  f.db.changeLog.create = (async ({ data }: { data: unknown }) => { audits.push(data); f.writes.push("audit"); return { id: "audit" }; }) as never;
  f.db.productStagePayPool.findUnique = (async () => ({ ...f.pool, productId: "p" })) as never;
  Object.assign(f.db, { task: { update: async ({ where, data }: { where: { id: string }; data: { stageShareUnits: number } }) => {
    f.writes.push(`task:${where.id}:${data.stageShareUnits}`);
  } } });
  const original = { status: f.task.status, quantity: f.task.quantity.toString(), assigneeId: f.task.assigneeId };
  const result = await configureEngineeringTaskShares(manager, { productId: "p", workId: "w", expectedPoolRevision: 0,
    shares: [{ taskId: "t", units: 0, expectedRevision: 0 }, { taskId: "t2", units: 1_000_000, expectedRevision: 2 }] }, f.db);
  assert.deepEqual(result, { poolId: "pool", revision: 1, changedTaskIds: ["t", "t2"] });
  assert.deepEqual(f.writes, ["task:t:0", "task:t2:1000000", "pool", "audit"]);
  assert.deepEqual((audits[0] as { newValue: unknown }).newValue, { shares: [
    { taskId: "t", units: 0, revision: 1 }, { taskId: "t2", units: 1_000_000, revision: 3 },
  ] });
  assert.deepEqual({ status: f.task.status, quantity: f.task.quantity.toString(), assigneeId: f.task.assigneeId }, original);
});

test("compound engineering work writes Work/Task audit and task.created plus task.assigned outbox inside transaction", async () => {
  const f = fixture();
  f.pool.works.length = 0;
  f.product.works.length = 0;
  const logs: { entity: string; action: string; newValue: unknown }[] = [];
  const events: { type: string; payload: unknown }[] = [];
  Object.assign(f.db, { user: { findUnique: async () => ({ id: "u", active: true, roles: ["ENGINEER"] }) },
    taskAllocationGroup: { create: async () => ({ id: "g" }) }, task: { create: async () => ({ id: "t", title: "Design" }) } });
  f.db.work.create = (async () => ({ id: "w" })) as never;
  f.db.productStagePayPool.findUnique = (async () => ({ ...f.pool, productId: "p" })) as never;
  f.db.changeLog.create = (async ({ data }: { data: { entity: string; action: string; newValue: unknown } }) => { logs.push(data); return { id: "log" }; }) as never;
  f.db.domainEvent.create = (async ({ data }: { data: { type: string; payload: unknown } }) => { events.push(data); return { id: `event${events.length}` }; }) as never;
  const result = await createEngineeringWorkCore(manager, { productId: "p", title: "Design", quantity: "1.00", assigneeId: "u",
    dueAt: new Date("2026-10-01"), estimateMinutes: 60, poolWeights: [{ workId: "__new__", units: 1_000_000 }], expectedPoolRevision: 0 }, f.db);
  assert.deepEqual(logs.map((row) => [row.entity, row.action]), [["work", "create"], ["task", "create"]]);
  assert.deepEqual((logs[0] as { oldValue?: unknown }).oldValue, { workWeights: [] });
  assert.deepEqual(events.map((row) => row.type), ["task.created", "task.assigned"]);
  assert.deepEqual(result.eventIds, ["event1", "event2"]);
});

test("task-share writer rejects a foreign work, settled pool and already paid task", async () => {
  const f = fixture();
  let paid = 0;
  f.db.payrollEntry.count = (async () => paid) as never;
  const base = { productId: "p", workId: "w", shares: [{ taskId: "t", units: 1_000_000, expectedRevision: 0 }], expectedPoolRevision: 0 };
  await assert.rejects(configureEngineeringTaskShares(manager, { ...base, workId: "foreign" }, f.db), /не принадлежит/);
  f.pool.state = "SETTLED";
  await assert.rejects(configureEngineeringTaskShares(manager, base, f.db), /недоступен/);
  f.pool.state = "DRAFT";
  paid = 1;
  await assert.rejects(configureEngineeringTaskShares(manager, base, f.db), /начисление/);
  assert.deepEqual(f.writes, []);
});

test("a task status change after FX preparation invalidates close without any writes", async () => {
  const f = fixture();
  const quote = await prepareEngineeringQuote("p", f.db, new Date("2026-09-28T12:00:00Z"));
  f.task.status = "IN_PROGRESS";
  await assert.rejects(closeEngineeringStageCore(manager, { productId: "p", expectedPoolRevision: 0, requestId: randomUUID() }, quote, f.db), /изменились/);
  assert.deepEqual(f.writes, []);
});

test("ready close writes one settlement, all shares, positive payroll, history and outbox through the supplied transaction", async () => {
  const f = fixture();
  const entries: unknown[] = [];
  const shares: unknown[] = [];
  const events: { type: string; payload: unknown }[] = [];
  const logs: { action: string; field?: string; oldValue?: unknown; newValue?: unknown }[] = [];
  f.db.payrollEntry.count = (async () => 0) as never;
  f.db.productStageSettlement.count = (async () => 0) as never;
  f.db.productStageSettlement.create = (async ({ data }: { data: unknown }) => { f.writes.push("settlement"); return { id: "s", ...data as object }; }) as never;
  f.db.productStageSettlementShare.create = (async ({ data }: { data: unknown }) => { f.writes.push("share"); shares.push(data); return { id: "ss" }; }) as never;
  f.db.payrollEntry.create = (async ({ data }: { data: unknown }) => { f.writes.push("payroll"); entries.push(data); return { id: "e" }; }) as never;
  f.db.product.update = (async () => { f.writes.push("product"); }) as never;
  f.db.productStatusHistory.create = (async () => { f.writes.push("history"); }) as never;
  f.db.changeLog.create = (async ({ data }: { data: { action: string; field?: string; oldValue?: unknown; newValue?: unknown } }) => {
    f.writes.push("receipt"); logs.push(data);
  }) as never;
  f.db.domainEvent.create = (async ({ data }: { data: { type: string; payload: unknown } }) => { f.writes.push("outbox"); events.push(data); return { id: `event${events.length}` }; }) as never;
  const quote = await prepareEngineeringQuote("p", f.db);
  const result = await closeEngineeringStageCore(manager, { productId: "p", expectedPoolRevision: 0, requestId: randomUUID() }, quote, f.db);
  assert.deepEqual(result.eventIds, ["event1", "event2", "event3"]);
  assert.deepEqual(events.map((row) => row.type), ["payroll.accrued", "product.statusChanged", "product.engineeringSettled"]);
  assert.deepEqual((events[0].payload as { amount: unknown }).amount, 5);
  assert.deepEqual(events[1].payload, { productId: "p", number: "205.1", from: "DESIGN", to: "PRODUCTION" });
  assert.deepEqual(logs.map((row) => [row.action, row.field ?? null]), [["engineering.close", null], ["status", "status"]]);
  assert.deepEqual(f.writes, ["settlement", "share", "payroll", "outbox", "pool", "product", "history", "receipt", "receipt", "outbox", "outbox"]);
  assert.equal(shares.length, 1);
  assert.equal(entries.length, 1);
  assert.deepEqual({ amount: (entries[0] as { amount: string }).amount, currency: (entries[0] as { currency: string }).currency,
    scheme: (entries[0] as { scheme: string }).scheme }, { amount: "5.00", currency: "BYN", scheme: "PRODUCT_ENGINEERING" });
});

test("close rejects any already paid engineering Work or Task before settlement writes", async () => {
  for (const paidBy of ["work", "task"]) {
    const f = fixture();
    f.db.productStageSettlement.count = (async () => 0) as never;
    const existingPiece = { scheme: "PIECE", workId: paidBy === "work" ? "w" : null, taskId: paidBy === "task" ? "t" : null };
    f.db.payrollEntry.count = (async ({ where }: { where: { OR?: { workId?: { in: string[] }; taskId?: { in: string[] } }[] } }) => {
      if (!where.OR) return 0;
      assert.deepEqual(where.OR[0]?.workId?.in, ["w"]);
      assert.deepEqual(where.OR[1]?.taskId?.in, ["t"]);
      return where.OR.some((clause) => (existingPiece.workId && clause.workId?.in.includes(existingPiece.workId)) ||
        (existingPiece.taskId && clause.taskId?.in.includes(existingPiece.taskId))) ? 1 : 0;
    }) as never;
    const quote = await prepareEngineeringQuote("p", f.db);
    await assert.rejects(closeEngineeringStageCore(manager, { productId: "p", expectedPoolRevision: 0, requestId: randomUUID() }, quote, f.db), /начисление/,
      paidBy);
    assert.deepEqual(f.writes, []);
  }
});

test("repeat close receipt requires the same entity and action", async () => {
  const f = fixture();
  f.db.changeLog.findUnique = (async () => ({ actorId: manager.id, entityId: "p", action: "unrelated", newValue: {
    expectedPoolRevision: 0, settlementId: "old" } })) as never;
  await assert.rejects(closeEngineeringStageCore(manager, { productId: "p", expectedPoolRevision: 0, requestId: randomUUID() }, null, f.db), /использован/);
});

test("repeat close returns the original settlement after product advances, without requiring FX", async () => {
  const f = fixture();
  f.product.status = "DONE";
  f.db.changeLog.findUnique = (async () => ({ actorId: manager.id, entity: "product", entityId: "p", action: "engineering.close",
    newValue: { expectedPoolRevision: 0, settlementId: "old" } })) as never;
  const result = await closeEngineeringStageCore(manager, { productId: "p", expectedPoolRevision: 0, requestId: randomUUID() }, null, f.db);
  assert.deepEqual(result, { settlementId: "old", repeated: true, eventId: null, eventIds: [], earnings: [], product: null });
  assert.deepEqual(f.writes, []);
});

test("zero rate still requires a DONE task", async () => {
  const f = fixture();
  f.pool.ratePercent = { toString: () => "0.00" };
  f.task.status = "NEW";
  const quote = await prepareEngineeringQuote("p", f.db);
  f.db.productStageSettlement.count = (async () => 0) as never;
  f.db.payrollEntry.count = (async () => 0) as never;
  await assert.rejects(closeEngineeringStageCore(manager, { productId: "p", expectedPoolRevision: 0, requestId: randomUUID() }, quote, f.db), /Завершите/);
  assert.deepEqual(f.writes, []);
});

test("zero fund settles all task shares and creates no payroll entries", async () => {
  const f = fixture();
  f.pool.ratePercent = { toString: () => "0.00" };
  const shares: unknown[] = [];
  f.db.productStageSettlement.create = (async () => ({ id: "s" })) as never;
  f.db.productStageSettlementShare.create = (async ({ data }: { data: unknown }) => { shares.push(data); return { id: "ss" }; }) as never;
  f.db.payrollEntry.create = (async () => { throw new Error("zero amount must not create PayrollEntry"); }) as never;
  f.db.product.update = (async () => ({})) as never;
  const quote = await prepareEngineeringQuote("p", f.db);
  const result = await closeEngineeringStageCore(manager, { productId: "p", expectedPoolRevision: 0, requestId: randomUUID() }, quote, f.db);
  assert.equal(result.settlementId, "s");
  assert.equal(shares.length, 1);
  assert.equal((shares[0] as { amount: string }).amount, "0.00");
});

test("conversion rejects paid work and incomplete task mapping without changing legacy data", async () => {
  const f = fixture();
  const legacyTask = { ...f.task, stageShareUnits: null, shareAmount: { toString: () => "12.34" },
    allocationGroup: { id: "g", workId: "w", quantity: { toString: () => "1.00" } } };
  const legacyWork = { ...f.work, paymentKind: "LEGACY", stagePayPoolId: null, poolWeightUnits: null,
    quantity: { toString: () => "1.00" }, priceSnapshot: { toString: () => "12.34" }, total: { toString: () => "12.34" },
    tasks: [legacyTask], allocationGroups: [{ id: "g", workId: "w", quantity: { toString: () => "1.00" },
      budget: { toString: () => "12.34" }, currency: "BYN", budgetSource: "TASK_FIXED" }] };
  f.pool.works.length = 0;
  f.db.productStagePayPool.findUnique = (async () => ({ ...f.pool, productId: "p", product: f.product })) as never;
  f.db.work.findUnique = (async () => legacyWork) as never;
  Object.assign(f.db, { workPaymentConversion: { findUnique: async () => null, create: async () => ({ id: "receipt" }) } });
  let paid = 1;
  f.db.payrollEntry.count = (async () => paid) as never;
  const base = { workId: "w", poolId: "pool", poolWeights: [{ workId: "w", units: 1_000_000 }],
    taskShares: [{ taskId: "t", units: 1_000_000, expectedRevision: 0 }], expectedPoolRevision: 0, requestId: randomUUID() };
  await assert.rejects(convertUnpaidWorkToEngineering(manager, base, f.db), /начисление/);
  paid = 0;
  await assert.rejects(convertUnpaidWorkToEngineering(manager, { ...base, taskShares: [] }, f.db), /всех задач/);
  assert.deepEqual(f.writes, []);
  assert.equal(legacyTask.shareAmount.toString(), "12.34");
});

test("post-commit delivery tolerates failed notifications and emits nothing on replay", async () => {
  const calls: string[] = [];
  const effects = {
    dispatchEvent: async (id: string) => { calls.push(`dispatch:${id}`); throw new Error("offline"); },
    notifyPerson: async (input: { type: string }) => { calls.push(`person:${input.type}`); throw new Error("offline"); },
    notifyOrg: async (input: { type: string }) => { calls.push(`org:${input.type}`); throw new Error("offline"); },
  };
  await deliverEngineeringCreated({ eventIds: ["task-created", "task-assigned"], assigneeId: "u", taskTitle: "Design", projectNumber: "205" }, effects);
  await deliverEngineeringClosed({ repeated: false, eventIds: ["payroll", "status", "settled"], product: { number: "205.1", title: "Desk" },
    earnings: [{ userId: "u", name: "User", amount: "5.00", currency: "BYN" }] }, manager.id, effects);
  assert.deepEqual(calls, ["dispatch:task-created", "dispatch:task-assigned", "person:task.assigned", "dispatch:payroll", "dispatch:status",
    "dispatch:settled", "org:product.statusChanged", "person:payroll.accrued", "org:payroll.orgAccrued"]);
  calls.length = 0;
  await deliverEngineeringClosed({ repeated: true, eventIds: [], product: null, earnings: [] }, manager.id, effects);
  assert.deepEqual(calls, []);
});
