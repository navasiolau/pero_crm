import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {stageGuard,captureSnapshot,verifyBefore,verifyAfter,safeDiagnostic,diagnosticStop} from './product-draft-staging-readonly.mjs';
import {APPROVED_MIGRATIONS,verifiedMigrationChecksums,validateOptions,decodeReadonlySnapshot} from './product-draft-staging-runner.mjs';

const h=value=>createHash('sha256').update(value).digest('hex');
const revision='a'.repeat(40),afterRevision='b'.repeat(40),runId='80502171-fcf9-4189-a3f8-c8a77e94efad';
const input={operation:'inspect',mode:'before',authorized:true,revision,runId,expectedMigrations:APPROVED_MIGRATIONS};
const afterInput={...input,mode:'after',revision:afterRevision,beforeRevision:revision};
const fp=(value,count='1')=>({count,hash:h(value)});
const tableNames=['ApiToken','ChangeLog','OrgSetting','Payment','Product','ProductStatusHistory','Project','_prisma_migrations'];
function proofFixture(){
 const stable=Object.fromEntries(['columns','constraints','indexes','triggers','routines','sequences','relations','otherEnums'].map(key=>[key,fp('schema '+key)]));
 const before={
  version:2,mode:'before',runId,revision,capturedAt:'2026-10-09T00:00:00.000Z',tableNames,
  tables:Object.fromEntries(tableNames.map(table=>[table,fp('before '+table)])),
  targets:fp('exact tuples of two early non-DRAFT products including deleted','2'),
  protectedProducts:fp('full unchanged non-target products including already-DRAFT','2'),
  preserved:{ProductStatusHistory:fp('before ProductStatusHistory','1'),ChangeLog:fp('before ChangeLog','3'),_prisma_migrations:fp('before _prisma_migrations','4')},
  tags:{historyCount:'0',auditCount:'0',pairCount:'0',invalidHistoryCount:'0',invalidAuditCount:'0',invalidPairCount:'0',earlyNonDraftCount:'2'},
  migrations:[],
  schema:{stable,productStatus:{default:'PREPARATION',labels:['DRAFT','PREPARATION','DESIGN','PRODUCTION','STORAGE','INSTALLATION','DONE','RECLAMATION'],columnHash:h('stable status column')}},
  orgSetting:{count:'2',otherRows:fp('other settings'),bot:{key:'telegram.botUsername',valueHash:h('dummy same bot'),stableFieldsHash:h('dummy stable bot'),updatedAt:'2026-10-08T23:50:00.000Z'}},
  identity:{name:'crm',schema:'public',readonly:'on',primary:true},
 };
 before.tables.Product.count='4';before.tables.ProductStatusHistory.count='1';before.tables.OrgSetting.count='2';before.tables.ChangeLog.count='3';before.tables._prisma_migrations.count='4';
 const after=structuredClone(before);after.mode='after';after.revision=afterRevision;after.capturedAt='2026-10-09T00:05:00.000Z';
 after.schema.productStatus.default='DRAFT';
 after.tables.Product=fp('after Product','4');after.tables.ProductStatusHistory=fp('after ProductStatusHistory','3');after.tables.ChangeLog=fp('after ChangeLog','5');after.tables._prisma_migrations=fp('after _prisma_migrations','6');
 after.tags={historyCount:'2',auditCount:'2',pairCount:'2',invalidHistoryCount:'0',invalidAuditCount:'0',invalidPairCount:'0',earlyNonDraftCount:'0'};
 after.migrations=APPROVED_MIGRATIONS.map((row,index)=>({id:'migration-id-'+index,...row,startedAt:'2026-10-09T00:02:00.000Z',finishedAt:'2026-10-09T00:03:00.000Z',rolledBackAt:null,appliedStepsCount:1,logsNull:true,fullHash:h('new ledger '+index)}));
 return {before,after};
}
function contrast(name,change){test(name,()=>{const {before,after}=proofFixture();change(before,after);assert.throws(()=>verifyAfter(before,after,afterInput));});}

