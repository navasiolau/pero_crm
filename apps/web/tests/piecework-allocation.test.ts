import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createPieceworkAllocationCore, transferPieceworkShareCore, type CreatePieceworkInput } from "../src/server/tasks/piecework-core";
import { taskShareFixture, historicalTaskAllocation } from "./helpers/task-share-fixture";
import { allocatedWorkQuantity, moneyAtoms, taskPieceAmount } from "../src/lib/work-shares";
import { pieceworkRecipientError } from "../src/server/tasks/piecework-policy";
import { pieceworkPlanRevision } from "../src/server/tasks/piecework-revision";
import { changeTaskStatusCore } from "../src/server/tasks/completion-core";

const manager = { id: "manager", name: "Manager", roles: ["MANAGER" as const], source: "web" as const };
const worker = { ...manager, id: "worker", roles: ["WORKER" as const] };
const initial = (f = available()): CreatePieceworkInput => ({ projectId: "project", productId: "product", workId: "work", title: "Производство", type: "Производство", quantity: "10", dueAt: "2026-11-01", expectedRevision: pieceworkPlanRevision({ ...f.state().works[0], tasks: f.state().tasks.filter(row => row.workId === "work") } as Parameters<typeof pieceworkPlanRevision>[0]), clientMutationId: randomUUID(), participants: [{ userId: "worker", percent: "50" }, { userId: "recipient", percent: "30" }, { userId: "manager", percent: "20" }] });
function available() { const f = taskShareFixture(); f.state().tasks = f.state().tasks.filter(row => row.id !== "source"); return f; }
const transfer = (values: Record<string, unknown> = {}) => ({ taskId: "source", recipientId: "recipient", percent: "30", expectedRevision: 0, clientMutationId: randomUUID(), ...values });

test("N allocations atomically fix money and volume once without time estimates or earnings", async () => {
  const f = available(), input = initial();
  const result = await createPieceworkAllocationCore(manager, input, f.transaction);
  assert.equal(result.ok, true); if (!result.ok) return;
  const tasks = f.state().tasks.filter(row => row.allocationGroupId === result.groupId);
  assert.equal(tasks.length, 3); assert.deepEqual(tasks.map(row => row.shareAmount), ["500.00", "300.00", "200.00"]);
  assert.equal(allocatedWorkQuantity(tasks as never), "10.00"); assert.ok(tasks.every(row => row.estimateMinutes === null));
  assert.ok(tasks.every(row => (row.dueAt as Date).toISOString() === "2026-11-01T00:00:00.000Z"));
  assert.equal(f.state().entries.length, 0); assert.equal(f.state().groups[0].budget, "1000.00");
  f.state().works[0].priceSnapshot = "999";
  assert.deepEqual(tasks.map(row => taskPieceAmount(row as never, "999")), ["500.00", "300.00", "200.00"]);
  const before = structuredClone(f.state());
  assert.equal((await createPieceworkAllocationCore(manager, { ...input, participants: input.participants.map(row => ({ ...row, percent: `${row.percent}.00` })) }, f.transaction)).ok, true);
  assert.deepEqual(f.state(), before);
  assert.equal((await createPieceworkAllocationCore(manager, { ...input, title: "Другой запрос" }, f.transaction)).ok, false);
  assert.equal((await createPieceworkAllocationCore({ ...manager, id: "admin", roles: ["ADMIN"] }, input, f.transaction)).ok, false);
  assert.deepEqual(f.state(), before);
});

test("initial allocation without a deadline stores null, replays, and preserves explicit-date receipt fingerprints", async () => {
  const f = available(), input = initial(f); delete input.dueAt;
  const result = await createPieceworkAllocationCore(manager, input, f.transaction);
  assert.equal(result.ok, true); if (!result.ok) return;
  assert.ok(f.state().tasks.filter(row => row.allocationGroupId === result.groupId).every(row => row.dueAt === null));
  const before = structuredClone(f.state());
  const replay = await createPieceworkAllocationCore(manager, { ...input, dueAt: null }, f.transaction);
  assert.equal(replay.ok, true); if (replay.ok) assert.equal(replay.repeated, true);
  assert.deepEqual(f.state(), before);
  const explicit = available(), dated = initial(explicit);
  const created = await createPieceworkAllocationCore(manager, dated, explicit.transaction);
  assert.equal(created.ok, true);
  const normalizedReplay = await createPieceworkAllocationCore(manager, { ...dated, dueAt: "2026-11-01T00:00:00.000Z" }, explicit.transaction);
  assert.equal(normalizedReplay.ok, true); if (normalizedReplay.ok) assert.equal(normalizedReplay.repeated, true);
});

