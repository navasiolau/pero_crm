import assert from "node:assert/strict";
import { test } from "node:test";
import { guardedModuleCache } from "./helpers/guarded-module-cache";
import type { PaymentCommand } from "../src/components/use-payment-create-command";
import type { PaymentMutationResult } from "../src/server/payments/contracts";

const scope = {kind:"payment" as const,direction:"INCOME" as const,projectId:"project"};
const id = "00000134-0000-4000-8000-000000000220";
const input:PaymentCommand={kind:"payment",data:{clientMutationId:id,direction:"INCOME",projectId:"project",currency:"USD",cashAccountId:"cash",amount:100.25,rate:3.5,rateDate:"2026-10-12",paidAt:"2026-10-12",comment:"original"}};
function fixture(){
 const map=new Map<string,string>();let blocked=false;
 const storage={getItem:(key:string)=>{if(blocked)throw Error("storage unavailable");return map.get(key)??null;},setItem:(key:string,value:string)=>{if(blocked)throw Error("storage unavailable");map.set(key,value);},removeItem:(key:string)=>map.delete(key)};
 const unexpected=()=>{throw Error("UNEXPECTED_PAYMENT_RPC")};
 const overrides={"../src/server/payments/actions":{addPayment:unexpected,getPaymentActorId:unexpected},"../src/server/warehouse/stock-purchase-actions":{addPaidStockReceipt:unexpected}};
 const moduleScope=guardedModuleCache(import.meta.url,{targets:["../src/components/use-payment-create-command"],allowedOverrides:Object.keys(overrides),overrides,prisma:{}});
 const {createPaymentCommands}=moduleScope.load<typeof import("../src/components/use-payment-create-command")>("../src/components/use-payment-create-command");
 return{map,storage,moduleScope,createPaymentCommands,block:(value:boolean)=>{blocked=value}};
}

test("lost payment ACK survives attempt rollback, actor-scoped reload and matching confirmation",async()=>{
 const f=fixture();try{
  const sent:PaymentCommand[]=[];let mode="lost";
  const send=async(command:PaymentCommand):Promise<PaymentMutationResult>=>{sent.push(command);if(mode==="lost")throw Error("ACK lost");if(mode==="refuse")return{ok:false,outcome:"ROLLED_BACK",clientMutationId:command.data.clientMutationId,error:"only attempt refused"};return{ok:true,outcome:"COMMITTED",resultId:"original-payment",paymentId:"original-payment",clientMutationId:command.data.clientMutationId}};
  let controller=f.createPaymentCommands(send,f.storage,()=>id);controller.observeActor("actor");assert.equal((await controller.run("actor",scope,input))?.outcome,"UNKNOWN");
  mode="refuse";assert.equal((await controller.run("actor",scope,input))?.outcome,"UNKNOWN");assert.equal(f.map.size,1);
  controller=f.createPaymentCommands(send,f.storage,()=>"00000134-0000-4000-8000-000000000221");controller.observeActor("other");assert.equal(controller.peek("other",scope),undefined);
  controller.observeActor("actor");const restored=controller.peek("actor",scope);assert.ok(restored&&!("blocked"in restored));if(restored&&!("blocked"in restored))assert.deepEqual(restored.command,sent[0]);
  const before=sent.length;await controller.run("actor",scope,{...input,data:{...input.data,comment:"changed"}});assert.equal(sent.length,before);
  mode="confirm";assert.equal((await controller.run("actor",scope,input))?.ok,true);assert.equal(f.map.size,0);assert.deepEqual(sent[0],sent[2]);
 }finally{f.moduleScope.restore();}
});

test("coalesced clicks preserve frozen payload; stale actor ACK cannot release original intent",async()=>{
 const f=fixture();try{
  let calls=0,release!:(value:PaymentMutationResult)=>void;
  const controller=f.createPaymentCommands(async()=>{calls++;return new Promise<PaymentMutationResult>(done=>{release=done})},f.storage,()=>id);
  controller.observeActor("actor");const a=controller.run("actor",scope,input),b=controller.run("actor",scope,input);
  controller.observeActor("other");release({ok:true,outcome:"COMMITTED",resultId:"original",paymentId:"original",clientMutationId:id});assert.equal(await a,null);assert.equal(await b,null);assert.equal(calls,1);
  controller.observeActor("actor");const saved=controller.peek("actor",scope);assert.ok(saved&&!("blocked"in saved));if(saved&&!("blocked"in saved)){assert.equal(saved.uncertain,true);assert.equal(Object.isFrozen(saved.command.data),true)}assert.equal(f.map.size,1);
 }finally{f.moduleScope.restore();}
});

