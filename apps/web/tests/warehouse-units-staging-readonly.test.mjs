import test from 'node:test';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureSnapshot,verifyBefore,verifyAfter,stageGuard,diagnosticStop,encodeSnapshot} from './warehouse-units-staging-readonly.mjs';
import {APPROVED_MIGRATIONS,verifiedMigrationChecksums,validateOptions,decodeReadonlySnapshot} from './warehouse-units-staging-runner.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const fp=(value,count='1')=>({count,hash:hash(value)});
const revision='a'.repeat(40),afterRevision='b'.repeat(40),runId='80502171-fcf9-4189-a3f8-c8a77e94efad';
const input={operation:'inspect',mode:'before',authorized:true,revision,runId,expectedMigrations:APPROVED_MIGRATIONS};
const afterInput={...input,mode:'after',revision:afterRevision,beforeRevision:revision};
const schemaKeys=['columns','constraints','indexes','triggers','routines','sequences','relations','enums','enumTypes','views','policies','namespace','defaultPrivileges','types'];
function column(table,name,ordinal,defaultValue=null,dataType='text'){
 const timestamp=dataType==='timestamp without time zone';
 return {table,name,ordinal,default:defaultValue,nullable:'NO',dataType,udtSchema:'pg_catalog',udtName:timestamp?'timestamp':'text',length:null,precision:null,scale:null,timePrecision:timestamp?3:null,collation:null,collationSchema:null,domainSchema:null,domainName:null,intervalType:null,intervalPrecision:null,identity:'NO',identityGeneration:null,generated:'NEVER',generationExpression:null};
}
function index(table,name,key,{primary=false,unique=false}={}){
 return {table,name,unique,primary,valid:true,ready:true,method:'btree',keys:[key],keyCount:1,attributeCount:1,expressions:null,predicate:null,opclasses:['pg_catalog.text_ops'],collations:['pg_catalog.default'],options:[0]};
}
function proofFixture(){
 const tableNames=['ApiToken','ChangeLog','Material','OrgSetting','Payment','PayrollEntry','ProjectMaterial','StockMovement','_prisma_migrations'];
 const material=fp('material-before','2'),ownerHash=hash('owner');
 const before={version:1,mode:'before',runId,revision,capturedAt:'2026-10-09T00:00:00.000Z',tableNames,
  tables:Object.fromEntries(tableNames.map(name=>[name,fp(name)])),
  materials:{canonical:material,tuples:fp('material-tuples','2'),references:null},
  catalog:{expectedNames:fp('catalog-expected','11'),actualNames:null,idMismatchCount:null,timeMismatchCount:null},
  ledger:{preserved:fp('ledger-before','3'),records:[]},
  schema:{stable:Object.fromEntries(schemaKeys.map(name=>[name,fp('schema-'+name)])),delta:{columns:[column('Material','unit',4,"'шт'::text")],constraints:[],indexes:[],triggers:[],relations:[],types:[],typeTemplates:{recordHash:hash('record-type'),arrayHash:hash('array-type')},materialColumns:{count:'14',maxOrdinal:14},materialOwnerHash:ownerHash}},
  orgSetting:{count:'2',otherRows:fp('other-settings'),bot:{key:'telegram.botUsername',valueHash:hash('bot-value'),stableFieldsHash:hash('bot-immutable'),updatedAt:'2026-10-08T23:50:00.000Z'}},
  identity:{name:'crm',schema:'public',readonly:'on',primary:true},
 };
 before.tables.Material=material;before.tables.OrgSetting=fp('settings','2');before.tables._prisma_migrations=before.ledger.preserved;
 const after=structuredClone(before);after.mode='after';after.revision=afterRevision;after.capturedAt='2026-10-09T00:05:00.000Z';
 after.tableNames=[...before.tableNames,'MaterialUnit'].sort();after.tables.Material=fp('material-new-shape','2');after.tables.MaterialUnit=fp('catalog-rows','11');after.tables._prisma_migrations=fp('ledger-after','4');
 after.materials.references={nulls:'0',orphans:'0'};after.catalog.actualNames=before.catalog.expectedNames;after.catalog.idMismatchCount='0';after.catalog.timeMismatchCount='0';
 after.ledger.records=[{id:'ledger110',...APPROVED_MIGRATIONS[0],startedAt:'2026-10-09T00:02:00.000Z',finishedAt:'2026-10-09T00:03:00.000Z',rolledBackAt:null,appliedStepsCount:1,logsNull:true}];
 after.schema.delta.columns=[column('Material','unitId',15,"'warehouse-unit-piece'::text"),column('MaterialUnit','id',1),column('MaterialUnit','name',2),column('MaterialUnit','createdAt',3,'CURRENT_TIMESTAMP','timestamp without time zone'),column('MaterialUnit','updatedAt',4,null,'timestamp without time zone')];
 after.schema.delta.materialColumns={count:'14',maxOrdinal:15};
 after.schema.delta.constraints=[
  {table:'MaterialUnit',name:'MaterialUnit_pkey',kind:'p',deferrable:false,deferred:false,validated:true,update:' ',delete:' ',match:' ',columns:['id'],referenceTable:null,referenceSchema:null,referenceColumns:[]},
  {table:'Material',name:'Material_unitId_fkey',kind:'f',deferrable:false,deferred:false,validated:true,update:'c',delete:'r',match:'s',columns:['unitId'],referenceTable:'MaterialUnit',referenceSchema:'public',referenceColumns:['id']},
 ];
 after.schema.delta.indexes=[index('MaterialUnit','MaterialUnit_pkey','id',{primary:true,unique:true}),index('MaterialUnit','MaterialUnit_name_key','name',{unique:true}),index('Material','Material_unitId_idx','unitId')];
 after.schema.delta.triggers=[['Material','RI_FKey_check_ins',5],['Material','RI_FKey_check_upd',17],['MaterialUnit','RI_FKey_restrict_del',9],['MaterialUnit','RI_FKey_cascade_upd',17]].map(([table,fn,eventType])=>({table,eventType,function:fn,functionSchema:'pg_catalog',internal:true,enabled:'O',constraint:'Material_unitId_fkey'}));
 after.schema.delta.relations=['MaterialUnit','MaterialUnit_pkey','MaterialUnit_name_key','Material_unitId_idx'].map(name=>({name,kind:name==='MaterialUnit'?'r':'i',persistence:'p',rowSecurity:false,forceRowSecurity:false,options:null,acl:null,ownerHash}));
 after.schema.delta.types=[{name:'MaterialUnit',attributesHash:hash('record-type'),ownerHash,relationSchema:'public',relationName:'MaterialUnit',elementSchema:null,elementName:null,arraySchema:'public',arrayName:'_MaterialUnit'},{name:'_MaterialUnit',attributesHash:hash('array-type'),ownerHash,relationSchema:null,relationName:null,elementSchema:'public',elementName:'MaterialUnit',arraySchema:null,arrayName:null}];
 return {before,after};
}
function contrast(name,change){test(name,()=>{const {before,after}=proofFixture();change(before,after);assert.throws(()=>verifyAfter(before,after,afterInput));});}

