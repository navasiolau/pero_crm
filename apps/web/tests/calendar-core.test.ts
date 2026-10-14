import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { type Prisma, type CalendarEntry, type Role } from "@prisma/client";
import { listCalendarMonthCore, mutateCalendarCore, type CalendarTransaction } from "../src/server/calendar/core";
import { isCalendarEnabled, resolveCalendarActor } from "../src/lib/calendar-access";
import { navItemsForRole } from "../src/lib/nav";
import { type Role as calendarAccessRole } from "../src/lib/roles";
import { loadCalendarAnalyticsCore } from "../src/server/calendar/analytics";
import { summarizeCalendarEntries, type CalendarSummaryEntry } from "../src/lib/calendar-summary";
import { parseCalendarHours, calendarHoursInput, formatPlannedMinutes, MAX_PLANNED_MINUTES } from "../src/lib/calendar-duration";
import { calendarMutationSchema } from "../src/server/calendar/contracts";
import { resolveReminderContext, reminderOwnerAllowed, type ReminderContext } from "../src/lib/calendar-reminder-context";
import { confirmCalendarReminderCore, calendarReminderDue } from "../src/server/calendar/reminders";
import { resolveTelegramReminderContext, telegramRecipientAllowed, type TelegramReminderContext } from "../src/lib/calendar-telegram-context";
import { queueTelegramRemindersCore, claimTelegramReminderCore, authorizeTelegramReminderCore, acknowledgeTelegramReminderCore } from "../src/server/calendar/telegram-core";