test("initial allocation cannot consume another group's remaining volume", async () => {
  const f = available();
  const results = await Promise.all([createPieceworkAllocationCore(manager, initial(), f.transaction), createPieceworkAllocationCore(manager, initial(), f.transaction)]);
  assert.equal(results.filter(row => row.ok).length, 1); assert.equal(f.state().groups.length, 1);
});

test("an initial form with a stale work plan or price refuses before any mutation", async () => {
  const f = available(), input = initial(f);
  f.state().works[0].priceSnapshot = "101.00";
  const before = structuredClone(f.state());
  const result = await createPieceworkAllocationCore(manager, input, f.transaction);
  assert.equal(result.ok, false); if (!result.ok) assert.equal(result.kind, "conflict");
  assert.deepEqual(f.state(), before);
});

test("DONE of each new share accrues its frozen amount once without any TimeEntry access", async () => {
  const f = available(), created = await createPieceworkAllocationCore(manager, initial(f), f.transaction);
  assert.equal(created.ok, true); if (!created.ok) return;
  f.state().works[0].priceSnapshot = "999.00";
  const transaction: typeof f.transaction = operation => f.transaction(tx => operation(new Proxy(tx, { get(target, key, receiver) {
    if (key === "timeEntry") throw Error("TIME_ENTRY_ACCESS_FORBIDDEN");
    return Reflect.get(target, key, receiver);
  } })));
  const completed = await Promise.all(created.taskIds.flatMap(id => [changeTaskStatusCore(manager, id, "DONE", undefined, transaction), changeTaskStatusCore(manager, id, "DONE", undefined, transaction)]));
  assert.ok(completed.every(result => result.ok));
  assert.equal(f.state().entries.length, 3); assert.deepEqual(f.state().entries.map(row => row.amount), ["500.00", "300.00", "200.00"]);
  assert.equal(f.state().entries.reduce((sum, row) => sum + moneyAtoms(String(row.amount)), BigInt(0)), BigInt(100000));
});

test("recipient validation reads current active PIECE role and rejects the whole N request", async () => {
  const f = available(); f.state().users.find(row => row.id === "recipient")!.payScheme = "NONE";
  const before = structuredClone(f.state());
  const result = await createPieceworkAllocationCore(manager, initial(), f.transaction);
  assert.equal(result.ok, false); if (!result.ok) assert.match(result.error, /сдельной/);
  assert.deepEqual(f.state(), before);
  assert.equal(pieceworkRecipientError({ id: "engineer", roles: ["ENGINEER", "ACCOUNTANT"], active: true, payScheme: "PIECE" }, { engineerId: "engineer", status: "DESIGN" }), null);
  assert.match(pieceworkRecipientError({ id: "engineer", roles: ["ENGINEER"], active: true, payScheme: "PIECE" }, { engineerId: "engineer", status: "DESIGN" })!, /фонд/);
  assert.match(pieceworkRecipientError({ id: "worker", roles: ["WORKER"], active: false, payScheme: "PIECE" }, { engineerId: null, status: "PRODUCTION" })!, /неактивен/);
});

test("special pool, conversion and settlement work never opens the ordinary allocation command", async () => {
  const f = available(); Object.assign(f.state().works[0], { _count: { paymentConversions: 1, settlementShares: 0 } });
  const before = structuredClone(f.state());
  assert.equal((await createPieceworkAllocationCore(manager, initial(), f.transaction)).ok, false);
  assert.deepEqual(f.state(), before);
  const g = taskShareFixture(); Object.assign(g.state().works[0], { paymentKind: "ENGINEERING", stagePayPoolId: "pool", poolWeightUnits: 1000000 });
  const original = structuredClone(g.state());
  assert.equal((await transferPieceworkShareCore(manager, transfer(), g.transaction)).ok, false);
  assert.deepEqual(g.state(), original);
});

test("converting an unpaid task preserves ID/history/files and inherits all dependency edges", async () => {
  const f = taskShareFixture(), original = structuredClone(f.state().tasks[0]), files = structuredClone(f.state().files), times = structuredClone(f.state().times);
  const result = await transferPieceworkShareCore(worker, transfer(), f.transaction);
  assert.equal(result.ok, true); if (!result.ok) return;
  const source = f.state().tasks[0], child = f.state().tasks.find(row => row.id === result.taskIds[1])!;
  assert.equal(source.id, original.id); assert.equal(source.status, original.status); assert.deepEqual(source.createdAt, original.createdAt);
  assert.equal(source.estimateMinutes, original.estimateMinutes); assert.equal(child.estimateMinutes, null);
  assert.equal(source.shareAmount, "700.00"); assert.equal(child.shareAmount, "300.00"); assert.equal(source.splitRevision, 1);
  assert.deepEqual(f.state().files, files); assert.deepEqual(f.state().times, times);
  assert.ok(f.state().dependencies.some(row => row.taskId === child.id && row.dependsOnId === "predecessor"));
  assert.ok(f.state().dependencies.some(row => row.taskId === "dependent" && row.dependsOnId === child.id));
});

