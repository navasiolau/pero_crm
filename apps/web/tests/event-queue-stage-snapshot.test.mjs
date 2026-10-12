import assert from 'node:assert/strict';
import {test} from 'node:test';
import {nativeSnapshot} from './helpers/native-acceptance-snapshot.ts';
import {newQueueStagePlan,createQueueStageAdapter} from './event-queue-stage.mjs';
const runId='6c777777-1111-4111-8111-777777777777',revision='c'.repeat(40),context={target:'staging',runId,revision};
function controlledDb(){
 const state={rows:[],queryCalls:0,creates:0};
 const db={domainEvent:{async create({data}){state.creates++;state.rows.push(data);}},async $transaction(fn){return fn(db);},async $queryRawUnsafe(query){
  state.queryCalls++;
  if(query.includes('FROM pg_tables'))return [{tablename:'DomainEvent'}];
  if(query.includes('SELECT * FROM "DomainEvent"'))return [...state.rows].sort((a,b)=>a.id.localeCompare(b.id));
  if(query.includes('SELECT count(*)::int active'))return [{active:0}];
  if(query.includes('SELECT count(*)::int count'))return [{count:0}];
  return [{count:'0',hash:'0'.repeat(32)}];
 }};return {db,state};
}
test('prepare and verify use the actual shared nativeSnapshot owned-scope validator at every boundary',async()=>{
 const {db,state}=controlledDb(),plan=newQueueStagePlan(runId,revision),receipts=new Map();let scopes=0;
 const adapter=createQueueStageAdapter({db,peer:null,guard:async()=>{},publish:async(name,value)=>{receipts.set(name,value);return value;},captureOriginal:async(client,owned)=>{scopes++;return nativeSnapshot(client,owned);},compareOriginal:assert.deepEqual,nativeCases:async()=>{
  state.rows.push(...plan.orderIds.map((id,index)=>({id,actor:plan.actor,type:'qa135.fixture',payload:{qa135Run:runId,index},createdAt:new Date(index)})));
  return {level:'unit-scope-contract-only'};
 }});
 const prepared=await adapter.prepare(context,plan);assert.equal(prepared.kind,'prepared');assert.equal(state.creates,3);
 const verified=await adapter.verify(context,receipts.get('pre'));assert.equal(verified.kind,'verified');assert.equal(verified.current.ids.length,54);assert.equal(scopes,4);
});
test('actual shared validator refuses array/wrong-column scope before any query, PRE or insert',async()=>{
 for(const malformed of [{DomainEvent:['foreign']},{DomainEvent:{column:'id;DELETE',ids:['foreign']}}]){
  const {db,state}=controlledDb(),plan=newQueueStagePlan(runId,revision);let published=0;
  const adapter=createQueueStageAdapter({db,guard:async()=>{},captureOriginal:client=>nativeSnapshot(client,malformed),publish:async()=>published++});
  await assert.rejects(adapter.prepare(context,plan));assert.equal(state.queryCalls,0);assert.equal(state.creates,0);assert.equal(published,0);
 }
});