test("unavailable or malformed pending storage refuses send without fresh UUID mutation",async()=>{
 const f=fixture();try{
  let sends=0;const controller=f.createPaymentCommands(async()=>{sends++;throw Error("unexpected")},f.storage,()=>id);controller.observeActor("actor");f.block(true);
  assert.equal((await controller.run("actor",scope,input))?.ok,false);assert.equal(sends,0);
  f.block(false);const fresh=f.createPaymentCommands(async()=>{sends++;throw Error("unexpected")},f.storage,()=>id);fresh.observeActor("actor");
  f.map.set("pero:payment-intent:"+JSON.stringify(["actor",JSON.stringify(["payment","INCOME","project"])]),"{bad-json");assert.equal((await fresh.run("actor",scope,input))?.ok,false);assert.equal(sends,0);
  f.map.set("pero:payment-intent:"+JSON.stringify(["actor",JSON.stringify(["payment","INCOME","project"])]),JSON.stringify({version:1,actorId:"actor",scope:JSON.stringify(["payment","INCOME","project"]),command:{...input,data:{...input.data,projectId:"another-project"}}}));
  const wrongScope=f.createPaymentCommands(async()=>{sends++;throw Error("unexpected")},f.storage,()=>id);wrongScope.observeActor("actor");
  const restored=wrongScope.peek("actor",scope);assert.ok(restored&&"blocked"in restored);assert.equal((await wrongScope.run("actor",scope,input))?.ok,false);assert.equal(sends,0);
 }finally{f.moduleScope.restore();}
});

test("definite paid-stock failure permits an edited new UUID; prior UNKNOWN remains pinned",async()=>{
 const f=fixture();try{
  const stockScope={kind:"stock"as const,direction:"EXPENSE"as const};
  const command:PaymentCommand={kind:"stock",data:{clientMutationId:id,materialId:"material",quantity:"1",unitPrice:"1",currency:"BYN",cashAccountId:"cash",expenseArticleId:"article"}};
  let mode="rejected",serial=0;const sent:PaymentCommand[]=[];
  const controller=f.createPaymentCommands(async data=>{sent.push(data);return mode==="committed"?{ok:true,outcome:"COMMITTED",resultId:"stock",receiptId:"stock",repeated:false,clientMutationId:data.data.clientMutationId}
    :{ok:false,outcome:mode==="unknown"?"UNKNOWN":"ROLLED_BACK",clientMutationId:data.data.clientMutationId,error:"material unavailable"};},f.storage,()=>`00000134-0000-4000-8000-${String(230+serial++).padStart(12,"0")}`);
  controller.observeActor("actor");assert.equal((await controller.run("actor",stockScope,command))?.outcome,"ROLLED_BACK");assert.equal(f.map.size,0);
  mode="committed";const edited:PaymentCommand={kind:"stock",data:{...command.data,unitPrice:"2"}};
  assert.equal((await controller.run("actor",stockScope,edited))?.ok,true);assert.notEqual(sent[0].data.clientMutationId,sent[1].data.clientMutationId);assert.equal(f.map.size,0);
  mode="unknown";assert.equal((await controller.run("actor",stockScope,edited))?.outcome,"UNKNOWN");mode="rejected";
  assert.equal((await controller.run("actor",stockScope,edited))?.outcome,"UNKNOWN");assert.equal(f.map.size,1);assert.deepEqual(sent[2],sent[3]);
 }finally{f.moduleScope.restore();}
});

test("matching removed-ID proof resolves historical intent while mismatched ACK remains UNKNOWN",async()=>{
 const f=fixture();try{
  let mode="wrong";const controller=f.createPaymentCommands(async():Promise<PaymentMutationResult>=>mode==="wrong"?{ok:true,outcome:"COMMITTED",resultId:"old",paymentId:"old",clientMutationId:"00000134-0000-4000-8000-000000000222"}:{ok:false,outcome:"ROLLED_BACK",kind:"removed",clientMutationId:id,removedPaymentId:"old",error:"removed"},f.storage,()=>id);
  controller.observeActor("actor");assert.equal((await controller.run("actor",scope,input))?.outcome,"UNKNOWN");assert.equal(f.map.size,1);mode="removed";assert.equal((await controller.run("actor",scope,input))?.ok,false);assert.equal(f.map.size,0);
 }finally{f.moduleScope.restore();}
});

test("UNKNOWN multi-document payload freezes its full set across reload and exact retry",async()=>{
 const f=fixture();try{
  const ids=[1,2,3].map(index=>`00000195-0000-4000-8000-${String(index).padStart(12,"0")}`);
  const command:PaymentCommand={kind:"payment",data:{...input.data,direction:"EXPENSE",expenseArticleId:"article",reportDocumentIds:ids}};
  const expenseScope={...scope,direction:"EXPENSE"as const};const sent:PaymentCommand[]=[];
  const send=async(data:PaymentCommand):Promise<PaymentMutationResult>=>{sent.push(data);return{ok:false,outcome:"UNKNOWN",retrySafe:true,clientMutationId:data.data.clientMutationId,error:"ACK lost"}};
  let controller=f.createPaymentCommands(send,f.storage,()=>id);controller.observeActor("actor");await controller.run("actor",expenseScope,command);
  assert.equal(Object.isFrozen(sent[0].data.reportDocumentIds),true);
  controller=f.createPaymentCommands(send,f.storage,()=>id);controller.observeActor("actor");
  const restored=controller.peek("actor",expenseScope);assert.ok(restored&&!("blocked"in restored));
  if(restored&&!("blocked"in restored)){assert.deepEqual(restored.command,sent[0]);await controller.run("actor",expenseScope,restored.command);}
  assert.deepEqual(sent[0],sent[1]);assert.deepEqual(sent[0].data.reportDocumentIds,ids);
 }finally{f.moduleScope.restore();}
});
