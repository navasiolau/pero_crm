import {hasAnyRole,hasRole,MANAGER_ROLES,type Role} from '@/lib/roles';
export function canAddProductWork(roles:Role[],status:string):boolean {
 return hasAnyRole(roles,MANAGER_ROLES)||(hasRole(roles,'WORKER')&&status==='PRODUCTION');
}