test('exact SQL tuple proof preserves every original row and transfers early deleted and active products',()=>{
 const {before,after}=proofFixture();assert.equal(verifyBefore(before,input).targetCount,'2');
 const result=verifyAfter(before,after,afterInput);assert.equal(result.targetsVerified,2);assert.equal(result.originalsPreserved,true);assert.equal(result.schemaVerified,true);assert.equal(result.operationalClockChanged,false);
});
test('idempotent enum addition preserves exact pre-existing DRAFT position',()=>{const {before,after}=proofFixture();assert.doesNotThrow(()=>verifyAfter(before,after,afterInput));});
test('new DRAFT enum is inserted immediately before PREPARATION',()=>{const {before,after}=proofFixture();before.schema.productStatus.labels=before.schema.productStatus.labels.filter(value=>value!=='DRAFT');assert.doesNotThrow(()=>verifyAfter(before,after,afterInput));});
contrast('missing target tuple is rejected',(before,after)=>{after.targets.count='1';after.tags.pairCount='1';});
contrast('extra target tuple is rejected',(before,after)=>{after.targets.count='3';after.tags.pairCount='3';});
contrast('original product ID missing or replaced in tuple hash is rejected',(before,after)=>{after.targets.hash=h('different target membership');});
contrast('oldStatus mismatch reconstructed from migration pair is rejected',(before,after)=>{after.targets.hash=h('changed old status in canonical tuple');});
contrast('business numeric price quantity FK or updatedAt change is rejected',(before,after)=>{after.targets.hash=h('changed business hash in canonical tuple');});
contrast('non-target product status or statusChangedAt is fully protected',(before,after)=>{after.protectedProducts=fp('changed untouched row','2');});
contrast('unknown new or deleted product is rejected',(before,after)=>{after.tables.Product.count='5';});
contrast('remaining early non-DRAFT product is rejected',(before,after)=>{after.tags.earlyNonDraftCount='1';});
contrast('original history values are unchanged through exact complement',(before,after)=>{after.preserved.ProductStatusHistory=fp('original history changed','1');});
contrast('unknown untagged history row is rejected',(before,after)=>{after.preserved.ProductStatusHistory=fp('unknown non-tag history','2');after.tables.ProductStatusHistory.count='4';});
contrast('missing tagged history row is rejected',(before,after)=>{after.tags.historyCount='1';});
contrast('invalid history shape or timestamp is rejected',(before,after)=>{after.tags.invalidHistoryCount='1';});
contrast('invalid audit shape or timestamp is rejected',(before,after)=>{after.tags.invalidAuditCount='1';});
contrast('orphan or mismatched exact migration pair is rejected',(before,after)=>{after.tags.invalidPairCount='1';});
contrast('extra tagged audit outside original targets is rejected',(before,after)=>{after.tags.auditCount='3';});
contrast('old audit rows cannot change',(before,after)=>{after.preserved.ChangeLog=fp('original audit changed','3');});
contrast('unknown new untagged audit remains protected',(before,after)=>{after.preserved.ChangeLog=fp('unknown audit','4');after.tables.ChangeLog.count='6';});
contrast('unapproved finance row change is rejected',(before,after)=>{after.tables.Payment=fp('finance changed');});
contrast('ApiToken lastUsedAt is fully protected',(before,after)=>{after.tables.ApiToken=fp('token changed');});
contrast('table set drift is rejected',(before,after)=>{after.tableNames.push('UnexpectedTable');after.tables.UnexpectedTable=fp('unexpected');});
contrast('Product status default must become DRAFT',(before,after)=>{after.schema.productStatus.default='PREPARATION';});
contrast('other Product status column metadata is protected',(before,after)=>{after.schema.productStatus.columnHash=h('column changed');});
contrast('other enum labels and all schema objects are protected',(before,after)=>{after.schema.stable.otherEnums=fp('other enum changed');});
contrast('DRAFT enum wrong position is rejected',(before,after)=>{after.schema.productStatus.labels=['PREPARATION','DRAFT',...before.schema.productStatus.labels.slice(2)];});
contrast('third migration is rejected',(before,after)=>{after.migrations.push({...after.migrations[0],id:'third-id',name:'unexpected_migration'});});
contrast('missing migration is rejected',(before,after)=>{after.migrations.pop();});
contrast('wrong exact SQL checksum is rejected',(before,after)=>{after.migrations[1].checksum='0'.repeat(64);});
contrast('unfinished or failed migration is rejected',(before,after)=>{after.migrations[1].finishedAt=null;});
contrast('original migration ledger row cannot change',(before,after)=>{after.preserved._prisma_migrations=fp('original ledger changed','4');});
test('only coherent bot clock may advance with unchanged immutable value',()=>{const {before,after}=proofFixture();after.orgSetting.bot.updatedAt='2026-10-09T00:04:00.000Z';after.tables.OrgSetting=fp('new bot clock','2');assert.equal(verifyAfter(before,after,afterInput).operationalClockChanged,true);});
contrast('bot value cannot change',(before,after)=>{after.orgSetting.bot.valueHash=h('different bot');after.tables.OrgSetting=fp('different bot table','2');});
contrast('bot stable fields cannot change',(before,after)=>{after.orgSetting.bot.stableFieldsHash=h('changed bot stable field');after.tables.OrgSetting=fp('changed bot table','2');});
contrast('other setting value or timestamp cannot change',(before,after)=>{after.orgSetting.otherRows=fp('other setting changed');after.tables.OrgSetting=fp('changed settings','2');});
contrast('bot clock cannot regress',(before,after)=>{after.orgSetting.bot.updatedAt='2026-10-08T23:49:00.000Z';after.tables.OrgSetting=fp('clock regressed','2');});
contrast('bot singleton cannot appear or disappear',before=>{before.orgSetting.bot=null;});
contrast('OrgSetting hash drift without classified bot clock change is rejected',(before,after)=>{after.tables.OrgSetting=fp('unclassified drift','2');});
contrast('same run and approved before revision required',(before,after)=>{after.runId='57a258d1-cabe-465b-9bd6-adf2b284a0a6';});
test('before requires no existing tagged technical history or audit',()=>{for(const field of ['historyCount','auditCount','pairCount','invalidHistoryCount','invalidAuditCount','invalidPairCount']){const {before}=proofFixture();before.tags[field]='1';assert.throws(()=>verifyBefore(before,input));}});
test('target tuple eligibility and protected complement counts are coherent',()=>{const {before}=proofFixture();before.protectedProducts.count='3';assert.throws(()=>verifyBefore(before,input));});
test('snapshot wire size is constant with original history cardinality',()=>{
 const small=proofFixture().before,large=structuredClone(small);large.tables.ProductStatusHistory.count='9000000';large.preserved.ProductStatusHistory.count='9000000';
 assert.doesNotThrow(()=>verifyBefore(large,input));assert.ok(JSON.stringify(large).length-JSON.stringify(small).length<30);
});
test('private proof never accepts original data maps or plaintext fields',()=>{
 for(const mutate of [value=>{value.products={dummy:{title:'dummy original title'}};},value=>{value.productHistory={dummy:'dummy original history'};},value=>{value.rawRows=[{value:'dummy original'}];},value=>{value.targets.rows=[{value:'dummy original price'}];},value=>{value.tables.Payment.values=['dummy original amount'];}]){
  const {before}=proofFixture();mutate(before);assert.throws(()=>verifyBefore(before,input));
 }
});
test('runner requires explicit reviewed revision scope and hashed prior snapshot',()=>{
 assert.throws(()=>validateOptions({mode:'before',revision,runId,outputDir:path.resolve('test-results/dummy'),authorized:false}));
 assert.throws(()=>validateOptions({mode:'after',revision,runId,outputDir:path.resolve('test-results/dummy'),authorized:true}));
 assert.throws(()=>validateOptions({mode:'before',revision:'a'.repeat(7),runId,outputDir:path.resolve('test-results/dummy'),authorized:true}));
 assert.throws(()=>validateOptions({mode:'before',revision,runId,outputDir:path.resolve('test-results/dummy'),authorized:true,databaseURL:'dummy'}));
});
test('frozen SQL checksums are verified without database execution',()=>{
 const web=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),contents=APPROVED_MIGRATIONS.map(row=>readFileSync(path.join(web,'prisma/migrations',row.name,'migration.sql')));
 assert.deepEqual(verifiedMigrationChecksums(contents),APPROVED_MIGRATIONS);assert.throws(()=>verifiedMigrationChecksums([contents[0],Buffer.concat([contents[1],Buffer.from('\n-- changed')])]));
});
test('physical guard rejects local production and forged proof',()=>{
 const proof={hostname:'crm-staging',revision,databaseVolume:'crm-staging_pgdata',outerW07Sha256:'2'.repeat(64),web:'abcdef123456'+'1'.repeat(52),database:'3'.repeat(64)};
 const env={AUTH_SECRET:'dummy-test-secret',S3_ACCESS_KEY:'dummy-test-key',S3_SECRET_KEY:'dummy-test-storage-secret',CRM_MODERNIZATION_TARGET:'staging',DATABASE_URL:'postgresql://dummy:dummy@db:5432/crm?schema=public',CRM_FILE_STORAGE:'s3',S3_BUCKET:'pero-crm-staging',S3_ENDPOINT:'http://192.168.0.33:9000',CRM_MODERNIZATION_STAGE_PROOF:JSON.stringify(proof)},container={host:'abcdef123456',docker:true};
 assert.doesNotThrow(()=>stageGuard(input,env,container));assert.throws(()=>stageGuard(input,{...env,CRM_MODERNIZATION_TARGET:'local'},container));assert.throws(()=>stageGuard(input,{...env,DATABASE_URL:'postgresql://dummy:dummy@localhost:5433/pero_crm'},container));assert.throws(()=>stageGuard(input,{...env,S3_BUCKET:'pero-crm-production'},container));assert.throws(()=>stageGuard(input,{...env,CRM_MODERNIZATION_STAGE_PROOF:JSON.stringify({...proof,revision:afterRevision})},container));assert.throws(()=>stageGuard(input,env,{...container,docker:false}));
});
test('compressed hash evidence roundtrip retains exact coherent fingerprint snapshot',()=>{
 const {before}=proofFixture(),raw=Buffer.from(JSON.stringify(before)),encoded={snapshotEncoding:'gzip-base64',snapshot:gzipSync(raw).toString('base64'),snapshotSha256:createHash('sha256').update(raw).digest('hex')};
 assert.deepEqual(decodeReadonlySnapshot(encoded),before);assert.deepEqual(decodeReadonlySnapshot({snapshot:before}),before);assert.throws(()=>decodeReadonlySnapshot({...encoded,snapshotSha256:'0'.repeat(64)}));assert.throws(()=>decodeReadonlySnapshot({...encoded,snapshotEncoding:'unknown'}));
});
test('compressed evidence expansion and wire bytes are strictly bounded',()=>{
 assert.throws(()=>decodeReadonlySnapshot({snapshotEncoding:'gzip-base64',snapshot:'!bad',snapshotSha256:'0'.repeat(64)}));assert.throws(()=>decodeReadonlySnapshot({snapshotEncoding:'gzip-base64',snapshot:'A'.repeat(256*1024+4),snapshotSha256:'0'.repeat(64)}));
 const expanded=Buffer.alloc(8*1024*1024+1,65);assert.throws(()=>decodeReadonlySnapshot({snapshotEncoding:'gzip-base64',snapshot:gzipSync(expanded).toString('base64'),snapshotSha256:createHash('sha256').update(expanded).digest('hex')}));assert.throws(()=>decodeReadonlySnapshot({snapshot:[]}));
});
test('unknown errors never expose message stack credentials or private metadata',()=>{
 const result=safeDiagnostic({name:'UntrustedPrivateName',code:'PRIVATE_CREDENTIAL',message:'PRIVATE_MESSAGE',stack:'PRIVATE_STACK',meta:{message:'PRIVATE_METADATA',databaseURL:'postgresql://private:private@invalid/private',rows:[{value:'PRIVATE_ROW'}]}},'QUERY_STATUS_DEFAULT');
 for(const marker of ['PRIVATE','postgresql','message','stack','rows'])assert.equal(JSON.stringify(result).includes(marker),false);assert.equal(result.prismaCode,undefined);assert.equal(result.sqlState,undefined);assert.equal(result.pgType,undefined);
});
test('diagnostic projection accepts only exact canned PostgreSQL type messages',()=>{
 const known=safeDiagnostic({name:'PrismaClientKnownRequestError',code:'P2010',meta:{code:'42601',message:"Failed to deserialize column of type 'character_data'."}},'QUERY_STATUS_DEFAULT');
 assert.equal(known.prismaCode,'P2010');assert.equal(known.sqlState,'42601');assert.equal(known.pgType,'character_data');
 const unknown=safeDiagnostic({name:'PrismaClientKnownRequestError',code:'P2010',meta:{code:'N/A',message:"Failed to deserialize column of type 'character_data'. PRIVATE_TRAILING_TEXT"}},'QUERY_STATUS_DEFAULT');assert.equal(unknown.sqlState,undefined);assert.equal(unknown.pgType,undefined);assert.equal(JSON.stringify(unknown).includes('PRIVATE'),false);
});
test('arbitrary diagnostic phase identifiers and nonfinite OIDs are suppressed',()=>{
 const result=safeDiagnostic({name:'Error',code:'AUTH_SECRET',meta:{code:'badsecret',table:'PRIVATE_ROW',column:'PRIVATE_FIELD',oid:Infinity}},'PRIVATE_PHASE');assert.equal(JSON.stringify(result).includes('PRIVATE'),false);assert.equal(result.sqlState,undefined);assert.equal(result.prismaCode,undefined);assert.equal(result.oid,undefined);
});
test('STOP code preserves actual Prisma code and SQLSTATE without raw error data',()=>{
 const result=diagnosticStop({name:'PrismaClientKnownRequestError',code:'P2010',meta:{code:'42883',message:'PRIVATE_QUERY_MESSAGE'}},'QUERY_ORG_BOT');
 assert.ok(result.code.includes('_QUERY_ORG_BOT_P2010_42883'));assert.ok(result.code.length<=100);assert.match(result.code,/^[A-Z0-9_]+$/);assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
});
test('unknown STOP remains generic bounded and private',()=>{const result=diagnosticStop({name:'UnknownPrivateException',message:'PRIVATE_MESSAGE',code:'PRIVATE_SECRET'},'PRIVATE_PHASE');assert.ok(result.code.startsWith('TASK111_READONLY_CAPTURE_STOP'));assert.ok(result.code.length<=100);assert.equal(JSON.stringify(result).includes('PRIVATE'),false);});

