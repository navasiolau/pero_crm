import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import type {PrismaClient} from '@prisma/client';
import {createTaskTransaction} from '../src/server/tasks/transaction';
import {withWarehouseWrite,warehouseMove} from '../src/server/warehouse/accounting';
import {previewMovementDeletionInTransaction,deleteMovementInTransaction} from '../src/server/warehouse/deletion-core';
import {readCashBalance} from '../src/server/payroll/cash-core';
import {warehouseTestState} from './helpers/warehouse-test-state';
import {createDeletionFixture,deleteDeletionFixture,deletionBaseline} from './helpers/warehouse-deletion-fixture';

export async function runWarehouseDeletionConcurrent(db:PrismaClient,allowLocal=false){
 const before=await deletionBaseline(db),checks:string[]=[];
 for(const mode of ['duplicate','stale','issue-race'] as const){
  const marker='qa109-race-'+randomUUID(),state=await warehouseTestState(db,marker,allowLocal),money=createTaskTransaction(db);
  try{
   const f=await money(tx=>createDeletionFixture(state.wrap(tx),marker));
   const preview=await money(tx=>previewMovementDeletionInTransaction(state.wrap(tx),f.actor,f.receipt.receipt.movementId));
   const input={movementId:preview.movementId,planFingerprint:preview.planFingerprint,clientMutationId:randomUUID()};
   const remove=()=>money(tx=>deleteMovementInTransaction(state.wrap(tx),f.actor,input));
   const issue=()=>withWarehouseWrite(tx=>warehouseMove(state.wrap(tx),f.actor,{kind:'EXPENSE',productId:marker,materialId:marker,quantity:'1',clientMutationId:randomUUID()}),db);
   if(mode==='duplicate'){
    const results=await Promise.all([remove(),remove()]);assert.equal(results[0].id,results[1].id);assert.equal(results.filter(row=>!row.repeated).length,1);
    assert.equal(await db.warehouseMovementDeletion.count({where:{actorId:marker}}),1);
    assert.equal((await money(tx=>readCashBalance(tx,marker))).toFixed(2),'10000.00');
   }else if(mode==='stale'){
    await issue();const checkpoint=await deletionBaseline(db);
    await assert.rejects(remove(),/Обновите расчёт/);assert.deepEqual(await deletionBaseline(db),checkpoint);
    assert.equal(await db.warehouseMovementDeletion.count({where:{actorId:marker}}),0);
   }else{
    const results=await Promise.allSettled([remove(),issue()]);assert.equal(results.filter(row=>row.status==='fulfilled').length,1);
    const failed=results.find(row=>row.status==='rejected');assert.ok(failed&&failed.status==='rejected');assert.match(String(failed.reason),/Обновите расчёт|Недостаточно материала/);
    const balance=await db.warehouseBalance.findUniqueOrThrow({where:{materialId:marker}});assert.ok(balance.quantity.gte(0)&&balance.valueByn.gte(0));
    const deleted=await db.warehouseMovementDeletion.count({where:{actorId:marker}});
    assert.equal(balance.quantity.toString(),deleted?'0':'36');
    assert.equal((await money(tx=>readCashBalance(tx,marker))).toFixed(2),deleted?'10000.00':'6300.00');
   }
   checks.push(mode);
  }finally{await money(tx=>deleteDeletionFixture(tx,marker));assert.deepEqual(await deletionBaseline(db),before,'RACE_ORIGINAL_DATA_CHANGED:'+mode);}
 }
 return {status:'PASS',scenarios:checks,originalData:'MATCH',qaRows:0,providerMessages:0};
}
