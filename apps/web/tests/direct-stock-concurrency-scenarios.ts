import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PrismaClient, Prisma } from "@prisma/client";
import { createTaskTransaction } from "../src/server/tasks/transaction";
import { warehouseMove, type WarehouseMovementInput } from "../src/server/warehouse/accounting";
import { addMaterialNorm } from "../src/server/warehouse/norm-core";
import { getProjectEconomics } from "../src/server/finance/queries";
import { directStockBaseline } from "./direct-stock-native-scenarios";
import { warehouseTestState } from "./helpers/warehouse-test-state";

export async function runDirectStockConcurrent(db:PrismaClient,allowMissingLocalState=false){
 const before=await directStockBaseline(db),marker=`qa104-race-${randomUUID()}`;
 const state=await warehouseTestState(db,marker,allowMissingLocalState),setup=createTaskTransaction(db);
 let productId="",projectId="",clientId="",materialId="";
 const txOptions={maxWait:10000,timeout:15000,isolationLevel:"ReadCommitted" as const};
 try{
  const actor=await setup(async tx=>{
   const user=await tx.user.create({data:{id:marker,name:marker,email:marker+"@invalid.local",passwordHash:"qa-login-disabled",roles:["PROCUREMENT"]}});
   clientId=(await tx.client.create({data:{name:marker,phone:"QA"}})).id;
   const max=await tx.project.aggregate({_max:{numberInt:true}}),number=(max._max.numberInt??0)+1;
   projectId=(await tx.project.create({data:{number:String(number),numberInt:number,title:marker,clientId}})).id;
   productId=(await tx.product.create({data:{number:number+".1",title:marker,projectId,expectedPrice:1000}})).id;
   materialId=(await tx.material.create({data:{name:marker,purchasePrice:0}})).id;
   const actor={id:user.id,name:user.name,roles:user.roles,source:"web" as const};
   await warehouseMove(state.wrap(tx),actor,{kind:"INCOME",materialId,quantity:"8",unitPrice:"20",clientMutationId:randomUUID(),comment:marker});
   return actor;
  });
  // Deliberately no monetary lock: these are the production stock transaction/row locks.
  const execute=(input:WarehouseMovementInput)=>db.$transaction(tx=>warehouseMove(state.wrap(tx),actor,input),txOptions);
  const input={kind:"EXPENSE" as const,productId,materialId,quantity:"3",clientMutationId:randomUUID(),comment:marker};
  const duplicate=await Promise.all([execute(input),execute(input)]);
  assert.equal(duplicate[0].movement.id,duplicate[1].movement.id);assert.equal(duplicate.filter(row=>!row.repeated).length,1);
  const competing=await Promise.allSettled([execute({...input,clientMutationId:randomUUID()}),execute({...input,clientMutationId:randomUUID()})]);
  assert.equal(competing.filter(row=>row.status==="fulfilled").length,1);
  const second=competing.find(row=>row.status==="fulfilled");assert.ok(second&&second.status==="fulfilled");
  const rejected=competing.find(row=>row.status==="rejected");assert.ok(rejected&&rejected.status==="rejected");assert.match(String(rejected.reason),/Недостаточно материала/);
  const [extra,norm]=await Promise.all([execute({...input,quantity:"1",clientMutationId:randomUUID()}),
   setup(tx=>addMaterialNorm(tx,{productId,materialId,quantityPerUnit:2},actor.id))]);
  const line=await db.projectMaterial.findUniqueOrThrow({where:{id:norm.line.id}});
  assert.equal(line.quantity.toString(),"2");assert.equal(line.issuedQty.toString(),"7");
  assert.equal((await getProjectEconomics(projectId,db))?.expensesTotal,140);
  const back={kind:"RETURN" as const,productId,sourceMovementId:duplicate[0].movement.id,quantity:"2",comment:marker};
  const returns=await Promise.allSettled([execute({...back,clientMutationId:randomUUID()}),execute({...back,clientMutationId:randomUUID()})]);
  assert.equal(returns.filter(row=>row.status==="fulfilled").length,1);
  const rejectedReturn=returns.find(row=>row.status==="rejected");assert.ok(rejectedReturn&&rejectedReturn.status==="rejected");assert.match(String(rejectedReturn.reason),/Нельзя вернуть/);
  await execute({...back,quantity:"1",clientMutationId:randomUUID()});
  await execute({...back,sourceMovementId:second.value.movement.id,quantity:"3",clientMutationId:randomUUID()});
  await execute({...back,sourceMovementId:extra.movement.id,quantity:"1",clientMutationId:randomUUID()});
  assert.equal((await getProjectEconomics(projectId,db))?.expensesTotal,0);
  assert.equal((await db.projectMaterial.findUniqueOrThrow({where:{id:line.id}})).issuedQty.toString(),"0");
  assert.equal((await db.warehouseBalance.findUniqueOrThrow({where:{materialId}})).quantity.toString(),"8");
  assert.equal(await db.payment.count({where:{createdById:marker}}),0);
  const beforeFailure=await db.warehouseBalance.findUniqueOrThrow({where:{materialId}});
  const failure=Error("QA104_EVENT_FAILURE");
  await assert.rejects(db.$transaction(async tx=>{
   const gated=state.wrap(tx),fault=new Proxy(gated,{get(target,property,receiver){
    if(property==="domainEvent")return {...target.domainEvent,create:async()=>{throw failure;}};
    return Reflect.get(target,property,receiver);
   }}) as Prisma.TransactionClient;
   await warehouseMove(fault,actor,{...input,quantity:"1",clientMutationId:randomUUID()});
  },txOptions),error=>error===failure);
  assert.deepEqual(await db.warehouseBalance.findUniqueOrThrow({where:{materialId}}),beforeFailure);
  return {status:"PASS",duplicateWrites:1,competingIssues:1,competingReturns:1,needCreationRace:"MATCH",finalProjectExpense:0,finalStock:8,eventFailure:"ROLLED_BACK",warehouseState:state.mode,providerMessages:0};
 }finally{
  await setup(async tx=>{
   await tx.warehouseMovementValuation.deleteMany({where:{actorId:marker,movement:{materialId}}});
   await tx.stockMovement.deleteMany({where:{materialId,createdById:marker}});
   await tx.projectMaterial.deleteMany({where:{productId,materialId}});
   if(materialId)await tx.warehouseBalance.deleteMany({where:{materialId}});
   await tx.changeLog.deleteMany({where:{actorId:marker}});await tx.domainEvent.deleteMany({where:{actor:marker}});
   if(materialId)await tx.material.deleteMany({where:{id:materialId,name:marker}});
   if(productId)await tx.product.deleteMany({where:{id:productId,title:marker}});
   if(projectId)await tx.project.deleteMany({where:{id:projectId,title:marker}});
   if(clientId)await tx.client.deleteMany({where:{id:clientId,name:marker}});
   await tx.user.deleteMany({where:{id:marker,name:marker}});
  });
  assert.deepEqual(await directStockBaseline(db),before,"CONCURRENCY_ORIGINAL_DATA_CHANGED");
 }
}
