import type { Role } from "@prisma/client";
import { FIELD_ROLES, OFFICE_ROLES, WAREHOUSE_MANAGE_ROLES, hasAnyRole } from "./roles";
export const FINISH_CATALOG_MANAGE_ROLES = [...WAREHOUSE_MANAGE_ROLES];
export const FINISH_CATALOG_READ_ROLES = [...new Set([...OFFICE_ROLES, ...FIELD_ROLES])];
export const canManageFinishCatalog = (roles: readonly Role[]) => hasAnyRole([...roles], FINISH_CATALOG_MANAGE_ROLES);
export const canReadFinishCatalog = (roles: readonly Role[]) => hasAnyRole([...roles], FINISH_CATALOG_READ_ROLES);
