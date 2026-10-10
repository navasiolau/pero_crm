import {canViewProductDrafts} from "@/lib/product-drafts";
import {hasAnyRole,MANAGER_ROLES,hasWorkCoordinator,type Role} from '@/lib/roles';
import {fieldProductStatuses} from '@/lib/field-product-visibility';
import {canCreateOrdinaryWork} from '@/lib/ordinary-work-access';
export function canAddProductWork(roles:Role[],status:string):boolean {
 if(status==="DRAFT"&&!canViewProductDrafts(roles))return false;
 // Эта проверка даёт только операцию; caller обязан проверить live productVisibilityWhere.
 return canCreateOrdinaryWork(roles)&&(hasAnyRole(roles,MANAGER_ROLES)||hasWorkCoordinator(roles)||fieldProductStatuses(roles).some(value=>value===status));
}
