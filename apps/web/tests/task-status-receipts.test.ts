import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire, Module } from "node:module";
import { before, after, test } from "node:test";
import type { PrismaClient, Role } from "@prisma/client";
import { taskShareFixture } from "./helpers/task-share-fixture";

const require = createRequire(import.meta.url);
const originalModules = new Map<string, NodeJS.Module | undefined>();
const originalPrisma = (globalThis as { prisma?: PrismaClient }).prisma;
function inject(name: string, exports: Record<string, unknown>) {
  const file = require.resolve(name); originalModules.set(file, require.cache[file]);
  const stub = new Module(file); stub.filename = file; stub.loaded = true; stub.exports = exports; require.cache[file] = stub;
}
let fixture = taskShareFixture();
let effectFault: string | null = null;
let lostAck = false;
let actorId = "manager";
let actorRoles: Role[] = ["MANAGER"];
const effects: string[] = [];
type RequestContext = { clientMutationId: string; expectedActorId: string };
type Ack = { ok: boolean; resultId?: string; outcome?: string; error?: string; kind?: string; replayed?: boolean };
let status: (id: string, to: "IN_PROGRESS" | "DONE", minutes?: number, context?: RequestContext) => Promise<Ack>;
function reset() { fixture = taskShareFixture(); effectFault = null; lostAck = false; actorId = "manager"; actorRoles = ["MANAGER"]; effects.length = 0; }
function effect(name: string) {
  assert.equal(fixture.inTransaction(), false, "effect before commit"); effects.push(name);
  if (effectFault === name) throw Error("Injected effect failure");
}
before(() => {
  const proxy = new Proxy({}, { get: (_target, key) => {
    if (key === "$transaction") return async (operation: Parameters<typeof fixture.transaction>[0]) => {
      const result = await fixture.transaction(operation);
      if (lostAck) { lostAck = false; throw Error("Injected lost commit ACK"); }
      return result;
    };
    if (key === "domainEvent") return { ...fixture.database.domainEvent, findUnique: async ({ where }: { where: { id: string } }) => fixture.state().events.find(row => row.id === where.id) ?? null };
    return fixture.database[key as keyof typeof fixture.database];
  } });
  (globalThis as { prisma?: PrismaClient }).prisma = proxy as PrismaClient;
  inject("../src/auth", { auth: async () => ({ user: { id: actorId, name: "Actor", roles: actorRoles } }) });
  inject("next/cache", { revalidatePath: (path: string) => effect("cache:" + path) });
  inject("../src/server/products/revalidate", { revalidateProductPaths: async () => effect("cache:product") });
  inject("../src/server/plugins/events", { emitDomainEvent: async () => {}, dispatchEvent: async () => effect("dispatch") });
  inject("../src/server/notifications/notify", { notifyOrg: async (input: { type: string }) => effect(input.type === "payroll.orgAccrued" ? "payroll" : "org"), notifyPerson: async () => effect("person") });
  inject("../src/server/plugins/changelog", { writeChangeLog: async () => {} });
  status = require("../src/server/tasks/actions").changeTaskStatus;
});
after(() => {
  for (const [file, value] of originalModules) if (value) require.cache[file] = value; else delete require.cache[file];
  (globalThis as { prisma?: PrismaClient }).prisma = originalPrisma;
});

test("each post-commit failure preserves task ACK and stable result", async () => {
  for (const fault of ["dispatch", "payroll", "person", "org", "cache:/projects/project", "cache:product", "cache:/my", "cache:/tasks"]) {
    reset(); effectFault = fault;
    const context = { clientMutationId: randomUUID(), expectedActorId: actorId };
    const first = await status("source", "DONE", 20, context);
    assert.equal(first.ok, true, fault); assert.equal(first.resultId, "source"); assert.equal(first.outcome, "COMMITTED");
    assert.equal(fixture.state().entries.length, 1); assert.equal(fixture.state().tasks[0].status, "DONE");
    assert.equal(effects.length, 8, "a failed effect blocked later effects");
    const writes = fixture.writes.length, notifications = effects.filter(value => !value.startsWith("cache:")).length;
    assert.equal((await status("source", "DONE", 20, context)).ok, true);
    assert.equal(fixture.writes.length, writes); assert.equal(effects.filter(value => !value.startsWith("cache:")).length, notifications);
  }
});

test("old tab cannot create a new intent for switched server actor", async () => {
  reset(); actorId = "other-manager";
  const result = await status("source", "DONE", 20, { clientMutationId: randomUUID(), expectedActorId: "manager" });
  assert.equal(result.ok, false); assert.equal(result.kind, "actor-changed");
  assert.equal(fixture.writes.length, 0); assert.equal(effects.length, 0);
});

