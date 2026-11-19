import { Prisma } from "@prisma/client";
import { planQuantityChange } from "@/lib/product-quantity";
import type {DomainActor} from '@/server/actor';
import {writeChangeLogInTransaction} from '@/server/changelog/writer';
import {automationJournalContext,productJournalContext} from '@/server/projects/journal';

const decimalValue=(value:unknown)=>value===null||value===undefined?null:new Prisma.Decimal(String(value)).toString();
const workValues=(row:{quantity:unknown;quantityPerUnit:unknown;total:unknown})=>({quantity:decimalValue(row.quantity),quantityPerUnit:decimalValue(row.quantityPerUnit),total:decimalValue(row.total)});
const materialValues=(row:{quantity:unknown;quantityPerUnit:unknown})=>({quantity:decimalValue(row.quantity),quantityPerUnit:decimalValue(row.quantityPerUnit)});

// Все writers плана/выдачи сначала блокируют изделие, затем его строки.
export async function lockProductRow(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${id} FOR UPDATE`;
}

export async function recalculateQuantity(tx: Prisma.TransactionClient, product: { id: string; number:string; quantity: number }, count: number, actor:DomainActor) {
  await tx.$queryRaw`SELECT id FROM "Work" WHERE "productId" = ${product.id} ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "ProjectMaterial" WHERE "productId" = ${product.id} ORDER BY id FOR UPDATE`;
  const works = await tx.work.findMany({ where: { productId: product.id },
    include: { tasks: { select: { quantity: true, allocationGroupId: true } } } });
  const materials = await tx.projectMaterial.findMany({ where: { productId: product.id, deletedAt: null }, include: { material: { select: { name: true } } } });
  const plan = planQuantityChange(product.quantity, count, works, materials);
  const context=productJournalContext(product);
  const system=automationJournalContext(actor,`Пересчёт плана при изменении количества изделия: ${product.quantity} → ${count}`);
  const links=[{type:'product',id:product.id,label:context.entity?.label??'Изделие',href:`/products/${encodeURIComponent(product.id)}`}];
  const worksById=new Map(works.map(work=>[work.id,work])),materialsById=new Map(materials.map(line=>[line.id,line]));
  for (const { id, ...data } of plan.works) {
    const work=worksById.get(id)!;const before=workValues(work),after=workValues(data);
    await tx.work.update({ where: { id }, data });
    if(JSON.stringify(before)!==JSON.stringify(after))await writeChangeLogInTransaction(tx,
      {actorType:'user',actorId:actor.id,actorName:actor.name,source:actor.source,entity:'work',entityId:id,action:'update',oldValue:before,newValue:after},
      {...context,...system,entity:{type:'work',id,label:work.title},links,before,after});
  }
  for (const { id, ...data } of plan.materials) {
    const line=materialsById.get(id)!;const before=materialValues(line),after=materialValues(data);
    await tx.projectMaterial.update({ where: { id }, data });
    if(JSON.stringify(before)!==JSON.stringify(after))await writeChangeLogInTransaction(tx,
      {actorType:'user',actorId:actor.id,actorName:actor.name,source:actor.source,entity:'projectMaterial',entityId:id,action:'update',oldValue:before,newValue:after},
      {...context,...system,entity:{type:'projectMaterial',id,label:line.material.name},links,before,after});
  }
  return plan;
}
