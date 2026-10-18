import { FIELD_ROLES, MANAGER_ROLES, hasAnyRole, hasWorkCoordinator, type Role } from "./roles";
import { fieldProductStatuses } from "./field-product-visibility";
import { canAccessProductDraft, type ProductDraftAccessContext } from "./product-drafts";

// Роль координатора добавляет только создание; редактирование имеет свой grant.
export function canCreateOrdinaryWork(roles: Role[]): boolean {
  return hasAnyRole(roles, MANAGER_ROLES) || hasAnyRole(roles, FIELD_ROLES) || hasWorkCoordinator(roles);
}

export function canEditOrdinaryWork(roles: Role[], status: string, context?: ProductDraftAccessContext): boolean {
  if (status === "DRAFT" && !canAccessProductDraft(roles, context)) return false;
  return hasAnyRole(roles, MANAGER_ROLES) || fieldProductStatuses(roles).some(value => value === status);
}
