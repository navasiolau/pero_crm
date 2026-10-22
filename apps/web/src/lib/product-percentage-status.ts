import type { ProductStatus, Role } from "@prisma/client";
import { canViewProductDrafts } from "./product-drafts";
import { MANAGER_ROLES, hasAnyRole, hasRole } from "./roles";
import { isActiveProductStatus } from "./product-statuses";

export interface ProductPercentageStatusContext {
  from: ProductStatus;
  to: ProductStatus;
  assignedEngineer: boolean;
  participant: boolean;
  hasB3d: boolean;
  noModel: boolean;
  /** Сервер вычисляет по контексту конкретного изделия; UI получает только результат. */
  canAccessDraft?: boolean;
}

export function decideProductPercentageStatus(roles: Role[], input: ProductPercentageStatusContext): { allowed: boolean; error?: string } {
  if (!isActiveProductStatus(input.to)) return { allowed: false, error: "Этот статус изделия больше не используется" };
  if ((input.from === "DRAFT" || input.to === "DRAFT") && !canViewProductDrafts(roles) && !(roles.includes("MANAGER") && input.canAccessDraft === true))
    return { allowed: false, error: "Недостаточно прав для изменения статуса изделия" };
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
    (["PRODUCTION", "STORAGE", "INSTALLATION", "DONE"] as ProductStatus[]).includes(to)) kinds.push("ENGINEERING");
  if (manager && (["STORAGE", "INSTALLATION", "DONE"] as ProductStatus[]).includes(to)) kinds.push("ASSEMBLY");
  if (to === "DONE" && manager) kinds.push("INSTALLATION");
  return kinds;
}