test("lost commit ACK reconciles exact persisted receipt without rerunning mutation", async () => {
  reset(); lostAck = true;
  const context = { clientMutationId: randomUUID(), expectedActorId: actorId };
  const result = await status("source", "DONE", 20, context);
  assert.equal(result.ok, true); assert.equal(result.resultId, "source"); assert.equal(result.outcome, "COMMITTED");
  assert.equal(fixture.state().entries.length, 1); assert.equal(fixture.state().events.length, 1);
});

test("receipt-read abort on a previously committed status replays the original ACK", async () => {
  reset(); const context = { clientMutationId: randomUUID(), expectedActorId: actorId };
  const first = await status("source", "DONE", 20, context); assert.equal(first.ok, true);
  const before = structuredClone(fixture.state()), writes = fixture.writes.length;
  const read = fixture.database.changeLog.findUnique; let loseRead = true;
  fixture.database.changeLog.findUnique = async query => { if (loseRead) { loseRead = false; throw Error("Injected receipt read IO"); } return read(query); };
  const replay = await status("source", "DONE", 20, context);
  assert.equal(replay.ok, true); assert.equal(replay.resultId, first.resultId); assert.equal(replay.replayed, true);
  assert.deepEqual(fixture.state(), before); assert.equal(fixture.writes.length, writes);
});

test("status receipt rejects changed time, task and actor without further writes", async () => {
  reset(); const context = { clientMutationId: randomUUID(), expectedActorId: actorId };
  await status("source", "DONE", 20, context); const before = structuredClone(fixture.state()), writes = fixture.writes.length;
  assert.equal((await status("source", "DONE", 30, context)).ok, false);
  assert.equal((await status("dependent", "DONE", 20, context)).ok, false);
  actorId = "other-manager"; assert.equal((await status("source", "DONE", 20, { ...context, expectedActorId: actorId })).ok, false);
  assert.deepEqual(fixture.state(), before); assert.equal(fixture.writes.length, writes);
});

test("old START receipt after lawful DONE confirms history without changing current state", async () => {
  reset(); fixture.state().tasks[0].status = "NEW"; fixture.state().times = [];
  const start = { clientMutationId: randomUUID(), expectedActorId: actorId };
  assert.equal((await status("source", "IN_PROGRESS", undefined, start)).ok, true);
  assert.equal((await status("source", "DONE", 20, { clientMutationId: randomUUID(), expectedActorId: actorId })).ok, true);
  const before = structuredClone(fixture.state()), writes = fixture.writes.length;
  const replay = await status("source", "IN_PROGRESS", undefined, start);
  assert.equal(replay.ok, true); assert.equal(replay.replayed, true); assert.equal(replay.resultId, "source");
  assert.ok(!("task" in replay)); assert.ok(!("status" in replay));
  assert.equal(fixture.state().tasks[0].status, "DONE"); assert.deepEqual(fixture.state(), before); assert.equal(fixture.writes.length, writes);
});

test("current engineering reassignment is rejected and ordinary reassignment keeps progress", async () => {
  reset(); const { updateTask } = require("../src/server/tasks/actions") as typeof import("../src/server/tasks/actions");
  fixture.state().works[0].paymentKind = "ENGINEERING";
  const before = structuredClone(fixture.state());
  assert.equal((await updateTask("source", { assigneeId: "recipient" })).ok, false);
  assert.deepEqual(fixture.state(), before); assert.equal(fixture.writes.length, 0);
  fixture.state().works[0].paymentKind = "LEGACY";
  assert.equal((await updateTask("source", { assigneeId: "recipient" })).ok, true);
  assert.equal(fixture.state().tasks[0].status, "IN_PROGRESS"); assert.equal(fixture.state().tasks[0].assigneeId, "recipient");
});

test("own minimal receipt remains replayable after lawful ordinary reassignment removes current visibility", async () => {
  reset(); fixture.state().tasks[0].status = "NEW"; fixture.state().times = [];
  actorId = "worker"; actorRoles = ["WORKER"];
  const context = { clientMutationId: randomUUID(), expectedActorId: actorId };
  assert.equal((await status("source", "IN_PROGRESS", undefined, context)).ok, true);
  actorId = "manager"; actorRoles = ["MANAGER"];
  const { updateTask } = require("../src/server/tasks/actions") as typeof import("../src/server/tasks/actions");
  assert.equal((await updateTask("source", { assigneeId: "recipient" })).ok, true);
  const before = structuredClone(fixture.state()), writes = fixture.writes.length;
  actorId = "worker"; actorRoles = ["WORKER"];
  const legacy = await status("source", "IN_PROGRESS"); assert.equal(legacy.ok, false);
  const replay = await status("source", "IN_PROGRESS", undefined, context);
  assert.equal(replay.ok, true); assert.equal(replay.replayed, true);
  assert.ok(!("task" in replay)); assert.ok(!("status" in replay)); assert.ok(!("payroll" in replay));
  assert.deepEqual(fixture.state(), before); assert.equal(fixture.writes.length, writes);
});