import assert from "node:assert/strict";
import { test } from "node:test";
import { type Prisma, type PrismaClient } from "@prisma/client";
import { createTaskTransaction, withTaskTransaction, type TaskTransaction } from "../src/server/tasks/transaction";
import { createMutationTransaction, withMutationTransaction } from "../src/server/transactions/coordinator";
import { confirmMutation } from "../src/server/operations/confirmation";
import { deliverPostCommit } from "../src/server/operations/post-commit";
import { createRequestId } from "../src/lib/request-id";
import { createPostgresSubscriberStore } from "../src/server/plugins/event-subscriber-store";
import { EventDeliveryError, type OwnedDomainEvent } from "../src/server/plugins/event-queue-contract";
import { createMemoryEventQueueFixture, memoryEvent } from "./helpers/event-queue-fixture";
import { memorySubscriberFixture } from "./helpers/subscriber-delivery-fixture";

// Источник: work-shares-transaction.test.ts
test("task mutation adapter acquires its transaction lock before running the mutation", async () => {
  const calls: string[] = [];
  const tx = { $queryRaw: async (sql: TemplateStringsArray) => {
    assert.match(sql.join(""), /pg_advisory_xact_lock\(18435, 55001\)/);
    calls.push("lock"); return [{ locked: 1 }];
  } };
  const database = { $transaction: async (operation: (client: Prisma.TransactionClient) => Promise<unknown>, options: { timeout: number }) => {
    assert.deepEqual(options,{maxWait:5_000,timeout:15_000,isolationLevel:"ReadCommitted"}); calls.push("begin");
    const result = await operation(tx as unknown as Prisma.TransactionClient);
    calls.push("commit"); return result;
  } };
  const transaction = createTaskTransaction(database as unknown as Pick<PrismaClient, "$transaction">);
  assert.equal(await transaction(async () => { calls.push("mutation"); return 42; }), 42);
  assert.deepEqual(calls, ["begin", "lock", "mutation", "commit"]);
});

test("neutral and task aliases share factory/singleton and retain abort after the same lock",async()=>{
 assert.equal(createTaskTransaction,createMutationTransaction);assert.equal(withTaskTransaction,withMutationTransaction);
 const calls:string[]=[],abort=Error("OWN_ABORT");let ownRows=0;
 const tx={$queryRaw:async(sql:TemplateStringsArray)=>{assert.match(sql.join(""),/pg_advisory_xact_lock\(18435, 55001\)/);calls.push("lock");return[{locked:1}]}};
 const database={$transaction:async(operation:(client:Prisma.TransactionClient)=>Promise<unknown>)=>{const before=ownRows;calls.push("begin");try{return await operation(tx as never)}catch(error){ownRows=before;calls.push("rollback");throw error}}};
 const transaction=createMutationTransaction(database as unknown as Pick<PrismaClient,"$transaction">);
 await assert.rejects(transaction(async()=>{calls.push("mutation");ownRows++;throw abort}),error=>error===abort);
 assert.equal(ownRows,0);assert.deepEqual(calls,["begin","lock","mutation","rollback"]);
});

// Источник: mutation-outcomes.test.ts
const tx = {} as Prisma.TransactionClient;

test("only transaction ACK commits a detached candidate without extra proof", async () => {
  const transaction: TaskTransaction = operation => operation(tx); let proofs = 0;
  const result = await confirmMutation(transaction, async () => ({ id: "row" }), async () => { proofs++; return null; });
  assert.deepEqual(result, { outcome: "COMMITTED", value: { id: "row" }, recovered: false }); assert.equal(proofs, 0);
});

test("completed callback plus rejected commit stays UNKNOWN on absent proof", async () => {
  let calls = 0, mutations = 0;
  const error = Error("lost commit ACK");
  const transaction: TaskTransaction = async operation => { const result = await operation(tx); if (++calls === 1) throw error; return result; };
  const result = await confirmMutation(transaction, async () => { mutations++; return { id: "candidate" }; }, async () => null);
  assert.equal(result.outcome, "UNKNOWN"); assert.equal(mutations, 1); assert.equal(calls, 2);
});

test("exact durable proof resolves lost commit ACK with the same ID", async () => {
  let calls = 0; const transaction: TaskTransaction = async operation => { const result = await operation(tx); if (++calls === 1) throw Error("lost ACK"); return result; };
  const result = await confirmMutation(transaction, async () => ({ id: "original" }), async (_tx, candidate) => candidate!);
  assert.deepEqual(result, { outcome: "COMMITTED", value: { id: "original" }, recovered: true }); assert.equal(calls, 2);
});

test("callback abort needs a successful fresh fence before reporting rollback", async () => {
  for (const fenceFails of [false, true]) {
    let calls = 0; const error = Error("business failure");
    const transaction: TaskTransaction = async operation => { calls++; if (calls === 2 && fenceFails) throw Error("lost rollback/fence ACK"); return operation(tx); };
    const result = await confirmMutation(transaction, async () => { throw error; }, async () => null);
    assert.equal(result.outcome, fenceFails ? "UNKNOWN" : "ROLLED_BACK"); assert.equal(calls, 2);
    if (result.outcome === "ROLLED_BACK") assert.equal(result.error, error);
  }
});

test("fresh proof read rejection cannot be called rollback or trigger another mutation", async () => {
  let calls = 0, mutations = 0;
  const transaction: TaskTransaction = async operation => { const value = await operation(tx); if (++calls === 1) throw Error("lost commit ACK"); return value; };
  const result = await confirmMutation(transaction, async () => { mutations++; return { id: "candidate" }; }, async () => { throw Error("read unavailable"); });
  assert.equal(result.outcome, "UNKNOWN"); assert.equal(mutations, 1);
});

test("failure before the application callback proves no business mutation started", async () => {
  let mutations = 0; const transaction: TaskTransaction = async () => { throw Error("transaction could not start"); };
  const result = await confirmMutation(transaction, async () => { mutations++; return {}; }, async () => null);
  assert.equal(result.outcome, "ROLLED_BACK"); assert.equal(mutations, 0);
});

test("each sync/async/diagnostic fault preserves subsequent effects and emits no raw error", async () => {
  const calls: string[] = [], diagnostics: unknown[] = [];
  await deliverPostCommit("task-status", "row-id", [
    { kind: "dispatch", run: () => { calls.push("dispatch"); throw Error("private PII credential URL"); } },
    { kind: "org", run: async () => { calls.push("org"); throw Error("private payload"); } },
    { kind: "cache", run: () => calls.push("cache") },
  ], entry => { diagnostics.push(entry); throw Error("diagnostic failed"); });
  assert.deepEqual(calls, ["dispatch", "org", "cache"]); assert.equal(diagnostics.length, 2);
  assert.ok(!JSON.stringify(diagnostics).includes("private")); assert.ok(!JSON.stringify(diagnostics).includes("URL"));
});

// Источник: request-id.test.ts
test("request id falls back to cryptographic random bytes when randomUUID is unavailable", () => {
  const random = { randomUUID: undefined, getRandomValues: (bytes: Uint8Array) => { bytes.set(Array.from({ length: 16 }, (_, i) => i)); return bytes; } };
  assert.match(createRequestId(random), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

// Источник: event-subscriber-store.test.ts
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
