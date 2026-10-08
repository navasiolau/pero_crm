import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {createTaskTransaction} from '../src/server/tasks/transaction';
import {warehouseMove} from '../src/server/warehouse/accounting';
import {previewMovementDeletionInTransaction,deleteMovementInTransaction} from '../src/server/warehouse/deletion-core';
import {readCashBalance,readOrgBalance} from '../src/server/payroll/cash-core';
import {getProjectEconomics} from '../src/server/finance/queries';
import {loadProjectStockExpenses} from '../src/server/finance/project-expenses';
import {loadOrganizationPayments} from '../src/server/finance/organization-ledger';
import {loadCashStatement} from '../src/server/finance/cash-statement';
import {getProjectMaterials,listMovements} from '../src/server/warehouse/queries';
import {createStockPurchaseInTransaction} from '../src/server/warehouse/stock-purchase-core';
import {createDeletionFixture,deletionBaseline} from './helpers/warehouse-deletion-fixture';

export async function runWarehouseDeletionNative(db:PrismaClient){
 const before=await deletionBaseline(db),checked:string[]=[];
 for(const mode of ['paid','inventory','cascade','return','fx','last-write-failure'] as const){
  const marker='qa109-native-'+randomUUID(),abort=Error('QA109_ROLLBACK'),fault=Error('QA109_FINAL_WRITE');
  try{await createTaskTransaction(db)(async tx=>{
   const state=await tx.warehouseAccountingState.findUnique({where:{id:'main'}});
   if(state)assert.equal(state.phase,'ACTIVE');
   else{assert.notEqual(process.env.CRM_BYN_NATIVE_TARGET,'staging');await tx.warehouseAccountingState.create({data:{id:'main',phase:'ACTIVE',runId:marker,beforePrices:{},beforeBalances:{}}});}
   const f=await createDeletionFixture(tx,marker,mode==='fx'?'USD':'BYN');
   const movementId=f.receipt.receipt.movementId;
   const legacy=await tx.stockMovement.create({data:{materialId:marker,type:'INCOME',quantity:1,createdById:marker,comment:marker}});
   await assert.rejects(previewMovementDeletionInTransaction(tx,f.actor,legacy.id),/Недостаточно данных/);
   let rootId=movementId,issueId='',returnId='',independentId='';
   if(mode==='inventory')rootId=(await warehouseMove(tx,f.actor,{kind:'INCOME',materialId:marker,quantity:'37',unitPrice:'100',clientMutationId:randomUUID()})).movement.id;
   const issueInput={kind:'EXPENSE' as const,productId:f.product.id,materialId:f.material.id,quantity:'10',clientMutationId:randomUUID()};
   if(mode==='cascade'||mode==='return'){
    issueId=(await warehouseMove(tx,f.actor,issueInput)).movement.id;
    returnId=(await warehouseMove(tx,f.actor,{kind:'RETURN',productId:f.product.id,sourceMovementId:issueId,quantity:'3',clientMutationId:randomUUID()})).movement.id;
    await tx.projectMaterial.create({data:{id:marker,productId:f.product.id,materialId:f.material.id,quantity:30,quantityPerUnit:30,issuedQty:7}});
    assert.equal((await getProjectEconomics(f.project.id,tx))?.expensesTotal,700);
    if(mode==='cascade')independentId=(await warehouseMove(tx,f.actor,{kind:'INCOME',materialId:f.material.id,quantity:'5',unitPrice:'200',clientMutationId:randomUUID()})).movement.id;
    else rootId=returnId;
   }
   for(const role of ['DIRECTOR','PROCUREMENT','ACCOUNTANT','MANAGER'] as const)
    await assert.rejects(previewMovementDeletionInTransaction(tx,{...f.actor,roles:[role]},rootId),/администратор/);
   await tx.user.update({where:{id:marker},data:{roles:['PROCUREMENT']}});
   await assert.rejects(previewMovementDeletionInTransaction(tx,f.actor,rootId),/администратор/);
   await tx.user.update({where:{id:marker},data:{roles:['ADMIN']}});
   const preview=await previewMovementDeletionInTransaction(tx,f.actor,rootId);
   const input={movementId:rootId,clientMutationId:randomUUID(),planFingerprint:preview.planFingerprint};
   const originalOrg=await readOrgBalance(tx,'1'),originalIncome=await tx.payment.count({where:{direction:'INCOME'}});
   if(mode==='last-write-failure'){
    const wrapped=new Proxy(tx,{get(target,property,receiver){if(property==='domainEvent')return {...target.domainEvent,create:async()=>{assert.equal(await tx.stockMovement.count({where:{deletionId:{not:null},materialId:marker}}),1);throw fault;}};return Reflect.get(target,property,receiver);}});
    await deleteMovementInTransaction(wrapped,f.actor,input);assert.fail('FAULT_NOT_REACHED');
   }
   const result=await deleteMovementInTransaction(tx,f.actor,input);assert.equal(result.repeated,false);
   const repeat=await deleteMovementInTransaction(tx,f.actor,input);assert.equal(repeat.id,result.id);assert.equal(repeat.repeated,true);
   assert.equal(await tx.warehouseMovementDeletion.count({where:{actorId:marker}}),1);
   assert.equal(await tx.payment.count({where:{direction:'INCOME'}}),originalIncome);
   await assert.rejects(deleteMovementInTransaction(tx,f.actor,{...input,planFingerprint:'f'.repeat(64)}),/другими данными/);
   const stock=await tx.warehouseBalance.findUniqueOrThrow({where:{materialId:marker}});
   const materials=await getProjectMaterials(f.product.id,f.actor,tx);
   const movements=await listMovements(f.actor,{materialId:marker},tx);
   assert.ok(movements.every(row=>!preview.movements.some(deleted=>deleted.id===row.id)));
   if(mode==='return'){
    assert.equal(preview.refunds.length,0);assert.equal(stock.quantity.toString(),'27');
    assert.equal((await getProjectEconomics(f.project.id,tx))?.expensesTotal,1000);
    assert.equal(materials.returnSources[0].quantity,10);assert.equal(materials.lines[0].issuedQty,10);
    assert.equal((await readCashBalance(tx,marker)).toFixed(2),'6300.00');
    assert.ok((await readOrgBalance(tx,'1')).eq(originalOrg));
    await warehouseMove(tx,f.actor,{kind:'RETURN',productId:marker,sourceMovementId:issueId,quantity:'10',clientMutationId:randomUUID()});
    assert.equal((await getProjectEconomics(f.project.id,tx))?.expensesTotal,0);
   }else if(mode==='inventory'){
    assert.equal(preview.refunds.length,0);assert.equal(stock.quantity.toString(),'37');assert.equal(stock.valueByn.toFixed(2),'3700.00');
    assert.equal((await readCashBalance(tx,marker)).toFixed(2),'6300.00');assert.ok((await readOrgBalance(tx,'1')).eq(originalOrg));
    assert.equal((await tx.payment.findUniqueOrThrow({where:{id:f.receipt.receipt.paymentId}})).deletionId,null);
   }else{
    assert.equal(preview.refunds[0].amount,mode==='fx'?'21.99':'3700.00');
    assert.equal(preview.refunds[0].bynAmount,mode==='fx'?'65.99':'3700.00');
    assert.equal((await readCashBalance(tx,marker)).toFixed(2),'10000.00');
    assert.ok((await readOrgBalance(tx,'1')).minus(originalOrg).eq(mode==='fx'?'65.99':'3700'));
    assert.equal((await tx.payment.findUniqueOrThrow({where:{id:f.receipt.receipt.paymentId}})).deletionId,result.id);
    assert.equal((await loadOrganizationPayments(f.actor,'EXPENSE',tx)).rows.some(row=>row.id===f.receipt.receipt.paymentId),false);
    const statement=await loadCashStatement(f.actor,{from:new Date().toISOString().slice(0,10),to:new Date().toISOString().slice(0,10),mode:'NATIVE'},tx);
    const cash=statement.rows.find(row=>row.id===marker);assert.ok(cash);assert.equal(cash.totals.closing,'10000.00');assert.equal(cash.totals.expense,'0.00');
    await assert.rejects(createStockPurchaseInTransaction(f.actor,f.input,f.prepared,tx),/удалён/);
    assert.equal(stock.quantity.toString(),mode==='cascade'?'5':'0');assert.equal(stock.valueByn.toFixed(2),mode==='cascade'?'1000.00':'0.00');
    if(mode==='cascade'){
     assert.deepEqual(new Set(preview.movements.map(row=>row.id)),new Set([movementId,issueId,returnId]));
     assert.equal((await tx.stockMovement.findUniqueOrThrow({where:{id:independentId}})).deletionId,null);
     assert.equal(materials.returnSources.length,0);assert.equal(materials.lines[0].issuedQty,0);assert.equal(materials.lines[0].quantity,30);
     assert.equal((await getProjectEconomics(f.project.id,tx))?.expensesTotal,0);assert.equal((await loadProjectStockExpenses(f.actor,f.project.id,tx)).length,0);
     await assert.rejects(warehouseMove(tx,f.actor,issueInput),/удалено/);
     await assert.rejects(warehouseMove(tx,f.actor,{kind:'RETURN',productId:marker,sourceMovementId:issueId,quantity:'1',clientMutationId:randomUUID()}),/Исходная выдача/);
    }
   }
   assert.equal((await tx.stockMovement.findUniqueOrThrow({where:{id:rootId}})).deletionId,result.id);
   assert.equal((await tx.warehouseMovementValuation.findUniqueOrThrow({where:{movementId}})).moneyByn.toFixed(2),mode==='fx'?'65.99':'3700.00');
   checked.push(mode);throw abort;
  });}catch(error){if(mode==='last-write-failure'&&error===fault)checked.push(mode);else if(error!==abort)throw error;}
  assert.deepEqual(await deletionBaseline(db),before,'ORIGINAL_DATA_CHANGED:'+mode);
 }
 return {status:'PASS',scenarios:checked,originalData:'MATCH',qaRows:'ROLLED_BACK',providerMessages:0};
}
