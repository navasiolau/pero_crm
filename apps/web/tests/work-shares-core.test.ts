import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { DomainActor } from "../src/server/projects/core";
import { splitTaskCore, type SplitTaskInput } from "../src/server/tasks/share-core";
import { allocatedWorkQuantity, taskPieceAmount } from "../src/lib/work-shares";
import { taskShareFixture } from "./helpers/task-share-fixture";

const worker: DomainActor = { id: "worker", name: "Worker", roles: ["WORKER"], source: "web" };
const manager: DomainActor = { id: "manager", name: "Manager", roles: ["MANAGER"], source: "web" };
const input = (changes: Partial<SplitTaskInput> = {}): SplitTaskInput => ({ taskId: "source", recipientId: "recipient", percent: "30", expectedRevision: 0, requestId: randomUUID(), ...changes });

test("worker splits own active task 70/30 with one group and exact amounts", async () => {
  const f = taskShareFixture();
  const result = await splitTaskCore(worker, input(), f.transaction);
  assert.equal(result.ok, true);
  const parts = f.state().tasks.filter((task) => task.allocationGroupId);
  assert.deepEqual(parts.map((task) => task.shareUnits).sort(), [300_000, 700_000]);
  assert.deepEqual(parts.map((task) => task.shareAmount).sort(), ["300.00", "700.00"]);
  assert.equal(allocatedWorkQuantity(parts as never), "10.00");
  assert.equal(f.state().groups.length, 1);
  assert.equal(f.state().groups[0].budget, "1000.00");
});

test("repeat split affects only the remaining portion and conserves original budget", async () => {
  const f = taskShareFixture();
  assert.equal((await splitTaskCore(worker, input(), f.transaction)).ok, true);
  assert.equal((await splitTaskCore(worker, input({ percent: "50", expectedRevision: 1, recipientId: "accountant" }), f.transaction)).ok, true);
  const parts = f.state().tasks.filter((task) => task.allocationGroupId);
  assert.deepEqual(parts.map((task) => task.shareUnits).sort(), [300_000, 350_000, 350_000]);
  assert.equal(parts.reduce((sum, task) => sum + Number(taskPieceAmount(task as never, "100")), 0), 1000);
  assert.equal(f.state().groups.length, 1);
});

test("ordinary production task accepts recipients with production access", async () => {
  for (const recipientId of ["recipient", "accountant", "admin", "director", "manager", "mounter"]) {
    const f = taskShareFixture();
    assert.equal((await splitTaskCore(worker, input({ recipientId }), f.transaction)).ok, true, recipientId);
  }
  const engineer = taskShareFixture();
  assert.equal((await splitTaskCore(worker, input({ recipientId: "engineer" }), engineer.transaction)).ok, false);
});

test("only assignee or management can divide a task", async () => {
  const f = taskShareFixture();
  const denied = await splitTaskCore({ ...worker, id: "other" }, input(), f.transaction);
  assert.equal(denied.ok, false);
  assert.deepEqual(f.writes, []);
  assert.equal((await splitTaskCore(manager, input(), f.transaction)).ok, true);
});

test("inactive, same assignee and an engineer without product access are rejected", async () => {
  for (const reason of ["inactive", "same", "engineer"]) {
    const f = taskShareFixture();
    let recipientId = "recipient";
    if (reason === "inactive") f.state().users.find((user) => user.id === recipientId)!.active = false;
    if (reason === "same") recipientId = "worker";
    if (reason === "engineer") { recipientId = "engineer"; f.state().products[0].status = "PRODUCTION"; }
    assert.equal((await splitTaskCore(worker, input({ recipientId }), f.transaction)).ok, false, reason);
    assert.deepEqual(f.writes, []);
  }
});

test("DONE and payroll history both prevent splitting without altering history", async () => {
  for (const state of ["done", "paid"]) {
    const f = taskShareFixture();
    if (state === "done") f.state().tasks[0].status = "DONE";
    else f.state().entries.push({ id: "earned", taskId: "source", amount: "1000.00" });
    const before = structuredClone(f.state());
    assert.equal((await splitTaskCore(manager, input(), f.transaction)).ok, false);
    assert.deepEqual(f.state(), before);
  }
});

test("split leaves files/time/timer on original and duplicates prerequisite/dependent edges", async () => {
  const f = taskShareFixture();
  const before = { files: structuredClone(f.state().files), times: structuredClone(f.state().times) };
  const result = await splitTaskCore(worker, input(), f.transaction);
  assert.ok(result.ok);
  assert.deepEqual(f.state().files, before.files);
  assert.deepEqual(f.state().times, before.times);
  assert.equal(f.state().tasks.find((task) => task.id === result.childTaskId)?.status, "NEW");
  assert.ok(f.state().dependencies.some((edge) => edge.taskId === result.childTaskId && edge.dependsOnId === "predecessor"));
  assert.ok(f.state().dependencies.some((edge) => edge.taskId === "dependent" && edge.dependsOnId === result.childTaskId));
});

test("same UUID is idempotent while a changed payload or stale revision cannot split again", async () => {
  const f = taskShareFixture(); const request = input();
  const first = await splitTaskCore(worker, request, f.transaction);
  assert.ok(first.ok);
  const again = await splitTaskCore(worker, request, f.transaction);
  assert.ok(again.ok);
  assert.equal(again.childTaskId, first.childTaskId);
  assert.equal(again.repeated, true);
  assert.equal((await splitTaskCore(worker, { ...request, percent: "50" }, f.transaction)).ok, false);
  assert.equal((await splitTaskCore(worker, input(), f.transaction)).ok, false);
  assert.equal(f.state().tasks.filter((task) => task.allocationGroupId).length, 2);
});

test("two simultaneous requests for one revision create just one additional task", async () => {
  const f = taskShareFixture();
  const results = await Promise.all([splitTaskCore(worker, input(), f.transaction), splitTaskCore(worker, input(), f.transaction)]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(f.state().tasks.filter((task) => task.allocationGroupId).length, 2);
});

test("failure after writes rolls back both portions, group, dependencies and receipt", async () => {
  const f = taskShareFixture(); f.failOn("log.create");
  const before = structuredClone(f.state());
  await assert.rejects(splitTaskCore(worker, input(), f.transaction), /Injected/);
  assert.deepEqual(f.state(), before);
});

test("standalone task retains zero budget and no work quantity", async () => {
  const f = taskShareFixture(); f.state().tasks[0].workId = null; f.state().tasks[0].quantity = null;
  assert.equal((await splitTaskCore(worker, input(), f.transaction)).ok, true);
  assert.equal(f.state().groups[0].budget, "0.00");
  assert.equal(f.state().groups[0].quantity, null);
  assert.equal(f.state().groups[0].currency, null);
  assert.ok(f.state().tasks.filter((task) => task.allocationGroupId).every((task) => task.shareAmount === "0.00"));
});

test("legacy quantity without Work does not become a funded or unusable allocation", async () => {
  const f = taskShareFixture(); f.state().tasks[0].workId = null;
  assert.equal((await splitTaskCore(worker, input(), f.transaction)).ok, true);
  assert.ok(f.state().tasks.filter((task) => task.allocationGroupId).every((task) => task.quantity === null));
  assert.equal((await splitTaskCore(worker, input({ expectedRevision: 1, percent: "50", recipientId: "accountant" }), f.transaction)).ok, true);
  assert.equal(f.state().groups[0].budget, "0.00");
});
