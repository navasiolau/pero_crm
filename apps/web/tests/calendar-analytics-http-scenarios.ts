import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import type {PrismaClient} from '@prisma/client';
import {calendarBaseline,deleteCalendarUsers} from './helpers/calendar-acceptance';import {createCalendarAnalyticsFixture} from './helpers/calendar-analytics-fixture';
export async function runCalendarAnalyticsHttp(db:PrismaClient,request:(path:string,id:string)=>Promise<Response>){
 const before=await calendarBaseline(db),marker='qa108-http-'+randomUUID();
 try{
  const f=await db.$transaction(tx=>createCalendarAnalyticsFixture(tx,marker));
  const path='/plan/analytics?from=2026-10-07&to=2026-10-08';
  const own=await request(path+'&ownerId='+f.other.id,marker);assert.equal(own.status,200);const html=await own.text();
  for(const value of ['Аналитика плана','Итоги периода','3 ч 30 мин','1 ч 45 мин','QA108 В начале диапазона','QA108 В конце диапазона'])assert.ok(html.includes(value),'RENDER_MISSING:'+value);
  for(const value of ['BEFORE_QA108_SECRET','AFTER_QA108_SECRET','FOREIGN_QA107_SECRET','qa-login-disabled'])assert.ok(!html.includes(value),'SCOPE_LEAK:'+value);
  const other=await request(path,f.other.id);assert.equal(other.status,200);const otherHtml=await other.text();assert.ok(otherHtml.includes('FOREIGN_QA107_SECRET'));assert.ok(!otherHtml.includes('QA108 В начале диапазона'));
  const bad=await request('/plan/analytics?from=2026-10-08&to=2026-10-07',marker);assert.equal(bad.status,200);assert.ok((await bad.text()).includes('Укажите корректный период'));
  const empty=await request('/plan/analytics?from=2026-12-01&to=2026-12-02',marker);assert.equal(empty.status,200);assert.ok((await empty.text()).includes('Записей в выбранном периоде нет'));
  const calendar=await request('/plan?date=2026-10-07',marker);assert.equal(calendar.status,200);assert.ok((await calendar.text()).includes('/plan/analytics?from=2026-10-01&amp;to=2026-10-31'));
  await db.user.update({where:{id:marker},data:{calendarEnabled:false,sessionVersion:{increment:1}}});
  const disabled=await request(path,marker);assert.ok(!(await disabled.text()).includes('QA108 В начале диапазона'));
  return {status:'PASS',routes:['analytics','invalid','empty','calendar-link'],privacy:'OWNER_ADMIN_DISABLED_QUERY_INJECTION',providerMessages:0};
 }finally{await db.$transaction(tx=>deleteCalendarUsers(tx,marker));assert.deepEqual(await calendarBaseline(db),before,'HTTP_ORIGINAL_DATA_CHANGED');}
}
