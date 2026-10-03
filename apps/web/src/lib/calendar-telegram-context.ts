import type {ReminderContext} from './calendar-reminder-context';
export type TelegramReminderContext={reminder:ReminderContext;botId:string;serviceTokenId:string;testRecipients:{ownerId:string;chatId:string}[]};
export const privateTelegramChat=(value:string):boolean=>/^[1-9]\d{0,15}$/.test(value);
export function telegramRecipientAllowed(context:TelegramReminderContext,ownerId:string,chatId:string):boolean{
 return privateTelegramChat(chatId)&&(context.reminder.environment==='production'||context.testRecipients.some(row=>row.ownerId===ownerId&&row.chatId===chatId));
}
export function resolveTelegramReminderContext(env:Record<string,string|undefined>,reminder:ReminderContext|null):TelegramReminderContext|null{
 if(env.CALENDAR_TELEGRAM_ENABLED!=='true')return null;
 const stop=(value:unknown)=>{if(!value)throw new Error('CALENDAR_TELEGRAM_CONTEXT_INVALID');};stop(reminder?.enabled);
 const serviceTokenId=env.CALENDAR_TELEGRAM_SERVICE_TOKEN_ID??'';stop(/^[A-Za-z0-9_-]{1,128}$/.test(serviceTokenId));
 const botId=(reminder!.environment==='production'?env.CALENDAR_TELEGRAM_BOT_ID:env.CALENDAR_TELEGRAM_TEST_BOT_ID)??'';stop(privateTelegramChat(botId));
 let testRecipients:TelegramReminderContext['testRecipients']=[];
 if(reminder!.environment!=='production'){
 const rows=JSON.parse(env.CALENDAR_TELEGRAM_TEST_RECIPIENTS??'null');stop(Array.isArray(rows)&&rows.length>0&&rows.length<=16&&rows.every((row:unknown)=>!!row&&typeof row==='object'&&Object.keys(row).length===2&&'ownerId' in row&&typeof row.ownerId==='string'&&reminder!.testOwnerIds.includes(row.ownerId)&&'chatId' in row&&typeof row.chatId==='string'&&privateTelegramChat(row.chatId))&&new Set(rows.map((row:{ownerId:string})=>row.ownerId)).size===rows.length&&new Set(rows.map((row:{chatId:string})=>row.chatId)).size===rows.length);testRecipients=rows;
 }else stop(!env.CALENDAR_TELEGRAM_TEST_RECIPIENTS&&!env.CALENDAR_TELEGRAM_TEST_BOT_ID);
 return {reminder:reminder!,botId,serviceTokenId,testRecipients};
}
