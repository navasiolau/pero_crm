import assert from "node:assert/strict";
import { test } from "node:test";
import { type ProductPercentagePatch, type ProductPercentagePatchResult } from "../src/server/product-percentage-pay/contracts";
import { singleProductPercentagePreview } from "../src/lib/single-product-percentage-ui";
import { createSinglePercentageControllers } from "../src/lib/single-percentage-controller";

{ // Источник: single-product-percentage-ui.test.ts
const draft={state:"DRAFT" as const,kind:"ASSEMBLY" as const,version:2 as const,unitPrice:"1000.00",quantity:3,rate:"5.00",frozenTotal:null};
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

test("v3 preview matches each recipient formula and engineering ignores quantity",()=>{
 for(const [kind,rate,amount] of [["ENGINEERING","5.00","50.00"],["ASSEMBLY","4.00","120.00"],["INSTALLATION","7.00","210.00"]] as const){
  assert.equal(singleProductPercentagePreview({...draft,version:3,kind,rate}),amount);
  assert.equal(singleProductPercentagePreview({...draft,version:3,kind,rate,quantity:6}),kind==="ENGINEERING"?amount:kind==="ASSEMBLY"?"240.00":"420.00");
 }
});
}

{ // Источник: assembly-percentage-ui.test.ts
const draft={state:"DRAFT" as const,kind:"ASSEMBLY" as const,version:2 as const,unitPrice:"1000.00",quantity:3,rate:"5.00",frozenTotal:null};
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
 const group=createSinglePercentageControllers({productId:"product",kind:"ASSEMBLY",initial:{ratePercent:null,assigneeId:null},revision:0,id:()=>`00000000-0000-4000-8000-${String(++sequence).padStart(12,"0")}`,save:async input=>{requests.push(input);return{ok:true,kind:"saved",field:input.field,value:input.value,revision:input.expectedRevision+1,clientMutationId:input.clientMutationId,noOp:false,repeated:false}}});
 group.controllers.assigneeId.setDraft("worker");await group.controllers.assigneeId.commit();group.controllers.ratePercent.setDraft("5");await group.controllers.ratePercent.commit();
 assert.equal(requests[0].kind,"ASSEMBLY");assert.equal(requests[0].field,"assigneeId");assert.equal(requests[0].value,"worker");assert.equal(requests[1].expectedRevision,1);
});
}