{ // Источник: calendar-core.test.ts
const value={operation:'create' as const,entryId:randomUUID(),title:'My plan',description:'Private',localDateTime:'2026-10-03T12:00',reminderOffsetMinutes:15};
function fixture(){
 const rows:CalendarEntry[]=[];const users=[{id:'a',roles:['ADMIN'] as Role[],calendarEnabled:true,active:true},{id:'b',roles:['WORKER'] as Role[],calendarEnabled:true,active:true}];let writes=0,reads=0;
 type Where={id?:string;ownerId?:string;revision?:number;startsAt?:{gte:Date;lt:Date}};
 const matches=(row:CalendarEntry,w:Where)=>Object.entries(w).every(([key,val])=>key==='startsAt'?row.startsAt>=w.startsAt!.gte&&row.startsAt<w.startsAt!.lt:row[key as keyof CalendarEntry]===val);
 const tx={user:{findUnique:async({where}:{where:{id:string}})=>{reads++;return users.find(row=>row.id===where.id)??null;}},calendarEntry:{
 findFirst:async({where}:{where:Where})=>rows.find(row=>matches(row,where))??null,
 findMany:async({where}:{where:Where})=>rows.filter(row=>matches(row,where)),
 upsert:async({where,create}:{where:{id:string};create:Omit<CalendarEntry,"state"|"revision"|"createdAt"|"updatedAt">})=>{const old=rows.find(row=>row.id===where.id);if(old)return old;writes++;const row={state:'PLANNED' as const,revision:0,createdAt:new Date(),updatedAt:new Date(),...create};rows.push(row);return row;},
 updateMany:async({where,data}:{where:Where;data:Partial<CalendarEntry>&{revision:{increment:number}}})=>{const row=rows.find(row=>matches(row,where));if(!row)return {count:0};writes++;const {revision,...rest}=data;Object.assign(row,rest,{revision:row.revision+revision.increment});return {count:1};},
 }} as unknown as Prisma.TransactionClient;
 const transaction:CalendarTransaction=async operation=>operation(tx);
 return {rows,users,transaction,writes:()=>writes,reads:()=>reads};
}
test('create/update/complete/cancel/reopen and exact retry preserve one own row with CAS',async()=>{
 const f=fixture();const first=await mutateCalendarCore('a',value,f.transaction);assert.ok(first.ok);assert.equal(first.entry.startsAt,'2026-10-03T09:00:00.000Z');assert.equal(first.entry.reminderOffsetMinutes,15);
 const again=await mutateCalendarCore('a',value,f.transaction);assert.ok(again.ok&&again.repeated);assert.equal(f.rows.length,1);assert.equal(f.writes(),1);
 const conflict=await mutateCalendarCore('a',{...value,title:'Different'},f.transaction);assert.ok(!conflict.ok&&conflict.kind==='conflict');assert.equal(f.writes(),1);
 const updated=await mutateCalendarCore('a',{...value,operation:'update',expectedRevision:0,title:'Updated',reminderOffsetMinutes:null},f.transaction);assert.ok(updated.ok);assert.equal(updated.entry.revision,1);assert.equal(updated.entry.reminderOffsetMinutes,null);
 const before=JSON.stringify(f.rows);const stale=await mutateCalendarCore('a',{...value,operation:'update',expectedRevision:0,title:'Stale'},f.transaction);assert.ok(!stale.ok&&stale.kind==='conflict');assert.equal(JSON.stringify(f.rows),before);
 for(const [i,state] of (['COMPLETED','CANCELLED','PLANNED'] as const).entries()){const result=await mutateCalendarCore('a',{operation:'state',entryId:value.entryId,expectedRevision:i+1,state},f.transaction);assert.ok(result.ok);assert.equal(result.entry.state,state);}
 assert.equal(f.rows.length,1);
});
test('administrator does not acquire other owner records; disabled/deactivated actors cannot read or write',async()=>{
 const f=fixture();assert.ok((await mutateCalendarCore('b',value,f.transaction)).ok);
 assert.deepEqual(await listCalendarMonthCore('a','2026-10',f.transaction),[]);
 const before=JSON.stringify(f.rows),writes=f.writes();
 for(const input of [{...value,operation:'update',expectedRevision:0},{operation:'state',entryId:value.entryId,expectedRevision:0,state:'CANCELLED'},value]){const result=await mutateCalendarCore('a',input,f.transaction);assert.ok(!result.ok);assert.equal(result.code,'CALENDAR_ENTRY_NOT_FOUND');}
 assert.equal(f.writes(),writes);assert.equal(JSON.stringify(f.rows),before);
 f.users[1].calendarEnabled=false;assert.deepEqual(await mutateCalendarCore('b',{operation:'state',entryId:value.entryId,expectedRevision:0,state:'COMPLETED'},f.transaction),{ok:false,kind:'failure',code:'CALENDAR_DISABLED',error:'Личный план недоступен'});
 await assert.rejects(()=>listCalendarMonthCore('b','2026-10',f.transaction),/CALENDAR_DISABLED/);
 f.users[1].calendarEnabled=true;assert.equal((await listCalendarMonthCore('b','2026-10',f.transaction)).length,1);assert.equal(JSON.stringify(f.rows),before);
 f.users[1].active=false;const inactive=await mutateCalendarCore('b',value,f.transaction);assert.ok(!inactive.ok);assert.equal(inactive.code,'CALENDAR_ACTOR_INACTIVE');
});
test('closed mutation contract rejects foreign subject, malformed date, unsupported reminders and stale concurrent updates',async()=>{
 const f=fixture();for(const input of [{...value,ownerId:'b'},{...value,localDateTime:'2026-02-30T12:00'},{...value,reminderOffsetMinutes:10},{...value,title:' '},{...value,operation:'delete'},{...value,repeat:true}])assert.equal((await mutateCalendarCore('a',input,f.transaction)).ok,false);
 assert.equal(f.reads(),0);assert.equal(f.writes(),0);assert.ok((await mutateCalendarCore('a',value,f.transaction)).ok);
 const results=await Promise.all(['COMPLETED','CANCELLED'].map(state=>mutateCalendarCore('a',{operation:'state',entryId:value.entryId,expectedRevision:0,state},f.transaction)));
 assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.filter(r=>!r.ok&&r.kind==='conflict').length,1);assert.equal(f.rows[0].revision,1);
});

