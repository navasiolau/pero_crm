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
  if (!hasRole(roles, "ENGINEER") || !input.assignedEngineer)
    return { allowed: false, error: "Недостаточно прав для изменения статуса изделия" };
  if (!["DESIGN", "PRODUCTION"].includes(input.from) || !["DESIGN", "PRODUCTION"].includes(input.to))
    return { allowed: false, error: "Назначенный инженер может менять только проектирование и производство" };
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
