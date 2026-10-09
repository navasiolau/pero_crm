import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Prisma,type PrismaClient} from '@prisma/client';
import {readOrgBalance} from '../../src/server/payroll/cash-core';
import {stockPurchaseSchema} from '../../src/server/warehouse/contracts';
import {prepareStockPurchase,createStockPurchaseInTransaction} from '../../src/server/warehouse/stock-purchase-core';
export async function deletionBaseline(db:PrismaClient){
 const tables=await db.$queryRaw<{tablename:string}[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename`;
 const result:Record<string,unknown>={};
 for(const {tablename} of tables){
  assert.match(tablename,/^[A-Za-z]+$/);
  // Работающий бот обновляет только отметку использования токена при штатном ping.
  // Сам токен, scopes, отзыв и все бизнес-таблицы по-прежнему сверяются полностью.
  const row=tablename==='ApiToken'?"(to_jsonb(t)-'lastUsedAt')":'to_jsonb(t)';
  result[tablename]=await db.$queryRawUnsafe(`SELECT count(*)::text n,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest FROM (SELECT md5(${row}::text) h FROM "${tablename}" t) x`);
 }
 return result;
}
export async function createDeletionFixture(tx:Prisma.TransactionClient,marker:string,currency='BYN'){
 const user=await tx.user.create({data:{id:marker,name:marker,email:marker+'@invalid.local',passwordHash:'qa-login-disabled',roles:['ADMIN']}});
 const actor={id:user.id,name:user.name,roles:user.roles,source:'web' as const};
 const material=await tx.material.create({data:{id:marker,name:marker,unitId: "warehouse-unit-kilogram",purchasePrice:0}});
 const cash=await tx.cashAccount.create({data:{id:marker,name:marker,currency}});
 const maxCode=await tx.expenseArticle.aggregate({_max:{code:true}});
 const article=await tx.expenseArticle.create({data:{id:marker,name:marker,code:(maxCode._max.code??0)+1}});
 const client=await tx.client.create({data:{id:marker,name:marker,phone:'QA'}});
 const maxProject=await tx.project.aggregate({_max:{numberInt:true}}),number=(maxProject._max.numberInt??0)+1;
 const project=await tx.project.create({data:{id:marker,number:String(number),numberInt:number,title:marker,clientId:client.id}});
 const product=await tx.product.create({data:{id:marker,number:number+'.1',title:marker,projectId:project.id,expectedPrice:10000}});
 const org=await readOrgBalance(tx,'1'),topup=Prisma.Decimal.max(10000,org.negated().plus(10000));
 await tx.payment.create({data:{direction:'INCOME',amount:topup,bynAmount:topup,currency:'BYN',rate:1,createdById:marker,comment:marker}});
 await tx.payment.create({data:{direction:'INCOME',amount:10000,bynAmount:currency==='BYN'?10000:30010,currency,rate:currency==='BYN'?1:3.001,cashAccountId:cash.id,createdById:marker,comment:marker}});
 const input=stockPurchaseSchema.parse({clientMutationId:randomUUID(),materialId:material.id,quantity:currency==='BYN'?'37':'3',unitPrice:currency==='BYN'?'100':'7.33',
  currency,cashAccountId:cash.id,expenseArticleId:article.id,rate:currency==='BYN'?1:3.001,comment:marker});
 const {prepared}=await prepareStockPurchase(actor,input,tx);
 const receipt=await createStockPurchaseInTransaction(actor,input,prepared,tx);
 return {actor,material,cash,article,client,project,product,input,prepared,receipt};
}
/** Точная уборка только собственного набора QA; применяется также после мягкой отмены. */
export async function deleteDeletionFixture(tx:Prisma.TransactionClient,marker:string){
 const user=await tx.user.findUnique({where:{id:marker}});if(!user)return;
 assert.equal(user.email,marker+'@invalid.local');assert.ok(marker.startsWith('qa109-'));
 await tx.payment.updateMany({where:{createdById:marker},data:{deletionId:null}});
 await tx.stockMovement.updateMany({where:{createdById:marker,materialId:marker},data:{deletionId:null}});
 await tx.warehouseMovementDeletion.deleteMany({where:{actorId:marker,rootMovement:{materialId:marker}}});
 await tx.stockPurchase.deleteMany({where:{actorId:marker}});
 await tx.warehouseMovementValuation.deleteMany({where:{actorId:marker,movement:{materialId:marker}}});
 await tx.stockMovement.deleteMany({where:{createdById:marker,materialId:marker}});
 await tx.warehouseBalance.deleteMany({where:{materialId:marker}});
 await tx.payment.deleteMany({where:{createdById:marker,comment:marker}});
 await tx.projectMaterial.deleteMany({where:{productId:marker,materialId:marker}});
 await tx.product.deleteMany({where:{id:marker,projectId:marker,title:marker}});
 await tx.project.deleteMany({where:{id:marker,clientId:marker,title:marker}});
 await tx.client.deleteMany({where:{id:marker,name:marker}});
 await tx.material.deleteMany({where:{id:marker,name:marker}});
 await tx.cashAccount.deleteMany({where:{id:marker,name:marker}});
 await tx.expenseArticle.deleteMany({where:{id:marker,name:marker}});
 await tx.changeLog.deleteMany({where:{actorId:marker}});
 await tx.domainEvent.deleteMany({where:{actor:marker}});
 await tx.user.deleteMany({where:{id:marker,email:marker+'@invalid.local'}});
}
