"use server";
import {auth} from '@/auth';
import {prisma} from '@/lib/prisma';
import {requireCalendarActor} from './access';
import {listCalendarMonthCore,mutateCalendarCore} from './core';
import type {CalendarMutation} from './contracts';
export async function loadCalendarMonth(month:string){
 const actor=await requireCalendarActor();return listCalendarMonthCore(actor.id,month,operation=>prisma.$transaction(operation));
}
export async function mutateCalendar(input:CalendarMutation){
 const session=await auth();return mutateCalendarCore(session?.user.id??null,input,operation=>prisma.$transaction(operation));
}
