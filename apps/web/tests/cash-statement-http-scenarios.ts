import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import type {PrismaClient} from "@prisma/client";
import {createTaskTransaction} from "../src/server/tasks/transaction";
import {cashStatementBaseline,createCashStatementFixture,deleteCashStatementFixture} from "./helpers/cash-statement-fixture";
/** Requests read real deployed routes; the exact owned historical fixture has no effects. */
export async function runCashStatementHttp(db:PrismaClient,request:(path:string,id:string)=>Promise<Response>){
 const before=await cashStatementBaseline(db),marker="qa105-http-"+randomUUID();
 try{
  await createTaskTransaction(db)(tx=>createCashStatementFixture(tx,marker));
  const path="/finance/accounts/report?from=2026-10-07&to=2026-10-07&mode=";
  for(const mode of ["BYN","NATIVE"]){
   const response=await request(path+mode,marker);assert.equal(response.status,200);
   const html=await response.text();
   for(const text of ["Отчёт по кассам","QA105 Касса BYN","QA105 Касса USD","QA105 Неполная история","115.00","Нет данных","Зарплата","Аванс"])assert.ok(html.includes(text),"RENDER_MISSING:"+text);
   assert.ok(html.includes(mode==="BYN"?"252.00":"85.00"));assert.ok(!html.includes("qa-login-disabled"));
  }
  const invalid=await request("/finance/accounts/report?from=2026-10-08&to=2026-10-07",marker);
  assert.equal(invalid.status,200);assert.ok((await invalid.text()).includes("Укажите корректный период"));
  await db.user.update({where:{id:marker},data:{roles:["MANAGER"],sessionVersion:{increment:1}}});
  const denied=await request(path+"BYN",marker);assert.ok([302,303,307,308].includes(denied.status));assert.ok(!(await denied.text()).includes("QA105 Касса"));
  await db.user.update({where:{id:marker},data:{roles:["MANAGER","ACCOUNTANT"],sessionVersion:{increment:1}}});
  assert.equal((await request(path+"BYN",marker)).status,200);
  return {status:"PASS",routes:["BYN","NATIVE","invalid-range"],roles:["supplier","manager-denied","combined"],providerMessages:0};
 }finally{
  await createTaskTransaction(db)(tx=>deleteCashStatementFixture(tx,marker));
  assert.deepEqual(await cashStatementBaseline(db),before,"HTTP_ORIGINAL_DATA_CHANGED");
 }
}