test('exact unit migration proves aggregated IDs, units, business fields, schema and one ledger delta',()=>{
 const {before,after}=proofFixture();assert.equal(verifyBefore(before,input).materialsVerified,'2');const result=verifyAfter(before,after,afterInput);
 assert.equal(result.originalsPreserved,true);assert.equal(result.schemaVerified,true);assert.equal(result.catalogVerified,true);assert.equal(result.operationalClockChanged,false);
});
for(const table of ['Payment','PayrollEntry','ApiToken','ChangeLog','ProjectMaterial','StockMovement'])contrast(table+' all byte fields stay protected',(b,a)=>{a.tables[table]=fp('changed '+table);});
contrast('Material canonical reconstruction detects prices/minStock/updatedAt changes',(b,a)=>{a.materials.canonical=fp('changed price','2');});
contrast('aggregate tuple detects original IDs or unit labels changing',(b,a)=>{a.materials.tuples=fp('changed tuple','2');});
contrast('deleted/added material is not accepted',(b,a)=>{a.tables.Material.count='3';});
contrast('nullable unit FK is refused',(b,a)=>{a.materials.references.nulls='1';});
contrast('orphan unit FK is refused',(b,a)=>{a.materials.references.orphans='1';});
contrast('wrong standard/custom id mapping is refused',(b,a)=>{a.catalog.idMismatchCount='1';});
contrast('catalog timestamp outside migration window is refused',(b,a)=>{a.catalog.timeMismatchCount='1';});
contrast('unused unknown catalog label is not hidden by referenced material labels',(b,a)=>{a.catalog.actualNames=fp('unexpected labels','12');});
contrast('actual catalog row count must equal expected distinct label count',(b,a)=>{a.tables.MaterialUnit.count='12';});
contrast('expected label aggregate itself remains unchanged',(b,a)=>{a.catalog.expectedNames=fp('unexpected expected','11');});
contrast('additional public table is refused',(b,a)=>{a.tableNames.push('Unexpected');a.tableNames.sort();a.tables.Unexpected=fp('unexpected');});
contrast('missing protected table is refused',(b,a)=>{a.tableNames=a.tableNames.filter(name=>name!=='ApiToken');delete a.tables.ApiToken;});
contrast('one known migration checksum is pinned',(b,a)=>{a.ledger.records[0].checksum='0'.repeat(64);});
contrast('unrelated migration ledger entry is refused',(b,a)=>{a.tables._prisma_migrations.count='5';});
contrast('old ledger byte fields are protected',(b,a)=>{a.ledger.preserved=fp('old-ledger-changed','3');});
contrast('failed or unfinished migration is refused',(b,a)=>{a.ledger.records[0].finishedAt=null;});
contrast('migration ledger must occur strictly inside before/after capture window',(b,a)=>{a.ledger.records[0].startedAt='2026-10-08T23:58:00.000Z';});
contrast('unrelated column/schema changes are refused',(b,a)=>{a.schema.stable.columns=fp('other column changed');});
contrast('Material.unit must disappear',(b,a)=>{a.schema.delta.columns.push(b.schema.delta.columns[0]);});
contrast('unitId must be required text with stable default',(b,a)=>{a.schema.delta.columns[0].nullable='YES';});
contrast('new unitId ordinal must only append',(b,a)=>{a.schema.delta.columns[0].ordinal=4;});
contrast('new catalog column type or nullable metadata cannot drift',(b,a)=>{a.schema.delta.columns[2].dataType='character varying';});
contrast('FK on-delete is Restrict rather than Cascade',(b,a)=>{a.schema.delta.constraints[1].delete='c';});
contrast('unique name index or expressions cannot drift',(b,a)=>{a.schema.delta.indexes[1].unique=false;});
contrast('unapproved internal trigger is refused',(b,a)=>{a.schema.delta.triggers[0].function='unexpected';});
contrast('new table ownership/security cannot drift',(b,a)=>{a.schema.delta.relations[0].ownerHash=hash('other owner');});
contrast('unknown extra raw field is refused',(b,a)=>{a.rawRows=[{value:'PRIVATE'}];});
contrast('material row maps or secret metadata are refused',(b,a)=>{a.materials.rows={id:'PRIVATE'};});

