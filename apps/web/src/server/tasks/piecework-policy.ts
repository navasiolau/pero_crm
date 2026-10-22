import type { PayScheme, Role } from "@prisma/client";
import { canAccrueOrdinarySalary } from "@/lib/compensation-policy";
import { fieldProductStatuses } from "@/lib/field-product-visibility";
import { hasAnyRole, hasRole, MANAGER_ROLES } from "@/lib/roles";
import { taskRecipientError, type TaskProductContext } from "./share-policy";

export function pieceworkRecipientError(user: { id: string; active: boolean; roles: Role[]; payScheme: PayScheme }, product: TaskProductContext): string | null {
  const roleError = taskRecipientError(user, product);
  if (roleError) return roleError;
  if (user.payScheme !== "PIECE") return "Выберите сотрудника со сдельной оплатой";
  if (!canAccrueOrdinarySalary(user.roles)) return "Инженер получает оплату через фонд изделия";
  // Повторяет status grant исполнения задачи, включая совмещённого инженера.
  if (hasAnyRole(user.roles, MANAGER_ROLES) || product && (fieldProductStatuses(user.roles).includes(product.status) ||
    hasRole(user.roles, "ENGINEER") && product.engineerId === user.id && product.status === "DESIGN")) return null;
  return "У сотрудника нет права выполнять работу на этом этапе изделия";
}
