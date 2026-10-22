import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { productVisibilityWhere, resolveVisibilityActor } from "@/server/access/visibility";
import { liveChildWhere, liveProductWhere } from "@/server/access/live-entities";
import { lockProjectRow } from "@/server/projects/lock";
import { lockProductRow } from "@/server/products/quantity-core";
import type { DomainActor } from "@/server/actor";
import { pieceworkRecipientError } from "./piecework-policy";
import { canManageTaskReassignment, ordinaryTaskReassignmentError } from "./task-reassignment-policy";
import { withTaskTransaction, type TaskTransaction } from "./transaction";

export const taskReassignmentSchema = z.object({ taskId: z.string().min(1).max(160), assigneeId: z.string().min(1).max(160),
  expectedRevision: z.number().int().nonnegative(), clientMutationId: z.uuid() }).strict();
export type TaskReassignmentInput = z.infer<typeof taskReassignmentSchema>;
const receiptSchema = z.object({ version: z.literal(1), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), result: z.object({
  ok: z.literal(true), taskId: z.string(), assigneeId: z.string(), revision: z.number().int(), status: z.literal("NEW"),
  projectId: z.string(), productId: z.string(), title: z.string(), projectNumber: z.string(), eventId: z.string().nullable(), clientMutationId: z.uuid(),
}).strict() }).strict();
export type TaskReassignmentSuccess = z.infer<typeof receiptSchema>["result"] & { repeated?: boolean };
export type TaskReassignmentResult = TaskReassignmentSuccess | { ok: false; kind: "validation" | "forbidden" | "conflict" | "failure"; error: string };
class ReassignmentError extends Error { constructor(message: string, readonly kind: Extract<TaskReassignmentResult, { ok: false }>["kind"] = "validation") { super(message); } }
function fail(message: string, kind?: ReassignmentError["kind"]): never { throw new ReassignmentError(message, kind); }

async function context(tx: Prisma.TransactionClient, actorId: string, taskId: string) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actorId} FOR SHARE`;
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { id: true, name: true, active: true, roles: true } });
  if (!actor?.active || !canManageTaskReassignment(actor.roles)) fail("Недостаточно прав для переназначения", "forbidden");
  const reference = await tx.task.findUnique({ where: { id: taskId }, select: { projectId: true, productId: true, workId: true } });
  if (!reference?.productId || !reference.workId) fail("Задача не найдена или недоступна", "forbidden");
  await lockProjectRow(tx, reference.projectId); await lockProductRow(tx, reference.productId);
  await tx.$queryRaw`SELECT id FROM "Work" WHERE id=${reference.workId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Task" WHERE id=${taskId} FOR UPDATE`;
  const visibility = await resolveVisibilityActor(tx, actor);
  const product = await tx.product.findFirst({ where: { ...liveProductWhere, id: reference.productId, projectId: reference.projectId, AND: [productVisibilityWhere(visibility)] },
    select: { id: true, projectId: true, engineerId: true, status: true } });
  if (!product) fail("Задача не найдена или недоступна", "forbidden");
  const task = await tx.task.findFirst({ where: { ...liveChildWhere, id: taskId, productId: product.id, projectId: product.projectId, workId: reference.workId },
    include: { project: { select: { id: true, number: true } }, product: { select: { id: true, engineerId: true, status: true } },
      work: { include: { _count: { select: { paymentConversions: true, settlementShares: true } } } },
      allocationGroup: { select: { id: true, workId: true, budgetSource: true } }, _count: { select: { payrollEntries: true, stageSettlementShares: true } } } });
  if (!task || !task.work || task.work.projectId !== product.projectId || task.work.productId !== product.id)
    fail("Задача не найдена или недоступна", "forbidden");
  return { actor, task, product };
}

export type TaskReassignmentOptions = { ok: true; taskId: string; title: string; assigneeId: string | null; expectedRevision: number; recipients: { value: string; label: string }[] } |
  { ok: false; error: string };
export async function listTaskReassignmentOptions(actor: DomainActor, taskId: string, transaction: TaskTransaction = withTaskTransaction): Promise<TaskReassignmentOptions> {
  try { return await transaction(async tx => {
    const current = await context(tx, actor.id, taskId);
    const error = ordinaryTaskReassignmentError(current.task); if (error) fail(error);
    const recipients = await tx.user.findMany({ where: { active: true, payScheme: "PIECE" }, select: { id: true, name: true, active: true, roles: true, payScheme: true }, orderBy: { name: "asc" } });
    return { ok: true as const, taskId: current.task.id, title: current.task.title, assigneeId: current.task.assigneeId, expectedRevision: current.task.splitRevision,
      recipients: recipients.filter(user => !pieceworkRecipientError(user, current.product)).map(user => ({ value: user.id, label: user.name })) };
  }); } catch (error) { return { ok: false, error: error instanceof ReassignmentError ? error.message : "Не удалось открыть переназначение" }; }
}

