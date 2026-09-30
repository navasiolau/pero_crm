import assert from "node:assert/strict";
import { test } from "node:test";
import { changeTaskStatusCore } from "../src/server/tasks/completion-core";
import { taskShareFixture } from "./helpers/task-share-fixture";
import type { DomainActor } from "../src/server/projects/core";

const manager: DomainActor = { id: "manager", name: "Manager", roles: ["MANAGER"], source: "web" };

test("ENGINEERING completion never pays PIECE, regardless of recipient role or old price", async () => {
  for (const role of ["ENGINEER", "WORKER", "MOUNTER", "ACCOUNTANT", "MANAGER", "ADMIN", "DIRECTOR"]) {
    const fixture = taskShareFixture("DESIGN");
    Object.assign(fixture.state().works[0], { paymentKind: "ENGINEERING", stagePayPoolId: "pool", poolWeightUnits: 1_000_000 });
    fixture.state().tasks[0].stageShareUnits = 1_000_000;
    fixture.state().users.find((user) => user.id === "worker")!.roles = [role];
    const result = await changeTaskStatusCore(manager, "source", "DONE", 20, fixture.transaction);
    assert.ok(result.ok, role);
    assert.equal(result.payroll, null, role);
    assert.equal(fixture.state().entries.length, 0, role);
    assert.equal(fixture.state().tasks[0].status, "DONE", role);
    assert.ok(fixture.state().times.every((entry) => entry.stoppedAt !== null), role);
  }
});

test("a new ENGINEERING Work with no legacy monetary snapshot can finish", async () => {
  const fixture = taskShareFixture("DESIGN");
  Object.assign(fixture.state().works[0], { paymentKind: "ENGINEERING", stagePayPoolId: "pool", priceSnapshot: null, total: null });
  fixture.state().tasks[0].stageShareUnits = 1_000_000;
  const result = await changeTaskStatusCore(manager, "source", "DONE", 20, fixture.transaction);
  assert.ok(result.ok);
  assert.equal(result.payroll, null);
  assert.equal(fixture.state().entries.length, 0);
});

test("zero-funded engineering work retains photo and time requirements", async () => {
  const fixture = taskShareFixture("DESIGN");
  Object.assign(fixture.state().works[0], { paymentKind: "ENGINEERING", stagePayPoolId: "pool", poolWeightUnits: 0 });
  fixture.state().tasks[0].stageShareUnits = 0;
  fixture.state().files.length = 0;
  const before = structuredClone(fixture.state());
  const result = await changeTaskStatusCore(manager, "source", "DONE", 20, fixture.transaction);
  assert.equal(result.ok, false);
  assert.deepEqual(fixture.state(), before);
});

test("a LEGACY Work named engineering keeps its ordinary piece payment", async () => {
  const fixture = taskShareFixture("DESIGN");
  Object.assign(fixture.state().works[0], { paymentKind: "LEGACY", title: "Проектирование" });
  const result = await changeTaskStatusCore(manager, "source", "DONE", 20, fixture.transaction);
  assert.ok(result.ok);
  assert.equal(result.payroll?.amount, "1000.00");
  assert.equal(fixture.state().entries.length, 1);
});

test("duplicate engineering completion leaves one status event and no PIECE", async () => {
  const fixture = taskShareFixture("DESIGN");
  Object.assign(fixture.state().works[0], { paymentKind: "ENGINEERING", stagePayPoolId: "pool" });
  const complete = () => changeTaskStatusCore(manager, "source", "DONE", 20, fixture.transaction);
  const results = await Promise.all([complete(), complete()]);
  assert.ok(results.every((result) => result.ok));
  assert.equal(fixture.state().entries.length, 0);
  assert.equal(fixture.state().events.length, 1);
  assert.equal(fixture.state().pools[0].revision, 1);
});

test("ENGINEERING completion rejects settled pool and inconsistent task/work context atomically", async () => {
  for (const mismatch of ["settled", "work-project", "pool-product"]) {
    const fixture = taskShareFixture("DESIGN");
    Object.assign(fixture.state().works[0], { paymentKind: "ENGINEERING", stagePayPoolId: "pool" });
    fixture.state().tasks[0].stageShareUnits = 1_000_000;
    if (mismatch === "settled") fixture.state().pools[0].state = "SETTLED";
    if (mismatch === "work-project") fixture.state().works[0].projectId = "other";
    if (mismatch === "pool-product") fixture.state().pools[0].productId = "other";
    const before = structuredClone(fixture.state());
    const result = await changeTaskStatusCore(manager, "source", "DONE", 20, fixture.transaction);
    assert.equal(result.ok, false, mismatch);
    assert.deepEqual(fixture.state(), before, mismatch);
  }
});
