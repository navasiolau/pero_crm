"use client";
import {useMemo,useState,useTransition} from 'react';
import Link from 'next/link';
import {BarChart3,ChevronLeft,ChevronRight,Plus} from 'lucide-react';
import {Button,buttonVariants} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Label} from '@/components/ui/label';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
import {createRequestId} from '@/lib/request-id';
import {CALENDAR_TIMEZONE,calendarLocalValue,calendarMonthDays,calendarDisplay} from '@/lib/calendar-dates';
import {parseCalendarHours,calendarHoursInput,formatPlannedMinutes} from '@/lib/calendar-duration';
import {summarizeCalendarEntries,emptyCalendarPeriod} from '@/lib/calendar-summary';
import {PlanHoursSummary} from '@/components/plan-hours-summary';
import {calendarStateLabels as stateLabels} from '@/lib/calendar-status';
import {loadCalendarMonth,mutateCalendar} from '@/server/calendar/actions';
import type {CalendarEntryView} from '@/server/calendar/core';
import type {CalendarMutation} from '@/server/calendar/contracts';
const reminderLabels:Record<string,string>={none:'Без напоминания','0':'В момент события','15':'За 15 минут','60':'За час','1440':'За сутки'};
function monthLabel(month:string){return new Intl.DateTimeFormat('ru-RU',{timeZone:CALENDAR_TIMEZONE,month:'long',year:'numeric'}).format(new Date(`${month}-15T12:00:00Z`));}
function shiftMonth(month:string,delta:number){const [y,m]=month.split('-').map(Number);return new Date(Date.UTC(y,m-1+delta,15)).toISOString().slice(0,7);}
type Editor={id:string;revision:number|null;title:string;description:string;localDateTime:string;reminder:string;hours:string};
export function PersonalCalendar({initialMonth,initialDate,initialEntries}:{initialMonth:string;initialDate:string;initialEntries:CalendarEntryView[]}){
 const [month,setMonth]=useState(initialMonth),[selectedDate,setSelectedDate]=useState(initialDate),[entries,setEntries]=useState(initialEntries);
 const [editor,setEditor]=useState<Editor|null>(null),[error,setError]=useState(''),[pending,startTransition]=useTransition();
 const days=calendarMonthDays(month),agenda=entries.filter(entry=>calendarLocalValue(entry.startsAt).slice(0,10)===selectedDate);
 const summary=useMemo(()=>summarizeCalendarEntries(entries),[entries]);
 const daySummary=summary.days.find(day=>day.date===selectedDate)?.summary??emptyCalendarPeriod();
 const run=(operation:()=>Promise<void>)=>startTransition(async()=>{setError('');try{await operation();}catch{setError('Не удалось подтвердить действие. Повторите сохранение прежних данных.');}});
 async function navigate(delta:number){const next=shiftMonth(month,delta);const list=await loadCalendarMonth(next);setEntries(list);setMonth(next);setSelectedDate(`${next}-01`);}
 function accept(entry:CalendarEntryView){setEntries(current=>[...current.filter(row=>row.id!==entry.id),entry].filter(row=>calendarLocalValue(row.startsAt).startsWith(month)).sort((a,b)=>a.startsAt.localeCompare(b.startsAt)||a.id.localeCompare(b.id)));}
 function openCreate(){setError('');setEditor({id:createRequestId(),revision:null,title:'',description:'',localDateTime:`${selectedDate}T09:00`,reminder:'15',hours:''});}
 function openEdit(entry:CalendarEntryView){setError('');setEditor({id:entry.id,revision:entry.revision,title:entry.title,description:entry.description,localDateTime:calendarLocalValue(entry.startsAt),reminder:entry.reminderOffsetMinutes===null?'none':String(entry.reminderOffsetMinutes),hours:calendarHoursInput(entry.plannedMinutes)});}
 async function save(){
 if(!editor)return;
 let plannedMinutes:number|null;try{plannedMinutes=parseCalendarHours(editor.hours);}catch(error){setError(error instanceof Error?error.message:'Проверьте длительность');return;}
 const fields={entryId:editor.id,title:editor.title,description:editor.description,localDateTime:editor.localDateTime,plannedMinutes,reminderOffsetMinutes:editor.reminder==='none'?null:Number(editor.reminder)};
 const input:CalendarMutation=editor.revision===null?{operation:'create',...fields}:{operation:'update',expectedRevision:editor.revision,...fields};
 const result=await mutateCalendar(input);
 if(!result.ok){setError(result.error);if(result.kind==='conflict')setEntries(await loadCalendarMonth(month));return;}
 accept(result.entry);setEditor(null);
 }
 async function changeState(entry:CalendarEntryView,state:CalendarEntryView['state']){
 const result=await mutateCalendar({operation:'state',entryId:entry.id,expectedRevision:entry.revision,state});
 if(!result.ok){setError(result.error);if(result.kind==='conflict')setEntries(await loadCalendarMonth(month));return;}accept(result.entry);
 }
 return <section className="min-w-0 space-y-4" aria-labelledby="personal-plan-title">
 <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 id="personal-plan-title" className="text-xl font-semibold">План</h1><p className="text-sm text-muted-foreground">Личный календарь · {CALENDAR_TIMEZONE}</p></div><div className="flex flex-wrap gap-2"><Link className={buttonVariants({variant:'outline'})} href={`/plan/analytics?from=${month}-01&to=${days.filter(day=>day.inMonth).at(-1)!.date}`}><BarChart3 className="size-4"/>Аналитика</Link><Button disabled={pending} onClick={openCreate}><Plus className="size-4"/>Добавить запись</Button></div></div>
 {error&&!editor?<p role="alert" className="text-sm text-destructive">{error}</p>:null}
 <PlanHoursSummary title="Часы за месяц" summary={summary.total}/>
 <p className="text-xs text-muted-foreground">Плановые часы по дате записи. Отменённые записи в часы не входят.</p>
 <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
 <div className="min-w-0 rounded-lg border p-3"><div className="mb-3 flex items-center justify-between gap-2"><Button variant="ghost" size="icon" disabled={pending||month==='2000-01'} aria-label="Предыдущий месяц" onClick={()=>run(()=>navigate(-1))}><ChevronLeft/></Button><h2 className="text-center font-semibold capitalize" aria-live="polite">{monthLabel(month)}</h2><Button variant="ghost" size="icon" disabled={pending||month==='2099-12'} aria-label="Следующий месяц" onClick={()=>run(()=>navigate(1))}><ChevronRight/></Button></div>
 <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">{['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(day=><span key={day}>{day}</span>)}</div>
 <div className="mt-1 grid grid-cols-7 gap-1" aria-label="Дни месяца">{days.map(day=>{const count=entries.filter(row=>calendarLocalValue(row.startsAt).slice(0,10)===day.date).length;return <button key={day.date} type="button" disabled={!day.inMonth||pending} aria-pressed={day.date===selectedDate} aria-label={`${day.date}, записей: ${count}`} onClick={()=>setSelectedDate(day.date)} className={`flex min-h-12 min-w-0 flex-col items-center justify-center rounded-md border text-sm focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-30 ${day.date===selectedDate?'border-primary bg-primary/10':'border-transparent hover:bg-muted'}`}><span>{Number(day.date.slice(-2))}</span>{count?<span className="text-xs font-medium text-primary">{count}</span>:<span className="h-4"/>}</button>;})}</div></div>
 <div className="min-w-0 space-y-3" aria-label="Дневная повестка"><PlanHoursSummary title="Часы за день" summary={daySummary}/><h2 className="font-semibold">{new Intl.DateTimeFormat('ru-RU',{timeZone:CALENDAR_TIMEZONE,dateStyle:'long'}).format(new Date(`${selectedDate}T12:00:00Z`))}</h2>{agenda.length===0?<p className="text-sm text-muted-foreground">На этот день записей нет.</p>:agenda.map(entry=><article key={entry.id} className="min-w-0 rounded-lg border p-3" data-calendar-entry-id={entry.id}><div className="flex flex-wrap items-start justify-between gap-2"><h3 className="min-w-0 break-words font-medium">{entry.title}</h3><span className="text-xs text-muted-foreground">{stateLabels[entry.state]}</span></div><p className="mt-1 text-sm text-muted-foreground">{calendarDisplay(entry.startsAt)}</p>{entry.description?<p className="mt-2 whitespace-pre-wrap break-words text-sm">{entry.description}</p>:null}<p className="mt-2 text-sm text-muted-foreground">Плановая длительность: {formatPlannedMinutes(entry.plannedMinutes)}</p><p className="mt-2 text-xs text-muted-foreground">{reminderLabels[entry.reminderOffsetMinutes===null?'none':String(entry.reminderOffsetMinutes)]}</p><div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={pending} onClick={()=>openEdit(entry)}>Изменить</Button>{entry.state==='PLANNED'?<><Button variant="outline" size="sm" disabled={pending} onClick={()=>run(()=>changeState(entry,'COMPLETED'))}>Выполнить</Button><Button variant="ghost" size="sm" disabled={pending} onClick={()=>run(()=>changeState(entry,'CANCELLED'))}>Отменить запись</Button></>:<Button variant="outline" size="sm" disabled={pending} onClick={()=>run(()=>changeState(entry,'PLANNED'))}>Вернуть в план</Button>}</div></article>)}</div>
 </div>
 <Dialog open={editor!==null} onOpenChange={open=>{if(!open&&!pending)setEditor(null);}}><DialogContent><DialogHeader><DialogTitle>{editor?.revision===null?'Новая запись':'Изменить запись'}</DialogTitle><DialogDescription>Время указано в {CALENDAR_TIMEZONE}. Запись видна только вам.</DialogDescription></DialogHeader>{editor?<form className="min-w-0 space-y-3" onSubmit={event=>{event.preventDefault();run(save);}}><div className="space-y-1"><Label htmlFor="plan-entry-title">Название</Label><Input id="plan-entry-title" required maxLength={250} disabled={pending} value={editor.title} onChange={event=>setEditor({...editor,title:event.target.value})}/></div><div className="space-y-1"><Label htmlFor="plan-entry-description">Описание</Label><Textarea id="plan-entry-description" maxLength={10000} disabled={pending} value={editor.description} onChange={event=>setEditor({...editor,description:event.target.value})}/></div><div className="space-y-1"><Label htmlFor="plan-entry-date">Дата и время ({CALENDAR_TIMEZONE})</Label><Input id="plan-entry-date" type="datetime-local" required min="2000-01-01T00:00" max="2099-12-31T23:59" disabled={pending} value={editor.localDateTime} onChange={event=>setEditor({...editor,localDateTime:event.target.value})}/></div><div className="space-y-1"><Label htmlFor="plan-entry-hours">Количество часов</Label><Input id="plan-entry-hours" inputMode="decimal" placeholder="Например, 1,5" disabled={pending} value={editor.hours} onChange={event=>setEditor({...editor,hours:event.target.value})} aria-describedby="plan-entry-hours-hint"/><p id="plan-entry-hours-hint" className="text-xs text-muted-foreground">Плановая длительность, необязательно. Дробные часы округляются до минуты.</p></div><div className="space-y-1"><Label htmlFor="plan-entry-reminder">Напоминание</Label><Select value={editor.reminder} disabled={pending} onValueChange={value=>setEditor({...editor,reminder:value??'none'})}><SelectTrigger id="plan-entry-reminder"><SelectValue>{reminderLabels[editor.reminder]}</SelectValue></SelectTrigger><SelectContent>{Object.entries(reminderLabels).map(([value,label])=><SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><p className="text-xs text-muted-foreground">Web-напоминание появится в уведомлениях, если личный план включён.</p></div>{error?<p role="alert" className="text-sm text-destructive">{error}</p>:null}<div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" disabled={pending} onClick={()=>setEditor(null)}>Закрыть</Button><Button type="submit" disabled={pending}>Сохранить</Button></div></form>:null}</DialogContent></Dialog>
 </section>;
}