export async function reassignOrdinaryTaskCore(actor: DomainActor, input: unknown, transaction: TaskTransaction = withTaskTransaction): Promise<TaskReassignmentResult> {
  const parsed = taskReassignmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, kind: "validation", error: "Проверьте исполнителя, ревизию и идентификатор операции" };
  const data = parsed.data;
  const fingerprint = createHash("sha256").update(JSON.stringify({ version: 1, actorId: actor.id, source: actor.source, data })).digest("hex");
  try { return await transaction(async tx => {
    const current = await context(tx, actor.id, data.taskId), { task, product } = current;
    const receiptId = `task-reassignment-v1:${data.clientMutationId}`;
    const previous = await tx.changeLog.findUnique({ where: { id: receiptId } });
    if (previous) {
      const saved = receiptSchema.safeParse(previous.newValue);
      if (previous.actorId !== current.actor.id || previous.entity !== "task" || previous.entityId !== task.id || previous.source !== actor.source || previous.action !== "task.reassignment.receipt.v1" || !saved.success || saved.data.fingerprint !== fingerprint ||
        saved.data.result.taskId !== data.taskId || saved.data.result.assigneeId !== data.assigneeId || saved.data.result.clientMutationId !== data.clientMutationId)
        fail("Идентификатор операции уже использован");
      return { ...saved.data.result, repeated: true };
    }
    const error = ordinaryTaskReassignmentError(task); if (error) fail(error);
    if (task.splitRevision !== data.expectedRevision) fail("Задача изменена. Закройте окно и откройте переназначение заново", "conflict");
    if (task.assigneeId === data.assigneeId) fail("Выберите другого исполнителя");
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${data.assigneeId} FOR SHARE`;
    const recipient = await tx.user.findUnique({ where: { id: data.assigneeId }, select: { id: true, name: true, active: true, roles: true, payScheme: true } });
    const recipientError = recipient ? pieceworkRecipientError(recipient, product) : "Сотрудник недоступен";
    if (recipientError) fail(recipientError);
    const changed = task.assigneeId !== data.assigneeId;
    let eventId: string | null = null, revision = task.splitRevision;
    if (changed) {
      const updated = await tx.task.updateMany({ where: { id: task.id, splitRevision: data.expectedRevision, status: { not: "DONE" } },
        data: { assigneeId: data.assigneeId, status: "NEW", splitRevision: { increment: 1 } } });
      if (updated.count !== 1) fail("Задача изменена другим пользователем", "conflict");
      revision++;
      await tx.changeLog.create({ data: { actorType: "user", actorId: current.actor.id, actorName: current.actor.name, source: actor.source, entity: "task", entityId: task.id, action: "reassign",
        oldValue: { assigneeId: task.assigneeId, status: task.status, splitRevision: task.splitRevision }, newValue: { assigneeId: data.assigneeId, status: "NEW", splitRevision: revision } } });
      const event = await tx.domainEvent.create({ data: { type: "task.assigned", actor: current.actor.id, payload: { taskId: task.id, projectId: task.projectId, productId: product.id,
        assigneeId: data.assigneeId, previousAssigneeId: task.assigneeId, operationId: data.clientMutationId } } }); eventId = event.id;
    }
    const result: z.infer<typeof receiptSchema>["result"] = { ok: true, taskId: task.id, assigneeId: data.assigneeId, revision, status: "NEW", projectId: task.projectId,
      productId: product.id, title: task.title, projectNumber: task.project.number, eventId, clientMutationId: data.clientMutationId };
    await tx.changeLog.create({ data: { id: receiptId, actorType: "user", actorId: current.actor.id, actorName: current.actor.name, source: actor.source, entity: "task", entityId: task.id,
      action: "task.reassignment.receipt.v1", newValue: { version: 1, fingerprint, result } } });
    return result;
  }); } catch (error) { return error instanceof ReassignmentError ? { ok: false, kind: error.kind, error: error.message } : { ok: false, kind: "failure", error: "Ответ не подтверждён. Повторите тот же запрос для проверки результата" }; }
}
