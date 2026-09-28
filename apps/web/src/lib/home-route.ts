import { hasAnyRole, hasRole, MANAGER_ROLES, type Role } from "@/lib/roles";

// Единый стартовый маршрут; порядок соответствует приоритету ролей.
// Объединение прав других разделов остаётся в их собственных проверках.
export function homePathForRoles(roles: Role[] | null | undefined) {
  if (hasAnyRole(roles, MANAGER_ROLES)) return "/";
  if (hasRole(roles, "ENGINEER")) return "/products";
  if (hasRole(roles, "ACCOUNTANT")) return "/finance";
  return "/my";
}
