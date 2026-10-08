import assert from "node:assert/strict";import {randomUUID} from "node:crypto";import type {PrismaClient} from "@prisma/client";
import {calendarBaseline,createCalendarUsers,deleteCalendarUsers} from "./helpers/calendar-acceptance";
export async function runCalendarDurationHttp(db:PrismaClient,request:(path:string,id:string)=>Promise<Response>){
 const before=await calendarBaseline(db),marker="qa106-http-"+randomUUID();
 try{
  const {own,other}=await db.$transaction(async tx=>{
   const users=await createCalendarUsers(tx,marker);
   await tx.calendarEntry.createMany({data:[
    {id:randomUUID(),ownerId:users.own.id,title:"QA106 Мои 90 минут",startsAt:new Date("2026-10-07T06:00Z"),plannedMinutes:90,reminderOffsetMinutes:null},
    {id:randomUUID(),ownerId:users.own.id,title:"QA106 Не указана",startsAt:new Date("2026-10-07T07:00Z"),reminderOffsetMinutes:null},
    {id:randomUUID(),ownerId:users.own.id,title:"QA106 Ноль",startsAt:new Date("2026-10-07T08:00Z"),plannedMinutes:0,reminderOffsetMinutes:null},
    {id:randomUUID(),ownerId:users.other.id,title:"FOREIGN_QA106_SECRET",startsAt:new Date("2026-10-07T06:00Z"),plannedMinutes:55,reminderOffsetMinutes:null},
   ]});return users;
  });
  const path="/plan?date=2026-10-07",response=await request(path,own.id);assert.equal(response.status,200);
  const html=await response.text();for(const value of ["QA106 Мои 90 минут","1 ч 30 мин","Не указана","0 ч"])assert.ok(html.includes(value),"RENDER_MISSING:"+value);
  assert.ok(!html.includes("FOREIGN_QA106_SECRET"));assert.ok(!html.includes("qa-login-disabled"));
  const admin=await request(path,other.id);assert.equal(admin.status,200);const adminHtml=await admin.text();assert.ok(adminHtml.includes("FOREIGN_QA106_SECRET"));assert.ok(!adminHtml.includes("QA106 Мои 90 минут"));
  await db.user.update({where:{id:own.id},data:{calendarEnabled:false,sessionVersion:{increment:1}}});
  const disabled=await request(path,own.id);assert.ok(!(await disabled.text()).includes("QA106 Мои 90 минут"));
  return {status:"PASS",rendered:"90_NULL_ZERO",privacy:"OWNER_ADMIN_AND_DISABLED",providerMessages:0};
 }finally{await db.$transaction(tx=>deleteCalendarUsers(tx,marker));assert.deepEqual(await calendarBaseline(db),before,"HTTP_ORIGINAL_DATA_CHANGED");}
}
