import {FINANCE_ROLES,MANAGER_ROLES,hasAnyRole,type Role} from "./roles";
/** Коммерческая стоимость и чужая оплата доступны только по финансовой/управленческой роли. */
export function canViewProductMoney(roles:Role[]):boolean{
 return hasAnyRole(roles,MANAGER_ROLES)||hasAnyRole(roles,FINANCE_ROLES);
}
