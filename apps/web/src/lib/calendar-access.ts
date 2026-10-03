import type {Role} from './roles';
import {hasRole} from './roles';
export type CalendarAccount={roles:Role[];calendarEnabled:boolean|null};
export function isCalendarEnabled(account:CalendarAccount):boolean{
 return account.calendarEnabled ?? hasRole(account.roles,'PROCUREMENT');
}
export type CalendarActor=CalendarAccount & {id:string;active:boolean};
/** Actor берётся только из проверенной сессии; доступ читается заново. */
export async function resolveCalendarActor(actorId:string|null|undefined,find:(id:string)=>Promise<CalendarActor|null>):Promise<CalendarActor>{
 if(!actorId)throw new Error('CALENDAR_AUTH_REQUIRED');
 const actor=await find(actorId);
 if(!actor?.active)throw new Error('CALENDAR_ACTOR_INACTIVE');
 if(actor.id!==actorId)throw new Error('CALENDAR_ACTOR_MISMATCH');
 if(!isCalendarEnabled(actor))throw new Error('CALENDAR_DISABLED');
 return actor;
}
