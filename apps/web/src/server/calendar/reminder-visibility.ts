import type {Prisma,PrismaClient} from '@prisma/client';
import {isCalendarEnabled} from '@/lib/calendar-access';
import {reminderOwnerAllowed} from '@/lib/calendar-reminder-context';
import {getReminderContext} from './reminder-context';
export async function currentReminderNamespace(actorId:string,db:Pick<PrismaClient,'user'>):Promise<string|null>{
 let context;try{context=getReminderContext();}catch{return null;}
 if(!context||!reminderOwnerAllowed(context,actorId))return null;
 const actor=await db.user.findUnique({where:{id:actorId},select:{active:true,roles:true,calendarEnabled:true}});
 return actor?.active&&isCalendarEnabled(actor)?context.namespace:null;
}
export function reminderNotificationWhere(actorId:string,namespace:string):Prisma.NotificationWhereInput{
 return {type:'plan.reminder',userId:actorId,calendarReminderFact:{is:{namespace,ownerId:actorId,webState:'DELIVERED',entry:{ownerId:actorId}}}};
}
