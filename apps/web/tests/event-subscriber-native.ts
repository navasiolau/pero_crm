// Один scoped native caller136. Import не открывает БД и не загружает registry/worker.
// SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP при guard mismatch.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {createRequire,Module} from "node:module";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {Prisma,PrismaClient} from "@prisma/client";
import {createPostgresSubscriberStore} from "../src/server/plugins/event-subscriber-store";
import {createPostgresEventQueueStore} from "../src/server/plugins/event-queue-store";
import {DEFAULT_EVENT_QUEUE_SETTINGS,EventDeliveryError,getEventQueueSettings} from "../src/server/plugins/event-queue-contract";
import {nativeAcceptanceBinding,nativeDatabaseIdentity,type NativeDeclaration} from "./helpers/native-acceptance-target";
import {nativeSnapshot,assertNoForeignReferences,type OwnedRowKeys} from "./helpers/native-acceptance-snapshot";
import {nativeJournal} from "./helpers/native-acceptance-journal";

const require=createRequire(import.meta.url);
const pins={
 "apps/web/prisma/schema.prisma":"8f23c0aee35a0e80555203be7f5f4bf4f1e2a8aeb4879871df1b4bb318f86844",
 "apps/web/prisma/migrations/20261012190000_domain_event_subscriber_delivery/migration.sql":"4d0cc5df129665ecc5aa1824fb885c023cc9373ef6bcfa36c78d67de140b762b",
 "apps/web/src/server/plugins/events.ts":"112e4495f5250dc99ec15b295b82de35e06f13732c22421808b05c61c94335af",
 "apps/web/src/server/plugins/event-subscriber-store.ts":"027ed88e219d6adcb0ada3d2d17f61b353f8e2817881db12011aef650b492fc7",
};
const settings={...DEFAULT_EVENT_QUEUE_SETTINGS,leaseMs:3000,heartbeatMs:500,deliveryTimeoutMs:2000,backoffBaseMs:100,backoffMaxMs:400};
const names=["completed","concurrent","empty","parent","child","fence","rollback","idempotent","effect"] as const;
function gate(){let resolve=()=>{},reject=(error:unknown)=>{void error;};const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
const lost=(error:unknown)=>error instanceof EventDeliveryError&&error.code==="EVENT_CLAIM_LOST";

export function subscriberNativePlan(input:NativeDeclaration){
 assert.ok(input.target==="local"||input.target==="staging","TEST_TARGET_ONLY");
 assert.match(input.revision,/^[a-f0-9]{40}$/,"NATIVE_REVISION_REQUIRED");
 assert.match(input.runId,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,"NATIVE_RUN_ID_REQUIRED");
 assert.equal(input.scenarioId,"subscriber-delivery136","EXACT_SCENARIO_REQUIRED");
 const actor="qa136:"+input.runId,ids=Object.fromEntries(names.map(name=>[name,actor+":"+name])) as Record<typeof names[number],string>;
 const fixtures=names.map(name=>({id:ids[name],type:"qa136."+name,actor,createdAt:new Date("2026-10-12T00:00:00.000Z"),
  payload:name==="child"?{qa136Run:input.runId,parent:ids.parent}:name==="effect"?{qa136Run:input.runId,parent:ids.idempotent}:{qa136Run:input.runId,kind:name},
  processedAt:name==="completed"||name==="effect"?new Date("2026-10-12T00:00:00.000Z"):null}));
 return{actor,ids,fixtures,allIds:Object.values(ids),subscribers:["literal-a","literal-b","literal-c"]};
}

export async function runSubscriberNative(input:NativeDeclaration){
 for(const name of ["NODE_OPTIONS","NODE_PATH","TSX_TSCONFIG_PATH","TSX_DISABLE_CACHE","ESBUILD_BINARY_PATH"])assert.ok(!process.env[name],"UNEXPECTED_NODE_LOADER");
 const plan=subscriberNativePlan(input),binding=nativeAcceptanceBinding(input);
 assert.equal(getEventQueueSettings().enabled,false,"GLOBAL_WORKER_MUST_REMAIN_DISABLED");
 assert.equal((globalThis as {peroDomainEventWorker?:unknown}).peroDomainEventWorker,undefined,"GLOBAL_WORKER_MUST_NOT_START");
 const repo=fileURLToPath(new URL("../../../",import.meta.url));
 for(const [file,digest] of Object.entries(pins))assert.equal(createHash("sha256").update(await readFile(path.join(repo,file))).digest("hex"),digest,"REVIEWED_SOURCE_CHANGED");
 const url=new URL(binding.url);url.searchParams.set("connection_limit","1");
 const db=new PrismaClient({datasourceUrl:url.toString(),log:[],errorFormat:"minimal"});
 const peer=new PrismaClient({datasourceUrl:url.toString(),log:[],errorFormat:"minimal"});
 const own:OwnedRowKeys={DomainEvent:{column:"id",ids:plan.allIds},DomainEventDeliveryPlan:{column:"eventId",ids:plan.allIds},DomainEventDelivery:{column:"eventId",ids:plan.allIds}};
 const publish=await nativeJournal(input),q=createPostgresEventQueueStore(db,settings,plan.allIds),qp=createPostgresEventQueueStore(peer,settings,plan.allIds);
 const store=createPostgresSubscriberStore(db,settings,plan.allIds),sp=createPostgresSubscriberStore(peer,settings,plan.allIds);
 let phase="identity",prepared=false,original:Awaited<ReturnType<typeof nativeSnapshot>>|undefined,failure:unknown,cleanupFailure:unknown;
 let failureDiagnostic:Record<string,unknown>|undefined,cleanupDiagnostic:Record<string,unknown>|undefined;
 const diagnostic=(error:unknown,originalFailurePhase:string)=>({originalFailurePhase,
  errorName:error instanceof Prisma.PrismaClientKnownRequestError?"PrismaClientKnownRequestError":error instanceof assert.AssertionError?"AssertionError":error instanceof EventDeliveryError?"EventDeliveryError":"Error",
  prismaCode:error instanceof Prisma.PrismaClientKnownRequestError&&/^P[0-9]{4}$/.test(error.code)?error.code:null});
 const pending=new Set<Promise<unknown>>();
 const track=<T>(promise:Promise<T>)=>{pending.add(promise);void promise.finally(()=>pending.delete(promise)).catch(()=>{});return promise;};
 const cases:string[]=[],originals=new Map<string,NodeModule|undefined>();let events:typeof import("../src/server/plugins/events")|undefined;
 const claim=async(queue:typeof q,id:string)=>{const result=await queue.claim({eventId:id});assert.equal(result?.kind,"claimed","OWNED_CLAIM_REQUIRED");if(result?.kind!=="claimed")throw Error("OWNED_CLAIM_REQUIRED");return result.event;};
 const current=async(tx:Prisma.TransactionClient|PrismaClient)=>({
  events:await tx.domainEvent.findMany({where:{id:{in:plan.allIds}},orderBy:{id:"asc"}}),
  plans:await tx.domainEventDeliveryPlan.findMany({where:{eventId:{in:plan.allIds}},orderBy:{eventId:"asc"}}),
  receipts:await tx.domainEventDelivery.findMany({where:{eventId:{in:plan.allIds}},orderBy:[{eventId:"asc"},{position:"asc"}]})});
 const waitLock=async(tx:Prisma.TransactionClient,pid:number)=>{
  const deadline=performance.now()+2500;
  for(;;){const rows=await tx.$queryRaw<{waiting:boolean}[]>(Prisma.sql`SELECT wait_event_type='Lock' AS waiting FROM pg_stat_activity WHERE pid=${pid}`);
   if(rows[0]?.waiting)return true;assert.ok(performance.now()<deadline,"REAL_LOCK_WAIT_REQUIRED");await new Promise(resolve=>setTimeout(resolve,10));}
 };
 const frozen=(rows:Awaited<ReturnType<typeof current>>)=>{
  for(const row of rows.events){const expected=plan.fixtures.find(item=>item.id===row.id);assert.ok(expected,"EXACT_OWNED_EVENT_REQUIRED");
   assert.deepEqual({id:row.id,type:row.type,actor:row.actor,payload:row.payload,createdAt:row.createdAt},
    {id:expected.id,type:expected.type,actor:expected.actor,payload:expected.payload,createdAt:expected.createdAt},"OWNED_STATIC_FIELDS_CHANGED");}
  assert.ok(rows.plans.every(row=>plan.allIds.includes(row.eventId)),"EXACT_OWNED_PLAN_REQUIRED");
  assert.ok(rows.receipts.every(row=>plan.allIds.includes(row.eventId)&&plan.subscribers.includes(row.subscriberId)),"EXACT_OWNED_RECEIPT_REQUIRED");
 };
 try{
  await nativeDatabaseIdentity(db,input);await nativeDatabaseIdentity(peer,input);
  const [{pid:firstPid}]=await db.$queryRaw<{pid:number}[]>`SELECT pg_backend_pid() AS pid`;
  const [{pid:secondPid}]=await peer.$queryRaw<{pid:number}[]>`SELECT pg_backend_pid() AS pid`;
  assert.notEqual(firstPid,secondPid,"TWO_NATIVE_SESSIONS_REQUIRED");
  original=await db.$transaction(async tx=>{await tx.$executeRaw`SET TRANSACTION READ ONLY`;return nativeSnapshot(tx);},{isolationLevel:"RepeatableRead",timeout:120000});
  assert.ok(original.snapshot.rows.DomainEventDeliveryPlan&&original.snapshot.rows.DomainEventDelivery,"ADDITIVE_MIGRATION_REQUIRED");
  assert.deepEqual(await current(db),{events:[],plans:[],receipts:[]},"OWNED_ID_COLLISION");
  await publish("pre",{input,identity:binding.identity,pins,plan,original,backendPids:[firstPid,secondPid],globalWorker:false,outboundProviders:0});
  phase="prepare";prepared=true;
  await db.domainEvent.createMany({data:plan.fixtures.filter(row=>row.id!==plan.ids.child&&row.id!==plan.ids.effect)});
  assert.deepEqual(await nativeSnapshot(db,own),original,"PREPARE_ORIGINALS_CHANGED");

  phase="concurrent-freeze";
  const concurrent=await claim(q,plan.ids.concurrent),locked=gate(),proceed=gate();let holding:Prisma.TransactionClient|undefined;
  const controlled={async $transaction<T>(work:(tx:Prisma.TransactionClient)=>Promise<T>,options?:{maxWait?:number;timeout?:number;isolationLevel?:Prisma.TransactionIsolationLevel}){
   return db.$transaction(async tx=>{holding=tx;let intercepted=false;const proxy=new Proxy(tx,{get(target,key){
    if(key==="$queryRaw")return async(sql:Prisma.Sql)=>{const result=await target.$queryRaw(sql);if(!intercepted&&sql.strings.join("").includes("FOR UPDATE")){intercepted=true;locked.resolve();await proceed.promise;}return result;};return Reflect.get(target,key);}});
    return work(proxy);},options);
  }};
  const first=track(createPostgresSubscriberStore(controlled as Pick<PrismaClient,"$transaction">,settings,plan.allIds).initialize(concurrent,["literal-a","literal-b"]));
  void first.catch(error=>locked.reject(error));let second:ReturnType<typeof store.initialize>|undefined;
  try{await locked.promise;second=track(sp.initialize(concurrent,["literal-b","literal-c"]));assert.ok(holding);await waitLock(holding,secondPid);}
  finally{proceed.resolve();await Promise.allSettled([first,...(second?[second]:[])]);}
  assert.ok(second);const [firstRows,secondRows]=await Promise.all([first,second]);
  assert.deepEqual(firstRows,secondRows);assert.deepEqual(firstRows.map(row=>row.subscriberId),["literal-a","literal-b"]);
  await assert.rejects(peer.domainEventDelivery.create({data:{eventId:concurrent.id,subscriberId:"literal-a",position:2}}),error=>error instanceof Prisma.PrismaClientKnownRequestError&&error.code==="P2002");
  await assert.rejects(peer.domainEventDelivery.create({data:{eventId:concurrent.id,subscriberId:"literal-c",position:0}}),error=>error instanceof Prisma.PrismaClientKnownRequestError&&error.code==="P2002");
  cases.push("concurrent-freeze-real-lock","composite-and-position-unique");
  const empty=await claim(q,plan.ids.empty);assert.deepEqual(await store.initialize(empty,[]),[]);assert.deepEqual(await sp.initialize(empty,["literal-c"]),[]);
  assert.ok(await db.domainEventDeliveryPlan.findUnique({where:{eventId:empty.id}}));cases.push("durable-empty-plan");

  phase="literal-dispatcher";
  const inject=(specifier:string,exports:Record<string,unknown>)=>{const file=require.resolve(specifier);originals.set(file,require.cache[file]);const stub=new Module(file);stub.filename=file;stub.loaded=true;stub.exports=exports;require.cache[file]=stub;};
  let enabled=["literal-a","literal-b"],failB=true,failEffect=true,effectCalls=0;const calls:string[]=[];
  inject("../src/lib/prisma",{prisma:{plugin:{findMany:async()=>enabled.map(id=>({id}))},domainEvent:{create:async({data}:{data:{type:string;payload:unknown;actor:string}})=>{
   assert.equal(data.type,"qa136.child","EXACT_NESTED_EVENT_REQUIRED");assert.equal(data.actor,"plugin:literal-a");assert.deepEqual(data.payload,plan.fixtures.find(row=>row.id===plan.ids.child)!.payload);
   return db.domainEvent.create({data:plan.fixtures.find(row=>row.id===plan.ids.child)!});}}}});
  inject("../src/server/plugins/event-queue-store",{createPostgresEventQueueStore:()=>q});
  inject("../src/server/plugins/event-subscriber-store",{createPostgresSubscriberStore:()=>store});
  inject("../src/server/plugins/event-queue-contract",{...require("../src/server/plugins/event-queue-contract"),getEventQueueSettings:()=>settings});
  inject("../src/server/plugins/context",{buildPluginContext:async(id:string,emit:(type:string,payload:unknown,actor:string)=>Promise<void>)=>({emit:(type:string,payload:unknown)=>emit(type,payload,"plugin:"+id)})});
  inject("../src/server/plugins/registry",{getManifest:(id:string)=>({hooks:{onDomainEvent:(event:{id:string;type:string},ctx:{emit:(type:string,payload:unknown)=>Promise<void>})=>track((async()=>{
   assert.ok(plan.allIds.includes(event.id),"FOREIGN_HOOK_FORBIDDEN");
   if(event.type==="qa136.parent"){calls.push(id);if(id==="literal-a")await ctx.emit("qa136.child",{qa136Run:input.runId,parent:event.id});if(id==="literal-b"&&failB)throw Error("QA136_LITERAL_FAILURE");}
   if(event.type==="qa136.idempotent"&&id==="literal-a"){effectCalls++;await db.domainEvent.createMany({data:[plan.fixtures.find(row=>row.id===plan.ids.effect)!],skipDuplicates:true});if(failEffect)throw Error("QA136_EFFECT_BEFORE_ACK");}
  })())}})});
  inject("../src/server/plugins/run-log",{logPluginRun:async()=>{}});
  inject("../src/server/products/sketch-cleanup-core",{executeObsoleteSketchCleanup:async()=>{throw Error("FOREIGN_INTERNAL_CLEANUP_FORBIDDEN");}});
  const eventFile=require.resolve("../src/server/plugins/events");originals.set(eventFile,require.cache[eventFile]);delete require.cache[eventFile];events=require(eventFile);
  assert.ok(events);await events.dispatchEvent(plan.ids.completed);assert.equal(await db.domainEventDeliveryPlan.count({where:{eventId:plan.ids.completed}}),0);
  await events.dispatchEvent(plan.ids.parent);
  const ackA=await db.domainEventDelivery.findUniqueOrThrow({where:{eventId_subscriberId:{eventId:plan.ids.parent,subscriberId:"literal-a"}}});assert.ok(ackA.deliveredAt);
  failB=false;enabled.push("literal-c");await new Promise(resolve=>setTimeout(resolve,settings.backoffBaseMs+30));await events.dispatchEvent(plan.ids.parent);
  assert.deepEqual(calls,["literal-a","literal-b","literal-b"]);assert.deepEqual(await db.domainEventDelivery.findUniqueOrThrow({where:{eventId_subscriberId:{eventId:plan.ids.parent,subscriberId:"literal-a"}}}),ackA);
  assert.ok((await db.domainEvent.findUniqueOrThrow({where:{id:plan.ids.parent}})).processedAt);assert.equal(await db.domainEvent.count({where:{id:plan.ids.child}}),1);
  enabled=["literal-a"];await events.dispatchEvent(plan.ids.idempotent);failEffect=false;await new Promise(resolve=>setTimeout(resolve,settings.backoffBaseMs+30));await events.dispatchEvent(plan.ids.idempotent);
  assert.equal(effectCalls,2);assert.equal(await db.domainEvent.count({where:{id:plan.ids.effect}}),1);assert.ok((await db.domainEvent.findUniqueOrThrow({where:{id:plan.ids.idempotent}})).processedAt);
  cases.push("actual-dispatcher-partial-ack-nested-emit","late-subscriber-not-added","completed-not-reopened","consumer-idempotency-effect-before-ack");

  phase="fencing-expiry";
  const old=await claim(q,plan.ids.fence);await store.initialize(old,["literal-a"]);assert.equal(await store.begin(old,"literal-a"),"started");
  await db.$executeRaw(Prisma.sql`UPDATE "DomainEvent" SET "leaseUntil"=clock_timestamp()-interval '1 millisecond' WHERE id=${old.id} AND actor=${plan.actor}`);
  const replacement=await claim(qp,old.id);assert.notEqual(replacement.claimToken,old.claimToken);assert.equal(await sp.begin(replacement,"literal-a"),"started");
  const beforeFence=await db.domainEventDelivery.findMany({where:{eventId:old.id}});await assert.rejects(store.complete(old,"literal-a"),lost);
  assert.deepEqual(await db.domainEventDelivery.findMany({where:{eventId:old.id}}),beforeFence);cases.push("old-token-rejected");
  await db.$executeRaw(Prisma.sql`UPDATE "DomainEvent" SET "leaseUntil"=clock_timestamp()+interval '500 milliseconds' WHERE id=${old.id} AND actor=${plan.actor}`);
  let waiting:Promise<void>|undefined;
  await db.$transaction(async tx=>{await tx.$queryRaw(Prisma.sql`SELECT id FROM "DomainEvent" WHERE id=${old.id} AND actor=${plan.actor} FOR UPDATE`);
   waiting=track(assert.rejects(sp.complete(replacement,"literal-a"),lost));await waitLock(tx,secondPid);await tx.$queryRaw`SELECT 1 AS slept FROM pg_sleep(0.55)`;});
  assert.ok(waiting);await waiting;assert.deepEqual(await db.domainEventDelivery.findMany({where:{eventId:old.id}}),beforeFence);cases.push("post-lock-expiry-rejected");

  phase="final-expiry-rollback";
  const rollback=await claim(q,plan.ids.rollback);
  await db.$executeRaw(Prisma.sql`UPDATE "DomainEvent" SET "leaseUntil"=clock_timestamp()+interval '500 milliseconds' WHERE id=${rollback.id} AND actor=${plan.actor}`);
  let actualInsert=false;
  const delayed={async $transaction<T>(work:(tx:Prisma.TransactionClient)=>Promise<T>,options?:{maxWait?:number;timeout?:number;isolationLevel?:Prisma.TransactionIsolationLevel}){
   return db.$transaction(async tx=>{const proxy=new Proxy(tx,{get(target,key){if(key==="domainEventDeliveryPlan")return new Proxy(target.domainEventDeliveryPlan,{get(delegate,method){
    if(method==="create")return async(args:Prisma.DomainEventDeliveryPlanCreateArgs)=>{assert.equal(args.data.eventId,rollback.id);const result=await delegate.create(args);actualInsert=true;await tx.$queryRaw`SELECT 1 AS slept FROM pg_sleep(0.55)`;return result;};return Reflect.get(delegate,method);}});return Reflect.get(target,key);}});return work(proxy);},options);
  }};
  await assert.rejects(createPostgresSubscriberStore(delayed as Pick<PrismaClient,"$transaction">,settings,plan.allIds).initialize(rollback,["literal-a"]),lost);
  assert.equal(actualInsert,true);assert.equal(await db.domainEventDeliveryPlan.count({where:{eventId:rollback.id}}),0);assert.equal(await db.domainEventDelivery.count({where:{eventId:rollback.id}}),0);
  cases.push("actual-plan-insert-final-expiry-rollback");await publish("verified",{input,cases,backendPids:[firstPid,secondPid],originalsMatch:true});
 }catch(error){failure=error;failureDiagnostic=diagnostic(error,phase);}
 finally{
  await Promise.allSettled([...pending]);
  for(const [file,previous] of originals){if(previous)require.cache[file]=previous;else delete require.cache[file];}
  if(prepared&&original)try{
   phase="quiesce-owned";
   await db.$executeRaw(Prisma.sql`UPDATE "DomainEvent" SET "claimToken"=NULL,"leaseUntil"=NULL WHERE id IN (${Prisma.join(plan.allIds)}) AND actor=${plan.actor}`);
   const observation=await current(db);frozen(observation);assert.deepEqual(await nativeSnapshot(db,own),original,"PRE_CLEANUP_ORIGINALS_CHANGED");
   await publish("cleanup-intent",{input,owned:observation,originalDigest:original.digest});
   await db.$transaction(async tx=>{
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "DomainEvent" WHERE id IN (${Prisma.join(plan.allIds)}) AND actor=${plan.actor} ORDER BY id FOR UPDATE`);
    const locked=await current(tx);frozen(locked);assert.deepEqual(locked,observation,"CLEANUP_CURRENT_ROWS_REQUIRED");
    assert.deepEqual(await nativeSnapshot(tx,own),original,"CLEANUP_ORIGINALS_CHANGED");await assertNoForeignReferences(tx,own);
    const deleted=await tx.domainEvent.deleteMany({where:{id:{in:plan.allIds},actor:plan.actor}});assert.equal(deleted.count,locked.events.length,"EXACT_DELETE_COUNT_REQUIRED");
    assert.deepEqual(await current(tx),{events:[],plans:[],receipts:[]},"OWNED_CASCADE_REMAINS");assert.deepEqual(await nativeSnapshot(tx),original,"CLEANUP_TRANSACTION_PRESERVATION_REQUIRED");
   },{isolationLevel:"RepeatableRead",timeout:120000});
   assert.deepEqual(await current(db),{events:[],plans:[],receipts:[]},"OWNED_POSTCOMMIT_REMAINS");assert.deepEqual(await nativeSnapshot(db),original,"TERMINAL_ORIGINALS_CHANGED");
   await publish("cleanup-ack",{input,remainingOwned:0,originalDigest:original.digest,rowsAndCatalogMatch:true,globalWorker:false,outboundProviders:0});
  }catch(error){cleanupFailure=error;cleanupDiagnostic=diagnostic(error,phase);}
  const disconnected=await Promise.allSettled([db.$disconnect(),peer.$disconnect()]);if(disconnected.some(result=>result.status==="rejected"))cleanupFailure=Error("NATIVE_DISCONNECT_HOLD");
 }
 if(failure||cleanupFailure){const error=cleanupFailure??failure;const message=error instanceof Error?error.message:"";
  const code=/^[A-Z0-9_]+$/.test(message)?message:"QA136_HOLD_INSPECT";await publish("hold",{input,phase,code,cases,failureDiagnostic,cleanupDiagnostic,cleanupComplete:prepared&&!cleanupFailure,repeatForbidden:true});return{status:"HOLD",runId:input.runId,phase,code,failureDiagnostic,cleanupDiagnostic,repeatForbidden:true};}
 await publish("closed",{input,cases,remainingOwned:0,rowsAndCatalogMatch:true,originalDigest:original!.digest,globalWorker:false,outboundProviders:0});
 return{status:"QA136_SCOPED_CLOSED",runId:input.runId,revision:input.revision,cases,remainingOwned:0,rowsAndCatalogMatch:true,originalDigest:original!.digest,globalWorker:false,outboundProviders:0};
}

const direct=path.resolve(process.argv[1]??"").toLowerCase()===fileURLToPath(import.meta.url).toLowerCase();
if(direct){const [mode,target,revision,runId]=process.argv.slice(2);const input={target,revision,runId,scenarioId:"subscriber-delivery136"} as NativeDeclaration;
 if(mode==="inert"){subscriberNativePlan(input);assert.throws(()=>subscriberNativePlan({...input,target:"production" as NativeDeclaration["target"]}));console.log(JSON.stringify({status:"QA136_INERT",dbConnections:0,worker:false,providers:0}));}
 else if(mode==="run")void runSubscriberNative(input).then(result=>{console.log(JSON.stringify(result));if(result.status==="HOLD")process.exitCode=1;}).catch(()=>{console.log(JSON.stringify({status:"HOLD",code:"QA136_PREPARE_GUARD",repeatForbidden:true}));process.exitCode=1;});
 else{console.log(JSON.stringify({status:"HOLD",code:"QA136_MODE_REQUIRED"}));process.exitCode=1;}
}
