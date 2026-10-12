"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createRequestId } from "@/lib/request-id";
import { createTask } from "@/server/tasks/actions";
import type { TaskCreateAck, TaskCreatePayload, TaskCreateRequest } from "@/server/tasks/creation-receipts";

type Scope = Pick<TaskCreatePayload, "projectId" | "productId" | "workId">;
type Intent = { request: TaskCreateRequest; uncertain: boolean };
type Sender = (request: TaskCreateRequest) => Promise<TaskCreateAck>;
const key = (actor: string, scope: Scope) => JSON.stringify([actor, scope.projectId, scope.productId ?? null, scope.workId ?? null]);
function payload(data: TaskCreatePayload): TaskCreatePayload {
  return { projectId: data.projectId, productId: data.productId, workId: data.workId, assigneeId: data.assigneeId,
    title: data.title, type: data.type, quantity: data.quantity, dueAt: data.dueAt,
    estimateMinutes: data.estimateMinutes, requiresPhoto: data.requiresPhoto ?? false,
    dependencyIds: [...new Set(data.dependencyIds ?? [])].sort() };
}
const samePayload = (a: TaskCreatePayload, b: TaskCreatePayload) => JSON.stringify(payload(a)) === JSON.stringify(payload(b));

/** UNKNOWN закрепляет UUID даже после отсутствия receipt: исходный запрос ещё может ждать lock. */
export function createTaskCreationCommands(send: Sender, requestId: () => string = createRequestId) {
  let actorId = "", generation = 0;
  const intents = new Map<string, Intent>(), inFlight = new Map<string, Promise<TaskCreateAck | null>>();
  function observeActor(next: string) { if (next !== actorId) { actorId = next; generation += 1; } }
  function peek(actor: string, scope: Scope) { return actor === actorId ? intents.get(key(actor, scope)) : undefined; }
  async function run(actor: string, data: TaskCreatePayload): Promise<TaskCreateAck | null> {
    if (!actor || actor !== actorId) return null;
    const intentKey = key(actor, data), saved = intents.get(intentKey);
    const uncertain = (request: TaskCreateRequest, error: string): Extract<TaskCreateAck, { ok: false }> =>
      ({ ok: false, outcome: "UNKNOWN", kind: "unavailable", retrySafe: true, error,
        clientMutationId: request.clientMutationId, intentResolution: "attempt-only" });
    if (saved && !samePayload(saved.request, data))
      return uncertain(saved.request, "Сначала подтвердите прежнее назначение этой работы");
    const running = inFlight.get(intentKey);
    if (running) return running;
    const intent = saved ?? { request: Object.freeze({ ...payload(data), clientMutationId: requestId().toLowerCase(), expectedActorId: actor }), uncertain: false };
    Object.freeze(intent.request.dependencyIds);
    intents.set(intentKey, intent);
    const epoch = generation;
    const execution = (async (): Promise<TaskCreateAck | null> => {
      let result: TaskCreateAck;
      try {
        result = await send(intent.request);
        if (result.clientMutationId !== intent.request.clientMutationId || result.ok && !result.resultId)
          result = uncertain(intent.request, "Подтверждение не совпало с запросом. Проверьте назначение повтором.");
      } catch { result = uncertain(intent.request, "Ответ не получен. Проверьте результат тем же запросом."); }
      if (generation !== epoch || actorId !== actor) { intent.uncertain = true; return null; }
      if (result.ok) intents.delete(intentKey);
      else if (result.outcome === "UNKNOWN" || intent.uncertain || result.kind === "conflict") {
        intent.uncertain = true;
        // Даже подтверждённый отказ этой попытки не завершает прежний неизвестный запрос.
        result = { ...result, outcome: "UNKNOWN", retrySafe: true };
      } else intents.delete(intentKey);
      return result;
    })();
    inFlight.set(intentKey, execution);
    try { return await execution; }
    finally { if (inFlight.get(intentKey) === execution) inFlight.delete(intentKey); }
  }
  return { observeActor, peek, run };
}

let browserCommands: ReturnType<typeof createTaskCreationCommands> | undefined;
export function useTaskCreateCommand(actorUserId: string) {
  const router = useRouter();
  const [, redraw] = useState(0);
  const commands = typeof window === "undefined" ? createTaskCreationCommands(createTask)
    : browserCommands ??= createTaskCreationCommands(createTask);
  commands.observeActor(actorUserId);
  async function run(data: TaskCreatePayload) {
    const result = await commands.run(actorUserId, data);
    redraw(value => value + 1);
    if (result && !result.ok && result.kind === "actor-changed") router.refresh();
    return result;
  }
  return { run, peek: (scope: Scope) => commands.peek(actorUserId, scope) };
}
