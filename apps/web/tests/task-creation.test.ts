import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Prisma } from "@prisma/client";
import { taskShareFixture } from "./helpers/task-share-fixture";
import { guardedModuleCache } from "./helpers/guarded-module-cache";
import { matches } from "./helpers/visibility-fixture";
import { taskCreateFingerprint, taskCreateReceiptId } from "../src/server/tasks/creation-receipts";
import type { TaskCreateAck, TaskCreateRequest } from "../src/server/tasks/creation-receipts";

const input = (extra: Partial<TaskCreateRequest> = {}): TaskCreateRequest => ({ clientMutationId: randomUUID(), expectedActorId: "manager",
  projectId: "project", productId: "product", workId: "work", assigneeId: "recipient", title: "Создание", type: "Производство",
  quantity: 1, dueAt: "2026-10-12", estimateMinutes: 10, ...extra });
function setup() {
  const fixture = taskShareFixture(); fixture.state().tasks[0].workId = null; fixture.state().tasks[0].quantity = null;
  let actor = { id: "manager", name: "Manager", roles: ["MANAGER"] }, fault = "", noStart = false, lostAck = false, reads = 0;
  const effects: string[] = [];
  function effect(name: string) { assert.equal(fixture.inTransaction(), false); effects.push(name); if (fault === name) throw new Error("Injected private effect failure"); }
  const transaction = async <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> => {
    if (noStart) { noStart = false; throw new Error("Injected not-started attempt"); }
    const result = await fixture.transaction(tx => operation(new Proxy(tx, { get(target, key, receiver) {
      if (key === "changeLog") return { ...target.changeLog,
        findUnique: async (args: Parameters<typeof target.changeLog.findUnique>[0]) => { reads++; if (fault === "read") throw new Error("Injected read IO"); return target.changeLog.findUnique(args); },
        create: async (args: Parameters<typeof target.changeLog.create>[0]) => {
          if (fault === "receipt" && args.data.action === "task.create.request") throw new Error("Injected receipt failure");
          return target.changeLog.create(args);
        } };
      return Reflect.get(target, key, receiver);
    } })));
    if (lostAck) { lostAck = false; if (fault === "lost-and-read") fault = "read"; throw new Error("Injected commit ACK loss"); }
    return result;
  };
  const database = { ...fixture.database, $transaction: transaction, changeLog: { ...fixture.database.changeLog,
    findMany: async ({ where, orderBy, take }: { where: Record<string, unknown>; orderBy: unknown; take: number }) => {
      const evaluate = (row: Record<string, unknown>, filter: Record<string, unknown>): boolean => Object.entries(filter).every(([key, value]) => {
        if (key === "NOT") return !evaluate(row, value as Record<string, unknown>);
        if (key === "OR") return (value as Record<string, unknown>[]).some(part => evaluate(row, part));
        if (value && typeof value === "object" && "startsWith" in value) return String(row[key]).startsWith(String(value.startsWith));
        return matches(row, { [key]: value });
      });
      assert.deepEqual(orderBy, { createdAt: "desc" }); assert.equal(take, 200); return fixture.state().logs.filter(row => evaluate(row, where)).slice(0, take);
    } } };
  const overrides = {
    "../src/auth": { auth: async () => ({ user: actor }) }, "next/cache": { revalidatePath: (path: string) => effect("cache:" + path) },
    "../src/server/products/revalidate": { revalidateProductPaths: async () => effect("product-cache") },
    "../src/server/plugins/changelog": { writeChangeLog: async () => { throw new Error("Create audit escaped transaction"); } },
    "../src/server/plugins/events": { emitDomainEvent: async () => { throw new Error("Create outbox escaped transaction"); }, dispatchEvent: async () => effect("dispatch") },
    "../src/server/notifications/notify": { notifyOrg: async () => effect("org"), notifyPerson: async () => effect("person") },
    "../src/server/require-role": { requireRole: async () => {} },
  };
  const scope = guardedModuleCache(import.meta.url, { targets: ["../src/server/tasks/actions", "../src/components/use-task-create-command", "../src/server/changelog/queries"],
    allowedOverrides: Object.keys(overrides), overrides, prisma: database });
  return { fixture, scope, effects, actions: scope.load<typeof import("../src/server/tasks/actions")>("../src/server/tasks/actions"),
    commands: scope.load<typeof import("../src/components/use-task-create-command")>("../src/components/use-task-create-command"),
    reads: () => reads, actor: (value: typeof actor) => { actor = value; }, fault: (value: string) => { fault = value; }, noStart: () => { noStart = true; }, loseAck: () => { lostAck = true; } };
}

