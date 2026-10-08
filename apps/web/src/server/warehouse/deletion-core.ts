import {createHash} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {hasAnyRole,WAREHOUSE_DELETE_ROLES} from '@/lib/roles';
import type {DomainActor} from '@/server/actor';
import {lockProductRow} from '@/server/products/quantity-core';
import {averagePrice} from '@/lib/warehouse-cost';
import {warehouseWriteGate} from './accounting';
import {activeStockMovementWhere} from './active-records';
import {activePaymentWhere} from '@/server/payments/active-records';
import {planWarehouseDeletion,type DeletionFact} from './deletion-plan';
import {movementDeletionSchema,type MovementDeletionInput,type MovementDeletionPreview} from './deletion-contracts';

type Tx=Prisma.TransactionClient;
const incomplete=()=>Error('Недостаточно данных для безопасной отмены: движение не входит в проверяемый текущий учёт');
async function requireAdministrator(tx:Tx,actor:DomainActor){
  if(!hasAnyRole(actor.roles,WAREHOUSE_DELETE_ROLES))throw Error('Удалять движения может только администратор');
  const current=await tx.user.findUnique({where:{id:actor.id},select:{roles:true,active:true}});
  if(!current?.active||!hasAnyRole(current.roles,WAREHOUSE_DELETE_ROLES))throw Error('Удалять движения может только администратор');
}

/** Вызывается под общей денежной блокировкой; затем берёт те же locks, что обычное движение. */
async function loadPlan(tx:Tx,actor:DomainActor,movementId:string){
  await requireAdministrator(tx,actor);
  const state=await warehouseWriteGate(tx);
  const root=await tx.stockMovement.findUnique({where:{id:movementId},include:{warehouseValuation:true}});
  if(!root||root.deletionId)throw Error('Движение не найдено или уже удалено');
  if(root.warehouseValuation?.runId!==state.runId)throw incomplete();
  await tx.$queryRaw`SELECT id FROM "Material" WHERE id=${root.materialId} FOR UPDATE`;
  const [material,balance,rows]=await Promise.all([
    tx.material.findUniqueOrThrow({where:{id:root.materialId}}),
    tx.warehouseBalance.findUnique({where:{materialId:root.materialId}}),
    tx.warehouseMovementValuation.findMany({where:{runId:state.runId,movement:{...activeStockMovementWhere,materialId:root.materialId}},
      include:{movement:{include:{product:{select:{id:true,number:true,project:{select:{id:true,number:true}}}},stockPurchase:{include:{payment:{include:{cashAccount:true}}}}}}},
      take:10001,orderBy:[{createdAt:'asc'},{id:'asc'}]}),
  ]);
  if(rows.length>10000)throw Error('Слишком много связанных движений для одной безопасной отмены');
  if(!balance||balance.runId!==state.runId)throw incomplete();
  const productIds=[...new Set(rows.flatMap(row=>row.movement.productId?[row.movement.productId]:[]))].sort();
  for(const id of productIds)await lockProductRow(tx,id);
  const lines=await tx.projectMaterial.findMany({where:{materialId:root.materialId,productId:{in:productIds}},orderBy:{id:'asc'}});
  const facts:DeletionFact[]=rows.map(row=>{
    if(!row.quantity.eq(row.movement.quantity)||!row.moneyByn.eq(row.movement.totalByn??-1)||
      (row.accountingRevision!==null&&row.accountingRevision>balance.revision))throw incomplete();
    return {id:row.movementId,type:row.movement.type,quantity:row.quantity.toString(),unitCost:row.unitCost.toString(),
      value:row.valueByn.toString(),money:row.moneyByn.toString(),sourceId:row.sourceMovementId,revision:row.accountingRevision,createdAt:row.createdAt.toISOString()};
  });
  const before={quantity:balance.quantity.toString(),value:balance.valueByn.toString()};
  const plan=planWarehouseDeletion(facts,before,movementId);
  for(const row of rows){
    const counter=plan.baselineReturns.get(row.movementId);
    if(counter&&(!row.returnedQuantity.eq(counter.quantity)||!row.returnedValueByn.eq(counter.value)||!row.returnedMoneyByn.eq(counter.money)))
      throw Error('Счётчики возвратов не согласованы с историей');
  }
  const reasons=new Map(plan.deleted.map(row=>[row.id,row.reason]));
  const affected=rows.filter(row=>reasons.has(row.movementId));
  const lineChanges=lines.map(line=>{
    const delta=affected.filter(row=>row.movement.productId===line.productId).reduce((sum,row)=>sum.plus(
      row.movement.type==='EXPENSE'?row.quantity.negated():row.movement.type==='RETURN'?row.quantity:0),new Prisma.Decimal(0));
    const issuedQty=line.issuedQty.plus(delta);
    if(issuedQty.lt(0))throw Error('Факт выдачи в потребности не согласован с движениями');
    return {id:line.id,issuedQty,changed:!issuedQty.eq(line.issuedQty)};
  }).filter(line=>line.changed);
  const refunds=new Map<string,MovementDeletionPreview['refunds'][number]>();
  const projects=new Map<string,MovementDeletionPreview['projects'][number]>();
  const paymentIds:string[]=[];
  for(const row of affected){
    const movement=row.movement,payment=movement.stockPurchase?.payment;
    if(movement.receiptKind==='PAID'&&!payment)throw incomplete();
    if(payment){
      if(movement.type!=='INCOME'||movement.receiptKind!=='PAID'||payment.direction!=='EXPENSE'||payment.projectId||payment.deletionId||
        !payment.cashAccount||payment.currency!==payment.cashAccount.currency||!payment.bynAmount.eq(row.moneyByn))throw incomplete();
      paymentIds.push(payment.id);
      const prior=refunds.get(payment.cashAccount.id);
      refunds.set(payment.cashAccount.id,{cashAccountId:payment.cashAccount.id,cashName:payment.cashAccount.name,currency:payment.currency,
        amount:new Prisma.Decimal(prior?.amount??0).plus(payment.amount).toFixed(2),bynAmount:new Prisma.Decimal(prior?.bynAmount??0).plus(payment.bynAmount).toFixed(2)});
    }
    if(movement.type!=='INCOME'){
      if(!movement.product)throw incomplete();
      const project=movement.product.project,prior=projects.get(project.id);
      projects.set(project.id,{id:project.id,number:project.number,expenseDelta:new Prisma.Decimal(prior?.expenseDelta??0)
        .plus(movement.type==='EXPENSE'?row.moneyByn.negated():row.moneyByn).toFixed(2)});
    }
  }
  const planFingerprint=createHash('sha256').update(JSON.stringify({movementId,runId:state.runId,balance,rows,lines,materialPrice:material.purchasePrice})).digest('hex');
  const preview:MovementDeletionPreview={movementId,planFingerprint,materialName:material.name,unit:material.unit,before,after:plan.position,
    movements:plan.deleted.map(item=>{const row=affected.find(row=>row.movementId===item.id)!;return {id:item.id,type:row.movement.type,date:row.createdAt.toISOString(),
      quantity:row.quantity.toString(),money:row.moneyByn.toFixed(2),productNumber:row.movement.product?.number??null,reason:item.reason};}),
    refunds:[...refunds.values()],projects:[...projects.values()]};
  return {preview,plan,balance,rows,affected,lineChanges,paymentIds,productRefs:affected.flatMap(row=>row.movement.product?[{id:row.movement.product.id,projectId:row.movement.product.project.id}]:[])};
}

