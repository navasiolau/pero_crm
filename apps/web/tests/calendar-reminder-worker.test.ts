import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire,Module} from 'node:module';
const require=createRequire(import.meta.url);function inject(path:string,exports:Record<string,unknown>){const id=require.resolve(path),stub=new Module(id);stub.filename=id;stub.loaded=true;stub.exports=exports;require.cache[id]=stub;}
let enabled=true,calls=0,release:()=>void=()=>{};let scheduled:(()=>void)|undefined;let interval=0,unref=0;
inject('../src/lib/prisma',{prisma:{$transaction:()=>{throw Error('Unexpected database')}}});
inject('../src/server/calendar/reminder-context',{getReminderContext:()=>({enabled})});
inject('../src/server/calendar/reminders',{dispatchCalendarRemindersCore:async()=>{calls++;await new Promise<void>(resolve=>{release=resolve;});return {delivered:1,suppressed:0,skipped:0,repeated:0};}});
const original=globalThis.setInterval;
const {startCalendarReminderWorker}=require('../src/server/calendar/reminder-worker') as typeof import('../src/server/calendar/reminder-worker');
test('import has no automatic loop; one60s unref timer with singleton/reentrancy and live disable',async()=>{
 assert.equal(calls,0);
 globalThis.setInterval=((callback:()=>void,ms:number)=>{scheduled=callback;interval=ms;return {unref:()=>{unref++;}};}) as never;
 try{startCalendarReminderWorker();startCalendarReminderWorker();assert.equal(interval,60000);assert.equal(unref,1);assert.equal(calls,1);scheduled!();scheduled!();assert.equal(calls,1);release();await new Promise(resolve=>setImmediate(resolve));enabled=false;scheduled!();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);}finally{globalThis.setInterval=original;delete (globalThis as typeof globalThis & {calendarReminderWorker?:unknown}).calendarReminderWorker;}
});
