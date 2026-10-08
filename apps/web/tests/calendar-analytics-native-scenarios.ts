import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import type {PrismaClient} from '@prisma/client';
import {loadCalendarAnalyticsCore} from '../src/server/calendar/analytics';import {listCalendarMonthCore} from '../src/server/calendar/core';import {summarizeCalendarEntries} from '../src/lib/calendar-summary';
import {calendarBaseline} from './helpers/calendar-acceptance';import {createCalendarAnalyticsFixture,analyticsRange} from './helpers/calendar-analytics-fixture';
export async function runCalendarAnalyticsNative(db:PrismaClient){
 const before=await calendarBaseline(db),rollback=new Error('QA108_ROLLBACK');let verified=false;
 try{await db.$transaction(async tx=>{
  const f=await createCalendarAnalyticsFixture(tx,'qa108-'+randomUUID()),transaction=<T>(op:(db:typeof tx)=>Promise<T>)=>op(tx);
  const result=await loadCalendarAnalyticsCore(f.own.id,analyticsRange,transaction);
  assert.equal(result.entries.length,7);assert.equal(result.summary.total.hours.minutes,210);assert.equal(result.summary.total.completedCount,3);assert.equal(result.summary.total.completedHours.minutes,105);assert.equal(result.summary.total.hours.missingCount,1);
  assert.deepEqual(result.summary.days.map(day=>[day.date,day.summary.hours.minutes]),[['2026-10-07',165],['2026-10-08',45]]);
  for(const secret of ['BEFORE_QA108_SECRET','AFTER_QA108_SECRET','FOREIGN_QA107_SECRET'])assert.ok(!JSON.stringify(result).includes(secret));
  assert.equal((await loadCalendarAnalyticsCore(f.other.id,analyticsRange,transaction)).summary.total.hours.minutes,9999);
  await assert.rejects(loadCalendarAnalyticsCore(f.own.id,{...analyticsRange,ownerId:f.other.id},transaction));
  const month=await loadCalendarAnalyticsCore(f.own.id,{from:'2026-10-01',to:'2026-10-31'},transaction);assert.deepEqual(month.summary,summarizeCalendarEntries(await listCalendarMonthCore(f.own.id,'2026-10',transaction)));
  const empty=await loadCalendarAnalyticsCore(f.own.id,{from:'2026-12-01',to:'2026-12-02'},transaction);assert.equal(empty.summary.total.hours.minutes,0);assert.equal(empty.entries.length,0);
  await tx.user.update({where:{id:f.own.id},data:{calendarEnabled:false}});
  await assert.rejects(loadCalendarAnalyticsCore(f.own.id,analyticsRange,transaction),/CALENDAR_DISABLED/);
  verified=true;throw rollback;
 },{timeout:15000});}catch(error){if(error!==rollback)throw error;}
 assert.ok(verified);assert.deepEqual(await calendarBaseline(db),before);
 return {status:'PASS',minutes:210,completedMinutes:105,completedCount:3,days:[165,45],month:'SAME_AGGREGATOR',bounds:'INCLUSIVE_MSK_PLAN_DATE',privacy:'OWNER_ADMIN_DISABLED',originalData:'MATCH',qaRows:'ROLLED_BACK',providerMessages:0};
}
