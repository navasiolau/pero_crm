"use client";
import {useState} from 'react';
import Link from 'next/link';
import {Button,buttonVariants} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Badge} from '@/components/ui/badge';
import {DataTable,type DataColumn} from '@/components/ui/data-table';
import {PlanHoursSummary} from '@/components/plan-hours-summary';
import {calendarLocalValue,calendarDisplay} from '@/lib/calendar-dates';
import {calendarStateLabels} from '@/lib/calendar-status';
import {formatPlannedMinutes} from '@/lib/calendar-duration';
import {formatDate} from '@/lib/format';
import type {CalendarDurationSummary} from '@/lib/calendar-summary';
import type {CalendarEntryView} from '@/server/calendar/core';
import type {CalendarAnalytics} from '@/server/calendar/analytics';
import type {CalendarAnalyticsQuery} from '@/server/calendar/contracts';

function Duration({value}:{value:CalendarDurationSummary}){
 return <div className="tabular-nums"><span>{value.minutes===null?'Часы не указаны':formatPlannedMinutes(value.minutes)}</span>{value.missingCount>0?<p className="text-xs text-muted-foreground">Без длительности: {value.missingCount}</p>:null}</div>;
}
export function PlanAnalyticsView({query,report,error}:{query:CalendarAnalyticsQuery;report?:CalendarAnalytics;error?:string}){
 const [view,setView]=useState<'days'|'entries'>('days'),[state,setState]=useState('ALL');
 const days=report?.summary.days.map(day=>({id:day.date,...day}))??[];
 const maxMinutes=days.reduce((max,day)=>Math.max(max,day.summary.hours.minutes??0),0);
 type Day=typeof days[number];
 const dayColumns:DataColumn<Day>[]=[
  {id:'date',header:'Дата в плане',sortable:true,sortValue:row=>row.date,searchValue:row=>formatDate(row.date),cell:row=><Link href={`/plan?date=${row.date}`} className="font-medium hover:underline">{formatDate(row.date)}</Link>},
  {id:'hours',header:'Плановые часы',sortable:true,sortValue:row=>row.summary.hours.minutes??-1,cell:row=><div className="min-w-28 space-y-1"><Duration value={row.summary.hours}/><div aria-hidden="true" className="h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-primary/60" style={{width:`${maxMinutes?(row.summary.hours.minutes??0)/maxMinutes*100:0}%`}}/></div></div>},
  {id:'completedHours',header:'Часы выполненных',sortable:true,sortValue:row=>row.summary.completedHours.minutes??-1,cell:row=><Duration value={row.summary.completedHours}/>},
  {id:'completed',header:'Выполнено',sortable:true,sortValue:row=>row.summary.completedCount,cell:row=>row.summary.completedCount},
  {id:'planned',header:'Запланировано',sortable:true,sortValue:row=>row.summary.plannedCount,cell:row=>row.summary.plannedCount},
  {id:'cancelled',header:'Отменено',sortable:true,sortValue:row=>row.summary.cancelledCount,cell:row=>row.summary.cancelledCount},
 ];
 const entryColumns:DataColumn<CalendarEntryView>[]=[
  {id:'date',header:'Дата в плане',sortable:true,sortValue:row=>row.startsAt,cell:row=><Link href={`/plan?date=${calendarLocalValue(row.startsAt).slice(0,10)}`} className="hover:underline">{calendarDisplay(row.startsAt)}</Link>},
  {id:'title',header:'Запись',sortable:true,sortValue:row=>row.title,searchValue:row=>row.title+' '+row.description,cell:row=><div className="max-w-lg break-words"><p className="font-medium">{row.title}</p>{row.description?<p className="line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">{row.description}</p>:null}</div>},
  {id:'state',header:'Статус',sortable:true,sortValue:row=>calendarStateLabels[row.state],searchValue:row=>calendarStateLabels[row.state],cell:row=><Badge variant="outline">{calendarStateLabels[row.state]}</Badge>},
  {id:'duration',header:'Плановая длительность',sortable:true,sortValue:row=>row.plannedMinutes??-1,cell:row=><div className="tabular-nums">{formatPlannedMinutes(row.plannedMinutes)}{row.state==='CANCELLED'?<p className="text-xs text-muted-foreground">В итог часов не входит</p>:null}</div>},
 ];
 const entries=(report?.entries??[]).filter(entry=>state==='ALL'||entry.state===state);
 return <div className="flex min-w-0 flex-col gap-5">
  <div><Link href="/plan" className="text-sm text-muted-foreground hover:underline">К личному плану</Link><h1 className="mt-2 text-2xl font-semibold">Аналитика плана</h1><p className="text-sm text-muted-foreground">Ваши записи и плановые часы по дате в плане. Europe/Moscow.</p></div>
  <form method="get" action="/plan/analytics" className="flex flex-wrap items-end gap-3 rounded-xl border p-4">
   <div><Label htmlFor="plan-analytics-from">С даты</Label><Input id="plan-analytics-from" name="from" type="date" defaultValue={query.from} required className="mt-1"/></div>
   <div><Label htmlFor="plan-analytics-to">По дату включительно</Label><Input id="plan-analytics-to" name="to" type="date" defaultValue={query.to} required className="mt-1"/></div>
   <Button type="submit">Показать</Button>
  </form>
  {error?<p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{error}</p>:null}
  {report?<>
   <PlanHoursSummary title="Итоги периода" summary={report.summary.total}/>
   <p className="text-sm text-muted-foreground">Отменённые записи исключены из часов. Часы выполненных записей — их плановая длительность.</p>
   <div className="flex flex-wrap gap-2" aria-label="Представление аналитики"><Button variant={view==='days'?'default':'outline'} aria-pressed={view==='days'} onClick={()=>setView('days')}>По дням</Button><Button variant={view==='entries'?'default':'outline'} aria-pressed={view==='entries'} onClick={()=>setView('entries')}>Записи ({report.entries.length})</Button></div>
   {view==='days'?<section aria-label="Дневная статистика"><DataTable columns={dayColumns} rows={days} searchPlaceholder="Поиск по датам…" emptyText="Записей в выбранном периоде нет" defaultPageSize={10}
    renderMobileCard={row=><div className="space-y-3"><Link href={`/plan?date=${row.date}`} className="font-semibold hover:underline">{formatDate(row.date)}</Link><dl className="grid grid-cols-2 gap-3 text-sm"><div><dt className="text-muted-foreground">Плановые часы</dt><dd><Duration value={row.summary.hours}/></dd></div><div><dt className="text-muted-foreground">Часы выполненных</dt><dd><Duration value={row.summary.completedHours}/></dd></div></dl><p className="text-xs text-muted-foreground">Выполнено: {row.summary.completedCount} · Запланировано: {row.summary.plannedCount} · Отменено: {row.summary.cancelledCount}</p></div>}/></section>
   :<section className="space-y-3" aria-label="Записи периода"><div className="flex flex-wrap items-center gap-2"><Label htmlFor="plan-analytics-state">Статус</Label><select id="plan-analytics-state" className="h-9 rounded-md border bg-background px-3 text-sm" value={state} onChange={event=>setState(event.target.value)}><option value="ALL">Все статусы</option>{Object.entries(calendarStateLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div>
    <DataTable columns={entryColumns} rows={entries} searchPlaceholder="Поиск по записям…" emptyText="Подходящих записей нет" defaultPageSize={10}
     renderMobileCard={row=><div className="space-y-2"><div className="flex flex-wrap items-start justify-between gap-2"><b className="break-words">{row.title}</b><Badge variant="outline">{calendarStateLabels[row.state]}</Badge></div><p className="text-xs text-muted-foreground">{calendarDisplay(row.startsAt)}</p>{row.description?<p className="line-clamp-3 whitespace-pre-wrap break-words text-sm">{row.description}</p>:null}<p className="text-sm">Плановая длительность: {formatPlannedMinutes(row.plannedMinutes)}{row.state==='CANCELLED'?' · в итог часов не входит':''}</p><Link className={buttonVariants({variant:'outline',size:'sm'})} href={`/plan?date=${calendarLocalValue(row.startsAt).slice(0,10)}`}>Открыть день в плане</Link></div>}/>
   </section>}
   <p className="text-xs text-muted-foreground">Поиск и фильтр меняют список. Итоги рассчитаны по всему выбранному периоду.</p>
  </>:null}
 </div>;
}
