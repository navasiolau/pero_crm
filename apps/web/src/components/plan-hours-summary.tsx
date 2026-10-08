import {formatPlannedMinutes} from '@/lib/calendar-duration';
import type {CalendarPeriodSummary,CalendarDurationSummary} from '@/lib/calendar-summary';
function Hours({label,value}:{label:string;value:CalendarDurationSummary}){
 return <div><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{value.minutes===null?'Часы не указаны':formatPlannedMinutes(value.minutes)}</dd>{value.missingCount>0?<p className="mt-1 text-xs text-muted-foreground">Без длительности: {value.missingCount}</p>:null}</div>;
}
export function PlanHoursSummary({title,summary}:{title:string;summary:CalendarPeriodSummary}){
 return <section aria-label={title} className="rounded-lg border bg-muted/20 p-3">
  <h2 className="mb-3 font-semibold">{title}</h2>
  <dl className="grid gap-4 sm:grid-cols-2"><Hours label={summary.hours.missingCount?'Указанные плановые часы':'Плановые часы'} value={summary.hours}/><Hours label="Плановые часы выполненных записей" value={summary.completedHours}/></dl>
  <p className="mt-3 text-xs text-muted-foreground">Выполнено: {summary.completedCount} · Запланировано: {summary.plannedCount} · Отменено: {summary.cancelledCount}</p>
 </section>;
}
