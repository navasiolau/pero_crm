import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { createTaskTransaction } from "../src/server/tasks/transaction";
import { warehouseMove } from "../src/server/warehouse/accounting";
import { addMaterialNorm, updateMaterialNorm } from "../src/server/warehouse/norm-core";
import { getProjectEconomics } from "../src/server/finance/queries";
import { loadProjectStockExpenses, projectExpenseRows } from "../src/server/finance/project-expenses";
import { getProjectMaterials } from "../src/server/warehouse/queries";
export async function directStockBaseline(db:PrismaClient){
 const result:Record<string,unknown>={};
 for(const table of ["WarehouseAccountingState","WarehouseBalance","WarehouseMovementValuation","StockMovement","Material","ProjectMaterial","Client","Project","Product","User","Payment","Payout","ChangeLog","DomainEvent"])
  result[table]=await db.$queryRawUnsafe(`SELECT count(*)::text n,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest FROM (SELECT md5(to_jsonb(t)::text) h FROM "${table}" t) x`);
 return result;
}
export async function runDirectStockNative(db:PrismaClient){
 const before=await directStockBaseline(db),marker=`qa104-${randomUUID()}`,abort=Error("QA104_ROLLBACK");let verified=false;
 try{
  await createTaskTransaction(db)(async tx=>{
   const state=await tx.warehouseAccountingState.findUnique({where:{id:"main"}});
   if(state)assert.equal(state.phase,"ACTIVE");
   else{
    assert.notEqual(process.env.CRM_BYN_NATIVE_TARGET,"staging","STAGING_REQUIRES_ACTIVE");
    await tx.warehouseAccountingState.create({data:{id:"main",phase:"ACTIVE",runId:marker,beforePrices:{},beforeBalances:{}}});
   }
   const user=await tx.user.create({data:{id:marker,name:marker,email:marker+"@invalid.local",passwordHash:"qa-login-disabled",roles:["PROCUREMENT"]}});
   const actor={id:user.id,name:user.name,roles:user.roles,source:"telegram" as const};
   const client=await tx.client.create({data:{name:marker,phone:"QA"}});
   const max=await tx.project.aggregate({_max:{numberInt:true}}),number=(max._max.numberInt??0)+1;
   const project=await tx.project.create({data:{number:String(number),numberInt:number,title:marker,clientId:client.id}});
   const product=await tx.product.create({data:{number:number+".1",title:marker,projectId:project.id,expectedPrice:1000}});
   const other=await tx.product.create({data:{number:number+".2",title:marker,projectId:project.id,expectedPrice:0}});
   const material=await tx.material.create({data:{name:marker,purchasePrice:0}});
   const payments=await tx.payment.count(),payouts=await tx.payout.count();
   await warehouseMove(tx,actor,{kind:"INCOME",materialId:material.id,quantity:"5",unitPrice:"20",clientMutationId:randomUUID()});
   const input={kind:"EXPENSE" as const,productId:product.id,materialId:material.id,quantity:"3",clientMutationId:randomUUID(),comment:marker};
   const first=await warehouseMove(tx,actor,input);
   assert.equal(first.movement.projectMaterialId,null);assert.equal(first.movement.productId,product.id);
   assert.equal(first.movement.totalByn?.toFixed(2),"60.00");
   assert.equal(await tx.projectMaterial.count({where:{productId:product.id}}),0);
   const economics=await getProjectEconomics(project.id,tx);assert.equal(economics?.expensesTotal,60);
   const rows=projectExpenseRows([],await loadProjectStockExpenses(actor,project.id,tx),new Map([[actor.id,actor.name]]));
   assert.equal(rows.length,1);assert.equal(rows[0].bynAmount,60);assert.equal(rows[0].stock?.unitPrice,"20");
   const operational=await getProjectMaterials(product.id,actor,tx);
   assert.equal(operational.lines.length,0);assert.equal(operational.returnSources.length,1);
   assert.equal(operational.materialsTotalByn,60);assert.equal(operational.returnSources[0].unitPrice,"20");
   const hidden=await getProjectMaterials(product.id,{...actor,roles:["MANAGER"]},tx);
   assert.equal(hidden.materialsTotalByn,null);assert.equal(hidden.returnSources[0].unitPrice,null);
   assert.equal(hidden.movements[0].totalByn,null);
   assert.equal((await warehouseMove(tx,actor,input)).movement.id,first.movement.id);
   await assert.rejects(warehouseMove(tx,actor,{...input,quantity:"100",clientMutationId:randomUUID()}),/Недостаточно материала/);
   await assert.rejects(warehouseMove(tx,actor,{kind:"RETURN",productId:other.id,sourceMovementId:first.movement.id,quantity:"1",clientMutationId:randomUUID()}),/Исходная выдача/);
   const {line}=await addMaterialNorm(tx,{productId:product.id,materialId:material.id,quantityPerUnit:2},actor.id);
   assert.equal(line.quantity.toString(),"2");assert.equal(line.issuedQty.toString(),"3");
   await updateMaterialNorm(tx,{id:line.id,quantityPerUnit:2,comment:"same plan after excess issue"});
   const excess=await warehouseMove(tx,actor,{kind:"EXPENSE",projectMaterialId:line.id,quantity:"1",clientMutationId:randomUUID()});
   const afterExcess=await tx.projectMaterial.findUniqueOrThrow({where:{id:line.id}});
   assert.equal(afterExcess.quantity.toString(),"2");assert.equal(afterExcess.issuedQty.toString(),"4");
   await warehouseMove(tx,actor,{kind:"INCOME",materialId:material.id,quantity:"2",unitPrice:"40",clientMutationId:randomUUID()});
   assert.equal((await tx.stockMovement.findUniqueOrThrow({where:{id:first.movement.id}})).totalByn?.toFixed(2),"60.00");
   assert.equal((await getProjectEconomics(project.id,tx))?.expensesTotal,80);
   await assert.rejects(warehouseMove(tx,actor,{kind:"RETURN",projectMaterialId:line.id,quantity:"1",unitPrice:"100",clientMutationId:randomUUID()}),/исходную выдачу/);
   const returned={kind:"RETURN" as const,productId:product.id,sourceMovementId:first.movement.id,quantity:"1",clientMutationId:randomUUID()};
   const partial=await warehouseMove(tx,actor,returned);
   assert.equal(partial.movement.totalByn?.toFixed(2),"20.00");
   assert.equal((await getProjectEconomics(project.id,tx))?.expensesTotal,60);
   assert.equal((await warehouseMove(tx,actor,returned)).repeated,true);
   await warehouseMove(tx,actor,{...returned,quantity:"2",clientMutationId:randomUUID()});
   await assert.rejects(warehouseMove(tx,actor,{...returned,quantity:"0.001",clientMutationId:randomUUID()}),/Нельзя вернуть/);
   await warehouseMove(tx,actor,{...returned,sourceMovementId:excess.movement.id,quantity:"1",clientMutationId:randomUUID()});
   assert.equal((await getProjectEconomics(project.id,tx))?.expensesTotal,0);
   const balance=await tx.warehouseBalance.findUniqueOrThrow({where:{materialId:material.id}});
   assert.equal(balance.quantity.toString(),"7");assert.equal(balance.valueByn.toFixed(2),"180.00");
   assert.equal((await tx.projectMaterial.findUniqueOrThrow({where:{id:line.id}})).issuedQty.toString(),"0");
   assert.equal((await warehouseMove(tx,actor,input)).movement.id,first.movement.id);
   assert.equal(await tx.payment.count(),payments);assert.equal(await tx.payout.count(),payouts);
   await tx.stockMovement.createMany({data:Array.from({length:501},()=>({productId:product.id,materialId:material.id,type:"EXPENSE" as const,quantity:1,totalByn:1,unitPrice:1}))});
   const full=await getProjectMaterials(product.id,actor,tx);
   assert.equal(full.movements.length,500);assert.equal(full.materialsTotalByn,501);
   await tx.stockMovement.create({data:{productId:product.id,materialId:material.id,type:"EXPENSE",quantity:1,totalByn:null,unitPrice:null}});
   assert.equal((await getProjectMaterials(product.id,actor,tx)).materialsTotalByn,null);
   await assert.rejects(warehouseMove(tx,{...actor,roles:["WORKER"]},input),/прав/);
   verified=true;throw abort;
  });
 }catch(error){if(error!==abort)throw error;}
 assert.ok(verified);assert.deepEqual(await directStockBaseline(db),before,"ORIGINAL_DATA_CHANGED");
 return {status:"PASS",firstIssue:60,sourceReturn:20,finalExpenses:0,finalQuantity:7,finalStockValue:180,noDummyNeed:true,newNeedHasPriorIssues:true,overPlan:true,payments:"UNCHANGED",originalData:"MATCH",qaRows:"ROLLED_BACK",providerMessages:0};
}
