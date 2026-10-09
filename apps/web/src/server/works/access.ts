import {canViewProductDrafts} from "@/lib/product-drafts";
import {hasAnyRole,FIELD_ROLES,MANAGER_ROLES,type Role} from '@/lib/roles';
export function canAddProductWork(roles:Role[],status:string):boolean {
 if(status==="DRAFT"&&!canViewProductDrafts(roles))return false;
 return hasAnyRole(roles,MANAGER_ROLES)||(hasAnyRole(roles,FIELD_ROLES)&&status==='PRODUCTION');
}
