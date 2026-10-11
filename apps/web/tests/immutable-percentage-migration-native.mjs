// Native №167: только existing local, одна внешняя rollback-only транзакция.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile, lstat, realpath, open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const outputRoot = 'D:/Projects/pero_crm_v2/.playwright-mcp/application-improvements';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const container = 'bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5';

async function regularPath(file) {
  assert.equal((await lstat(file)).isFile(), true, 'QA167_SOURCE_REGULAR');
  assert.equal(await realpath(file), resolve(file), 'QA167_SOURCE_REALPATH');
  for (let part = resolve(file); ;) {
    assert.equal((await lstat(part)).isSymbolicLink(), false, 'QA167_SOURCE_REPARSE');
    const parent = dirname(part); if (parent === part) break; part = parent;
  }
}

async function verifyPins(manifest) {
  const required=[
    'apps/web/prisma/migrations/20261006180000_product_percentage_nonempty_rates/migration.sql',
    'apps/web/prisma/migrations/20261011130000_product_percentage_missing_configs/migration.sql',
    'apps/web/tests/immutable-percentage-migration-native.mjs',
    'apps/web/tests/helpers/immutable-percentage-migration-protocol.mjs',
    'apps/web/tests/immutable-percentage-migration-backfill.test.mjs',
    'apps/web/prisma/schema.prisma',
  ].map((file)=>resolve(root,file));
  const paths=manifest.physicalPins.map((pin)=>resolve(pin.path));
  assert.equal(new Set(paths).size,paths.length,'QA167_SOURCE_DUPLICATE');
  for(const file of required)assert.ok(paths.includes(file),'QA167_REQUIRED_SOURCE_MISSING');
  for (const pin of manifest.physicalPins) {
    await regularPath(pin.path);
    assert.equal(sha(await readFile(pin.path)), pin.sha256, 'QA167_SOURCE_PIN');
  }
  for (const pin of manifest.gitPins) {
    const bytes = execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\','/')}`, '-C', root, 'cat-file', 'blob', pin.blob], { windowsHide:true });
    assert.equal(sha(bytes),pin.sha256,'QA167_GIT_SOURCE_BYTES');
    const blob = execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\','/')}`, '-C', root, 'rev-parse', `${pin.revision}:${pin.relative}`], { windowsHide:true }).toString('ascii').trim();
    assert.equal(blob,pin.blob,'QA167_GIT_SOURCE_BINDING');
  }
}

async function durable(file, value, canonical) {
  const payload = Buffer.from(`${canonical(value)}\n`);
  const handle = await open(file,'wx');
  try { await handle.writeFile(payload); await handle.sync(); } finally { await handle.close(); }
  assert.deepEqual(await readFile(file),payload,'QA167_DURABLE_READBACK');
}

