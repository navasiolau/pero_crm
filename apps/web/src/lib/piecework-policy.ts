import type { Role } from "@prisma/client";
import { FIELD_ROLES, MANAGER_ROLES, hasAnyRole, hasWorkCoordinator } from "./roles";

export function canManagePiecework(roles: Role[]): boolean {
  return hasAnyRole(roles, MANAGER_ROLES) || hasWorkCoordinator(roles);
}

export function ordinaryPieceworkBinding(work: { paymentKind?: string; stagePayPoolId?: string | null; poolWeightUnits?: number | null;
  _count?: { paymentConversions: number; settlementShares: number } }): boolean {
  return work.paymentKind === "LEGACY" && work.stagePayPoolId === null && work.poolWeightUnits === null &&
    work._count?.paymentConversions === 0 && work._count.settlementShares === 0;
}

export function canTransferPiecework(actor: { id: string; roles: Role[] }, task: { assigneeId: string | null; status: string }): boolean {
  return task.assigneeId !== null && (task.status === "NEW" || task.status === "IN_PROGRESS") &&
    (canManagePiecework(actor.roles) || task.assigneeId === actor.id && hasAnyRole(actor.roles, FIELD_ROLES));
}
