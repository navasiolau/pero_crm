import {summarizeCalendarEntries} from '@/lib/calendar-summary';
import {listCalendarIntervalCore,type CalendarTransaction} from './core';
import {parseCalendarAnalyticsQuery} from './contracts';
export async function loadCalendarAnalyticsCore(actorId:string|null,input:unknown,transaction:CalendarTransaction){
 const {query,range}=parseCalendarAnalyticsQuery(input);
 const entries=await listCalendarIntervalCore(actorId,range,transaction);
 return {query,entries,summary:summarizeCalendarEntries(entries)};
}
export type CalendarAnalytics=Awaited<ReturnType<typeof loadCalendarAnalyticsCore>>;
