// Тонкий QA producer135. Import не читает БД/env/FS и не включает приложение.
// SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP при guard mismatch.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const canonical=value=>value instanceof Date?JSON.stringify(value.toISOString()):Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
export const queueStageDigest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const digest=queueStageDigest;
export function newQueueStagePlan(runId,revision){
 assert.match(runId,UUID);assert.match(revision,/^[a-f0-9]{40}$/);
 const actor='qa135:'+runId,mutationId=randomUUID(),stamp='2026-10-11T00:00:00.000Z';
 const fixtures=[
  {id:actor+':completed',type:'qa135.fixture',payload:{qa135Run:runId,kind:'completed'},actor,createdAt:stamp,processedAt:stamp,attempts:5,lastError:'QA135_HISTORY'},
  {id:actor+':pending',type:'qa135.fixture',payload:{qa135Run:runId,kind:'pending'},actor,createdAt:stamp,processedAt:null,attempts:999,lastError:'QA135_HISTORY'},
  {id:'sketch-cleanup:'+mutationId,type:'file.sketch-obsolete',payload:{projectId:'qa135-'+runId,productId:'qa135-product-'+runId,fileId:'qa135-old-'+runId,storedName:'obsolete.png',newFileId:'qa135-new-'+runId,clientMutationId:mutationId},actor,createdAt:stamp,processedAt:null,attempts:5,lastError:'QA135_HISTORY'}
 ];
 const orderIds=Array.from({length:51},(_,index)=>actor+':order-'+index);
 return {namespace:'qa135-stage-v1',runId,revision,actor,mutationId,fixtures,orderIds,ids:[...fixtures.map(row=>row.id),...orderIds],globalWorkerEnabled:false,provider:'literal-owned-fixture'};
}
export function validateQueueStagePlan(plan){
 assert.ok(plan?.namespace==='qa135-stage-v1'&&UUID.test(plan.runId)&&/^[a-f0-9]{40}$/.test(plan.revision),'STAGE_PLAN_BINDING');
 assert.equal(plan.actor,'qa135:'+plan.runId);assert.match(plan.mutationId,UUID);
 assert.equal(plan.globalWorkerEnabled,false);assert.equal(plan.provider,'literal-owned-fixture');
 const expected=newQueueStagePlan(plan.runId,plan.revision);expected.mutationId=plan.mutationId;
 expected.fixtures[2].id='sketch-cleanup:'+plan.mutationId;expected.fixtures[2].payload.clientMutationId=plan.mutationId;
 expected.ids=[...expected.fixtures.map(row=>row.id),...expected.orderIds];
 assert.equal(canonical(plan),canonical(expected),'EXACT_54_OWNED_PLAN_REQUIRED');return plan;
}
/** Prefix только QA CJS-wrapper: тот же production worker body, отдельные lexical globals. */
export const WORKER_QA_PREFIX="const {globalThis,process,setInterval}=require('../../../tests/event-queue-stage.mjs').scopedWorkerRuntime();\n";
const moduleIds={self:'./event-queue-stage.mjs',worker:'../src/server/plugins/event-worker',events:'../src/server/plugins/events',contract:'../src/server/plugins/event-queue-contract'};
export async function runScopedStageWorker(require,processor,settings,plan){
 validateQueueStagePlan(plan);
 assert.equal(globalThis.peroDomainEventWorker,undefined,'WORKER_REGISTRY_OCCUPIED');
 assert.ok(typeof require.resolve==='function'&&require.cache&&typeof processor.dispatchPending==='function','QUALIFIED_PRIVATE_LOADER_REQUIRED');
 const ids=Object.fromEntries(Object.entries(moduleIds).map(([key,spec])=>[key,require.resolve(spec)]));
 assert.ok(Object.values(ids).every(id=>typeof id==='string'&&id.startsWith('crm-stage:')),'PRIVATE_MODULE_NAMESPACE_REQUIRED');
 assert.equal(require.cache[ids.worker],undefined,'WORKER_ALREADY_LOADED');
 const prior=Object.fromEntries(Object.entries(ids).map(([key,id])=>[key,require.cache[id]]));
 const isolated={},counts=[];let tick,unrefs=0,admitted=0;
 const runtime=Object.freeze({globalThis:isolated,process:Object.freeze({env:Object.freeze({NEXT_RUNTIME:'nodejs'})}),setInterval(callback,milliseconds){assert.equal(tick,undefined,'SINGLE_WORKER_TIMER_REQUIRED');assert.equal(milliseconds,settings.intervalMs);tick=callback;return {unref(){unrefs++;}};}});
 const contracts={...(prior.contract?.exports??{}),getEventQueueSettings:()=>({...settings,enabled:true})};
 const dispatchPendingEvents=async limit=>{assert.equal(limit,50);assert.ok(admitted<2,'EXACT_TWO_WORKER_CYCLES');admitted++;const n=await processor.dispatchPending(limit);counts.push(n);return n;};
 const record=(id,exports)=>({filename:id,exports,loaded:true});
 require.cache[ids.self]=record(ids.self,{scopedWorkerRuntime:()=>runtime});
 require.cache[ids.contract]=record(ids.contract,contracts);require.cache[ids.events]=record(ids.events,{dispatchPendingEvents});
 const deadline=performance.now()+15000;
 const drain=async worker=>{while(worker.domainEventWorkerStatus().running){assert.ok(performance.now()<deadline,'SCOPED_WORKER_DEADLINE');await new Promise(resolve=>setTimeout(resolve,5));}};
 try{
  const worker=require(moduleIds.worker);worker.startDomainEventWorker();worker.startDomainEventWorker();
  assert.equal(unrefs,1);assert.equal(admitted,1);assert.ok(typeof tick==='function','WORKER_TIMER_REQUIRED');
  tick();assert.equal(admitted,1,'WORKER_NON_OVERLAP');await drain(worker);tick();await drain(worker);
  assert.deepEqual(counts,[50,1],'WORKER_HEALTHY_PROGRESS');return counts;
 }finally{
  // Таймер — собственная callable capability, не настоящий Node timer; global env/registry не менялись.
  tick=undefined;for(const[key,id]of Object.entries(ids)){if(prior[key]===undefined)delete require.cache[id];else require.cache[id]=prior[key];}
 }
}
function ownStatic(plan,row){
 const seed=plan.fixtures.find(item=>item.id===row.id),index=plan.orderIds.indexOf(row.id);
 assert.ok(row.actor===plan.actor&&(seed||index>=0),'OWNED_EVENT_IDENTITY');
 const expected=seed??{id:row.id,type:'qa135.fixture',payload:{qa135Run:plan.runId,index},actor:plan.actor,createdAt:new Date(index).toISOString()};
 const actual={id:row.id,type:row.type,payload:row.payload,actor:row.actor,createdAt:new Date(row.createdAt).toISOString()};
 assert.equal(digest(actual),digest({id:expected.id,type:expected.type,payload:expected.payload,actor:expected.actor,createdAt:expected.createdAt}),'OWNED_EVENT_IMMUTABLE');
}
/** guard/publish/original hooks приходят из единственного163 reviewed adapter, не из JSON клиента. */
export function createQueueStageAdapter(bindings){
 const {guard,db,peer,publish,captureOriginal,compareOriginal,nativeCases,settings,require:stageRequire,assertNoForeignReferences}=bindings;
 const qualified=async(context,plan,operation)=>{
  await guard(context,operation,plan);validateQueueStagePlan(plan);
  assert.equal(context.target,'staging');assert.equal(context.revision,plan.revision);assert.equal(context.runId,plan.runId);
  return captureOriginal(db,{DomainEvent:{column:'id',ids:plan.ids}});
 };
 const rows=async(tx,plan,lock=false)=>tx.$queryRawUnsafe('SELECT * FROM "DomainEvent" WHERE id=ANY($1::text[]) ORDER BY id'+(lock?' FOR UPDATE':''),plan.ids);
 const observe=async(plan)=>{
  const own=await rows(db,plan);own.forEach(row=>ownStatic(plan,row));
  const [{count}]=await db.$queryRawUnsafe('SELECT count(*)::int count FROM "DomainEvent" WHERE actor=$1 AND NOT(id=ANY($2::text[]))',plan.actor,plan.ids);
  assert.equal(count,0,'UNDECLARED_OWNED_EVENTS');
  const [{active}]=await db.$queryRawUnsafe('SELECT count(*)::int active FROM "DomainEvent" WHERE id=ANY($1::text[]) AND "processedAt" IS NULL AND "leaseUntil">clock_timestamp()',plan.ids);
  return {ids:own.map(row=>row.id),ownedHash:digest(own),activeClaims:active};
 };
 return {
  async prepare(context,plan){
   const original=await qualified(context,plan,'prepare'),collision=await rows(db,plan);assert.equal(collision.length,0,'OWNED_ID_COLLISION');
   const pre={namespace:plan.namespace,kind:'pre',context,plan,original};await publish('pre',pre);
   await db.$transaction(async tx=>{for(const row of plan.fixtures)await tx.domainEvent.create({data:{...row,createdAt:new Date(row.createdAt),processedAt:row.processedAt?new Date(row.processedAt):null}});});
   const current=await observe(plan);assert.equal(current.ids.length,3);compareOriginal(original,await captureOriginal(db,{DomainEvent:{column:'id',ids:plan.ids}}));
   return publish('prepared',{kind:'prepared',context,preHash:digest(pre),current});
  },
  async verify(context,pre){
   const plan=validateQueueStagePlan(pre.plan),original=await qualified(context,plan,'verify');compareOriginal(pre.original,original);
   assert.equal(pre.kind,'pre');assert.equal(pre.context.revision,context.revision);assert.equal(pre.context.runId,context.runId);
   const initial=await observe(plan);assert.equal(initial.ids.length,3,'EXACT_PREPARED_THREE_REQUIRED');assert.equal(initial.activeClaims,0,'UNCLAIMED_PREPARED_FIXTURES_REQUIRED');
   const result=await nativeCases(db,peer,plan,settings,()=>{},processor=>runScopedStageWorker(stageRequire,processor,settings,plan));
   const current=await observe(plan);assert.equal(current.ids.length,54);assert.equal(current.activeClaims,0);
   compareOriginal(pre.original,await captureOriginal(db,{DomainEvent:{column:'id',ids:plan.ids}}));
   return publish('verified',{kind:'verified',context,result,current,globalActivation:'NOT_RUN; disabled',outboundProviders:0});
  },
  async inspect(context,pre){await qualified(context,pre.plan,'inspect');compareOriginal(pre.original,await captureOriginal(db,{DomainEvent:{column:'id',ids:pre.plan.ids}}));return publish('observation',{kind:'observation',context,current:await observe(pre.plan)});},
  async cleanup(context,pre,observation){
   const plan=pre.plan;await qualified(context,plan,'cleanup');assert.equal(observation.kind,'observation');assert.equal(observation.context.runId,context.runId);assert.equal(observation.current.activeClaims,0);
   await publish('cleanup-intent',{kind:'cleanup-intent',context,observationHash:digest(observation)});
   await db.$transaction(async tx=>{
    const current=await rows(tx,plan,true);current.forEach(row=>ownStatic(plan,row));assert.equal(digest(current),observation.current.ownedHash,'CURRENT_MUTABLE_ROWS_REQUIRED');
    const [{active}]=await tx.$queryRawUnsafe('SELECT count(*)::int active FROM "DomainEvent" WHERE id=ANY($1::text[]) AND "processedAt" IS NULL AND "leaseUntil">clock_timestamp()',plan.ids);assert.equal(active,0,'ACTIVE_LEASE_REJECT');
    compareOriginal(pre.original,await captureOriginal(tx,{DomainEvent:{column:'id',ids:plan.ids}}));
    await assertNoForeignReferences(tx,{DomainEvent:{column:'id',ids:current.map(row=>row.id)}});
    const count=await tx.$executeRawUnsafe('DELETE FROM "DomainEvent" WHERE id=ANY($1::text[]) AND actor=$2',plan.ids,plan.actor);assert.equal(count,current.length,'EXACT_OWNED_DELETE');
    compareOriginal(pre.original,await captureOriginal(tx,{}));
   },{isolationLevel:'RepeatableRead',timeout:120000});
   const current=await observe(plan);assert.equal(current.ids.length,0);compareOriginal(pre.original,await captureOriginal(db,{}));
   return publish('cleanup-ack',{kind:'cleanup-ack',context,current});
  }
 };
}