test('duration survives old clients and state changes; exact create and CAS include minutes',async()=>{
 const f=fixture();const input={...value,entryId:randomUUID(),plannedMinutes:90};
 const created=await mutateCalendarCore('a',input,f.transaction);assert.ok(created.ok);assert.equal(created.entry.plannedMinutes,90);
 assert.ok((await mutateCalendarCore('a',input,f.transaction)).ok);
 const conflict=await mutateCalendarCore('a',{...input,plannedMinutes:60},f.transaction);assert.ok(!conflict.ok&&conflict.kind==='conflict');
 const old=await mutateCalendarCore('a',{...value,entryId:input.entryId,operation:'update',expectedRevision:0},f.transaction);assert.ok(old.ok);assert.equal(old.entry.plannedMinutes,90);
 const done=await mutateCalendarCore('a',{operation:'state',entryId:input.entryId,expectedRevision:1,state:'COMPLETED'},f.transaction);assert.ok(done.ok);assert.equal(done.entry.plannedMinutes,90);
 const cleared=await mutateCalendarCore('a',{...input,operation:'update',expectedRevision:2,plannedMinutes:null},f.transaction);assert.ok(cleared.ok);assert.equal(cleared.entry.plannedMinutes,null);
 const zero=await mutateCalendarCore('a',{...input,operation:'update',expectedRevision:3,plannedMinutes:0},f.transaction);assert.ok(zero.ok);assert.equal(zero.entry.plannedMinutes,0);
 const before=JSON.stringify(f.rows);const stale=await mutateCalendarCore('a',{...input,operation:'update',expectedRevision:3},f.transaction);assert.ok(!stale.ok&&stale.kind==='conflict');assert.equal(JSON.stringify(f.rows),before);
});
}

{ // Источник: calendar-access.test.ts
type Role = calendarAccessRole;
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
 assert.deepEqual(navItemsForRole(['ACCOUNTANT'],true).map(x=>x.href),['/plan','/finance','/logistics']);
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
}

{ // Источник: calendar-analytics.test.ts
const query={from:'2026-10-07',to:'2026-10-08'};
function fixture(){
 let reads=0;const actor={id:'own',roles:['ADMIN'],active:true,calendarEnabled:true};
 const row=(id:string,startsAt:string,plannedMinutes:number|null,ownerId='own',state='PLANNED')=>({id,startsAt:new Date(startsAt),plannedMinutes,ownerId,state,title:id,description:'Private',revision:0,reminderOffsetMinutes:null,reminderNamespace:null,createdAt:new Date(),updatedAt:new Date('2026-11-01')}) as CalendarEntry;
 const rows=[row('before','2026-10-06T20:59:59.999Z',999),row('start','2026-10-06T21:00:00Z',90),row('end','2026-10-08T20:59:59.999Z',30,'own','COMPLETED'),row('after','2026-10-08T21:00:00Z',999),row('foreign','2026-10-07T09:00Z',9999,'other')];
 const tx={user:{findUnique:async()=>actor},calendarEntry:{findMany:async(args:{where:{ownerId:string;startsAt:{gte:Date;lt:Date}};take?:number})=>{reads++;assert.equal(args.take,undefined);return rows.filter(row=>row.ownerId===args.where.ownerId&&row.startsAt>=args.where.startsAt.gte&&row.startsAt<args.where.startsAt.lt);}}} as unknown as Prisma.TransactionClient;
 return {actor,rows,reads:()=>reads,transaction:async<T>(op:(db:Prisma.TransactionClient)=>Promise<T>)=>op(tx)};
}
test('analytics includes both MSK dates, uses plan date even if completed later and shares monthly totals',async()=>{
 const f=fixture(),result=await loadCalendarAnalyticsCore('own',query,f.transaction);
 assert.deepEqual(result.entries.map(row=>row.id),['start','end']);assert.equal(result.summary.total.hours.minutes,120);assert.equal(result.summary.total.completedCount,1);assert.equal(result.summary.total.completedHours.minutes,30);
 assert.deepEqual(result.summary.days.map(row=>row.date),['2026-10-07','2026-10-08']);assert.ok(!JSON.stringify(result).includes('ownerId'));
 const month=await loadCalendarAnalyticsCore('own',{from:'2026-10-01',to:'2026-10-31'},f.transaction);
 assert.deepEqual(month.summary,summarizeCalendarEntries(await listCalendarMonthCore('own','2026-10',f.transaction)));
});
test('invalid query, owner injection, disabled/inactive/missing actor cannot read entries',async()=>{
 const f=fixture();
 for(const input of [{...query,ownerId:'other'},{from:'2026-02-30',to:query.to},{from:query.to,to:query.from},{from:'2026-10-07T00:00',to:query.to}])await assert.rejects(loadCalendarAnalyticsCore('own',input,f.transaction));
 assert.equal(f.reads(),0);f.actor.calendarEnabled=false;await assert.rejects(loadCalendarAnalyticsCore('own',query,f.transaction),/CALENDAR_DISABLED/);
 f.actor.calendarEnabled=true;f.actor.active=false;await assert.rejects(loadCalendarAnalyticsCore('own',query,f.transaction),/CALENDAR_ACTOR_INACTIVE/);
 await assert.rejects(loadCalendarAnalyticsCore(null,query,f.transaction),/CALENDAR_AUTH_REQUIRED/);assert.equal(f.reads(),0);
});
test('full selected set is aggregated without a display-row cap',async()=>{
 const f=fixture(),sample=f.rows[1];f.rows.splice(0,f.rows.length,...Array.from({length:501},(_,i)=>({...sample,id:String(i),plannedMinutes:1})));
 const result=await loadCalendarAnalyticsCore('own',query,f.transaction);assert.equal(result.entries.length,501);assert.equal(result.summary.total.hours.minutes,501);
 const empty=await loadCalendarAnalyticsCore('own',{from:'2026-12-01',to:'2026-12-02'},f.transaction);assert.equal(empty.summary.total.hours.minutes,0);assert.equal(empty.summary.total.completedCount,0);
});
}

