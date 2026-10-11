"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createRequestId } from "@/lib/request-id";
import { changeTaskStatus } from "@/server/tasks/actions";
import type { TaskStatusAck, TaskStatusContext } from "@/server/tasks/status-receipts";

type Intent = { taskId: string; toStatus: "IN_PROGRESS" | "DONE"; actualMinutes?: number; context: TaskStatusContext };
type Sender = (taskId: string, status: Intent["toStatus"], minutes: number | undefined, context: TaskStatusContext) => Promise<TaskStatusAck>;

/** Один actor-scoped intent используется до подтверждения, включая React remount. */
export function createTaskStatusCommands(send: Sender, requestId: () => string = createRequestId) {
  let actorId = "", generation = 0;
  const intents = new Map<string, Intent>(), inFlight = new Map<string, Promise<TaskStatusAck | null>>();
  function observeActor(next: string) {
    if (next !== actorId) { actorId = next; generation += 1; intents.clear(); inFlight.clear(); }
  }
  async function run(expectedActorId: string, taskId: string, toStatus: Intent["toStatus"], actualMinutes?: number): Promise<TaskStatusAck | null> {
    if (!expectedActorId || actorId !== expectedActorId) return null;
    const saved = intents.get(taskId);
    if (saved && (saved.toStatus !== toStatus || saved.actualMinutes !== actualMinutes))
      return { ok: false, outcome: "UNKNOWN", retrySafe: true, error: "Сначала подтвердите прежнее изменение этой задачи" };
    const running = inFlight.get(taskId);
    if (running) return running;
    const intent = saved ?? Object.freeze({ taskId, toStatus, actualMinutes,
      context: Object.freeze({ clientMutationId: requestId().toLowerCase(), expectedActorId }) });
    intents.set(taskId, intent);
    const epoch = generation;
    const execution = (async (): Promise<TaskStatusAck | null> => {
      let result: TaskStatusAck;
      try {
        result = await send(intent.taskId, intent.toStatus, intent.actualMinutes, intent.context);
        if (result.ok && (result.resultId !== intent.taskId || result.clientMutationId !== intent.context.clientMutationId))
          result = { ok: false, outcome: "UNKNOWN", retrySafe: true, error: "Подтверждение изменения не совпало с запросом. Проверьте результат повтором." };
      } catch {
        result = { ok: false, outcome: "UNKNOWN", retrySafe: true, error: "Ответ не получен. Проверьте результат повтором того же запроса." };
      }
      if (generation !== epoch || actorId !== expectedActorId) return null;
      if (!result.ok && result.kind === "actor-changed") { observeActor(""); return result; }
      if (result.ok || result.outcome !== "UNKNOWN") intents.delete(taskId);
      return result;
    })();
    inFlight.set(taskId, execution);
    try { return await execution; }
    finally { if (inFlight.get(taskId) === execution) inFlight.delete(taskId); }
  }
  return { observeActor, run, peek: (taskId: string) => intents.get(taskId) };
}

let browserCommands: ReturnType<typeof createTaskStatusCommands> | undefined;
export function useTaskStatusCommand(actorUserId: string) {
  const router = useRouter();
  // SSR не хранит mutable identity между пользователями. Общая map живёт только в браузере.
  const commands = typeof window === "undefined" ? createTaskStatusCommands(changeTaskStatus)
    : browserCommands ??= createTaskStatusCommands(changeTaskStatus);
  commands.observeActor(actorUserId);
  async function run(taskId: string, toStatus: Intent["toStatus"], actualMinutes?: number): Promise<TaskStatusAck | null> {
    const result = await commands.run(actorUserId, taskId, toStatus, actualMinutes);
    if (!result) return null;
    if (!result.ok && result.kind === "actor-changed") { router.refresh(); return null; }
    if (!result.ok && result.outcome === "UNKNOWN") {
      const saved = commands.peek(taskId);
      toast.error(result.error, { id: "task-status-unknown:" + taskId, duration: Infinity,
        ...(saved ? { action: { label: "Проверить", onClick: () => {
          void run(saved.taskId, saved.toStatus, saved.actualMinutes).then(confirmed => {
            if (!confirmed || confirmed.ok && confirmed.replayed) return;
            toast.dismiss("task-status-unknown:" + taskId);
            if (confirmed.ok) { toast.success("Сохранение подтверждено"); router.refresh(); }
            else toast.error(confirmed.error);
          });
        } } } : {}) });
      router.refresh();
      return null;
    }
    if (result.ok && result.replayed) {
      toast.dismiss("task-status-unknown:" + taskId);
      toast.success("Результат операции подтверждён");
      router.refresh();
    }
    return result;
  }
  return Object.assign(run, { peek: commands.peek });
}
