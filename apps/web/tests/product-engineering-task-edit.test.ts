import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { before, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { taskShareFixture } from "./helpers/task-share-fixture";

const require = createRequire(import.meta.url);
let fixture = taskShareFixture();
let actions: typeof import("../src/server/tasks/actions");
function inject(path: string, exports: Record<string, unknown>) {
  const filename = require.resolve(path), stub = new Module(filename); stub.exports = exports; stub.filename = filename; stub.loaded = true; require.cache[filename] = stub;
}
function engineering() {
  fixture = taskShareFixture();
  Object.assign(fixture.state().works[0], { paymentKind: "ENGINEERING", stagePayPoolId: "pool", poolWeightUnits: 1_000_000 });
  Object.assign(fixture.state().tasks[0], { stageShareUnits: 1_000_000, status: "NEW" });
}
before(() => {
  (globalThis as { prisma?: PrismaClient }).prisma = new Proxy({}, { get: (_target, key) => fixture.database[key as keyof typeof fixture.database] }) as PrismaClient;
  inject("../src/auth", { auth: async () => ({ user: { id: "manager", name: "Manager", roles: ["MANAGER"] } }) });
  inject("next/cache", { revalidatePath: () => {} });
  inject("../src/server/products/revalidate", { revalidateProductPaths: async () => {} });
  inject("../src/server/plugins/changelog", { writeChangeLog: async () => {} });
  inject("../src/server/plugins/events", { emitDomainEvent: async () => {}, dispatchEvent: async () => {} });
  inject("../src/server/notifications/notify", { notifyOrg: async () => {}, notifyPerson: async () => {} });
  actions = require("../src/server/tasks/actions");
});

test("manager can edit ordinary fields and reassign an unpaid engineering task without changing its pay vector", async () => {
  engineering(); fixture.state().users.find((user) => user.id === "recipient")!.roles = ["ENGINEER"];
  const result = await actions.updateTask("source", { title: "Уточнённое название", assigneeId: "recipient", estimateMinutes: 45 });
  assert.ok(result.ok);
  assert.equal(fixture.state().tasks[0].assigneeId, "recipient");
  assert.equal(fixture.state().tasks[0].stageShareUnits, 1_000_000);
  assert.equal(fixture.state().tasks[0].quantity, "10");
  assert.equal(fixture.state().pools[0].revision, 1);
});

test("manager can explicitly repair missing quantity on an ungrouped converted NEW task", async () => {
  engineering(); fixture.state().tasks[0].quantity = null;
  const result = await actions.updateTask("source", { quantity: 2 });
  assert.ok(result.ok); assert.equal(fixture.state().tasks[0].quantity, "2.00");
  assert.equal(fixture.state().tasks[0].stageShareUnits, 1_000_000);
});

test("engineering task cannot change its fund context, paid facts or settled state through generic edit", async () => {
  for (const change of [{ workId: null }, { productId: null }]) {
    engineering(); const before = structuredClone(fixture.state());
    assert.equal((await actions.updateTask("source", change)).ok, false); assert.deepEqual(fixture.state(), before);
  }
  for (const condition of ["done", "paid", "settled"]) {
    engineering();
    if (condition === "done") fixture.state().tasks[0].status = "DONE";
    if (condition === "paid") fixture.state().entries.push({ id: "paid", workId: "work", amount: "1" });
    if (condition === "settled") fixture.state().pools[0].state = "SETTLED";
    const before = structuredClone(fixture.state());
    assert.equal((await actions.updateTask("source", { title: "forbidden" })).ok, false); assert.deepEqual(fixture.state(), before);
  }
});

test("reassignment of an active engineering task stops the old timer and lets the new assignee start their own", async () => {
  engineering(); fixture.state().tasks[0].status = "IN_PROGRESS";
  assert.ok((await actions.updateTask("source", { assigneeId: "recipient" })).ok);
  assert.equal(fixture.state().tasks[0].status, "NEW");
  assert.ok(fixture.state().times.every((entry) => entry.stoppedAt !== null));
  assert.equal(fixture.state().times[0].minutes, 20);
});
