import type { ProductStatus, Role } from "@prisma/client";
import { FIELD_ROLES, MANAGER_ROLES, hasAnyRole, hasRole } from "@/lib/roles";

export type ShareActor = { id: string; roles: Role[] };
export type TaskProductContext = { engineerId: string | null; status: ProductStatus } | null;

export function taskRecipientError(user: ShareActor & { active: boolean }, product: TaskProductContext): string | null {
  if (!user.active) return "Сотрудник неактивен";
  if (hasAnyRole(user.roles, MANAGER_ROLES) || hasAnyRole(user.roles, FIELD_ROLES)) return null;
  if (hasRole(user.roles, "ENGINEER")) {
    return product?.engineerId === user.id && product.status === "DESIGN" ? null
      : "Инженер может получить задачу только своего изделия на проектировании";
  }
  return hasRole(user.roles, "ACCOUNTANT") ? null : "У сотрудника нет роли для выполнения задач";
}

export function canSplitTask(actor: ShareActor, task: { assigneeId: string | null; status: string; product: TaskProductContext; paidCount: number }): boolean {
  if (!task.assigneeId || !["NEW", "IN_PROGRESS"].includes(task.status) || task.paidCount > 0) return false;
  return hasAnyRole(actor.roles, MANAGER_ROLES) || (
    task.assigneeId === actor.id && !taskRecipientError({ ...actor, active: true }, task.product)
  );
}
