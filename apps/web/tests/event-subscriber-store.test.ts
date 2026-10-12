import assert from "node:assert/strict";
import {test} from "node:test";
import {createPostgresSubscriberStore} from "../src/server/plugins/event-subscriber-store";
import {EventDeliveryError,type OwnedDomainEvent} from "../src/server/plugins/event-queue-contract";
import {createMemoryEventQueueFixture,memoryEvent} from "./helpers/event-queue-fixture";
import {memorySubscriberFixture} from "./helpers/subscriber-delivery-fixture";
import type {PrismaClient} from "@prisma/client";

// Реальный store API/транзакционная граница, controlled DB clock без PostgreSQL.
test("subscriber receipt transaction locks first and rolls back mutations if lease expires before commit",async()=>{
 let phase=0,writes=0,committed=0;const calls:string[]=[];
 const row={...memoryEvent(1),claimToken:"owned",leaseUntil:new Date(100)} as OwnedDomainEvent;
 const fake={async $transaction(work:(tx:unknown)=>Promise<unknown>){let localWrites=0;const tx={
  $queryRaw:async(sql:{strings:readonly string[]})=>{const text=sql.strings.join("?");
   if(text.includes("FOR UPDATE")){calls.push("lock");phase++;return[{id:row.id}];}
   assert.equal(phase,1,"DB clock must only be sampled after lock");calls.push("clock");return calls.length===2?[{now:new Date(1)}]:[];},
  domainEventDeliveryPlan:{findUnique:async()=>null,create:async()=>{localWrites++;writes++;return{};}},
  domainEventDelivery:{findMany:async()=>[],createMany:async()=>{localWrites++;writes++;return{};}},
 };try{const result=await work(tx);committed+=localWrites;return result;}catch(error){throw error;}}};
 const store=createPostgresSubscriberStore(fake as unknown as Pick<PrismaClient,"$transaction">,
  createMemoryEventQueueFixture().settings,[row.id]);
 await assert.rejects(store.initialize(row,[]),error=>error instanceof EventDeliveryError&&error.code==="EVENT_CLAIM_LOST");
 assert.deepEqual(calls,["lock","clock","clock"]);assert.equal(writes,1);assert.equal(committed,0);
});

test("empty subscriber snapshot is immutable, active claims are not duplicated and terminal receipt cannot be reset",async()=>{
 const q=createMemoryEventQueueFixture({rows:[memoryEvent(7)]}),claimed=await q.store.claim();
 assert.equal(claimed?.kind,"claimed");if(claimed?.kind!=="claimed")throw Error("CLAIM_REQUIRED");
 const {store,plans}=memorySubscriberFixture(q);
 assert.deepEqual(await store.initialize(claimed.event,[]),[]);
 assert.deepEqual(await store.initialize(claimed.event,["late"]),[]);assert.equal(plans.has(claimed.event.id),true);
 const q2=createMemoryEventQueueFixture({rows:[memoryEvent(8)]}),claim2=await q2.store.claim();if(claim2?.kind!=="claimed")throw Error("CLAIM_REQUIRED");
 const f2=memorySubscriberFixture(q2);await f2.store.initialize(claim2.event,["a"]);
 assert.equal(await f2.store.begin(claim2.event,"a"),"started");assert.equal(await f2.store.begin(claim2.event,"a"),"deferred");
 await f2.store.complete(claim2.event,"a");const before=structuredClone(f2.plans.get(claim2.event.id));
 await f2.store.fail(claim2.event,"a");await f2.store.skip(claim2.event,"a","SUBSCRIBER_DISABLED");
 assert.equal(await f2.store.begin(claim2.event,"a"),"terminal");assert.deepEqual(f2.plans.get(claim2.event.id),before);
});