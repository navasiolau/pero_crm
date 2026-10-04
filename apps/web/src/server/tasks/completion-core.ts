import {canAccrueOrdinarySalary,hasFrozenTaskPieceObligation} from "@/lib/compensation-policy";
import { assertInternalCurrency, assertProjectMoneyCurrency } from "@/lib/internal-currency";
import type { Prisma } from "@prisma/client";
import { fileVisibilityWhere, hasFullProjectVisibility, resolveVisibilityActor, taskExecutionWhere } from "@/server/access/visibility";
import { bumpEngineeringPoolRevision } from "@/server/product-stage-pay/core";
import { moneyAtoms, taskPieceAmount } from "@/lib/work-shares";
import { OFFICE_WRITE_ROLES, hasAnyRole } from "@/lib/roles";
import type { DomainActor } from "@/server/projects/core";
import type { TaskTransaction } from "./transaction";

type TaskEffect = { id: string; title: string; assigneeId: string | null; projectId: string; projectNumber: string; productId: string | null; productNumber: string | null };
export type CompletionResult = { ok: false; error: string; timeRequired?: boolean } | {
  ok: true; repeated: boolean; task: TaskEffect; eventId: string | null;
  payroll: { name: string; amount: string; currency: string } | null;
};

class CompletionError extends Error {
  constructor(message: string, readonly timeRequired = false) { super(message); }
}

async function startTimer(tx: Prisma.TransactionClient, taskId: string, userId: string) {
  if (await tx.timeEntry.findFirst({ where: { taskId, userId, stoppedAt: null }, select: { id: true } })) return;
  await tx.timeEntry.updateMany({ where: { userId, stoppedAt: null }, data: { stoppedAt: new Date() } });
  await tx.$executeRaw`
    UPDATE "TimeEntry" SET "minutes" = GREATEST(1, FLOOR(EXTRACT(EPOCH FROM ("stoppedAt" - "startedAt")) / 60)::int)
    WHERE "userId" = ${userId} AND "stoppedAt" IS NOT NULL AND "minutes" = 0
  `;
  await tx.timeEntry.create({ data: { taskId, userId, source: "timer" } });
}

export async function stopTaskTimers(tx: Prisma.TransactionClient, taskId: string) {
  await tx.timeEntry.updateMany({ where: { taskId, stoppedAt: null }, data: { stoppedAt: new Date() } });
  await tx.$executeRaw`
    UPDATE "TimeEntry" SET "minutes" = GREATEST(1, FLOOR(EXTRACT(EPOCH FROM ("stoppedAt" - "startedAt")) / 60)::int)
    WHERE "taskId" = ${taskId} AND "stoppedAt" IS NOT NULL AND "minutes" = 0
  `;
}

