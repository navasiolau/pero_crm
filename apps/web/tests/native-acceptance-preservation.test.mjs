import assert from 'node:assert/strict';
import test from 'node:test';
import {verifiedRollback,lockExactOwnedRows,assertNoForeignReferences,nativeSnapshot} from './helpers/native-acceptance-snapshot.ts';
test('unexpected native failure still verifies preservation and retains the original error',async()=>{
 const original=Error('ASSERTION_BEFORE_ROLLBACK'),seen=[];
 await assert.rejects(verifiedRollback(async()=>{seen.push('run');throw original;},async()=>{seen.push('verified');}),error=>error===original);
 assert.deepEqual(seen,['run','verified']);
 const preserve=Error('ORIGINAL_CHANGED');
 await assert.rejects(verifiedRollback(async()=>{throw original;},async()=>{throw preserve;}),error=>error instanceof AggregateError&&error.errors[0]===original&&error.errors[1]===preserve);
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

for(const failure of [null,undefined,false,0,''])test('verified rollback retains falsy rejection '+String(failure),async()=>{
 let verified=0;
 try {await verifiedRollback(async()=>{throw failure;},async()=>{verified++;});assert.fail('FALSY_FAILURE_MUST_NOT_PASS');}
 catch(error){assert.equal(error,failure);assert.equal(verified,1);}
 const preserve=Error('PRESERVATION_FAILURE');
 await assert.rejects(verifiedRollback(async()=>{throw failure;},async()=>{throw preserve;}),error=>error instanceof AggregateError&&error.errors.length===2&&error.errors[0]===failure&&error.errors[1]===preserve);
});