test("canonical fingerprint normalizes defaults/dates/dependency sets but preserves actor and requested remainder", () => {
  const a = input({ dependencyIds: ["b", "a", "a"] });
  assert.equal(taskCreateFingerprint("manager", a), taskCreateFingerprint("manager", { ...a, requiresPhoto: false, dependencyIds: ["a", "b"], dueAt: "2026-10-12T00:00:00.000Z" }));
  assert.notEqual(taskCreateFingerprint("manager", a), taskCreateFingerprint("other", a));
  assert.notEqual(taskCreateFingerprint("manager", a), taskCreateFingerprint("manager", { ...a, quantity: undefined }));
  assert.equal(taskCreateReceiptId(a.clientMutationId.toUpperCase()), taskCreateReceiptId(a.clientMutationId));
});
test("invalid request or actor precondition refuses before writes and receipt reads", async () => {
  const f = setup(); try {
    for (const change of [{ clientMutationId: undefined }, { clientMutationId: "bad" }, { dueAt: "bad" }, { quantity: 0.001 }, { expectedActorId: "other" }]) {
      const r = await f.actions.createTask({ ...input(), ...change } as never); assert.equal(r.ok, false); assert.equal(r.outcome, "ROLLED_BACK");
    }
    assert.deepEqual(f.fixture.writes, []); assert.equal(f.reads(), 0);
  } finally { f.scope.restore(); }
});
test("actual action late audit/outbox/receipt failures atomically roll back task and dependencies", async () => {
  for (const fault of ["log.create", "event.create", "receipt"]) {
    const f = setup(); try {
      if (fault === "receipt") f.fault(fault); else f.fixture.failOn(fault);
      const before = structuredClone(f.fixture.state()), r = await f.actions.createTask(input({ dependencyIds: ["predecessor"] }));
      assert.equal(r.ok, false); assert.equal(r.outcome, "ROLLED_BACK"); assert.deepEqual(f.fixture.state(), before); assert.deepEqual(f.effects, []);
      if (!r.ok) { assert.equal(r.intentResolution, "verified-absent"); assert.doesNotMatch(r.error, /Injected/); }
    } finally { f.scope.restore(); }
  }
});
test("lost commit ACK recovers receipt; failed proof is UNKNOWN; not-started retry is attempt-only", async () => {
  const f = setup(); try {
    f.loseAck(); const recovered = await f.actions.createTask(input()); assert.equal(recovered.ok, true); if (recovered.ok) assert.equal(recovered.replayed, true);
    f.fault("lost-and-read"); f.loseAck(); const request = input(); assert.equal((await f.actions.createTask(request)).outcome, "UNKNOWN");
    f.fault(""); f.noStart(); const attempt = await f.actions.createTask(request); assert.equal(attempt.ok, false); if (!attempt.ok) assert.equal(attempt.intentResolution, "attempt-only");
    assert.equal((await f.actions.createTask(request)).ok, true); assert.equal(f.fixture.state().tasks.filter(row => row.workId === "work").length, 2);
  } finally { f.scope.restore(); }
});
test("each optional dispatch/person/cache fault preserves ACK and other effects", async () => {
  for (const fault of ["dispatch", "person", "cache:/projects/project", "product-cache", "cache:/my"]) {
    const f = setup(); try { f.fault(fault); assert.equal((await f.actions.createTask(input())).ok, true);
      assert.deepEqual(f.effects, ["dispatch", "person", "cache:/projects/project", "product-cache", "cache:/my"]); assert.equal(f.fixture.state().logs.length, 2); assert.equal(f.fixture.state().events.length, 1);
    } finally { f.scope.restore(); }
  }
});
test("global reader excludes exact internal create/status receipts before limit and preserves other rows", async () => {
  const f = setup(); try {
    for (const row of [{ id: "task-create:a", entity: "task", action: "task.create.request" }, { id: "task-status:a", entity: "task", action: "task.status.request" },
      { id: "business", entity: "task", action: "create" }, { id: "task-create:old", entity: "task", action: "create" }, { id: "old", entity: "task", action: "task.create.request" }, { id: "task-create:other", entity: "project", action: "task.create.request" }]) f.fixture.state().logs.push(row);
    const query = f.scope.load<typeof import("../src/server/changelog/queries")>("../src/server/changelog/queries");
    assert.deepEqual((await query.listGlobalChangeLog({})).map(row => row.id), ["business", "task-create:old", "old", "task-create:other"]);
  } finally { f.scope.restore(); }
});
test("client pins lost ACK across refusal/absence/mismatch and blocks changed payload until matching commit", async () => {
  const f = setup(); try {
    const requests: TaskCreateRequest[] = [], request = input(); let mode = "lost";
    const controller = f.commands.createTaskCreationCommands(async data => {
      requests.push(data); const committed = await f.actions.createTask(data); if (mode === "lost") throw new Error("Injected transport ACK loss");
      if (mode === "attempt" || mode === "absent") return { ok: false, outcome: "ROLLED_BACK", kind: "rejected", retrySafe: false, error: "refused attempt", clientMutationId: data.clientMutationId, intentResolution: mode === "attempt" ? "attempt-only" : "verified-absent" };
      if (mode === "mismatch" && committed.ok) return { ...committed, clientMutationId: randomUUID() }; return committed;
    }, () => request.clientMutationId);
    controller.observeActor("manager"); assert.equal((await controller.run("manager", request))?.outcome, "UNKNOWN");
    for (const next of ["attempt", "absent", "mismatch"]) { mode = next; assert.equal((await controller.run("manager", request))?.outcome, "UNKNOWN"); assert.equal(controller.peek("manager", request)?.request.clientMutationId, request.clientMutationId); }
    const sent = requests.length; await controller.run("manager", { ...request, quantity: 2 }); assert.equal(requests.length, sent);
    mode = "replay"; assert.equal((await controller.run("manager", request))?.ok, true); assert.equal(controller.peek("manager", request), undefined); assert.equal(f.fixture.state().tasks.filter(row => row.workId === "work").length, 1);
    assert.ok(requests.every(data => data === requests[0])); assert.equal(Object.isFrozen(requests[0].dependencyIds), true);
  } finally { f.scope.restore(); }
});
test("late original and stale actor ACK cannot release an unresolved original intent or create a fresh UUID", async () => {
  const f = setup(); try {
    const delayedRequest = input(); let openOriginal!: () => void;
    const gate = new Promise<void>(done => { openOriginal = done; });
    let original: Promise<TaskCreateAck> | undefined, attempt = 0;
    const delayed = f.commands.createTaskCreationCommands(async data => {
      if (++attempt === 1) { original = gate.then(() => f.actions.createTask(data)); throw new Error("Original delayed before transaction; transport ACK unavailable"); }
      return f.actions.createTask(data);
    }, () => delayedRequest.clientMutationId);
    delayed.observeActor("manager"); assert.equal((await delayed.run("manager", delayedRequest))?.outcome, "UNKNOWN");
    f.fixture.state().works[0].quantity = "0";
    const absent = await delayed.run("manager", delayedRequest); assert.equal(absent?.outcome, "UNKNOWN");
    assert.equal(delayed.peek("manager", delayedRequest)?.request.clientMutationId, delayedRequest.clientMutationId);
    f.fixture.state().works[0].quantity = "10"; openOriginal(); assert.equal((await original)?.ok, true);
    assert.equal((await delayed.run("manager", delayedRequest))?.ok, true); assert.equal(f.fixture.state().tasks.filter(row => row.workId === "work").length, 1);
    let release!: (value: TaskCreateAck) => void; const request = input(); let calls = 0;
    const controller = f.commands.createTaskCreationCommands(async () => { calls++; return new Promise<TaskCreateAck>(done => { release = done; }); }, () => request.clientMutationId);
    controller.observeActor("manager"); const a = controller.run("manager", request), b = controller.run("manager", request);
    controller.observeActor("admin"); release({ ok: true, outcome: "COMMITTED", resultId: "late-original", clientMutationId: request.clientMutationId });
    assert.equal(await a, null); assert.equal(await b, null); assert.equal(calls, 1); assert.equal(controller.peek("admin", request), undefined);
    controller.observeActor("manager"); assert.equal(controller.peek("manager", request)?.request.clientMutationId, request.clientMutationId);
    const retry = controller.run("manager", request); release({ ok: false, outcome: "ROLLED_BACK", kind: "rejected", retrySafe: false, error: "absent", clientMutationId: request.clientMutationId, intentResolution: "verified-absent" });
    assert.equal((await retry)?.outcome, "UNKNOWN"); assert.ok(controller.peek("manager", request));
    const final = controller.run("manager", request); release({ ok: true, outcome: "COMMITTED", resultId: "late-original", clientMutationId: request.clientMutationId });
    assert.equal((await final)?.ok, true); assert.equal(controller.peek("manager", request), undefined);
  } finally { f.scope.restore(); }
});

