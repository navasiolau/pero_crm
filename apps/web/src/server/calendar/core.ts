import {reminderOwnerAllowed,type ReminderContext} from "@/lib/calendar-reminder-context";
import type {CalendarEntry,Prisma} from '@prisma/client';
import {resolveCalendarActor} from '@/lib/calendar-access';
import {parseCalendarDateTime,calendarMonthRange} from '@/lib/calendar-dates';
import {calendarMutationSchema} from './contracts';
export type CalendarTransaction=<T>(operation:(tx:Prisma.TransactionClient)=>Promise<T>)=>Promise<T>;
export type CalendarEntryView={id:string;title:string;description:string;startsAt:string;state:CalendarEntry['state'];reminderOffsetMinutes:number|null;revision:number};
export const calendarEntryView=(row:CalendarEntry):CalendarEntryView=>({id:row.id,title:row.title,description:row.description,startsAt:row.startsAt.toISOString(),state:row.state,reminderOffsetMinutes:row.reminderOffsetMinutes,revision:row.revision});
export type CalendarMutationResult={ok:true;entry:CalendarEntryView;repeated:boolean}|{ok:false;kind:'conflict'|'failure';code:string;error:string};
async function actorInTransaction(actorId:string|null,tx:Prisma.TransactionClient){return resolveCalendarActor(actorId,id=>tx.user.findUnique({where:{id},select:{id:true,active:true,roles:true,calendarEnabled:true}}));}
export async function listCalendarMonthCore(actorId:string|null,month:string,transaction:CalendarTransaction):Promise<CalendarEntryView[]>{
 const range=calendarMonthRange(month);
 return transaction(async tx=>{const actor=await actorInTransaction(actorId,tx);return (await tx.calendarEntry.findMany({where:{ownerId:actor.id,startsAt:{gte:range.start,lt:range.end}},orderBy:[{startsAt:'asc'},{id:'asc'}]})).map(calendarEntryView);});
}
const failure=(code:string,error:string,kind:'conflict'|'failure'='failure'):CalendarMutationResult=>({ok:false,kind,code,error});
export async function mutateCalendarCore(actorId:string|null,input:unknown,transaction:CalendarTransaction,reminderContext:ReminderContext|null=null):Promise<CalendarMutationResult>{
 const parsed=calendarMutationSchema.safeParse(input);if(!parsed.success)return failure('CALENDAR_INPUT_INVALID',parsed.error.issues[0]?.message??'Некорректные данные');
 const data=parsed.data;
 let startsAt:Date|undefined;
 if(data.operation!=='state'){try{startsAt=parseCalendarDateTime(data.localDateTime);}catch{return failure('CALENDAR_DATE_INVALID','Укажите существующую дату и время (Europe/Moscow)');}}
 try{return await transaction(async tx=>{
 const actor=await actorInTransaction(actorId,tx);
 const current=await tx.calendarEntry.findFirst({where:{id:data.entryId,ownerId:actor.id}});
 if(data.operation==='create'){
 const values={title:data.title,description:data.description,startsAt:startsAt!,reminderOffsetMinutes:data.reminderOffsetMinutes};
 const row=current??await tx.calendarEntry.upsert({where:{id:data.entryId},create:{id:data.entryId,ownerId:actor.id,...values,reminderNamespace:reminderContext&&reminderOwnerAllowed(reminderContext,actor.id)?reminderContext.namespace:null},update:{}});
 if(row.ownerId!==actor.id)return failure('CALENDAR_ENTRY_NOT_FOUND','Запись не найдена');
 if(row.title!==values.title||row.description!==values.description||row.startsAt.getTime()!==values.startsAt.getTime()||row.reminderOffsetMinutes!==values.reminderOffsetMinutes)return failure('CALENDAR_CREATE_CONFLICT','Повтор создания содержит другие данные','conflict');
 return {ok:true,entry:calendarEntryView(row),repeated:current!==null};
 }
 if(!current)return failure('CALENDAR_ENTRY_NOT_FOUND','Запись не найдена');
 if(current.revision!==data.expectedRevision)return failure('CALENDAR_REVISION_CONFLICT','Запись уже изменена. Откройте актуальную запись','conflict');
 const values=data.operation==='state'?{state:data.state}:{title:data.title,description:data.description,startsAt:startsAt!,reminderOffsetMinutes:data.reminderOffsetMinutes};
 const changed=await tx.calendarEntry.updateMany({where:{id:data.entryId,ownerId:actor.id,revision:data.expectedRevision},data:{...values,...(data.operation==='update'?{reminderNamespace:reminderContext&&reminderOwnerAllowed(reminderContext,actor.id)?reminderContext.namespace:null}:{}),revision:{increment:1}}});
 if(changed.count!==1)return failure('CALENDAR_REVISION_CONFLICT','Запись уже изменена. Откройте актуальную запись','conflict');
 const row=await tx.calendarEntry.findFirst({where:{id:data.entryId,ownerId:actor.id}});
 if(!row)throw new Error('CALENDAR_CONFIRMED_ROW_MISSING');
 return {ok:true,entry:calendarEntryView(row),repeated:false};
 });}catch(error){
 if(error instanceof Error&&/^CALENDAR_(AUTH_REQUIRED|ACTOR_INACTIVE|ACTOR_MISMATCH|DISABLED)$/.test(error.message))return failure(error.message,'Личный план недоступен');
 throw error;
 }
}
