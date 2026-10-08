import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import type {Prisma,CalendarEntry,Role} from '@prisma/client';
import {listCalendarMonthCore,mutateCalendarCore,type CalendarTransaction} from '../src/server/calendar/core';
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
