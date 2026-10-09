import type { ProductStatus, ProjectStage, Role } from "@prisma/client";
import { ADMIN_ROLES, hasAnyRole } from "./roles";

export function isPreContractProjectStage(stage: ProjectStage): boolean {
  return stage === "LEAD" || stage === "ESTIMATE";
}

/** Неизвестный контекст черновика в старой форме не разрешает обход договора. */
export function isProductDraftLocked(status: ProductStatus, stage?: ProjectStage | null): boolean {
  return status === "DRAFT" && (!stage || isPreContractProjectStage(stage));
}
/** Черновики доступны только владельцу и директору, независимо от назначений. */
export function canViewProductDrafts(roles: readonly Role[]): boolean {
  return hasAnyRole([...roles], ADMIN_ROLES);
}
