import type { Role } from "@prisma/client";
import { hasAnyRole, hasWorkCoordinator, MANAGER_ROLES } from "@/lib/roles";

export function canManageTaskReassignment(roles: Role[]): boolean {
  return hasAnyRole(roles, MANAGER_ROLES) || hasWorkCoordinator(roles);
}

export type TaskReassignmentContext = {
  status: string; productId: string | null; projectId?: string; workId: string | null;
  _count?: { payrollEntries?: number; stageSettlementShares?: number };
  work?: { id?: string; projectId?: string; productId?: string | null; paymentKind?: string; stagePayPoolId?: string | null; poolWeightUnits?: unknown;
    priceSnapshot?: unknown; _count?: { paymentConversions?: number; settlementShares?: number } } | null;
  allocationGroup?: { workId?: string | null; budgetSource?: string } | null;
  allocationGroupId?: string | null; shareAmount?: unknown;
  physicalOnlyShare?: boolean; stageShareUnits?: number | null;
};

function ordinaryTaskStructureError(task: TaskReassignmentContext): string | null {
  if (!task.productId || !task.workId || !task.work || task.work.paymentKind !== "LEGACY" || task.work.stagePayPoolId != null || task.work.poolWeightUnits != null)
    return "Переназначение доступно только для обычной работы изделия";
  if (task.physicalOnlyShare || task.stageShareUnits != null) return "Историческую процентную задачу нельзя переназначить этим действием";
  if (task.work.productId !== task.productId || task.projectId && task.work.projectId !== task.projectId)
    return "Работа и задача относятся к разным изделиям или проектам";
  if (task.status === "DONE" || (task._count?.payrollEntries ?? 0) > 0 || (task._count?.stageSettlementShares ?? 0) > 0 ||
    (task.work._count?.paymentConversions ?? 0) > 0 || (task.work._count?.settlementShares ?? 0) > 0)
    return "Выполненную или начисленную задачу нельзя переназначить";
  if (task.allocationGroupId && (!task.allocationGroup || task.allocationGroup.workId !== task.workId || task.allocationGroup.budgetSource !== "TASK_FIXED"))
    return "Снимок распределённой задачи недоступен для переназначения";
  return null;
}

/** Сервер проверяет немаскированный снимок, не меняя его и не возвращая финансовые данные. */
export function ordinaryTaskReassignmentError(task: TaskReassignmentContext): string | null {
  const error = ordinaryTaskStructureError(task); if (error) return error;
  if (task.allocationGroupId ? task.shareAmount == null : task.work?.priceSnapshot == null) return "У обычной задачи отсутствует снимок оплаты";
  return null;
}

export function canReassignOrdinaryTask(roles: Role[], task: TaskReassignmentContext): boolean {
  // Affordance не зависит от маскированных price/shareAmount. Команда перечитает реальные снимки.
  return canManageTaskReassignment(roles) && ordinaryTaskStructureError(task) === null;
}