// Источник: calendar-duration.test.ts
test('empty differs from zero; decimal hours round to one whole minute',()=>{
 assert.equal(parseCalendarHours(''),null);assert.equal(parseCalendarHours('  '),null);assert.equal(parseCalendarHours('0'),0);
 assert.equal(parseCalendarHours('1,5'),90);assert.equal(parseCalendarHours('1.25'),75);assert.equal(parseCalendarHours('0.01'),1);
 for(const bad of ['-1','abc','NaN','Infinity','1e3','1:30','999999999999'])assert.throws(()=>parseCalendarHours(bad));
 for(const minutes of [0,1,2,59,60,61,79,90,1440,100001,MAX_PLANNED_MINUTES])assert.equal(parseCalendarHours(calendarHoursInput(minutes)),minutes);
 assert.equal(formatPlannedMinutes(null),'Не указана');assert.equal(formatPlannedMinutes(0),'0 ч');assert.equal(formatPlannedMinutes(90),'1 ч 30 мин');
});
test('server accepts only nullable integer minutes and keeps omission for old update clients',()=>{
 const value={operation:'create',entryId:'ead6a6d9-5c2b-4158-981b-29f4fa44dd81',title:'Личный план',localDateTime:'2026-10-07T09:00'};
 for(const plannedMinutes of [null,0,1,90,MAX_PLANNED_MINUTES])assert.equal(calendarMutationSchema.safeParse({...value,plannedMinutes}).success,true);
 for(const plannedMinutes of [-1,1.5,'90',MAX_PLANNED_MINUTES+1])assert.equal(calendarMutationSchema.safeParse({...value,plannedMinutes}).success,false);
 const parsed=calendarMutationSchema.parse({...value,operation:'update',expectedRevision:0});assert.equal('plannedMinutes' in parsed,false);
});

