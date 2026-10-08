import {randomUUID} from 'node:crypto';import type {Prisma,PrismaClient} from '@prisma/client';
import {stockPurchaseBaseline} from '../paid-stock-native-scenarios';
export async function documentRowBaseline(db:PrismaClient){
 return {...await stockPurchaseBaseline(db),documents:await db.$queryRawUnsafe(`SELECT count(*)::text n,md5(COALESCE(string_agg(md5(to_jsonb(t)::text),'' ORDER BY id),'')) digest FROM "FinanceDocument" t`)};
}
/** Собственная историческая read-фикстура: никаких dispatch или денежных action. */
export async function createDocumentRowFixture(tx:Prisma.TransactionClient,marker:string){
 const user=await tx.user.create({data:{id:marker,email:marker+'@invalid.local',name:marker,passwordHash:'qa-login-disabled',roles:['PROCUREMENT']}});
 const cash=await tx.cashAccount.create({data:{id:marker+'-cash',name:marker,currency:'BYN'}});
 const max=await tx.expenseArticle.aggregate({_max:{code:true}});
 const article=await tx.expenseArticle.create({data:{id:marker+'-article',name:marker,code:(max._max.code??0)+1}});
 const material=await tx.material.create({data:{id:marker+'-material',name:marker,unit:'шт',purchasePrice:20}});
 const paid=await tx.stockMovement.create({data:{id:marker+'-paid',materialId:material.id,type:'INCOME',receiptKind:'PAID',quantity:3,unitPrice:20,totalByn:60,createdById:marker,comment:marker}});
 const inventory=await tx.stockMovement.create({data:{id:marker+'-inventory',materialId:material.id,type:'INCOME',receiptKind:'INVENTORY',quantity:1,unitPrice:20,totalByn:20,createdById:marker,comment:marker}});
 const payment=await tx.payment.create({data:{id:marker+'-payment',direction:'EXPENSE',amount:60,bynAmount:60,rate:1,currency:'BYN',cashAccountId:cash.id,expenseArticleId:article.id,createdById:marker,comment:marker}});
 await tx.payment.create({data:{id:marker+'-old',direction:'EXPENSE',amount:5,bynAmount:5,rate:1,currency:'BYN',cashAccountId:cash.id,expenseArticleId:article.id,createdById:marker,comment:marker}});
 await tx.stockPurchase.create({data:{clientMutationId:randomUUID(),requestFingerprint:marker,actorId:marker,unitPrice:20,movementId:paid.id,paymentId:payment.id}});
 return {user,cash,article,material,paid,inventory,payment};
}
export async function deleteDocumentRowFixture(tx:Prisma.TransactionClient,marker:string){
 await tx.stockPurchase.deleteMany({where:{actorId:marker}});
 await tx.stockMovement.deleteMany({where:{createdById:marker,comment:marker}});
 await tx.payment.deleteMany({where:{createdById:marker,comment:marker}});
 await tx.changeLog.deleteMany({where:{actorId:marker,entity:'financeDocument'}});
 await tx.financeDocument.deleteMany({where:{uploadedById:marker}});
 await tx.material.deleteMany({where:{id:marker+'-material',name:marker}});
 await tx.expenseArticle.deleteMany({where:{id:marker+'-article',name:marker}});
 await tx.cashAccount.deleteMany({where:{id:marker+'-cash',name:marker}});
 await tx.user.deleteMany({where:{id:marker,email:marker+'@invalid.local'}});
}
