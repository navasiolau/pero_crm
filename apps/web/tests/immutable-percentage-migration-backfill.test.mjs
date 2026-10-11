import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { fixturePlan, fixtureOwnedKeys, missingFixturePairs, assertPairSet, assertGeneratedRows,
  assertApproval, assertContainer, scopedInsertReference, nativeOutcome, finishOwnedHandle, ORIGINAL_SQL_SHA, EXPANDED_SQL_SHA } from './helpers/immutable-percentage-migration-protocol.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const directory = resolve(root, 'apps/web/prisma/migrations');
const oldPath = resolve(directory, '20261006180000_product_percentage_nonempty_rates/migration.sql');
const additivePath = resolve(directory, '20261011130000_product_percentage_missing_configs/migration.sql');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const normalized = (sql) => sql.replace(/^\s*--.*$/gm, '').replace(/\s+/g, ' ').trim();
const statements = (sql) => normalized(sql).split(';').map((item) => item.trim()).filter(Boolean);
const additive = () => readFileSync(additivePath, 'utf8');

test('канонический Git SQL применённой миграции сохраняет точные исходные bytes', () => {
  // Windows checkout может преобразовать LF в CRLF; semantic SQL остаётся byte-exact после только этого преобразования.
  const bytes=readFileSync(oldPath);
  const canonicalBytes=Buffer.from(bytes.toString('utf8').replaceAll('\r\n','\n'));
  assert.equal(sha(canonicalBytes), 'd0948074ff79ac17f365490440c851650550910a6909d952ca278464b3f80a62');
  const blob=execFileSync('git',['-c',`safe.directory=${root.replaceAll('\\','/')}`,'-C',root,'hash-object',
    '--path=apps/web/prisma/migrations/20261006180000_product_percentage_nonempty_rates/migration.sql',oldPath]).toString('ascii').trim();
  assert.equal(blob,'9759270d3116248cf09eae309f8c8cacdaf6b808');
});

test('композиция исходных пяти строк и нового INSERT сохраняет прежние операции', () => {
  const baseline = execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, '-C', root,
    'cat-file', 'blob', '32c0a45982c8a8a42164f7716b7ebb6d99f32584']);
  assert.equal(sha(baseline), '277540457e9b832e483e0f3de3d09ee47d313bf845388605c6fd03be0488ee96');
  const insertWithoutConflict = additive().replace(/\s+ON CONFLICT\s*\(\s*"productId"\s*,\s*"kind"\s*\)\s+DO NOTHING\s*;/i, ';');
  assert.deepEqual(statements(`${readFileSync(oldPath, 'utf8')}\n${insertWithoutConflict}`), statements(baseline.toString('utf8')));
});

test('новая миграция атомарно вставляет и не повторяет старые UPDATE', () => {
  const sql = additive();
  const operations = statements(sql);
  assert.equal(operations.length, 1);
  assert.match(operations[0], /^INSERT INTO "ProductPercentageConfig" /);
  assert.doesNotMatch(normalized(sql), /\b(?:UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP|BEGIN|COMMIT|ROLLBACK)\b/i);
});

