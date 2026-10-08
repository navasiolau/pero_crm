import {randomUUID} from "node:crypto";import type {Prisma} from "@prisma/client";
import {createCalendarUsers} from "./calendar-acceptance";
export async function createCalendarTotalsFixture(tx:Prisma.TransactionClient,marker:string){
 const users=await createCalendarUsers(tx,marker),plannedId=randomUUID();
 await tx.calendarEntry.createMany({data:[
  {id:randomUUID(),ownerId:users.own.id,title:"QA107 Начало месяца",startsAt:new Date("2026-09-30T21:00:00Z"),plannedMinutes:30,reminderOffsetMinutes:null},
  {id:plannedId,ownerId:users.own.id,title:"QA107 Запланировано",startsAt:new Date("2026-10-07T06:00:00Z"),plannedMinutes:90,reminderOffsetMinutes:null},
  {id:randomUUID(),ownerId:users.own.id,title:"QA107 Выполнено",startsAt:new Date("2026-10-07T07:00:00Z"),state:"COMPLETED",plannedMinutes:60,reminderOffsetMinutes:null},
  {id:randomUUID(),ownerId:users.own.id,title:"QA107 Отменено",startsAt:new Date("2026-10-07T08:00:00Z"),state:"CANCELLED",plannedMinutes:120,reminderOffsetMinutes:null},
  {id:randomUUID(),ownerId:users.own.id,title:"QA107 Пусто",startsAt:new Date("2026-10-07T09:00:00Z"),state:"COMPLETED",plannedMinutes:null,reminderOffsetMinutes:null},
  {id:randomUUID(),ownerId:users.own.id,title:"QA107 Ноль",startsAt:new Date("2026-10-07T10:00:00Z"),plannedMinutes:0,reminderOffsetMinutes:null},
  {id:randomUUID(),ownerId:users.own.id,title:"OUTSIDE_BEFORE_QA107",startsAt:new Date("2026-09-30T20:59:59.999Z"),plannedMinutes:999,reminderOffsetMinutes:null},
  {id:randomUUID(),ownerId:users.own.id,title:"OUTSIDE_AFTER_QA107",startsAt:new Date("2026-10-31T21:00:00Z"),plannedMinutes:999,reminderOffsetMinutes:null},
  {id:randomUUID(),ownerId:users.other.id,title:"FOREIGN_QA107_SECRET",startsAt:new Date("2026-10-07T06:00:00Z"),plannedMinutes:9999,reminderOffsetMinutes:null},
 ]});return {...users,plannedId};
}
