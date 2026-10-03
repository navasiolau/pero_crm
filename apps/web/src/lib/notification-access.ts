import {FIELD_ROLES,FINANCE_ROLES,OFFICE_ROLES,hasAnyRole,type Role} from './roles';
export const FINANCIAL_ORG_NOTIFICATION_TYPES=['payment.added','expense.added','payroll.orgPayout','payroll.orgAccrued'];
const personalFinance=['payroll.accrued','payroll.payout','user.accountChanged'];
export function canReceiveNotificationContent(roles:Role[],type:string):boolean{
 if(personalFinance.includes(type))return true;
 if(FINANCIAL_ORG_NOTIFICATION_TYPES.includes(type))return hasAnyRole(roles,FINANCE_ROLES);
 return hasAnyRole(roles,[...OFFICE_ROLES,...FIELD_ROLES]);
}
