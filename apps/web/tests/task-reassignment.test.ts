import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { Prisma, Role } from "@prisma/client";
import { reassignOrdinaryTaskCore, listTaskReassignmentOptions } from "../src/server/tasks/task-reassignment-core";
import type { TaskTransaction } from "../src/server/tasks/transaction";
import { matches } from "./helpers/visibility-fixture";

const caller = { id: "coordinator", name: "Ответственный", roles: ["WORKER", "WORK_COORDINATOR"] as Role[], source: "web" as const };
function fixture() {
  const users = [{ ...caller, active: true, payScheme: "PIECE" },
    { id: "old", name: "Прежний", roles: ["WORKER"] as Role[], active: true, payScheme: "PIECE" },
    { id: "new", name: "Новый", roles: ["WORKER"] as Role[], active: true, payScheme: "PIECE" },
    { id: "mounter", name: "Монтажник", roles: ["MOUNTER"] as Role[], active: true, payScheme: "PIECE" }];
  const product = { id: "product", projectId: "project", status: "PRODUCTION", engineerId: null, deletedAt: null as Date | null, project: { id: "project", stage: "IN_WORK", deletedAt: null, tasks: [] }, tasks: [] };
  const state = { users, product, task: { id: "task", projectId: "project", productId: "product", workId: "work", title: "Работа", assigneeId: "old", status: "IN_PROGRESS", splitRevision: 7,
    quantity: "4.00", shareUnits: 250000, shareAmount: "15.50", allocationGroupId: "group", physicalOnlyShare: false, stageShareUnits: null as number | null, project: { id: "project", number: "310", deletedAt: null }, product,
    allocationGroup: { id: "group", workId: "work", budgetSource: "TASK_FIXED" }, _count: { payrollEntries: 0, stageSettlementShares: 0 },
    work: { id: "work", projectId: "project", productId: "product", paymentKind: "LEGACY", priceSnapshot: "100.00", stagePayPoolId: null as string | null, poolWeightUnits: null, _count: { paymentConversions: 0, settlementShares: 0 } },
    files: ["file-1"], history: ["old-event"], time: [{ userId: "old", minutes: 55 }] },
    audits: [] as Record<string, unknown>[], events: [] as Record<string, unknown>[], writes: [] as Record<string, unknown>[], failEvent: false };
  const tx = {
    $queryRaw: async () => [],
    user: { findUnique: async ({ where }: { where: { id: string } }) => state.users.find(user => user.id === where.id) ?? null,
      findMany: async () => state.users.filter(user => user.active && user.payScheme === "PIECE") },
    productPercentageParticipant: { findMany: async () => [] },
    product: { findFirst: async ({ where }: { where: Record<string, unknown> }) => matches(state.product, where) ? state.product : null },
    task: { findUnique: async () => structuredClone(state.task), findFirst: async ({ where }: { where: Record<string, unknown> }) => matches(state.task, where) ? structuredClone(state.task) : null,
      findMany: async () => [], updateMany: async ({ where, data }: { where: { splitRevision: number }; data: Record<string, unknown> }) => {
        if (where.splitRevision !== state.task.splitRevision) return { count: 0 };
        state.writes.push(structuredClone(data)); state.task.assigneeId = String(data.assigneeId); state.task.status = String(data.status); state.task.splitRevision++; return { count: 1 };
      } },
    changeLog: { findUnique: async ({ where }: { where: { id: string } }) => state.audits.find(row => row.id === where.id) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => { state.audits.push(data); return data; } },
    domainEvent: { create: async ({ data }: { data: Record<string, unknown> }) => { if (state.failEvent) throw Error("OUTBOX_FAILURE"); state.events.push(data); return { id: "assigned-event" }; } },
  } as unknown as Prisma.TransactionClient;
  let diagnostic: unknown;
  const transaction: TaskTransaction = async run => { const before = structuredClone(state); try { return await run(tx); } catch (error) { diagnostic = error; Object.assign(state, before); throw error; } };
  const input = { taskId: "task", assigneeId: "new", expectedRevision: 7, clientMutationId: randomUUID() };
  return { state, input, diagnostic: () => diagnostic instanceof Error ? diagnostic.stack : String(diagnostic), run: (data = input, who = caller) => reassignOrdinaryTaskCore(who, data, transaction), options: () => listTaskReassignmentOptions(caller, "task", transaction) };
}