test('only fresh coherent same-value bot registration clock may advance',()=>{
 const {before,after}=proofFixture();after.orgSetting.bot.updatedAt='2026-10-09T00:04:00.000Z';after.tables.OrgSetting=fp('fresh-bot-clock','2');assert.equal(verifyAfter(before,after,afterInput).operationalClockChanged,true);
});
contrast('stale bot clock advancement outside capture window is not accepted',(b,a)=>{a.orgSetting.bot.updatedAt='2026-10-08T23:59:00.000Z';a.tables.OrgSetting=fp('stale clock','2');});
contrast('bot value cannot change',(b,a)=>{a.orgSetting.bot.valueHash=hash('different value');});
contrast('other settings cannot change',(b,a)=>{a.orgSetting.otherRows=fp('other setting changed');});
contrast('bot stable fields cannot change',(b,a)=>{a.orgSetting.bot.stableFieldsHash=hash('different stable fields');});
contrast('unexplained OrgSetting table hash cannot change',(b,a)=>{a.tables.OrgSetting=fp('unexplained','2');});

test('stage guard refuses local/production/forged container identity',()=>{
 const web='abcdef123456'+'1'.repeat(52),proof={hostname:'crm-staging',revision,databaseVolume:'crm-staging_pgdata',outerW07Sha256:'2'.repeat(64),web,database:'3'.repeat(64)};
 const env={CRM_MODERNIZATION_TARGET:'staging',DATABASE_URL:'postgresql://dummy:dummy@db:5432/crm?schema=public',CRM_FILE_STORAGE:'s3',S3_BUCKET:'pero-crm-staging',S3_ENDPOINT:'http://192.168.0.33:9000',AUTH_SECRET:'dummy',S3_ACCESS_KEY:'dummy',S3_SECRET_KEY:'dummy',CRM_MODERNIZATION_STAGE_PROOF:JSON.stringify(proof)};
 const container={host:'abcdef123456',docker:true};assert.doesNotThrow(()=>stageGuard(input,env,container));
 assert.throws(()=>stageGuard(input,{...env,CRM_MODERNIZATION_TARGET:'local'},container));assert.throws(()=>stageGuard(input,{...env,S3_BUCKET:'production'},container));assert.throws(()=>stageGuard(input,env,{...container,docker:false}));
 assert.throws(()=>stageGuard(input,{...env,CRM_MODERNIZATION_STAGE_PROOF:JSON.stringify({...proof,revision:afterRevision})},container));
});
test('runner binds explicit authorization, absolute private paths, before digest and frozen SQL',()=>{
 assert.throws(()=>validateOptions({mode:'before',authorized:false,revision,runId,outputDir:path.resolve('test-results/dummy')}));
 assert.throws(()=>validateOptions({mode:'after',authorized:true,revision,runId,outputDir:path.resolve('test-results/dummy')}));
 assert.throws(()=>validateOptions({mode:'before',authorized:true,revision,runId,outputDir:path.resolve('test-results/dummy'),unknown:1}));
 const web=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');const bytes=APPROVED_MIGRATIONS.map(row=>readFileSync(path.join(web,'prisma/migrations',row.name,'migration.sql')));assert.deepEqual(verifiedMigrationChecksums(bytes),APPROVED_MIGRATIONS);assert.throws(()=>verifiedMigrationChecksums([Buffer.concat([bytes[0],Buffer.from('changed')])]));
});
test('gzip wire is bounded and checksum-protected without raw data maps',()=>{
 const {before}=proofFixture();const body=encodeSnapshot(before,input);assert.deepEqual(decodeReadonlySnapshot(body),before);assert.ok(Buffer.byteLength(JSON.stringify(body))<=250*1024);
 assert.throws(()=>decodeReadonlySnapshot({...body,snapshotSha256:'0'.repeat(64)}));assert.throws(()=>decodeReadonlySnapshot({...body,snapshot:'!not-base64'}));
 const huge=Buffer.alloc(8*1024*1024+1,65);assert.throws(()=>decodeReadonlySnapshot({...body,snapshot:gzipSync(huge).toString('base64'),snapshotSha256:hash(huge)}));
 assert.throws(()=>encodeSnapshot({...before,raw:'x'.repeat(8*1024*1024)},input));
});
test('safe diagnostics never print arbitrary errors, rows or credentials',()=>{
 const result=diagnosticStop({name:'PrismaClientKnownRequestError',code:'P2010',message:'PRIVATE',meta:{code:'42601',message:'PRIVATE_RAW',databaseURL:'postgres://private@secret'}},'QUERY_COLUMNS');
 assert.equal(result.status,'STOP');assert.equal(result.diagnostic.prismaCode,'P2010');assert.equal(result.diagnostic.sqlState,'42601');assert.equal(JSON.stringify(result).includes('PRIVATE'),false);assert.equal(JSON.stringify(result).includes('postgres'),false);
});

