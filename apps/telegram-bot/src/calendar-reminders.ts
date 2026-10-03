export type CalendarTelegramClaim={id:string;claimId:string;namespace:string;ownerId:string;chatId:string;text:string};
export type CalendarTelegramOutcome={outcome:'sent';messageId:string}|{outcome:'rate-limit';retryAfterSeconds:number}|{outcome:'rejected'|'unknown'};
export type CalendarTelegramJobContext={environment:'local'|'staging'|'production';namespace:string;botId:string;recipients:{ownerId:string;chatId:string}[]};
const positive=(value:string)=>/^[1-9]\d{0,15}$/.test(value);
export function resolveBotCalendarContext(env:Record<string,string|undefined>,actualBotId:string,crmBaseUrl:string):CalendarTelegramJobContext|null{
 if(env.CALENDAR_TELEGRAM_ENABLED!=='true')return null;
 const stop=(condition:unknown)=>{if(!condition)throw new Error('CALENDAR_TELEGRAM_CONTEXT_INVALID');};
 const environment=env.CALENDAR_REMINDER_ENVIRONMENT,namespace=env.CALENDAR_REMINDER_NAMESPACE??'';
 stop(['local','staging','production'].includes(environment??''));const url=new URL(crmBaseUrl);stop(!url.username&&!url.password&&!url.hash&&!url.search&&(url.pathname==='/'||url.pathname===''));
 const botId=(environment==='production'?env.CALENDAR_TELEGRAM_BOT_ID:env.CALENDAR_TELEGRAM_TEST_BOT_ID)??'';stop(positive(botId)&&botId===actualBotId);
 let recipients:CalendarTelegramJobContext['recipients']=[];
 if(environment==='production')stop(namespace==='production'&&['https://crm.peromebel.by','http://192.168.0.20'].includes(url.origin)&&!env.CALENDAR_TELEGRAM_TEST_RECIPIENTS&&!env.CALENDAR_TELEGRAM_TEST_BOT_ID);
 else{
 stop(new RegExp(`^${environment}:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`,'i').test(namespace));
 stop(environment==='local'?url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname):['https://staging-crm.peromebel.by','http://192.168.0.30'].includes(url.origin));
 const rows=JSON.parse(env.CALENDAR_TELEGRAM_TEST_RECIPIENTS??'null');stop(Array.isArray(rows)&&rows.length>0&&rows.length<=16&&rows.every((row:unknown)=>!!row&&typeof row==='object'&&Object.keys(row).length===2&&'ownerId' in row&&typeof row.ownerId==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(row.ownerId)&&'chatId' in row&&typeof row.chatId==='string'&&positive(row.chatId))&&new Set(rows.map((row:{ownerId:string})=>row.ownerId)).size===rows.length&&new Set(rows.map((row:{chatId:string})=>row.chatId)).size===rows.length);recipients=rows;
 }
 return {environment:environment as CalendarTelegramJobContext['environment'],namespace,botId,recipients};
}
export function botCalendarRecipientAllowed(context:CalendarTelegramJobContext,claim:CalendarTelegramClaim):boolean{
 return typeof claim.id==='string'&&claim.id.length>0&&claim.id.length<=128&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(claim.claimId)&&typeof claim.text==='string'&&claim.text.length>0&&claim.text.length<=4096&&claim.namespace===context.namespace&&positive(claim.chatId)&&(context.environment==='production'||context.recipients.some(row=>row.ownerId===claim.ownerId&&row.chatId===claim.chatId));
}
export async function sendCalendarTelegramMessage(input:{apiOrigin:string;token:string;claim:CalendarTelegramClaim},fetcher:typeof fetch=fetch):Promise<CalendarTelegramOutcome>{
 try{
 const response=await fetcher(`${input.apiOrigin}/bot${input.token}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:input.claim.chatId,text:input.claim.text}),signal:AbortSignal.timeout(10000)});
 const data=await response.json() as {ok?:unknown;result?:{message_id?:unknown;chat?:{id?:unknown}};error_code?:unknown;parameters?:{retry_after?:unknown}};
 if(response.ok&&data.ok===true&&Number.isSafeInteger(data.result?.message_id)&&Number(data.result?.message_id)>0&&String(data.result?.chat?.id)===input.claim.chatId)return {outcome:'sent',messageId:String(data.result!.message_id)};
 if(response.status===429&&data.ok===false&&data.error_code===429&&Number.isSafeInteger(data.parameters?.retry_after)&&Number(data.parameters?.retry_after)>0&&Number(data.parameters?.retry_after)<=3600)return {outcome:'rate-limit',retryAfterSeconds:Number(data.parameters!.retry_after)};
 if(data.ok===false&&(data.error_code===400||data.error_code===403)&&response.status===data.error_code)return {outcome:'rejected'};
 return {outcome:'unknown'};
 }catch{return {outcome:'unknown'};}
}
