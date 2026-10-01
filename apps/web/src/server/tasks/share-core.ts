import type { DomainActor } from "@/server/projects/core";
import { z } from "zod";
import { FULL_SHARE_UNITS, moneyAtoms, quantityAtoms, splitAllocation, taskPieceAmount } from "@/lib/work-shares";
import { splitStageShareVectors } from "@/lib/product-stage-pay";
import { resolveVisibilityActor, taskExecutionWhere } from "@/server/access/visibility";
import { bumpEngineeringPoolRevision } from "@/server/product-stage-pay/core";
import { engineeringRecipientError, taskRecipientError } from "./share-policy";
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

function isRetiredEngineeringWork(work: { paymentKind?: string } | null | undefined): boolean {
  return work?.paymentKind === "ENGINEERING";
}

export async function splitTaskCore(actor: DomainActor, input: SplitTaskInput, transaction: TaskTransaction): Promise<SplitTaskResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Проверьте сотрудника, процент и ревизию задачи" };
  let percent: string;
  try { percent = splitAllocation(FULL_SHARE_UNITS, "0", parsed.data.percent).percent; }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Некорректный процент" }; }
  const data = parsed.data;

  return transaction(async (tx): Promise<SplitTaskResult> => {
    const visibilityActor = await resolveVisibilityActor(tx, actor);
    const task = await tx.task.findFirst({
      where: { AND: [{ id: data.taskId }, taskExecutionWhere(visibilityActor)] },
      include: {
        project: { select: { number: true } },
        product: { select: { engineerId: true, status: true, projectId: true } },
        work: { select: {
          id: true, projectId: true, productId: true, priceSnapshot: true, paymentKind: true, stagePayPoolId: true,
          stagePayPool: { select: { id: true, kind: true, state: true, productId: true, product: { select: { projectId: true } } } },
        } },
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
    // Старые инженерные денежные векторы сохранены только для просмотра.
    // UUID уже завершённого деления выше допускает только replay без записи.
    if (isRetiredEngineeringWork(task.work))
      return { ok: false, error: "Инженерный фонд закрыт для новых делений; используйте прямые доли изделия" };
    if (!task.assigneeId || task.status === "DRAFT") return { ok: false, error: "Сначала назначьте исполнителя задачи" };
    if (task.status === "DONE") return { ok: false, error: "Выполненную задачу разделить нельзя" };
    if (task._count.payrollEntries > 0) return { ok: false, error: "По задаче уже есть начисление — деление запрещено" };
    if (task.splitRevision !== data.expectedRevision) return { ok: false, error: "Задача изменилась. Обновите карточку и повторите разделение" };
    if (task.assigneeId === data.recipientId) return { ok: false, error: "Выберите другого сотрудника" };
    const engineeringWork = task.work?.paymentKind === "ENGINEERING" ? task.work : null;
    const engineering = engineeringWork !== null;
    const installation = task.work?.paymentKind === "INSTALLATION";
    if (engineeringWork) {
      const pool = engineeringWork.stagePayPool;
      if (!task.productId || !task.product || task.product.status !== "DESIGN" || task.product.projectId !== task.projectId ||
        engineeringWork.projectId !== task.projectId || engineeringWork.productId !== task.productId || !pool ||
        engineeringWork.stagePayPoolId !== pool.id || pool.kind !== "ENGINEERING" || pool.state !== "DRAFT" ||
        pool.productId !== task.productId || pool.product.projectId !== task.projectId) {
        return { ok: false, error: "Инженерная работа и незакрытый фонд должны относиться к изделию на проектировании" };
      }
      if (task.stageShareUnits === null || task.stageShareUnits === undefined) {
        return { ok: false, error: "Для задачи не задана финансовая доля инженерного фонда" };
      }
      const stageTasks = await tx.task.findMany({ where: { workId: task.workId }, select: { stageShareUnits: true, projectId: true, productId: true } });
      if (stageTasks.some((part) => part.projectId !== task.projectId || part.productId !== task.productId ||
        part.stageShareUnits === null || !Number.isSafeInteger(part.stageShareUnits) || part.stageShareUnits < 0 || part.stageShareUnits > FULL_SHARE_UNITS) ||
        stageTasks.reduce((sum, part) => sum + (part.stageShareUnits ?? 0), 0) !== FULL_SHARE_UNITS) {
        return { ok: false, error: "Финансовые доли инженерной работы должны составлять ровно 100 процентов" };
      }
    }
    const recipient = await tx.user.findUnique({ where: { id: data.recipientId }, select: { id: true, roles: true, active: true } });
    if (!recipient) return { ok: false, error: "Сотрудник не найден" };
    const recipientError = engineering
      ? engineeringRecipientError(recipient, task.product)
      : taskRecipientError(recipient, task.product);
    if (recipientError) return { ok: false, error: recipientError };
    if (task.work && (task.work.projectId !== task.projectId || task.work.productId !== task.productId)) return { ok: false, error: "Работа и задача относятся к разным проектам или изделиям" };
    if (task.work && (!task.quantity || quantityAtoms(task.quantity) <= BigInt(0))) return { ok: false, error: "Менеджер должен сначала указать количество задачи" };

    const group = task.allocationGroup;
    if (installation && (group ? group.budgetSource !== "PHYSICAL_ONLY" : task.shareAmount != null))
      return { ok: false, error: "Старое денежное распределение сохранено; новое физическое деление здесь недоступно. Доли этапа настраиваются в карточке изделия" };
    if (group) {
      const parts = await tx.task.findMany({ where: { allocationGroupId: group.id }, select: { shareUnits: true, shareAmount: true, quantity: true, workId: true } });
      const validPhysical = group.workId === task.workId &&
        parts.every((part) => part.shareUnits !== null && part.workId === group.workId && quantityAtoms(part.quantity ?? 0) === quantityAtoms(group.quantity ?? 0)) &&
        parts.reduce((sum, part) => sum + (part.shareUnits ?? 0), 0) === FULL_SHARE_UNITS;
      const validMoney = !engineering && !installation && group.budget !== null && parts.every((part) => part.shareAmount !== null) &&
        parts.reduce((sum, part) => sum + moneyAtoms(part.shareAmount ?? 0), BigInt(0)) === moneyAtoms(group.budget);
      const valid = validPhysical && (engineering || installation && group.budget === null && parts.every((part) => part.shareAmount === null) || validMoney);
      if (!valid) return { ok: false, error: "Распределение общей работы не согласовано — обратитесь к администратору" };
    }
    const legacySnapshot = task.work?.priceSnapshot;
    if (!engineering && !installation && !group && task.work && legacySnapshot === null) return { ok: false, error: "У работы отсутствует снимок цены" };
    const budget = engineering || installation ? null : group ? String(task.shareAmount) : task.work ? taskPieceAmount(task, legacySnapshot!) : "0.00";
    if (!engineering && !installation && budget !== null && moneyAtoms(budget) > BigInt("999999999999")) return { ok: false, error: "Бюджет превышает допустимую сумму" };
    let allocation: ReturnType<typeof splitAllocation>;
    let stageAllocation: ReturnType<typeof splitStageShareVectors> | null = null;
    try {
      allocation = splitAllocation(group ? task.shareUnits! : FULL_SHARE_UNITS, engineering || installation ? "0.00" : budget!, percent);
      if (engineering) stageAllocation = splitStageShareVectors({
        quantityShareUnits: BigInt(group ? task.shareUnits! : FULL_SHARE_UNITS),
        stageShareUnits: BigInt(task.stageShareUnits!), percent,
      });
    }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Некорректная доля" }; }
    const currency = engineering || installation ? null : group ? group.currency : task.work ? (await tx.orgSetting.findUnique({ where: { key: "payrollCurrency" } }))?.value ?? "BYN" : null;
    const allocationGroup = group ?? await tx.taskAllocationGroup.create({ data: {
      workId: task.workId, quantity: task.work ? task.quantity : null,
      ...(engineering ? { budget: null, budgetSource: "STAGE_PREVIEW" }
        : installation ? { budget: null, budgetSource: "PHYSICAL_ONLY" } : { budget, budgetSource: "TASK_FIXED" }),
      currency, createdById: actor.id,
    } });
    const transferredEstimate = task.estimateMinutes === null ? null : Math.max(1, Math.floor(task.estimateMinutes * Number(percent) / 100));
    const remainingEstimate = task.estimateMinutes === null ? null : Math.max(1, task.estimateMinutes - (transferredEstimate ?? 0));
    const [predecessors, dependents] = await Promise.all([
      tx.taskDependency.findMany({ where: { taskId: task.id }, select: { dependsOnId: true } }),
      tx.taskDependency.findMany({ where: { dependsOnId: task.id }, select: { taskId: true } }),
    ]);
    await tx.task.update({ where: { id: task.id }, data: {
      allocationGroupId: allocationGroup.id, shareUnits: allocation.remainingUnits,
      ...(engineering ? { stageShareUnits: Number(stageAllocation!.remainingStageShareUnits) }
        : installation ? { shareAmount: null, physicalOnlyShare: true } : { shareAmount: allocation.remainingAmount }),
      quantity: task.work ? task.quantity : null, estimateMinutes: remainingEstimate, splitRevision: { increment: 1 },
    } });
    const child = await tx.task.create({ data: {
      projectId: task.projectId, productId: task.productId, workId: task.workId,
      title: task.title, type: task.type, assigneeId: recipient.id, quantity: task.work ? task.quantity : null,
      executorShare: task.executorShare, dueAt: task.dueAt, requiresPhoto: task.requiresPhoto,
      estimateMinutes: transferredEstimate, status: "NEW", createdById: actor.id,
      allocationGroupId: allocationGroup.id, shareUnits: allocation.transferredUnits,
      ...(engineering ? { stageShareUnits: Number(stageAllocation!.transferredStageShareUnits), shareAmount: null }
        : installation ? { shareAmount: null, physicalOnlyShare: true } : { shareAmount: allocation.transferredAmount }),
    } });
    await tx.taskDependency.createMany({ data: [
      ...predecessors.map((edge) => ({ taskId: child.id, dependsOnId: edge.dependsOnId })),
      ...dependents.map((edge) => ({ taskId: edge.taskId, dependsOnId: child.id })),
    ], skipDuplicates: true });
    if (engineeringWork) await bumpEngineeringPoolRevision(tx, engineeringWork.stagePayPoolId!);
    await tx.changeLog.create({ data: {
      id: receiptId, actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source,
      entity: "task", entityId: task.id, action: "split",
      oldValue: engineering
        ? { quantityShareUnits: group ? task.shareUnits : FULL_SHARE_UNITS, stageShareUnits: task.stageShareUnits, splitRevision: task.splitRevision }
        : installation ? { quantityShareUnits: group ? task.shareUnits : FULL_SHARE_UNITS, splitRevision: task.splitRevision }
        : { shareUnits: group ? task.shareUnits : FULL_SHARE_UNITS, amount: budget, splitRevision: task.splitRevision },
      newValue: engineering
        ? { childTaskId: child.id, groupId: allocationGroup.id, recipientId: recipient.id, percent, expectedRevision: data.expectedRevision,
          remainingQuantityShareUnits: allocation.remainingUnits, transferredQuantityShareUnits: allocation.transferredUnits,
          remainingStageShareUnits: Number(stageAllocation!.remainingStageShareUnits), transferredStageShareUnits: Number(stageAllocation!.transferredStageShareUnits) }
        : installation ? { childTaskId: child.id, groupId: allocationGroup.id, recipientId: recipient.id, percent,
          expectedRevision: data.expectedRevision, remainingQuantityShareUnits: allocation.remainingUnits,
          transferredQuantityShareUnits: allocation.transferredUnits, paymentKind: "INSTALLATION" }
        : { childTaskId: child.id, groupId: allocationGroup.id, recipientId: recipient.id, percent,
          expectedRevision: data.expectedRevision, remainingUnits: allocation.remainingUnits, transferredUnits: allocation.transferredUnits,
          remainingAmount: allocation.remainingAmount, transferredAmount: allocation.transferredAmount },
    } });
    const event = await tx.domainEvent.create({ data: { type: "task.split", actor: actor.id, payload: { taskId: task.id, childTaskId: child.id, groupId: allocationGroup.id, recipientId: recipient.id } } });
    return { ok: true, childTaskId: child.id, groupId: allocationGroup.id, repeated: false, eventId: event.id, ...context };
  });
}
