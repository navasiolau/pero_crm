import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { splitTaskCore } from "../src/server/tasks/share-core";
import { canSplitTask } from "../src/server/tasks/share-policy";
import { taskShareFixture } from "./helpers/task-share-fixture";

const manager = { id: "manager", name: "Manager", roles: ["MANAGER" as const], source: "web" as const };
const worker = { id: "worker", name: "Worker", roles: ["WORKER" as const], source: "web" as const };
const request = (requestId = randomUUID()) => ({ taskId: "source", recipientId: "recipient", percent: "30", expectedRevision: 0, requestId });

function oldEngineeringFixture() {
  const fixture = taskShareFixture("DESIGN");
  Object.assign(fixture.state().works[0], {
    paymentKind: "ENGINEERING", stagePayPoolId: "pool", poolWeightUnits: 1000000,
    priceSnapshot: null, total: null,
  });
  fixture.state().tasks[0].stageShareUnits = 1000000;
  return fixture;
}

test("старое ENGINEERING распределение не делят ни менеджер, ни исполнитель", async () => {
  for (const actor of [manager, worker]) {
    const f = oldEngineeringFixture();
    const before = structuredClone(f.state());
    assert.equal((await splitTaskCore(actor, request(), f.transaction)).ok, false);
    assert.deepEqual(f.state(), before);
    assert.deepEqual(f.writes, []);
  }
  assert.equal(canSplitTask(manager, { assigneeId: "worker", status: "IN_PROGRESS", product: { engineerId: "engineer", status: "DESIGN" },
    paidCount: 0, work: { paymentKind: "ENGINEERING" } }), false);
});

test("старый pool status и физическая группа не открывают новый денежный split", async () => {
  for (const state of ["DRAFT", "SETTLED", "LEGACY_PROTECTED"]) {
    const f = oldEngineeringFixture();
    f.state().pools[0].state = state;
    const source = f.state().tasks[0];
    source.allocationGroupId = "legacy-group"; source.shareUnits = 1000000; source.shareAmount = "80.00";
    f.state().groups.push({ id: "legacy-group", workId: "work", quantity: "10", budget: "80.00", currency: "BYN", budgetSource: "TASK_FIXED" });
    const before = structuredClone(f.state());
    assert.equal((await splitTaskCore(manager, request(), f.transaction)).ok, false);
    assert.deepEqual(f.state(), before);
    assert.deepEqual(f.writes, []);
  }
});

test("точный старый UUID receipt replay не создаёт новую работу, долю или событие", async () => {
  const f = oldEngineeringFixture();
  const id = randomUUID();
  f.state().logs.push({ id: `task-split:${id}`, actorId: manager.id, entityId: "source", action: "split",
    newValue: { recipientId: "recipient", percent: "30.00", expectedRevision: 0,
      childTaskId: "historic-child", groupId: "historic-group" } });
  const before = structuredClone(f.state());
  const repeated = await splitTaskCore(manager, request(id), f.transaction);
  assert.equal(repeated.ok, true);
  if (repeated.ok) { assert.equal(repeated.repeated, true); assert.equal(repeated.childTaskId, "historic-child"); }
  assert.deepEqual(f.state(), before); assert.deepEqual(f.writes, []);
  const altered = await splitTaskCore(manager, { ...request(id), recipientId: "accountant" }, f.transaction);
  assert.equal(altered.ok, false);
  assert.deepEqual(f.state(), before); assert.deepEqual(f.writes, []);
});
