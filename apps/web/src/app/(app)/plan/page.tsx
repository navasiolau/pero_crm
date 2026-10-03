import {requireCalendarActor} from '@/server/calendar/access';
import {loadCalendarMonth} from '@/server/calendar/actions';
import {calendarLocalValue} from '@/lib/calendar-dates';
import {PersonalCalendar} from './personal-calendar';
export const dynamic='force-dynamic';
export default async function PlanPage(){
 await requireCalendarActor();
 const date=calendarLocalValue(new Date()).slice(0,10),month=date.slice(0,7);
 return <PersonalCalendar initialMonth={month} initialDate={date} initialEntries={await loadCalendarMonth(month)}/>;
}
