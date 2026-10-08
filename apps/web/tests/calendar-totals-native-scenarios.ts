import assert from "node:assert/strict";import {randomUUID} from "node:crypto";import type {PrismaClient} from "@prisma/client";
import {mutateCalendarCore,listCalendarMonthCore} from "../src/server/calendar/core";import {summarizeCalendarEntries} from "../src/lib/calendar-summary";
import {calendarBaseline} from "./helpers/calendar-acceptance";import {createCalendarTotalsFixture} from "./helpers/calendar-totals-fixture";
export async function runCalendarTotalsNative(db:PrismaClient){
 const before=await calendarBaseline(db),rollback=new Error("QA107_ROLLBACK");let verified=false;
 try{await db.$transaction(async tx=>{
  const f=await createCalendarTotalsFixture(tx,"qa107-"+randomUUID()),transaction=<T>(op:(db:typeof tx)=>Promise<T>)=>op(tx);
  const load=async()=>summarizeCalendarEntries(await listCalendarMonthCore(f.own.id,"2026-10",transaction));
  const report=await load();assert.equal(report.total.hours.minutes,180);assert.equal(report.total.hours.missingCount,1);assert.equal(report.total.completedHours.minutes,60);assert.equal(report.total.completedCount,2);
  assert.equal(report.total.totalCount,6);assert.equal(report.days.find(d=>d.date==="2026-10-07")?.summary.hours.minutes,150);
  const cancel=await mutateCalendarCore(f.own.id,{operation:"state",entryId:f.plannedId,expectedRevision:0,state:"CANCELLED"},transaction);assert.ok(cancel.ok);
  assert.equal((await load()).total.hours.minutes,90);
  const reopen=await mutateCalendarCore(f.own.id,{operation:"state",entryId:f.plannedId,expectedRevision:1,state:"PLANNED"},transaction);assert.ok(reopen.ok);assert.equal((await load()).total.hours.minutes,180);
  const edited=await mutateCalendarCore(f.own.id,{operation:"update",entryId:f.plannedId,expectedRevision:2,title:"QA107 Изменено",localDateTime:"2026-10-08T09:00",plannedMinutes:120,reminderOffsetMinutes:null},transaction);assert.ok(edited.ok);
  const updated=await load();assert.equal(updated.total.hours.minutes,210);assert.equal(updated.days.find(d=>d.date==="2026-10-07")?.summary.hours.minutes,60);assert.equal(updated.days.find(d=>d.date==="2026-10-08")?.summary.hours.minutes,120);
  assert.equal(summarizeCalendarEntries(await listCalendarMonthCore(f.other.id,"2026-10",transaction)).total.hours.minutes,9999);
  verified=true;throw rollback;
 },{timeout:15000});}catch(error){if(error!==rollback)throw error;}
 assert.ok(verified);assert.deepEqual(await calendarBaseline(db),before);
 return {status:"PASS",monthMinutes:180,dayMinutes:150,completedMinutes:60,missingCount:1,mutations:"CANCEL_REOPEN_EDIT_MOVE",boundaries:"MSK",privacy:"OWNER_ONLY",originalData:"MATCH",qaRows:"ROLLED_BACK",providerMessages:0};
}
