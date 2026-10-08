"use server";
import {getReminderContext} from "./reminder-context";
import {auth} from '@/auth';
import {prisma} from '@/lib/prisma';
import {requireCalendarActor} from './access';
import {listCalendarMonthCore,mutateCalendarCore} from './core';
import type {CalendarMutation,CalendarAnalyticsQuery} from './contracts';
import {loadCalendarAnalyticsCore} from './analytics';
export async function loadCalendarMonth(month:string){
 const actor=await requireCalendarActor();return listCalendarMonthCore(actor.id,month,operation=>prisma.$transaction(operation));
}
export async function mutateCalendar(input:CalendarMutation){
 const session=await auth();return mutateCalendarCore(session?.user.id??null,input,operation=>prisma.$transaction(operation),getReminderContext());
}
export async function loadCalendarAnalytics(query:CalendarAnalyticsQuery){
 const actor=await requireCalendarActor();
 return loadCalendarAnalyticsCore(actor.id,query,operation=>prisma.$transaction(operation));
}
