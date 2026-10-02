import assert from "node:assert/strict";
import test from "node:test";
import {singleProductPercentagePreview} from "../src/lib/single-product-percentage-ui";
const draft={state:"DRAFT" as const,version:2 as const,unitPrice:"1000.00",quantity:3,rate:"5.00",frozenTotal:null};
test("positive live preview is unavailable without eligible confirmed recipient",()=>{
 const withEligibility=singleProductPercentagePreview as (input:typeof draft&{recipientEligible:boolean})=>string|null;
 assert.equal(withEligibility({...draft,recipientEligible:false}),null);
 assert.equal(withEligibility({...draft,recipientEligible:true}),"150.00");
});

test("confirmed assembly recipient replaces stale inactive metadata after ACK and preserves WORKER union",async()=>{
 const {confirmedPercentageRecipient,percentageRecipientLabel,percentageStageTitle}=await import("../src/lib/single-product-percentage-ui");
 const old={userId:"old",name:"Old",active:false,eligible:false};
 const current=confirmedPercentageRecipient("ASSEMBLY","new",[{id:"new",name:"New worker",active:true,roles:["MANAGER","WORKER"]}],[],old);
 assert.equal(current.name,"New worker");assert.equal(current.active&&current.eligible,true);
 assert.equal(percentageRecipientLabel("ASSEMBLY"),"Сборщик");assert.equal(percentageStageTitle("ASSEMBLY"),"Сборочный этап");
 assert.equal(confirmedPercentageRecipient("ASSEMBLY","wrong",[{id:"wrong",name:"Mounter",active:true,roles:["MOUNTER"]}],[],old).eligible,false);
 assert.equal(confirmedPercentageRecipient("ASSEMBLY",null,[],[],old).userId,null);
 assert.equal(confirmedPercentageRecipient("ASSEMBLY","query-new",[],[{userId:"query-new",name:"Actual query"}],old).eligible,true);
});

test("zero rate can show zero without recipient; frozen amounts ignore current recipient eligibility",()=>{
 assert.equal(singleProductPercentagePreview({...draft,rate:"0.00",recipientEligible:false}),"0.00");
 assert.equal(singleProductPercentagePreview({...draft,state:"SETTLED",frozenTotal:"150.00",recipientEligible:false}),"150.00");
});

test("assembly uses the same closed partial contract and FIFO revision cache",async()=>{
 const {createSinglePercentageControllers}=await import("../src/lib/single-percentage-controller");
 const requests:import("../src/server/product-percentage-pay/contracts").ProductPercentagePatch[]=[];let sequence=0;
 const group=createSinglePercentageControllers({productId:"product",kind:"ASSEMBLY",initial:{ratePercent:null,assigneeId:null,workReview:[]},revision:0,workIds:[],id:()=>`00000000-0000-4000-8000-${String(++sequence).padStart(12,"0")}`,save:async input=>{requests.push(input);return{ok:true,kind:"saved",field:input.field,value:input.value,revision:input.expectedRevision+1,clientMutationId:input.clientMutationId,noOp:false,repeated:false}}});
 group.controllers.assigneeId.setDraft("worker");await group.controllers.assigneeId.commit();group.controllers.ratePercent.setDraft("5");await group.controllers.ratePercent.commit();
 assert.equal(requests[0].kind,"ASSEMBLY");assert.equal(requests[0].field,"assigneeId");assert.equal(requests[0].value,"worker");assert.equal(requests[1].expectedRevision,1);
});
