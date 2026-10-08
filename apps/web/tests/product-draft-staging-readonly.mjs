// Task111: root-only staging proof. No DB/HTTP/S3 activity on import.
// SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP on mismatch.
import {createHash} from 'node:crypto';
import {hostname} from 'node:os';
import {existsSync} from 'node:fs';
import {PrismaClient} from '@prisma/client';
import {gzipSync} from 'node:zlib';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{40}$/;
const HASH=/^[a-f0-9]{64}$/;
const NAMES=['20261008111000_product_draft_enum','20261008111100_product_draft_backfill'];
const HISTORY_COMMENT='Перенос изделий ранних проектов в черновики (задача 111)';
const REQUIRED=['Product','Project','ProductStatusHistory','ChangeLog','_prisma_migrations','OrgSetting'];
const CAP=250*1024;
const RAW_CAP=8*1024*1024;
const CORE_SCHEMA=['columns','constraints','indexes','triggers','routines','sequences','relations','otherEnums'];
const EXTRA_SCHEMA=['enumTypes','views','policies','namespace'];
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_:-]{1,160}$/.test(value);
const validTag=value=>typeof value==='string'&&/^[A-Z_]{1,40}$/.test(value);
const validTime=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
function keys(value,allowed,code){stop(value!==null&&typeof value==='object'&&!Array.isArray(value),code);same(Object.keys(value).sort(),[...allowed].sort(),code);}
class ReadonlyCheckError extends Error {
 constructor(checkId){super(checkId);this.checkId=checkId;}
}
const PHASES=new Set(['QUERY_TARGET_FP','QUERY_PROTECTED_PRODUCTS','QUERY_PRESERVED_HISTORY','QUERY_COMPACT_TAGS','ENTRY_INPUT','STAGE_GUARD','CLIENT_SETUP','TX_BEGIN','READONLY_SET','QUERY_IDENTITY','QUERY_TABLES','QUERY_TABLE_FP','QUERY_PRODUCTS','QUERY_PRODUCT_HISTORY','QUERY_MIGRATIONS','QUERY_TRANSITION_HISTORY','QUERY_TRANSITION_AUDIT','QUERY_PRESERVED_AUDIT','QUERY_PRESERVED_LEDGER','QUERY_SCHEMA_COLUMNS','QUERY_SCHEMA_CONSTRAINTS','QUERY_SCHEMA_INDEXES','QUERY_SCHEMA_TRIGGERS','QUERY_SCHEMA_ROUTINES','QUERY_SCHEMA_SEQUENCES','QUERY_SCHEMA_RELATIONS','QUERY_SCHEMA_OTHERENUMS','QUERY_SCHEMA_ENUMTYPES','QUERY_SCHEMA_VIEWS','QUERY_SCHEMA_POLICIES','QUERY_SCHEMA_NAMESPACE','QUERY_STATUS_DEFAULT','QUERY_STATUS_COLUMN','QUERY_STATUS_LABELS','QUERY_ORG_OTHERS','QUERY_ORG_BOT','QUERY_CLOCK','VERIFY_SNAPSHOT','VERIFY_BEFORE','WIRE_SERIALIZE','WIRE_GZIP','WIRE_OUTPUT','EXIT_DISCONNECT']);
const EXCEPTIONS=new Set(['Error','TypeError','SyntaxError','RangeError','PrismaClientKnownRequestError','PrismaClientUnknownRequestError','PrismaClientInitializationError','PrismaClientValidationError','PrismaClientRustPanicError','DatabaseError','PostgresError']);
const PG_TYPES=new Set(['character_data','name','text','varchar','bpchar','uuid','int2','int4','int8','bool','bytea','json','jsonb','timestamp','timestamptz','numeric','float4','float8','oid']);
const PG_COLUMNS=new Set(['id','key','value','column_default','enumlabel','tablename','name','schema','readonly','primary','count','hash','projectId','status','stage','createdAt','updatedAt','statusChangedAt']);
const PG_TABLES=new Set([...REQUIRED,'ApiToken','User','Client','Task','Work','File','Payment','Payout','PayrollEntry','Material','ProjectMaterial','StockMovement','columns','pg_enum','pg_type','pg_class','pg_namespace','pg_constraint','pg_indexes','pg_sequences','pg_views','pg_policies']);
let diagnosticPhase='ENTRY_INPUT';
function phase(label){diagnosticPhase=PHASES.has(label)?label:'UNKNOWN';}
function property(value,key){try{return value&&typeof value==='object'?value[key]:undefined;}catch{return undefined;}}
export function safeDiagnostic(error,currentPhase){
 const out={phase:PHASES.has(currentPhase)?currentPhase:'UNKNOWN'};
 const meta=property(error,'meta'),name=property(error,'name');
 if(EXCEPTIONS.has(name))out.exceptionType=name;
 const directCode=property(error,'code');
 const prismaCode=typeof directCode==='string'&&/^P[0-9]{4}$/.test(directCode)&&name!=='DatabaseError'&&name!=='PostgresError'?directCode:undefined;
 const sqlState=[property(error,'sqlState'),property(meta,'sqlState'),property(meta,'code'),prismaCode?undefined:directCode].find(value=>typeof value==='string'&&/^[0-9A-Z]{5}$/.test(value));
 if(prismaCode)out.prismaCode=prismaCode;
 if(sqlState)out.sqlState=sqlState;
 for(const[key,allowed,candidates]of [
  ['pgType',PG_TYPES,[property(error,'pgType'),property(meta,'pgType'),property(error,'typeName'),property(meta,'typeName')]],
  ['table',PG_TABLES,[property(error,'table'),property(meta,'table'),property(meta,'modelName')]],
  ['column',PG_COLUMNS,[property(error,'column'),property(meta,'column'),property(error,'columnName'),property(meta,'columnName')]],
 ]){
  const value=candidates.find(item=>typeof item==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(item)&&allowed.has(item));
  if(value)out[key]=value;
 }
 const oid=[property(error,'oid'),property(meta,'oid')].find(value=>(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=4294967295)||(typeof value==='string'&&/^(?:0|[1-9][0-9]{0,9})$/.test(value)&&Number(value)<=4294967295));
 if(oid!==undefined)out.oid=Number(oid);
 // Только известный технический шаблон; ни один произвольный фрагмент message не выдаётся.
 const pattern=/^Failed to deserialize column of type '(character_data|name)'\.(?: If you're using (?:\x60)?\$queryRaw(?:\x60)? and this column is explicitly marked as \x60Unsupported\x60 in your Prisma schema, try casting this column to any supported Prisma type such as \x60String\x60\.)?$/;
 for(const message of [property(meta,'message'),property(error,'message')]){
  if(typeof message!=='string'||message.length>700)continue;
  const matched=pattern.exec(message);
  if(matched&&!out.pgType)out.pgType=matched[1];
 }
 return out;
}
export function diagnosticStop(error,currentPhase){
 const diagnostic=safeDiagnostic(error,currentPhase);
 const base=error instanceof ReadonlyCheckError&&/^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(error.checkId)?error.checkId.toUpperCase():'TASK111_READONLY_CAPTURE_STOP';
 const token=[diagnostic.phase,diagnostic.prismaCode,diagnostic.sqlState,diagnostic.pgType].filter(Boolean).join('_').toUpperCase();
 return {status:'STOP',code:(base+'_'+token).slice(0,100),diagnostic};
}
function emitDiagnostic(diagnostic){console.error(JSON.stringify({kind:'TASK111_READONLY_DIAGNOSTIC',...diagnostic}));}
const stop=(ok,code)=>{if(!ok)throw new ReadonlyCheckError(code);};
export function canonical(value){
 const normalized=JSON.parse(JSON.stringify(value));
 const stable=item=>Array.isArray(item)?'['+item.map(stable).join(',')+']':item!==null&&typeof item==='object'?'{'+Object.keys(item).sort().map(key=>JSON.stringify(key)+':'+stable(item[key])).join(',')+'}':JSON.stringify(item);
 return stable(normalized);
}
export const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const same=(a,b,code)=>stop(canonical(a)===canonical(b),code);
function migrationsInput(input,local=false){
 const allowed=['operation','mode','authorized','revision','runId','expectedMigrations'];
 if(local&&Object.hasOwn(input??{},'beforeRevision'))allowed.push('beforeRevision');
 keys(input,allowed,'INPUT_FIELDS_INVALID');
 stop(input.operation==='inspect','INSPECT_OPERATION_REQUIRED');
 stop(input&&input.authorized===true&&UUID.test(input.runId??'')&&SHA.test(input.revision??''),'AUTHORIZED_RUN_REVISION_REQUIRED');
 stop(['before','after'].includes(input.mode)&&(!input.operation||input.operation==='inspect'),'CAPTURE_MODE_REQUIRED');
 stop(Array.isArray(input.expectedMigrations)&&input.expectedMigrations.length===2,'EXACT_MIGRATIONS_REQUIRED');
 const rows=input.expectedMigrations;
 for(const row of rows)keys(row,['name','checksum'],'MIGRATION_INPUT_FIELDS_INVALID');
 stop(rows.every(row=>row&&NAMES.includes(row.name)&&HASH.test(row.checksum??''))&&new Set(rows.map(row=>row.name)).size===2,'MIGRATION_NAMES_CHECKSUMS_REQUIRED');
 return Object.fromEntries(rows.map(row=>[row.name,row.checksum]));
}
export function stageGuard(input,env=process.env,container={host:hostname(),docker:existsSync('/.dockerenv')}){
 migrationsInput(input);
 stop(env.CRM_MODERNIZATION_TARGET==='staging'&&container.docker,'STAGING_ONLY_REQUIRED');
 let url,endpoint,proof;
 try{url=new URL(env.DATABASE_URL??'');endpoint=new URL(env.S3_ENDPOINT??'');proof=JSON.parse(env.CRM_MODERNIZATION_STAGE_PROOF??'');}catch{throw new ReadonlyCheckError('STAGING_ENV_INVALID');}
 stop(['postgres:','postgresql:'].includes(url.protocol)&&url.hostname==='db'&&(url.port||'5432')==='5432'&&url.pathname==='/crm'&&!url.hash,'STAGING_DATABASE_MISMATCH');
 const options=new Set(['schema','connection_limit','pool_timeout','connect_timeout','socket_timeout','sslmode']);
 stop([...url.searchParams.keys()].every(key=>options.has(key)&&url.searchParams.getAll(key).length===1)&&(!url.searchParams.has('schema')||url.searchParams.get('schema')==='public'),'DATABASE_OPTIONS_MISMATCH');
 stop(env.CRM_FILE_STORAGE==='s3'&&env.S3_BUCKET==='pero-crm-staging'&&endpoint.protocol==='http:'&&endpoint.hostname==='192.168.0.33'&&endpoint.port==='9000'&&!endpoint.username&&!endpoint.password&&!endpoint.search&&!endpoint.hash,'STAGING_STORAGE_MISMATCH');
 stop(proof&&proof.hostname==='crm-staging'&&proof.revision===input.revision&&proof.databaseVolume==='crm-staging_pgdata'&&HASH.test(proof.outerW07Sha256??'')&&HASH.test(proof.web??'')&&/^[a-f0-9]{12,64}$/.test(container.host??'')&&proof.web.startsWith(container.host)&&HASH.test(proof.database??''),'VERIFIED_OUTER_PROOF_REQUIRED');
 const secret=env.AUTH_SECRET??env.NEXTAUTH_SECRET;
 stop(typeof secret==='string'&&secret.length>0&&env.S3_ACCESS_KEY&&env.S3_SECRET_KEY,'PRIVATE_RUNTIME_CREDENTIALS_REQUIRED');
 return {proof};
}
function quote(value){stop(/^[A-Za-z_][A-Za-z0-9_]*$/.test(value),'TABLE_IDENTIFIER_INVALID');return '"'+value+'"';}
const sqlHash=alias=>"encode(sha256(convert_to(to_jsonb("+alias+")::text,'UTF8')),'hex')";
const sqlDocumentHash=doc=>"encode(sha256(convert_to(("+doc+")::text,'UTF8')),'hex')";
async function fingerprint(tx,query,values=[],label='QUERY_TABLE_FP'){
 phase(label);
 const rows=await tx.$queryRawUnsafe("SELECT count(*)::text count,encode(sha256(convert_to(COALESCE(string_agg(h,'' ORDER BY h),''),'UTF8')),'hex') hash FROM (SELECT "+sqlHash('r')+" h FROM ("+query+") r) hashes",...values);
 stop(rows.length===1&&/^\d+$/.test(rows[0].count??'')&&HASH.test(rows[0].hash??''),'FINGERPRINT_INVALID');return rows[0];
}
function fp(row){return row&&Object.keys(row).sort().join('|')==='count|hash'&&typeof row.count==='string'&&/^\d+$/.test(row.count)&&HASH.test(row.hash??'');}
const isoSql=column=>"to_char("+column+" AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')";
function ledgerValid(row,expected){return row&&NAMES.includes(row.name)&&row.checksum===expected[row.name]&&row.rolledBackAt===null&&row.logsNull===true&&row.appliedStepsCount===1&&typeof row.startedAt==='string'&&typeof row.finishedAt==='string'&&Number.isFinite(Date.parse(row.startedAt))&&Number.isFinite(Date.parse(row.finishedAt))&&Date.parse(row.finishedAt)>=Date.parse(row.startedAt);}
async function readSchema(tx){
 const queries={
  columns:"SELECT CASE WHEN c.table_name='Product' AND c.column_name='status' THEN to_jsonb(c)-'column_default' ELSE to_jsonb(c) END doc FROM (SELECT table_name,column_name,ordinal_position,column_default,is_nullable,data_type,udt_schema,udt_name,character_maximum_length,numeric_precision,numeric_scale,datetime_precision,collation_name,is_identity,identity_generation,is_generated,generation_expression FROM information_schema.columns WHERE table_schema='public') c",
  constraints:"SELECT t.relname table_name,c.conname,c.contype,c.condeferrable,c.condeferred,c.convalidated,pg_get_constraintdef(c.oid,true) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public'",
  indexes:"SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public'",
  triggers:"SELECT c.relname,t.tgname,t.tgenabled,t.tgisinternal,pg_get_triggerdef(t.oid,true) definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'",
  routines:"SELECT p.proname,pg_get_function_identity_arguments(p.oid) arguments,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p')",
  sequences:"SELECT * FROM pg_sequences WHERE schemaname='public'",
  relations:"SELECT c.relname,c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity,c.reloptions,c.relacl,pg_get_userbyid(c.relowner) owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'",
  otherEnums:"SELECT t.typname,e.enumlabel,e.enumsortorder FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname<>'ProductStatus'",
  enumTypes:"SELECT t.typname,t.typlen,t.typbyval,t.typtype,t.typcategory,t.typdelim,t.typalign,t.typstorage,t.typnotnull,t.typdefault,t.typacl,pg_get_userbyid(t.typowner) owner FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype='e'",
  views:"SELECT viewname,definition FROM pg_views WHERE schemaname='public'",
  policies:"SELECT tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public'",
  namespace:"SELECT nspname,nspacl,pg_get_userbyid(nspowner) owner FROM pg_namespace WHERE nspname='public'",
 };
 const stable={};for(const[name,query]of Object.entries(queries))stable[name]=await fingerprint(tx,query,[],'QUERY_SCHEMA_'+name.toUpperCase());
 phase('QUERY_STATUS_DEFAULT');
 const defaults=await tx.$queryRawUnsafe("SELECT column_default value FROM information_schema.columns WHERE table_schema='public' AND table_name='Product' AND column_name='status'");
 stop(defaults.length===1,'PRODUCT_STATUS_COLUMN_REQUIRED');
 const matched=/^'([A-Z_]+)'::(?:(?:"public"|public)\.)?"ProductStatus"$/.exec(defaults[0].value??'');
 stop(matched,'PRODUCT_STATUS_DEFAULT_INVALID');
 phase('QUERY_STATUS_COLUMN');
 const[column]=await tx.$queryRawUnsafe("SELECT "+sqlDocumentHash("to_jsonb(c)-'column_default'")+" hash FROM (SELECT table_name,column_name,ordinal_position,column_default,is_nullable,data_type,udt_schema,udt_name,character_maximum_length,numeric_precision,numeric_scale,datetime_precision,collation_name,is_identity,identity_generation,is_generated,generation_expression FROM information_schema.columns WHERE table_schema='public' AND table_name='Product' AND column_name='status') c");
 phase('QUERY_STATUS_LABELS');
 const labels=await tx.$queryRawUnsafe("SELECT e.enumlabel value FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='ProductStatus' ORDER BY e.enumsortorder");
 return {stable,productStatus:{default:matched[1],labels:labels.map(row=>row.value),columnHash:column.hash}};
}
async function readOrgSetting(tx,raw){
 const otherRows=await fingerprint(tx,'SELECT t.* FROM "OrgSetting" t WHERE t.key<>$1',['telegram.botUsername'],'QUERY_ORG_OTHERS');
 phase('QUERY_ORG_BOT');
 const rows=await tx.$queryRawUnsafe('SELECT key,'+sqlDocumentHash('to_jsonb(t.value)')+' "valueHash",'+sqlDocumentHash("to_jsonb(t)-'updatedAt'")+' "stableFieldsHash",to_char(t."updatedAt",\'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') "updatedAt" FROM "OrgSetting" t WHERE t.key=$1','telegram.botUsername');
 stop(rows.length<=1,'BOT_SETTING_SINGLETON_REQUIRED');return {count:raw.count,otherRows,bot:rows[0]??null};
}
async function migrationFacts(tx){
 phase('QUERY_MIGRATIONS');
 return tx.$queryRawUnsafe('SELECT id,migration_name name,checksum,'+isoSql('started_at')+' "startedAt",'+isoSql('finished_at')+' "finishedAt",'+isoSql('rolled_back_at')+' "rolledBackAt",applied_steps_count "appliedStepsCount",(logs IS NULL) "logsNull",'+sqlHash('t')+' "fullHash" FROM "_prisma_migrations" t WHERE migration_name=ANY($1::text[]) ORDER BY migration_name,id',NAMES);
}
function beforeTargetsQuery(){
 return 'SELECT p.id,p.status::text AS "oldStatus",'+sqlDocumentHash("to_jsonb(p)-'status'-'statusChangedAt'")+' AS "canonicalBusinessHash" FROM "Product" p JOIN "Project" j ON j.id=p."projectId" WHERE j.stage::text IN (\'LEAD\',\'ESTIMATE\') AND p.status::text<>\'DRAFT\'';
}
function validPairsQuery(){
 // Только точная пара из reviewed SQL111; неизвестные prefix rows НЕ исключаются.
 return `WITH valid_pairs AS (
  SELECT p.id AS "productId",h.id AS "historyId",a.id AS "auditId",h."fromStatus"::text AS "oldStatus",
    ${sqlDocumentHash("to_jsonb(p)-'status'-'statusChangedAt'")} AS "canonicalBusinessHash"
  FROM "Product" p JOIN "Project" j ON j.id=p."projectId"
  JOIN "ProductStatusHistory" h ON h.id='migration111-history-'||p.id AND h."productId"=p.id
  JOIN "ChangeLog" a ON a.id='migration111-audit-'||p.id AND a."entityId"=p.id
  WHERE j.stage::text IN ('LEAD','ESTIMATE') AND p.status::text='DRAFT'
    AND h."fromStatus" IS NOT NULL AND h."fromStatus"::text<>'DRAFT'
    AND h."toStatus"::text='DRAFT' AND h."changedById" IS NULL AND h.comment=$1
    AND a."actorType"='system' AND a."actorId"='migration111' AND a."actorName"='Миграция черновиков'
    AND a.entity='product' AND a.action='status' AND a.field='status' AND a.source='migration'
    AND jsonb_typeof(a."oldValue")='string' AND a."oldValue"=to_jsonb(h."fromStatus"::text)
    AND a."newValue"=to_jsonb('DRAFT'::text)
    AND h."createdAt"=a."createdAt" AND h."createdAt"=p."statusChangedAt"
    AND EXISTS(SELECT 1 FROM "_prisma_migrations" m
      WHERE m.migration_name=$2 AND m.checksum=$3 AND m.finished_at IS NOT NULL
        AND m.rolled_back_at IS NULL AND m.applied_steps_count=1 AND m.logs IS NULL
        AND (h."createdAt" AT TIME ZONE 'UTC') BETWEEN m.started_at AND m.finished_at)
 ) `;
}
async function compactProof(tx,input,expected,tables){
 const pairs=validPairsQuery(),params=[HISTORY_COMMENT,NAMES[1],expected[NAMES[1]]];
 let targets,protectedProducts,preservedHistory,preservedAudit;
 if(input.mode==='before'){
  targets=await fingerprint(tx,beforeTargetsQuery(),[],'QUERY_TARGET_FP');
  protectedProducts=await fingerprint(tx,'SELECT p.* FROM "Product" p WHERE NOT EXISTS(SELECT 1 FROM "Project" j WHERE j.id=p."projectId" AND j.stage::text IN (\'LEAD\',\'ESTIMATE\') AND p.status::text<>\'DRAFT\')',[],'QUERY_PROTECTED_PRODUCTS');
  preservedHistory=tables.ProductStatusHistory;preservedAudit=tables.ChangeLog;
 }else{
  targets=await fingerprint(tx,pairs+'SELECT "productId" AS id,"oldStatus","canonicalBusinessHash" FROM valid_pairs',params,'QUERY_TARGET_FP');
  protectedProducts=await fingerprint(tx,pairs+'SELECT p.* FROM "Product" p WHERE NOT EXISTS(SELECT 1 FROM valid_pairs v WHERE v."productId"=p.id)',params,'QUERY_PROTECTED_PRODUCTS');
  preservedHistory=await fingerprint(tx,pairs+'SELECT h.* FROM "ProductStatusHistory" h WHERE NOT EXISTS(SELECT 1 FROM valid_pairs v WHERE v."historyId"=h.id)',params,'QUERY_PRESERVED_HISTORY');
  preservedAudit=await fingerprint(tx,pairs+'SELECT a.* FROM "ChangeLog" a WHERE NOT EXISTS(SELECT 1 FROM valid_pairs v WHERE v."auditId"=a.id)',params,'QUERY_PRESERVED_AUDIT');
 }
 phase('QUERY_COMPACT_TAGS');
 const[tags]=await tx.$queryRawUnsafe(pairs+`SELECT
  (SELECT count(*)::text FROM "ProductStatusHistory" h WHERE h.id LIKE 'migration111-history-%') AS "historyCount",
  (SELECT count(*)::text FROM "ChangeLog" a WHERE a.id LIKE 'migration111-audit-%') AS "auditCount",
  (SELECT count(*)::text FROM valid_pairs) AS "pairCount",
  (SELECT count(*)::text FROM "ProductStatusHistory" h WHERE h.id LIKE 'migration111-history-%'
    AND NOT EXISTS(SELECT 1 FROM valid_pairs v WHERE v."historyId"=h.id)) AS "invalidHistoryCount",
  (SELECT count(*)::text FROM "ChangeLog" a WHERE a.id LIKE 'migration111-audit-%'
    AND NOT EXISTS(SELECT 1 FROM valid_pairs v WHERE v."auditId"=a.id)) AS "invalidAuditCount",
  (SELECT count(*)::text FROM (
    SELECT h."productId" id FROM "ProductStatusHistory" h WHERE h.id LIKE 'migration111-history-%'
    UNION SELECT a."entityId" id FROM "ChangeLog" a WHERE a.id LIKE 'migration111-audit-%'
   ) tagged WHERE NOT EXISTS(SELECT 1 FROM valid_pairs v WHERE v."productId"=tagged.id)) AS "invalidPairCount",
  (SELECT count(*)::text FROM "Product" p JOIN "Project" j ON j.id=p."projectId"
    WHERE j.stage::text IN ('LEAD','ESTIMATE') AND p.status::text<>'DRAFT') AS "earlyNonDraftCount"`,...params);
 return {targets,protectedProducts,preservedHistory,preservedAudit,tags};
}
export async function captureSnapshot(db,input,proof){
 const expected=migrationsInput(input);
 stop(proof&&proof.hostname==='crm-staging'&&proof.revision===input.revision&&proof.databaseVolume==='crm-staging_pgdata'&&HASH.test(proof.web??'')&&HASH.test(proof.database??'')&&HASH.test(proof.outerW07Sha256??''),'CAPTURE_OUTER_PROOF_REQUIRED');
 phase('TX_BEGIN');
 return db.$transaction(async tx=>{
  phase('READONLY_SET');await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  phase('QUERY_IDENTITY');
  const[row]=await tx.$queryRawUnsafe("SELECT current_database() name,current_schema() schema,current_setting('transaction_read_only') readonly,NOT pg_is_in_recovery() AS \"primary\"");
  stop(row?.name==='crm'&&row.schema==='public'&&row.readonly==='on'&&row.primary===true,'READ_ONLY_PRIMARY_DATABASE_REQUIRED');
  phase('QUERY_TABLES');
  const names=await tx.$queryRawUnsafe("SELECT tablename name FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  const tableNames=names.map(value=>value.name);
  stop(tableNames.length>0&&tableNames.length<150&&tableNames.every(name=>/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))&&REQUIRED.every(name=>tableNames.includes(name)),'PUBLIC_TABLE_SET_INVALID');
  const tables={};for(const table of tableNames)tables[table]=await fingerprint(tx,'SELECT t.* FROM '+quote(table)+' t');
  const migrations=await migrationFacts(tx),compact=await compactProof(tx,input,expected,tables);
  // Только фиксированные 2 ledger rows; никакой массив ID оригинальных данных.
  const allowedLedger=input.mode==='after'?migrations.filter(value=>ledgerValid(value,expected)).map(value=>value.id):[];
  const preserved={
   ProductStatusHistory:compact.preservedHistory,ChangeLog:compact.preservedAudit,
   _prisma_migrations:await fingerprint(tx,'SELECT t.* FROM "_prisma_migrations" t WHERE NOT(t.id=ANY($1::text[]))',[allowedLedger],'QUERY_PRESERVED_LEDGER'),
  };
  const schema=await readSchema(tx),orgSetting=await readOrgSetting(tx,tables.OrgSetting);
  phase('QUERY_CLOCK');
  const[clock]=await tx.$queryRawUnsafe("SELECT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') at");
  return {version:2,mode:input.mode,runId:input.runId,revision:input.revision,capturedAt:clock.at,identity:row,tableNames,tables,targets:compact.targets,protectedProducts:compact.protectedProducts,preserved,tags:compact.tags,migrations,schema,orgSetting};
 },{isolationLevel:'RepeatableRead',maxWait:10000,timeout:120000});
}
function shape(snapshot,input,mode,revision){
 migrationsInput({...input,mode},true);
 keys(snapshot,['version','mode','runId','revision','capturedAt','identity','tableNames','tables','targets','protectedProducts','preserved','tags','migrations','schema','orgSetting'],'SNAPSHOT_FIELDS_INVALID');
 keys(snapshot.identity,['name','schema','readonly','primary'],'SNAPSHOT_IDENTITY_FIELDS_INVALID');
 stop(validTime(snapshot.capturedAt),'CAPTURE_TIME_INVALID');
 keys(snapshot.preserved,['ProductStatusHistory','ChangeLog','_prisma_migrations'],'PRESERVED_FIELDS_INVALID');
 stop(snapshot.version===2&&snapshot.mode===mode&&snapshot.runId===input.runId&&snapshot.revision===revision,'SNAPSHOT_RUN_REVISION_MISMATCH');
 stop(snapshot.identity.name==='crm'&&snapshot.identity.schema==='public'&&snapshot.identity.readonly==='on'&&snapshot.identity.primary===true,'SNAPSHOT_IDENTITY_MISMATCH');
 stop(Array.isArray(snapshot.tableNames)&&new Set(snapshot.tableNames).size===snapshot.tableNames.length&&snapshot.tableNames.every(name=>/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))&&REQUIRED.every(name=>snapshot.tableNames.includes(name)),'SNAPSHOT_TABLE_SET_INVALID');
 same(Object.keys(snapshot.tables).sort(),[...snapshot.tableNames].sort(),'SNAPSHOT_FINGERPRINT_TABLES_MISMATCH');
 stop(Object.values(snapshot.tables).every(fp)&&Object.values(snapshot.preserved).every(fp)&&fp(snapshot.targets)&&fp(snapshot.protectedProducts),'SNAPSHOT_FINGERPRINT_INVALID');
 keys(snapshot.tags,['historyCount','auditCount','pairCount','invalidHistoryCount','invalidAuditCount','invalidPairCount','earlyNonDraftCount'],'TAG_FIELDS_INVALID');
 stop(Object.values(snapshot.tags).every(value=>typeof value==='string'&&/^(?:0|[1-9][0-9]*)$/.test(value)),'TAG_COUNT_INVALID');
 stop(BigInt(snapshot.targets.count)+BigInt(snapshot.protectedProducts.count)===BigInt(snapshot.tables.Product.count),'PRODUCT_PARTITION_INVALID');
 stop(Array.isArray(snapshot.migrations)&&snapshot.migrations.length<=2,'COMPACT_LEDGER_LIMIT');
 for(const row of snapshot.migrations){
  keys(row,['id','name','checksum','startedAt','finishedAt','rolledBackAt','appliedStepsCount','logsNull','fullHash'],'LEDGER_FIELDS_INVALID');
  stop(validId(row.id)&&NAMES.includes(row.name)&&HASH.test(row.checksum??'')&&validTime(row.startedAt)&&(row.finishedAt===null||validTime(row.finishedAt))&&(row.rolledBackAt===null||validTime(row.rolledBackAt))&&Number.isSafeInteger(row.appliedStepsCount)&&typeof row.logsNull==='boolean'&&HASH.test(row.fullHash??''),'LEDGER_PROOF_INVALID');
 }
 keys(snapshot.schema,['stable','productStatus'],'SCHEMA_FIELDS_INVALID');
 keys(snapshot.schema.productStatus,['default','labels','columnHash'],'STATUS_SCHEMA_FIELDS_INVALID');
 stop(snapshot.schema.stable&&CORE_SCHEMA.every(name=>Object.hasOwn(snapshot.schema.stable,name))&&Object.keys(snapshot.schema.stable).every(name=>[...CORE_SCHEMA,...EXTRA_SCHEMA].includes(name))&&Object.values(snapshot.schema.stable).every(fp)&&HASH.test(snapshot.schema.productStatus.columnHash??'')&&Array.isArray(snapshot.schema.productStatus.labels)&&validTag(snapshot.schema.productStatus.default),'SCHEMA_PROOF_INVALID');
 const labels=snapshot.schema.productStatus.labels;stop(labels.every(validTag)&&new Set(labels).size===labels.length&&labels.includes('PREPARATION'),'PRODUCT_ENUM_INVALID');
 if(labels.includes('DRAFT'))stop(labels.indexOf('DRAFT')+1===labels.indexOf('PREPARATION'),'DRAFT_ENUM_ORDER_INVALID');
 keys(snapshot.orgSetting,['count','otherRows','bot'],'ORGSETTING_FIELDS_INVALID');
 stop(snapshot.orgSetting.count===snapshot.tables.OrgSetting.count&&fp(snapshot.orgSetting.otherRows),'ORGSETTING_PROOF_INVALID');
 const bot=snapshot.orgSetting.bot;
 if(bot){
  keys(bot,['key','valueHash','stableFieldsHash','updatedAt'],'BOT_FIELDS_INVALID');
  stop(bot.key==='telegram.botUsername'&&HASH.test(bot.valueHash??'')&&HASH.test(bot.stableFieldsHash??'')&&validTime(bot.updatedAt),'BOT_CLOCK_PROOF_INVALID');
 }
 stop(bot===null||Boolean(bot),'BOT_NULL_REQUIRED');
 stop(BigInt(snapshot.orgSetting.otherRows.count)+(bot?1n:0n)===BigInt(snapshot.orgSetting.count),'ORGSETTING_COHERENT_COUNT_INVALID');
}
export function verifyBefore(before,input){
 shape(before,input,'before',input.revision);
 stop(before.schema.productStatus.default==='PREPARATION','BEFORE_DEFAULT_PREPARATION_REQUIRED');
 stop(before.migrations.length===0,'BEFORE_MIGRATION_ALREADY_PRESENT');
 for(const name of ['historyCount','auditCount','pairCount','invalidHistoryCount','invalidAuditCount','invalidPairCount'])stop(before.tags[name]==='0','BEFORE_MIGRATION_TAGS_PRESENT');
 stop(before.tags.earlyNonDraftCount===before.targets.count,'BEFORE_TARGET_COUNT_INVALID');
 same(before.preserved.ProductStatusHistory,before.tables.ProductStatusHistory,'BEFORE_HISTORY_FILTER_FORBIDDEN');
 same(before.preserved.ChangeLog,before.tables.ChangeLog,'BEFORE_AUDIT_FILTER_FORBIDDEN');
 same(before.preserved._prisma_migrations,before.tables._prisma_migrations,'BEFORE_LEDGER_FILTER_FORBIDDEN');
 return {targetCount:before.targets.count};
}
export function verifyAfter(before,after,input){
 stop(SHA.test(input.beforeRevision??''),'BEFORE_REVISION_REQUIRED');
 const{targetCount}=verifyBefore(before,{...input,mode:'before',revision:input.beforeRevision});
 shape(after,input,'after',input.revision);
 same(after.tableNames,before.tableNames,'PUBLIC_TABLE_SET_CHANGED');
 same(after.schema.stable,before.schema.stable,'SCHEMA_OTHER_THAN_APPROVED_CHANGE_CHANGED');
 same(after.schema.productStatus.columnHash,before.schema.productStatus.columnHash,'STATUS_COLUMN_METADATA_CHANGED');
 stop(after.schema.productStatus.default==='DRAFT','AFTER_DEFAULT_DRAFT_REQUIRED');
 const labels=[...before.schema.productStatus.labels];
 if(!labels.includes('DRAFT'))labels.splice(labels.indexOf('PREPARATION'),0,'DRAFT');
 same(after.schema.productStatus.labels,labels,'PRODUCT_ENUM_CHANGE_INVALID');
 same(after.targets,before.targets,'EXACT_TARGET_TUPLES_CHANGED');
 same(after.protectedProducts,before.protectedProducts,'PROTECTED_PRODUCT_ROWS_CHANGED');
 for(const name of ['historyCount','auditCount','pairCount'])stop(after.tags[name]===targetCount,'EXACT_MIGRATION_PAIR_COUNT_REQUIRED');
 for(const name of ['invalidHistoryCount','invalidAuditCount','invalidPairCount'])stop(after.tags[name]==='0','MIGRATION_PAIR_SHAPE_TIME_INVALID');
 stop(after.tags.earlyNonDraftCount==='0','EARLY_NONDRAFT_REMAINING');
 same(after.preserved.ProductStatusHistory,before.tables.ProductStatusHistory,'ORIGINAL_HISTORY_CHANGED');
 same(after.preserved.ChangeLog,before.tables.ChangeLog,'ORIGINAL_AUDIT_CHANGED');
 same(after.preserved._prisma_migrations,before.tables._prisma_migrations,'ORIGINAL_LEDGER_CHANGED');
 stop(BigInt(after.tables.ProductStatusHistory.count)===BigInt(before.tables.ProductStatusHistory.count)+BigInt(targetCount)&&BigInt(after.tables.ChangeLog.count)===BigInt(before.tables.ChangeLog.count)+BigInt(targetCount)&&BigInt(after.tables._prisma_migrations.count)===BigInt(before.tables._prisma_migrations.count)+2n,'HISTORY_AUDIT_LEDGER_COUNT_INVALID');
 const expected=migrationsInput(input,true);
 stop(after.migrations.length===2&&new Set(after.migrations.map(row=>row.name)).size===2&&after.migrations.every(row=>ledgerValid(row,expected)&&HASH.test(row.fullHash??'')),'APPLIED_MIGRATION_LEDGER_INVALID');
 const beforeOrg=before.orgSetting,afterOrg=after.orgSetting;
 stop(beforeOrg.count===afterOrg.count,'ORGSETTING_COUNT_CHANGED');same(beforeOrg.otherRows,afterOrg.otherRows,'OTHER_ORGSETTINGS_CHANGED');
 let operationalClockChanged=false;
 if(!beforeOrg.bot||!afterOrg.bot)stop(beforeOrg.bot===afterOrg.bot,'BOT_SETTING_ADDED_REMOVED');
 else{
  stop(beforeOrg.bot.key===afterOrg.bot.key&&beforeOrg.bot.valueHash===afterOrg.bot.valueHash&&beforeOrg.bot.stableFieldsHash===afterOrg.bot.stableFieldsHash,'BOT_STABLE_FIELDS_CHANGED');
  stop(Date.parse(afterOrg.bot.updatedAt)>=Date.parse(beforeOrg.bot.updatedAt),'BOT_CLOCK_MOVED_BACKWARD');
  operationalClockChanged=afterOrg.bot.updatedAt!==beforeOrg.bot.updatedAt;
 }
 if(!operationalClockChanged)same(after.tables.OrgSetting,before.tables.OrgSetting,'ORGSETTING_UNEXPLAINED_CHANGE');
 for(const table of before.tableNames)if(!['Product','ProductStatusHistory','ChangeLog','_prisma_migrations','OrgSetting'].includes(table))same(after.tables[table],before.tables[table],'ORIGINAL_TABLE_CHANGED_'+table);
 stop(BigInt(targetCount)<=BigInt(Number.MAX_SAFE_INTEGER),'TARGET_COUNT_BOUND');
 return {targetsVerified:Number(targetCount),originalsPreserved:true,schemaVerified:true,operationalClockChanged};
}
export async function main(){
 let db,result;
 try{
  phase('ENTRY_INPUT');
  const encoded=process.env.CRM_STAGING_BROWSER_INPUT;
  stop(typeof encoded==='string'&&encoded.length>0&&encoded.length<=96*1024,'BOUNDED_INPUT_REQUIRED');
  const bytes=Buffer.from(encoded,'base64');stop(bytes.toString('base64')===encoded,'CANONICAL_INPUT_REQUIRED');
  const input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  phase('STAGE_GUARD');
  const{proof}=stageGuard(input);
  phase('CLIENT_SETUP');
  db=new PrismaClient({log:[],errorFormat:'minimal'});
  const snapshot=await captureSnapshot(db,input,proof);
  phase('VERIFY_SNAPSHOT');
  shape(snapshot,input,input.mode,input.revision);
  if(input.mode==='before'){phase('VERIFY_BEFORE');verifyBefore(snapshot,input);}
  phase('WIRE_SERIALIZE');
  const raw=Buffer.from(JSON.stringify(snapshot),'utf8');
  stop(raw.length<=RAW_CAP,'RAW_SNAPSHOT_LIMIT');
  result={status:'READ_ONLY_CAPTURED',mode:input.mode,runId:input.runId,revision:input.revision,snapshot};
  if(Buffer.byteLength(JSON.stringify(result),'utf8')>240*1024){phase('WIRE_GZIP');result={status:'READ_ONLY_CAPTURED',mode:input.mode,runId:input.runId,revision:input.revision,snapshotEncoding:'gzip-base64',snapshotSha256:createHash('sha256').update(raw).digest('hex'),snapshot:gzipSync(raw).toString('base64')};}
  phase('WIRE_OUTPUT');
  stop(Buffer.byteLength(JSON.stringify(result),'utf8')<=CAP,'COMPACT_OUTPUT_LIMIT');
 }catch(error){result=diagnosticStop(error,diagnosticPhase);emitDiagnostic(result.diagnostic);process.exitCode=1;}
 finally{if(db)try{phase('EXIT_DISCONNECT');await db.$disconnect();}catch(error){const failed=diagnosticStop(error,'EXIT_DISCONNECT');emitDiagnostic(failed.diagnostic);if(result?.status!=='STOP')result=failed;process.exitCode=1;}}
 console.log(JSON.stringify(result));
}
const entry=process.argv[1];
const direct=!entry||import.meta.url===new URL('file:///'+entry.replaceAll('\\','/').replace(/^\//,'')).href;
if(direct&&process.env.CRM_STAGING_BROWSER_INPUT&&process.env.CRM_MODERNIZATION_TARGET==='staging')void main();