{ // Источник: calendar-reminder-context.test.ts
const owner='own-test',namespace=`local:${randomUUID()}`;
const base={CALENDAR_REMINDER_ENVIRONMENT:'local',CALENDAR_REMINDER_NAMESPACE:namespace,CALENDAR_REMINDER_TEST_OWNER_IDS:JSON.stringify([owner]),CALENDAR_REMINDERS_ENABLED:'true',AUTH_URL:'http://localhost:3019',DATABASE_URL:'postgresql://test:test@127.0.0.1:5433/pero_crm',S3_BUCKET:''};
test('explicit context localnamespace and exact owners are mandatory; production imports never become local namespace',()=>{
 const context=resolveReminderContext(base,{platform:'win32',container:false});assert.ok(context);assert.equal(reminderOwnerAllowed(context,owner),true);assert.equal(reminderOwnerAllowed(context,'imported-user'),false);
 assert.equal(resolveReminderContext({}, {platform:'win32',container:false}),null);
 for(const changed of [{CALENDAR_REMINDER_NAMESPACE:'production'},{CALENDAR_REMINDER_TEST_OWNER_IDS:'[]'},{DATABASE_URL:'postgresql://test:test@prod:5433/pero_crm'},{AUTH_URL:'https://crm.peromebel.by'},{CALENDAR_REMINDER_TEST_OWNER_IDS:JSON.stringify([owner,owner])}])assert.throws(()=>resolveReminderContext({...base,...changed},{platform:'win32',container:false}));
});
test('staging is isolated by pinned origin bucket db and explicit owner namespace; disabled preserves context without enabling delivery',()=>{
 const staged={...base,CALENDAR_REMINDER_ENVIRONMENT:'staging',CALENDAR_REMINDER_NAMESPACE:`staging:${randomUUID()}`,AUTH_URL:'https://staging-crm.peromebel.by',DATABASE_URL:'postgresql://test:test@db:5432/crm',S3_BUCKET:'pero-crm-staging'};
 assert.equal(resolveReminderContext(staged,{platform:'linux',container:true})?.environment,'staging');assert.throws(()=>resolveReminderContext({...staged,S3_BUCKET:'pero-crm'},{platform:'linux',container:true}));
 const disabled=resolveReminderContext({...base,CALENDAR_REMINDERS_ENABLED:'false'},{platform:'win32',container:false});assert.ok(disabled&&!disabled.enabled);
});

test('dedicated staging origin works when both auth aliases are absent; empty aliases choose next nonempty',()=>{
 const stage={...base,CALENDAR_REMINDER_ENVIRONMENT:'staging',CALENDAR_REMINDER_NAMESPACE:`staging:${randomUUID()}`,AUTH_URL:undefined,DATABASE_URL:'postgresql://test:test@db:5432/crm',S3_BUCKET:'pero-crm-staging'};
 const runtime={platform:'linux',container:true};
 assert.equal(resolveReminderContext({...stage,CALENDAR_REMINDERS_PUBLIC_ORIGIN:'https://staging-crm.peromebel.by'},runtime)?.enabled,true);
 assert.equal(resolveReminderContext({...stage,CALENDAR_REMINDERS_PUBLIC_ORIGIN:' ',AUTH_URL:'',NEXTAUTH_URL:'https://staging-crm.peromebel.by'},runtime)?.environment,'staging');
});

test('explicit reminder origin remains guarded without auth-origin changes or unsafe fallback',()=>{
 const runtime={platform:'win32',container:false};
 for(const origin of ['https://crm.peromebel.by','http://user:pass@localhost:3019','http://localhost:3019/path','http://localhost:3019?x=1','http://localhost:3019#x']) assert.throws(()=>resolveReminderContext({...base,CALENDAR_REMINDERS_PUBLIC_ORIGIN:origin},runtime));
 assert.throws(()=>resolveReminderContext({...base,AUTH_URL:undefined,NEXTAUTH_URL:' ',CALENDAR_REMINDERS_PUBLIC_ORIGIN:''},runtime));
 const prod={CALENDAR_REMINDER_ENVIRONMENT:'production',CALENDAR_REMINDER_NAMESPACE:'production',CALENDAR_REMINDERS_ENABLED:'true',CALENDAR_REMINDERS_PUBLIC_ORIGIN:'https://crm.peromebel.by',DATABASE_URL:'postgresql://test:test@db:5432/crm',S3_BUCKET:'pero-crm'};
 assert.equal(resolveReminderContext(prod,{platform:'linux',container:true})?.environment,'production');
 assert.throws(()=>resolveReminderContext({...prod,S3_BUCKET:'pero-crm-staging'},{platform:'linux',container:true}));
});
}

{ // Источник: calendar-reminders.test.ts
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
}