for(const mode of ['before','after'])test('coherent '+mode+' capture uses only aggregate SELECTs, full schema definitions and strict scalar bindings',async()=>{
 const {before,after}=proofFixture(),snapshot=mode==='before'?before:after,captureInput=mode==='before'?input:{...input,mode:'after',revision:afterRevision};const calls=[];let open=false,readonly=false;
 const tx={
  async $executeRawUnsafe(sql,...args){assert.equal(open,true);assert.deepEqual(args,[]);assert.equal(sql,'SET TRANSACTION READ ONLY');readonly=true;calls.push('readonly');return 0;},
  async $queryRawUnsafe(sql,...args){
   assert.equal(open&&readonly,true);assert.ok(args.every(value=>typeof value==='string'||typeof value==='number'||typeof value==='boolean'||value===null),'raw scalar bindings only; arrays/objects/undefined forbidden');assert.match(sql,/^SELECT /);calls.push(sql);
   const tag=/UNIT110:([A-Z_]+)/.exec(sql)?.[1];
   if(tag==='IDENTITY'){assert.ok(sql.includes('current_database()::text'));assert.ok(sql.includes('current_schema()::text'));return [snapshot.identity];}
   if(tag==='TABLES'){assert.ok(sql.includes('tablename::text'));return snapshot.tableNames.map(name=>({name}));}
   if(tag==='TABLE_FP'){const table=/SELECT t\.\* FROM "([^"]+)" t/.exec(sql)?.[1];assert.ok(table);return [snapshot.tables[table]];}
   if(tag==='MATERIAL_CANONICAL'){assert.ok(mode==='before'?sql.includes('to_jsonb(m) doc'):sql.includes("jsonb_build_object('unit',u.name)"));return [snapshot.materials.canonical];}
   if(tag==='MATERIAL_TUPLES'){assert.ok(mode==='before'?sql.includes("to_jsonb(m)-'unit'"):sql.includes("to_jsonb(m)-'unitId'"));return [snapshot.materials.tuples];}
   if(tag==='MATERIAL_REFERENCES')return [snapshot.materials.references];
   if(tag==='CATALOG_EXPECTED'||tag==='CATALOG_MAPPING'){assert.equal(typeof args[0],'string');assert.equal(JSON.parse(args[0]).length,10);assert.ok(sql.includes('jsonb_to_recordset($1::jsonb)'));return tag==='CATALOG_EXPECTED'?[snapshot.catalog.expectedNames]:[{idMismatchCount:snapshot.catalog.idMismatchCount}];}
   if(tag==='CATALOG_ACTUAL')return [snapshot.catalog.actualNames];
   if(tag==='CATALOG_TIMES'){assert.deepEqual(args,[APPROVED_MIGRATIONS[0].name,APPROVED_MIGRATIONS[0].checksum]);return [{timeMismatchCount:snapshot.catalog.timeMismatchCount}];}
   if(tag==='LEDGER'){assert.deepEqual(args,[APPROVED_MIGRATIONS[0].name]);return snapshot.ledger.records;}
   if(tag==='LEDGER_PRESERVED')return [snapshot.ledger.preserved];
   if(tag==='ORG_OTHERS')return [snapshot.orgSetting.otherRows];if(tag==='ORG_BOT')return [snapshot.orgSetting.bot];
   if(tag==='CLOCK')return [{at:snapshot.capturedAt}];
   if(tag==='SCHEMA_STABLE'){
    const key=/UNIT110:SCHEMA_STABLE:([A-Za-z]+)/.exec(sql)?.[1];
    if(key==='constraints')assert.ok(sql.includes('pg_get_constraintdef'));
    if(key==='indexes')assert.ok(sql.includes('pg_get_indexdef'));
    if(key==='triggers'){assert.ok(sql.includes('pg_get_triggerdef'));assert.ok(sql.includes('COALESCE((c.conname='),'ordinary nonconstraint triggers must not disappear through SQL NULL');}
    return [snapshot.schema.stable[key]];
   }
   if(tag==='COLUMNS')return snapshot.schema.delta.columns.map(doc=>({doc}));
   if(tag==='CONSTRAINTS')return snapshot.schema.delta.constraints.map(doc=>({doc}));
   if(tag==='INDEXES')return snapshot.schema.delta.indexes.map(doc=>({doc}));
   if(tag==='TRIGGERS')return snapshot.schema.delta.triggers.map(doc=>({doc}));
   if(tag==='RELATIONS')return snapshot.schema.delta.relations.map(doc=>({doc}));
   if(tag==='TYPES')return snapshot.schema.delta.types.map(doc=>({doc}));if(tag==='TYPE_TEMPLATES')return [snapshot.schema.delta.typeTemplates];
   if(tag==='MATERIAL_SCHEMA')return [snapshot.schema.delta.materialColumns];if(tag==='MATERIAL_OWNER')return [{hash:snapshot.schema.delta.materialOwnerHash}];
   throw Error('UNEXPECTED_PURE_READ_QUERY');
  },
 };
 const db={async $queryRawUnsafe(){throw Error('NO_OUTSIDE_TX_QUERY');},async $transaction(fn,options){assert.equal(options.isolationLevel,'RepeatableRead');assert.equal(open,false);open=true;calls.push('begin');try{return await fn(tx);}finally{open=false;calls.push('end');}}};
 const proof={hostname:'crm-staging',revision:captureInput.revision,databaseVolume:'crm-staging_pgdata',outerW07Sha256:'1'.repeat(64),web:'2'.repeat(64),database:'3'.repeat(64)};
 const captured=await captureSnapshot(db,captureInput,proof);assert.equal(calls[0],'begin');assert.equal(calls[1],'readonly');assert.equal(calls.at(-1),'end');assert.deepEqual(captured,snapshot);
 if(mode==='before')assert.equal(verifyBefore(captured,input).materialsVerified,'2');else assert.equal(verifyAfter(before,captured,afterInput).originalsPreserved,true);
});
contrast('dynamic non-hardcoded public models are fully protected',(b,a)=>{b.tableNames.push('PluginOpaqueCounter');b.tableNames.sort();b.tables.PluginOpaqueCounter=fp('opaque-before');a.tableNames.push('PluginOpaqueCounter');a.tableNames.sort();a.tables.PluginOpaqueCounter=fp('opaque-after');});
contrast('nullable domain/collation metadata cannot hide a schema change',(b,a)=>{a.schema.delta.columns[0].domainName='unexpected-domain';});
contrast('FK trigger event type cannot change',(b,a)=>{a.schema.delta.triggers[0].eventType=17;});
contrast('index predicate or expression cannot change',(b,a)=>{a.schema.delta.indexes[1].predicate='name is not null';});
contrast('rolled back ledger cannot be accepted',(b,a)=>{a.ledger.records[0].rolledBackAt='2026-10-09T00:03:00.000Z';});
contrast('bot clock cannot change while full table fingerprint remains identical',(b,a)=>{a.orgSetting.bot.updatedAt='2026-10-09T00:04:00.000Z';});
contrast('material/canonical aggregate counter mismatch is refused',(b,a)=>{a.materials.tuples.count='1';});
contrast('fresh bot clock cannot mask changed immutable setting metadata',(b,a)=>{a.orgSetting.bot.updatedAt='2026-10-09T00:04:00.000Z';a.tables.OrgSetting=fp('fresh-clock','2');a.orgSetting.bot.stableFieldsHash=hash('changed immutable');});

