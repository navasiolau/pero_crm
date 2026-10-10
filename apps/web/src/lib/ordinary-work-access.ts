import { FIELD_ROLES, MANAGER_ROLES, hasAnyRole, hasWorkCoordinator, type Role } from "./roles";
import { fieldProductStatuses } from "./field-product-visibility";
import { canViewProductDrafts } from "./product-drafts";

// Роль координатора добавляет только создание; редактирование имеет свой grant.
export function canCreateOrdinaryWork(roles: Role[]): boolean {
  return hasAnyRole(roles, MANAGER_ROLES) || hasAnyRole(roles, FIELD_ROLES) || hasWorkCoordinator(roles);
}

export function canEditOrdinaryWork(roles: Role[], status: string): boolean {
  if (status === "DRAFT" && !canViewProductDrafts(roles)) return false;
  return hasAnyRole(roles, MANAGER_ROLES) || fieldProductStatuses(roles).some(value => value === status);
}
