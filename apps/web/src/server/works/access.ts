import {canViewProductDrafts} from "@/lib/product-drafts";
import {hasAnyRole,MANAGER_ROLES,type Role} from '@/lib/roles';
import {fieldProductStatuses} from '@/lib/field-product-visibility';
import {canCreateOrdinaryWork} from '@/lib/ordinary-work-access';
export function canAddProductWork(roles:Role[],status:string):boolean {
 if(status==="DRAFT"&&!canViewProductDrafts(roles))return false;
 return canCreateOrdinaryWork(roles)&&(hasAnyRole(roles,MANAGER_ROLES)||fieldProductStatuses(roles).some(value=>value===status));
}