// Источник: calendar-summary.test.ts
const row=(plannedMinutes:number|null,state:CalendarSummaryEntry['state']='PLANNED',startsAt='2026-10-07T06:00:00Z'):CalendarSummaryEntry=>({plannedMinutes,state,startsAt});
test('one calculation counts daily and whole-period planned/completed hours without cancellations',()=>{
 const report=summarizeCalendarEntries([row(90),row(60,'COMPLETED'),row(120,'CANCELLED'),row(null,'COMPLETED'),row(0),row(30,'PLANNED','2026-10-07T21:00:00Z')]);
 assert.equal(report.total.totalCount,6);assert.equal(report.total.plannedCount,3);assert.equal(report.total.completedCount,2);assert.equal(report.total.cancelledCount,1);
 assert.deepEqual(report.total.hours,{minutes:180,recordedCount:4,missingCount:1});
 assert.deepEqual(report.total.completedHours,{minutes:60,recordedCount:1,missingCount:1});
 assert.deepEqual(report.days.map(day=>[day.date,day.summary.hours.minutes]),[['2026-10-07',150],['2026-10-08',30]]);
});
test('missing, explicit zero and empty/cancelled periods remain distinct',()=>{
 assert.deepEqual(summarizeCalendarEntries([row(null)]).total.hours,{minutes:null,recordedCount:0,missingCount:1});
 assert.deepEqual(summarizeCalendarEntries([row(0),row(null)]).total.hours,{minutes:0,recordedCount:1,missingCount:1});
 assert.deepEqual(summarizeCalendarEntries([]).total.hours,{minutes:0,recordedCount:0,missingCount:0});
 assert.deepEqual(summarizeCalendarEntries([row(null,'CANCELLED')]).total.hours,{minutes:0,recordedCount:0,missingCount:0});
});
test('completion and reopening move only the completed subtotal; cancellation removes hours',()=>{
 assert.equal(summarizeCalendarEntries([row(75,'PLANNED')]).total.completedHours.minutes,0);
 assert.equal(summarizeCalendarEntries([row(75,'COMPLETED')]).total.completedHours.minutes,75);
 assert.equal(summarizeCalendarEntries([row(75,'CANCELLED')]).total.hours.minutes,0);
 assert.equal(summarizeCalendarEntries([row(75,'PLANNED')]).total.hours.minutes,75);
 assert.throws(()=>summarizeCalendarEntries([row(-1)]));assert.throws(()=>summarizeCalendarEntries([row(1.5)]));
});

// Источник: calendar-telegram-context.test.ts
const web:ReminderContext={environment:'local',namespace:'local:00000000-0000-4000-8000-000000000001',testOwnerIds:['own'],enabled:true};
const env={CALENDAR_TELEGRAM_ENABLED:'true',CALENDAR_TELEGRAM_SERVICE_TOKEN_ID:'accepted-service',CALENDAR_TELEGRAM_TEST_BOT_ID:'123',CALENDAR_TELEGRAM_TEST_RECIPIENTS:JSON.stringify([{ownerId:'own',chatId:'456'}])};
test('TG defaultoff/unconfigured cannot get query context; testownerchatbotservice are exact and linked to65namespace',()=>{
 assert.equal(resolveTelegramReminderContext({},web),null);const context=resolveTelegramReminderContext(env,web);assert.ok(context);assert.equal(telegramRecipientAllowed(context,'own','456'),true);assert.equal(telegramRecipientAllowed(context,'foreign','456'),false);assert.equal(telegramRecipientAllowed(context,'own','-456'),false);
 for(const changed of [{CALENDAR_TELEGRAM_TEST_BOT_ID:''},{CALENDAR_TELEGRAM_SERVICE_TOKEN_ID:''},{CALENDAR_TELEGRAM_TEST_RECIPIENTS:'[]'},{CALENDAR_TELEGRAM_TEST_RECIPIENTS:JSON.stringify([{ownerId:'foreign',chatId:'456'}])},{CALENDAR_TELEGRAM_TEST_RECIPIENTS:JSON.stringify([{ownerId:'own',chatId:'-456'}])}])assert.throws(()=>resolveTelegramReminderContext({...env,...changed},web));
 assert.throws(()=>resolveTelegramReminderContext(env,{...web,enabled:false}));
});

