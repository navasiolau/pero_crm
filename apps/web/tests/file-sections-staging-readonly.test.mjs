// Pure tests113: без БД/SSH/fixtures; проверяется строгий контракт readonly aggregate proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {MIGRATION,BUSINESS_COLUMNS,SECTION_LABELS,WIRE_LIMIT,expectedSection,tupleFingerprint,fileTupleSql,captureSnapshot,verifyBefore,verifyAfter,stageGuard,safeDiagnostic,boundedResponse} from './file-sections-staging-readonly.mjs';
import {validateOptions,verifiedMigrationChecksum,verifiedResponse,fileSectionsStagingBundle} from './file-sections-staging-runner.mjs';

const h=value=>createHash('sha256').update(value).digest('hex'),fp=(value,count='1')=>({count,hash:h(value)});
const revision='a'.repeat(40),afterRevision='b'.repeat(40),runId='a6bec2c9-dcbf-4df1-8a5c-50c207b9e6f8';
const input={operation:'inspect',mode:'before',authorized:true,revision,runId,expectedMigration:MIGRATION};
const afterInput={...input,mode:'after',revision:afterRevision,beforeRevision:revision};
const schemaKeys=['columns','constraints','indexes','triggers','routines','sequences','relations','otherEnums','otherTypes','enumTypes','views','policies','namespace'];
const names=['ApiToken','CashAccount','ChangeLog','File','FinanceDocument','MaterialUnit','OrgSetting','Payment','Payout','PayrollEntry','Product','Project','StockMovement','Task','UserPreference','_prisma_migrations'];
function oldFiles(){
 return [
  {id:'measure-general',projectId:'project',productId:null,taskId:'task',category:'MEASUREMENT',stage:'INSTALLATION',caption:'retired fixture',storedName:'stable-original-1',uploadedById:'actor',fileName:'measurement.pdf',mimeType:'application/pdf',size:53,hasThumb:false,createdAt:'2026-10-08T00:00:00.000Z',legacyId:'legacy-1',legacyTable:'f'},
  {id:'project-file',projectId:'project',productId:null,taskId:null,category:'PHOTO',stage:'INSTALLATION',caption:null,storedName:'stable-original-2',uploadedById:'actor',fileName:'photo.png',mimeType:'image/png',size:67,hasThumb:true,createdAt:'2026-10-08T00:00:00.000Z',legacyId:null,legacyTable:null},
  {id:'archived-assembly',projectId:'archived-project',productId:'archived-product',taskId:'task',category:'DOCUMENT',stage:'ASSEMBLY',caption:null,storedName:'stable-original-3',uploadedById:null,fileName:'assembly.pdf',mimeType:'application/pdf',size:79,hasThumb:false,createdAt:'2026-10-08T00:00:00.000Z',legacyId:'legacy-3',legacyTable:'f'},
  {id:'installation',projectId:'project',productId:'product',taskId:null,category:'OTHER',stage:'INSTALLATION',caption:null,storedName:'stable-original-4',uploadedById:'actor',fileName:'installation.b3d',mimeType:'application/octet-stream',size:89,hasThumb:false,createdAt:'2026-10-08T00:00:00.000Z',legacyId:null,legacyTable:null},
  {id:'product-measure',projectId:'project',productId:'product',taskId:null,category:'MEASUREMENT',stage:'ASSEMBLY',caption:null,storedName:'stable-original-5',uploadedById:'actor',fileName:'measurement.png',mimeType:'image/png',size:97,hasThumb:true,createdAt:'2026-10-08T00:00:00.000Z',legacyId:null,legacyTable:null},
  {id:'current-sketch',projectId:'project',productId:'product',taskId:null,category:'PHOTO',stage:'PRODUCTION',caption:null,storedName:'stable-original-6',uploadedById:'actor',fileName:'sketch.png',mimeType:'image/png',size:101,hasThumb:true,createdAt:'2026-10-08T00:00:00.000Z',legacyId:null,legacyTable:null},
 ];
}
function migrated(rows){return rows.map(file=>{const next={...file,section:expectedSection(file)};for(const key of ['category','caption','stage'])delete next[key];return next;});}
function column(name,ordinal,type='text',nullable='YES',defaultValue=null){
 return {name,ordinal,udtSchema:type.startsWith('File')?'public':'pg_catalog',type,nullable,defaultValue,hash:h('column-'+name+'-'+ordinal),enumShapeHash:type.startsWith('File')?h('ordinary public enum nonnullable'):h('column shape '+name)};
}
function fixture(){
 const files=oldFiles(),afterFiles=migrated(files),businessOrdinals=[1,2,3,4,8,9,10,11,12,13,14,15,16];
 const columns=BUSINESS_COLUMNS.map((name,index)=>column(name,businessOrdinals[index]));
 columns.push(column('category',5,'FileCategory','NO',"'OTHER'::\"FileCategory\""),column('stage',6,'FileStage','NO',"'PRODUCTION'::\"FileStage\""),column('caption',7));
 columns.sort((a,b)=>a.ordinal-b.ordinal);
 const before={version:1,mode:'before',runId,revision,capturedAt:'2026-10-09T01:00:00.000Z',identity:{name:'crm',schema:'public',readonly:'on',primary:true},tableNames:names,tables:Object.fromEntries(names.map(name=>[name,fp('original '+name,'3')])),files:tupleFingerprint(files,'before'),preservedLedger:fp('original _prisma_migrations','42'),migration:[],schema:{stable:Object.fromEntries(schemaKeys.map(name=>[name,fp('schema '+name)])),columns,enums:[...['PHOTO','DRAWING','QUOTE','MEASUREMENT','DOCUMENT','OTHER'].map(label=>({name:'FileCategory',label})),...['PRODUCTION','ASSEMBLY','INSTALLATION'].map(label=>({name:'FileStage',label}))],enumTypes:[{name:'FileCategory',kind:'e',hash:h('ordinary enum metadata')},{name:'FileStage',kind:'e',hash:h('ordinary enum metadata')}],arrayTypes:[{name:'_FileCategory',kind:'b',category:'A',element:'FileCategory',hash:h('enum array')},{name:'_FileStage',kind:'b',category:'A',element:'FileStage',hash:h('enum array')}],indexes:[{name:'File_projectId_category_idx',shapeOK:true},{name:'File_projectId_stage_idx',shapeOK:true}]},orgSetting:{other:fp('other settings','2'),bot:{valueHash:h('same bot value'),stableHash:h('same stable fields'),updatedAt:'2026-10-09T00:58:00.000Z'}}};
 before.tables.File=fp('full old File',String(files.length));before.tables._prisma_migrations=before.preservedLedger;
 const after=structuredClone(before);after.mode='after';after.revision=afterRevision;after.capturedAt='2026-10-09T01:05:00.000Z';after.files=tupleFingerprint(afterFiles,'after');after.tables.File=fp('full new File',String(afterFiles.length));
 after.tables._prisma_migrations=fp('new migration ledger','43');after.migration=[{...MIGRATION,startedAt:'2026-10-09T01:02:00.000Z',finishedAt:'2026-10-09T01:03:00.000Z',rolledBackAt:null,appliedStepsCount:1,logsNull:true,fullHash:h('exact new migration row')}];
 after.schema.columns=structuredClone(before.schema.columns.filter(row=>BUSINESS_COLUMNS.includes(row.name)));after.schema.columns.push(column('section',17,'FileSection','NO',"'GENERAL'::\"FileSection\""));
 after.schema.enums=SECTION_LABELS.map(label=>({name:'FileSection',label}));after.schema.enumTypes=[{name:'FileSection',kind:'e',hash:h('ordinary enum metadata')}];after.schema.indexes=[{name:'File_projectId_section_idx',shapeOK:true}];after.schema.arrayTypes=[{name:'_FileSection',kind:'b',category:'A',element:'FileSection',hash:h('enum array')}];
 return {before,after,files,afterFiles};
}
function contrast(name,change){test(name,()=>{const f=fixture();change(f);assert.throws(()=>verifyAfter(f.before,f.after,afterInput));});}
test('exact case precedence and complete archived/product/task migration produce equal protected tuples',()=>{
 const {before,after,files}=fixture();assert.deepEqual(files.map(expectedSection),['MEASUREMENT','GENERAL','PRODUCTION','INSTALLATION','MEASUREMENT','PRODUCTION']);
 assert.deepEqual(verifyBefore(before,input),{fileCount:'6',protectedTableCount:16,readOnly:true});
 assert.deepEqual(verifyAfter(before,after,afterInput),{fileCount:'6',protectedTableCount:16,originalsPreserved:true,exactSectionsVerified:true,schemaVerified:true,ledgerVerified:true,operationalClockChanged:false,readOnly:true});
});
test('SQL applies measurement before product-null/install and contains no live/archive filter',()=>{
 const sql=fileTupleSql('before');assert.ok(sql.indexOf('MEASUREMENT')<sql.indexOf('"productId" IS NULL'));assert.ok(sql.indexOf('"productId" IS NULL')<sql.indexOf('"stage"'));assert.doesNotMatch(sql,/WHERE|deletedAt|LIMIT|OFFSET/);assert.match(fileTupleSql('after'),/f\."section"::text/);
});
test('file order and legacy removed comments have no false business drift',()=>{
 const rows=oldFiles(),after=migrated(rows).reverse();assert.deepEqual(tupleFingerprint(rows,'before'),tupleFingerprint(after,'after'));
 const changed=structuredClone(rows);changed[0].caption='different retired comment';assert.deepEqual(tupleFingerprint(rows,'before'),tupleFingerprint(changed,'before'));
});
for(const key of ['storedName','fileName','uploadedById','projectId','productId','taskId','mimeType','size','hasThumb','createdAt','legacyId','legacyTable']){
 contrast('protected File '+key+' drift cannot be hidden by removed metadata',f=>{f.afterFiles[0][key]=key==='size'?900:key==='hasThumb'?true:'changed';f.after.files=tupleFingerprint(f.afterFiles,'after');});
}
contrast('measurement with no product must not become GENERAL',f=>{f.afterFiles[0].section='GENERAL';f.after.files=tupleFingerprint(f.afterFiles,'after');});
contrast('assembly must become production without losing row',f=>{f.afterFiles[2].section='INSTALLATION';f.after.files=tupleFingerprint(f.afterFiles,'after');});
contrast('missing original File row is rejected',f=>{f.afterFiles.pop();f.after.files=tupleFingerprint(f.afterFiles,'after');f.after.tables.File.count='5';});
contrast('extra File row is rejected',f=>{f.afterFiles.push({...f.afterFiles[0],id:'unowned-new-file'});f.after.files=tupleFingerprint(f.afterFiles,'after');f.after.tables.File.count='7';});
contrast('one missing and one extra File cannot pass equal row counts',f=>{f.afterFiles[0].id='unowned-replacement-id';f.after.files=tupleFingerprint(f.afterFiles,'after');});
for(const table of ['Project','Product','Task','Payment','PayrollEntry','Payout','CashAccount','FinanceDocument','StockMovement','ChangeLog','ApiToken','UserPreference','MaterialUnit']){
 contrast('whole '+table+' is immutable including FK/covers/finance/default catalog/token clock',f=>{f.after.tables[table]=fp('changed '+table,'3');});
}
contrast('new/missing public model is rejected',f=>{f.after.tableNames=f.after.tableNames.filter(name=>name!=='MaterialUnit');delete f.after.tables.MaterialUnit;});
contrast('unknown added public table is rejected',f=>{f.after.tableNames.push('Unexpected');f.after.tables.Unexpected=fp('unknown');});
for(const key of schemaKeys)contrast('unknown '+key+' schema change is rejected',f=>{f.after.schema.stable[key]=fp('schema drift '+key);});
contrast('unknown File column is rejected even when no data rows exist',f=>{f.after.schema.columns.push(column('extra',18));});
contrast('remaining old File metadata column is rejected',f=>{f.after.schema.columns.push(column('caption',7));});
contrast('business column definition/default drift is rejected',f=>{f.after.schema.columns[0].hash=h('new default');});
contrast('section cannot become nullable',f=>{f.after.schema.columns.at(-1).nullable='YES';});
contrast('section GENERAL default is mandatory',f=>{f.after.schema.columns.at(-1).defaultValue="'PRODUCTION'::\"FileSection\"";});
contrast('section other column attributes are protected',f=>{f.after.schema.columns.at(-1).enumShapeHash=h('generated column or extra collation');});
contrast('section physical ordinal must be exact approved appended column',f=>{f.after.schema.columns.at(-1).ordinal=5;});
contrast('retired FileCategory enum cannot survive',f=>{f.after.schema.enums.push({name:'FileCategory',label:'OTHER'});});
contrast('FileSection labels and order must match exact approved SQL',f=>{f.after.schema.enums.reverse();});
contrast('new enum ownership/ACL/base metadata cannot drift',f=>{f.after.schema.enumTypes[0].hash=h('other owner');});
contrast('retired index cannot survive',f=>{f.after.schema.indexes.push({name:'File_projectId_category_idx',shapeOK:true});});
contrast('new index columns/type/collation/uniqueness cannot drift',f=>{f.after.schema.indexes[0].shapeOK=false;});
contrast('migration must be exactly one new row',f=>{f.after.migration.push({...f.after.migration[0]});f.after.tables._prisma_migrations.count='44';});
contrast('old ledger bytes must not change',f=>{f.after.preservedLedger=fp('old ledger changed','42');});
contrast('migration checksum must match approved SQL',f=>{f.after.migration[0].checksum='0'.repeat(64);});
contrast('failed/unfinished or rollback migration cannot be accepted',f=>{f.after.migration[0].finishedAt=null;});
contrast('migration outside before-after proof window is rejected',f=>{f.after.migration[0].startedAt='2026-10-08T00:00:00.000Z';});
test('only same-value same-stable-fields bot updatedAt freshly advancing in proof window is allowed',()=>{
 const {before,after}=fixture();after.orgSetting.bot.updatedAt='2026-10-09T01:04:00.000Z';after.tables.OrgSetting=fp('new bot clock','3');assert.equal(verifyAfter(before,after,afterInput).operationalClockChanged,true);
});
contrast('bot value is immutable',f=>{f.after.orgSetting.bot.valueHash=h('new value');});
contrast('bot other fields are immutable',f=>{f.after.orgSetting.bot.stableHash=h('new fields');});
contrast('bot may not appear/disappear',f=>{f.after.orgSetting.bot=null;f.after.orgSetting.other.count='3';});
contrast('old timestamp advancement predating capture is not a generic exception',f=>{f.after.orgSetting.bot.updatedAt='2026-10-09T00:59:00.000Z';f.after.tables.OrgSetting=fp('new bot clock','3');});
contrast('future bot timestamp outside capture is rejected',f=>{f.after.orgSetting.bot.updatedAt='2026-10-09T01:06:00.000Z';});
contrast('bot clock regression is rejected',f=>{f.after.orgSetting.bot.updatedAt='2026-10-08T00:00:00.000Z';});
contrast('other setting timestamps/values remain immutable',f=>{f.after.orgSetting.other=fp('changed settings','2');});
contrast('unclassified OrgSetting raw drift is rejected',f=>{f.after.tables.OrgSetting=fp('drift without bot clock','3');});
contrast('unknown snapshot field and raw row maps are rejected',f=>{f.after.rowMap={'private-file':'raw data'};});
test('wire output is aggregated and bounded without row identifiers/storage/author values',()=>{
 const {before}=fixture(),wire=JSON.stringify(boundedResponse(before));assert.ok(Buffer.byteLength(wire)<WIRE_LIMIT);
 for(const value of ['stable-original-1','measurement.pdf','archived-product','retired fixture'])assert.ok(!wire.includes(value));
 assert.throws(()=>boundedResponse({...before,unexpected:'x'.repeat(WIRE_LIMIT)}),/READONLY_WIRE_LIMIT/);
});
test('read-only transport needs reviewed full revision, UUID and immutable hashed before artifact',()=>{
 const outputDir=path.resolve('test-results/proof113');
 assert.throws(()=>validateOptions({mode:'before',authorized:false,revision,runId,outputDir}));
 assert.throws(()=>validateOptions({mode:'after',authorized:true,revision,runId,outputDir}));
 assert.throws(()=>validateOptions({mode:'before',authorized:true,revision:'123',runId,outputDir}));
 assert.throws(()=>validateOptions({mode:'before',authorized:true,revision,runId,outputDir,bypass:true}));
});
test('exact SQL checksum is verified across LF/CRLF without a DB or wrapper execution',()=>{
 const source=readFileSync(new URL('../prisma/migrations/'+MIGRATION.name+'/migration.sql',import.meta.url));assert.deepEqual(verifiedMigrationChecksum(source),MIGRATION);assert.deepEqual(verifiedMigrationChecksum(Buffer.from(source.toString('utf8').replaceAll('\r\n','\n').replaceAll('\n','\r\n'))),MIGRATION);assert.throws(()=>verifiedMigrationChecksum(Buffer.from(source.toString('utf8')+'\n')));
});
test('capture uses coherent RepeatableRead READ ONLY and binds every placeholder with scalars',async()=>{
 const f=fixture(),queries=[],writes=[];let options;
 const tx={$executeRawUnsafe:async sql=>{writes.push(sql);},$queryRawUnsafe:async(sql,...args)=>{
  queries.push({sql,args});assert.ok(args.every(value=>value===null||['string','number','boolean'].includes(typeof value)));
  if(sql.startsWith('SELECT current_database()'))return [f.before.identity];
  if(sql.startsWith('SELECT tablename::text'))return names.map(name=>({name}));
  if(sql.startsWith('SELECT column_name::text'))return f.before.schema.columns;
  if(sql.startsWith('SELECT t.typname::text name,e.enumlabel'))return f.before.schema.enums;
  if(sql.startsWith('SELECT t.typname::text name,t.typtype::text kind,t.typcategory'))return f.before.schema.arrayTypes;
  if(sql.startsWith('SELECT t.typname::text name,t.typtype::text kind,encode'))return f.before.schema.enumTypes;
  if(sql.startsWith('SELECT i.indexname::text'))return f.before.schema.indexes;
  if(sql.startsWith('SELECT migration_name::text'))return [];
  if(sql.startsWith('SELECT to_char(clock_timestamp()'))return [{at:f.before.capturedAt}];
  if(sql.includes('FROM "OrgSetting" t WHERE t.key=$1'))return [f.before.orgSetting.bot];
  if(sql.includes('WHERE t.migration_name<>$1'))return [f.before.preservedLedger];
  if(sql.includes('FROM "OrgSetting" t WHERE t.key<>$1'))return [f.before.orgSetting.other];
  if(sql.includes('jsonb_build_object(\'id\',f.id'))return [f.before.files];
  for(const name of names)if(sql.includes('SELECT to_jsonb(t) doc FROM "'+name+'" t'))return [f.before.tables[name]];
  if(sql.startsWith('SELECT count(*)::text'))return [fp('schema captured')];
  throw Error('UNREVIEWED_QUERY');
 }};
 const db={$transaction:async(fn,config)=>{options=config;return fn(tx);}};
 const snapshot=await captureSnapshot(db,input,{hostname:'crm-staging',revision,databaseVolume:'crm-staging_pgdata'});
 assert.deepEqual(options,{isolationLevel:'RepeatableRead',maxWait:10000,timeout:120000});assert.deepEqual(writes,['SET TRANSACTION READ ONLY']);assert.doesNotThrow(()=>verifyBefore(snapshot,input));
 const bounded=queries.filter(query=>query.args.length);assert.ok(bounded.length>=4);assert.ok(bounded.every(query=>query.args.length===1&&typeof query.args[0]==='string'));
 assert.ok(queries.some(query=>query.sql.includes('tablename::text')));assert.ok(queries.some(query=>query.sql.includes('column_name::text')));
});
test('stage guard fails closed on wrong DB/container/storage/proof/input and never reveals credentials',()=>{
 const host='c'.repeat(12),proof={hostname:'crm-staging',revision,databaseVolume:'crm-staging_pgdata',outerW07Sha256:'d'.repeat(64),web:host+'e'.repeat(52),database:'f'.repeat(64)};
 const env={CRM_MODERNIZATION_TARGET:'staging',DATABASE_URL:'postgresql://qa:qa@db:5432/crm',CRM_FILE_STORAGE:'s3',S3_BUCKET:'pero-crm-staging',S3_ENDPOINT:'http://192.168.0.33:9000',AUTH_SECRET:'qa-disabled',S3_ACCESS_KEY:'qa-disabled',S3_SECRET_KEY:'qa-disabled',CRM_MODERNIZATION_STAGE_PROOF:JSON.stringify(proof)};
 assert.deepEqual(stageGuard(input,env,{host,docker:true}),proof);
 for(const change of [{CRM_MODERNIZATION_TARGET:'production'},{DATABASE_URL:'postgresql://qa:qa@db:5432/production'},{DATABASE_URL:'postgresql://qa:qa@db:5432/crm?schema=other'},{S3_BUCKET:'production'},{CRM_MODERNIZATION_STAGE_PROOF:JSON.stringify({...proof,revision:afterRevision})}])assert.throws(()=>stageGuard(input,{...env,...change},{host,docker:true}));
 assert.throws(()=>stageGuard({...input,operation:'restore'},env,{host,docker:true}));assert.throws(()=>stageGuard(input,env,{host,docker:false}));
 const privateError={name:'PrismaClientKnownRequestError',code:'P2010',message:'private URL or secret',meta:{code:'42883',message:'private rows'},detail:'private data',table:'private-row'};assert.deepEqual(safeDiagnostic(privateError,'FILE_TUPLES'),{phase:'FILE_TUPLES',exceptionType:'PrismaClientKnownRequestError',prismaCode:'P2010',sqlState:'42883'});assert.ok(!JSON.stringify(safeDiagnostic(privateError)).includes('private'));
});
test('runner rejects bad physical receipt or oversized raw wire before comparison/publishing',()=>{
 const {before}=fixture(),body=boundedResponse(before),receipt={identity:{hostname:'crm-staging',revision,databaseVolume:'crm-staging_pgdata',database:'c'.repeat(64),web:'d'.repeat(64),outerW07Sha256:'e'.repeat(64),databaseStartedAt:'2026-09-23T11:42:14.649193151Z'},bundleSha256:'f'.repeat(64),operation:'inspect',exitCode:0};
 assert.equal(verifiedResponse({body,receipt},input,'f'.repeat(64)),before);
 assert.throws(()=>verifiedResponse({body,receipt:{...receipt,identity:{...receipt.identity,databaseVolume:'other'}}},input,'f'.repeat(64)));
 assert.throws(()=>verifiedResponse({body:{...body,extra:'x'.repeat(WIRE_LIMIT)},receipt},input,'f'.repeat(64)));
});
test('bundle/import is source-only and remains under existing guarded wrapper cap',async()=>{
 const bytes=await fileSectionsStagingBundle();assert.ok(bytes.length>0&&bytes.length<=256*1024);
 const wrapper=readFileSync(new URL('../../../deploy/acceptance/crm-modernization-staging.py',import.meta.url),'utf8');assert.match(wrapper,/len\(bundle\) <= 256 \* 1024/);assert.match(wrapper,/len\(result.stdout\) <= 256 \* 1024/);
 const source=readFileSync(new URL('./file-sections-staging-readonly.mjs',import.meta.url),'utf8');assert.doesNotMatch(source,/\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bALTER\b|\bDROP\b|\bCREATE\s+TABLE\b/);assert.match(source,/SET TRANSACTION READ ONLY/);
});

contrast('a domain with a retired enum name cannot survive enum-only filtering',f=>{f.after.schema.enumTypes.push({name:'FileStage',kind:'d',hash:h('domain pretending retirement')});});
contrast('new FileSection type must be enum rather than an alias/domain',f=>{f.after.schema.enumTypes[0].kind='d';});
contrast('retired companion array cannot survive migration',f=>{f.after.schema.arrayTypes.push({name:'_FileStage',kind:'b',category:'A',element:'FileStage',hash:h('enum array')});});
contrast('new companion array element and permissions are exact',f=>{f.after.schema.arrayTypes[0].element='OtherType';});
contrast('new companion array base metadata cannot drift',f=>{f.after.schema.arrayTypes[0].hash=h('changed array metadata');});
