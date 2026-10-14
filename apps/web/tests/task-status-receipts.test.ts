import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { taskShareFixture } from "./helpers/task-share-fixture";
import { guardedModuleCache } from "./helpers/guarded-module-cache";

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
const scope = guardedModuleCache(import.meta.url, { targets: ["../src/server/tasks/actions"], allowedOverrides: Object.keys(overrides), overrides, prisma: database });
const { changeTaskStatus } = scope.load<typeof import("../src/server/tasks/actions")>("../src/server/tasks/actions");
after(() => scope.restore());

test("every optional status effect can fail after commit without losing ACK or repeating money/effects", async () => {
  for (const failure of ["dispatch", "payroll", "person", "org", "cache:/projects/project", "cache:product", "cache:/my", "cache:/tasks"]) {
    fixture = taskShareFixture(); effects.length = 0; fault = failure;
    const context = { clientMutationId: randomUUID(), expectedActorId: "manager" };
    const result = await changeTaskStatus("source", "DONE", 20, context);
    assert.equal(result.ok, true, failure); assert.equal(result.resultId, "source"); assert.equal(result.outcome, "COMMITTED");
    assert.equal(fixture.state().entries.length, 1); assert.equal(fixture.state().tasks[0].status, "DONE"); assert.equal(effects.length, 8);
    const before = structuredClone(fixture.state()), calls = effects.length, writes = fixture.writes.length;
    assert.equal((await changeTaskStatus("source", "DONE", 20, context)).ok, true);
    assert.deepEqual(fixture.state(), before); assert.deepEqual(effects.slice(calls), ["cache:/projects/project", "cache:product", "cache:/my", "cache:/tasks"]); assert.equal(fixture.writes.length, writes);
  }
});
