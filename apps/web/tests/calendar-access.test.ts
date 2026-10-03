import assert from 'node:assert/strict';
import test from 'node:test';
import {isCalendarEnabled, resolveCalendarActor} from '../src/lib/calendar-access';
import {navItemsForRole} from '../src/lib/nav';
import type {Role} from '../src/lib/roles';

test('calendar inherits procurement only; explicit override survives any role change',()=>{
 const roles:Role[]=['ADMIN','DIRECTOR','MANAGER','ENGINEER','ACCOUNTANT','WORKER','MOUNTER','PROCUREMENT'];
 for(const role of roles){assert.equal(isCalendarEnabled({roles:[role],calendarEnabled:null}),role==='PROCUREMENT');assert.equal(isCalendarEnabled({roles:[role],calendarEnabled:true}),true);assert.equal(isCalendarEnabled({roles:[role],calendarEnabled:false}),false);}
 assert.equal(isCalendarEnabled({roles:['ENGINEER','PROCUREMENT'],calendarEnabled:null}),true);
});
test('plan placement preserves existing union and pure accountant finance boundary',()=>{
 for(const roles of [['ACCOUNTANT'],['WORKER'],['MANAGER'],['ENGINEER','MANAGER']] as Role[][]){
 const baseline=navItemsForRole(roles,false), enabled=navItemsForRole(roles,true);
 assert.deepEqual(enabled.filter(x=>x.href!=='/plan'),baseline);
 const dashboard=enabled.findIndex(x=>x.href==='/');assert.equal(enabled.findIndex(x=>x.href==='/plan'),dashboard<0?0:dashboard+1);
 }
 assert.deepEqual(navItemsForRole(['ACCOUNTANT'],true).map(x=>x.href),['/plan','/finance']);
});
test('live actor guard does not trust stale grants or accept arbitrary subject',async()=>{
 const calls:string[]=[];let enabled:boolean|null=true;
 const find=async(id:string)=>{calls.push(id);return {id,active:true,roles:['ACCOUNTANT'] as Role[],calendarEnabled:enabled};};
 assert.equal((await resolveCalendarActor('session-actor',find)).id,'session-actor');enabled=false;
 await assert.rejects(()=>resolveCalendarActor('session-actor',find),/CALENDAR_DISABLED/);
 await assert.rejects(()=>resolveCalendarActor(null,find),/CALENDAR_AUTH_REQUIRED/);
 await assert.rejects(()=>resolveCalendarActor('session-actor',async()=>null),/CALENDAR_ACTOR_INACTIVE/);
 await assert.rejects(()=>resolveCalendarActor('session-actor',async()=>({id:'other',active:true,roles:['PROCUREMENT'],calendarEnabled:null})),/CALENDAR_ACTOR_MISMATCH/);
 assert.deepEqual(calls,['session-actor','session-actor']);
});