export async function previewMovementDeletionInTransaction(tx:Tx,actor:DomainActor,movementId:string){
  return (await loadPlan(tx,actor,movementId)).preview;
}
export async function deleteMovementInTransaction(tx:Tx,actor:DomainActor,input:MovementDeletionInput){
  await requireAdministrator(tx,actor);
  const data=movementDeletionSchema.parse(input);
  const previous=await tx.warehouseMovementDeletion.findUnique({where:{clientMutationId:data.clientMutationId},
    include:{movements:{select:{product:{select:{id:true,projectId:true}}}}}});
  if(previous){
    if(previous.actorId!==actor.id||previous.rootMovementId!==data.movementId||previous.planFingerprint!==data.planFingerprint)
      throw Error('Идентификатор удаления уже использован с другими данными');
    return {id:previous.id,repeated:true,eventId:null,productRefs:previous.movements.flatMap(row=>row.product?[row.product]:[])};
  }
  const loaded=await loadPlan(tx,actor,data.movementId);
  if(loaded.preview.planFingerprint!==data.planFingerprint)throw Error('Склад или связанные операции изменились. Обновите расчёт и подтвердите удаление заново.');
  const deletion=await tx.warehouseMovementDeletion.create({data:{clientMutationId:data.clientMutationId,actorId:actor.id,rootMovementId:data.movementId,planFingerprint:data.planFingerprint}});
  const ids=loaded.affected.map(row=>row.movementId);
  const marked=await tx.stockMovement.updateMany({where:{...activeStockMovementWhere,id:{in:ids}},data:{deletionId:deletion.id}});
  const payments=await tx.payment.updateMany({where:{...activePaymentWhere,id:{in:loaded.paymentIds}},data:{deletionId:deletion.id}});
  if(marked.count!==ids.length||payments.count!==loaded.paymentIds.length)throw Error('Список удаления изменился');
  await tx.warehouseBalance.update({where:{materialId:loaded.balance.materialId},data:{quantity:loaded.plan.position.quantity,valueByn:loaded.plan.position.value,revision:{increment:1}}});
  await tx.$executeRaw`UPDATE "Material" SET "purchasePrice"=CAST(${averagePrice(loaded.plan.position)} AS numeric) WHERE id=${loaded.balance.materialId}`;
  for(const line of loaded.lineChanges)await tx.projectMaterial.update({where:{id:line.id},data:{issuedQty:line.issuedQty}});
  for(const row of loaded.rows.filter(row=>row.movement.type==='EXPENSE')){
    const counter=loaded.plan.returns.get(row.movementId)??{quantity:'0',value:'0',money:'0'};
    if(!row.returnedQuantity.eq(counter.quantity)||!row.returnedValueByn.eq(counter.value)||!row.returnedMoneyByn.eq(counter.money))
      await tx.warehouseMovementValuation.update({where:{id:row.id},data:{returnedQuantity:counter.quantity,returnedValueByn:counter.value,returnedMoneyByn:counter.money}});
  }
  await tx.changeLog.createMany({data:[...ids.map(id=>({entity:'stockMovement',entityId:id})),...loaded.paymentIds.map(id=>({entity:'payment',entityId:id}))].map(row=>({
    ...row,actorType:'user',actorId:actor.id,actorName:actor.name,source:actor.source,action:'softDelete',newValue:{deletionId:deletion.id,rootMovementId:data.movementId},
  }))});
  const event=await tx.domainEvent.create({data:{type:'stock.movement.deleted',actor:actor.id,payload:{deletionId:deletion.id,movementIds:ids,paymentIds:loaded.paymentIds}}});
  return {id:deletion.id,repeated:false,eventId:event.id,productRefs:loaded.productRefs};
}
