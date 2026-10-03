import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {resolveBotCalendarContext,sendCalendarTelegramMessage}=require('../dist/calendar-reminders.js');
const {createCalendarReminderJob}=require('../dist/calendar-job.js');
const namespace='local:00000000-0000-4000-8000-000000000001',claim={id:'outbox',claimId:'00000000-0000-4000-8000-000000000002',namespace,ownerId:'own',chatId:'456',text:'Personal reminder'};
const env={CALENDAR_TELEGRAM_ENABLED:'true',CALENDAR_REMINDER_ENVIRONMENT:'local',CALENDAR_REMINDER_NAMESPACE:namespace,CALENDAR_TELEGRAM_TEST_BOT_ID:'123',CALENDAR_TELEGRAM_TEST_RECIPIENTS:JSON.stringify([{ownerId:'own',chatId:'456'}])};
test('actual bot identity and exact testrecipient context gate before claim; defaultoff untouched',()=>{
 assert.equal(resolveBotCalendarContext({},'123','http://localhost:3019'),null);const context=resolveBotCalendarContext(env,'123','http://localhost:3019');assert.equal(context.namespace,namespace);
 for(const [changed,bot,url] of [[{},'999','http://localhost:3019'],[{CALENDAR_TELEGRAM_TEST_RECIPIENTS:'[]'},'123','http://localhost:3019'],[{},'123','https://crm.peromebel.by']])assert.throws(()=>resolveBotCalendarContext({...env,...changed},bot,url));
});
test('safe sender requires exact positive wire ACK; timeout/malformed/wrongchat becomeUNKNOWN,429 bounded metadata',async()=>{
 const send=async(response)=>sendCalendarTelegramMessage({apiOrigin:'http://test.invalid',token:'synthetic-token',claim},async()=>response);
 assert.deepEqual(await send(new Response(JSON.stringify({ok:true,result:{message_id:42,chat:{id:456}}}),{status:200})),{outcome:'sent',messageId:'42'});
 for(const response of [new Response('<html>',{status:502}),new Response(JSON.stringify({ok:true,result:{message_id:42,chat:{id:999}}}),{status:200}),new Response(JSON.stringify({ok:false,error_code:500}),{status:500})])assert.deepEqual(await send(response),{outcome:'unknown'});
 assert.deepEqual(await sendCalendarTelegramMessage({apiOrigin:'http://test.invalid',token:'synthetic-token',claim},async()=>{throw Error('timeout')}),{outcome:'unknown'});
 assert.deepEqual(await send(new Response(JSON.stringify({ok:false,error_code:429,parameters:{retry_after:3}}),{status:429})),{outcome:'rate-limit',retryAfterSeconds:3});
 assert.deepEqual(await send(new Response(JSON.stringify({ok:false,error_code:403}),{status:403})),{outcome:'rejected'});
});
test('job preflight checks immutable recipient/text; forbidden or mismatched source causeszero sends, ACKlost never loops send',async()=>{
 const context=resolveBotCalendarContext(env,'123','http://localhost:3019');
 for(const mode of ['off','foreign-claim','revoked','changed-owner','lost-ack']){
 let claims=0,sends=0,acks=0;
 const transport={claim:async()=>{claims++;return {ok:true,claim:mode==='foreign-claim'?{...claim,chatId:'999'}:claims===1?claim:null};},authorize:async()=>mode==='revoked'?{ok:false}:{ok:true,claim:mode==='changed-owner'?{...claim,ownerId:'foreign'}:claim},send:async()=>{sends++;return {outcome:'unknown'};},ack:async()=>{acks++;if(mode==='lost-ack')throw Error('lostACK');}};
 const job=createCalendarReminderJob(mode==='off'?null:context,transport);await job.tick();await job.tick();
 if(mode==='lost-ack'){assert.equal(sends,1);assert.equal(acks,1);}else assert.equal(sends,0,mode);
 if(mode==='off')assert.equal(claims,0);
 }
});
