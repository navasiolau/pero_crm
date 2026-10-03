import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { before, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { taskShareFixture } from "./helpers/task-share-fixture";

const require = createRequire(import.meta.url);
let fixture = taskShareFixture("DESIGN");
let actions: typeof import("../src/server/tasks/actions");
function inject(path: string, exports: Record<string, unknown>) {
  const filename = require.resolve(path), stub = new Module(filename); stub.exports = exports; stub.filename = filename; stub.loaded = true; require.cache[filename] = stub;
}
function engineering() {
  fixture = taskShareFixture("DESIGN");
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

test("manager can edit legacy engineering title/deadline without moving pay vector or frozen payroll", async () => {
  engineering();fixture.state().works[0].priceSnapshot=null;
  fixture.state().works.push({...fixture.state().works[0],id:"another-work",paymentKind:"LEGACY",priceSnapshot:"700",quantity:"1",total:"700",stagePayPoolId:null});
  fixture.state().entries.push({id:"original-700",userId:"worker",projectId:"project",workId:"another-work",scheme:"PIECE",month:"2026-09",amount:"700",bynAmount:"700",currency:"BYN"});
  const originalEntries=structuredClone(fixture.state().entries);
  const result = await actions.updateTask("source", { title: "Уточнённое название", dueAt:"2026-10-10", estimateMinutes: 45 });
  assert.ok(result.ok);
  assert.equal(fixture.state().tasks[0].assigneeId, "worker");
  assert.equal(fixture.state().tasks[0].stageShareUnits, 1_000_000);
  assert.equal(fixture.state().tasks[0].quantity, "10");
  assert.equal(fixture.state().pools[0].revision, 1);
  assert.deepEqual(fixture.state().entries,originalEntries);
  assert.equal(fixture.state().works[0].priceSnapshot,null);
});

test("manager can explicitly repair missing quantity on an ordinary priced NEW task", async () => {
  fixture=taskShareFixture("DESIGN");fixture.state().tasks[0].status="NEW";fixture.state().tasks[0].quantity = null;
  const result = await actions.updateTask("source", { quantity: 2 });
  assert.ok(result.ok); assert.equal(fixture.state().tasks[0].quantity, "2.00");
  assert.equal(fixture.state().works[0].priceSnapshot,"100");
  assert.equal(fixture.state().entries.length,0);
});

test("legacy engineering quantity cannot be redistributed by generic repair",async()=>{
  engineering();fixture.state().tasks[0].quantity=null;const before=structuredClone(fixture.state());
  assert.equal((await actions.updateTask("source",{quantity:2})).ok,false);assert.deepEqual(fixture.state(),before);
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

test("legacy active engineering reassignment is refused without stopping timer or moving pay", async () => {
  engineering(); fixture.state().tasks[0].status = "IN_PROGRESS";
  const before=structuredClone(fixture.state());
  assert.equal((await actions.updateTask("source", { assigneeId: "recipient" })).ok,false);
  assert.deepEqual(fixture.state(),before);
  assert.equal(fixture.state().tasks[0].status, "IN_PROGRESS");
  assert.ok(fixture.state().times.every((entry) => entry.stoppedAt === null));
  assert.equal(fixture.state().times[0].minutes, 20);
});