test("transfer splits the current share and includes DONE/paid neighbours in group totals", async () => {
  const f = taskShareFixture(); historicalTaskAllocation(f);
  const neighbour = f.state().tasks.find(row => row.id === "historic-child")!; neighbour.status = "DONE";
  f.state().entries.push({ id: "earned", taskId: neighbour.id, amount: "300.00", scheme: "PIECE" });
  const original = structuredClone(neighbour), earned = structuredClone(f.state().entries);
  const result = await transferPieceworkShareCore(worker, transfer({ percent: "20", expectedRevision: 1 }), f.transaction);
  assert.equal(result.ok, true); if (!result.ok) return;
  assert.equal(f.state().tasks[0].shareAmount, "560.00");
  assert.equal(f.state().tasks.find(row => row.id === result.taskIds[1])!.shareAmount, "140.00");
  assert.deepEqual(neighbour, original); assert.deepEqual(f.state().entries, earned);
  const parts = f.state().tasks.filter(row => row.allocationGroupId === "historic-group");
  assert.equal(parts.reduce((sum, row) => sum + moneyAtoms(String(row.shareAmount)), BigInt(0)), BigInt(100000));
  assert.equal(allocatedWorkQuantity(parts as never), "10.00");
});

test("one revision admits only one transfer and receipt replay survives source completion", async () => {
  const f = taskShareFixture(), first = transfer(), second = transfer({ percent: "20" });
  const results = await Promise.all([transferPieceworkShareCore(worker, first, f.transaction), transferPieceworkShareCore(worker, second, f.transaction)]);
  assert.equal(results.filter(row => row.ok).length, 1); assert.equal(f.state().groups.length, 1);
  f.state().tasks[0].status = "DONE";
  const before = structuredClone(f.state());
  const replay = await transferPieceworkShareCore(worker, first, f.transaction);
  assert.equal(replay.ok, true); if (replay.ok) assert.equal(replay.repeated, true);
  assert.deepEqual(f.state(), before);
});

test("foreign source, stale actor role, paid source and DONE source never mutate", async () => {
  const f = taskShareFixture(); f.state().tasks[0].assigneeId = "recipient";
  const before = structuredClone(f.state());
  assert.equal((await transferPieceworkShareCore(worker, transfer({ recipientId: "manager" }), f.transaction)).ok, false);
  assert.deepEqual(f.state(), before);
  const g = taskShareFixture(); g.state().users.find(row => row.id === "worker")!.roles = ["ACCOUNTANT"];
  assert.equal((await transferPieceworkShareCore(worker, transfer(), g.transaction)).ok, false);
  const h = taskShareFixture(); h.state().entries.push({ taskId: "source", scheme: "PIECE" });
  const paid = structuredClone(h.state());
  assert.equal((await transferPieceworkShareCore(manager, transfer(), h.transaction)).ok, false); assert.deepEqual(h.state(), paid);
  h.state().entries.length = 0; h.state().tasks[0].status = "DONE";
  const done = structuredClone(h.state());
  assert.equal((await transferPieceworkShareCore(manager, transfer(), h.transaction)).ok, false); assert.deepEqual(h.state(), done);
});

test("transactional failure rolls back both source and children while lost ACK reuses the receipt", async () => {
  const f = taskShareFixture(), input = transfer(), before = structuredClone(f.state()); f.failOn("log.create");
  assert.equal((await transferPieceworkShareCore(worker, input, f.transaction)).ok, false); assert.deepEqual(f.state(), before);
  const g = available(), create = initial(); let first = true;
  const lostAck: typeof g.transaction = async operation => { const value = await g.transaction(operation); if (first) { first = false; throw Error("LOST_ACK"); } return value; };
  const uncertain = await createPieceworkAllocationCore(manager, create, lostAck);
  assert.equal(uncertain.ok, false); if (!uncertain.ok) assert.equal(uncertain.kind, "failure");
  const committed = structuredClone(g.state());
  const repeated = await createPieceworkAllocationCore(manager, create, lostAck);
  assert.equal(repeated.ok, true); if (repeated.ok) assert.equal(repeated.repeated, true);
  assert.deepEqual(g.state(), committed);
});
