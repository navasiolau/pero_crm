import type { Prisma, PrismaClient, Role } from '@prisma/client';
import { randomUUID, createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { WAREHOUSE_MANAGE_ROLES, FINANCE_ROLES, hasAnyRole } from '@/lib/roles';
import { liveProductWhere } from '@/server/access/live-entities';
import { lockProductRow } from '@/server/products/quantity-core';
import { decimalAtoms, decimalText } from '@/lib/product-quantity';
import { addPosition, addPaidPosition, addValue, issuePosition, returnShare, averagePrice, unitCost, quantityInput, priceInput } from '@/lib/warehouse-cost';
import {warehouseMetadataGate} from './gate';

type Tx=Prisma.TransactionClient;
type Reader=Pick<PrismaClient,'warehouseAccountingState'|'warehouseBalance'|'stockMovement'>;
export async function warehousePhase(db:Pick<Reader,'warehouseAccountingState'>=prisma){
 return (await db.warehouseAccountingState.findUnique({where:{id:'main'}}))?.phase??'UNINITIALIZED';
}
export async function warehouseReadPositions(db:Reader=prisma,ids?:string[]){
 const state=await db.warehouseAccountingState.findUnique({where:{id:'main'}}),phase=state?.phase??'UNINITIALIZED',current=phase==='ACTIVE'||phase==='VERIFYING';
 if(current){
  const rows=await db.warehouseBalance.findMany({where:ids?{materialId:{in:ids}}:undefined});
  return {current,ready:phase==='ACTIVE',runId:state?.runId??null,positions:new Map(rows.map(row=>[row.materialId,{quantity:row.quantity.toString(),value:row.valueByn.toString()}]))};
 }
 const grouped=await db.stockMovement.groupBy({by:['materialId','type'],where:ids?{materialId:{in:ids}}:undefined,_sum:{quantity:true}});
 const values=new Map<string,bigint>();
 for(const row of grouped)values.set(row.materialId,(values.get(row.materialId)??BigInt(0))+BigInt(row.type==='EXPENSE'?-1:1)*decimalAtoms(row._sum.quantity??0,3,18));
 return {current,ready:false,runId:state?.runId??null,positions:new Map([...values].map(([id,q])=>[id,{quantity:decimalText(q,3),value:'0'}]))};
}
export async function warehouseWriteGate(tx:Tx){
 await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock_shared(18436,94001)`;
 const state=await tx.warehouseAccountingState.findUnique({where:{id:'main'}});
 if(state?.phase!=='ACTIVE')throw Error('Склад временно закрыт для изменений до проверки нового учёта');
 return state;
}
export async function withWarehouseWrite<T>(operation:(tx:Tx)=>Promise<T>,database:Pick<PrismaClient,'$transaction'>=prisma){
 return database.$transaction(async tx=>{await warehouseMetadataGate(tx);return operation(tx);},{maxWait:10000,timeout:15000});
}
export type WarehouseActor={id:string;name?:string|null;roles:Role[];source?:"web"|"telegram"|"api"};
export type WarehouseMovementInput={kind:'INCOME'|'EXPENSE'|'RETURN';clientMutationId:string;materialId?:string;projectMaterialId?:string;productId?:string;quantity:string|number;unitPrice?:string|number;sourceMovementId?:string;comment?:string};
export async function warehouseMove(tx:Tx,actor:WarehouseActor,input:WarehouseMovementInput,paidReceipt?:{bynAmount:string}){
 if(paidReceipt&&input.kind!=='INCOME')throw Error('Оплата допустима только для прихода');
 if(!hasAnyRole(actor.roles,paidReceipt?FINANCE_ROLES:WAREHOUSE_MANAGE_ROLES))throw Error('Недостаточно прав');
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.clientMutationId))throw Error('Некорректный идентификатор запроса');
 if(input.projectMaterialId&&input.productId)throw Error('Выберите изделие либо строку потребности');
 const clientMutationId=input.clientMutationId.toLowerCase(),quantity=quantityInput(input.quantity);
 if(input.kind==='EXPENSE'&&input.unitPrice!==undefined)throw Error('Цена выдачи рассчитывается автоматически');
 if(input.kind==='RETURN'&&input.sourceMovementId&&input.unitPrice!==undefined)throw Error('Цена возврата определяется исходной выдачей');
 if(input.kind==='RETURN'&&!input.projectMaterialId&&!input.sourceMovementId)throw Error('Выберите исходную выдачу');
 const price=!paidReceipt&&(input.kind==='INCOME'||(input.kind==='RETURN'&&!input.sourceMovementId))?priceInput(input.unitPrice):null;
 // Conditional fields preserve fingerprints of already conducted legacy requests.
 const fingerprint=createHash('sha256').update(JSON.stringify({actor:actor.id,kind:input.kind,materialId:input.materialId??null,projectMaterialId:input.projectMaterialId??null,sourceMovementId:input.sourceMovementId??null,quantity,unitPrice:price,comment:input.comment?.trim()||null,...(paidReceipt?{paidByn:priceInput(paidReceipt.bynAmount)}:{}),...(input.productId?{productId:input.productId}:{})})).digest('hex');
 const state=await warehouseWriteGate(tx);
 await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18437,hashtext(${clientMutationId}))`;
 const previous=await tx.warehouseMovementValuation.findUnique({where:{clientMutationId},include:{movement:true}});
 if(previous){
  if(previous.actorId!==actor.id||previous.requestFingerprint!==fingerprint)throw Error('Идентификатор запроса уже использован с другими данными');
  const product=previous.movement.productId?await tx.product.findUnique({where:{id:previous.movement.productId},select:{id:true,number:true,projectId:true}}):null;
  return {movement:previous.movement,repeated:true,line:null,material:null,product};
 }
 const initial=input.projectMaterialId?await tx.projectMaterial.findFirst({where:{id:input.projectMaterialId,product:liveProductWhere},select:{materialId:true,productId:true}}):null;
 if(input.projectMaterialId&&!initial)throw Error('Строка потребности не найдена');
 const initialSource=input.kind==='RETURN'&&input.sourceMovementId?await tx.warehouseMovementValuation.findUnique({where:{movementId:input.sourceMovementId},include:{movement:true}}):null;
 const materialId=input.kind==='INCOME'?input.materialId:initial?.materialId??(input.kind==='RETURN'?initialSource?.movement.materialId:input.materialId);
 const productId=input.kind==='INCOME'?null:initial?.productId??input.productId;
 if(!materialId)throw Error('Материал или исходная выдача не найдены');
 if(input.kind!=='INCOME'&&!productId)throw Error('Выберите изделие');
 await tx.$queryRaw`SELECT id FROM "Material" WHERE id=${materialId} FOR UPDATE`;
 if(productId)await lockProductRow(tx,productId);
 const product=productId?await tx.product.findUnique({where:{...liveProductWhere,id:productId},select:{id:true,number:true,projectId:true}}):null;
 if(productId&&!product)throw Error('Изделие не найдено');
 const material=await tx.material.findUnique({where:{id:materialId}});
 if(!material||(input.kind==='INCOME'&&!material.active))throw Error('Материал не найден');
 const line=product?await tx.projectMaterial.findUnique({where:{productId_materialId:{productId:product.id,materialId}},include:{product:{select:{id:true,number:true,projectId:true}}}}):null;
 if(initial&&line?.id!==input.projectMaterialId)throw Error('Строка потребности изменилась');
 const balance=await tx.warehouseBalance.findUnique({where:{materialId}});
 if(balance&&balance.runId!==state.runId)throw Error('Состояние складского учёта изменилось');
 const position={quantity:balance?.quantity.toString()??'0',value:balance?.valueByn.toString()??'0'};
 let result;
 if(input.kind==='INCOME')result=paidReceipt?addPaidPosition(position,quantity,paidReceipt.bynAmount):addPosition(position,quantity,price!);
 else if(input.kind==='EXPENSE')result=issuePosition(position,quantity);
 else if(input.sourceMovementId){
  // Re-read while the material/product locks protect all returns of this issue.
  const source=await tx.warehouseMovementValuation.findUnique({where:{movementId:input.sourceMovementId},include:{movement:true}});
  if(!source||source.runId!==state.runId||source.movement.type!=='EXPENSE'||source.movement.productId!==product!.id||source.movement.materialId!==materialId)throw Error('Исходная выдача не найдена');
  if(line&&decimalAtoms(quantity,3,12)>decimalAtoms(line.issuedQty,3,12))throw Error('Факт выдачи в потребности не согласован с исходной выдачей');
  const share=returnShare({quantity:source.quantity.toString(),value:source.valueByn.toString(),money:source.moneyByn.toString(),returnedQuantity:source.returnedQuantity.toString(),returnedValue:source.returnedValueByn.toString(),returnedMoney:source.returnedMoneyByn.toString()},quantity);
  result={...share,position:addValue(position,quantity,share.value)};
  await tx.warehouseMovementValuation.update({where:{id:source.id},data:{returnedQuantity:{increment:quantity},returnedValueByn:{increment:share.value},returnedMoneyByn:{increment:share.money}}});
 }else{
  if(!line||!input.projectMaterialId)throw Error('Для исторического возврата нужна строка потребности');
  if(decimalAtoms(quantity,3,12)>decimalAtoms(line.issuedQty,3,12))throw Error('Нельзя вернуть больше выданного');
  const outstanding=await tx.warehouseMovementValuation.findMany({where:{runId:state.runId,movement:{type:'EXPENSE',productId:product!.id,materialId}}});
  const newIssued=outstanding.reduce((q,item)=>q+decimalAtoms(item.quantity,3,12)-decimalAtoms(item.returnedQuantity,3,12),BigInt(0));
  if(decimalAtoms(quantity,3,12)>decimalAtoms(line.issuedQty,3,12)-newIssued)throw Error('Выберите исходную выдачу нового учёта');
  result=addPosition(position,quantity,price!);
 }
 const movement=await tx.stockMovement.create({data:{id:randomUUID(),materialId,type:input.kind,receiptKind:input.kind==='INCOME'?(paidReceipt?'PAID':'INVENTORY'):null,quantity,unitPrice:averagePrice({quantity:'1',value:result.cost}),totalByn:result.money,productId:product?.id,projectMaterialId:line?.id,comment:input.comment?.trim()||null,createdById:actor.id}});
 await tx.warehouseMovementValuation.create({data:{id:randomUUID(),movementId:movement.id,sourceMovementId:input.sourceMovementId??null,runId:state.runId,clientMutationId,requestFingerprint:fingerprint,actorId:actor.id,quantity,unitCost:result.cost,valueByn:result.value,moneyByn:result.money}});
 await tx.warehouseBalance.upsert({where:{materialId},create:{materialId,runId:state.runId,quantity:result.position.quantity,valueByn:result.position.value,revision:1},update:{quantity:result.position.quantity,valueByn:result.position.value,revision:{increment:1}}});
 await tx.$executeRaw`UPDATE "Material" SET "purchasePrice"=CAST(${averagePrice(result.position)} AS numeric) WHERE id=${materialId}`;
 if(line)await tx.projectMaterial.update({where:{id:line.id},data:{issuedQty:input.kind==='EXPENSE'?{increment:quantity}:{decrement:quantity}}});
 const eventId='warehouse94-'+clientMutationId;
 await tx.changeLog.create({data:{id:eventId,actorType:'user',actorId:actor.id,actorName:actor.name??undefined,source:actor.source,entity:'stockMovement',entityId:movement.id,action:'create',newValue:{type:input.kind,receiptKind:movement.receiptKind,material:material.name,quantity,unitPrice:movement.unitPrice?.toString()??null}}});
 await tx.domainEvent.create({data:{id:eventId,type:'stock.movement.created',actor:actor.id,payload:{movementId:movement.id,type:input.kind,receiptKind:movement.receiptKind,materialId,productId:product?.id??null,quantity:Number(quantity),totalByn:Number(result.money)}}});
 return {movement,repeated:false,line,material,product,eventId};
}
export { averagePrice, unitCost };
