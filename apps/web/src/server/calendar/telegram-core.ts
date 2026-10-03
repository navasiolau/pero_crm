import {Prisma,type TelegramReminderOutbox} from '@prisma/client';
import {isCalendarEnabled} from '@/lib/calendar-access';
import {calendarDisplay} from '@/lib/calendar-dates';
import {telegramRecipientAllowed,type TelegramReminderContext} from '@/lib/calendar-telegram-context';
import {telegramClaimSchema,telegramAuthorizeSchema,telegramAckSchema,type TelegramClaim} from './telegram-contracts';
import type {CalendarTransaction} from './core';
function outboxScope(context:TelegramReminderContext):Prisma.TelegramReminderOutboxWhereInput{return {namespace:context.reminder.namespace,...(context.reminder.environment==='production'?{}:{OR:context.testRecipients.map(row=>({ownerId:row.ownerId,chatIdSnapshot:row.chatId}))})};}
function outboxRecipientsSql(context:TelegramReminderContext){return context.reminder.environment==='production'?Prisma.empty:Prisma.sql`AND (${Prisma.join(context.testRecipients.map(row=>Prisma.sql`("ownerId"=${row.ownerId} AND "chatIdSnapshot"=${row.chatId})`),' OR ')})`;}
const error=(code:string)=>({ok:false as const,code});
function requestMatches(context:TelegramReminderContext,input:{namespace:string;botId:string}){return context.reminder.enabled&&input.namespace===context.reminder.namespace&&input.botId===context.botId;}
async function eligibleFact(tx:Prisma.TransactionClient,context:TelegramReminderContext,factId:string,now:Date){
 const fact=await tx.calendarReminderFact.findUnique({where:{id:factId}});if(!fact||fact.namespace!==context.reminder.namespace||fact.webState!=='DELIVERED'||fact.confirmedAt>now)return null;
 await tx.$queryRaw`SELECT id FROM "CalendarEntry" WHERE id=${fact.entryId} FOR SHARE`;
 const entry=await tx.calendarEntry.findUnique({where:{id:fact.entryId}});
 if(!entry||entry.ownerId!==fact.ownerId||entry.state!=='PLANNED'||entry.revision!==fact.entryRevision||entry.reminderNamespace!==context.reminder.namespace||entry.reminderOffsetMinutes===null)return null;
 await tx.$queryRaw`SELECT id FROM "User" WHERE id=${fact.ownerId} FOR SHARE`;
 const owner=await tx.user.findUnique({where:{id:fact.ownerId},select:{id:true,active:true,roles:true,calendarEnabled:true}});if(!owner?.active||!isCalendarEnabled(owner))return null;
 await tx.$queryRaw`SELECT id FROM "TelegramLink" WHERE "userId"=${fact.ownerId} FOR SHARE`;
 const link=await tx.telegramLink.findUnique({where:{userId:fact.ownerId}});if(!link?.chatId||!link.linkedAt||!telegramRecipientAllowed(context,fact.ownerId,link.chatId))return null;
 const pref=await tx.notificationPreference.findUnique({where:{userId_type:{userId:fact.ownerId,type:'plan.reminder'}}});if(pref?.enabled===false)return null;
 return {fact,entry,link};
}
function sameRecipient(row:TelegramReminderOutbox,source:NonNullable<Awaited<ReturnType<typeof eligibleFact>>>){return row.ownerId===source.fact.ownerId&&row.entryId===source.entry.id&&row.entryRevision===source.entry.revision&&row.chatIdSnapshot===source.link.chatId&&row.linkIdSnapshot===source.link.id&&row.linkedAtSnapshot.getTime()===source.link.linkedAt!.getTime();}
function claimView(row:TelegramReminderOutbox,source:NonNullable<Awaited<ReturnType<typeof eligibleFact>>>):TelegramClaim{return {id:row.id,claimId:row.claimId!,namespace:row.namespace,ownerId:row.ownerId,chatId:row.chatIdSnapshot,text:`${source.fact.titleSnapshot}\n${calendarDisplay(source.fact.startsAtSnapshot)} · Europe/Moscow`};}
export async function queueTelegramRemindersCore(context:TelegramReminderContext,now:Date,transaction:CalendarTransaction){
 if(!context.reminder.enabled)return 0;
 const recipients=context.reminder.environment==='production'?Prisma.empty:Prisma.sql`AND (${Prisma.join(context.testRecipients.map(row=>Prisma.sql`(f."ownerId"=${row.ownerId} AND l."chatId"=${row.chatId})`),' OR ')})`;
 const candidates=await transaction(tx=>tx.$queryRaw<{id:string}[]>(Prisma.sql`
 SELECT f.id FROM "CalendarReminderFact" f JOIN "CalendarEntry" e ON e.id=f."entryId" JOIN "User" u ON u.id=f."ownerId" JOIN "TelegramLink" l ON l."userId"=u.id
 WHERE f.namespace=${context.reminder.namespace} AND f."webState"='DELIVERED' AND f."confirmedAt"<=${now}
 AND e."reminderNamespace"=${context.reminder.namespace} AND e."ownerId"=f."ownerId" AND e.revision=f."entryRevision" AND e.state='PLANNED' AND e."reminderOffsetMinutes" IS NOT NULL
 AND u.active AND (u."calendarEnabled" IS TRUE OR (u."calendarEnabled" IS NULL AND 'PROCUREMENT'=ANY(u.roles)))
 AND l."linkedAt" IS NOT NULL AND l."chatId" ~ '^[1-9][0-9]{0,15}$' ${recipients}
 AND NOT EXISTS(SELECT 1 FROM "NotificationPreference" p WHERE p."userId"=u.id AND p.type='plan.reminder' AND p.enabled=FALSE)
 AND NOT EXISTS(SELECT 1 FROM "TelegramReminderOutbox" o WHERE o.namespace=${context.reminder.namespace} AND o."factId"=f.id)
 ORDER BY f."confirmedAt",f.id LIMIT 100`));
 let count=0;for(const candidate of candidates)count+=await transaction(async tx=>{const source=await eligibleFact(tx,context,candidate.id,now);if(!source)return 0;return (await tx.telegramReminderOutbox.createMany({data:{namespace:context.reminder.namespace,factId:source.fact.id,ownerId:source.fact.ownerId,entryId:source.entry.id,entryRevision:source.entry.revision,chatIdSnapshot:source.link.chatId!,linkIdSnapshot:source.link.id,linkedAtSnapshot:source.link.linkedAt!},skipDuplicates:true})).count;});return count;
}
export async function claimTelegramReminderCore(context:TelegramReminderContext,input:unknown,now:Date,transaction:CalendarTransaction){
 const parsed=telegramClaimSchema.safeParse(input);if(!parsed.success||!requestMatches(context,parsed.data))return error('CONTEXT_REFUSED');
 return transaction(async tx=>{
 const namespace=context.reminder.namespace;
 await tx.telegramReminderOutbox.updateMany({where:{...outboxScope(context),state:'SENDING',leaseExpiresAt:{lt:now}},data:{state:'UNKNOWN',resultCode:'LEASE_EXPIRED'}});
 await tx.telegramReminderOutbox.updateMany({where:{...outboxScope(context),state:'CLAIMED',leaseExpiresAt:{lt:now}},data:{state:'READY',claimId:null,leaseExpiresAt:null}});
 const repeated=await tx.telegramReminderOutbox.findUnique({where:{claimId:parsed.data.requestId,AND:[outboxScope(context)]}});
 let row:TelegramReminderOutbox|null=repeated;
 if(row&&(row.namespace!==namespace||row.state!=='CLAIMED'))return {ok:true as const,claim:null};
 if(!row){const [candidate]=await tx.$queryRaw<{id:string}[]>`SELECT id FROM "TelegramReminderOutbox" WHERE namespace=${namespace} ${outboxRecipientsSql(context)} AND (state='READY' OR (state='RETRY' AND "retryAt"<=${now})) AND attempts<3 ORDER BY "createdAt",id LIMIT 1 FOR UPDATE SKIP LOCKED`;if(!candidate)return {ok:true as const,claim:null};row=await tx.telegramReminderOutbox.findUnique({where:{id:candidate.id}});}
 if(!row)return {ok:true as const,claim:null};
 const source=await eligibleFact(tx,context,row.factId,now);
 if(!source||!sameRecipient(row,source)){await tx.telegramReminderOutbox.update({where:{id:row.id},data:{state:'CANCELLED',resultCode:'SOURCE_REVOKED'}});return {ok:true as const,claim:null};}
 if(!repeated)row=await tx.telegramReminderOutbox.update({where:{id:row.id},data:{state:'CLAIMED',claimId:parsed.data.requestId,leaseExpiresAt:new Date(now.getTime()+60000),retryAt:null}});
 return {ok:true as const,claim:claimView(row,source)};
 });
}
export async function authorizeTelegramReminderCore(context:TelegramReminderContext,input:unknown,now:Date,transaction:CalendarTransaction){
 const parsed=telegramAuthorizeSchema.safeParse(input);if(!parsed.success||!requestMatches(context,parsed.data))return error('CONTEXT_REFUSED');
 return transaction(async tx=>{
 await tx.$queryRaw`SELECT id FROM "TelegramReminderOutbox" WHERE id=${parsed.data.id} AND namespace=${context.reminder.namespace} ${outboxRecipientsSql(context)} FOR UPDATE`;
 const row=await tx.telegramReminderOutbox.findUnique({where:{id:parsed.data.id,AND:[outboxScope(context)]}});
 if(!row||row.namespace!==context.reminder.namespace||row.claimId!==parsed.data.claimId||row.state!=='CLAIMED'||!row.leaseExpiresAt||row.leaseExpiresAt<=now)return error('CLAIM_REFUSED');
 const source=await eligibleFact(tx,context,row.factId,now);
 if(!source||!sameRecipient(row,source)){await tx.telegramReminderOutbox.update({where:{id:row.id},data:{state:'CANCELLED',resultCode:'SOURCE_REVOKED'}});return error('SOURCE_REVOKED');}
 const updated=await tx.telegramReminderOutbox.update({where:{id:row.id},data:{state:'SENDING',attempts:{increment:1},leaseExpiresAt:new Date(now.getTime()+60000)}});
 return {ok:true as const,claim:claimView(updated,source)};
 });
}
export async function acknowledgeTelegramReminderCore(context:TelegramReminderContext,input:unknown,now:Date,transaction:CalendarTransaction){
 const parsed=telegramAckSchema.safeParse(input);if(!parsed.success||!requestMatches(context,parsed.data))return error('CONTEXT_REFUSED');
 return transaction(async tx=>{
 await tx.$queryRaw`SELECT id FROM "TelegramReminderOutbox" WHERE id=${parsed.data.id} AND namespace=${context.reminder.namespace} ${outboxRecipientsSql(context)} FOR UPDATE`;
 const row=await tx.telegramReminderOutbox.findUnique({where:{id:parsed.data.id,AND:[outboxScope(context)]}});
 if(!row||row.namespace!==context.reminder.namespace||row.claimId!==parsed.data.claimId)return error('CLAIM_REFUSED');
 const data=parsed.data;if(row.state==='SENT')return data.outcome==='sent'&&row.messageId===data.messageId?{ok:true as const,state:row.state}:error('ACK_CONFLICT');
 if(data.outcome==='unknown'&&row.state==='UNKNOWN')return {ok:true as const,state:row.state};
 if(data.outcome==='rejected'&&row.state==='FAILED'&&row.resultCode==='REJECTED')return {ok:true as const,state:row.state};
 if(data.outcome==='rate-limit'&&((row.state==='RETRY'&&row.resultCode==='RATE_LIMIT')||(row.state==='FAILED'&&row.resultCode==='ATTEMPTS_EXHAUSTED'))&&row.retryAfterSeconds===data.retryAfterSeconds)return {ok:true as const,state:row.state};
 if(row.state!=='SENDING'&&!(row.state==='UNKNOWN'&&data.outcome==='sent'))return error('ACK_REFUSED');
 const update:Prisma.TelegramReminderOutboxUpdateInput=data.outcome==='sent'?{state:'SENT',messageId:data.messageId,sentAt:now,leaseExpiresAt:null,resultCode:'DELIVERED'}:data.outcome==='rate-limit'&&row.attempts<3?{state:'RETRY',retryAt:new Date(now.getTime()+data.retryAfterSeconds*1000),retryAfterSeconds:data.retryAfterSeconds,leaseExpiresAt:null,resultCode:'RATE_LIMIT'}:data.outcome==='unknown'?{state:'UNKNOWN',leaseExpiresAt:null,resultCode:'SEND_UNKNOWN'}:{state:'FAILED',leaseExpiresAt:null,...(data.outcome==='rate-limit'?{retryAfterSeconds:data.retryAfterSeconds}:{}),resultCode:data.outcome==='rate-limit'?'ATTEMPTS_EXHAUSTED':'REJECTED'};
 const changed=await tx.telegramReminderOutbox.update({where:{id:row.id},data:update});return {ok:true as const,state:changed.state};
 });
}
