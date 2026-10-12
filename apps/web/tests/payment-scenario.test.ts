import assert from "node:assert/strict";
import {test} from "node:test";
import {guardedModuleCache} from "./helpers/guarded-module-cache";
import type {PaymentScenarioDependencies} from "../src/server/payments/core";

test("direct payment scenario returns minimal committed context without framework effects; replay avoids preparation",async()=>{
 type Row=Record<string,unknown>;const payments:Row[]=[],audits:Row[]=[],events:Row[]=[];
 const db={cashAccount:{findUnique:async()=>({id:"own-cash",active:true,currency:"BYN"})},
  payment:{create:async({data}:{data:Row})=>{const row={id:"own-payment",deletionId:null,...data};payments.push(row);return row},findUnique:async()=>payments[0]??null},
  changeLog:{create:async({data}:{data:Row})=>{audits.push(data);return data},findUnique:async({where}:{where:{id:string}})=>audits.find(a=>a.id===where.id)??null},
  domainEvent:{create:async({data}:{data:Row})=>{const row={id:"own-event",...data};events.push(row);return row}},$queryRaw:async()=>[{locked:1}]};
 const scope=guardedModuleCache(import.meta.url,{targets:["../src/server/payments/core"],allowedOverrides:[],overrides:{},prisma:db});
 try{
  const {createPaymentScenario}=scope.load<typeof import("../src/server/payments/core")>("../src/server/payments/core");let prepared=0;
  const dependencies:PaymentScenarioDependencies={reader:db as never,transaction:async operation=>operation(db as never),prepare:async()=>{prepared++;assert.equal(prepared,1,"REPLAY_MUST_SKIP_FX_PREPARATION");return{project:null,account:{id:"own-cash",name:"QA",currency:"BYN",active:true},articleId:null,amount:100,bynAmount:100,rate:1,rateDate:null,paidAt:new Date("2026-10-12T12:00:00Z")}}};
  const actor={id:"own-actor",name:"QA",roles:["ACCOUNTANT"as const],source:"web"as const},input={clientMutationId:"00000154-0000-4000-8000-000000000001",direction:"INCOME"as const,currency:"BYN",cashAccountId:"own-cash",amount:100,comment:"own"};
  const first=await createPaymentScenario(actor,input,dependencies);assert.equal(first.ack.ok,true);assert.deepEqual(first.effects,{paymentId:"own-payment",eventId:"own-event",actorId:actor.id,project:null,direction:"INCOME",amount:100,currency:"BYN",comment:"own"});
  const replay=await createPaymentScenario(actor,input,dependencies);assert.deepEqual(replay,{ack:{...first.ack,replayed:true}});assert.equal(prepared,1);assert.equal(payments.length,1);assert.equal(audits.length,2);assert.equal(events.length,1);
 }finally{scope.restore()}
});
