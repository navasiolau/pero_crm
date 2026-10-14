import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { guardedModuleCache } from "./helpers/guarded-module-cache";
import type { TaskCreateAck, TaskCreateRequest } from "../src/server/tasks/creation-receipts";

type Commands = typeof import("../src/components/use-task-create-command");
const input = (): TaskCreateRequest => ({ clientMutationId: randomUUID(), expectedActorId: "manager", projectId: "project",
  productId: "product", workId: "work", assigneeId: "recipient", title: "Создание", type: "Производство", quantity: 1,
  dueAt: "2026-10-12", estimateMinutes: 10, dependencyIds: ["b", "a", "a"] });
function setup() {
  const scope = guardedModuleCache(import.meta.url, {
    prisma: {}, targets: ["../src/components/use-task-create-command"], allowedOverrides: ["../src/server/tasks/actions"],
    overrides: { "../src/server/tasks/actions": { createTask: async () => { throw Error("DEFAULT_ACTION_MUST_NOT_RUN"); } } },
  });
  return { scope, commands: scope.load<Commands>("../src/components/use-task-create-command") };
}

test("UNKNOWN pins the original frozen request across absence, refusal and mismatched ACK", async () => {
  const f = setup(); try {
    const request = input(), sent: TaskCreateRequest[] = []; let mode = "lost";
    const controller = f.commands.createTaskCreationCommands(async data => {
      sent.push(data);
      if (mode === "lost") throw Error("Transport ACK lost");
      if (mode === "attempt" || mode === "absent") return { ok: false, outcome: "ROLLED_BACK", kind: "rejected", retrySafe: false,
        error: "Refused attempt", clientMutationId: data.clientMutationId, intentResolution: mode === "attempt" ? "attempt-only" : "verified-absent" };
      return { ok: true, outcome: "COMMITTED", resultId: "original-task", clientMutationId: mode === "mismatch" ? randomUUID() : data.clientMutationId };
    }, () => request.clientMutationId.toUpperCase());
    controller.observeActor("manager"); assert.equal((await controller.run("manager", request))?.outcome, "UNKNOWN");
    for (const next of ["attempt", "absent", "mismatch"]) {
      mode = next; assert.equal((await controller.run("manager", request))?.outcome, "UNKNOWN");
      assert.equal(controller.peek("manager", request)?.request.clientMutationId, request.clientMutationId);
    }
    const count = sent.length; await controller.run("manager", { ...request, quantity: 2 }); assert.equal(sent.length, count);
    mode = "confirmed"; assert.equal((await controller.run("manager", request))?.ok, true);
    assert.equal(controller.peek("manager", request), undefined); assert.ok(sent.every(row => row === sent[0]));
    assert.ok(Object.isFrozen(sent[0])); assert.ok(Object.isFrozen(sent[0].dependencyIds));
    assert.deepEqual(sent[0].dependencyIds, ["a", "b"]); assert.equal(sent[0].requiresPhoto, false);
  } finally { f.scope.restore(); }
});

test("a late ACK from another actor generation cannot release the unresolved original UUID", async () => {
  const f = setup(); try {
    const request = input(); let calls = 0, release!: (ack: TaskCreateAck) => void;
    const controller = f.commands.createTaskCreationCommands(async () => { calls++; return new Promise<TaskCreateAck>(resolve => { release = resolve; }); }, () => request.clientMutationId);
    controller.observeActor("manager"); const first = controller.run("manager", request), duplicate = controller.run("manager", request);
    controller.observeActor("admin"); release({ ok: true, outcome: "COMMITTED", resultId: "original-task", clientMutationId: request.clientMutationId });
    assert.equal(await first, null); assert.equal(await duplicate, null); assert.equal(calls, 1); assert.equal(controller.peek("admin", request), undefined);
    controller.observeActor("manager"); assert.equal(controller.peek("manager", request)?.request.clientMutationId, request.clientMutationId);
    const retry = controller.run("manager", request);
    release({ ok: false, outcome: "ROLLED_BACK", kind: "rejected", retrySafe: false, error: "Absent attempt", clientMutationId: request.clientMutationId, intentResolution: "verified-absent" });
    assert.equal((await retry)?.outcome, "UNKNOWN"); assert.ok(controller.peek("manager", request));
    const confirmed = controller.run("manager", request);
    release({ ok: true, outcome: "COMMITTED", resultId: "original-task", clientMutationId: request.clientMutationId });
    assert.equal((await confirmed)?.ok, true); assert.equal(controller.peek("manager", request), undefined);
  } finally { f.scope.restore(); }
});
