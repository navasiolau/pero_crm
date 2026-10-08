import assert from "node:assert/strict";import {randomUUID} from "node:crypto";import type {PrismaClient} from "@prisma/client";
import {calendarBaseline,deleteCalendarUsers} from "./helpers/calendar-acceptance";import {createCalendarTotalsFixture} from "./helpers/calendar-totals-fixture";
export async function runCalendarTotalsHttp(db:PrismaClient,request:(path:string,id:string)=>Promise<Response>){
 const before=await calendarBaseline(db),marker="qa107-http-"+randomUUID();
 try{
  await db.$transaction(tx=>createCalendarTotalsFixture(tx,marker));
  const response=await request("/plan?date=2026-10-07",marker);assert.equal(response.status,200);
  const html=await response.text();
  for(const value of ["Часы за месяц","Часы за день","3 ч","2 ч 30 мин","Указанные плановые часы","Плановые часы выполненных записей","Без длительности:"])assert.ok(html.includes(value),"RENDER_MISSING:"+value);
  for(const value of ["FOREIGN_QA107_SECRET","OUTSIDE_BEFORE_QA107","OUTSIDE_AFTER_QA107"])assert.ok(!html.includes(value),"SCOPE_LEAK:"+value);
  const empty=await request("/plan?date=2026-12-01",marker);assert.equal(empty.status,200);assert.ok((await empty.text()).includes("0 ч"));
  return {status:"PASS",routes:["day-month","empty-month"],hours:"180_150_60",privacy:"NO_FOREIGN_OR_OUTSIDE_MONTH",providerMessages:0};
 }finally{await db.$transaction(tx=>deleteCalendarUsers(tx,marker));assert.deepEqual(await calendarBaseline(db),before,"HTTP_ORIGINAL_DATA_CHANGED");}
}
