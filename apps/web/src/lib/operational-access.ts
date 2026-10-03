import {ASSIGNEE_ROLES,FIELD_ROLES,OFFICE_ROLES,hasAnyRole,type Role} from './roles';

const prefixes=['/projects','/products','/clients','/tasks','/warehouse','/prices','/finishes','/api/files','/api/search'];
const within=(path:string,prefix:string)=>path===prefix||path.startsWith(`${prefix}/`);
/** Finance membership never implies access to operational pages or technical bytes. */
export function canAccessOperationalPath(roles:Role[],pathname:string):boolean{
 if(within(pathname,'/payroll'))return hasAnyRole(roles,[...OFFICE_ROLES,...FIELD_ROLES]);
 if(within(pathname,'/my'))return hasAnyRole(roles,ASSIGNEE_ROLES);
 return !prefixes.some(prefix=>within(pathname,prefix))||hasAnyRole(roles,[...OFFICE_ROLES,...FIELD_ROLES]);
}