export async function changeTaskStatusCore(actor: DomainActor, taskId: string, toStatus: "IN_PROGRESS" | "DONE", actualMinutes: number | undefined, transaction: TaskTransaction): Promise<CompletionResult> {
  if (toStatus !== "IN_PROGRESS" && toStatus !== "DONE") return { ok: false, error: "Недопустимый переход статуса" };
  try {
    return await transaction(async (tx): Promise<CompletionResult> => {
      const visibilityActor = await resolveVisibilityActor(tx, actor);
      const task = await tx.task.findFirst({
        where: { AND: [{ id: taskId }, taskExecutionWhere(visibilityActor)] },
        include: {
          project: { select: { id: true, number: true, currency: true } }, product: { select: { id: true, number: true, projectId: true, status: true } },
          work: { select: { id: true, projectId: true, productId: true, priceSnapshot: true, paymentKind: true, stagePayPoolId: true, stagePayPool: { select: { productId: true } } } }, allocationGroup: { select: { id:true,workId:true,budgetSource:true,budget:true,currency: true } },
          files: { where: fileVisibilityWhere(visibilityActor), select: { id: true } },
          dependencies: { include: { dependsOn: { select: { id: true, title: true, status: true } } } },
        },
      });
      if (!task) throw new CompletionError("Задача не найдена");
      const effect: TaskEffect = { id: task.id, title: task.title, assigneeId: task.assigneeId, projectId: task.projectId, projectNumber: task.project.number, productId: task.productId, productNumber: task.product?.number ?? null };
      if (task.status === toStatus) return { ok: true, repeated: true, task: effect, payroll: null, eventId: null };
      if (task.work?.paymentKind === "ENGINEERING") {
        if (!task.productId || !task.product || task.product.projectId !== task.projectId ||
          task.work.projectId !== task.projectId || task.work.productId !== task.productId ||
          !task.work.stagePayPoolId || task.work.stagePayPool?.productId !== task.productId)
          throw new CompletionError("Инженерная задача, работа и фонд относятся к разным изделиям или проектам");
        try { await bumpEngineeringPoolRevision(tx, task.work.stagePayPoolId); }
        catch (error) {
          if (error instanceof Error && /Инженерный фонд|Изделие уже вышло/.test(error.message)) throw new CompletionError(error.message);
          throw error;
        }
      }
      if (task.status !== "NEW" && !(task.status === "IN_PROGRESS" && toStatus === "DONE")) throw new CompletionError("Недопустимый переход статуса");
      const blockers = task.dependencies.filter((edge) => edge.dependsOn.status !== "DONE");
      if (blockers.length) throw new CompletionError(hasFullProjectVisibility(actor)
        ? `Задача заблокирована — сначала выполните: ${blockers.map((edge) => `«${edge.dependsOn.title}»`).join(", ")}`
        : "Задача заблокирована — сначала должны быть выполнены предыдущие задачи");
      if (toStatus === "DONE" && task.requiresPhoto && !task.files.length) throw new CompletionError("Приложите файлы (фото/замерный лист) перед выполнением");
      if (toStatus === "IN_PROGRESS" && task.assigneeId) await startTimer(tx, task.id, task.assigneeId);
      const doneAt = toStatus === "DONE" ? new Date() : null;
      if (doneAt) {
        await stopTaskTimers(tx, task.id);
        const spent = await tx.timeEntry.aggregate({ where: { taskId, stoppedAt: { not: null } }, _sum: { minutes: true } });
        if ((spent._sum.minutes ?? 0) === 0) {
          if (!hasAnyRole(actor.roles, OFFICE_WRITE_ROLES)) throw new CompletionError("Нет записей времени. Возьмите задачу «В работу» — время посчитается таймером автоматически");
          if (!Number.isInteger(actualMinutes) || !actualMinutes || actualMinutes < 1 || actualMinutes > 1440) throw new CompletionError("Укажите фактическое время от 1 до 1440 минут", true);
          await tx.timeEntry.create({ data: { taskId, userId: task.assigneeId ?? actor.id, source: "manual", stoppedAt: doneAt, minutes: actualMinutes } });
          await tx.changeLog.create({ data: { actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source, entity: "task", entityId: task.id, action: "time", newValue: { actual: actualMinutes } } });
        }
      }
      await tx.task.update({ where: { id: task.id }, data: { status: toStatus, splitRevision: { increment: 1 }, ...(doneAt ? { doneAt, doneById: actor.id } : {}) } });
      let payroll: { name: string; amount: string; currency: string } | null = null;
      // Инженерный фонд начисляется целиком при передаче изделия в производство.
      // Старые monetary snapshots конвертированной работы не являются её оплатой.
      if (doneAt && task.assigneeId && task.work && task.work.paymentKind === "LEGACY") {
        if(task.work.projectId!==task.projectId||task.work.productId!==task.productId)throw new CompletionError("Работа и задача относятся к разным изделиям или проектам");
        const frozenObligation = hasFrozenTaskPieceObligation(task);
        const assignee = await tx.user.findUnique({ where: { id: task.assigneeId }, select: { name: true, payScheme: true, roles: true } });
        if (assignee?.payScheme === "PIECE" && (canAccrueOrdinarySalary(assignee.roles) || frozenObligation) && !await tx.payrollEntry.findFirst({ where: { taskId: task.id, scheme: "PIECE" }, select: { id: true } })) {
          if (task.work.priceSnapshot === null && !frozenObligation) throw new CompletionError("Не задана расценка обычной работы");
          const amount = taskPieceAmount(task, task.work.priceSnapshot ?? 0);
          if (moneyAtoms(amount) > BigInt(0)) {
            const currency = task.allocationGroup?.currency ?? (await tx.orgSetting.findUnique({ where: { key: "payrollCurrency" } }))?.value ?? "BYN";
            try { assertProjectMoneyCurrency(task.project.currency); assertInternalCurrency(currency); }
            catch (error) { throw new CompletionError(error instanceof Error ? error.message : "Не определена валюта работы"); }
            await tx.payrollEntry.create({ data: { userId: task.assigneeId, taskId: task.id, workId: task.work.id, projectId: task.projectId, amount, bynAmount: amount, currency, scheme: "PIECE", month: doneAt.toISOString().slice(0, 7), comment: `${task.title} · ${task.project.number}` } });
            payroll = { name: assignee.name, amount, currency };
          }
        }
      }
      await tx.changeLog.create({ data: { actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source, entity: "task", entityId: task.id, action: "status", field: "status", oldValue: task.status, newValue: toStatus } });
      const event = await tx.domainEvent.create({ data: { type: "task.statusChanged", actor: actor.id, payload: { taskId, projectId: task.projectId, from: task.status, to: toStatus } } });
      return { ok: true, repeated: false, task: effect, payroll, eventId: event.id };
    });
  } catch (error) {
    if (error instanceof CompletionError) return { ok: false, error: error.message, ...(error.timeRequired ? { timeRequired: true } : {}) };
    throw error;
  }
}
