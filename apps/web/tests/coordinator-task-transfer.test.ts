import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Prisma, type Role } from "@prisma/client";
import { canTransferPiecework } from "../src/lib/piecework-policy";
import { changeTaskStatusCore } from "../src/server/tasks/completion-core";
import { transferPieceworkShareCore } from "../src/server/tasks/piecework-core";
import { listTaskReassignmentOptions, reassignOrdinaryTaskCore } from "../src/server/tasks/task-reassignment-core";
import { taskShareFixture } from "./helpers/task-share-fixture";

const coordinator = { id: "coordinator", name: "Ответственный", roles: ["WORKER", "WORK_COORDINATOR"] as Role[], source: "web" as const };
const recipient = { id: "recipient", name: "Получатель", roles: ["WORKER"] as Role[], source: "web" as const };
const finishedAt = new Date("2026-10-15T12:00:00Z");
function fixture(status = "DONE", withPayroll = true) {
  const f = taskShareFixture();
  f.state().users.push({ ...coordinator, active: true, payScheme: "PIECE" });
  Object.assign(f.state().tasks[0], { status, doneAt: status === "DONE" ? finishedAt : null, doneById: status === "DONE" ? "worker" : null });
  if (withPayroll) f.state().entries.push({ id: "original-pay", userId: "worker", taskId: "source", workId: "work", projectId: "project", productId: null,
    amount: "1000.00", bynAmount: "1000.00", currency: "BYN", scheme: "PIECE", month: "2026-10", comment: "Исходная работа",
    settlementShareId: null, percentageCompletionShareId: null, percentageAdjustmentId: null, projectAmount: null, projectCurrency: null, createdAt: finishedAt });
  f.state().payouts.push({ id: "paid", userId: "worker", month: "2026-10", amount: "1000.00", kind: "SALARY" },
    { id: "advance", userId: "worker", month: "2026-11", amount: "200.00", kind: "ADVANCE" });
  return f;
}
const full = (extra = {}) => ({ taskId: "source", assigneeId: "recipient", expectedRevision: 0, clientMutationId: randomUUID(), ...extra });
const part = (extra = {}) => ({ taskId: "source", recipientId: "recipient", percent: "40", expectedRevision: 0, clientMutationId: randomUUID(), ...extra });
type State = ReturnType<ReturnType<typeof fixture>["state"]>;
const total = (rows: State["entries"], field = "amount") =>
  rows.reduce((sum, row) => sum.add(String(row[field] ?? "0")), new Prisma.Decimal(0)).toFixed(2);

for (const status of ["DRAFT", "NEW", "IN_PROGRESS", "DONE"]) {
  test(`coordinator can reassign ${status}; DONE and its payroll stay completed`, async () => {
    const f = fixture(status, status === "DONE"), before = structuredClone(f.state()), command = full();
    const options = await listTaskReassignmentOptions(coordinator, "source", f.transaction);
    assert.ok(options.ok, JSON.stringify(options));
    const result = await reassignOrdinaryTaskCore(coordinator, command, f.transaction);
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(f.state().tasks[0].assigneeId, "recipient");
    assert.equal(f.state().tasks[0].status, status === "DONE" ? "DONE" : "NEW");
    assert.deepEqual(f.state().tasks[0].doneAt, before.tasks[0].doneAt);
    assert.equal(f.state().tasks[0].doneById, before.tasks[0].doneById);
    assert.deepEqual(f.state().files, before.files); assert.deepEqual(f.state().times, before.times);
    assert.deepEqual(f.state().payouts, before.payouts);
    assert.deepEqual(f.state().entries, before.entries.map(row => ({ ...row, userId: "recipient" })));
    const committed = structuredClone(f.state());
    const replay = await reassignOrdinaryTaskCore(coordinator, command, f.transaction);
    assert.ok(replay.ok && replay.repeated); assert.deepEqual(f.state(), committed);
    if (status === "DONE") {
      assert.ok((await changeTaskStatusCore(recipient, "source", "DONE", undefined, f.transaction)).ok);
      assert.deepEqual(f.state().entries, committed.entries);
    }
  });
  test(`coordinator can transfer a share in ${status}`, async () => {
    const f = fixture(status, status === "DONE"), command = part(), before = structuredClone(f.state());
    assert.equal(canTransferPiecework(coordinator, { assigneeId: "worker", status }), true);
    const result = await transferPieceworkShareCore(coordinator, command, f.transaction);
    assert.ok(result.ok, JSON.stringify(result));
    const child = f.state().tasks.find(row => row.id === result.taskIds[1])!;
    assert.equal(f.state().tasks[0].status, status); assert.equal(child.status, status === "DONE" ? "DONE" : "NEW");
    assert.equal(f.state().tasks[0].shareAmount, "600.00"); assert.equal(child.shareAmount, "400.00");
    assert.deepEqual(child.doneAt, status === "DONE" ? finishedAt : null);
    assert.equal(child.doneById, status === "DONE" ? "worker" : null);
    assert.deepEqual(f.state().payouts, before.payouts); assert.deepEqual(f.state().files, before.files); assert.deepEqual(f.state().times, before.times);
    if (status === "DONE") {
      assert.equal(f.state().entries.find(row => row.id === "original-pay")!.amount, "600.00");
      const transferred = f.state().entries.find(row => row.taskId === child.id)!;
      assert.equal(transferred.userId, "recipient"); assert.equal(transferred.amount, "400.00"); assert.equal(transferred.month, "2026-10");
      assert.equal(total(f.state().entries), "1000.00");
      assert.ok((await changeTaskStatusCore(recipient, String(child.id), "DONE", undefined, f.transaction)).ok);
      assert.equal(f.state().entries.length, 2);
    } else assert.equal(f.state().entries.length, 0);
    const committed = structuredClone(f.state());
    const replay = await transferPieceworkShareCore(coordinator, command, f.transaction);
    assert.ok(replay.ok && replay.repeated); assert.deepEqual(f.state(), committed);
  });
}

