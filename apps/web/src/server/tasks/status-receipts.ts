import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { DomainActor } from "@/server/actor";

export type TaskStatusContext = { clientMutationId: string; expectedActorId: string };
export type TaskStatusAck = { ok: true; outcome: "COMMITTED"; resultId: string; replayed?: boolean; clientMutationId?: string } | {
  ok: false; error: string; timeRequired?: boolean; outcome?: "ROLLED_BACK" | "UNKNOWN";
  kind?: "actor-changed"; retrySafe?: boolean; clientMutationId?: string;
};
export type TaskStatusEffect = { id: string; title: string; assigneeId: string | null; projectId: string; projectNumber: string; productId: string | null; productNumber: string | null };
type Intent = { taskId: string; toStatus: "IN_PROGRESS" | "DONE"; actualMinutes?: number; request: TaskStatusContext | undefined };
const requestSchema = z.object({ clientMutationId: z.uuid().transform(value => value.toLowerCase()), expectedActorId: z.string().min(1).max(160) }).strict();
const contextSchema = z.object({ id: z.string(), title: z.string(), assigneeId: z.string().nullable(), projectId: z.string(), projectNumber: z.string(), productId: z.string().nullable(), productNumber: z.string().nullable() }).strict();
const receiptSchema = z.object({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/), context: contextSchema,
  toStatus: z.enum(["IN_PROGRESS", "DONE"]), eventId: z.string().nullable() }).strict();
export class TaskStatusRequestError extends Error {
  constructor(message: string, readonly kind?: "actor-changed") { super(message); }
}
export function normalizeTaskStatusRequest(actorId: string, input: TaskStatusContext | undefined): TaskStatusContext | undefined {
  if (input === undefined) return undefined;
  const result = requestSchema.safeParse(input);
  if (!result.success) throw new TaskStatusRequestError("Проверьте идентификатор изменения статуса");
  if (result.data.expectedActorId !== actorId) throw new TaskStatusRequestError("Учётная запись изменилась — обновите страницу", "actor-changed");
  return result.data;
}
const receiptId = (id: string) => "task-status:" + id;
function fingerprint(actorId: string, intent: Intent): string {
  return createHash("sha256").update(JSON.stringify({ actorId, command: "task.status", taskId: intent.taskId,
    toStatus: intent.toStatus, actualMinutes: intent.actualMinutes ?? null })).digest("hex");
}
export async function readTaskStatusReceipt(actor: DomainActor, intent: Intent, db: Pick<Prisma.TransactionClient, "changeLog">) {
  if (!intent.request) return null;
  const receipt = await db.changeLog.findUnique({ where: { id: receiptId(intent.request.clientMutationId) } });
  if (!receipt) return null;
  const parsed = receiptSchema.safeParse(receipt.newValue);
  if (receipt.actorType !== "user" || receipt.actorId !== actor.id || receipt.entity !== "task" || receipt.entityId !== intent.taskId ||
    receipt.action !== "task.status.request" || !parsed.success || parsed.data.context.id !== intent.taskId ||
    parsed.data.toStatus !== intent.toStatus || parsed.data.fingerprint !== fingerprint(actor.id, intent))
    throw new TaskStatusRequestError("Идентификатор уже использован для другого изменения статуса");
  return parsed.data;
}
export async function recordTaskStatusReceipt(actor: DomainActor, intent: Intent, task: TaskStatusEffect,
  eventId: string | null, tx: Prisma.TransactionClient): Promise<void> {
  if (!intent.request) return;
  await tx.changeLog.create({ data: { id: receiptId(intent.request.clientMutationId), actorType: "user", actorId: actor.id,
    actorName: actor.name, source: actor.source, entity: "task", entityId: task.id, action: "task.status.request",
    newValue: { fingerprint: fingerprint(actor.id, intent), context: task, toStatus: intent.toStatus, eventId } } });
}
