import { hasAnyRole, type Role } from "./roles";

export const EXPENSE_PROJECT_ASSIGNMENT_ROLES: Role[] = ["ACCOUNTANT", "DIRECTOR", "ADMIN"];

export function canAssignExpenseProject(roles: Role[]) {
  return hasAnyRole(roles, EXPENSE_PROJECT_ASSIGNMENT_ROLES);
}
