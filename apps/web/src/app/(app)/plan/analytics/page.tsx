import {requireCalendarActor} from '@/server/calendar/access';
import {loadCalendarAnalytics} from '@/server/calendar/actions';
import {parseCalendarAnalyticsQuery} from '@/server/calendar/contracts';
import {calendarLocalValue} from '@/lib/calendar-dates';
import {PlanAnalyticsView} from '@/components/plan-analytics-view';
export const dynamic='force-dynamic';
export default async function PlanAnalyticsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 await requireCalendarActor();
 const params=await searchParams,today=calendarLocalValue(new Date()).slice(0,10);
 const query={from:typeof params.from==='string'?params.from:today.slice(0,7)+'-01',to:typeof params.to==='string'?params.to:today};
 try{parseCalendarAnalyticsQuery(query);}catch{return <PlanAnalyticsView query={query} error="Укажите корректный период: начальная дата не должна быть позже конечной."/>;}
 return <PlanAnalyticsView query={query} report={await loadCalendarAnalytics(query)}/>;
}
