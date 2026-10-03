import {requireCalendarActor} from '@/server/calendar/access';
import {loadCalendarMonth} from '@/server/calendar/actions';
import {calendarLocalValue,parseCalendarDateTime} from '@/lib/calendar-dates';
import {PersonalCalendar} from './personal-calendar';
export const dynamic='force-dynamic';
export default async function PlanPage({searchParams}:{searchParams:Promise<{date?:string}>}){
 await requireCalendarActor();
 const query=await searchParams;let date=calendarLocalValue(new Date()).slice(0,10);
 if(query.date){try{date=calendarLocalValue(parseCalendarDateTime(`${query.date}T12:00`)).slice(0,10);}catch{/* Некорректный hint не меняет actor scope. */}}
 const month=date.slice(0,7);
 return <PersonalCalendar initialMonth={month} initialDate={date} initialEntries={await loadCalendarMonth(month)}/>;
}
