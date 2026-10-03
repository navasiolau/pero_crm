import assert from 'node:assert/strict';
import test from 'node:test';
import {parseCalendarDateTime,calendarLocalValue,calendarMonthRange,calendarMonthDays} from '../src/lib/calendar-dates';
test('Moscow date/time roundtrip and month boundary are UTC-explicit independently of process timezone',()=>{
 const date=parseCalendarDateTime('2026-10-03T00:05');assert.equal(date.toISOString(),'2026-10-02T21:05:00.000Z');assert.equal(calendarLocalValue(date),'2026-10-03T00:05');
 const range=calendarMonthRange('2026-10');assert.equal(range.start.toISOString(),'2026-09-30T21:00:00.000Z');assert.equal(range.end.toISOString(),'2026-10-31T21:00:00.000Z');
 const old=process.env.TZ;try{process.env.TZ='America/Los_Angeles';assert.equal(calendarLocalValue(date),'2026-10-03T00:05');assert.equal(calendarMonthDays('2026-10').filter(day=>day.inMonth).length,31);}finally{if(old===undefined)delete process.env.TZ;else process.env.TZ=old;}
});
test('date validation rejects rollovers, malformed times and ambiguous/nonexistent Moscow historical hours',()=>{
 for(const value of ['2026-02-29T12:00','2026-04-31T10:00','2026-10-03T24:00','2026-10-03T12:60','2026-10-03','2026-10-03T12:00Z','2010-03-28T02:30','2010-10-31T02:30'])assert.throws(()=>parseCalendarDateTime(value),value);
 assert.equal(calendarLocalValue(parseCalendarDateTime('2028-02-29T23:59')),'2028-02-29T23:59');
 assert.throws(()=>calendarMonthRange('2026-13'));
});
