import type { ProjectStage, Role } from "@prisma/client";
import { canAccessProductDraft, type ProductDraftAccessContext } from "./product-drafts";
import { ENGINEER_PRODUCT_STATUSES } from "./engineering-read-access";
import { MANAGER_ROLES, hasAnyRole, hasRole } from "./roles";

/** Видимость связей проверяется сервером отдельно; назначение для файлов не требуется. */
export function canManageProjectFiles(roles: readonly Role[], stage: ProjectStage): boolean {
  return hasAnyRole([...roles], MANAGER_ROLES) ||
    (hasRole([...roles], "ENGINEER") && ["IN_WORK", "DONE", "REFUSED"].includes(stage));
}

export function canManageProductFiles(
  roles: readonly Role[],
  product: ProductDraftAccessContext & { status: string },
): boolean {
  if (hasAnyRole([...roles], MANAGER_ROLES))
    return product.status !== "DRAFT" || canAccessProductDraft(roles, product);
  return hasRole([...roles], "ENGINEER") && ENGINEER_PRODUCT_STATUSES.some(status => status === product.status);
}
