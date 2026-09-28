import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { DomainActor } from "../src/server/projects/core";
import { splitTaskCore, type SplitTaskInput } from "../src/server/tasks/share-core";
import { taskShareFixture } from "./helpers/task-share-fixture";

type Row = Record<string, unknown> & {
  id: string; projectId?: string; productId?: string | null; workId?: string | null; title?: string;
  status?: string; assigneeId?: string | null; quantity?: string | null; allocationGroupId?: string | null;
  shareUnits?: number | null; shareAmount?: string | null; stageShareUnits?: number | null; splitRevision?: number;
  paymentKind?: string; stagePayPoolId?: string | null; poolWeightUnits?: number;
  stagePayPool?: { id: string; kind: string; state: string; productId: string; product: { id: string; projectId: string } };
  budget?: string | null; currency?: string | null; budgetSource?: string;
};
type State = { tasks: Row[]; users: Row[]; products: Row[]; works: Row[]; groups: Row[]; entries: Row[]; logs: Row[]; writes: string[] };
const worker: DomainActor = { id: "worker", name: "Worker", roles: ["WORKER"], source: "web" };
const manager: DomainActor = { id: "manager", name: "Manager", roles: ["MANAGER"], source: "web" };
const input = (changes: Partial<SplitTaskInput> = {}): SplitTaskInput => ({ taskId: "source", recipientId: "accountant", percent: "50", expectedRevision: 0, requestId: randomUUID(), ...changes });

function engineeringFixture() {
  const f = taskShareFixture();
  const state = f.state() as unknown as State;
  const work = state.works[0];
  Object.assign(work, {
    paymentKind: "ENGINEERING", stagePayPoolId: "pool", poolWeightUnits: 1_000_000,
    priceSnapshot: null, total: null,
    stagePayPool: { id: "pool", kind: "ENGINEERING", state: "DRAFT", productId: "product", product: { id: "product", projectId: "project" } },
  });
  const source = state.tasks.find((task) => task.id === "source")!;
  Object.assign(source, { quantity: "2.00", stageShareUnits: 800_000, shareAmount: "80.00" });
  state.tasks.push({
    ...structuredClone(source), id: "sibling", title: "Sibling", quantity: "3.00", stageShareUnits: 200_000,
    shareAmount: "20.00", assigneeId: "worker", allocationGroupId: null, shareUnits: null, splitRevision: 0,
  });
  state.users.push({ id: "engineer-2", name: "Engineer 2", roles: ["ENGINEER"], active: true, payScheme: "PIECE" });
  return { ...f, state: () => f.state() as unknown as State };
}

test("ENGINEERING split divides physical and stage-share vectors without freezing legacy money", async () => {
  const f = engineeringFixture();
  const beforeWork = structuredClone(f.state().works[0]);
  const beforeSibling = structuredClone(f.state().tasks.find((task) => task.id === "sibling"));
  const result = await splitTaskCore(worker, input(), f.transaction);
  if (!result.ok) assert.fail(result.error);
  const state = f.state();
  const source = state.tasks.find((task) => task.id === "source")!;
  const sibling = state.tasks.find((task) => task.id === "sibling")!;
  const child = state.tasks.find((task) => task.id === result.childTaskId)!;
  assert.equal(source.quantity, "2.00");
  assert.equal(child.quantity, "2.00");
  assert.equal(source.shareUnits, 500_000);
  assert.equal(child.shareUnits, 500_000);
  assert.deepEqual([source.stageShareUnits, child.stageShareUnits, sibling.stageShareUnits], [400_000, 400_000, 200_000]);
  assert.deepEqual([source.shareAmount, sibling.shareAmount, child.shareAmount], ["80.00", "20.00", null]);
  assert.equal(state.groups.length, 1);
  assert.equal(state.groups[0].quantity, "2.00");
  assert.equal(state.groups[0].budgetSource, "STAGE_PREVIEW");
  assert.equal(state.groups[0].budget, null);
  assert.equal(state.groups[0].currency, null);
  assert.equal(source.stageShareUnits! + child.stageShareUnits! + sibling.stageShareUnits!, 1_000_000);
  assert.deepEqual(state.works[0], beforeWork);
  assert.deepEqual(sibling, beforeSibling);
});

test("ENGINEERING split allows any active recipient role, including a non-primary ENGINEER with PIECE", async () => {
  for (const recipientId of ["accountant", "manager", "mounter", "engineer-2"]) {
    const f = engineeringFixture();
    const result = await splitTaskCore(worker, input({ recipientId }), f.transaction);
    if (!result.ok) assert.fail(`${recipientId}: ${result.error}`);
    if (recipientId === "engineer-2") assert.equal(f.state().products[0].engineerId, "engineer");
  }
});