test('compact fingerprints and clock evidence share one RR READ ONLY transaction with scalar bot key',async()=>{
 const {before}=proofFixture(),trace=[];let open=false,readonly=false,outerQueries=0;
 const tx={
  async $executeRawUnsafe(sql){assert.equal(open,true);assert.equal(sql,'SET TRANSACTION READ ONLY');readonly=true;trace.push('readonly');return 0;},
  async $queryRawUnsafe(sql,...parameters){
   assert.equal(open,true);assert.equal(readonly,true);trace.push('select');
   if(sql.startsWith('SELECT current_database()'))return [before.identity];
   if(sql.startsWith('SELECT tablename name FROM pg_tables'))return tableNames.map(name=>({name}));
   if(sql.startsWith('SELECT id,migration_name'))return [];
   if(sql.startsWith('WITH valid_pairs AS')&&sql.includes('AS "historyCount"')){
    assert.equal(parameters.length,3);assert.ok(parameters.every(value=>typeof value==='string'));return [before.tags];
   }
   if(sql.startsWith('SELECT column_default value'))return [{value:"'PREPARATION'::\"ProductStatus\""}];
   if(sql.startsWith('SELECT e.enumlabel value'))return before.schema.productStatus.labels.map(value=>({value}));
   if(sql.startsWith('SELECT key,')){assert.deepEqual(parameters,['telegram.botUsername']);assert.equal(typeof parameters[0],'string');return [before.orgSetting.bot];}
   if(sql.startsWith('SELECT to_char(CURRENT_TIMESTAMP'))return [{at:before.capturedAt}];
   if(sql.startsWith('SELECT count(*)::text count,')){
    if(sql.includes('FROM "OrgSetting" t WHERE t.key<>'))return [before.orgSetting.otherRows];
    if(sql.includes('AS "canonicalBusinessHash" FROM "Product" p JOIN "Project"'))return [before.targets];
    if(sql.includes('SELECT p.* FROM "Product" p WHERE NOT EXISTS'))return [before.protectedProducts];
    const table=/FROM \(SELECT t\.\* FROM "([^"]+)" t/.exec(sql)?.[1];
    if(table&&sql.includes('WHERE NOT(t.id=ANY'))return [before.preserved[table]];
    if(table)return [before.tables[table]];
    return [fp('synthetic schema fingerprint')];
   }
   if(sql.includes("to_jsonb(c)-'column_default'")&&sql.endsWith(' c'))return [{hash:before.schema.productStatus.columnHash}];
   throw Error('UNEXPECTED_SYNTHETIC_READ_QUERY');
  },
 };
 const db={
  async $queryRawUnsafe(){outerQueries++;throw Error('OUTSIDE_TRANSACTION_READ_FORBIDDEN');},
  async $transaction(callback,options){assert.equal(options.isolationLevel,'RepeatableRead');assert.equal(open,false);trace.push('begin');open=true;try{return await callback(tx);}finally{open=false;trace.push('end');}},
 };
 const proof={hostname:'crm-staging',revision,databaseVolume:'crm-staging_pgdata',outerW07Sha256:'1'.repeat(64),web:'2'.repeat(64),database:'3'.repeat(64)};
 const captured=await captureSnapshot(db,input,proof);
 assert.equal(outerQueries,0);assert.equal(trace[0],'begin');assert.equal(trace[1],'readonly');assert.equal(trace.at(-1),'end');
 assert.deepEqual(captured.orgSetting,before.orgSetting);assert.deepEqual(captured.targets,before.targets);assert.equal(verifyBefore(captured,input).targetCount,'2');
 assert.equal(Object.hasOwn(captured,'products'),false);assert.equal(Object.hasOwn(captured,'productHistory'),false);
});