import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire,Module} from 'node:module';
import {NextResponse} from 'next/server';
const require=createRequire(import.meta.url);function inject(path:string,exports:Record<string,unknown>){const id=require.resolve(path),stub=new Module(id);stub.filename=id;stub.loaded=true;stub.exports=exports;require.cache[id]=stub;}
let authorized=false,calls=0;
inject('../src/server/api/auth',{authenticate:async(_request:Request,scope:string)=>{assert.equal(scope,'calendar.reminders');return authorized?{id:'service'}:NextResponse.json({error:'denied'},{status:403});},isErrorResponse:(value:unknown)=>value instanceof NextResponse});
inject('../src/server/calendar/reminder-worker',{dispatchCalendarReminders:async()=>{calls++;return {delivered:1,suppressed:0,skipped:0,repeated:0};}});
const {POST}=require('../src/app/api/v1/calendar/reminders/dispatch/route') as typeof import('../src/app/api/v1/calendar/reminders/dispatch/route');
test('dispatch requires exact capability and rejects namespace/owner/time payload; successful response counts only',async()=>{
 assert.equal((await POST(new Request('http://localhost/api/v1/calendar/reminders/dispatch',{method:'POST'}))).status,403);assert.equal(calls,0);
 authorized=true;assert.equal((await POST(new Request('http://localhost/api/v1/calendar/reminders/dispatch',{method:'POST',body:JSON.stringify({ownerId:'foreign',namespace:'production'})}))).status,400);assert.equal(calls,0);
 const result=await POST(new Request('http://localhost/api/v1/calendar/reminders/dispatch',{method:'POST'}));assert.equal(result.status,200);assert.deepEqual(await result.json(),{ok:true,delivered:1,suppressed:0,skipped:0,repeated:0});assert.equal(calls,1);
});
