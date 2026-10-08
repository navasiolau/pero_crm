import {randomUUID} from 'node:crypto';import type {Prisma} from '@prisma/client';
import {createCalendarTotalsFixture} from './calendar-totals-fixture';
export const analyticsRange={from:'2026-10-07',to:'2026-10-08'};
export async function createCalendarAnalyticsFixture(tx:Prisma.TransactionClient,marker:string){
 const f=await createCalendarTotalsFixture(tx,marker);
 await tx.calendarEntry.createMany({data:[
  {id:randomUUID(),ownerId:f.own.id,title:'QA108 В начале диапазона',startsAt:new Date('2026-10-06T21:00:00Z'),plannedMinutes:15,reminderOffsetMinutes:null},
  {id:randomUUID(),ownerId:f.own.id,title:'QA108 В конце диапазона',startsAt:new Date('2026-10-08T20:59:59.999Z'),plannedMinutes:45,state:'COMPLETED',updatedAt:new Date('2026-11-01'),reminderOffsetMinutes:null},
  {id:randomUUID(),ownerId:f.own.id,title:'BEFORE_QA108_SECRET',startsAt:new Date('2026-10-06T20:59:59.999Z'),plannedMinutes:111,reminderOffsetMinutes:null},
  {id:randomUUID(),ownerId:f.own.id,title:'AFTER_QA108_SECRET',startsAt:new Date('2026-10-08T21:00:00Z'),plannedMinutes:111,reminderOffsetMinutes:null},
 ]});return f;
}
