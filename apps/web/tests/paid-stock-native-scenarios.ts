import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { createTaskTransaction } from "../src/server/tasks/transaction";
import { readCashBalance, readOrgBalance } from "../src/server/payroll/cash-core";
import { createPaymentInTransaction } from "../src/server/payments/transaction";
import { deletePaymentInTransaction } from "../src/server/payments/delete-core";
import { stockPurchaseSchema } from "../src/server/warehouse/contracts";
import { prepareStockPurchase, createStockPurchaseInTransaction } from "../src/server/warehouse/stock-purchase-core";
import { loadOrganizationPayments } from "../src/server/finance/organization-ledger";

export async function stockPurchaseBaseline(db: PrismaClient) {
  const result:Record<string,unknown>={};
  for(const table of ["WarehouseAccountingState","WarehouseBalance","WarehouseMovementValuation","StockPurchase","StockMovement","Material","User","CashAccount","ExpenseArticle","Payment","Payout","ChangeLog","DomainEvent"])
    result[table]=await db.$queryRawUnsafe(`SELECT count(*)::text n,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) digest FROM (SELECT md5(to_jsonb(t)::text) h FROM "${table}" t) x`);
  return result;
}
export async function runPaidStockNative(db: PrismaClient) {
  const before=await stockPurchaseBaseline(db);
  const verified:string[]=[];
  for(const mode of ["success","cash-shortage","last-write-failure"] as const) {
    const marker=`qa103-${randomUUID()}`,abort=Error("QA103_ROLLBACK"),fault=Error("QA103_LAST_WRITE_FAILURE");
    try {
      await createTaskTransaction(db)(async tx=>{
        const state=await tx.warehouseAccountingState.findUnique({where:{id:"main"}});
        if(state)assert.equal(state.phase,"ACTIVE");
        else await tx.warehouseAccountingState.create({data:{id:"main",phase:"ACTIVE",runId:marker,beforePrices:{},beforeBalances:{}}});
        const user=await tx.user.create({data:{id:marker,name:marker,email:`${marker}@invalid.local`,passwordHash:"qa-login-disabled",roles:["PROCUREMENT"]}});
        const actor={id:user.id,name:user.name,roles:user.roles,source:"telegram" as const};
        const material=await tx.material.create({data:{id:marker,name:marker,purchasePrice:0}});
        const account=await tx.cashAccount.create({data:{name:marker,currency:"BYN"}});
        const maxCode=await tx.expenseArticle.aggregate({_max:{code:true}});
        const article=await tx.expenseArticle.create({data:{name:marker,code:(maxCode._max.code??0)+1}});
        const org=await readOrgBalance(tx,"1.000000");
        await tx.payment.create({data:{direction:"INCOME",amount:Prisma.Decimal.max(1000,org.negated().plus(1000)),bynAmount:Prisma.Decimal.max(1000,org.negated().plus(1000)),currency:"BYN",rate:1,createdById:user.id}});
        const funding=mode==="cash-shortage"?50:1000;
        await tx.payment.create({data:{direction:"INCOME",amount:funding,bynAmount:funding,currency:"BYN",rate:1,cashAccountId:account.id,createdById:user.id}});
        const data=stockPurchaseSchema.parse({clientMutationId:randomUUID(),materialId:material.id,quantity:"3",unitPrice:"20",currency:"BYN",cashAccountId:account.id,expenseArticleId:article.id,comment:marker});
        const {prepared}=await prepareStockPurchase(actor,data,tx,async()=>assert.fail("UNEXPECTED_FX"));
        if(mode==="last-write-failure"){
          const faultTx=new Proxy(tx,{get(target,property,receiver){
            if(property==="stockPurchase")return {...target.stockPurchase,create:async()=>{
              assert.equal(await tx.payment.count({where:{createdById:user.id,direction:"EXPENSE"}}),1);
              assert.equal(await tx.stockMovement.count({where:{materialId:material.id}}),1);
              throw fault;
            }};
            return Reflect.get(target,property,receiver);
          }});
          await createStockPurchaseInTransaction(actor,data,prepared,faultTx);
          assert.fail("FAULT_NOT_REACHED");
        }
        const first=await createStockPurchaseInTransaction(actor,data,prepared,tx);
        if(mode==="cash-shortage")assert.fail("INSUFFICIENT_CASH_ACCEPTED");
        assert.equal(first.receipt.movement.receiptKind,"PAID");
        assert.equal(first.receipt.payment.projectId,null);assert.equal(first.receipt.payment.projectAmount,null);
        assert.equal(first.receipt.payment.reportDocumentId,null);
        assert.equal(first.receipt.payment.amount.toFixed(2),"60.00");
        assert.equal(first.receipt.movement.totalByn?.toFixed(2),"60.00");
        const ledger = await loadOrganizationPayments(actor,"EXPENSE",tx);
        const visible = ledger.rows.find(row=>row.id===first.receipt.paymentId);
        assert.ok(visible?.stockPurchase);assert.equal(visible.stockPurchase.quantity,"3");
        assert.equal(visible.stockPurchase.stockValueByn,60);
        assert.equal(visible.stockPurchase.movementId,first.receipt.movementId);
        assert.ok(!JSON.stringify(visible).includes(first.receipt.requestFingerprint));
        assert.equal((await readCashBalance(tx,account.id)).toFixed(2),"940.00");
        const balance=await tx.warehouseBalance.findUniqueOrThrow({where:{materialId:material.id}});
        assert.equal(balance.quantity.toString(),"3");assert.equal(balance.valueByn.toFixed(9),"60.000000000");
        const repeat=await createStockPurchaseInTransaction(actor,data,{...prepared,rate:999,bynAmount:999},tx);
        assert.equal(repeat.repeated,true);assert.equal(repeat.receipt.id,first.receipt.id);assert.equal(repeat.eventIds.length,0);
        await assert.rejects(createStockPurchaseInTransaction(actor,{...data,unitPrice:"21.00"},prepared,tx),/другими данными/);
        await assert.rejects(prepareStockPurchase({...actor,roles:["MANAGER"]},data,tx),/прав/);
        const plain={direction:"EXPENSE" as const,projectId:null,amount:60,currency:"BYN",cashAccountId:account.id,expenseArticleId:article.id};
        await assert.rejects(createPaymentInTransaction(actor,plain,prepared,tx),/документ/i);
        await assert.rejects(createPaymentInTransaction(actor,plain,prepared,tx,{movementId:first.receipt.movementId}),/прихода/);
        await assert.rejects(deletePaymentInTransaction(actor,first.receipt.paymentId,"EXPENSE","BYN","1",tx),/связан/);
        await tx.$executeRawUnsafe("SAVEPOINT stock_purchase_delete_guard");
        await assert.rejects(tx.payment.delete({where:{id:first.receipt.paymentId}}),/constraint/i);
        await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT stock_purchase_delete_guard");
        const usd=await tx.cashAccount.create({data:{name:marker+"-usd",currency:"USD"}});
        await tx.payment.create({data:{direction:"INCOME",amount:100,bynAmount:300,currency:"USD",rate:3,cashAccountId:usd.id,createdById:user.id}});
        const fxMaterial=await tx.material.create({data:{name:marker+"-fx",purchasePrice:0}});
        const fxData={...data,clientMutationId:randomUUID(),materialId:fxMaterial.id,cashAccountId:usd.id,currency:"USD",unitPrice:"7.33",rate:3.001};
        const accountant={...actor,roles:["ACCOUNTANT" as const]};
        const fxPrepared=(await prepareStockPurchase(accountant,fxData,tx)).prepared;
        assert.equal(fxPrepared.amount,21.99);assert.equal(fxPrepared.bynAmount,65.99);
        const fxReceipt=await createStockPurchaseInTransaction(accountant,fxData,fxPrepared,tx);
        const fxBalance=await tx.warehouseBalance.findUniqueOrThrow({where:{materialId:fxMaterial.id}});
        assert.equal(fxBalance.valueByn.toFixed(9),"65.990000000");
        assert.equal((await readCashBalance(tx,usd.id)).toFixed(2),"78.01");
        assert.equal((await tx.warehouseMovementValuation.findUniqueOrThrow({where:{movementId:fxReceipt.receipt.movementId}})).unitCost.toFixed(9),"21.996666667");
        assert.equal(await tx.stockPurchase.count({where:{actorId:user.id}}),2);
        assert.equal(await tx.payment.count({where:{createdById:user.id,direction:"EXPENSE"}}),2);
        assert.equal(await tx.domainEvent.count({where:{actor:user.id}}),4);
        assert.equal(await tx.changeLog.count({where:{actorId:user.id,source:"telegram",action:"create"}}),4);
        verified.push(mode);throw abort;
      });
    } catch(error) {
      if(mode==="success"&&error===abort) { /* expected owned fixture rollback */ }
      else if(mode==="last-write-failure"&&error===fault)verified.push(mode);
      else if(mode==="cash-shortage"&&error instanceof Error&&/Недостаточно средств в выбранной кассе/.test(error.message))verified.push(mode);
      else throw error;
    }
    assert.deepEqual(await stockPurchaseBaseline(db),before,"ORIGINAL_DATA_CHANGED:"+mode);
  }
  assert.equal(verified.length,3);
  return {status:"PASS",scenarios:verified,paidStockByn:60,usdCash:21.99,usdStockByn:65.99,documentExemption:"TRUSTED_MOVEMENT_ONLY",receipt:"ONE",deleteGuard:"SERVER_AND_FK",originalData:"MATCH",qaRows:"ROLLED_BACK",providerMessages:0};
}