test("ENGINEERING split accepts a zero financial share but rejects an incomplete or untransferably small vector", async () => {
  const zero = engineeringFixture();
  zero.state().tasks.find((task) => task.id === "source")!.stageShareUnits = 0;
  zero.state().tasks.find((task) => task.id === "sibling")!.stageShareUnits = 1_000_000;
  const zeroResult = await splitTaskCore(worker, input(), zero.transaction);
  if (!zeroResult.ok) assert.fail(zeroResult.error);
  assert.equal(zero.state().tasks.find((task) => task.id === "source")!.stageShareUnits, 0);
  assert.equal(zero.state().tasks.find((task) => task.id === zeroResult.childTaskId)!.stageShareUnits, 0);
  assert.equal(zero.state().tasks.find((task) => task.id === "sibling")!.stageShareUnits, 1_000_000);

  const incomplete = engineeringFixture();
  incomplete.state().tasks.find((task) => task.id === "sibling")!.stageShareUnits = 199_999;
  const before = structuredClone(incomplete.state());
  assert.equal((await splitTaskCore(worker, input(), incomplete.transaction)).ok, false);
  assert.deepEqual(incomplete.state(), before);

  const tiny = engineeringFixture();
  tiny.state().tasks.find((task) => task.id === "source")!.stageShareUnits = 1;
  tiny.state().tasks.find((task) => task.id === "sibling")!.stageShareUnits = 999_999;
  const tinyBefore = structuredClone(tiny.state());
  assert.equal((await splitTaskCore(worker, input({ percent: "1" }), tiny.transaction)).ok, false);
  assert.deepEqual(tiny.state(), tinyBefore);
});

test("ENGINEERING split preserves existing physical group and fixed legacy snapshots", async () => {
  const f = engineeringFixture();
  const state = f.state();
  const source = state.tasks.find((task) => task.id === "source")!;
  Object.assign(source, { allocationGroupId: "legacy-group", shareUnits: 1_000_000 });
  state.groups.push({ id: "legacy-group", workId: "work", quantity: "2.00", budget: "80.00", currency: "BYN", budgetSource: "TASK_FIXED", createdById: "manager" });
  const beforeGroup = structuredClone(state.groups[0]);
  const result = await splitTaskCore(worker, input(), f.transaction);
  if (!result.ok) assert.fail(result.error);
  assert.deepEqual(state.groups[0], beforeGroup);
  assert.deepEqual(state.tasks.filter((task) => ["source", result.childTaskId].includes(task.id)).map((task) => task.shareAmount), ["80.00", null]);
  assert.deepEqual(state.tasks.filter((task) => ["source", result.childTaskId].includes(task.id)).map((task) => task.shareUnits), [500_000, 500_000]);
});

test("ENGINEERING split rejects a work with cross-product tasks", async () => {
  const f = engineeringFixture();
  f.state().tasks.find((task) => task.id === "sibling")!.productId = "other-product";
  const before = structuredClone(f.state());
  assert.equal((await splitTaskCore(worker, input(), f.transaction)).ok, false);
  assert.deepEqual(f.state(), before);
});

test("ENGINEERING split rolls back both vectors, child, group, and receipt on write failure", async () => {
  for (const operation of ["log.create", "event.create"]) {
    const f = engineeringFixture();
    f.failOn(operation);
    const before = structuredClone(f.state());
    await assert.rejects(splitTaskCore(worker, input(), f.transaction), /Injected transactional failure/);
    assert.deepEqual(f.state(), before, operation);
  }
});

test("concurrent ENGINEERING splits at one revision produce a single child and single transfer", async () => {
  const f = engineeringFixture();
  const request = input();
  const results = await Promise.all([
    splitTaskCore(worker, request, f.transaction),
    splitTaskCore(worker, request, f.transaction),
  ]);
  assert.ok(results.every((result) => result.ok));
  assert.equal(results.filter((result) => result.ok && !result.repeated).length, 1);
  const children = f.state().tasks.filter((task) => task.id.startsWith("child-"));
  assert.equal(children.length, 1);
  assert.equal(f.state().groups.length, 1);
  const splitTasks = f.state().tasks.filter((task) => ["source", children[0]!.id, "sibling"].includes(task.id));
  assert.equal(splitTasks.reduce((sum, task) => sum + task.stageShareUnits!, 0), 1_000_000);
});

test("ENGINEERING split rejects non-DRAFT/wrong-kind pools and mismatched product/project links before writes", async () => {
  for (const mutate of [
    (s: State) => { s.works[0]!.stagePayPool!.state = "SETTLED"; },
    (s: State) => { s.works[0]!.stagePayPool!.kind = "ASSEMBLY"; },
    (s: State) => { s.works[0]!.stagePayPool!.productId = "other-product"; },
    (s: State) => { s.works[0].projectId = "other-project"; },
  ]) {
    const f = engineeringFixture();
    mutate(f.state());
    const before = structuredClone(f.state());
    const result = await splitTaskCore(manager, input(), f.transaction);
    assert.equal(result.ok, false);
    assert.deepEqual(f.state(), before);
  }
});

test("ENGINEERING split retains DONE, paid, stale revision, and idempotency guards", async () => {
  for (const stateName of ["done", "paid", "stale"]) {
    const f = engineeringFixture();
    if (stateName === "done") f.state().tasks.find((task) => task.id === "source")!.status = "DONE";
    if (stateName === "paid") f.state().entries.push({ id: "earned", taskId: "source", amount: "80.00" });
    const before = structuredClone(f.state());
    const result = await splitTaskCore(manager, input({ expectedRevision: stateName === "stale" ? 9 : 0 }), f.transaction);
    assert.equal(result.ok, false, stateName);
    assert.deepEqual(f.state(), before);
  }
  const f = engineeringFixture();
  const request = input();
  const first = await splitTaskCore(worker, request, f.transaction);
  if (!first.ok) assert.fail(first.error);
  const snapshot = structuredClone(f.state());
  const again = await splitTaskCore(worker, request, f.transaction);
  assert.ok(again.ok);
  assert.equal(again.repeated, true);
  assert.deepEqual(f.state(), snapshot);
});
