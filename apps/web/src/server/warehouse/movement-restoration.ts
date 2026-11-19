import { Prisma } from "@prisma/client";
import type { DomainActor } from "@/server/actor";
import { lockProductRow } from "@/server/products/quantity-core";
import { liveProductWhere } from "@/server/access/live-entities";
import { readCashBalance, readOrgBalance } from "@/server/payroll/cash-core";
import { warehouseWriteGate, averagePrice } from "./accounting";
import { requireWarehouseDeleteActor } from "./deletion-core";
import { warehouseRestorationSnapshot } from "./movement-reversal-contract";

type Tx=Prisma.TransactionClient;
const changed=()=>Error("Склад или связанные операции изменились после удаления");
function sameIds(rows: {id:string}[], ids:string[]) {
  const expected=new Set(ids);
  return rows.length===ids.length&&expected.size===ids.length&&rows.every(row=>expected.has(row.id));
}

export async function prepareWarehouseRestoration(tx:Tx,actor:DomainActor,deletionId:string) {
  await requireWarehouseDeleteActor(tx,actor);
  const state=await warehouseWriteGate(tx);
  const deletion=await tx.warehouseMovementDeletion.findUnique({where:{id:deletionId}});
  if(!deletion||deletion.restoredAt)throw changed();
  const parsed=warehouseRestorationSnapshot.safeParse(deletion.restorationSnapshot);
  if(!parsed.success)throw Error("У этого удаления отсутствует полный снимок для восстановления");
  const snapshot=parsed.data;
  if(snapshot.runId!==state.runId)throw Error("Складской учёт был пересобран");
  await tx.$queryRaw`SELECT id FROM "Material" WHERE id=${snapshot.materialId} FOR UPDATE`;
  for(const id of [...snapshot.productIds].sort())await lockProductRow(tx,id);
  const [balance,movements,payments,lines,counters,products]=await Promise.all([
    tx.warehouseBalance.findUnique({where:{materialId:snapshot.materialId}}),
    tx.stockMovement.findMany({where:{deletionId},select:{id:true,materialId:true,productId:true,
      warehouseLifecycleRevision:true,product:{select:{id:true,number:true,projectId:true}}}}),
    tx.payment.findMany({where:{deletionId},select:{id:true,deletedAt:true,direction:true,currency:true,cashAccountId:true,
      amount:true,bynAmount:true,projectId:true,cashAccount:{select:{currency:true}},stockPurchase:{select:{movementId:true}}}}),
    tx.projectMaterial.findMany({where:{materialId:snapshot.materialId,productId:{in:snapshot.productIds},deletedAt:null},
      select:{id:true,issuedQty:true,warehouseCatalogRevision:true}}),
    tx.warehouseMovementValuation.findMany({where:{id:{in:snapshot.counters.map(row=>row.id)}},select:{
      id:true,returnedQuantity:true,returnedValueByn:true,returnedMoneyByn:true}}),
    tx.product.findMany({where:{...liveProductWhere,id:{in:snapshot.productIds}},select:{id:true}}),
  ]);
  if(!balance||balance.runId!==snapshot.runId||balance.revision!==snapshot.balanceRevision||
    !balance.quantity.eq(snapshot.after.quantity)||!balance.valueByn.eq(snapshot.after.value)||
    !sameIds(movements,snapshot.movementIds)||!sameIds(payments,snapshot.paymentIds)||!sameIds(products,snapshot.productIds)||
    !sameIds(lines,snapshot.lines.map(row=>row.id))||!sameIds(counters,snapshot.counters.map(row=>row.id))||
    movements.some(row=>row.materialId!==snapshot.materialId)||!snapshot.movementIds.includes(deletion.rootMovementId))
    throw changed();
  for(const row of lines){
    const previous=snapshot.lines.find(item=>item.id===row.id)!;
    if(previous.revision!==row.warehouseCatalogRevision||!row.issuedQty.eq(previous.after))throw changed();
  }
  for(const row of counters){
    const previous=snapshot.counters.find(item=>item.id===row.id)!;
    if(!row.returnedQuantity.eq(previous.after.quantity)||!row.returnedValueByn.eq(previous.after.value)||
      !row.returnedMoneyByn.eq(previous.after.money))throw changed();
  }
  const byAccount=new Map<string,Prisma.Decimal>();
  let byn=new Prisma.Decimal(0);
  for(const payment of payments){
    const account=payment.cashAccountId;
    if(payment.deletedAt||payment.direction!=="EXPENSE"||!account||payment.projectId||payment.cashAccount?.currency!==payment.currency||
      !payment.stockPurchase||!snapshot.movementIds.includes(payment.stockPurchase.movementId))throw changed();
    byAccount.set(account,(byAccount.get(account)??new Prisma.Decimal(0)).plus(payment.amount));
    byn=byn.plus(payment.bynAmount);
  }
  for(const [id,total] of byAccount)
    if((await readCashBalance(tx,id)).lt(total))throw Error("Недостаточно средств в кассе для восстановления оплаченного прихода");
  if(!byn.isZero()&&(await readOrgBalance(tx,"1.000000",byn.negated().toFixed(2))).lt(0))
    throw Error("Недостаточно средств на балансе организации для восстановления");
  return {deletion,snapshot,movements};
}

export async function restoreWarehouseDeletionInTransaction(tx:Tx,actor:DomainActor,deletionId:string){
  const {deletion,snapshot,movements}=await prepareWarehouseRestoration(tx,actor,deletionId);
  const marked=await tx.warehouseMovementDeletion.updateMany({where:{id:deletion.id,restoredAt:null},data:{restoredAt:new Date()}});
  const restored=await tx.stockMovement.updateMany({where:{deletionId,id:{in:snapshot.movementIds}},data:{deletionId:null}});
  const payments=await tx.payment.updateMany({where:{deletionId,id:{in:snapshot.paymentIds}},data:{deletionId:null}});
  if(marked.count!==1||restored.count!==snapshot.movementIds.length||payments.count!==snapshot.paymentIds.length)throw changed();
  await tx.warehouseBalance.update({where:{materialId:snapshot.materialId,revision:snapshot.balanceRevision},
    data:{quantity:snapshot.before.quantity,valueByn:snapshot.before.value,revision:{increment:1}}});
  await tx.$executeRaw`UPDATE "Material" SET "purchasePrice"=CAST(${averagePrice(snapshot.before)} AS numeric) WHERE id=${snapshot.materialId}`;
  for(const row of snapshot.lines){
    if(!new Prisma.Decimal(row.before).eq(row.after))
      await tx.projectMaterial.update({where:{id:row.id,deletedAt:null,warehouseCatalogRevision:row.revision},data:{issuedQty:row.before}});
  }
  for(const {id,before} of snapshot.counters)
    await tx.warehouseMovementValuation.update({where:{id},data:{returnedQuantity:before.quantity,returnedValueByn:before.value,returnedMoneyByn:before.money}});
  const event=await tx.domainEvent.create({data:{type:"stock.movement.restored",actor:actor.id,
    payload:{deletionId,movementIds:snapshot.movementIds,paymentIds:snapshot.paymentIds}}});
  return {deletion,snapshot,movements,eventId:event.id};
}
