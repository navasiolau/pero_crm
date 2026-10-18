import type { Role } from '@prisma/client';
import { MANAGER_ROLES, hasAnyRole } from './roles';

export function canUseKpEditor(account: { active: boolean; roles: Role[] } | null, enabled: boolean): boolean {
  return enabled && account?.active === true && hasAnyRole(account.roles, MANAGER_ROLES);
}
