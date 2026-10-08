import assert from 'node:assert/strict';import test from 'node:test';import type {Prisma,CalendarEntry} from '@prisma/client';
import {loadCalendarAnalyticsCore} from '../src/server/calendar/analytics';
import {listCalendarMonthCore} from '../src/server/calendar/core';
import {summarizeCalendarEntries} from '../src/lib/calendar-summary';
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