// Источник: single-percentage-controller.test.ts
const tick=()=>new Promise(done=>setTimeout(done,0));
function setup(save:(input:ProductPercentagePatch)=>Promise<ProductPercentagePatchResult>){let sequence=0;return createSinglePercentageControllers({productId:"product",kind:"INSTALLATION",initial:{ratePercent:null,assigneeId:null},revision:0,save,id:()=>`00000000-0000-4000-8000-${String(++sequence).padStart(12,"0")}`});}
const saved=(input:ProductPercentagePatch,revision=input.expectedRevision+1):ProductPercentagePatchResult=>({ok:true,kind:"saved",field:input.field,value:input.value,revision,clientMutationId:input.clientMutationId,noOp:false,repeated:false});
test("per-kind FIFO captures peer expectedRevision only after confirmed preceding ACK",async()=>{
 const calls:ProductPercentagePatch[]=[];let release!:(value:ProductPercentagePatchResult)=>void;
 const s=setup(async input=>{calls.push(input);if(calls.length===1)return new Promise(done=>{release=done});return saved(input)});
 s.controllers.ratePercent.setDraft("5");const first=s.controllers.ratePercent.commit();s.controllers.assigneeId.setDraft("mounter");const peer=s.controllers.assigneeId.commit();await tick();assert.equal(calls.length,1);
 s.controllers.assigneeId.setDraft("newer local choice");release(saved(calls[0]));await Promise.all([first,peer]);assert.equal(calls[1].expectedRevision,1);assert.equal(calls[1].expectedValue,null);assert.equal(s.controllers.assigneeId.getSnapshot().draft,"newer local choice");
 await s.controllers.assigneeId.commit();assert.equal(calls[2].expectedRevision,2);assert.equal(calls[2].expectedValue,"mounter");
});
test("lost ACK retries the entire exact envelope and blocks peer writes until confirmed",async()=>{
 const calls:ProductPercentagePatch[]=[];let fail=true;
 const s=setup(async input=>{calls.push(input);if(fail)throw Error("lost ACK");return saved(input)});
 s.controllers.ratePercent.setDraft("5");assert.equal(await s.controllers.ratePercent.commit(),false);s.controllers.assigneeId.setDraft("mounter");assert.equal(await s.controllers.assigneeId.commit(),false);assert.equal(calls.length,1);
 assert.equal(await s.cancel("ratePercent"),false);fail=false;assert.equal(await s.controllers.ratePercent.retry(),true);assert.deepEqual(calls[1],calls[0]);assert.equal(await s.controllers.assigneeId.retry(),true);assert.equal(calls[2].expectedRevision,1);
});
test("conflict keeps all drafts; only explicit rebase accepts current revision",async()=>{
 const calls:ProductPercentagePatch[]=[];
 const s=setup(async input=>{calls.push(input);return calls.length===1?{ok:false,kind:"conflict",error:"Changed",currentValue:"10.00",currentRevision:7}:saved(input)});
 s.controllers.ratePercent.setDraft("5");await s.controllers.ratePercent.commit();s.controllers.assigneeId.setDraft("mine");await s.controllers.assigneeId.commit();assert.equal(calls.length,1);assert.equal(s.controllers.ratePercent.getSnapshot().draft,"5");assert.equal(await s.cancel("ratePercent"),false);
 await s.controllers.ratePercent.rebaseAndRetry();assert.equal(calls[1].expectedRevision,7);assert.equal(calls[1].expectedValue,"10.00");assert.equal(s.controllers.assigneeId.getSnapshot().draft,"mine");await s.controllers.assigneeId.retry();assert.equal(calls[2].expectedRevision,8);
});
test("local cancel is no request; receive cannot erase dirty peer or mutate SSR snapshot",async()=>{
 let calls=0;const s=setup(async input=>{calls++;return saved(input)});const initial=s.controllers.ratePercent.getServerSnapshot();
 s.controllers.ratePercent.setDraft("8");assert.equal(await s.cancel("ratePercent"),true);assert.equal(calls,0);
 s.controllers.assigneeId.setDraft("local");s.receive({ratePercent:"3.00",assigneeId:"server"},2);assert.equal(s.controllers.assigneeId.getSnapshot().draft,"local");assert.equal(s.controllers.assigneeId.getSnapshot().baseline,null);assert.equal(s.controllers.ratePercent.getSnapshot().baseline,"3.00");assert.strictEqual(s.controllers.ratePercent.getServerSnapshot(),initial);
});

test("remounting a hidden percentage tab reuses drafts by provider identity without sharing across products",async()=>{
 const {getSinglePercentageControllers}=await import("../src/lib/single-percentage-controller");
 const owner={},otherOwner={};const options={productId:"product",kind:"INSTALLATION" as const,initial:{ratePercent:null,assigneeId:null},revision:0,save:async(input:ProductPercentagePatch)=>saved(input)};
 const first=getSinglePercentageControllers(owner,options);first.controllers.ratePercent.setDraft("7");
 const remounted=getSinglePercentageControllers(owner,{...options,initial:{...options.initial,ratePercent:"9.00"},revision:3});
 assert.strictEqual(first,remounted);assert.equal(remounted.controllers.ratePercent.getSnapshot().draft,"7");
 assert.notStrictEqual(getSinglePercentageControllers(otherOwner,options),first);
 assert.notStrictEqual(getSinglePercentageControllers(owner,{...options,productId:"other"}),first);
});

test("decimal rate no-op respects server decimal spelling without requests on focus/blur",async()=>{
 let calls=0;const options={productId:"product",kind:"INSTALLATION" as const,initial:{ratePercent:"5",assigneeId:null},revision:0,save:async(input:ProductPercentagePatch)=>{calls++;return saved(input)}};
 const s=createSinglePercentageControllers(options);await s.controllers.ratePercent.commit();s.controllers.ratePercent.setDraft("5.00");await s.controllers.ratePercent.commit();assert.equal(calls,0);
});

test("flush has only ordinary rate and employee fields without classification",async()=>{
 const calls:ProductPercentagePatch[]=[];const s=setup(async input=>{calls.push(input);return saved(input)});
 assert.deepEqual(Object.keys(s.controllers).sort(),["assigneeId","ratePercent"]);
 s.controllers.ratePercent.setDraft("5");s.controllers.assigneeId.setDraft("mounter");
 assert.equal(await s.flush(),true);assert.equal(calls.length,2);
});
