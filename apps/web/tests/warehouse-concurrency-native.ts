import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {existingLocalCrmDatabaseUrl} from './helpers/local-crm-database';
import {warehouseMove} from '../src/server/warehouse/accounting';
async function main(){
 const db=new PrismaClient({datasourceUrl:existingLocalCrmDatabaseUrl()}),run=randomUUID(),tag='QA_WH94_RACE_'+run;
 assert.equal(await db.warehouseAccountingState.count(),0,'existing local accounting must not be replaced');
 const before=await db.$queryRaw`SELECT warehouse_protected_snapshot() snapshot`;
 const actor={id:tag,roles:['ADMIN' as const]};
 let prepared=false;
 try{
  await db.$transaction(async tx=>{
   await tx.user.create({data:{id:tag,name:tag,email:tag+'@qa.invalid',passwordHash:'not-used',roles:['ADMIN']}});
   await tx.client.create({data:{id:tag+'-client',name:tag,phone:'0000000000'}});
   await tx.project.create({data:{id:tag+'-project',number:tag,numberInt:2000000094,title:tag,clientId:tag+'-client'}});
   await tx.product.create({data:{id:tag+'-product',projectId:tag+'-project',number:tag+'.1',title:tag,status:'PRODUCTION'}});
   await tx.material.create({data:{id:tag+'-material',name:tag,purchasePrice:0}});
   await tx.projectMaterial.create({data:{id:tag+'-line',productId:tag+'-product',materialId:tag+'-material',quantity:100}});
   await tx.warehouseAccountingState.create({data:{id:'main',runId:run,phase:'ACTIVE',beforePrices:[],beforeBalances:[],backupSha256:'b'.repeat(64),proofSha256:'c'.repeat(64)}});
  });prepared=true;
  const move=(input:Parameters<typeof warehouseMove>[2])=>db.$transaction(tx=>warehouseMove(tx,actor,input),{maxWait:10000,timeout:15000});
  await move({kind:'INCOME',clientMutationId:randomUUID(),materialId:tag+'-material',quantity:5,unitPrice:5});
  const issueResults=await Promise.allSettled([1,2].map(()=>move({kind:'EXPENSE',clientMutationId:randomUUID(),projectMaterialId:tag+'-line',quantity:4})));
  assert.equal(issueResults.filter(item=>item.status==='fulfilled').length,1);
  assert.equal((await db.warehouseBalance.findUniqueOrThrow({where:{materialId:tag+'-material'}})).quantity.toString(),'1');
  const receipt={kind:'INCOME' as const,clientMutationId:randomUUID(),materialId:tag+'-material',quantity:2,unitPrice:9};
  const duplicates=await Promise.all([move(receipt),move(receipt)]);
  assert.equal(duplicates.filter(item=>item.repeated).length,1);
  assert.equal(await db.stockMovement.count({where:{materialId:tag+'-material',type:'INCOME'}}),2);
  const issued=await db.stockMovement.findFirstOrThrow({where:{materialId:tag+'-material',type:'EXPENSE'}});
  const returned=await Promise.allSettled([1,2].map(()=>move({kind:'RETURN',clientMutationId:randomUUID(),projectMaterialId:tag+'-line',quantity:3,sourceMovementId:issued.id})));
  assert.equal(returned.filter(item=>item.status==='fulfilled').length,1);
  assert.equal((await db.warehouseMovementValuation.findUniqueOrThrow({where:{movementId:issued.id}})).returnedQuantity.toString(),'3');
  assert.equal((await db.warehouseBalance.findUniqueOrThrow({where:{materialId:tag+'-material'}})).quantity.toString(),'6');
 }finally{
  if(prepared)await db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18436,94001)`;
   const owned=await tx.warehouseAccountingState.findUnique({where:{id:'main'}});assert.equal(owned!.runId,run);
   assert.equal(await tx.stockMovement.count({where:{materialId:tag+'-material',createdById:{not:tag}}}),0);
   const valuations=await tx.warehouseMovementValuation.findMany({where:{runId:run,actorId:tag},select:{clientMutationId:true,movementId:true}});
   const eventIds=valuations.map(item=>'warehouse94-'+item.clientMutationId);
   assert.equal(await tx.domainEvent.count({where:{id:{in:eventIds},actor:tag}}),valuations.length);
   await tx.domainEvent.deleteMany({where:{id:{in:eventIds},actor:tag}});
   await tx.changeLog.deleteMany({where:{id:{in:eventIds},actorId:tag,entityId:{in:valuations.map(item=>item.movementId)}}});
   await tx.warehouseMovementValuation.deleteMany({where:{runId:run,actorId:tag}});
   await tx.warehouseBalance.deleteMany({where:{materialId:tag+'-material',runId:run}});
   await tx.stockMovement.deleteMany({where:{materialId:tag+'-material',createdById:tag}});
   await tx.projectMaterial.delete({where:{id:tag+'-line'}});await tx.material.delete({where:{id:tag+'-material'}});
   await tx.product.delete({where:{id:tag+'-product'}});await tx.project.delete({where:{id:tag+'-project'}});
   await tx.client.delete({where:{id:tag+'-client'}});await tx.user.delete({where:{id:tag}});
   await tx.warehouseAccountingState.delete({where:{id:'main'}});
  },{timeout:20000});
  assert.deepEqual(await db.$queryRaw`SELECT warehouse_protected_snapshot() snapshot`,before);
  await db.$disconnect();
 }
 console.log(JSON.stringify({status:'PASS',target:'existing local 5433',concurrentIssue:'ONE_SUCCESS_NO_NEGATIVE',duplicateIncome:'ONE_MUTATION',concurrentReturn:'ONE_SUCCESS',ownedFixtures:'REMOVED',allOriginalData:'MATCH'}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
