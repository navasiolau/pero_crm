// Задача113: root-only READ ONLY proof. Импорт и сборка не обращаются к БД/SSH.
// SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP при несовпадении guard.
import {createHash} from 'node:crypto';
import {hostname} from 'node:os';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {PrismaClient} from '@prisma/client';

export const MIGRATION={name:'20261008173000_file_sections',checksum:'7d492603dfcc4426dc3d647f9e1b4146c2472b8bae0ac60998efd1dc4f78567b'};
export const WIRE_LIMIT=64*1024;
export const BUSINESS_COLUMNS=['id','projectId','productId','taskId','fileName','storedName','mimeType','size','hasThumb','uploadedById','legacyId','legacyTable','createdAt'];
export const SECTION_LABELS=['GENERAL','MEASUREMENT','PRODUCTION','INSTALLATION'];
const OLD_ENUMS={FileCategory:['PHOTO','DRAWING','QUOTE','MEASUREMENT','DOCUMENT','OTHER'],FileStage:['PRODUCTION','ASSEMBLY','INSTALLATION']};
const OLD_INDEXES=['File_projectId_category_idx','File_projectId_stage_idx'],NEW_INDEX='File_projectId_section_idx';
const REQUIRED=['File','Project','Product','Task','Payment','PayrollEntry','ChangeLog','OrgSetting','ApiToken','_prisma_migrations'];
const SHA=/^[a-f0-9]{64}$/,REV=/^[a-f0-9]{40}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SCHEMA_KEYS=['columns','constraints','indexes','triggers','routines','sequences','relations','otherEnums','otherTypes','enumTypes','views','policies','namespace'];
const ISO="YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"";
const PHASES=new Set(['INPUT','GUARD','CLIENT','TX','IDENTITY','TABLE_NAMES','TABLE_FP','FILE_TUPLES','SCHEMA_COLUMNS','SCHEMA_CONSTRAINTS','SCHEMA_INDEXES','SCHEMA_TRIGGERS','SCHEMA_ROUTINES','SCHEMA_SEQUENCES','SCHEMA_RELATIONS','SCHEMA_OTHERENUMS','SCHEMA_OTHERTYPES','SCHEMA_ENUMTYPES','SCHEMA_VIEWS','SCHEMA_POLICIES','SCHEMA_NAMESPACE','FILE_COLUMNS','FILE_ENUMS','FILE_ENUM_TYPES','FILE_INDEXES','LEDGER_PRESERVED','LEDGER_NEW','BOT_OTHER','BOT_CLOCK','CLOCK','VERIFY','WIRE','DISCONNECT']);
let currentPhase='INPUT';
const phase=value=>{currentPhase=PHASES.has(value)?value:'INPUT';};
export class ProofStop extends Error{constructor(code){super(code);this.code=code;}}
const need=(ok,code)=>{if(!ok)throw new ProofStop(code);};
export function canonical(value){
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value!==null&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
 return JSON.stringify(value);
}
const same=(left,right,code)=>need(canonical(left)===canonical(right),code);
export const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
function exact(value,keys,code){need(value!==null&&typeof value==='object'&&!Array.isArray(value),code);same(Object.keys(value).sort(),[...keys].sort(),code);}
const validTime=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
function fingerprintShape(value){exact(value,['count','hash'],'FP_FIELDS_INVALID');need(typeof value.count==='string'&&/^(0|[1-9][0-9]*)$/.test(value.count)&&BigInt(value.count)<1000000000000n&&SHA.test(value.hash??''),'FP_SHAPE_INVALID');}
function checkInput(input,comparison=false){
 const keys=['operation','mode','authorized','revision','runId','expectedMigration'];
 if(comparison)keys.push('beforeRevision');
 exact(input,keys,'INPUT_FIELDS_INVALID');
 need(input.operation==='inspect'&&input.authorized===true&&['before','after'].includes(input.mode)&&REV.test(input.revision??'')&&UUID.test(input.runId??''),'INPUT_BINDING_INVALID');
 exact(input.expectedMigration,['name','checksum'],'MIGRATION_INPUT_INVALID');same(input.expectedMigration,MIGRATION,'APPROVED_MIGRATION_CHANGED');
 if(comparison)need(REV.test(input.beforeRevision??'')&&input.beforeRevision!==input.revision,'DISTINCT_BEFORE_REVISION_REQUIRED');
}
export function stageGuard(input,env=process.env,container={host:hostname(),docker:existsSync('/.dockerenv')}){
 checkInput(input);
 need(env.CRM_MODERNIZATION_TARGET==='staging'&&container.docker,'STAGING_ONLY_REQUIRED');
 let url,endpoint,proof;
 try{url=new URL(env.DATABASE_URL??'');endpoint=new URL(env.S3_ENDPOINT??'');proof=JSON.parse(env.CRM_MODERNIZATION_STAGE_PROOF??'');}catch{throw new ProofStop('STAGING_ENV_INVALID');}
 need(['postgres:','postgresql:'].includes(url.protocol)&&url.hostname==='db'&&(url.port||'5432')==='5432'&&url.pathname==='/crm'&&!url.hash,'STAGING_DATABASE_MISMATCH');
 const allowed=new Set(['schema','connection_limit','pool_timeout','connect_timeout','socket_timeout','sslmode']);
 need([...url.searchParams.keys()].every(key=>allowed.has(key)&&url.searchParams.getAll(key).length===1)&&(!url.searchParams.has('schema')||url.searchParams.get('schema')==='public'),'DATABASE_OPTIONS_MISMATCH');
 need(env.CRM_FILE_STORAGE==='s3'&&env.S3_BUCKET==='pero-crm-staging'&&endpoint.protocol==='http:'&&endpoint.hostname==='192.168.0.33'&&endpoint.port==='9000'&&!endpoint.username&&!endpoint.password&&!endpoint.search&&!endpoint.hash,'STAGING_STORAGE_MISMATCH');
 need(proof&&proof.hostname==='crm-staging'&&proof.revision===input.revision&&proof.databaseVolume==='crm-staging_pgdata'&&SHA.test(proof.outerW07Sha256??'')&&SHA.test(proof.web??'')&&SHA.test(proof.database??'')&&/^[a-f0-9]{12,64}$/.test(container.host??'')&&proof.web.startsWith(container.host),'PHYSICAL_STAGE_PROOF_REQUIRED');
 need((env.AUTH_SECRET??env.NEXTAUTH_SECRET)&&env.S3_ACCESS_KEY&&env.S3_SECRET_KEY,'RUNTIME_CREDENTIALS_REQUIRED');
 return proof;
}
function quote(value){need(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value),'TABLE_IDENTIFIER_INVALID');return '"'+value+'"';}
const hashSql=doc=>"encode(sha256(convert_to(("+doc+")::text,'UTF8')),'hex')";
export function fileTupleSql(mode){
 need(['before','after'].includes(mode),'MODE_INVALID');
 const section=mode==='before'?'CASE WHEN f."category"::text=\'MEASUREMENT\' THEN \'MEASUREMENT\' WHEN f."productId" IS NULL THEN \'GENERAL\' WHEN f."stage"::text=\'INSTALLATION\' THEN \'INSTALLATION\' ELSE \'PRODUCTION\' END':'f."section"::text';
 const business=mode==='before'?"to_jsonb(f)-'category'-'caption'-'stage'":"to_jsonb(f)-'section'";
 return "SELECT jsonb_build_object('id',f.id,'section',"+section+",'businessHash',"+hashSql(business)+") doc FROM \"File\" f";
}
export function expectedSection(file){return file.category==='MEASUREMENT'?'MEASUREMENT':file.productId===null?'GENERAL':file.stage==='INSTALLATION'?'INSTALLATION':'PRODUCTION';}
export function tupleFingerprint(rows,mode){
 need(['before','after'].includes(mode),'MODE_INVALID');
 const hashes=rows.map(row=>{const business={...row};for(const key of mode==='before'?['category','caption','stage']:['section'])delete business[key];return digest({id:row.id,section:mode==='before'?expectedSection(row):row.section,businessHash:digest(business)});}).sort();
 return {count:String(rows.length),hash:createHash('sha256').update(hashes.join('')).digest('hex')};
}
async function fp(tx,query,values=[],label='TABLE_FP'){
 phase(label);need(values.every(value=>value===null||['string','number','boolean'].includes(typeof value)),'SQL_SCALAR_PARAMETERS_REQUIRED');
 const sql="SELECT count(*)::text count,encode(sha256(convert_to(COALESCE(string_agg(h,'' ORDER BY h),''),'UTF8')),'hex') hash FROM (SELECT "+hashSql('r.doc')+' h FROM ('+query+') r) fingerprints';
 const rows=await tx.$queryRawUnsafe(sql,...values);need(rows.length===1,'FP_SINGLETON_REQUIRED');fingerprintShape(rows[0]);return rows[0];
}
async function schemaFacts(tx){
 const queries={
  columns:"SELECT to_jsonb(c) doc FROM (SELECT table_name,column_name,ordinal_position,column_default,is_nullable,data_type,udt_schema,udt_name,character_maximum_length,numeric_precision,numeric_scale,datetime_precision,collation_name,is_identity,identity_generation,is_generated,generation_expression FROM information_schema.columns WHERE table_schema='public' AND NOT(table_name='File' AND column_name IN ('category','caption','stage','section'))) c",
  constraints:"SELECT to_jsonb(r) doc FROM (SELECT t.relname,c.conname,c.contype,c.condeferrable,c.condeferred,c.convalidated,pg_get_constraintdef(c.oid,true) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public') r",
  indexes:"SELECT to_jsonb(r) doc FROM (SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND NOT(tablename='File' AND indexname IN ('File_projectId_category_idx','File_projectId_stage_idx','File_projectId_section_idx'))) r",
  triggers:"SELECT to_jsonb(r) doc FROM (SELECT c.relname,t.tgname,t.tgenabled,t.tgisinternal,pg_get_triggerdef(t.oid,true) definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public') r",
  routines:"SELECT to_jsonb(r) doc FROM (SELECT p.proname,pg_get_function_identity_arguments(p.oid) arguments,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p')) r",
  sequences:"SELECT to_jsonb(r) doc FROM pg_sequences r WHERE r.schemaname='public'",
  relations:"SELECT to_jsonb(r) doc FROM (SELECT c.relname,c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity,c.reloptions,c.relacl,pg_get_userbyid(c.relowner) owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname NOT IN ('File_projectId_category_idx','File_projectId_stage_idx','File_projectId_section_idx')) r",
  otherEnums:"SELECT to_jsonb(r) doc FROM (SELECT t.typname,e.enumlabel,e.enumsortorder FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname NOT IN ('FileCategory','FileStage','FileSection')) r",
  otherTypes:"SELECT to_jsonb(t) doc FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname NOT IN ('FileCategory','FileStage','FileSection','_FileCategory','_FileStage','_FileSection')",
  enumTypes:"SELECT to_jsonb(r) doc FROM (SELECT t.typname,t.typlen,t.typbyval,t.typtype,t.typcategory,t.typdelim,t.typalign,t.typstorage,t.typnotnull,t.typdefault,t.typacl,pg_get_userbyid(t.typowner) owner FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype='e' AND t.typname NOT IN ('FileCategory','FileStage','FileSection')) r",
  views:"SELECT to_jsonb(r) doc FROM pg_views r WHERE r.schemaname='public'",
  policies:"SELECT to_jsonb(r) doc FROM pg_policies r WHERE r.schemaname='public'",
  namespace:"SELECT to_jsonb(r) doc FROM (SELECT nspname,nspacl,pg_get_userbyid(nspowner) owner FROM pg_namespace WHERE nspname='public') r",
 };
 const stable={};for(const [key,query]of Object.entries(queries))stable[key]=await fp(tx,query,[],'SCHEMA_'+key.toUpperCase());
 phase('FILE_COLUMNS');
 const columns=await tx.$queryRawUnsafe("SELECT column_name::text name,ordinal_position::int ordinal,udt_schema::text \"udtSchema\",udt_name::text type,is_nullable::text nullable,CASE WHEN column_name IN ('category','stage','caption','section') THEN column_default::text ELSE NULL END \"defaultValue\","+hashSql('to_jsonb(c)')+" hash,"+hashSql("to_jsonb(c)-'column_name'-'ordinal_position'-'column_default'-'udt_name'")+" \"enumShapeHash\" FROM (SELECT table_name,column_name,ordinal_position,column_default,is_nullable,data_type,udt_schema,udt_name,character_maximum_length,numeric_precision,numeric_scale,datetime_precision,collation_name,is_identity,identity_generation,is_generated,generation_expression FROM information_schema.columns WHERE table_schema='public' AND table_name='File') c ORDER BY ordinal_position");
 phase('FILE_ENUMS');
 const enums=await tx.$queryRawUnsafe("SELECT t.typname::text name,e.enumlabel::text label FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname IN ('FileCategory','FileStage','FileSection') ORDER BY t.typname,e.enumsortorder");
 phase('FILE_ENUM_TYPES');
 const enumTypes=await tx.$queryRawUnsafe("SELECT t.typname::text name,t.typtype::text kind,"+hashSql("to_jsonb(t)-'oid'-'typname'-'typarray'")+" hash FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname IN ('FileCategory','FileStage','FileSection') ORDER BY t.typname");
 phase('FILE_INDEXES');
 const indexes=await tx.$queryRawUnsafe("SELECT i.indexname::text name,(i.indexdef='CREATE INDEX \"File_projectId_category_idx\" ON public.\"File\" USING btree (\"projectId\", category)' OR i.indexdef='CREATE INDEX \"File_projectId_stage_idx\" ON public.\"File\" USING btree (\"projectId\", stage)' OR i.indexdef='CREATE INDEX \"File_projectId_section_idx\" ON public.\"File\" USING btree (\"projectId\", section)') \"shapeOK\" FROM pg_indexes i WHERE i.schemaname='public' AND i.tablename='File' AND i.indexname IN ('File_projectId_category_idx','File_projectId_stage_idx','File_projectId_section_idx') ORDER BY i.indexname");
 phase('FILE_ENUM_TYPES');
 const arrayTypes=await tx.$queryRawUnsafe("SELECT t.typname::text name,t.typtype::text kind,t.typcategory::text category,el.typname::text element,"+hashSql("to_jsonb(t)-'oid'-'typname'-'typelem'")+" hash FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace LEFT JOIN pg_type el ON el.oid=t.typelem WHERE n.nspname='public' AND t.typname IN ('_FileCategory','_FileStage','_FileSection') ORDER BY t.typname");
 return {stable,columns,enums,enumTypes,indexes,arrayTypes};
}
export async function captureSnapshot(db,input,outerProof){
 checkInput(input);need(outerProof?.hostname==='crm-staging'&&outerProof.revision===input.revision&&outerProof.databaseVolume==='crm-staging_pgdata','CAPTURE_PHYSICAL_PROOF_REQUIRED');
 phase('TX');
 return db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  phase('IDENTITY');const identities=await tx.$queryRawUnsafe("SELECT current_database()::text name,current_schema()::text schema,current_setting('transaction_read_only')::text readonly,NOT pg_is_in_recovery() AS \"primary\"");
  need(identities.length===1&&identities[0].name==='crm'&&identities[0].schema==='public'&&identities[0].readonly==='on'&&identities[0].primary===true,'READONLY_PRIMARY_REQUIRED');
  phase('TABLE_NAMES');const rows=await tx.$queryRawUnsafe("SELECT tablename::text name FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  const tableNames=rows.map(row=>row.name);need(tableNames.length>0&&tableNames.length<150&&new Set(tableNames).size===tableNames.length&&REQUIRED.every(name=>tableNames.includes(name)),'PUBLIC_TABLE_SET_INVALID');
  const tables={};for(const name of tableNames)tables[name]=await fp(tx,'SELECT to_jsonb(t) doc FROM '+quote(name)+' t');
  const files=await fp(tx,fileTupleSql(input.mode),[],'FILE_TUPLES'),schema=await schemaFacts(tx);
  const preservedLedger=await fp(tx,'SELECT to_jsonb(t) doc FROM "_prisma_migrations" t WHERE t.migration_name<>$1',[MIGRATION.name],'LEDGER_PRESERVED');
  phase('LEDGER_NEW');const migration=await tx.$queryRawUnsafe('SELECT migration_name::text name,checksum::text checksum,to_char(started_at AT TIME ZONE \'UTC\',\''+ISO+'\') "startedAt",to_char(finished_at AT TIME ZONE \'UTC\',\''+ISO+'\') "finishedAt",to_char(rolled_back_at AT TIME ZONE \'UTC\',\''+ISO+'\') "rolledBackAt",applied_steps_count::int "appliedStepsCount",(logs IS NULL) "logsNull",'+hashSql('to_jsonb(t)')+' "fullHash" FROM "_prisma_migrations" t WHERE migration_name=$1 ORDER BY id',MIGRATION.name);
  const otherOrg=await fp(tx,'SELECT to_jsonb(t) doc FROM "OrgSetting" t WHERE t.key<>$1',['telegram.botUsername'],'BOT_OTHER');
  phase('BOT_CLOCK');const bot=await tx.$queryRawUnsafe('SELECT '+hashSql('to_jsonb(t.value)')+' "valueHash",'+hashSql("to_jsonb(t)-'updatedAt'")+' "stableHash",to_char(t."updatedAt",\''+ISO+'\') "updatedAt" FROM "OrgSetting" t WHERE t.key=$1','telegram.botUsername');need(bot.length<=1,'BOT_SINGLETON_REQUIRED');
  phase('CLOCK');const clocks=await tx.$queryRawUnsafe("SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','"+ISO+"') at");need(clocks.length===1,'CLOCK_REQUIRED');
  return {version:1,mode:input.mode,runId:input.runId,revision:input.revision,capturedAt:clocks[0].at,identity:identities[0],tableNames,tables,files,preservedLedger,migration,schema,orgSetting:{other:otherOrg,bot:bot[0]??null}};
 },{isolationLevel:'RepeatableRead',maxWait:10000,timeout:120000});
}
function enumMap(schema){const map={};for(const row of schema.enums){exact(row,['name','label'],'ENUM_FIELDS_INVALID');need(['FileCategory','FileStage','FileSection'].includes(row.name)&&typeof row.label==='string','ENUM_NAME_INVALID');(map[row.name]??=[]).push(row.label);}return map;}
function checkSchema(snapshot){
 const schema=snapshot.schema,mode=snapshot.mode;
 exact(schema,['stable','columns','enums','enumTypes','indexes','arrayTypes'],'SCHEMA_FIELDS_INVALID');exact(schema.stable,SCHEMA_KEYS,'SCHEMA_FINGERPRINT_SET_INVALID');Object.values(schema.stable).forEach(fingerprintShape);
 const names=[...BUSINESS_COLUMNS,...(mode==='before'?['category','caption','stage']:['section'])].sort();
 need(Array.isArray(schema.columns)&&schema.columns.length===names.length,'FILE_COLUMN_COUNT_INVALID');same(schema.columns.map(column=>column.name).sort(),names,'FILE_COLUMNS_UNEXPECTED');
 for(const column of schema.columns){exact(column,['name','ordinal','udtSchema','type','nullable','defaultValue','hash','enumShapeHash'],'COLUMN_FIELDS_INVALID');need(Number.isInteger(column.ordinal)&&column.ordinal>0&&['public','pg_catalog'].includes(column.udtSchema),'COLUMN_SCHEMA_INVALID');need(typeof column.type==='string'&&['YES','NO'].includes(column.nullable)&&SHA.test(column.hash??'')&&SHA.test(column.enumShapeHash??''),'COLUMN_METADATA_INVALID');}
 const target=Object.fromEntries(schema.columns.map(column=>[column.name,column]));
 const defaultMatches=(column,label,type)=>new RegExp("^'"+label+"'::(?:(?:public|\"public\")\\.)?\""+type+"\"$").test(column.defaultValue??'');
 if(mode==='before'){
  need(target.category.type==='FileCategory'&&target.category.udtSchema==='public'&&target.category.nullable==='NO'&&defaultMatches(target.category,'OTHER','FileCategory'),'CATEGORY_COLUMN_INVALID');
  need(target.stage.type==='FileStage'&&target.stage.udtSchema==='public'&&target.stage.nullable==='NO'&&defaultMatches(target.stage,'PRODUCTION','FileStage'),'STAGE_COLUMN_INVALID');
  need(target.caption.type==='text'&&target.caption.udtSchema==='pg_catalog'&&target.caption.nullable==='YES'&&target.caption.defaultValue===null,'CAPTION_COLUMN_INVALID');
  same(enumMap(schema),OLD_ENUMS,'BEFORE_FILE_ENUMS_INVALID');same(schema.enumTypes.map(row=>row.name).sort(),['FileCategory','FileStage'],'BEFORE_ENUM_TYPES_INVALID');
  same(schema.indexes.map(row=>row.name).sort(),OLD_INDEXES,'BEFORE_FILE_INDEXES_INVALID');
 }else{
  need(target.section.type==='FileSection'&&target.section.udtSchema==='public'&&target.section.nullable==='NO'&&defaultMatches(target.section,'GENERAL','FileSection'),'SECTION_COLUMN_INVALID');
  same(enumMap(schema),{FileSection:SECTION_LABELS},'AFTER_FILE_ENUMS_INVALID');same(schema.enumTypes.map(row=>row.name),['FileSection'],'AFTER_ENUM_TYPES_INVALID');
  same(schema.indexes.map(row=>row.name),[NEW_INDEX],'AFTER_FILE_INDEXES_INVALID');
 }
 for(const row of schema.enumTypes){exact(row,['name','kind','hash'],'ENUM_TYPE_FIELDS_INVALID');need(row.kind==='e'&&SHA.test(row.hash??''),'ENUM_TYPE_HASH_INVALID');}
 const expectedArrays=mode==='before'?['_FileCategory','_FileStage']:['_FileSection'];same(schema.arrayTypes.map(row=>row.name),expectedArrays,'FILE_ARRAY_TYPE_SET_INVALID');
 for(const row of schema.arrayTypes){exact(row,['name','kind','category','element','hash'],'ARRAY_TYPE_FIELDS_INVALID');need(row.kind==='b'&&row.category==='A'&&row.element===row.name.slice(1)&&SHA.test(row.hash??''),'ARRAY_TYPE_SHAPE_INVALID');}
 for(const row of schema.indexes){exact(row,['name','shapeOK'],'INDEX_FIELDS_INVALID');need(row.shapeOK===true,'FILE_INDEX_SHAPE_INVALID');}
}
function shape(snapshot,input){
 checkInput(input);exact(snapshot,['version','mode','runId','revision','capturedAt','identity','tableNames','tables','files','preservedLedger','migration','schema','orgSetting'],'SNAPSHOT_FIELDS_INVALID');
 need(snapshot.version===1&&snapshot.mode===input.mode&&snapshot.runId===input.runId&&snapshot.revision===input.revision&&validTime(snapshot.capturedAt),'SNAPSHOT_BINDING_INVALID');
 exact(snapshot.identity,['name','schema','readonly','primary'],'IDENTITY_FIELDS_INVALID');same(snapshot.identity,{name:'crm',schema:'public',readonly:'on',primary:true},'SNAPSHOT_IDENTITY_INVALID');
 need(Array.isArray(snapshot.tableNames)&&snapshot.tableNames.length<150&&new Set(snapshot.tableNames).size===snapshot.tableNames.length&&REQUIRED.every(name=>snapshot.tableNames.includes(name)),'SNAPSHOT_TABLE_SET_INVALID');snapshot.tableNames.forEach(quote);
 same(Object.keys(snapshot.tables).sort(),[...snapshot.tableNames].sort(),'TABLE_FINGERPRINT_SET_INVALID');Object.values(snapshot.tables).forEach(fingerprintShape);fingerprintShape(snapshot.files);fingerprintShape(snapshot.preservedLedger);same(snapshot.files.count,snapshot.tables.File.count,'ALL_FILE_COUNT_INVALID');
 need(Array.isArray(snapshot.migration)&&snapshot.migration.length<=1,'SINGLE_MIGRATION_REQUIRED');
 for(const row of snapshot.migration){exact(row,['name','checksum','startedAt','finishedAt','rolledBackAt','appliedStepsCount','logsNull','fullHash'],'MIGRATION_FIELDS_INVALID');need(row.name===MIGRATION.name&&SHA.test(row.checksum??'')&&validTime(row.startedAt)&&(row.finishedAt===null||validTime(row.finishedAt))&&(row.rolledBackAt===null||validTime(row.rolledBackAt))&&Number.isInteger(row.appliedStepsCount)&&typeof row.logsNull==='boolean'&&SHA.test(row.fullHash??''),'MIGRATION_SHAPE_INVALID');}
 exact(snapshot.orgSetting,['other','bot'],'ORG_FIELDS_INVALID');fingerprintShape(snapshot.orgSetting.other);
 const bot=snapshot.orgSetting.bot;if(bot!==null){exact(bot,['valueHash','stableHash','updatedAt'],'BOT_FIELDS_INVALID');need(SHA.test(bot.valueHash??'')&&SHA.test(bot.stableHash??'')&&validTime(bot.updatedAt),'BOT_SHAPE_INVALID');}
 need(BigInt(snapshot.orgSetting.other.count)+(bot===null?0n:1n)===BigInt(snapshot.tables.OrgSetting.count),'ORG_COUNT_COHERENCE_INVALID');checkSchema(snapshot);
}
export function verifyBefore(before,input){
 shape(before,input);need(input.mode==='before'&&before.migration.length===0,'BEFORE_MIGRATION_MUST_BE_ABSENT');same(before.preservedLedger,before.tables._prisma_migrations,'BEFORE_LEDGER_NOT_FILTERED');
 return {fileCount:before.files.count,protectedTableCount:before.tableNames.length,readOnly:true};
}
export function verifyAfter(before,after,input){
 checkInput(input,true);const core={...input};delete core.beforeRevision;
 verifyBefore(before,{...core,mode:'before',revision:input.beforeRevision});shape(after,core);need(input.mode==='after'&&Date.parse(after.capturedAt)>=Date.parse(before.capturedAt),'AFTER_CAPTURE_TIME_INVALID');
 same(after.tableNames,before.tableNames,'PUBLIC_TABLE_SET_CHANGED');same(after.files,before.files,'FILE_ID_SECTION_OR_BUSINESS_CHANGED');same(after.schema.stable,before.schema.stable,'UNKNOWN_SCHEMA_CHANGE');
 const columns=mode=>Object.fromEntries(mode.schema.columns.filter(row=>BUSINESS_COLUMNS.includes(row.name)).map(row=>[row.name,row]));
 same(columns(after),columns(before),'FILE_BUSINESS_COLUMN_METADATA_CHANGED');
 const lastOldOrdinal=Math.max(...before.schema.columns.map(row=>row.ordinal));need(after.schema.columns.find(row=>row.name==='section').ordinal===lastOldOrdinal+1,'SECTION_ORDINAL_INVALID');
 need(before.schema.enumTypes.every(row=>row.hash===after.schema.enumTypes[0].hash),'NEW_ENUM_METADATA_CHANGED');
 need(before.schema.arrayTypes.every(row=>row.hash===after.schema.arrayTypes[0].hash),'NEW_ENUM_ARRAY_METADATA_CHANGED');
 const sectionShape=after.schema.columns.find(row=>row.name==='section').enumShapeHash;need(before.schema.columns.filter(row=>['category','stage'].includes(row.name)).every(row=>row.enumShapeHash===sectionShape),'SECTION_ATTRIBUTES_CHANGED');
 need(after.migration.length===1,'EXACT_ONE_MIGRATION_REQUIRED');
 const ledger=after.migration[0];need(ledger.checksum===MIGRATION.checksum&&ledger.rolledBackAt===null&&ledger.logsNull===true&&ledger.appliedStepsCount===1&&validTime(ledger.finishedAt)&&Date.parse(ledger.startedAt)>=Date.parse(before.capturedAt)&&Date.parse(ledger.finishedAt)>=Date.parse(ledger.startedAt)&&Date.parse(ledger.finishedAt)<=Date.parse(after.capturedAt),'NEW_MIGRATION_LEDGER_INVALID');
 same(after.preservedLedger,before.tables._prisma_migrations,'ORIGINAL_MIGRATION_LEDGER_CHANGED');need(BigInt(after.tables._prisma_migrations.count)===BigInt(before.tables._prisma_migrations.count)+1n,'MIGRATION_LEDGER_COUNT_INVALID');
 same(after.orgSetting.other,before.orgSetting.other,'OTHER_SETTINGS_CHANGED');same(after.tables.OrgSetting.count,before.tables.OrgSetting.count,'SETTING_COUNT_CHANGED');
 const oldBot=before.orgSetting.bot,newBot=after.orgSetting.bot;let operationalClockChanged=false;
 if(oldBot===null||newBot===null)same(oldBot,newBot,'BOT_ADDED_REMOVED');
 else{
  need(oldBot.valueHash===newBot.valueHash&&oldBot.stableHash===newBot.stableHash,'BOT_VALUE_OR_STABLE_FIELDS_CHANGED');
  need(Date.parse(newBot.updatedAt)>=Date.parse(oldBot.updatedAt),'BOT_CLOCK_REGRESSION');operationalClockChanged=newBot.updatedAt!==oldBot.updatedAt;
  if(operationalClockChanged)need(Date.parse(newBot.updatedAt)>=Date.parse(before.capturedAt)&&Date.parse(newBot.updatedAt)<=Date.parse(after.capturedAt),'BOT_CLOCK_NOT_FRESH_IN_PROOF_WINDOW');
 }
 if(!operationalClockChanged)same(after.tables.OrgSetting,before.tables.OrgSetting,'UNEXPLAINED_BOT_TABLE_CHANGE');
 for(const name of before.tableNames)if(!['File','_prisma_migrations','OrgSetting'].includes(name))same(after.tables[name],before.tables[name],'PROTECTED_TABLE_CHANGED_'+name);
 return {fileCount:after.files.count,protectedTableCount:after.tableNames.length,originalsPreserved:true,exactSectionsVerified:true,schemaVerified:true,ledgerVerified:true,operationalClockChanged,readOnly:true};
}
export function safeDiagnostic(error,label=currentPhase){
 const out={phase:PHASES.has(label)?label:'INPUT'};
 if(['Error','TypeError','SyntaxError','RangeError','PrismaClientKnownRequestError','PrismaClientUnknownRequestError','PrismaClientInitializationError','PrismaClientValidationError'].includes(error?.name))out.exceptionType=error.name;
 if(/^P[0-9]{4}$/.test(error?.code??''))out.prismaCode=error.code;
 const sqlState=[error?.sqlState,error?.meta?.code,error?.code].find(value=>typeof value==='string'&&/^[0-9A-Z]{5}$/.test(value)&&!/^P[0-9]{4}$/.test(value));if(sqlState)out.sqlState=sqlState;
 return out;
}
export function boundedResponse(snapshot){
 const response={status:'READ_ONLY_CAPTURED',mode:snapshot.mode,runId:snapshot.runId,revision:snapshot.revision,snapshot};
 need(Buffer.byteLength(JSON.stringify(response))<=WIRE_LIMIT,'READONLY_WIRE_LIMIT');return response;
}
export async function main(){
 let db,response;
 try{
  phase('INPUT');const encoded=process.env.CRM_STAGING_BROWSER_INPUT;
  need(typeof encoded==='string'&&encoded.length>0&&encoded.length<=96*1024,'BOUNDED_INPUT_REQUIRED');const bytes=Buffer.from(encoded,'base64');need(bytes.toString('base64')===encoded,'CANONICAL_INPUT_REQUIRED');
  const input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));phase('GUARD');const proof=stageGuard(input);phase('CLIENT');db=new PrismaClient({log:[],errorFormat:'minimal'});
  const snapshot=await captureSnapshot(db,input,proof);phase('VERIFY');shape(snapshot,input);if(input.mode==='before')verifyBefore(snapshot,input);phase('WIRE');response=boundedResponse(snapshot);
 }catch(error){response={status:'STOP',code:error instanceof ProofStop?error.code:'TASK113_READONLY_CAPTURE_STOP',diagnostic:safeDiagnostic(error)};process.exitCode=1;}
 finally{if(db)try{phase('DISCONNECT');await db.$disconnect();}catch(error){response={status:'STOP',code:'TASK113_DISCONNECT_STOP',diagnostic:safeDiagnostic(error)};process.exitCode=1;}}
 console.log(JSON.stringify(response));
}
const entry=process.argv[1];const direct=!entry||path.resolve(entry)===fileURLToPath(import.meta.url);
if(direct&&process.env.CRM_STAGING_BROWSER_INPUT&&process.env.CRM_MODERNIZATION_TARGET==='staging')void main();