{ // Источник: calendar-telegram-core.test.ts
const namespace='local:00000000-0000-4000-8000-000000000001',now=new Date('2026-10-03T09:00Z');
const context:TelegramReminderContext={reminder:{environment:'local',namespace,testOwnerIds:['own'],enabled:true},botId:'123',serviceTokenId:'service',testRecipients:[{ownerId:'own',chatId:'456'}]};
type Row=Record<string,unknown>;
function fixture(){
 let state={facts:[{id:'fact',namespace,ownerId:'own',entryId:'entry',entryRevision:0,webState:'DELIVERED',confirmedAt:now,titleSnapshot:'Personal',startsAtSnapshot:now}],entry:{id:'entry',ownerId:'own',state:'PLANNED',revision:0,reminderNamespace:namespace,reminderOffsetMinutes:15},owner:{id:'own',active:true,roles:['ACCOUNTANT'],calendarEnabled:true},link:{id:'link',userId:'own',chatId:'456',linkedAt:now},preference:true,outboxes:[] as Row[]};let reads=0,tail=Promise.resolve();
 function match(row:Row,where:Row):boolean{return Object.entries(where).every(([key,value])=>key==='AND'?(value as Row[]).every(w=>match(row,w)):key==='OR'?(value as Row[]).some(w=>match(row,w)):value&&typeof value==='object'&&'lt' in value?row[key] instanceof Date&&(row[key] as Date)<(value as {lt:Date}).lt:row[key]===value);}
 function update(row:Row,data:Row){for(const [key,value] of Object.entries(data))row[key]=value&&typeof value==='object'&&'increment' in value?Number(row[key])+Number(value.increment):value;return row;}
 const tx={
 $queryRaw:async (query:{strings?:string[]}|string[])=>{reads++;const text=(Array.isArray(query)?query:query.strings??[]).join(' ');if(text.includes('SELECT f.id'))return state.facts.map(fact=>({id:fact.id}));if(text.includes('LIMIT 1 FOR UPDATE'))return state.outboxes.filter(row=>(row.state==='READY'||row.state==='RETRY'&&(row.retryAt as Date)<=now)&&Number(row.attempts)<3).slice(0,1).map(row=>({id:row.id}));return [];},
 calendarReminderFact:{findUnique:async({where}:{where:Row})=>{reads++;return state.facts.find(row=>row.id===where.id)??null;}},calendarEntry:{findUnique:async()=>state.entry},user:{findUnique:async()=>state.owner},telegramLink:{findUnique:async()=>state.link},notificationPreference:{findUnique:async()=>({enabled:state.preference})},
 telegramReminderOutbox:{createMany:async({data}:{data:Row})=>{if(state.outboxes.some(row=>row.namespace===data.namespace&&row.factId===data.factId))return {count:0};state.outboxes.push({id:'outbox',state:'READY',attempts:0,claimId:null,leaseExpiresAt:null,retryAt:null,retryAfterSeconds:null,...data});return {count:1};},findUnique:async({where}:{where:Row})=>state.outboxes.find(row=>match(row,where))??null,updateMany:async({where,data}:{where:Row;data:Row})=>{const rows=state.outboxes.filter(row=>match(row,where));rows.forEach(row=>update(row,data));return {count:rows.length};},update:async({where,data}:{where:Row;data:Row})=>update(state.outboxes.find(row=>row.id===where.id)!,data)},
 } as unknown as Prisma.TransactionClient;
 const transaction:CalendarTransaction=async operation=>{const old=tail;let release!:()=>void;tail=new Promise(resolve=>{release=resolve;});await old;const before=structuredClone(state);try{return await operation(tx);}catch(error){state=before;throw error;}finally{release();}};
 return {state:()=>state,transaction,reads:()=>reads};
}
const identity=(claim:{id:string;claimId:string})=>({namespace,botId:'123',id:claim.id,claimId:claim.claimId});
test('queue uses confirmed own fact once; claim/preflight gives a single grant; exact sent ACK is idempotent',async()=>{
 const f=fixture();assert.equal(await queueTelegramRemindersCore(context,now,f.transaction),1);assert.equal(await queueTelegramRemindersCore(context,now,f.transaction),0);
 const request={namespace,botId:'123',requestId:randomUUID()};const claimed=await claimTelegramReminderCore(context,request,now,f.transaction);assert.ok(claimed.ok&&claimed.claim);const c=claimed.claim;
 const repeated=await claimTelegramReminderCore(context,request,now,f.transaction);assert.ok(repeated.ok&&repeated.claim);assert.equal(repeated.claim.claimId,c.claimId);
 const allowed=await authorizeTelegramReminderCore(context,identity(c),now,f.transaction);assert.ok(allowed.ok);assert.equal((await authorizeTelegramReminderCore(context,identity(c),now,f.transaction)).ok,false);assert.equal(f.state().outboxes[0].attempts,1);
 assert.equal((await acknowledgeTelegramReminderCore(context,{...identity(c),outcome:'sent',messageId:'42'},now,f.transaction)).ok,true);assert.equal((await acknowledgeTelegramReminderCore(context,{...identity(c),outcome:'sent',messageId:'42'},now,f.transaction)).ok,true);assert.equal(f.state().outboxes[0].state,'SENT');assert.equal((await acknowledgeTelegramReminderCore(context,{...identity(c),outcome:'sent',messageId:'43'},now,f.transaction)).ok,false);
});
test('cancel/revision/flag/unlink/relink and testrecipient changes revoke preflight without redirecting snapshots',async()=>{
 for(const mode of ['cancel','revision','off','inactive','chat','link-id','linked-at']){
 const f=fixture();await queueTelegramRemindersCore(context,now,f.transaction);const claimed=await claimTelegramReminderCore(context,{namespace,botId:'123',requestId:randomUUID()},now,f.transaction);assert.ok(claimed.ok&&claimed.claim);
 if(mode==='cancel')f.state().entry.state='CANCELLED';if(mode==='revision')f.state().entry.revision=1;if(mode==='off')f.state().owner.calendarEnabled=false;if(mode==='inactive')f.state().owner.active=false;if(mode==='chat')f.state().link.chatId='999';if(mode==='link-id')f.state().link.id='relinked';if(mode==='linked-at')f.state().link.linkedAt=new Date(now.getTime()+1);
 assert.equal((await authorizeTelegramReminderCore(context,identity(claimed.claim),now,f.transaction)).ok,false,mode);assert.equal(f.state().outboxes[0].state,'CANCELLED',mode);assert.equal(f.state().outboxes[0].chatIdSnapshot,'456',mode);assert.equal(f.state().outboxes[0].attempts,0,mode);
 }
});
test('UNKNOWN send/expired SENDING never reclaims; CLAIMED expiry before grant safely resets',async()=>{
 for(const mode of ['ack-unknown','sending-expired','claimed-expired']){
 const f=fixture();await queueTelegramRemindersCore(context,now,f.transaction);const claimed=await claimTelegramReminderCore(context,{namespace,botId:'123',requestId:randomUUID()},now,f.transaction);assert.ok(claimed.ok&&claimed.claim);const c=claimed.claim;
 if(mode!=='claimed-expired'){assert.ok((await authorizeTelegramReminderCore(context,identity(c),now,f.transaction)).ok);if(mode==='ack-unknown')assert.ok((await acknowledgeTelegramReminderCore(context,{...identity(c),outcome:'unknown'},now,f.transaction)).ok);}
 const result=await claimTelegramReminderCore(context,{namespace,botId:'123',requestId:randomUUID()},new Date(now.getTime()+61000),f.transaction);
 if(mode==='claimed-expired'){assert.ok(result.ok&&result.claim);assert.notEqual(result.claim.claimId,c.claimId);assert.equal((await authorizeTelegramReminderCore(context,identity(c),now,f.transaction)).ok,false);}else{assert.ok(result.ok&&!result.claim);assert.equal(f.state().outboxes[0].state,'UNKNOWN');assert.equal(f.state().outboxes[0].attempts,1);}
 }
});
test('exact429 ACK bounded retry stops after3, stale namespace/bot/body rejected before reads',async()=>{
 const f=fixture();await queueTelegramRemindersCore(context,now,f.transaction);
 for(let attempt=0;attempt<3;attempt++){const claimed=await claimTelegramReminderCore(context,{namespace,botId:'123',requestId:randomUUID()},now,f.transaction);assert.ok(claimed.ok&&claimed.claim);assert.ok((await authorizeTelegramReminderCore(context,identity(claimed.claim),now,f.transaction)).ok);const ack={...identity(claimed.claim),outcome:'rate-limit',retryAfterSeconds:1};assert.ok((await acknowledgeTelegramReminderCore(context,ack,now,f.transaction)).ok);assert.ok((await acknowledgeTelegramReminderCore(context,ack,now,f.transaction)).ok);f.state().outboxes[0].retryAt=new Date(now.getTime()-1);}
 assert.equal(f.state().outboxes[0].state,'FAILED');assert.equal(f.state().outboxes[0].attempts,3);
 const negative=fixture();for(const input of [{namespace:'production',botId:'123',requestId:randomUUID()},{namespace,botId:'999',requestId:randomUUID()},{namespace,botId:'123',requestId:randomUUID(),ownerId:'foreign'}])assert.equal((await claimTelegramReminderCore(context,input,now,negative.transaction)).ok,false);assert.equal(negative.reads(),0);
});
}
