import {calendarLocalValue} from './calendar-dates';
import type {CalendarEntryView} from '@/server/calendar/core';
export type CalendarSummaryEntry=Pick<CalendarEntryView,'startsAt'|'state'|'plannedMinutes'>;
export type CalendarDurationSummary={minutes:number|null;recordedCount:number;missingCount:number};
export type CalendarPeriodSummary={totalCount:number;plannedCount:number;completedCount:number;cancelledCount:number;hours:CalendarDurationSummary;completedHours:CalendarDurationSummary};
const duration=()=>({minutes:0,recordedCount:0,missingCount:0});
const bucket=()=>({totalCount:0,plannedCount:0,completedCount:0,cancelledCount:0,hours:duration(),completedHours:duration()});
type Bucket=ReturnType<typeof bucket>;
function addDuration(total:ReturnType<typeof duration>,minutes:number|null){
 if(minutes===null){total.missingCount++;return;}
 if(!Number.isSafeInteger(minutes)||minutes<0||!Number.isSafeInteger(total.minutes+minutes))throw Error('Некорректная плановая длительность');
 total.minutes+=minutes;total.recordedCount++;
}
function add(total:Bucket,entry:CalendarSummaryEntry){
 total.totalCount++;
 if(entry.state==='CANCELLED'){total.cancelledCount++;return;}
 addDuration(total.hours,entry.plannedMinutes);
 if(entry.state==='COMPLETED'){total.completedCount++;addDuration(total.completedHours,entry.plannedMinutes);}
 else total.plannedCount++;
}
function finish(total:Bucket):CalendarPeriodSummary{
 const finishDuration=(value:ReturnType<typeof duration>):CalendarDurationSummary=>({...value,minutes:value.recordedCount===0&&value.missingCount>0?null:value.minutes});
 return {...total,hours:finishDuration(total.hours),completedHours:finishDuration(total.completedHours)};
}
export function emptyCalendarPeriod():CalendarPeriodSummary{return finish(bucket());}
/** One calculation serves the personal calendar and date-range analytics. */
export function summarizeCalendarEntries(entries:readonly CalendarSummaryEntry[]){
 const total=bucket(),days=new Map<string,Bucket>();
 for(const entry of entries){
  const date=calendarLocalValue(entry.startsAt).slice(0,10),day=days.get(date)??bucket();
  add(total,entry);add(day,entry);days.set(date,day);
 }
 return {total:finish(total),days:[...days].sort(([a],[b])=>a.localeCompare(b)).map(([date,day])=>({date,summary:finish(day)}))};
}
