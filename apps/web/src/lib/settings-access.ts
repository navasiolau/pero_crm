import type {Role} from '@prisma/client';
import {ADMIN_ROLES,MANAGER_ROLES,WAREHOUSE_UNIT_ADMIN_ROLES,hasAnyRole} from './roles';
export const PRODUCT_PERCENTAGE_SETTINGS_PATH='/settings/product-percentages';
export const WAREHOUSE_UNIT_SETTINGS_PATH="/settings/warehouse-units";
export function canAccessSettingsPath(roles:readonly Role[],pathname:string):boolean{
 const normalized=pathname.replace(/\/+$/,'');
 if(normalized==='/settings/kp'||normalized.startsWith('/settings/kp/'))return roles.includes('ADMIN');
 if(normalized===WAREHOUSE_UNIT_SETTINGS_PATH||normalized.startsWith(WAREHOUSE_UNIT_SETTINGS_PATH+'/'))return hasAnyRole([...roles],WAREHOUSE_UNIT_ADMIN_ROLES);
 return hasAnyRole([...roles],ADMIN_ROLES)||['/settings',PRODUCT_PERCENTAGE_SETTINGS_PATH].includes(pathname.replace(/\/+$/,''))&&hasAnyRole([...roles],MANAGER_ROLES);
}
