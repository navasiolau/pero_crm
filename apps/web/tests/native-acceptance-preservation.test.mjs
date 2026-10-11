import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {verifiedRollback,lockExactOwnedRows,assertNoForeignReferences,nativeSnapshot} from './helpers/native-acceptance-snapshot.ts';
import {validatePercentagePrerequisites} from './helpers/native-percentage-prerequisites.ts';
import {validateWarehousePlan} from './warehouse-concurrency-native.ts';
test('unexpected native failure still verifies preservation and retains the original error',async()=>{
 const original=Error('ASSERTION_BEFORE_ROLLBACK'),seen=[];
 await assert.rejects(verifiedRollback(async()=>{seen.push('run');throw original;},async()=>{seen.push('verified');}),error=>error===original);
 assert.deepEqual(seen,['run','verified']);
 const preserve=Error('ORIGINAL_CHANGED');
 await assert.rejects(verifiedRollback(async()=>{throw original;},async()=>{throw preserve;}),error=>error instanceof AggregateError&&error.errors[0]===original&&error.errors[1]===preserve);
});
test('current immutable trigger, unique and validated constraint prerequisites refuse missing or disabled protections',()=>{
 const constraints=[
  ['ProductPercentageCompletion','ProductPercentageCompletion_version_shape','c'],['ProductPercentageCompletion','ProductPercentageCompletion_rate_range','c'],
  ['ProductPercentageAdjustment','ProductPercentageAdjustment_shape','c'],['PayrollEntry','PayrollEntry_percentage_fields','c'],['PayrollEntry','PayrollEntry_percentage_adjustment_fields','c'],
  ['ProductPercentageAdjustment','ProductPercentageAdjustment_completionShareId_fkey','f'],['PayrollEntry','PayrollEntry_percentageAdjustmentId_fkey','f'],['PayrollEntry','PayrollEntry_percentageCompletionShareId_fkey','f'],
 ].map(([table,name,type])=>({table,name,type,validated:true}));
 const indexes=['ProductPercentageAdjustment_clientMutationId_key','ProductPercentageAdjustment_completionShareId_configRevision_key','PayrollEntry_percentageAdjustmentId_key','PayrollEntry_percentageCompletionShareId_key'].map(name=>({name,unique:true,valid:true,ready:true}));
 const triggers=[
  ['ProductPercentageCompletion','ProductPercentageCompletion_frozen','protect_product_percentage_completion',27],
  ['ProductPercentageCompletionShare','ProductPercentageCompletionShare_frozen','protect_product_percentage_share',27],
  ['ProductPercentageAdjustment','ProductPercentageAdjustment_source','validate_product_percentage_adjustment',7],
  ['ProductPercentageAdjustment','ProductPercentageAdjustment_append_only','reject_product_payment_history_mutation',27],
  ['PayrollEntry','PayrollEntry_percentage_adjustment_source','validate_product_percentage_adjustment_payroll',7],
  ['PayrollEntry','PayrollEntry_product_settlement_append_only','protect_settled_product_payroll_entry',27],
 ].map(([table,name,fn,events])=>({table,name,function:fn,events,enabled:'O'}));
 const fixture={constraints,indexes,triggers};validatePercentagePrerequisites(fixture);
 const clone=()=>structuredClone(fixture);
 const disabled=clone();disabled.triggers[3].enabled='D';assert.throws(()=>validatePercentagePrerequisites(disabled),/TRIGGER_PREREQUISITE/);
 const wrongEvent=clone();wrongEvent.triggers[3].events=7;assert.throws(()=>validatePercentagePrerequisites(wrongEvent),/TRIGGER_PREREQUISITE/);
 const invalidConstraint=clone();invalidConstraint.constraints[0].validated=false;assert.throws(()=>validatePercentagePrerequisites(invalidConstraint),/CONSTRAINT_PREREQUISITE/);
 const notUnique=clone();notUnique.indexes[1].unique=false;assert.throws(()=>validatePercentagePrerequisites(notUnique),/UNIQUE_INDEX_PREREQUISITE/);
});
test('ownership row locks use exact single PK; unsupported composite ownership stops before cleanup',async()=>{
 const queries=[],owned={Product:{column:'id',ids:['qa-product']}};
 const db={$queryRawUnsafe:async(query,...parameters)=>{
  queries.push({query,parameters});
  if(query.includes("c.contype='p'"))return[{table:'Product',columns:['id']}];
  return[{key:'qa-product'}];
 }};
 await lockExactOwnedRows(db,owned);
 assert.match(queries[1].query,/FOR UPDATE$/);assert.equal(queries[1].parameters[0],'["qa-product"]');
 const composite={$queryRawUnsafe:async()=>[{table:'Product',columns:['id','projectId']}]};
 await assert.rejects(lockExactOwnedRows(composite,owned),/EXACT_SINGLE_PRIMARY_KEY_REQUIRED/);
});
test('foreign Task/Work/File/Payment references are checked before delete across all FK actions',async()=>{
 for(const table of ['Task','Work','File','Payment']) {
  let reads=0;
  const db={$queryRawUnsafe:async query=>{
   if(query.includes('FROM pg_constraint c'))return[{schema:'public',table,parent:'Product',columns:['productId'],references:['id']}];
   reads++;assert.match(query,new RegExp('public."'+table+'"'));return[{count:'1'}];
  }};
  await assert.rejects(assertNoForeignReferences(db,{Product:{column:'id',ids:['qa-product']}}),/FOREIGN_REFERENCE_HOLD_BEFORE_DELETE/);
  assert.equal(reads,1);
 }
});
test('composite incoming FK uses every matching column, exact child ownership and rejects foreign schema',async()=>{
 const calls=[],fk={schema:'public',table:'OwnedChild',parent:'Product',columns:['productId','projectId'],references:['id','projectId']};
 const db={$queryRawUnsafe:async(query,...parameters)=>{
  if(query.includes('FROM pg_constraint c'))return[fk];
  calls.push({query,parameters});return[{count:'0'}];
 }};
 await assertNoForeignReferences(db,{Product:{column:'id',ids:['qa-product']},OwnedChild:{column:'id',ids:['qa-child']}});
 assert.match(calls[0].query,/c."productId"=p."id" AND c."projectId"=p."projectId"/);
 assert.deepEqual(calls[0].parameters,['["qa-product"]','["qa-child"]']);
 fk.schema='other';
 await assert.rejects(assertNoForeignReferences(db,{Product:{column:'id',ids:['qa-product']}}),/FOREIGN_SCHEMA_REFERENCE_REVIEW_REQUIRED/);
 assert.equal(calls.length,1);
});
test('full original fingerprint excludes only exact declared keys, never tag/current warehouse run',async()=>{
 const calls=[];
 const db={$queryRawUnsafe:async(query,...parameters)=>{
  calls.push({query,parameters});
  if(query.startsWith('SELECT tablename'))return[{tablename:'Product'},{tablename:'PayrollEntry'}];
  return[{count:'1',hash:'fixture'}];
 }};
 await nativeSnapshot(db,{Product:{column:'id',ids:['qa-product']}});
 const selected=calls.find(item=>item.query.includes('FROM public."Product"'));
 assert.match(selected.query,/WHERE NOT/);assert.deepEqual(selected.parameters,['["qa-product"]']);
 assert.ok(!calls.find(item=>item.query.includes('FROM public."PayrollEntry"')).query.includes('WHERE'));
 assert.ok(calls.every(item=>!/(DELETE|UPDATE|INSERT| LIKE )/.test(item.query)));
});
test('warehouse PRE plan rejects a different scenario, changed baseline and duplicate operation UUIDs before any DB call',()=>{
 const revision='b'.repeat(40),runId='ae1cd1ab-c9c6-4809-a0a8-abac5c81025b',tag='QA_WH163_'+runId;
 const ids={actor:tag,client:tag+'-client',project:tag+'-project',product:tag+'-product',material:tag+'-material',line:tag+'-line'};
 const requests=Object.fromEntries(['income','issueA','issueB','duplicateIncome','returnA','returnB'].map((key,index)=>[key,'11111111-1111-4111-8111-11111111111'+index]));
 const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex'),snapshot={rows:{}};
 const plan={version:1,revision,target:'local',runId,scenarioId:'warehouse.concurrent',ids,requests,before:{snapshot,digest:hash(snapshot)},stateDigest:'a'.repeat(64)};
 const input={revision,target:'local',runId,scenarioId:plan.scenarioId,plan,planSha256:hash(plan),outerPreparationReceiptSha256:'c'.repeat(64)};
 validateWarehousePlan(input);
 assert.throws(()=>validateWarehousePlan({...input,scenarioId:'foreign'}),/WAREHOUSE_PLAN_CONTEXT/);
 const wrong=structuredClone(input);wrong.plan.requests.returnB=wrong.plan.requests.returnA;wrong.planSha256=hash(wrong.plan);
 assert.throws(()=>validateWarehousePlan(wrong),/EXACT_UUIDS/);
 const drift=structuredClone(input);drift.plan.before.snapshot.rows.changed={hash:'other'};drift.planSha256=hash(drift.plan);
 assert.throws(()=>validateWarehousePlan(drift),/BASELINE_FINGERPRINT/);
});

for(const failure of [null,undefined,false,0,''])test('verified rollback retains falsy rejection '+String(failure),async()=>{
 let verified=0;
 try {await verifiedRollback(async()=>{throw failure;},async()=>{verified++;});assert.fail('FALSY_FAILURE_MUST_NOT_PASS');}
 catch(error){assert.equal(error,failure);assert.equal(verified,1);}
 const preserve=Error('PRESERVATION_FAILURE');
 await assert.rejects(verifiedRollback(async()=>{throw failure;},async()=>{throw preserve;}),error=>error instanceof AggregateError&&error.errors.length===2&&error.errors[0]===failure&&error.errors[1]===preserve);
});