test("payload/actor/receipt collisions refuse, current actor is rechecked, and new UUID permits same independent task", async () => {
  const f = setup(); try {
    const request = input(); assert.equal((await f.actions.createTask(request)).ok, true); const before = structuredClone(f.fixture.state());
    const mismatch = await f.actions.createTask({ ...request, quantity: 2 }); assert.equal(mismatch.ok, false); if (!mismatch.ok) assert.equal(mismatch.kind, "conflict");
    f.actor({ id: "admin", name: "Admin", roles: ["ADMIN"] }); assert.equal((await f.actions.createTask({ ...request, expectedActorId: "admin" })).ok, false); assert.deepEqual(f.fixture.state(), before);
    f.actor({ id: "manager", name: "Manager", roles: ["MANAGER", "ENGINEER"] }); assert.equal((await f.actions.createTask(input())).ok, true); assert.equal(f.fixture.state().tasks.filter(row => row.workId === "work").length, 2);
    const reads = f.reads(); f.fixture.state().users.find(row => row.id === "manager")!.active = false; assert.equal((await f.actions.createTask(request)).ok, false); assert.equal(f.reads(), reads);
    f.fixture.state().users.find(row => row.id === "manager")!.active = true;
    const receipt = f.fixture.state().logs.find(row => row.action === "task.create.request")!, original = structuredClone(receipt);
    for (const change of [{ actorType: "plugin" }, { action: "create" }, { entity: "project" }, { entityId: "other" }, { newValue: { resultId: "wrong" } }]) {
      Object.assign(receipt, original, change); const state = structuredClone(f.fixture.state()); assert.equal((await f.actions.createTask(request)).ok, false); assert.deepEqual(f.fixture.state(), state);
    }
  } finally { f.scope.restore(); }
});
