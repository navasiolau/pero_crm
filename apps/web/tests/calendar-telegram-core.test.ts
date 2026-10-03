import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import type {CalendarTransaction} from '../src/server/calendar/core';
import type {TelegramReminderContext} from '../src/lib/calendar-telegram-context';
import {queueTelegramRemindersCore,claimTelegramReminderCore,authorizeTelegramReminderCore,acknowledgeTelegramReminderCore} from '../src/server/calendar/telegram-core';
const namespace='local:00000000-0000-4000-8000-000000000001',now=new Date('2026-10-03T09:00Z');
const context:TelegramReminderContext={reminder:{environment:'local',namespace,testOwnerIds:['own'],enabled:true},botId:'123',serviceTokenId:'service',testRecipients:[{ownerId:'own',chatId:'456'}]};
type Row=Record<string,unknown>;
function fixture(){
 let state={facts:[{id:'fact',namespace,ownerId:'own',entryId:'entry',entryRevision:0,webState:'DELIVERED',confirmedAt:now,titleSnapshot:'Personal',startsAtSnapshot:now}],entry:{id:'entry',ownerId:'own',state:'PLANNED',revision:0,reminderNamespace:namespace,reminderOffsetMinutes:15},owner:{id:'own',active:true,roles:['ACCOUNTANT'],calendarEnabled:true},link:{id:'link',userId:'own',chatId:'456',linkedAt:now},preference:true,outboxes:[] as Row[]};let reads=0,tail=Promise.resolve();
 function match(row:Row,where:Row):boolean{return Object.entries(where).every(([key,value])=>key==='AND'?(value as Row[]).every(w=>match(row,w)):key==='OR'?(value as Row[]).some(w=>match(row,w)):value&&typeof value==='object'&&'lt' in value?row[key] instanceof Date&&(row[key] as Date)<(value as {lt:Date}).lt:row[key]===value);}
 function update(row:Row,data:Row){for(const [key,value] of Object.entries(data))row[key]=value&&typeof value==='object'&&'increment' in value?Number(row[key])+Number(value.increment):value;return row;}
 const tx={
 $queryRaw:async (query:{strings?:string[]}|string[])=>{reads++;const text=(Array.isArray(query)?query:query.strings??[]).join(' ');if(text.includes('SELECT f.id'))return state.facts.map(fact=>({id:fact.id}));if(text.includes('LIMIT 1 FOR UPDATE'))return state.outboxes.filter(row=>(row.state==='READY'||row.state==='RETRY'&&(row.retryAt as Date)<=now)&&Number(row.attempts)<3).slice(0,1).map(row=>({id:row.id}));return [];},
 calendarReminderFact:{findUnique:async({where}:{where:Row})=>{reads++;return state.facts.find(row=>row.id===where.id)??null;}},calendarEntry:{findUnique:async()=>state.entry},user:{findUnique:async()=>state.owner},telegramLink:{findUnique:async()=>state.link},notificationPreference:{findUnique:async()=>({enabled:state.preference})},
 telegramReminderOutbox:{createMany:async({data}:{data:Row})=>{if(state.outboxes.some(row=>row.namespace===data.namespace&&row.factId===data.factId))return {count:0};state.outboxes.push({id:'outbox',state:'READY',attempts:0,claimId:null,leaseExpiresAt:null,retryAt:null,retryAfterSeconds:null,...data});return {count:1};},findUnique:async({where}:{where:Row})=>state.outboxes.find(row=>match(row,where))??null,updateMany:async({where,data}:{where:Row;data:Row})=>{const rows=state.outboxes.filter(row=>match(row,where));rows.forEach(row=>update(row,data));return {count:rows.length};},update:async({where,data}:{where:Row;data:Row})=>update(state.outboxes.find(row=>row.id===where.id)!,data)},
 } as unknown as Prisma.TransactionClient;
 const transaction:CalendarTransaction=async operation=>{const old=tail;let release!:()=>void;tail=new Promise(resolve=>{release=resolve;});await old;const before=structuredClone(state);try{return await operation(tx);}catch(error){state=before;throw error;}finally{release();}};
 return {state:()=>state,transaction,reads:()=>reads};
}
const identity=(claim:{id:string;claimId:string})=>({namespace,botId:'123',id:claim.id,claimId:claim.claimId});
test('queue uses confirmed own fact once; claim/preflight gives a single grant; exact sent ACK is idempotent',async()=>{
 const f=fixture();assert.equal(await queueTelegramRemindersCore(context,now,f.transaction),1);assert.equal(await queueTelegramRemindersCore(context,now,f.transaction),0);
 const request={namespace,botId:'123',requestId:randomUUID()};const claimed=await claimTelegramReminderCore(context,request,now,f.transaction);assert.ok(claimed.ok&&claimed.claim);const c=claimed.claim;
 const repeated=await claimTelegramReminderCore(context,request,now,f.transaction);assert.ok(repeated.ok&&repeated.claim);assert.equal(repeated.claim.claimId,c.claimId);
 const allowed=await authorizeTelegramReminderCore(context,identity(c),now,f.transaction);assert.ok(allowed.ok);assert.equal((await authorizeTelegramReminderCore(context,identity(c),now,f.transaction)).ok,false);assert.equal(f.state().outboxes[0].attempts,1);
 assert.equal((await acknowledgeTelegramReminderCore(context,{...identity(c),outcome:'sent',messageId:'42'},now,f.transaction)).ok,true);assert.equal((await acknowledgeTelegramReminderCore(context,{...identity(c),outcome:'sent',messageId:'42'},now,f.transaction)).ok,true);assert.equal(f.state().outboxes[0].state,'SENT');assert.equal((await acknowledgeTelegramReminderCore(context,{...identity(c),outcome:'sent',messageId:'43'},now,f.transaction)).ok,false);
});
test('cancel/revision/flag/unlink/relink and testrecipient changes revoke preflight without redirecting snapshots',async()=>{
 for(const mode of ['cancel','revision','off','inactive','chat','link-id','linked-at']){
 const f=fixture();await queueTelegramRemindersCore(context,now,f.transaction);const claimed=await claimTelegramReminderCore(context,{namespace,botId:'123',requestId:randomUUID()},now,f.transaction);assert.ok(claimed.ok&&claimed.claim);
 if(mode==='cancel')f.state().entry.state='CANCELLED';if(mode==='revision')f.state().entry.revision=1;if(mode==='off')f.state().owner.calendarEnabled=false;if(mode==='inactive')f.state().owner.active=false;if(mode==='chat')f.state().link.chatId='999';if(mode==='link-id')f.state().link.id='relinked';if(mode==='linked-at')f.state().link.linkedAt=new Date(now.getTime()+1);
 assert.equal((await authorizeTelegramReminderCore(context,identity(claimed.claim),now,f.transaction)).ok,false,mode);assert.equal(f.state().outboxes[0].state,'CANCELLED',mode);assert.equal(f.state().outboxes[0].chatIdSnapshot,'456',mode);assert.equal(f.state().outboxes[0].attempts,0,mode);
 }
});
test('UNKNOWN send/expired SENDING never reclaims; CLAIMED expiry before grant safely resets',async()=>{
 for(const mode of ['ack-unknown','sending-expired','claimed-expired']){
 const f=fixture();await queueTelegramRemindersCore(context,now,f.transaction);const claimed=await claimTelegramReminderCore(context,{namespace,botId:'123',requestId:randomUUID()},now,f.transaction);assert.ok(claimed.ok&&claimed.claim);const c=claimed.claim;
 if(mode!=='claimed-expired'){assert.ok((await authorizeTelegramReminderCore(context,identity(c),now,f.transaction)).ok);if(mode==='ack-unknown')assert.ok((await acknowledgeTelegramReminderCore(context,{...identity(c),outcome:'unknown'},now,f.transaction)).ok);}
 const result=await claimTelegramReminderCore(context,{namespace,botId:'123',requestId:randomUUID()},new Date(now.getTime()+61000),f.transaction);
 if(mode==='claimed-expired'){assert.ok(result.ok&&result.claim);assert.notEqual(result.claim.claimId,c.claimId);assert.equal((await authorizeTelegramReminderCore(context,identity(c),now,f.transaction)).ok,false);}else{assert.ok(result.ok&&!result.claim);assert.equal(f.state().outboxes[0].state,'UNKNOWN');assert.equal(f.state().outboxes[0].attempts,1);}
 }
});
test('exact429 ACK bounded retry stops after3, stale namespace/bot/body rejected before reads',async()=>{
 const f=fixture();await queueTelegramRemindersCore(context,now,f.transaction);
 for(let attempt=0;attempt<3;attempt++){const claimed=await claimTelegramReminderCore(context,{namespace,botId:'123',requestId:randomUUID()},now,f.transaction);assert.ok(claimed.ok&&claimed.claim);assert.ok((await authorizeTelegramReminderCore(context,identity(claimed.claim),now,f.transaction)).ok);const ack={...identity(claimed.claim),outcome:'rate-limit',retryAfterSeconds:1};assert.ok((await acknowledgeTelegramReminderCore(context,ack,now,f.transaction)).ok);assert.ok((await acknowledgeTelegramReminderCore(context,ack,now,f.transaction)).ok);f.state().outboxes[0].retryAt=new Date(now.getTime()-1);}
 assert.equal(f.state().outboxes[0].state,'FAILED');assert.equal(f.state().outboxes[0].attempts,3);
 const negative=fixture();for(const input of [{namespace:'production',botId:'123',requestId:randomUUID()},{namespace,botId:'999',requestId:randomUUID()},{namespace,botId:'123',requestId:randomUUID(),ownerId:'foreign'}])assert.equal((await claimTelegramReminderCore(context,input,now,negative.transaction)).ok,false);assert.equal(negative.reads(),0);
});
