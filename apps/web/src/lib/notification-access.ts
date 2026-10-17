import {ADVANCE_ROLES,FIELD_ROLES,FINANCE_ROLES,OFFICE_ROLES,PAYROLL_MANAGE_ROLES,hasAnyRole,type Role} from './roles';
export const FINANCIAL_ORG_NOTIFICATION_TYPES=['payment.added','expense.added','payroll.orgPayout','payroll.orgAccrued','payroll.orgAdvance'];
const personalFinance=['payroll.accrued','payroll.payout','user.accountChanged'];
export function canReceiveNotificationContent(roles:Role[],type:string):boolean{
 if(type==='plan.reminder')return true;
 if(personalFinance.includes(type))return true;
 if(type==='payroll.orgPayout'||type==='payroll.orgAccrued')return hasAnyRole(roles,PAYROLL_MANAGE_ROLES);
 if(type==='payroll.orgAdvance')return hasAnyRole(roles,ADVANCE_ROLES);
 if(FINANCIAL_ORG_NOTIFICATION_TYPES.includes(type))return hasAnyRole(roles,FINANCE_ROLES);
 return hasAnyRole(roles,[...OFFICE_ROLES,...FIELD_ROLES]);
}
