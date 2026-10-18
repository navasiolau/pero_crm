import {FINANCE_ROLES,MANAGER_ROLES,hasAnyRole,type Role} from "./roles";
/** Коммерческая стоимость и чужая оплата доступны только по финансовой/управленческой роли. */
export function canViewProductMoney(roles:Role[]):boolean{
 return hasAnyRole(roles,MANAGER_ROLES)||hasAnyRole(roles,FINANCE_ROLES);
}

export function projectMoneyForRoles<T extends { initialPrice: unknown; delivery: unknown; unloading: unknown; installation: unknown }>(project: T, roles: Role[]) {
  return canViewProductMoney(roles) ? project : {
    ...project, initialPrice: null, delivery: null, unloading: null, installation: null, servicesTotal: null, proposalRoundingAdjustment: null,
  };
}
