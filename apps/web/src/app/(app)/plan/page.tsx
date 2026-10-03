import {requireCalendarActor} from '@/server/calendar/access';
export const dynamic='force-dynamic';
export default async function PlanPage(){
 await requireCalendarActor();
 return <section aria-labelledby="plan-title"><h1 id="plan-title" className="text-xl font-semibold">План</h1><p className="mt-2 text-sm text-muted-foreground">Личный план включён. Календарь появится в следующем обновлении.</p></section>;
}
