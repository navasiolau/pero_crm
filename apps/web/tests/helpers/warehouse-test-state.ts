import assert from "node:assert/strict";
import type { Prisma, PrismaClient } from "@prisma/client";

/** Test-only phase fixture for bounded local rows. No global state is written. */
export async function warehouseTestState(db:PrismaClient,runId:string,allowMissingLocalState=false){
 const original=await db.warehouseAccountingState.findUnique({where:{id:"main"}});
 if(original)assert.equal(original.phase,"ACTIVE");
 else{
  assert.ok(allowMissingLocalState,"STAGING_REQUIRES_REAL_ACTIVE_STATE");
  const target=new URL(process.env.DATABASE_URL??"");
  assert.ok(["localhost","127.0.0.1"].includes(target.hostname)&&target.port==="5433"&&target.pathname==="/pero_crm");
 }
 return {mode:original?"REAL_ACTIVE":"LOCAL_READ_FIXTURE",wrap:(tx:Prisma.TransactionClient):Prisma.TransactionClient=>{
  if(original)return tx;
  return new Proxy(tx,{get(target,property,receiver){
   if(property==="warehouseAccountingState")return {findUnique:async(args:{where:{id:string}})=>{
    assert.equal(args.where.id,"main");
    assert.equal(await target.warehouseAccountingState.count(),0,"WAREHOUSE_STATE_CHANGED_DURING_TEST");
    return {id:"main",phase:"ACTIVE",runId};
   }};
   return Reflect.get(target,property,receiver);
  }});
 }};
}