test('serializer rejects any plaintext/private or per-row payload before gzip',()=>{
 const {before}=proofFixture();assert.throws(()=>encodeSnapshot({...before,rawRows:[{value:'PRIVATE'}]},input));
});
test('decoder refuses wire oversize, corrupt UTF8 and unknown encodings',()=>{
 const {before}=proofFixture(),body=encodeSnapshot(before,input);assert.throws(()=>decodeReadonlySnapshot({...body,snapshot:'A'.repeat(250*1024+4)}));assert.throws(()=>decodeReadonlySnapshot({...body,snapshotEncoding:'raw'}));
 const bad=Buffer.from([0xff]);assert.throws(()=>decodeReadonlySnapshot({...body,snapshot:gzipSync(bad).toString('base64'),snapshotSha256:hash(bad)}));
});
test('coherent null bot singleton is allowed but appearance/disappearance refuses',()=>{
 const {before,after}=proofFixture();for(const snapshot of [before,after]){snapshot.orgSetting.bot=null;snapshot.orgSetting.otherRows=fp('all settings','2');}
 assert.equal(verifyAfter(before,after,afterInput).operationalClockChanged,false);
 const b=proofFixture();b.after.orgSetting.bot=null;b.after.orgSetting.otherRows=fp('settings without bot','2');assert.throws(()=>verifyAfter(b.before,b.after,afterInput));
});