test('добавляются все отсутствующие пары, включая частично настроенные и удалённые изделия', () => {
  const sql = normalized(additive());
  assert.match(sql, /CROSS JOIN \(VALUES \('ENGINEERING'\),\('ASSEMBLY'\),\('INSTALLATION'\)\)/);
  assert.match(sql, /WHERE NOT EXISTS \(SELECT 1 FROM "ProductPercentageConfig" c WHERE c\."productId" = p\."id" AND c\."kind" = k\."kind"::"ProductPercentageKind"\)/);
  assert.match(sql, /SELECT gen_random_uuid\(\), p\."id", k\."kind"::"ProductPercentageKind", 0, 1, '\{\}', NOW\(\), NOW\(\)/);
  assert.doesNotMatch(sql, /"deletedAt"|"status"|"projectId"|ratePercent"\s+IS NULL/);
});

test('идемпотентность защищает только productId/kind и не подавляет PK collisions', () => {
  const sql = normalized(additive());
  assert.match(sql, /ON CONFLICT \("productId","kind"\) DO NOTHING;$/);
  assert.equal((sql.match(/\bON CONFLICT\b/g) ?? []).length, 1);
  assert.doesNotMatch(sql, /DO UPDATE|ON CONFLICT DO NOTHING|ON CONFLICT \("id"\)/);
});

test('native plan покрывает все восемь подмножеств у двух cohorts с разными existing rates', () => {
  const plan=fixturePlan('be584ac7-b26e-46ee-99b3-3ff1a7dc0cd5');
  assert.equal(plan.cohorts.length,2);
  for(const cohort of plan.cohorts)assert.deepEqual(cohort.products.map((product)=>product.mask),[0,1,2,3,4,5,6,7]);
  const pairs=missingFixturePairs(plan);assert.equal(pairs.length,24);
  assert.equal(new Set(pairs.map((pair)=>`${pair.productId}:${pair.kind}`)).size,24);
  const configs=plan.cohorts.flatMap((cohort)=>cohort.products.flatMap((product)=>product.configs));
  assert.ok(configs.some((row)=>row.rate===null));assert.ok(configs.some((row)=>row.rate==='12.50'));assert.ok(configs.some((row)=>row.rate==='0.00'));
  assert.equal(fixtureOwnedKeys(plan).Product.values.length,16);
});

test('pairset нельзя незаметно сузить до fully missing или расширить на чужую пару', () => {
  const expected=[{productId:'partial',kind:'ASSEMBLY'},{productId:'deleted',kind:'INSTALLATION'}];
  assertPairSet([...expected].reverse(),expected);
  assert.throws(()=>assertPairSet(expected.slice(1),expected));
  assert.throws(()=>assertPairSet([...expected,{productId:'other',kind:'ENGINEERING'}],expected));
  assert.throws(()=>assertPairSet([expected[0],expected[0]],expected));
});

test('DB-generated IDs связываются с exact pairset без предполагаемого QA prefix', () => {
  const created={id:'689e5ea2-03f5-4b21-a3fd-bdf27d1a0cf0',productId:'real-product',kind:'ASSEMBLY',rate:'0.00',revision:1,reviewedLegacyWorkIds:[],workReview:null};
  const existing={id:'existing'};
  assert.deepEqual(assertGeneratedRows([existing,created],['existing'],[{productId:'real-product',kind:'ASSEMBLY'}]),[created]);
  for(const patch of [{productId:'other'},{kind:'INSTALLATION'},{rate:'1.00'},{revision:2},{reviewedLegacyWorkIds:['old']},{workReview:{}},{id:'qa-prefix-guessed'}]) {
    assert.throws(()=>assertGeneratedRows([existing,{...created,...patch}],['existing'],[{productId:'real-product',kind:'ASSEMBLY'}]));
  }
});

test('native root grant строго связывает operation/source/цель/окно и срок', () => {
  const now=new Date('2026-10-11T12:00:00Z');
  const approval={approved:true,containerId:'bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5',exclusiveWindow:true,
    expiresAt:'2026-10-11T12:10:00Z',manifestHash:'reviewed',observedAt:now.toISOString(),operation:'rollback-native167',runId:'own'};
  assertApproval(approval,'reviewed','own',now);
  for(const patch of [{operation:'deploy'},{manifestHash:'changed'},{containerId:'other'},{exclusiveWindow:false},{expiresAt:now.toISOString()}]) {
    assert.throws(()=>assertApproval({...approval,...patch},'reviewed','own',now));
  }
});

test('legacy/public mapping контейнера не принимается за existing local5433', () => {
  const container={id:'bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5',name:'/pero_crm_pg',running:true,
    ports:{'5432/tcp':[{HostIp:'127.0.0.1',HostPort:'5433'}]}};
  assertContainer(container);
  for(const replacement of [{HostIp:'0.0.0.0',HostPort:'5433'},{HostIp:'127.0.0.1',HostPort:'5432'}]) {
    assert.throws(()=>assertContainer({...container,ports:{'5432/tcp':[replacement]}}));
  }
});

test('scoped reference изменяет только declared fixtures и не replay old UPDATE', () => {
  const reference=scopedInsertReference(additive(),['own-product']);
  assert.match(reference,/p\."id" = ANY\(ARRAY\['own-product'\]::text\[\]\);$/);
  assert.doesNotMatch(reference,/\bUPDATE\b|\bCOMMIT\b|\bDELETE\b/);
  assert.throws(()=>scopedInsertReference(additive(),[]));
  assert.notEqual(ORIGINAL_SQL_SHA,EXPANDED_SQL_SHA); // Смысловые old5/local11 версии не являются aliases.
});

test('пять falsy отказов никогда не дают native PASS после подтверждённого rollback', () => {
  for(const failure of [null,undefined,false,0,'']) {
    const outcome=nativeOutcome();outcome.fail(failure,'actual-insert');
    assert.equal(outcome.hasFailure,true);assert.equal(outcome.primaryFailure,failure);
    assert.equal(outcome.failureCount,1);
    assert.equal(outcome.accepted({rollbackConfirmed:true,disconnected:true,postGuardsPassed:true}),false);
  }
});

test('вторичный отказ не теряет original null и фиксируется отдельным флагом', () => {
  const outcome=nativeOutcome();outcome.fail(null,'actual-insert');outcome.fail(new Error('secondary'),'post-guards');
  assert.equal(outcome.primaryFailure,null);assert.equal(outcome.primaryPhase,'actual-insert');
  assert.equal(outcome.failureCount,2);assert.equal(outcome.secondaryFailureOccurred,true);
  assert.equal(outcome.accepted({rollbackConfirmed:true,disconnected:true,postGuardsPassed:true}),false);
});

test('native acceptance требует все доказательства и отсутствие post failure', () => {
  const outcome=nativeOutcome();const complete={rollbackConfirmed:true,disconnected:true,postGuardsPassed:true};
  assert.equal(outcome.accepted(complete),true);
  for(const key of Object.keys(complete))assert.equal(outcome.accepted({...complete,[key]:false}),false);
  outcome.fail(undefined,'post-guards');assert.equal(outcome.accepted(complete),false);
});

test('normal owned psql exit подтверждается без сигнала завершения',async()=>{
  let ended=0,killed=0;
  const result=await finishOwnedHandle({endInput:()=>{ended++;},exited:Promise.resolve({code:0}),terminateOwned:()=>{killed++;}},40);
  assert.equal(ended,1);assert.equal(killed,0);assert.equal(result.normalExit,true);assert.equal(result.timedOut,false);
});

test('finish timeout ограничен и использует только собственную capability',async()=>{
  let ended=0,ownKilled=0,foreignKilled=0;
  const foreign=()=>{foreignKilled++;};void foreign;
  const result=await finishOwnedHandle({endInput:()=>{ended++;},exited:new Promise(()=>{}),terminateOwned:()=>{ownKilled++;return true;}},30);
  assert.equal(ended,1);assert.equal(ownKilled,1);assert.equal(foreignKilled,0);
  assert.equal(result.timedOut,true);assert.equal(result.normalExit,false);assert.equal(result.exitObserved,false);
  assert.equal(nativeOutcome().accepted({rollbackConfirmed:true,disconnected:result.normalExit,postGuardsPassed:true}),false);
});

test('late own exit после timeout не превращается в normal disconnect proof',async()=>{
  let close;
  const exited=new Promise((resolve)=>{close=resolve;});
  const result=await finishOwnedHandle({endInput:()=>{},exited,terminateOwned:()=>{close({code:0});return true;}},30);
  assert.equal(result.exitObserved,true);assert.equal(result.timedOut,true);assert.equal(result.normalExit,false);
});

test('falsy end-input и rejected exit сохраняют explicit failure flags',async()=>{
  const result=await finishOwnedHandle({endInput:()=>{throw null;},exited:Promise.reject(undefined),terminateOwned:()=>{}},40);
  assert.equal(result.inputFailed,true);assert.equal(result.inputFailure,null);
  assert.equal(result.rejected,true);assert.equal(result.exitFailure,undefined);assert.equal(result.normalExit,false);
});