class SqlSession {
  constructor(runId) {
    this.sequence = 0; this.pending = null; this.stderrBytes = 0;
    this.child = spawn('docker',['exec','-i','-e',`PGAPPNAME=qa167-${runId}`,container,
      'psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-U','pero','-d','pero_crm','-f','-'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    this.child.stderr.on('data',(chunk) => { this.stderrBytes += chunk.length; });
    this.child.stdin.on('error',() => {
      if(this.pending) {clearTimeout(this.pending.timer);this.pending.reject(new Error('QA167_SQL_STDIN_CLOSED'));this.pending=null;}
    });
    this.closed = new Promise((finish) => {
      const failed=(code)=>{if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(new Error(code));this.pending=null;}};
      this.child.once('error',() => { failed('QA167_PSQL_SPAWN'); finish({code:null}); });
      this.child.once('close',(code) => { failed('QA167_PSQL_CLOSED'); finish({code}); });
    });
    this.lines = createInterface({input:this.child.stdout});
    this.lines.on('line',(line) => {
      if (!line.trim()) return;
      const pending = this.pending;
      if (!pending) { this.child.stdin.end(); return; }
      try {
        const frame=JSON.parse(line);
        assert.equal(frame.sequence,pending.sequence,'QA167_SQL_FRAME_SEQUENCE');
        clearTimeout(pending.timer); this.pending=null; pending.resolve(frame.data);
      } catch { clearTimeout(pending.timer);this.pending=null;pending.reject(new Error('QA167_SQL_FRAME'));this.child.stdin.end(); }
    });
  }
  request(sql,expression="jsonb_build_object('ack',true)") {
    assert.equal(this.pending,null,'QA167_SQL_PENDING');
    return new Promise((accept,reject) => {
      const sequence=++this.sequence;
      const timer=setTimeout(() => { this.pending=null;reject(new Error('QA167_SQL_TIMEOUT'));this.child.stdin.end(); },20_000);
      this.pending={sequence,timer,resolve:accept,reject};
      this.child.stdin.write(`${sql}\nSELECT jsonb_build_object('sequence',${sequence},'data',${expression});\n`,(error) => {
        if (error) {clearTimeout(timer);this.pending=null;reject(new Error('QA167_SQL_WRITE'));}
      });
    });
  }
  async finish(api) {
    return await api.finishOwnedHandle({endInput:()=>this.child.stdin.end(),exited:this.closed,
      terminateOwned:()=>this.child.kill('SIGTERM')}); // Только сохранённый spawn-owned handle, без foreign PID/DB kill.
  }
}

function fixtureSql(plan, api) {
  const q=api.sqlLiteral, rows=[];
  rows.push(`INSERT INTO "Client"("id","name","phone","updatedAt") VALUES(${q(plan.clientId)},'QA167 rollback-only','',NOW());`);
  rows.push(`INSERT INTO "User"("id","email","name","passwordHash","roles","active","updatedAt") VALUES(${q(plan.userId)},${q(plan.email)},'QA167 rollback-only','QA-disabled-no-login',ARRAY['ENGINEER']::"Role"[],false,NOW());`);
  for(const cohort of plan.cohorts) {
    rows.push(`INSERT INTO "Project"("id","number","numberInt","title","clientId","updatedAt") VALUES(${q(cohort.id)},${q(cohort.number)},${cohort.numberInt},'QA167 rollback-only',${q(plan.clientId)},NOW());`);
    rows.push(`INSERT INTO "OrgSetting"("key","value","updatedAt") VALUES(${q(cohort.setting)},'{"ENGINEERING":null,"ASSEMBLY":"5.00","INSTALLATION":null}',NOW());`);
    for(const product of cohort.products) {
      rows.push(`INSERT INTO "Product"("id","projectId","number","suffixInt","title","deletedAt","updatedAt") VALUES(${q(product.id)},${q(cohort.id)},${q(product.number)},${product.mask+1},'QA167 rollback-only',${product.deleted?'NOW()':'NULL'},NOW());`);
      for(const config of product.configs) {
        rows.push(`INSERT INTO "ProductPercentageConfig"("id","productId","kind","ratePercent","revision","reviewedLegacyWorkIds","workReview","updatedAt") VALUES(${q(config.id)},${q(product.id)},${q(config.kind)}::"ProductPercentageKind",${config.rate===null?'NULL':q(config.rate)},${config.revision},${api.sqlArray(config.reviewedLegacyWorkIds)},${q(JSON.stringify(config.workReview))}::jsonb,NOW());`);
        rows.push(`INSERT INTO "ProductPercentageParticipant"("id","configId","userId","shareUnits") VALUES(${q(config.participantId)},${q(config.id)},${q(plan.userId)},1000000);`);
      }
    }
  }
  return rows.join('\n');
}

async function fingerprints(session,tables,excluded,api) {
  const result={};
  for(const table of tables) result[table]=await session.request('',api.tableFingerprintExpression(table,excluded[table]));
  return result;
}

async function capture(session,api) {
  return await session.request('',`jsonb_build_object('catalog',${api.catalogExpression()},'pairs',${api.missingPairsExpression()},'configs',${api.configRowsExpression()})`);
}

async function ownedAbsent(session,owned,plan,api) {
  for(const [table,keys] of Object.entries(owned)) {
    const count=await session.request('',`(SELECT count(*)::integer FROM ${api.sqlIdentifier(table)} WHERE ${api.sqlIdentifier(keys.key)}=ANY(${api.sqlArray(keys.values)}))`);
    assert.equal(count,0,'QA167_OWNED_ALREADY_EXISTS');
  }
  const projectNumbers=plan.cohorts.map((cohort)=>cohort.number),productNumbers=plan.cohorts.flatMap((cohort)=>cohort.products.map((product)=>product.number));
  const collisions=await session.request('',`(SELECT (SELECT count(*) FROM "Project" WHERE "number"=ANY(${api.sqlArray(projectNumbers)}))+(SELECT count(*) FROM "Product" WHERE "number"=ANY(${api.sqlArray(productNumbers)})))`);
  assert.equal(collisions,0,'QA167_NUMBER_COLLISION');
}

async function verifyTarget(session,api,readonly) {
  const identity=await session.request('',`jsonb_build_object('database',current_database(),'user',current_user,'schema',current_schema(),
    'primary',NOT pg_is_in_recovery(),'port',current_setting('port'),'readonly',current_setting('transaction_read_only'),
    'isolation',current_setting('transaction_isolation'),'pid',pg_backend_pid(),
    'otherClients',(SELECT count(*)::integer FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()))`);
  assert.deepEqual({...identity,pid:0},{database:'pero_crm',user:'pero',schema:'public',primary:true,port:'5432',readonly:readonly?'on':'off',isolation:'repeatable read',pid:0,otherClients:0},'QA167_NATIVE_TARGET');
  assert.ok(Number.isInteger(identity.pid) && identity.pid>0,'QA167_NATIVE_PID');
  return identity;
}

export async function executeReviewed(manifestPath,approvalPath) {
  const bytes=await readFile(manifestPath),manifest=JSON.parse(bytes);
  assert.equal(manifest.operation,'rollback-native167','QA167_MANIFEST_OPERATION');
  assert.equal(manifest.baselineQualification.status,'LOCAL75_ACTUAL_READONLY_QUALIFIED','QA167_BASELINE_NOT_QUALIFIED');
  await verifyPins(manifest); // Все контролирующие файлы проверяются ДО helper evaluation.
  const api=await import('./helpers/immutable-percentage-migration-protocol.mjs');
  const approval=JSON.parse(await readFile(approvalPath));api.assertApproval(approval,sha(bytes),manifest.runId);
  await verifyPins(manifest);
  const inspect=()=>api.assertContainer(JSON.parse(execFileSync('docker',['inspect',container,'--format',
    '{"id":{{json .Id}},"name":{{json .Name}},"running":{{json .State.Running}},"ports":{{json .NetworkSettings.Ports}}}'],{windowsHide:true}).toString('utf8')));
  inspect();
  assert.equal(api.digest(manifest.plan),api.digest(api.fixturePlan(manifest.runId)),'QA167_FIXTURE_PLAN');
  const old=await readFile(resolve(root,'apps/web/prisma/migrations/20261006180000_product_percentage_nonempty_rates/migration.sql'));
  assert.equal(sha(Buffer.from(old.toString('utf8').replaceAll('\r\n','\n'))),api.ORIGINAL_SQL_SHA,'QA167_IMMUTABLE_SOURCE');
  const insert=await readFile(resolve(root,'apps/web/prisma/migrations/20261011130000_product_percentage_missing_configs/migration.sql'),'utf8');
  assert.equal(sha(Buffer.from(insert)),manifest.insertSha256,'QA167_INSERT_SOURCE');
  const expanded=execFileSync('git',['-c',`safe.directory=${root.replaceAll('\\','/')}`,'-C',root,'cat-file','blob','32c0a45982c8a8a42164f7716b7ebb6d99f32584'],{windowsHide:true});
  assert.equal(sha(expanded),api.EXPANDED_SQL_SHA,'QA167_EXPANDED_REFERENCE_SOURCE');
  const output=resolve(outputRoot,`native167-${manifest.runId}`);
  assert.equal(await realpath(outputRoot),resolve(outputRoot),'QA167_OUTPUT_ROOT_REPARSE');
  await mkdir(output);await durable(resolve(output,'intent.json'),{runId:manifest.runId,manifestHash:sha(bytes),approved:true},api.canonical);
  const session=new SqlSession(manifest.runId),owned=api.fixtureOwnedKeys(manifest.plan);
  const outcome=api.nativeOutcome();
  let initial,initialFingerprint,tables,generated=[],referenceIds=[],rollbackConfirmed=false,afterProof=null,disconnected=false,postGuardsPassed=false,mutationAttempted=false,phase='guard';
  try {
    await session.request("BEGIN ISOLATION LEVEL REPEATABLE READ; SET LOCAL statement_timeout='15000ms'; SET LOCAL lock_timeout='2000ms'; SET LOCAL search_path=public;");
    const identity=await verifyTarget(session,api,false);
    await session.request('SELECT pg_advisory_xact_lock(18435,55001);');
    initial=await capture(session,api);
    assert.equal(api.digest(initial.catalog),manifest.baselineQualification.catalogSha256,'QA167_CATALOG_DRIFT');
    await ownedAbsent(session,owned,manifest.plan,api);
    tables=await session.request('',`(SELECT jsonb_agg(tablename::text ORDER BY tablename::text COLLATE "C") FROM pg_tables WHERE schemaname='public')`);
    for(const table of tables)api.sqlIdentifier(table);
    initialFingerprint=await fingerprints(session,tables,{},api);
    const expectedPairs=[...initial.pairs,...api.missingFixturePairs(manifest.plan)];
    await durable(resolve(output,'immutable-pre.json'),{manifestHash:sha(bytes),identity,initialFingerprint,initialConfigIds:initial.configs.map((row)=>row.id),expectedPairs,owned,plan:manifest.plan},api.canonical);
    api.assertApproval(approval,sha(bytes),manifest.runId);
    phase='owned-fixtures';mutationAttempted=true;
    await session.request(fixtureSql(manifest.plan,api));
    assert.deepEqual(await fingerprints(session,tables,owned,api),initialFingerprint,'QA167_SETUP_ORIGINAL_DRIFT');
    const setup=await capture(session,api),setupFingerprint=await fingerprints(session,tables,{},api);
    api.assertPairSet(setup.pairs,expectedPairs);
    await session.request('SAVEPOINT scoped_composition;');
    phase='scoped-reference';
    for(const cohort of manifest.plan.cohorts) {
      const ownConfigs=cohort.products.flatMap((product)=>product.configs.map((config)=>config.id));
      await session.request(`UPDATE "ProductPercentageConfig" SET "ratePercent"=0 WHERE "id"=ANY(${api.sqlArray(ownConfigs)}) AND "ratePercent" IS NULL;
        UPDATE "OrgSetting" SET "value"=REPLACE("value",':null',':"0.00"') WHERE "key"=${api.sqlLiteral(cohort.setting)} AND "value" LIKE '%null%';`);
      const reference=api.scopedInsertReference(cohort===manifest.plan.cohorts[0]?insert:expanded.toString('utf8'),cohort.products.map((product)=>product.id));
      await session.request(reference);
      const now=await capture(session,api);referenceIds.push(...now.configs.filter((row)=>!setup.configs.some((prior)=>prior.id===row.id)).map((row)=>row.id));
    }
    const composition=await capture(session,api);
    const cohortDto=(cohort)=>cohort.products.flatMap((product)=>composition.configs.filter((row)=>row.productId===product.id)
      .map((row)=>({mask:product.mask,kind:row.kind,rate:row.rate,revision:row.revision,
        reviewedLegacyWorkIds:row.reviewedLegacyWorkIds.map((value)=>value.replace(`-${cohort===manifest.plan.cohorts[0]?'A':'B'}-`,'-cohort-')),
        workReview:row.workReview}))).sort((a,b)=>api.canonical(a).localeCompare(api.canonical(b)));
    assert.deepEqual(cohortDto(manifest.plan.cohorts[0]),cohortDto(manifest.plan.cohorts[1]),'QA167_COMPOSITION_REFERENCE');
    const settingValues=[];
    for(const cohort of manifest.plan.cohorts)settingValues.push(await session.request('',`(SELECT "value" FROM "OrgSetting" WHERE "key"=${api.sqlLiteral(cohort.setting)})`));
    assert.deepEqual(settingValues[0],settingValues[1],'QA167_DEFAULTS_SCOPED_REFERENCE');
    await durable(resolve(output,'scoped-reference.json'),{referenceGeneratedIds:[...new Set(referenceIds)],equal:true,level:'scoped-reference-not-global-old-SQL'},api.canonical);
    await session.request('ROLLBACK TO SAVEPOINT scoped_composition;');
    assert.deepEqual(await fingerprints(session,tables,{},api),setupFingerprint,'QA167_SAVEPOINT_RESTORE');
    api.assertPairSet((await capture(session,api)).pairs,expectedPairs);
    phase='actual-insert';
    await session.request(insert); // Exact новый INSERT source, без scoped rewrite.
    const applied=await capture(session,api);
    generated=api.assertGeneratedRows(applied.configs,setup.configs.map((row)=>row.id),expectedPairs);
    assert.equal(applied.pairs.length,0,'QA167_MISSING_AFTER_INSERT');
    await durable(resolve(output,'generated-config-ids.json'),{generated,expectedPairs},api.canonical);
    const onlyCreated={ProductPercentageConfig:{key:'id',values:generated.map((row)=>row.id)}};
    assert.deepEqual(await fingerprints(session,tables,onlyCreated,api),setupFingerprint,'QA167_FULL_SETUP_FACTS_DRIFT');
    const excluded={...owned,ProductPercentageConfig:{key:'id',values:[...owned.ProductPercentageConfig.values,...generated.map((row)=>row.id)]}};
    assert.deepEqual(await fingerprints(session,tables,excluded,api),initialFingerprint,'QA167_ORIGINAL_FACTS_DRIFT');
    // Полный setup fingerprint выше защищает также timestamps; здесь проверяется нужный row-level набор.
    assert.deepEqual(applied.configs.filter((row)=>setup.configs.some((prior)=>prior.id===row.id)),setup.configs,'QA167_EXISTING_CONFIG_DRIFT');
    const appliedFingerprint=await fingerprints(session,tables,{},api);
    phase='repeat';
    await session.request(insert);
    assert.deepEqual(await fingerprints(session,tables,{},api),appliedFingerprint,'QA167_REPEAT_CHANGED_ROWS');
    assert.equal((await capture(session,api)).pairs.length,0,'QA167_REPEAT_MISSING');
  } catch(error) { outcome.fail(error,phase); }
  finally {
    try {
      await session.request('ROLLBACK; BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path=public; SET LOCAL statement_timeout=\'15000ms\';');
      await verifyTarget(session,api,true);
      if(initialFingerprint) {
        const actual=await fingerprints(session,tables,{},api);
        assert.deepEqual(actual,initialFingerprint,'QA167_AFTER_ROLLBACK_DRIFT');
        await ownedAbsent(session,owned,manifest.plan,api);
        const ids=[...new Set([...generated.map((row)=>row.id),...referenceIds])];
        const remaining=await session.request('',`(SELECT count(*)::integer FROM "ProductPercentageConfig" WHERE "id"=ANY(${api.sqlArray(ids)}))`);
        assert.equal(remaining,0,'QA167_GENERATED_REMAIN');
        const final=await capture(session,api);assert.deepEqual(final.catalog,initial.catalog,'QA167_FINAL_CATALOG');
        assert.deepEqual(final.configs,initial.configs,'QA167_FINAL_FULL_CONFIGS');
        rollbackConfirmed=true;afterProof={protectedFingerprint:actual,generatedAbsent:true,ownedAbsent:true,catalogUnchanged:true};
      }
      await session.request('ROLLBACK;');
    } catch(error) { outcome.fail(error,'rollback-verification'); }
    const closed=await session.finish(api);disconnected=closed.normalExit===true;
    if(closed.inputFailed)outcome.fail(closed.inputFailure,'finish-input');
    if(closed.terminationFailed)outcome.fail(closed.terminationFailure,'finish-termination');
    if(closed.rejected)outcome.fail(closed.exitFailure,'finish-rejected');
    if(closed.timedOut)outcome.fail(new Error('QA167_FINISH_TIMEOUT'),'disconnect');
    else if(!closed.normalExit)outcome.fail(new Error('QA167_PSQL_EXIT'),'disconnect');
    try {await verifyPins(manifest);inspect();postGuardsPassed=true;} catch(error) {outcome.fail(error,'post-guards');}
    await durable(resolve(output,'finally-proof.json'),{rollbackConfirmed,afterProof,disconnected,postGuardsPassed,
      failureOccurred:outcome.hasFailure,primaryPhase:outcome.primaryPhase,failureCount:outcome.failureCount,
      secondaryFailureOccurred:outcome.secondaryFailureOccurred,
      finish:{timedOut:closed.timedOut,exitObserved:closed.exitObserved,normalExit:closed.normalExit,
        terminationAttempted:closed.terminationAttempted,terminationSignalSent:closed.terminationSignalSent??false},rawErrorEmitted:false},api.canonical);
  }
  const passed=outcome.accepted({rollbackConfirmed,disconnected,postGuardsPassed});
  const codes=new Set(['QA167_PSQL_SPAWN','QA167_PSQL_CLOSED','QA167_PSQL_EXIT','QA167_FINISH_TIMEOUT','QA167_SQL_TIMEOUT','QA167_SQL_FRAME','QA167_SQL_WRITE','QA167_SQL_STDIN_CLOSED',
    'QA167_CATALOG_DRIFT','QA167_OWNED_ALREADY_EXISTS','QA167_NUMBER_COLLISION','QA167_SETUP_ORIGINAL_DRIFT','QA167_COMPOSITION_REFERENCE',
    'QA167_DEFAULTS_SCOPED_REFERENCE','QA167_SAVEPOINT_RESTORE','QA167_MISSING_AFTER_INSERT','QA167_FULL_SETUP_FACTS_DRIFT','QA167_ORIGINAL_FACTS_DRIFT',
    'QA167_EXISTING_CONFIG_DRIFT','QA167_REPEAT_CHANGED_ROWS','QA167_REPEAT_MISSING','QA167_AFTER_ROLLBACK_DRIFT','QA167_GENERATED_REMAIN',
    'QA167_FINAL_CATALOG','QA167_FINAL_FULL_CONFIGS','QA167_PAIR_SCOPE','QA167_PAIR_DUPLICATE','QA167_CREATED_RATE','QA167_CREATED_REVISION','QA167_CREATED_LEGACY','QA167_CREATED_WORK_REVIEW','QA167_GENERATED_UUID']);
  const matched=outcome.primaryFailure?.message?.match(/\bQA167_[A-Z0-9_]+\b/)?.[0];
  const failureCode=outcome.hasFailure?(codes.has(matched)?matched:'QA167_UNCLASSIFIED_FAILURE'):null;
  const result={status:passed?'NATIVE_LOCAL_ROLLBACK_PASS':'UNKNOWN_OR_NATIVE_FAILURE_HOLD',level:'existing-local-SQL-rollback-only',failureCode,phase,mutationAttempted,
    runId:manifest.runId,manifestHash:sha(bytes),cohorts:2,subsetsPerCohort:8,generatedCount:generated.length,secondInsertChangedRows:passed?0:null,
    originalFactsUnchanged:rollbackConfirmed,generatedAbsent:rollbackConfirmed,disconnected,postGuardsPassed,
    failureOccurred:outcome.hasFailure,failureCount:outcome.failureCount,secondaryFailureOccurred:outcome.secondaryFailureOccurred,
    outboundCalls:0,ddlExecuted:false,stage:'NOT_RUN'};
  await durable(resolve(output,'result.json'),result,api.canonical);return result;
}

const direct=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(direct) {
  if(process.argv[2]!=='--execute-reviewed-once')console.log(JSON.stringify({status:'NATIVE_SOURCE_ONLY',connectionOpened:false,sqlExecuted:false,approvalRequired:true}));
  else {
    executeReviewed(process.argv[3],process.argv[4]).then((body)=>{console.log(JSON.stringify(body));process.exitCode=body.status==='NATIVE_LOCAL_ROLLBACK_PASS'?0:2;})
      .catch(()=>{console.log('{"status":"CONTROL_OR_UNKNOWN_HOLD","rawErrorEmitted":false,"autoRetryAllowed":false}');process.exitCode=2;});
  }
}
