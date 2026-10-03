import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire,Module} from 'node:module';
import {NextResponse} from 'next/server';
const require=createRequire(import.meta.url);function inject(path:string,exports:Record<string,unknown>){const id=require.resolve(path),stub=new Module(id);stub.filename=id;stub.loaded=true;stub.exports=exports;require.cache[id]=stub;}
let configured=false,tokenId='foreign',authReads=0,calendarQueries=0;
const context={serviceTokenId:'accepted'};
inject('../src/server/calendar/telegram-context',{getTelegramReminderContext:()=>configured?context:null});
inject('../src/server/api/auth',{authenticate:async(_request:Request,scope:string)=>{assert.equal(scope,'calendar.reminders');authReads++;return {id:tokenId};},isErrorResponse:(value:unknown)=>value instanceof NextResponse});
inject('../src/lib/prisma',{prisma:{$transaction:async()=>{calendarQueries++;throw Error('Unexpected private access')}}});
const {handleTelegramReminderService}=require('../src/server/calendar/telegram-service') as typeof import('../src/server/calendar/telegram-service');
test('unconfigured TG endpoint haszeroqueries; capability on ordinary admin key doesnotgrant privatequeue access',async()=>{
 const request=()=>new Request('http://localhost/api/v1/bot/calendar-reminders/claim',{method:'POST',body:JSON.stringify({namespace:'production',botId:'123',requestId:'00000000-0000-4000-8000-000000000001'})});
 assert.equal((await handleTelegramReminderService(request(),'claim')).status,503);assert.equal(authReads,0);assert.equal(calendarQueries,0);
 configured=true;assert.equal((await handleTelegramReminderService(request(),'claim')).status,403);assert.equal(authReads,1);assert.equal(calendarQueries,0);
 tokenId='accepted';assert.equal((await handleTelegramReminderService(new Request('http://localhost',{method:'POST',body:'invalid'}),'claim')).status,400);assert.equal(calendarQueries,0);
});
