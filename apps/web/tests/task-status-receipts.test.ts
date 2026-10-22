import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { taskShareFixture } from "./helpers/task-share-fixture";
import { guardedModuleCache } from "./helpers/guarded-module-cache";
import { recordTaskStatusReceipt } from "../src/server/tasks/status-receipts";

let fixture = taskShareFixture(), fault = "";
const effects: string[] = [];
function effect(name: string) {
  assert.equal(fixture.inTransaction(), false); effects.push(name);
  if (fault === name) throw Error("CONTROLLED_OPTIONAL_EFFECT");
}
const database = new Proxy({}, { get(_target, key) {
  if (key === "$transaction") return (operation: Parameters<typeof fixture.transaction>[0]) => fixture.transaction(operation);
  if (key === "domainEvent") return { ...fixture.database.domainEvent,
    findUnique: async ({ where }: { where: { id: string } }) => fixture.state().events.find(row => row.id === where.id) ?? null };
  return fixture.database[key as keyof typeof fixture.database];
} });
const overrides = {
  "../src/auth": { auth: async () => ({ user: { id: "manager", name: "Manager", roles: ["MANAGER"] } }) },
  "next/cache": { revalidatePath: (path: string) => effect("cache:" + path) },
  "../src/server/products/revalidate": { revalidateProductPaths: async () => effect("cache:product") },
  "../src/server/plugins/events": { emitDomainEvent: async () => {}, dispatchEvent: async () => effect("dispatch") },
  "../src/server/notifications/notify": { notifyOrg: async (input: { type: string }) => effect(input.type === "payroll.orgAccrued" ? "payroll" : "org"), notifyPerson: async () => effect("person") },
  "../src/server/plugins/changelog": { writeChangeLog: async () => {} },
};
const scope = guardedModuleCache(import.meta.url, { targets: ["../src/server/tasks/actions", "../src/server/time/actions"], allowedOverrides: Object.keys(overrides), overrides, prisma: database });
const { changeTaskStatus } = scope.load<typeof import("../src/server/tasks/actions")>("../src/server/tasks/actions");
const timeActions = scope.load<typeof import("../src/server/time/actions")>("../src/server/time/actions");
after(() => scope.restore());

test("every optional status effect can fail after commit without losing ACK or repeating money/effects", async () => {
  for (const failure of ["dispatch", "payroll", "person", "org", "cache:/projects/project", "cache:product", "cache:/my", "cache:/tasks"]) {
    fixture = taskShareFixture(); effects.length = 0; fault = failure;
    const context = { clientMutationId: randomUUID(), expectedActorId: "manager" };
    const times = structuredClone(fixture.state().times);
    const result = await changeTaskStatus("source", "DONE", undefined, context);
    assert.equal(result.ok, true, failure); assert.equal(result.resultId, "source"); assert.equal(result.outcome, "COMMITTED");
    assert.equal(fixture.state().entries.length, 1); assert.equal(fixture.state().tasks[0].status, "DONE"); assert.equal(effects.length, 8);
    assert.deepEqual(fixture.state().times, times);
    const before = structuredClone(fixture.state()), calls = effects.length, writes = fixture.writes.length;
    assert.equal((await changeTaskStatus("source", "DONE", undefined, context)).ok, true);
    assert.deepEqual(fixture.state(), before); assert.deepEqual(effects.slice(calls), ["cache:/projects/project", "cache:product", "cache:/my", "cache:/tasks"]); assert.equal(fixture.writes.length, writes);
  }
});

test("status-only start and direct NEW completion preserve history, blockers and old UUID replay", async () => {
  fixture = taskShareFixture(); fault = "";
  fixture.state().tasks[0].status = "NEW";
  const times = structuredClone(fixture.state().times);
  assert.equal((await changeTaskStatus("source", "IN_PROGRESS")).ok, true);
  assert.deepEqual(fixture.state().times, times);
  fixture.state().tasks[0].status = "NEW";
  fixture.state().tasks[1].status = "NEW";
  const blocked = structuredClone(fixture.state());
  assert.equal((await changeTaskStatus("source", "DONE")).ok, false);
  assert.deepEqual(fixture.state(), blocked);
  fixture.state().tasks[1].status = "DONE";
  fixture.state().files.length = 0;
  assert.equal((await changeTaskStatus("source", "DONE")).ok, false);
  fixture.state().files.push({ id: "photo", taskId: "source", projectId: "project", productId: "product" });
  assert.equal((await changeTaskStatus("source", "DONE")).ok, true);
  assert.equal(fixture.state().entries.length, 1);
  assert.deepEqual(fixture.state().times, times);
  const request = { clientMutationId: randomUUID(), expectedActorId: "manager" };
  await fixture.transaction(tx => recordTaskStatusReceipt({ id: "manager", name: "Manager", roles: ["MANAGER"], source: "web" },
    { taskId: "source", toStatus: "DONE", actualMinutes: 20, request },
    { id: "source", title: "source", assigneeId: "worker", projectId: "project", projectNumber: "1", productId: "product", productNumber: "1.1" }, null, tx));
  const before = structuredClone(fixture.state());
  const replay = await changeTaskStatus("source", "DONE", 20, request);
  assert.equal(replay.ok, true); assert.equal(replay.ok && replay.replayed, true);
  assert.deepEqual(fixture.state(), before);
  assert.equal((await changeTaskStatus("source", "DONE", 20, { ...request, clientMutationId: randomUUID() })).ok, false);
  assert.equal((await timeActions.startTimer("source")).ok, false);
  assert.equal((await timeActions.stopTimer()).ok, false);
  assert.equal((await timeActions.addManualTime({ taskId: "source", minutes: 20 })).ok, false);
  assert.equal(await timeActions.getActiveTimer(), null);
  assert.deepEqual(fixture.state(), before);
});
