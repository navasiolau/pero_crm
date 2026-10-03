import {randomUUID} from 'node:crypto';
import {botCalendarRecipientAllowed,type CalendarTelegramClaim,type CalendarTelegramJobContext,type CalendarTelegramOutcome} from './calendar-reminders';
export function createCalendarReminderJob(context:CalendarTelegramJobContext|null,transport:{claim:(input:{namespace:string;botId:string;requestId:string})=>Promise<{ok:boolean;claim?:CalendarTelegramClaim|null}>;authorize:(input:{namespace:string;botId:string;id:string;claimId:string})=>Promise<{ok:boolean;claim?:CalendarTelegramClaim}>;ack:(input:{namespace:string;botId:string;id:string;claimId:string}&CalendarTelegramOutcome)=>Promise<unknown>;send:(claim:CalendarTelegramClaim)=>Promise<CalendarTelegramOutcome>}){
 let running=false;
 return {async tick(){
 if(!context||running)return;running=true;
 try{
 const response=await transport.claim({namespace:context.namespace,botId:context.botId,requestId:randomUUID()});
 const claim=response.ok?response.claim:null;if(!claim||!botCalendarRecipientAllowed(context,claim))return;
 const identity={namespace:context.namespace,botId:context.botId,id:claim.id,claimId:claim.claimId};
 const authorization=await transport.authorize(identity);const fresh=authorization.ok?authorization.claim:null;
 if(!fresh||fresh.id!==claim.id||fresh.claimId!==claim.claimId||fresh.ownerId!==claim.ownerId||fresh.chatId!==claim.chatId||fresh.text!==claim.text||!botCalendarRecipientAllowed(context,fresh))return;
 const result=await transport.send(fresh);
 await transport.ack({...identity,...result});
 }catch{/* Неясный send/ACK не повторяется: durable SENDING lease перейдёт в UNKNOWN. */}finally{running=false;}
 }};
}