test('imports remain inert even with a staging-input environment',()=>{
 const moduleUrl=new URL('./warehouse-units-staging-readonly.mjs',import.meta.url).href;
 const runnerUrl=new URL('./warehouse-units-staging-runner.mjs',import.meta.url).href;
 const program='await import('+JSON.stringify(moduleUrl)+');await import('+JSON.stringify(runnerUrl)+');process.stdout.write("IMPORTED_ONLY");';
 const child=spawnSync(process.execPath,['--input-type=module','-e',program],{encoding:'utf8',windowsHide:true,env:{...process.env,CRM_MODERNIZATION_TARGET:'staging',CRM_STAGING_BROWSER_INPUT:Buffer.from('{}').toString('base64')}});
 assert.equal(child.status,0);assert.equal(child.stdout,'IMPORTED_ONLY');assert.equal(child.stderr,'');
});

contrast('other public type definitions are immutable',(b,a)=>{a.schema.stable.types=fp('type-changed');});
contrast('catalog composite and its companion array are exact new types',(b,a)=>{a.schema.delta.types[1].elementName='Material';});
contrast('catalog type nullable/default/storage metadata cannot drift',(b,a)=>{a.schema.delta.types[0].attributesHash=hash('different type flags');});
contrast('original Material and array templates cannot drift',(b,a)=>{a.schema.delta.typeTemplates.recordHash=hash('different original type');});

test('unknown exceptions never invent Prisma/SQLSTATE evidence, and throwing getters are safe',()=>{
 for(const code of ['P2010','TOKEN']){const result=diagnosticStop({name:'UnknownPrivateException',code,meta:{code:'TOKEN'}},'QUERY_COLUMNS');assert.equal(result.diagnostic.prismaCode,undefined);assert.equal(result.diagnostic.sqlState,undefined);assert.equal(JSON.stringify(result).includes('TOKEN'),false);}
 const error=new Proxy({}, {get(){throw Error('PRIVATE_GETTER');}});const result=diagnosticStop(error,'QUERY_COLUMNS');assert.equal(result.status,'STOP');assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
});
