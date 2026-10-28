import type { Role } from "@prisma/client";
import { hasAnyRole } from "./roles";

export const LOGISTICS_MANAGE_ROLES: Role[] = ["ADMIN", "DIRECTOR", "PROCUREMENT"];
export const LOGISTICS_DOCUMENT_ROLES: Role[] = [...LOGISTICS_MANAGE_ROLES, "ACCOUNTANT"];
export const LOGISTICS_DELETE_ROLES: Role[] = ["ADMIN"];

export const canManageLogistics = (roles: Role[] | null | undefined) => hasAnyRole(roles, LOGISTICS_MANAGE_ROLES);
export const canReadLogisticsDocuments = (roles: Role[] | null | undefined) => hasAnyRole(roles, LOGISTICS_DOCUMENT_ROLES);
export const canDeleteLogisticsTrip = (roles: Role[] | null | undefined) => hasAnyRole(roles, LOGISTICS_DELETE_ROLES);
