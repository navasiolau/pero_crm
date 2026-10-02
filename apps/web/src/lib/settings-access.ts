import type {Role} from '@prisma/client';
import {ADMIN_ROLES,MANAGER_ROLES,hasAnyRole} from './roles';
export const PRODUCT_PERCENTAGE_SETTINGS_PATH='/settings/product-percentages';
export function canAccessSettingsPath(roles:readonly Role[],pathname:string):boolean{
 return hasAnyRole([...roles],ADMIN_ROLES)||pathname.replace(/\/+$/,'')===PRODUCT_PERCENTAGE_SETTINGS_PATH&&hasAnyRole([...roles],MANAGER_ROLES);
}
