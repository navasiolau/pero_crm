import assert from "node:assert/strict";
import test from "node:test";
import { stockPurchaseSchema } from "../src/server/warehouse/contracts";
import { stockPurchaseAmount, addPaidPosition } from "../src/lib/warehouse-cost";
import { paymentDetailsSchema, paymentSchema } from "../src/server/payments/contracts";
import { guardedModuleCache } from "./helpers/guarded-module-cache";
const input={clientMutationId:"a9ed509d-b9f5-4e53-bd3c-c35c7f761606",materialId:"m",quantity:"3",unitPrice:"7.33",currency:"USD",cashAccountId:"cash",expenseArticleId:"article"};
test("purchase amount rounds once in cash currency and cannot round to zero",()=>{
 assert.equal(stockPurchaseAmount("3","7.33"),"21.99");
 assert.equal(stockPurchaseAmount("1.5","0.01"),"0.02");
 assert.throws(()=>stockPurchaseAmount("0.001","0.01"),/больше нуля/);
 assert.throws(()=>stockPurchaseAmount("1000000","1000000"),/предел/);
});
test("capitalized value equals saved BYN payment even when unit value needs nine decimals",()=>{
 const result=addPaidPosition({quantity:"0",value:"0"},"3","65.99");
 assert.equal(result.money,"65.99");assert.equal(result.value,"65.990000000");
 assert.equal(result.cost,"21.996666667");assert.equal(result.position.value,"65.990000000");
});
test("paid stock contract owns quantity and price, refusing client totals, project and policy flags",()=>{
 assert.equal(stockPurchaseSchema.parse(input).quantity,"3.000");
 assert.equal(stockPurchaseSchema.parse({...input,quantity:"3,125"}).quantity,"3.125");
 for(const extra of [{amount:1},{bynAmount:1},{projectId:"p"},{skipReportDocument:true},{stockMovementId:"m"}])
  assert.equal(stockPurchaseSchema.safeParse({...input,...extra}).success,false);
 assert.equal(stockPurchaseSchema.safeParse({...input,quantity:"3.0001"}).success,false);
});
test("paid receipt accepts an optional document but refuses empty identifiers",()=>{
 assert.equal(stockPurchaseSchema.parse({...input,reportDocumentId:"document"}).reportDocumentId,"document");
 assert.equal(stockPurchaseSchema.parse(input).reportDocumentId,undefined);
 assert.equal(stockPurchaseSchema.safeParse({...input,reportDocumentId:""}).success,false);
 const nested={direction:"EXPENSE",amount:1,currency:"BYN",cashAccountId:"cash",clientMutationId:input.clientMutationId};
 assert.equal(paymentDetailsSchema.parse(nested).clientMutationId,input.clientMutationId);
 assert.equal(paymentDetailsSchema.safeParse({...nested,clientMutationId:undefined}).success,true);
 assert.equal(paymentSchema.safeParse({...nested,clientMutationId:undefined}).success,false);
});

test("actual paid-stock service distinguishes prewrite/rollback from uncertain receipt or commit",async()=>{
 let mode="prewrite",writes=0,transactions=0,receipt:object|null=null;const effects:string[]=[];
 class ReceiptConflict extends Error{}
 const owned={id:"owned-stock",payment:{amount:{toNumber:()=>60}}};
 const db={},tx={fence:true};
 const overrides={
  "next/cache":{revalidatePath:(value:string)=>effects.push(value)},
  "../src/server/plugins/events":{dispatchEvent:async()=>{effects.push("dispatch")}},
  "../src/server/notifications/notify":{notifyOrg:async()=>{effects.push("org")}},
  "../src/server/warehouse/revalidate":{revalidateWarehouse:async()=>{effects.push("warehouse");if(mode==="cache-fault")throw Error("cache fault")}},
  "../src/server/tasks/transaction":{withTaskTransaction:async(operation:(client:unknown)=>Promise<unknown>)=>{
   transactions++;const before=receipt;let result;try{result=await operation(tx)}catch(error){receipt=before;throw error}
   if(mode==="ack-loss"&&transactions===1)throw Error("lost commit ACK");return result;
  }},
  "../src/server/warehouse/stock-purchase-core":{
   StockPurchaseReceiptError:ReceiptConflict,
   readStockPurchaseReceipt:async(_actor:unknown,_data:unknown,client:unknown)=>{if(mode==="receipt-io"||mode==="proof-io"&&client===tx)throw Error("receipt IO");if(mode==="conflict")throw new ReceiptConflict("other payload");return receipt},
   prepareStockPurchase:async()=>{if(mode==="prewrite")throw Error("Материал не найден");return{prepared:{}}},
   createStockPurchaseInTransaction:async()=>{writes++;if(mode==="abort"||mode==="proof-io")throw Error("last-write failed");receipt=owned;return{receipt:owned,repeated:false,eventIds:["owned-event"]}},
  },
 };
 const modules=guardedModuleCache(import.meta.url,{targets:["../src/server/warehouse/stock-purchase-service"],allowedOverrides:Object.keys(overrides),overrides,prisma:db});
 try{
  const {createStockPurchaseCore}=modules.load<typeof import("../src/server/warehouse/stock-purchase-service")>("../src/server/warehouse/stock-purchase-service");
  const actor={id:"own-actor",name:"QA",roles:["ACCOUNTANT"as const],source:"web"as const};
  for(const next of ["prewrite","receipt-io","conflict","abort","proof-io","ack-loss","cache-fault"]){
   mode=next;writes=0;transactions=0;receipt=null;effects.length=0;const result=await createStockPurchaseCore(actor,input);
   assert.equal(result.clientMutationId,input.clientMutationId);
   if(["ack-loss","cache-fault"].includes(mode)){assert.equal(result.ok,true);if(result.ok)assert.equal(result.resultId,"owned-stock");assert.equal(writes,1);assert.equal(effects.length,6)}
   else{assert.equal(result.ok,false);assert.equal(result.outcome,["receipt-io","proof-io"].includes(mode)?"UNKNOWN":"ROLLED_BACK");assert.equal(effects.length,0);if(["prewrite","receipt-io","conflict"].includes(mode))assert.equal(writes+transactions,0)}
  }
 }finally{modules.restore()}
});