test("coordinator reassigns another ordinary task once, preserving snapshots, files and historical time", async () => {
  const f = fixture(), original = structuredClone(f.state.task);
  const result = await f.run(); assert.equal(result.ok, true, JSON.stringify(result) + f.diagnostic());
  assert.equal(f.state.task.assigneeId, "new"); assert.equal(f.state.task.status, "NEW"); assert.equal(f.state.task.splitRevision, 8);
  assert.deepEqual(f.state.writes, [{ assigneeId: "new", status: "NEW", splitRevision: { increment: 1 } }]);
  for (const key of ["quantity", "shareUnits", "shareAmount", "allocationGroupId", "allocationGroup", "files", "history", "time", "work"] as const) assert.deepEqual(f.state.task[key], original[key]);
  const counts = [f.state.audits.length, f.state.events.length, f.state.writes.length];
  assert.equal((await f.run()).ok, true); const replay = await f.run(); assert.ok(replay.ok && replay.repeated);
  assert.deepEqual([f.state.audits.length, f.state.events.length, f.state.writes.length], counts);
  assert.equal((await f.run({ ...f.input, assigneeId: "old" })).ok, false);
});

test("fresh roles and product access remain mandatory for new commands and exact receipts", async () => {
  const f = fixture(); assert.equal((await f.run()).ok, true);
  f.state.users[0].roles = ["WORKER"]; assert.equal((await f.run()).ok, false);
  f.state.users[0].roles = caller.roles; f.state.product.deletedAt = new Date(0); assert.equal((await f.run()).ok, false);
  assert.equal(f.state.writes.length, 1);
  const denied = fixture(); denied.state.users[0].roles = ["WORKER"];
  assert.equal((await denied.run(denied.input, { ...caller, roles: ["MANAGER"] })).ok, false, "Stale caller roles cannot replace current database grants");
  assert.equal(denied.state.writes.length, 0);
});

test("revision conflict and wrong recipient fail before task writes", async () => {
  const f = fixture(); assert.equal((await f.run({ ...f.input, expectedRevision: 6 })).ok, false);
  for (const change of [{ active: false }, { payScheme: "HOURLY" }, { roles: ["ACCOUNTANT"] as Role[] }]) {
    const recipient = f.state.users.find(user => user.id === "new")!, saved = structuredClone(recipient); Object.assign(recipient, change);
    assert.equal((await f.run()).ok, false); Object.assign(recipient, saved);
  }
  assert.equal((await f.run({ ...f.input, assigneeId: "mounter" })).ok, false);
  assert.equal((await f.run({ ...f.input, assigneeId: "old" })).ok, false);
  assert.equal(f.state.writes.length + f.state.events.length + f.state.audits.length, 0);
});

test("completion, payroll, stage settlement and percentage work cannot be reassigned", async () => {
  const variations = [
    (f: ReturnType<typeof fixture>) => { f.state.task.status = "DONE"; },
    (f: ReturnType<typeof fixture>) => { f.state.task._count.payrollEntries = 1; },
    (f: ReturnType<typeof fixture>) => { f.state.task._count.stageSettlementShares = 1; },
    (f: ReturnType<typeof fixture>) => { f.state.task.work._count.paymentConversions = 1; },
    (f: ReturnType<typeof fixture>) => { f.state.task.work._count.settlementShares = 1; },
    (f: ReturnType<typeof fixture>) => { f.state.task.work.paymentKind = "ENGINEERING"; },
    (f: ReturnType<typeof fixture>) => { f.state.task.physicalOnlyShare = true; },
    (f: ReturnType<typeof fixture>) => { f.state.task.stageShareUnits = 10; },
  ];
  for (const change of variations) { const f = fixture(); change(f); assert.equal((await f.run()).ok, false); assert.equal(f.state.writes.length + f.state.audits.length + f.state.events.length, 0); }
});

test("outbox failure rolls back assignment, revision, snapshots and audit", async () => {
  const f = fixture(); f.state.failEvent = true; const before = structuredClone(f.state);
  assert.equal((await f.run()).ok, false); assert.deepEqual(f.state, before);
});

test("live options include only appropriate piecework recipients and keep the current revision", async () => {
  const f = fixture(), result = await f.options(); assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.expectedRevision, 7); assert.equal(result.assigneeId, "old"); assert.equal(result.taskId, "task");
  assert.deepEqual(result.recipients.map(user => user.value), ["coordinator", "old", "new"]);
  f.state.users[0].active = false; assert.equal((await f.options()).ok, false);
  const manager = fixture(); manager.state.users[0].roles = ["MANAGER"]; assert.equal((await manager.run()).ok, true);
});
