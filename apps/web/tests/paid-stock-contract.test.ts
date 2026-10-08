import assert from "node:assert/strict";
import test from "node:test";
import { stockPurchaseSchema } from "../src/server/warehouse/contracts";
import { stockPurchaseAmount, addPaidPosition } from "../src/lib/warehouse-cost";
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
