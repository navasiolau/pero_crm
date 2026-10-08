import assert from 'node:assert/strict';import test from 'node:test';
import {summarizeCalendarEntries,type CalendarSummaryEntry} from '../src/lib/calendar-summary';
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
