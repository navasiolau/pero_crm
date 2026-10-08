import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { createTaskTransaction } from "../src/server/tasks/transaction";
import { readCashBalance, readOrgBalance } from "../src/server/payroll/cash-core";
import { stockPurchaseSchema } from "../src/server/warehouse/contracts";
import { prepareStockPurchase, createStockPurchaseInTransaction } from "../src/server/warehouse/stock-purchase-core";
import { stockPurchaseBaseline } from "./paid-stock-native-scenarios";

/** Two real SQL transactions/locks. The optional local-only seam supplies an
 * absent phase reader for OWN materials; it never changes global warehouse state. */
export async function runPaidStockConcurrent(db: PrismaClient, allowMissingLocalState = false) {
  const before=await stockPurchaseBaseline(db),marker=`qa103-race-${randomUUID()}`;
  const originalState=await db.warehouseAccountingState.findUnique({where:{id:"main"}});
  if(originalState)assert.equal(originalState.phase,"ACTIVE");
  else {
    assert.ok(allowMissingLocalState,"STAGING_REQUIRES_REAL_ACTIVE_STATE");
    const target=new URL(process.env.DATABASE_URL??"");
    assert.ok(["localhost","127.0.0.1"].includes(target.hostname)&&target.port==="5433"&&target.pathname==="/pero_crm");
  }
  const transaction=createTaskTransaction(db);
  function stockTx(tx:Prisma.TransactionClient):Prisma.TransactionClient {
    if(originalState)return tx;
    return new Proxy(tx,{get(target,property,receiver){
      if(property==="warehouseAccountingState")return {findUnique:async(args:{where:{id:string}})=>{
        assert.equal(args.where.id,"main");return {id:"main",phase:"ACTIVE",runId:marker};
      }};
      return Reflect.get(target,property,receiver);
    }});
  }
  let materialId="",accountId="",articleId="";
  try{
    const actor=await transaction(async tx=>{
      const user=await tx.user.create({data:{id:marker,name:marker,email:`${marker}@invalid.local`,passwordHash:"qa-login-disabled",roles:["PROCUREMENT"]}});
      materialId=(await tx.material.create({data:{name:marker,purchasePrice:0}})).id;
      accountId=(await tx.cashAccount.create({data:{name:marker,currency:"BYN"}})).id;
      const max=await tx.expenseArticle.aggregate({_max:{code:true}});
      articleId=(await tx.expenseArticle.create({data:{name:marker,code:(max._max.code??0)+1}})).id;
      const org=await readOrgBalance(tx,"1.000000"),topup=Prisma.Decimal.max(1000,org.negated().plus(1000));
      await tx.payment.create({data:{direction:"INCOME",amount:topup,bynAmount:topup,currency:"BYN",rate:1,createdById:marker,comment:marker}});
      await tx.payment.create({data:{direction:"INCOME",amount:100,bynAmount:100,currency:"BYN",rate:1,cashAccountId:accountId,createdById:marker,comment:marker}});
      return {id:user.id,name:user.name,roles:user.roles,source:"web" as const};
    });
    const data=stockPurchaseSchema.parse({clientMutationId:randomUUID(),materialId,quantity:"3",unitPrice:"20",currency:"BYN",cashAccountId:accountId,expenseArticleId:articleId,comment:marker});
    const prepared=(await prepareStockPurchase(actor,data,db)).prepared;
    const execute=(input:typeof data)=>transaction(tx=>createStockPurchaseInTransaction(actor,input,prepared,stockTx(tx)));
    const duplicates=await Promise.all([execute(data),execute(data)]);
    assert.equal(duplicates[0].receipt.id,duplicates[1].receipt.id);
    assert.equal(duplicates.filter(row=>!row.repeated).length,1);
    assert.equal(await db.stockPurchase.count({where:{actorId:marker}}),1);
    await transaction(tx=>tx.payment.create({data:{direction:"INCOME",amount:60,bynAmount:60,currency:"BYN",rate:1,cashAccountId:accountId,createdById:marker,comment:marker}}));
    const competing=await Promise.allSettled([execute({...data,clientMutationId:randomUUID()}),execute({...data,clientMutationId:randomUUID()})]);
    assert.equal(competing.filter(row=>row.status==="fulfilled").length,1);
    const rejected=competing.find(row=>row.status==="rejected");
    assert.ok(rejected&&rejected.status==="rejected");assert.match(String(rejected.reason),/Недостаточно средств в выбранной кассе/);
    assert.equal((await transaction(tx=>readCashBalance(tx,accountId))).toFixed(2),"40.00");
    const stock=await db.warehouseBalance.findUniqueOrThrow({where:{materialId}});
    assert.equal(stock.quantity.toString(),"6");assert.equal(stock.valueByn.toFixed(2),"120.00");
    assert.equal(await db.stockPurchase.count({where:{actorId:marker}}),2);
    assert.equal(await db.stockMovement.count({where:{materialId,createdById:marker}}),2);
    assert.equal(await db.payment.count({where:{createdById:marker,direction:"EXPENSE"}}),2);
    return {status:"PASS",duplicateWrites:1,competingSuccesses:1,competingRejections:1,cashBalance:40,warehouseState:originalState?"REAL_ACTIVE":"LOCAL_READ_FIXTURE",providerMessages:0};
  }finally{
    await transaction(async tx=>{
      await tx.stockPurchase.deleteMany({where:{actorId:marker}});
      await tx.warehouseMovementValuation.deleteMany({where:{actorId:marker,movement:{materialId}}});
      await tx.stockMovement.deleteMany({where:{materialId,createdById:marker}});
      if(materialId)await tx.warehouseBalance.deleteMany({where:{materialId}});
      await tx.payment.deleteMany({where:{createdById:marker,comment:marker}});
      await tx.changeLog.deleteMany({where:{actorId:marker}});
      await tx.domainEvent.deleteMany({where:{actor:marker}});
      if(materialId)await tx.material.deleteMany({where:{id:materialId,name:marker}});
      if(accountId)await tx.cashAccount.deleteMany({where:{id:accountId,name:marker}});
      if(articleId)await tx.expenseArticle.deleteMany({where:{id:articleId,name:marker}});
      await tx.user.deleteMany({where:{id:marker,name:marker}});
    });
    assert.deepEqual(await stockPurchaseBaseline(db),before,"CONCURRENCY_ORIGINAL_DATA_CHANGED");
  }
}
