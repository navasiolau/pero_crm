import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import type {PrismaClient} from "@prisma/client";
import {createTaskTransaction} from "../src/server/tasks/transaction";
import {loadCashStatement} from "../src/server/finance/cash-statement";
import {readCashBalance} from "../src/server/payroll/cash-core";
import {cashStatementBaseline,createCashStatementFixture,statementQuery} from "./helpers/cash-statement-fixture";
export async function runCashStatementNative(db:PrismaClient){
 const before=await cashStatementBaseline(db),rollback=new Error("QA105_ROLLBACK");let verified=false;
 try{await createTaskTransaction(db)(async tx=>{
  const fixture=await createCashStatementFixture(tx,"qa105-"+randomUUID()),actor={id:fixture.user.id,roles:fixture.user.roles};
  const byn=await loadCashStatement(actor,statementQuery,tx),native=await loadCashStatement(actor,{...statementQuery,mode:"NATIVE"},tx);
  assert.deepEqual(byn.rows.find(row=>row.id===fixture.byn.id)?.totals,{opening:"100.00",income:"50.00",expense:"-35.00",closing:"115.00"});
  assert.equal(byn.rows.find(row=>row.id===fixture.usd.id)?.totals.closing,"252.00");
  assert.equal(native.rows.find(row=>row.id===fixture.usd.id)?.totals.closing,"85.00");
  assert.equal(native.rows.find(row=>row.id===fixture.usd.id)?.active,false);
  assert.equal(byn.rows.find(row=>row.id===fixture.unknown.id)?.totals.closing,"0.00");
  assert.ok(byn.rows.some(row=>row.unassigned&&row.totals.closing===null&&row.entries.some(e=>e.id==="payout:"+actor.id+"-unassigned"&&e.change===null)));
  assert.ok(native.rows.some(row=>row.unassigned&&row.entries.some(e=>e.id==="payout:"+actor.id+"-unassigned"&&e.change===null)));
  const full=await loadCashStatement(actor,{...statementQuery,to:"2026-10-08",mode:"NATIVE"},tx);
  for(const account of [fixture.byn,fixture.usd])assert.equal(full.rows.find(row=>row.id===account.id)?.totals.closing,(await readCashBalance(tx,account.id)).toFixed(2));
  assert.equal(byn.rows.find(row=>row.id===fixture.byn.id)?.entries.length,4);
  assert.ok(!JSON.stringify(byn).includes("qa-login-disabled"));
  await assert.rejects(loadCashStatement({id:actor.id,roles:["MANAGER"]},statementQuery,tx),/прав/);
  const combined=await loadCashStatement({id:actor.id,roles:["MANAGER","ACCOUNTANT"]},statementQuery,tx);
  assert.deepEqual(combined,byn);
  verified=true;throw rollback;
 });}catch(error){if(error!==rollback)throw error;}
 assert.ok(verified);assert.deepEqual(await cashStatementBaseline(db),before);
 return {status:"PASS",bynClosing:"115.00",usdNativeClosing:"85.00",usdSavedBynClosing:"252.00",salaryAndAdvance:"ONCE",balanceCore:"MATCH",history:"EXPLICIT_NULL_AND_UNASSIGNED",originalData:"MATCH",qaRows:"ROLLED_BACK",providerMessages:0};
}
