import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { DomainActor } from "@/server/actor";
import { quantityAtoms } from "@/lib/work-shares";

export type TaskCreatePayload = {
  projectId: string; productId?: string; workId?: string; assigneeId?: string;
  title: string; type: string; quantity?: number; dueAt: string; estimateMinutes?: number;
  requiresPhoto?: boolean; dependencyIds?: string[];
};
export type TaskCreateRequest = TaskCreatePayload & { clientMutationId: string; expectedActorId: string };
export type TaskCreateAck = { ok: true; outcome: "COMMITTED"; resultId: string; clientMutationId: string; replayed?: boolean } | {
  ok: false; outcome: "ROLLED_BACK" | "UNKNOWN"; error: string; retrySafe: boolean;
  kind: "invalid-request" | "actor-changed" | "forbidden" | "conflict" | "rejected" | "unavailable";
  clientMutationId?: string; intentResolution: "attempt-only" | "verified-absent";
};
export class TaskCreateRequestError extends Error {
  constructor(message: string, readonly kind: "actor-changed" | "forbidden" | "conflict") { super(message); }
}
export const taskCreateReceiptId = (id: string) => "task-create:" + id.toLowerCase();
export function taskCreateFingerprint(actorId: string, data: TaskCreatePayload): string {
  return createHash("sha256").update(JSON.stringify({ command: "task.create", actorId,
    projectId: data.projectId, productId: data.productId ?? null, workId: data.workId ?? null,
    assigneeId: data.assigneeId ?? null, title: data.title, type: data.type,
    quantityAtoms: data.quantity === undefined ? null : quantityAtoms(data.quantity).toString(),
    dueAt: new Date(data.dueAt).toISOString(), estimateMinutes: data.estimateMinutes ?? null,
    requiresPhoto: data.requiresPhoto ?? false, dependencyIds: [...new Set(data.dependencyIds ?? [])].sort(),
  })).digest("hex");
}
const receiptSchema = z.object({ clientMutationId: z.uuid(), resultId: z.string().min(1).max(160),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export async function readTaskCreateReceipt(actor: DomainActor, data: TaskCreateRequest,
  db: Pick<Prisma.TransactionClient, "changeLog">): Promise<Extract<TaskCreateAck, { ok: true }> | null> {
  const receipt = await db.changeLog.findUnique({ where: { id: taskCreateReceiptId(data.clientMutationId) } });
  if (!receipt) return null;
  const parsed = receiptSchema.safeParse(receipt.newValue);
  if (receipt.id !== taskCreateReceiptId(data.clientMutationId) || receipt.actorType !== "user" || receipt.actorId !== actor.id ||
    receipt.entity !== "task" || receipt.action !== "task.create.request" || !parsed.success ||
    parsed.data.clientMutationId !== data.clientMutationId || parsed.data.resultId !== receipt.entityId ||
    parsed.data.fingerprint !== taskCreateFingerprint(actor.id, data))
    throw new TaskCreateRequestError("Идентификатор уже использован для другого назначения", "conflict");
  return { ok: true, outcome: "COMMITTED", resultId: parsed.data.resultId, clientMutationId: data.clientMutationId, replayed: true };
}
export async function recordTaskCreateReceipt(actor: DomainActor, data: TaskCreateRequest, resultId: string,
  tx: Prisma.TransactionClient): Promise<void> {
  await tx.changeLog.create({ data: { id: taskCreateReceiptId(data.clientMutationId), actorType: "user", actorId: actor.id,
    actorName: actor.name, source: actor.source, entity: "task", entityId: resultId, action: "task.create.request",
    newValue: { clientMutationId: data.clientMutationId, resultId, fingerprint: taskCreateFingerprint(actor.id, data) } } });
}
