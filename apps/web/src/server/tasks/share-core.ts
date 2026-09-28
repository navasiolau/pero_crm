import type { DomainActor } from "@/server/projects/core";
import { z } from "zod";
import { FULL_SHARE_UNITS, moneyAtoms, quantityAtoms, splitAllocation, taskPieceAmount } from "@/lib/work-shares";
import { taskExecutionWhere } from "@/server/access/visibility";
import { taskRecipientError } from "./share-policy";
import type { TaskTransaction } from "./transaction";

export type SplitTaskInput = { taskId: string; recipientId: string; percent: string; expectedRevision: number; requestId: string };
export type SplitTaskResult = { ok: false; error: string } | {
  ok: true; childTaskId: string; groupId: string; repeated: boolean;
  projectId: string; productId: string | null; projectNumber: string; title: string; recipientId: string; eventId: string | null;
};

const schema = z.object({
  taskId: z.string().min(1), recipientId: z.string().min(1), percent: z.string().min(1).max(8),
  expectedRevision: z.number().int().nonnegative(), requestId: z.uuid(),
});

export async function splitTaskCore(actor: DomainActor, input: SplitTaskInput, transaction: TaskTransaction): Promise<SplitTaskResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Проверьте сотрудника, процент и ревизию задачи" };
  let percent: string;
  try { percent = splitAllocation(FULL_SHARE_UNITS, "0", parsed.data.percent).percent; }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Некорректный процент" }; }
  const data = parsed.data;

  return transaction(async (tx): Promise<SplitTaskResult> => {
    const task = await tx.task.findFirst({
      where: { AND: [{ id: data.taskId }, taskExecutionWhere(actor)] },
      include: {
        project: { select: { number: true } },
        product: { select: { engineerId: true, status: true } },
        work: { select: { id: true, projectId: true, productId: true, priceSnapshot: true } },
        allocationGroup: true,
        _count: { select: { payrollEntries: true } },
      },
    });
    if (!task) return { ok: false, error: "Задача не найдена или недоступна" };
    const context = { projectId: task.projectId, productId: task.productId, projectNumber: task.project.number, title: task.title, recipientId: data.recipientId };
    const receiptId = `task-split:${data.requestId}`;
    const receipt = await tx.changeLog.findUnique({ where: { id: receiptId } });
    if (receipt) {
      const saved = receipt.newValue;
      if (receipt.actorId !== actor.id || receipt.entityId !== task.id || receipt.action !== "split" || !saved || typeof saved !== "object" || Array.isArray(saved) ||
        saved.recipientId !== data.recipientId || saved.percent !== percent || saved.expectedRevision !== data.expectedRevision || typeof saved.childTaskId !== "string" || typeof saved.groupId !== "string") {
        return { ok: false, error: "Этот запрос уже использован для другого разделения" };
      }
      return { ok: true, childTaskId: saved.childTaskId, groupId: saved.groupId, repeated: true, eventId: null, ...context };
    }
    if (!task.assigneeId || task.status === "DRAFT") return { ok: false, error: "Сначала назначьте исполнителя задачи" };
    if (task.status === "DONE") return { ok: false, error: "Выполненную задачу разделить нельзя" };
    if (task._count.payrollEntries > 0) return { ok: false, error: "По задаче уже есть начисление — деление запрещено" };
    if (task.splitRevision !== data.expectedRevision) return { ok: false, error: "Задача изменилась. Обновите карточку и повторите разделение" };
    if (task.assigneeId === data.recipientId) return { ok: false, error: "Выберите другого сотрудника" };
    const recipient = await tx.user.findUnique({ where: { id: data.recipientId }, select: { id: true, roles: true, active: true } });
    if (!recipient) return { ok: false, error: "Сотрудник не найден" };
    const recipientError = taskRecipientError(recipient, task.product);
    if (recipientError) return { ok: false, error: recipientError };
    if (task.work && (task.work.projectId !== task.projectId || task.work.productId !== task.productId)) return { ok: false, error: "Работа и задача относятся к разным проектам или изделиям" };
    if (task.work && (!task.quantity || quantityAtoms(task.quantity) <= BigInt(0))) return { ok: false, error: "Менеджер должен сначала указать количество задачи" };

    const group = task.allocationGroup;
    if (group) {
      const parts = await tx.task.findMany({ where: { allocationGroupId: group.id }, select: { shareUnits: true, shareAmount: true, quantity: true, workId: true } });
      const valid = parts.every((part) => part.shareUnits !== null && part.shareAmount !== null && part.workId === group.workId && quantityAtoms(part.quantity ?? 0) === quantityAtoms(group.quantity ?? 0)) &&
        parts.reduce((sum, part) => sum + (part.shareUnits ?? 0), 0) === FULL_SHARE_UNITS &&
        parts.reduce((sum, part) => sum + moneyAtoms(part.shareAmount ?? 0), BigInt(0)) === moneyAtoms(group.budget);
      if (!valid) return { ok: false, error: "Распределение общей работы не согласовано — обратитесь к администратору" };
    }
    const budget = group ? String(task.shareAmount) : task.work ? taskPieceAmount(task, task.work.priceSnapshot) : "0.00";
    if (moneyAtoms(budget) > BigInt("999999999999")) return { ok: false, error: "Бюджет превышает допустимую сумму" };
    let allocation: ReturnType<typeof splitAllocation>;
    try { allocation = splitAllocation(group ? task.shareUnits! : FULL_SHARE_UNITS, budget, percent); }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Некорректная доля" }; }
    const currency = group ? group.currency : task.work ? (await tx.orgSetting.findUnique({ where: { key: "payrollCurrency" } }))?.value ?? "BYN" : null;
    const allocationGroup = group ?? await tx.taskAllocationGroup.create({ data: {
      workId: task.workId, quantity: task.work ? task.quantity : null, budget, currency, createdById: actor.id,
    } });
    const transferredEstimate = task.estimateMinutes === null ? null : Math.max(1, Math.floor(task.estimateMinutes * Number(percent) / 100));
    const remainingEstimate = task.estimateMinutes === null ? null : Math.max(1, task.estimateMinutes - (transferredEstimate ?? 0));
    const [predecessors, dependents] = await Promise.all([
      tx.taskDependency.findMany({ where: { taskId: task.id }, select: { dependsOnId: true } }),
      tx.taskDependency.findMany({ where: { dependsOnId: task.id }, select: { taskId: true } }),
    ]);
    await tx.task.update({ where: { id: task.id }, data: {
      allocationGroupId: allocationGroup.id, shareUnits: allocation.remainingUnits, shareAmount: allocation.remainingAmount,
      quantity: task.work ? task.quantity : null, estimateMinutes: remainingEstimate, splitRevision: { increment: 1 },
    } });
    const child = await tx.task.create({ data: {
      projectId: task.projectId, productId: task.productId, workId: task.workId,
      title: task.title, type: task.type, assigneeId: recipient.id, quantity: task.work ? task.quantity : null,
      executorShare: task.executorShare, dueAt: task.dueAt, requiresPhoto: task.requiresPhoto,
      estimateMinutes: transferredEstimate, status: "NEW", createdById: actor.id,
      allocationGroupId: allocationGroup.id, shareUnits: allocation.transferredUnits, shareAmount: allocation.transferredAmount,
    } });
    await tx.taskDependency.createMany({ data: [
      ...predecessors.map((edge) => ({ taskId: child.id, dependsOnId: edge.dependsOnId })),
      ...dependents.map((edge) => ({ taskId: edge.taskId, dependsOnId: child.id })),
    ], skipDuplicates: true });
    await tx.changeLog.create({ data: {
      id: receiptId, actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source,
      entity: "task", entityId: task.id, action: "split",
      oldValue: { shareUnits: group ? task.shareUnits : FULL_SHARE_UNITS, amount: budget, splitRevision: task.splitRevision },
      newValue: { childTaskId: child.id, groupId: allocationGroup.id, recipientId: recipient.id, percent,
        expectedRevision: data.expectedRevision, remainingUnits: allocation.remainingUnits, transferredUnits: allocation.transferredUnits,
        remainingAmount: allocation.remainingAmount, transferredAmount: allocation.transferredAmount },
    } });
    const event = await tx.domainEvent.create({ data: { type: "task.split", actor: actor.id, payload: { taskId: task.id, childTaskId: child.id, groupId: allocationGroup.id, recipientId: recipient.id } } });
    return { ok: true, childTaskId: child.id, groupId: allocationGroup.id, repeated: false, eventId: event.id, ...context };
  });
}
