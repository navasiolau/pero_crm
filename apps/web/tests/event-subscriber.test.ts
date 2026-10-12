import assert from "node:assert/strict";
import {createRequire,Module} from "node:module";
import path from "node:path";
import {test} from "node:test";
import type {PluginContext,DomainEventPayload} from "@pero/plugin-sdk";
import {createMemoryEventQueueFixture,memoryEvent} from "./helpers/event-queue-fixture";
import {memorySubscriberFixture} from "./helpers/subscriber-delivery-fixture";
import {OBSOLETE_SKETCH_EVENT} from "../src/server/products/sketch-cleanup-contract";
const require=createRequire(import.meta.url);

test("partial subscriber success is durable across retry, snapshot changes and nested ctx.emit",async()=>{
 const originals=new Map<string,NodeModule|undefined>();
 function injectFile(file:string,exports:Record<string,unknown>){const stub=new Module(file);originals.set(file,require.cache[file]);stub.filename=file;stub.loaded=true;stub.exports=exports;require.cache[file]=stub;}
 const inject=(specifier:string,exports:Record<string,unknown>)=>injectFile(require.resolve(specifier),exports);
 let q=createMemoryEventQueueFixture(),subscribers=["a","b"],fail="b",writes=0,internal=0;
 const calls:string[]=[];
 let events:typeof import("../src/server/plugins/events");
 inject("../src/lib/prisma",{prisma:{
  domainEvent:{create:async({data}:{data:{type:string,payload:unknown,actor:string}})=>{
   const row={...memoryEvent(++writes),...data,id:`qa136-${writes}`,createdAt:new Date(q.now()),nextAttemptAt:new Date(q.now())};q.rows.push(row);return row;}},
  plugin:{findMany:async()=>subscribers.map(id=>({id}))},
 }});
 inject("../src/server/plugins/event-queue-store",{createPostgresEventQueueStore:()=>q.store});
 // Абсолютный путь вычислен из THIS checkout; RED old dispatcher ещё не импортирует будущий store.
 injectFile(path.join(path.dirname(require.resolve("../src/server/plugins/events")),"event-subscriber-store.ts"),{createPostgresSubscriberStore:()=>memorySubscriberFixture(q).store});
 inject("../src/server/plugins/registry",{getManifest:(id:string)=>({hooks:{onDomainEvent:async(event:DomainEventPayload,ctx:PluginContext)=>{
  if(event.type!=="qa136.parent")return;calls.push(id);
  if(id==="a")await ctx.emit("qa136.child",{parent:event.id});
  if(id===fail)throw Error("QA136_FAILURE");
 }}})});
 inject("../src/server/plugins/context",{buildPluginContext:async(id:string)=>({emit:(type:string,payload:unknown)=>events.emitDomainEvent(type,payload,`plugin:${id}`)})});
 inject("../src/server/plugins/run-log",{logPluginRun:async()=>{}});
 inject("../src/server/products/sketch-cleanup-core",{executeObsoleteSketchCleanup:async()=>{internal++;}});
 const eventFile=require.resolve("../src/server/plugins/events");originals.set(eventFile,require.cache[eventFile]);delete require.cache[eventFile];
 try{
  events=require(eventFile);
  for(const order of [["a","b"],["b","a"]]){
   q=createMemoryEventQueueFixture();subscribers=order;calls.length=0;writes=0;fail="b";
   await events.emitDomainEvent("qa136.parent",{});
   assert.equal(q.rows[0].processedAt,null);assert.equal(writes,2);
   await q.advance(q.settings.backoffBaseMs);fail="";subscribers=[...order,"c"];
   await events.dispatchEvent(q.rows[0].id);
   assert.equal(calls.filter(id=>id==="a").length,1,"confirmed A and its nested emit must not repeat");
   assert.equal(calls.filter(id=>id==="b").length,2);assert.equal(calls.includes("c"),false,"recipient set is frozen");
   assert.equal(writes,2);assert.ok(q.rows[0].processedAt);
  }
  q=createMemoryEventQueueFixture();subscribers=["a","b"];writes=0;fail="b";
  await events.emitDomainEvent("qa136.parent",{});await q.advance(q.settings.backoffBaseMs);subscribers=["a"];
  await events.dispatchEvent(q.rows[0].id);assert.ok(q.rows[0].processedAt);
  const skipped=memorySubscriberFixture(q).plans.get(q.rows[0].id)!.find(row=>row.subscriberId==="b")!;
  assert.ok(skipped.skippedAt);assert.equal(skipped.lastError,"SUBSCRIBER_DISABLED");
  const done={...memoryEvent(99),processedAt:new Date(1)};q.rows.push(done);
  await events.dispatchEvent(done.id);assert.equal(memorySubscriberFixture(q).plans.has(done.id),false);
  await events.emitDomainEvent(OBSOLETE_SKETCH_EVENT,{});assert.equal(internal,1);
  assert.equal(memorySubscriberFixture(q).plans.has(q.rows.at(-1)!.id),false,"cleanup bypasses plugin receipt routing");
 }finally{for(const [file,old] of originals){if(old)require.cache[file]=old;else delete require.cache[file];}}
});