test("completed tasks without a historical payroll entry never get retroactive salary", async () => {
  const f = fixture("DONE", false);
  assert.ok((await reassignOrdinaryTaskCore(coordinator, full(), f.transaction)).ok);
  const g = fixture("DONE", false);
  const result = await transferPieceworkShareCore(coordinator, part(), g.transaction);
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(f.state().entries.length, 0); assert.equal(g.state().entries.length, 0);
  assert.ok((await changeTaskStatusCore(recipient, result.taskIds[1], "DONE", undefined, g.transaction)).ok);
  assert.equal(g.state().entries.length, 0);
});

test("share transfer preserves every stored monetary snapshot including the cent remainder", async () => {
  const f = fixture();
  Object.assign(f.state().entries[0], { amount: "1000.01", currency: "USD", bynAmount: "3000.07", projectAmount: "1000.03", projectCurrency: "USD" });
  const result = await transferPieceworkShareCore(coordinator, part(), f.transaction);
  assert.ok(result.ok, JSON.stringify(result));
  const original = f.state().entries.find(row => row.id === "original-pay")!, transferred = f.state().entries.find(row => row.id !== "original-pay")!;
  assert.equal(original.amount, "600.01"); assert.equal(transferred.amount, "400.00");
  assert.equal(original.bynAmount, "1800.05"); assert.equal(transferred.bynAmount, "1200.02");
  assert.equal(original.projectAmount, "600.02"); assert.equal(transferred.projectAmount, "400.01");
  assert.equal(transferred.currency, "USD"); assert.equal(transferred.projectCurrency, "USD"); assert.equal(transferred.month, "2026-10");
  assert.equal(total(f.state().entries, "bynAmount"), "3000.07");
  const moved = await reassignOrdinaryTaskCore(coordinator, full({ taskId: result.taskIds[1], assigneeId: "manager" }), f.transaction);
  assert.ok(moved.ok, JSON.stringify(moved)); assert.equal(f.state().entries.find(row => row.id === transferred.id)!.userId, "manager");
  assert.equal(total(f.state().entries, "bynAmount"), "3000.07");
});

test("the new grant does not let a manager or worker without coordinator transfer completed salary", async () => {
  for (const actor of [{ id: "manager", roles: ["MANAGER"] as Role[] }, { id: "worker", roles: ["WORKER"] as Role[] }]) {
    const f = fixture(), before = structuredClone(f.state());
    assert.equal((await reassignOrdinaryTaskCore({ ...actor, name: actor.id, source: "web" }, full(), f.transaction)).ok, false);
    assert.equal((await transferPieceworkShareCore({ ...actor, name: actor.id, source: "web" }, part(), f.transaction)).ok, false);
    assert.deepEqual(f.state(), before);
  }
});

test("invalid foreign payroll binding and revoked coordinator never move another employee salary", async () => {
  for (const alter of [(f: ReturnType<typeof fixture>) => { f.state().entries[0].userId = "other"; },
    (f: ReturnType<typeof fixture>) => { f.state().users.find(row => row.id === coordinator.id)!.roles = ["WORKER"]; }]) {
    for (const mode of ["full", "part"]) {
      const f = fixture(); alter(f); const before = structuredClone(f.state());
      const result = mode === "full" ? await reassignOrdinaryTaskCore(coordinator, full(), f.transaction) : await transferPieceworkShareCore(coordinator, part(), f.transaction);
      assert.equal(result.ok, false); assert.deepEqual(f.state(), before);
    }
  }
});

test("outbox failure rolls back payroll ownership or split together with every task write", async () => {
  for (const mode of ["full", "part"]) {
    const f = fixture(), before = structuredClone(f.state()); f.failOn("event.create");
    const result = mode === "full" ? await reassignOrdinaryTaskCore(coordinator, full(), f.transaction) : await transferPieceworkShareCore(coordinator, part(), f.transaction);
    assert.equal(result.ok, false); assert.deepEqual(f.state(), before);
  }
});

test("one revision admits only one full or partial transfer of completed salary", async () => {
  const f = fixture();
  const results = await Promise.all([reassignOrdinaryTaskCore(coordinator, full(), f.transaction), transferPieceworkShareCore(coordinator, part(), f.transaction)]);
  assert.equal(results.filter(row => row.ok).length, 1);
  assert.equal(total(f.state().entries), "1000.00"); assert.equal(f.state().tasks[0].splitRevision, 1);
});
