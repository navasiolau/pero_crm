import {Prisma} from '@prisma/client';
import {isCalendarEnabled} from '@/lib/calendar-access';
import {calendarDisplay,calendarLocalValue} from '@/lib/calendar-dates';
import {reminderOwnerAllowed,type ReminderContext} from '@/lib/calendar-reminder-context';
import type {CalendarTransaction} from './core';
export const PLAN_REMINDER_TYPE='plan.reminder';
export function calendarReminderDue(startsAt:Date,offset:number|null):Date|null{
 if(offset===null||![0,15,60,1440].includes(offset)||!Number.isFinite(startsAt.getTime()))return null;
 return new Date(startsAt.getTime()-offset*60_000);
}
export async function confirmCalendarReminderCore(context:ReminderContext,candidate:{id:string;revision:number},now:Date,transaction:CalendarTransaction):Promise<'delivered'|'suppressed'|'skipped'|'repeated'>{
 if(!context.enabled)return 'skipped';
 return transaction(async tx=>{
 await tx.$queryRaw`SELECT id FROM "CalendarEntry" WHERE id=${candidate.id} FOR UPDATE`;
 const entry=await tx.calendarEntry.findUnique({where:{id:candidate.id}});
 if(!entry||entry.revision!==candidate.revision||entry.state!=='PLANNED'||entry.reminderNamespace!==context.namespace||!reminderOwnerAllowed(context,entry.ownerId))return 'skipped';
 const due=calendarReminderDue(entry.startsAt,entry.reminderOffsetMinutes);if(!due||due>now)return 'skipped';
 await tx.$queryRaw`SELECT id FROM "User" WHERE id=${entry.ownerId} FOR SHARE`;
 const owner=await tx.user.findUnique({where:{id:entry.ownerId},select:{id:true,active:true,roles:true,calendarEnabled:true}});
 if(!owner?.active||!isCalendarEnabled(owner))return 'skipped';
 const key={namespace:context.namespace,entryId:entry.id,entryRevision:entry.revision};
 if(await tx.calendarReminderFact.findUnique({where:{namespace_entryId_entryRevision:key}}))return 'repeated';
 const preference=await tx.notificationPreference.findUnique({where:{userId_type:{userId:owner.id,type:PLAN_REMINDER_TYPE}}});
 const notification=preference?.enabled===false?null:await tx.notification.create({data:{userId:owner.id,type:PLAN_REMINDER_TYPE,title:entry.title,body:`${calendarDisplay(entry.startsAt)} · Europe/Moscow`,link:`/plan?date=${calendarLocalValue(entry.startsAt).slice(0,10)}`}});
 await tx.calendarReminderFact.create({data:{...key,ownerId:owner.id,scheduledFor:due,confirmedAt:now,titleSnapshot:entry.title,startsAtSnapshot:entry.startsAt,webState:notification?'DELIVERED':'SKIPPED',webNotificationId:notification?.id??null}});
 return notification?'delivered':'suppressed';
 });
}
export async function dispatchCalendarRemindersCore(context:ReminderContext,now:Date,transaction:CalendarTransaction,limit=100){
 if(!context.enabled)return {delivered:0,suppressed:0,skipped:0,repeated:0};
 if(!Number.isFinite(now.getTime())||!Number.isInteger(limit)||limit<1||limit>100)throw new Error('CALENDAR_REMINDER_BATCH_INVALID');
 const ownerClause=context.environment==='production'?Prisma.empty:Prisma.sql`AND e."ownerId" IN (${Prisma.join(context.testOwnerIds)})`;
 if(context.environment!=='production'&&context.testOwnerIds.length===0)throw new Error('CALENDAR_REMINDER_OWNERS_REQUIRED');
 const candidates=await transaction(tx=>tx.$queryRaw<{id:string;revision:number}[]>(Prisma.sql`
 SELECT e.id,e.revision FROM "CalendarEntry" e JOIN "User" u ON u.id=e."ownerId"
 WHERE u.active AND (u."calendarEnabled" IS TRUE OR (u."calendarEnabled" IS NULL AND 'PROCUREMENT'=ANY(u.roles))) AND e."reminderNamespace"=${context.namespace} AND e.state='PLANNED' AND e."reminderOffsetMinutes" IS NOT NULL
 AND e."startsAt"-make_interval(mins=>e."reminderOffsetMinutes")<=${now} ${ownerClause}
 AND NOT EXISTS(SELECT 1 FROM "CalendarReminderFact" f WHERE f."entryId"=e.id AND f.namespace=${context.namespace} AND f."entryRevision"=e.revision)
 ORDER BY e."startsAt",e.id LIMIT ${limit}`));
 const counts={delivered:0,suppressed:0,skipped:0,repeated:0};
 for(const candidate of candidates)counts[await confirmCalendarReminderCore(context,candidate,now,transaction)]++;
 return counts;
}
