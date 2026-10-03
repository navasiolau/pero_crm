import assert from 'node:assert/strict';
import test from 'node:test';
import type {Prisma,CalendarEntry} from '@prisma/client';
import {confirmCalendarReminderCore,calendarReminderDue} from '../src/server/calendar/reminders';
import type {CalendarTransaction} from '../src/server/calendar/core';
import type {ReminderContext} from '../src/lib/calendar-reminder-context';
const namespace='local:00000000-0000-4000-8000-000000000001',context:ReminderContext={environment:'local',namespace,testOwnerIds:['own'],enabled:true},now=new Date('2026-10-03T09:00:00Z');
function fixture(){
 let state={entry:{id:'entry',ownerId:'own',title:'Personal',description:'private',startsAt:new Date('2026-10-03T09:15:00Z'),state:'PLANNED',revision:0,reminderOffsetMinutes:15,reminderNamespace:namespace} as CalendarEntry,owner:{id:'own',active:true,roles:['ACCOUNTANT'],calendarEnabled:true},facts:[] as Record<string,unknown>[],notifications:[] as Record<string,unknown>[],preference:true};let failFact=false;let tail=Promise.resolve();
 const tx={
 $queryRaw:async()=>[],calendarEntry:{findUnique:async()=>state.entry},user:{findUnique:async()=>state.owner},notificationPreference:{findUnique:async()=>({enabled:state.preference})},
 calendarReminderFact:{findUnique:async({where}:{where:{namespace_entryId_entryRevision:{entryRevision:number}}})=>state.facts.find(fact=>fact.entryRevision===where.namespace_entryId_entryRevision.entryRevision)??null,create:async({data}:{data:Record<string,unknown>})=>{if(failFact)throw Error('FACT_CREATE_FAILED');state.facts.push(data);return {id:'fact',...data};}},
 notification:{create:async({data}:{data:Record<string,unknown>})=>{const row={id:`notice-${state.notifications.length}`, ...data};state.notifications.push(row);return row;}},
 } as unknown as Prisma.TransactionClient;
 const transaction:CalendarTransaction=async operation=>{const previous=tail;let release!:()=>void;tail=new Promise(resolve=>{release=resolve;});await previous;const before=structuredClone(state);try{return await operation(tx);}catch(error){state=before;throw error;}finally{release();}};
 return {state:()=>state,transaction,fail:(value:boolean)=>{failFact=value;}};
}
test('reminder due uses stored UTC and nullable/closed offsets',()=>{assert.equal(calendarReminderDue(new Date('2026-10-03T09:15Z'),15)?.toISOString(),now.toISOString());assert.equal(calendarReminderDue(now,null),null);assert.equal(calendarReminderDue(now,10),null);});
test('real confirmation core creates one own notification and confirmed shared fact across concurrent retry',async()=>{
 const f=fixture();assert.deepEqual(await Promise.all([confirmCalendarReminderCore(context,{id:'entry',revision:0},now,f.transaction),confirmCalendarReminderCore(context,{id:'entry',revision:0},now,f.transaction)]),['delivered','repeated']);
 assert.equal(f.state().notifications.length,1);assert.equal(f.state().notifications[0].userId,'own');assert.equal(f.state().notifications[0].link,'/plan?date=2026-10-03');assert.equal(f.state().facts.length,1);assert.equal(f.state().facts[0].webNotificationId,'notice-0');assert.equal(f.state().facts[0].namespace,namespace);assert.equal(f.state().facts[0].confirmedAt,now);
});
test('atomic failure after notification rolls both back and successful retry still confirms once',async()=>{
 const f=fixture();f.fail(true);await assert.rejects(()=>confirmCalendarReminderCore(context,{id:'entry',revision:0},now,f.transaction),/FACT_CREATE_FAILED/);assert.equal(f.state().notifications.length,0);assert.equal(f.state().facts.length,0);
 f.fail(false);assert.equal(await confirmCalendarReminderCore(context,{id:'entry',revision:0},now,f.transaction),'delivered');assert.equal(f.state().notifications.length,1);
});
test('cancel/update/disabled/inactive/null/future and imported or unallowlisted source never deliver',async()=>{
 for(const mode of ['cancelled','completed','revision','disabled','inactive','null','future','production-import','null-namespace','foreign-owner']){
 const f=fixture();const state=f.state();if(mode==='cancelled')state.entry.state='CANCELLED';if(mode==='completed')state.entry.state='COMPLETED';if(mode==='revision')state.entry.revision=1;if(mode==='disabled')state.owner.calendarEnabled=false;if(mode==='inactive')state.owner.active=false;if(mode==='null')state.entry.reminderOffsetMinutes=null;if(mode==='future')state.entry.startsAt=new Date('2026-10-04T09:15Z');if(mode==='production-import')state.entry.reminderNamespace='production';if(mode==='null-namespace')state.entry.reminderNamespace=null;if(mode==='foreign-owner')state.entry.ownerId='imported';
 assert.equal(await confirmCalendarReminderCore(context,{id:'entry',revision:0},now,f.transaction),'skipped',mode);assert.equal(state.facts.length,0,mode);assert.equal(state.notifications.length,0,mode);
 }
});
test('disabled personal preference records suppressed confirmed fact without Notification or duplicate',async()=>{
 const f=fixture();f.state().preference=false;assert.equal(await confirmCalendarReminderCore(context,{id:'entry',revision:0},now,f.transaction),'suppressed');assert.equal(f.state().facts[0].webState,'SKIPPED');assert.equal(f.state().notifications.length,0);assert.equal(await confirmCalendarReminderCore(context,{id:'entry',revision:0},now,f.transaction),'repeated');
});
