import assert from 'node:assert/strict';
import test from 'node:test';
import {parseCalendarHours,calendarHoursInput,formatPlannedMinutes,MAX_PLANNED_MINUTES} from '../src/lib/calendar-duration';
import {calendarMutationSchema} from '../src/server/calendar/contracts';
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
