import assert from "node:assert/strict";
import test from "node:test";
import {singleProductPercentagePreview} from "../src/lib/single-product-percentage-ui";
const draft={state:"DRAFT" as const,version:2 as const,unitPrice:"1000.00",quantity:3,rate:"5.00",frozenTotal:null};
test("new v2 preview uses saved unit price ×quantity×rate",()=>assert.equal(singleProductPercentagePreview(draft),"150.00"));
test("frozen and old v1 previews retain their original base",()=>{
 assert.equal(singleProductPercentagePreview({...draft,version:1}),"50.00");
 assert.equal(singleProductPercentagePreview({...draft,state:"SETTLED",unitPrice:"9999.00",quantity:99,frozenTotal:"150.00"}),"150.00");
 assert.equal(singleProductPercentagePreview({...draft,state:"LEGACY_PROTECTED",frozenTotal:null}),null);
});
test("unknown price/quantity and explicit zeros stay distinct",()=>{
 assert.equal(singleProductPercentagePreview({...draft,unitPrice:null}),null);
 assert.equal(singleProductPercentagePreview({...draft,quantity:null}),null);
 assert.equal(singleProductPercentagePreview({...draft,unitPrice:"0.00"}),"0.00");
 assert.equal(singleProductPercentagePreview({...draft,rate:"0.00"}),"0.00");
});
