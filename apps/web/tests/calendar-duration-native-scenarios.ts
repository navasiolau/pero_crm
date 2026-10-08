import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import type {PrismaClient} from "@prisma/client";
import {mutateCalendarCore,listCalendarMonthCore} from "../src/server/calendar/core";
import {calendarBaseline,createCalendarUsers} from "./helpers/calendar-acceptance";
export async function runCalendarDurationNative(db:PrismaClient){
 const before=await calendarBaseline(db),rollback=new Error("QA106_ROLLBACK");let verified=false;
 try{await db.$transaction(async tx=>{
  const {own,other}=await createCalendarUsers(tx,"qa106-"+randomUUID()),transaction=<T>(operation:(db:typeof tx)=>Promise<T>)=>operation(tx);
  const input={operation:"create" as const,entryId:randomUUID(),title:"QA106 Часы",localDateTime:"2026-10-07T09:00",plannedMinutes:90,reminderOffsetMinutes:null};
  const created=await mutateCalendarCore(own.id,input,transaction);assert.ok(created.ok);assert.equal(created.entry.plannedMinutes,90);
  const repeated=await mutateCalendarCore(own.id,input,transaction);assert.ok(repeated.ok&&repeated.repeated);
  const changed=await mutateCalendarCore(own.id,{...input,plannedMinutes:60},transaction);assert.ok(!changed.ok&&changed.kind==="conflict");
  const {plannedMinutes:omitted,...oldInput}=input;assert.equal(omitted,90);
  const old=await mutateCalendarCore(own.id,{...oldInput,operation:"update",expectedRevision:0},transaction);assert.ok(old.ok);assert.equal(old.entry.plannedMinutes,90);
  const done=await mutateCalendarCore(own.id,{operation:"state",entryId:input.entryId,expectedRevision:1,state:"COMPLETED"},transaction);assert.ok(done.ok);assert.equal(done.entry.plannedMinutes,90);
  const clear=await mutateCalendarCore(own.id,{...input,operation:"update",expectedRevision:2,plannedMinutes:null},transaction);assert.ok(clear.ok);assert.equal(clear.entry.plannedMinutes,null);
  const zero=await mutateCalendarCore(own.id,{...input,operation:"update",expectedRevision:3,plannedMinutes:0},transaction);assert.ok(zero.ok);assert.equal(zero.entry.plannedMinutes,0);
  const stale=await mutateCalendarCore(own.id,{...input,operation:"update",expectedRevision:3},transaction);assert.ok(!stale.ok&&stale.kind==="conflict");
  assert.deepEqual(await listCalendarMonthCore(other.id,"2026-10",transaction),[]);
  const denied=await mutateCalendarCore(other.id,{...input,operation:"update",expectedRevision:4},transaction);assert.ok(!denied.ok);assert.equal(denied.code,"CALENDAR_ENTRY_NOT_FOUND");
  const legacy=await mutateCalendarCore(own.id,{...oldInput,entryId:randomUUID()},transaction);assert.ok(legacy.ok);assert.equal(legacy.entry.plannedMinutes,null);
  const rows=await listCalendarMonthCore(own.id,"2026-10",transaction);assert.deepEqual(rows.map(r=>r.plannedMinutes).sort(),[0,null].sort());
  await tx.$executeRawUnsafe("SAVEPOINT invalid_duration");
  await assert.rejects(tx.calendarEntry.update({where:{id:input.entryId},data:{plannedMinutes:-1}}),/plannedMinutes_nonnegative/);
  await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT invalid_duration");
  await tx.user.update({where:{id:own.id},data:{calendarEnabled:false}});
  await assert.rejects(listCalendarMonthCore(own.id,"2026-10",transaction),/CALENDAR_DISABLED/);
  const disabled=await mutateCalendarCore(own.id,{...input,operation:"update",expectedRevision:4},transaction);assert.ok(!disabled.ok);assert.equal(disabled.code,"CALENDAR_DISABLED");
  verified=true;throw rollback;
 },{timeout:15000});}catch(error){if(error!==rollback)throw error;}
 assert.ok(verified);assert.deepEqual(await calendarBaseline(db),before);
 return {status:"PASS",minutes:90,empty:null,zero:0,retry:"ONE",oldClient:"PRESERVED",cas:"CONFLICT",privacy:"OWNER_ONLY",databaseCheck:"ENFORCED",originalData:"MATCH",qaRows:"ROLLED_BACK",providerMessages:0};
}
