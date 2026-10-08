import assert from "node:assert/strict";
import test from "node:test";
import { stockIssueSchema, stockReturnSchema } from "../src/server/warehouse/contracts";
import { materialPlanFloor, planQuantityChange } from "../src/lib/product-quantity";
const base={clientMutationId:"96cc1e10-6b50-48d6-8e06-9445b1d4c882",quantity:"3"};
test("one issue contract supports direct product/material and legacy need, never a client price",()=>{
 assert.equal(stockIssueSchema.safeParse({...base,productId:"p",materialId:"m"}).success,true);
 assert.equal(stockIssueSchema.safeParse({...base,projectMaterialId:"line"}).success,true);
 for(const extra of [{productId:"p"},{materialId:"m"},{productId:"p",materialId:"m",projectMaterialId:"line"},{productId:"p",materialId:"m",unitPrice:"20"}])
  assert.equal(stockIssueSchema.safeParse({...base,...extra}).success,false);
});
test("direct return requires source and product, legacy manual price remains confined to a need",()=>{
 assert.equal(stockReturnSchema.safeParse({...base,productId:"p",sourceMovementId:"source"}).success,true);
 assert.equal(stockReturnSchema.safeParse({...base,projectMaterialId:"line",sourceMovementId:"source"}).success,true);
 assert.equal(stockReturnSchema.safeParse({...base,projectMaterialId:"line",unitPrice:"20"}).success,true);
 assert.equal(stockReturnSchema.safeParse({...base,productId:"p",unitPrice:"20"}).success,false);
 assert.equal(stockReturnSchema.safeParse({...base,productId:"p",sourceMovementId:"source",unitPrice:"20"}).success,false);
});
test("over-issue cannot force artificial plan growth while previous ordinary decrease guards remain",()=>{
 assert.equal(materialPlanFloor("2","3"),"2.000");assert.equal(materialPlanFloor("10","3"),"3.000");
 const line={id:"n",quantity:"2",quantityPerUnit:"2",issuedQty:"3",material:{name:"Петля"}};
 assert.equal(planQuantityChange(1,1,[],[line]).materials[0].quantity,"2.000");
 assert.equal(planQuantityChange(1,2,[],[line]).materials[0].quantity,"4.000");
 assert.throws(()=>planQuantityChange(2,1,[],[{...line,quantity:"4",issuedQty:"3"}]),/верните/);
 assert.throws(()=>planQuantityChange(2,1,[],[{...line,quantity:"4",issuedQty:"6"}]),/верните/);
});
