import type { ProductStatus, Role } from "@prisma/client";
import { MANAGER_ROLES, hasAnyRole, hasRole } from "./roles";

export interface ProductPercentageStatusContext {
  from: ProductStatus;
  to: ProductStatus;
  assignedEngineer: boolean;
  participant: boolean;
  hasB3d: boolean;
  noModel: boolean;
}

export function decideProductPercentageStatus(roles: Role[], input: ProductPercentageStatusContext): { allowed: boolean; error?: string } {
  if (hasAnyRole(roles, MANAGER_ROLES)) return { allowed: true };
  if (!hasRole(roles, "ENGINEER") || !input.assignedEngineer && !input.participant)
    return { allowed: false, error: "Недостаточно прав для изменения статуса изделия" };
  if (input.from !== "DESIGN" || input.to !== "PRODUCTION")
    return { allowed: false, error: "Инженер может передать изделие только из проектирования в производство" };
  if (!input.hasB3d && !input.noModel)
    return { allowed: false, error: "Для передачи изделия нужна модель B3D или отметка «Модели нет»" };
  return { allowed: true };
}

export function percentageCompletionKinds(from: ProductStatus, to: ProductStatus, manager: boolean): ("ENGINEERING" | "ASSEMBLY" | "INSTALLATION")[] {
  const kinds: ("ENGINEERING" | "ASSEMBLY" | "INSTALLATION")[] = [];
  if ((manager || from === "DESIGN" || from === "RECLAMATION") &&
    (["PRODUCTION", "DELIVERY", "INSTALLATION", "DONE"] as ProductStatus[]).includes(to)) kinds.push("ENGINEERING");
  if (manager && (["DELIVERY", "INSTALLATION", "DONE"] as ProductStatus[]).includes(to)) kinds.push("ASSEMBLY");
  if (to === "DONE" && manager) kinds.push("INSTALLATION");
  return kinds;
}
