import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {newQueueStagePlan,validateQueueStagePlan,runScopedStageWorker,createQueueStageAdapter,WORKER_QA_PREFIX,queueStageDigest} from './event-queue-stage.mjs';
const runId='6a888888-1111-4111-8111-888888888888',revision='a'.repeat(40);
test('54 exact nonce events, no foreign or duplicate IDs and no production provider',()=>{
 const plan=newQueueStagePlan(runId,revision);validateQueueStagePlan(plan);
 assert.equal(plan.ids.length,54);assert.equal(new Set(plan.ids).size,54);
 assert.equal(plan.globalWorkerEnabled,false);assert.equal(plan.provider,'literal-owned-fixture');
 for(const mutate of [p=>p.ids.push('foreign-event'),p=>p.ids[0]=p.ids[1],p=>p.globalWorkerEnabled=true,p=>p.provider='telegram',p=>p.actor='foreign']){
  const changed=structuredClone(plan);mutate(changed);assert.throws(()=>validateQueueStagePlan(changed));
 }
});
test('unqualified target or source guard refuses before catalog/database/write hooks',async()=>{
 let calls=0;const plan=newQueueStagePlan(runId,revision);
 const adapter=createQueueStageAdapter({guard:async()=>{throw Error('STAGE_GUARD');},db:{get $transaction(){calls++;throw Error('SQL');}},peer:null});
 await assert.rejects(adapter.prepare({target:'staging',revision,runId},plan),/STAGE_GUARD/);assert.equal(calls,0);
});
test('controlled actual production worker cycle is scoped and restores private cache',async()=>{
 const plan=newQueueStagePlan(runId,revision);let dispatches=0,calls=0;
 const cache=Object.create(null),workerId='crm-stage:apps/web/src/server/plugins/event-worker.ts',eventsId='crm-stage:apps/web/src/server/plugins/events.ts',contractId='crm-stage:apps/web/src/server/plugins/event-queue-contract.ts',selfId='crm-stage:apps/web/tests/event-queue-stage.mjs';
 const previousContract={filename:contractId,exports:{DEFAULT_EVENT_QUEUE_SETTINGS:{enabled:false}},loaded:true};cache[contractId]=previousContract;
 const previousTimer=globalThis.setInterval,previousRuntime=process.env.NEXT_RUNTIME;
 const source=readFileSync(new URL('../src/server/plugins/event-worker.ts',import.meta.url),'utf8');
 const body=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const inside=specifier=>cache[specifier==='./events'?eventsId:specifier==='./event-queue-contract'?contractId:selfId].exports;
 function req(spec){assert.equal(spec,'../src/server/plugins/event-worker');calls++;const record={filename:workerId,exports:{},loaded:false};cache[workerId]=record;
  new Function('require','module','exports',WORKER_QA_PREFIX+body)(inside,record,record.exports);record.loaded=true;return record.exports;
 }
 req.cache=cache;req.resolve=spec=>{const id={'../src/server/plugins/event-worker':workerId,'../src/server/plugins/events':eventsId,'../src/server/plugins/event-queue-contract':contractId,'./event-queue-stage.mjs':selfId}[spec];assert.ok(id,'PRIVATE_LOADER_LITERAL_PATH');return id;};
 const result=await runScopedStageWorker(req,{dispatchPending:async n=>{assert.equal(n,50);dispatches++;return dispatches===1?50:1;}},{intervalMs:15000,batchSize:50},plan);
 assert.deepEqual(result,[50,1]);assert.equal(dispatches,2);assert.equal(calls,1);
 assert.equal(globalThis.setInterval,previousTimer);assert.equal(process.env.NEXT_RUNTIME,previousRuntime);assert.equal(globalThis.peroDomainEventWorker,undefined);
 assert.equal(cache[contractId],previousContract);assert.equal(cache[eventsId],undefined);assert.equal(cache[workerId],undefined);assert.equal(cache[selfId],undefined);
});
test('unowned existing worker registry is rejected and untouched',async()=>{
 const own={foreign:true},plan=newQueueStagePlan(runId,revision);globalThis.peroDomainEventWorker=own;
 try{await assert.rejects(runScopedStageWorker(()=>assert.fail('load forbidden'),{}, {},plan),/WORKER_REGISTRY_OCCUPIED/);assert.equal(globalThis.peroDomainEventWorker,own);}
 finally{delete globalThis.peroDomainEventWorker;}
});

test('cleanup rejects active owned lease and foreign FK before any DELETE',async()=>{
 for(const active of [1,0]){
  const plan=newQueueStagePlan(runId,revision),context={target:'staging',runId,revision},rows=plan.fixtures.map(row=>({...row,createdAt:new Date(row.createdAt)}));let deletes=0;
  const tx={$queryRawUnsafe:async query=>query.includes('SELECT *')?rows:[{active}],$executeRawUnsafe:async()=>{deletes++;return rows.length;}};
  const adapter=createQueueStageAdapter({guard:async()=>{},db:{$transaction:async fn=>fn(tx)},peer:null,publish:async()=>{},captureOriginal:async()=>({hash:'same'}),compareOriginal:()=>{},assertNoForeignReferences:async()=>{throw Error('FOREIGN_FK');}});
  await assert.rejects(adapter.cleanup(context,{kind:'pre',plan,original:{hash:'same'}},{kind:'observation',context,current:{activeClaims:0,ownedHash:queueStageDigest(rows),ids:rows.map(r=>r.id)}}),active?/ACTIVE_LEASE_REJECT/:/FOREIGN_FK/);
  assert.equal(deletes,0);
 }
});

test('owned mutable fingerprint includes exact Date values, not empty objects',()=>{
 const a={leaseUntil:new Date('2026-10-11T00:00:00Z')},b={leaseUntil:new Date('2026-10-11T00:00:01Z')};
 assert.notEqual(queueStageDigest(a),queueStageDigest(b));assert.equal(queueStageDigest(a),queueStageDigest(structuredClone(a)));
});
