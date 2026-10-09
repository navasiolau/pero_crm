// Задача110: read-only proof миграции; импорт не запускает БД/HTTP/S3.
// SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP при mismatch.
import {createHash} from 'node:crypto';
import {hostname} from 'node:os';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {PrismaClient} from '@prisma/client';
import {captureTokenClockEvidence,validateTokenClockEvidence,compareTokenClockEvidence} from './crm-acceptance-token-clock.mjs';

export const MIGRATION={name:'20261008190000_warehouse_unit_catalog',checksum:'deac962791849c7e24626fb7a8a3b8cc51c466f068707a33506a113c550529f4'};
export const DEFAULT_UNITS=[
 ['warehouse-unit-piece','шт'],['warehouse-unit-square-meter','м²'],['warehouse-unit-linear-meter','м.п.'],['warehouse-unit-sheet','лист'],['warehouse-unit-kilogram','кг'],['warehouse-unit-meter','м'],['warehouse-unit-set','компл'],['warehouse-unit-package','упак'],['warehouse-unit-liter','л'],['warehouse-unit-tenth-sheet','1/10 листа'],
].map(([id,name])=>({id,name}));
const DEFAULT_JSON=JSON.stringify(DEFAULT_UNITS);
const SHA40=/^[a-f0-9]{40}$/,SHA64=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const REQUIRED=['Material','OrgSetting','ApiToken','Payment','PayrollEntry','ProjectMaterial','StockMovement','ChangeLog','_prisma_migrations'];
const SCHEMA_KEYS=['columns','constraints','indexes','triggers','routines','sequences','relations','enums','enumTypes','views','policies','namespace','defaultPrivileges','types'];
const RAW_CAP=8*1024*1024,WIRE_CAP=250*1024;
const PHASES=new Set(['ENTRY_INPUT','STAGE_GUARD','CLIENT_SETUP','TX_BEGIN','READONLY_SET','QUERY_IDENTITY','QUERY_TABLES','QUERY_TABLE_FP','QUERY_MATERIAL','QUERY_CATALOG','QUERY_LEDGER','QUERY_SCHEMA','QUERY_COLUMNS','QUERY_CONSTRAINTS','QUERY_INDEXES','QUERY_TRIGGERS','QUERY_RELATIONS','QUERY_TYPES','QUERY_ORG','QUERY_TOKENS','QUERY_CLOCK','VERIFY_SNAPSHOT','WIRE_OUTPUT','EXIT_DISCONNECT']);
let currentPhase='ENTRY_INPUT';
function phase(name){currentPhase=PHASES.has(name)?name:'UNKNOWN';}
function need(ok,code){if(!ok)throw Error(code);}
export function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';return JSON.stringify(value);}
function same(a,b,code){need(canonical(a)===canonical(b),code);}
function keys(value,list,code){need(value&&typeof value==='object'&&!Array.isArray(value),code);same(Object.keys(value).sort(),[...list].sort(),code);}
const count=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,18})$/.test(value);
const time=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_:-]{1,160}$/.test(value);
function fp(value){keys(value,['count','hash'],'FINGERPRINT_FIELDS_INVALID');need(count(value.count)&&SHA64.test(value.hash??''),'FINGERPRINT_INVALID');}
function inputShape(input,withBefore=false){
 const fields=['operation','mode','authorized','revision','runId','expectedMigrations'];if(withBefore&&Object.hasOwn(input??{},'beforeRevision'))fields.push('beforeRevision');
 keys(input,fields,'INPUT_FIELDS_INVALID');need(input.operation==='inspect'&&input.authorized===true&&['before','after'].includes(input.mode)&&SHA40.test(input.revision??'')&&UUID.test(input.runId??''),'AUTHORIZED_SCOPE_REQUIRED');same(input.expectedMigrations,[MIGRATION],'EXACT_MIGRATION_INPUT_REQUIRED');
 if(Object.hasOwn(input,'beforeRevision'))need(input.mode==='after'&&SHA40.test(input.beforeRevision??'')&&input.beforeRevision!==input.revision,'EXACT_BEFORE_REVISION_REQUIRED');
}
export function stageGuard(input,env=process.env,container={host:hostname(),docker:existsSync('/.dockerenv')}){
 inputShape(input);need(env.CRM_MODERNIZATION_TARGET==='staging'&&container.docker,'STAGING_ONLY_REQUIRED');
 let url,storage,proof;try{url=new URL(env.DATABASE_URL??'');storage=new URL(env.S3_ENDPOINT??'');proof=JSON.parse(env.CRM_MODERNIZATION_STAGE_PROOF??'');}catch{throw Error('STAGING_ENV_INVALID');}
 need(['postgres:','postgresql:'].includes(url.protocol)&&url.hostname==='db'&&(url.port||'5432')==='5432'&&url.pathname==='/crm'&&!url.hash,'STAGING_DATABASE_MISMATCH');
 const options=new Set(['schema','connection_limit','pool_timeout','connect_timeout','socket_timeout','sslmode']);need([...url.searchParams.keys()].every(key=>options.has(key)&&url.searchParams.getAll(key).length===1)&&(!url.searchParams.has('schema')||url.searchParams.get('schema')==='public'),'DATABASE_OPTIONS_MISMATCH');
 need(env.CRM_FILE_STORAGE==='s3'&&env.S3_BUCKET==='pero-crm-staging'&&storage.protocol==='http:'&&storage.hostname==='192.168.0.33'&&storage.port==='9000'&&!storage.username&&!storage.password&&!storage.search&&!storage.hash,'STAGING_STORAGE_MISMATCH');
 need(proof?.hostname==='crm-staging'&&proof.revision===input.revision&&proof.databaseVolume==='crm-staging_pgdata'&&SHA64.test(proof.outerW07Sha256??'')&&SHA64.test(proof.database??'')&&SHA64.test(proof.web??'')&&/^[a-f0-9]{12,64}$/.test(container.host??'')&&proof.web.startsWith(container.host),'PHYSICAL_STAGE_PROOF_REQUIRED');
 need((env.AUTH_SECRET??env.NEXTAUTH_SECRET)&&env.S3_ACCESS_KEY&&env.S3_SECRET_KEY,'PRIVATE_RUNTIME_CREDENTIALS_REQUIRED');return {proof};
}
function property(value,key){try{return value&&typeof value==='object'?value[key]:undefined;}catch{return undefined;}}
export function diagnosticStop(error,at=currentPhase){
 const diagnostic={phase:PHASES.has(at)?at:'UNKNOWN'},name=property(error,'name'),directCode=property(error,'code'),meta=property(error,'meta');
 if(['Error','TypeError','SyntaxError','RangeError','PrismaClientKnownRequestError','PrismaClientUnknownRequestError','PrismaClientInitializationError','PrismaClientValidationError','DatabaseError','PostgresError'].includes(name))diagnostic.exceptionType=name;
 const prisma=name==='PrismaClientKnownRequestError',postgres=name==='DatabaseError'||name==='PostgresError';
 if(prisma&&typeof directCode==='string'&&/^P[0-9]{4}$/.test(directCode))diagnostic.prismaCode=directCode;
 if(prisma||postgres){const sqlState=[property(error,'sqlState'),property(meta,'sqlState'),property(meta,'code'),postgres?directCode:undefined].find(value=>typeof value==='string'&&/^[0-9A-Z]{5}$/.test(value));if(sqlState)diagnostic.sqlState=sqlState;}
 const code=['TASK110_READONLY_STOP',diagnostic.phase,diagnostic.prismaCode,diagnostic.sqlState].filter(Boolean).join('_');return {status:'STOP',code,diagnostic,dbMutationExecuted:false};
}
function quote(value){need(typeof value==='string'&&/^[A-Za-z_][A-Za-z0-9_]*$/.test(value),'TABLE_IDENTIFIER_INVALID');return '"'+value+'"';}
const documentHash=expr=>"encode(sha256(convert_to(("+expr+")::text,'UTF8')),'hex')";
const isoSql=expr=>"to_char("+expr+" AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')";
async function fingerprint(tx,query,parameters=[],tag='TABLE_FP',document='to_jsonb(r)'){
 phase(tag.startsWith('SCHEMA')?'QUERY_SCHEMA':tag==='TABLE_FP'?'QUERY_TABLE_FP':tag.startsWith('MATERIAL')?'QUERY_MATERIAL':tag.startsWith('CATALOG')?'QUERY_CATALOG':tag.startsWith('LEDGER')?'QUERY_LEDGER':'QUERY_ORG');
 need(parameters.every(value=>typeof value==='string'||typeof value==='number'||typeof value==='boolean'||value===null),'SCALAR_BINDINGS_REQUIRED');
 const rows=await tx.$queryRawUnsafe('SELECT /*UNIT110:'+tag+'*/ count(*)::text count,encode(sha256(convert_to(COALESCE(string_agg(h,\'\' ORDER BY h),\'\'),\'UTF8\')),\'hex\') hash FROM (SELECT '+documentHash(document)+' h FROM ('+query+') r) hashes',...parameters);
 need(rows.length===1,'FINGERPRINT_SINGLE_ROW_REQUIRED');fp(rows[0]);return rows[0];
}
const newConstraint="r.relname='MaterialUnit' OR (r.relname='Material' AND c.conname='Material_unitId_fkey')";
const newIndex="t.relname='MaterialUnit' OR (t.relname='Material' AND x.relname='Material_unitId_idx')";
const newTrigger="r.relname='MaterialUnit' OR COALESCE((c.conname='Material_unitId_fkey' AND cr.relname='Material' AND cn.nspname='public'),false)";
const newRelation="c.relname IN ('MaterialUnit','MaterialUnit_pkey','MaterialUnit_name_key','Material_unitId_idx')";
const columnProjection=`table_name::text "table",column_name::text name,ordinal_position::integer ordinal,column_default::text "default",is_nullable::text nullable,data_type::text "dataType",udt_schema::text "udtSchema",udt_name::text "udtName",character_maximum_length "length",numeric_precision "precision",numeric_scale scale,datetime_precision "timePrecision",collation_name::text collation,collation_schema::text "collationSchema",domain_schema::text "domainSchema",domain_name::text "domainName",interval_type::text "intervalType",interval_precision "intervalPrecision",is_identity::text identity,identity_generation::text "identityGeneration",is_generated::text generated,generation_expression::text "generationExpression"`;
const constraintSource=`SELECT r.relname::text "table",c.conname::text name,c.contype::text kind,c.condeferrable deferrable,c.condeferred deferred,c.convalidated validated,c.confupdtype::text "update",c.confdeltype::text "delete",c.confmatchtype::text "match",
 COALESCE((SELECT jsonb_agg(a.attname::text ORDER BY k.n) FROM unnest(c.conkey) WITH ORDINALITY k(num,n) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num),'[]'::jsonb) columns,
 rr.relname::text "referenceTable",rn.nspname::text "referenceSchema",COALESCE((SELECT jsonb_agg(a.attname::text ORDER BY k.n) FROM unnest(c.confkey) WITH ORDINALITY k(num,n) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.num),'[]'::jsonb) "referenceColumns"
 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace LEFT JOIN pg_class rr ON rr.oid=c.confrelid LEFT JOIN pg_namespace rn ON rn.oid=rr.relnamespace WHERE n.nspname='public'`;
const indexSource=`SELECT t.relname::text "table",x.relname::text name,i.indisunique "unique",i.indisprimary "primary",i.indisvalid valid,i.indisready ready,a.amname::text method,i.indnkeyatts::integer "keyCount",i.indnatts::integer "attributeCount",pg_get_expr(i.indexprs,i.indrelid,true)::text expressions,pg_get_expr(i.indpred,i.indrelid,true)::text predicate,
 COALESCE((SELECT jsonb_agg(p.attname::text ORDER BY k.n) FROM unnest(i.indkey::smallint[]) WITH ORDINALITY k(num,n) LEFT JOIN pg_attribute p ON p.attrelid=i.indrelid AND p.attnum=k.num),'[]'::jsonb) keys,
 COALESCE((SELECT jsonb_agg(ns.nspname::text||'.'||o.opcname::text ORDER BY k.n) FROM unnest(i.indclass::oid[]) WITH ORDINALITY k(num,n) JOIN pg_opclass o ON o.oid=k.num JOIN pg_namespace ns ON ns.oid=o.opcnamespace),'[]'::jsonb) opclasses,
 COALESCE((SELECT jsonb_agg(ns.nspname::text||'.'||o.collname::text ORDER BY k.n) FROM unnest(i.indcollation::oid[]) WITH ORDINALITY k(num,n) JOIN pg_collation o ON o.oid=k.num JOIN pg_namespace ns ON ns.oid=o.collnamespace),'[]'::jsonb) collations,
 COALESCE((SELECT jsonb_agg(k.num ORDER BY k.n) FROM unnest(i.indoption::smallint[]) WITH ORDINALITY k(num,n)),'[]'::jsonb) options
 FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_class x ON x.oid=i.indexrelid JOIN pg_am a ON a.oid=x.relam WHERE n.nspname='public'`;
const triggerSource=`SELECT r.relname::text "table",p.proname::text "function",pn.nspname::text "functionSchema",t.tgisinternal internal,t.tgenabled::text enabled,c.conname::text "constraint",t.tgtype::integer "eventType"
 FROM pg_trigger t JOIN pg_class r ON r.oid=t.tgrelid JOIN pg_namespace n ON n.oid=r.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace LEFT JOIN pg_constraint c ON c.oid=t.tgconstraint LEFT JOIN pg_class cr ON cr.oid=c.conrelid LEFT JOIN pg_namespace cn ON cn.oid=cr.relnamespace WHERE n.nspname='public'`;
const typeAttributes="to_jsonb(t)-'oid'-'typname'-'typrelid'-'typarray'-'typelem'";
const typeSource=`SELECT t.typname::text name,${documentHash(typeAttributes)} "attributesHash",${documentHash('to_jsonb(pg_get_userbyid(t.typowner))')} "ownerHash",rn.nspname::text "relationSchema",r.relname::text "relationName",en.nspname::text "elementSchema",e.typname::text "elementName",an.nspname::text "arraySchema",a.typname::text "arrayName" FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace LEFT JOIN pg_class r ON r.oid=t.typrelid LEFT JOIN pg_namespace rn ON rn.oid=r.relnamespace LEFT JOIN pg_type e ON e.oid=t.typelem LEFT JOIN pg_namespace en ON en.oid=e.typnamespace LEFT JOIN pg_type a ON a.oid=t.typarray LEFT JOIN pg_namespace an ON an.oid=a.typnamespace WHERE n.nspname='public' AND t.typname IN ('MaterialUnit','_MaterialUnit')`;
const relationSource=`SELECT c.relname::text name,c.relkind::text kind,c.relpersistence::text persistence,c.relrowsecurity "rowSecurity",c.relforcerowsecurity "forceRowSecurity",to_jsonb(c.reloptions) options,to_jsonb(c.relacl) acl,${documentHash('to_jsonb(pg_get_userbyid(c.relowner))')} "ownerHash" FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'`;
async function schemaSnapshot(tx){
 const stableQueries={
  columns:'SELECT '+columnProjection+" FROM information_schema.columns WHERE table_schema='public' AND table_name<>'MaterialUnit' AND NOT(table_name='Material' AND column_name IN ('unit','unitId'))",
  constraints:constraintSource.replace('c.confmatchtype::text "match",','c.confmatchtype::text "match",pg_get_constraintdef(c.oid,true)::text "definition",')+' AND NOT('+newConstraint+')',
  indexes:indexSource.replace('a.amname::text method,','a.amname::text method,pg_get_indexdef(i.indexrelid)::text "definition",')+' AND NOT('+newIndex+')',
  triggers:triggerSource.replace('p.proname::text "function",','p.proname::text "function",t.tgname::text "name",pg_get_triggerdef(t.oid,true)::text "definition",t.tgdeferrable deferrable,t.tginitdeferred deferred,')+' AND NOT('+newTrigger+')',
  routines:"SELECT p.proname::text name,pg_get_function_identity_arguments(p.oid)::text arguments,pg_get_functiondef(p.oid)::text definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p')",
  sequences:"SELECT * FROM pg_sequences WHERE schemaname='public'",
  relations:relationSource.replace('c.relkind::text kind,','c.relkind::text kind,c.reltablespace::text tablespace,c.relreplident::text replicaIdentity,c.relispartition partition,')+' AND NOT('+newRelation+')',
  enums:"SELECT t.typname::text name,e.enumlabel::text label,e.enumsortorder FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public'",
  enumTypes:"SELECT t.typname,t.typlen,t.typbyval,t.typtype,t.typcategory,t.typdelim,t.typalign,t.typstorage,t.typnotnull,t.typdefault,t.typacl,pg_get_userbyid(t.typowner) owner FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype='e'",
  views:"SELECT viewname,definition FROM pg_views WHERE schemaname='public'",
  policies:"SELECT tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public'",
  namespace:"SELECT nspname,nspacl,pg_get_userbyid(nspowner) owner FROM pg_namespace WHERE nspname='public'",
  types:"SELECT t.* FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname NOT IN ('MaterialUnit','_MaterialUnit')",
  defaultPrivileges:"SELECT pg_get_userbyid(d.defaclrole) owner,n.nspname,d.defaclobjtype,d.defaclacl FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE d.defaclnamespace=0 OR n.nspname='public'",
 };
 const stable={};for(const[name,query]of Object.entries(stableQueries))stable[name]=await fingerprint(tx,query,[],'SCHEMA_STABLE:'+name);
 const readDocs=async(tag,source)=>{phase('QUERY_'+tag);const rows=await tx.$queryRawUnsafe('SELECT /*UNIT110:'+tag+'*/ to_jsonb(x) doc FROM ('+source+') x');return rows.map(row=>row.doc);};
 const columns=await readDocs('COLUMNS','SELECT '+columnProjection+" FROM information_schema.columns WHERE table_schema='public' AND (table_name='MaterialUnit' OR table_name='Material' AND column_name IN ('unit','unitId'))");
 const constraints=await readDocs('CONSTRAINTS',constraintSource+' AND ('+newConstraint+')');
 const indexes=await readDocs('INDEXES',indexSource+' AND ('+newIndex+')');
 const triggers=await readDocs('TRIGGERS',triggerSource+' AND ('+newTrigger+')');
 const relations=await readDocs('RELATIONS',relationSource+' AND ('+newRelation+')');
 const types=await readDocs('TYPES',typeSource);
 phase('QUERY_SCHEMA');const [typeTemplates]=await tx.$queryRawUnsafe("SELECT /*UNIT110:TYPE_TEMPLATES*/ "+documentHash("to_jsonb(t)-'oid'-'typname'-'typrelid'-'typarray'-'typelem'")+" \"recordHash\","+documentHash("to_jsonb(a)-'oid'-'typname'-'typrelid'-'typarray'-'typelem'")+" \"arrayHash\" FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_class c ON c.oid=t.typrelid JOIN pg_type a ON a.oid=t.typarray WHERE n.nspname='public' AND t.typname='Material' AND c.relname='Material'");
 need(typeTemplates,'MATERIAL_TYPE_TEMPLATES_REQUIRED');
 phase('QUERY_COLUMNS');
 const [materialColumns]=await tx.$queryRawUnsafe("SELECT /*UNIT110:MATERIAL_SCHEMA*/ count(*)::text count,max(ordinal_position)::integer \"maxOrdinal\" FROM information_schema.columns WHERE table_schema='public' AND table_name='Material'");
 const [owner]=await tx.$queryRawUnsafe("SELECT /*UNIT110:MATERIAL_OWNER*/ "+documentHash('to_jsonb(pg_get_userbyid(c.relowner))')+" hash FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='Material' AND c.relkind='r'");
 need(materialColumns&&owner,'MATERIAL_SCHEMA_REQUIRED');
 return {stable,delta:{columns,constraints,indexes,triggers,relations,types,typeTemplates,materialColumns,materialOwnerHash:owner.hash}};
}
export async function captureSnapshot(db,input,proof){
 inputShape(input);need(proof?.hostname==='crm-staging'&&proof.revision===input.revision&&proof.databaseVolume==='crm-staging_pgdata'&&SHA64.test(proof.web??'')&&SHA64.test(proof.database??'')&&SHA64.test(proof.outerW07Sha256??''),'CAPTURE_PHYSICAL_PROOF_REQUIRED');
 phase('TX_BEGIN');return db.$transaction(async tx=>{
  phase('READONLY_SET');await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  phase('QUERY_IDENTITY');const [identity]=await tx.$queryRawUnsafe("SELECT /*UNIT110:IDENTITY*/ current_database()::text name,current_schema()::text schema,current_setting('transaction_read_only')::text readonly,NOT pg_is_in_recovery() AS \"primary\"");
  need(identity?.name==='crm'&&identity.schema==='public'&&identity.readonly==='on'&&identity.primary===true,'READ_ONLY_PRIMARY_REQUIRED');
  phase('QUERY_TABLES');const rows=await tx.$queryRawUnsafe("SELECT /*UNIT110:TABLES*/ tablename::text name FROM pg_tables WHERE schemaname='public' ORDER BY tablename");const tableNames=rows.map(row=>row.name);
  need(tableNames.length>0&&tableNames.length<256&&tableNames.every(name=>/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))&&REQUIRED.every(name=>tableNames.includes(name))&&new Set(tableNames).size===tableNames.length,'PUBLIC_TABLE_SET_INVALID');
  need(tableNames.includes('MaterialUnit')===(input.mode==='after'),'CATALOG_TABLE_MODE_MISMATCH');
  const tables={};for(const name of tableNames)tables[name]=await fingerprint(tx,'SELECT t.* FROM '+quote(name)+' t');
  const from=input.mode==='before'?'FROM "Material" m':'FROM "Material" m JOIN "MaterialUnit" u ON u.id=m."unitId"';
  const oldShape=input.mode==='before'?'to_jsonb(m)':"(to_jsonb(m)-'unitId')||jsonb_build_object('unit',u.name)";
  const business=input.mode==='before'?"to_jsonb(m)-'unit'":"to_jsonb(m)-'unitId'";
  const unit=input.mode==='before'?'m.unit':'u.name';
  const canonicalMaterial=await fingerprint(tx,'SELECT '+oldShape+' doc '+from,[],'MATERIAL_CANONICAL','r.doc');
  const tuples=await fingerprint(tx,'SELECT m.id::text id,'+documentHash('to_jsonb('+unit+')')+' "unitHash",'+documentHash(business)+' "businessHash" '+from,[],'MATERIAL_TUPLES');
  let references=null;
  if(input.mode==='after'){
   phase('QUERY_MATERIAL');[references]=await tx.$queryRawUnsafe('SELECT /*UNIT110:MATERIAL_REFERENCES*/ count(*) FILTER(WHERE m."unitId" IS NULL)::text nulls,count(*) FILTER(WHERE u.id IS NULL)::text orphans FROM "Material" m LEFT JOIN "MaterialUnit" u ON u.id=m."unitId"');
  }
  const expectedNames=await fingerprint(tx,'SELECT '+unit+' name '+from+' UNION SELECT d.name FROM jsonb_to_recordset($1::jsonb) d(id text,name text)',[DEFAULT_JSON],'CATALOG_EXPECTED');
  let actualNames=null,idMismatchCount=null,timeMismatchCount=null;
  if(input.mode==='after'){
   actualNames=await fingerprint(tx,'SELECT u.name FROM "MaterialUnit" u',[],'CATALOG_ACTUAL');
   phase('QUERY_CATALOG');const [invalid]=await tx.$queryRawUnsafe('SELECT /*UNIT110:CATALOG_MAPPING*/ count(*) FILTER(WHERE u.id<>COALESCE(d.id,\'warehouse-unit-custom-\'||md5(u.name)))::text "idMismatchCount" FROM "MaterialUnit" u LEFT JOIN jsonb_to_recordset($1::jsonb) d(id text,name text) ON d.name=u.name',DEFAULT_JSON);idMismatchCount=invalid.idMismatchCount;
   const [timestamps]=await tx.$queryRawUnsafe('SELECT /*UNIT110:CATALOG_TIMES*/ count(*) FILTER(WHERE u."createdAt"<>u."updatedAt" OR NOT EXISTS(SELECT 1 FROM "_prisma_migrations" l WHERE l.migration_name=$1 AND l.checksum=$2 AND l.finished_at IS NOT NULL AND l.rolled_back_at IS NULL AND (u."createdAt" AT TIME ZONE \'UTC\') BETWEEN date_trunc(\'milliseconds\',l.started_at) AND l.finished_at+interval \'1 millisecond\'))::text "timeMismatchCount" FROM "MaterialUnit" u',MIGRATION.name,MIGRATION.checksum);timeMismatchCount=timestamps.timeMismatchCount;
  }
  phase('QUERY_LEDGER');const records=await tx.$queryRawUnsafe('SELECT /*UNIT110:LEDGER*/ id::text id,migration_name::text name,checksum::text checksum,'+isoSql('started_at')+' "startedAt",'+isoSql('finished_at')+' "finishedAt",'+isoSql('rolled_back_at')+' "rolledBackAt",applied_steps_count::integer "appliedStepsCount",(logs IS NULL) "logsNull" FROM "_prisma_migrations" WHERE migration_name=$1 ORDER BY id',MIGRATION.name);
  const preserved=await fingerprint(tx,'SELECT t.* FROM "_prisma_migrations" t WHERE t.migration_name<>$1',[MIGRATION.name],'LEDGER_PRESERVED');
  const schema=await schemaSnapshot(tx);
  const otherRows=await fingerprint(tx,'SELECT t.* FROM "OrgSetting" t WHERE t.key<>$1',['telegram.botUsername'],'ORG_OTHERS');
  phase('QUERY_ORG');const botRows=await tx.$queryRawUnsafe('SELECT /*UNIT110:ORG_BOT*/ key::text key,'+documentHash('to_jsonb(t.value)')+' "valueHash",'+documentHash("to_jsonb(t)-'updatedAt'")+' "stableFieldsHash",to_char(t."updatedAt",\'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') "updatedAt" FROM "OrgSetting" t WHERE t.key=$1','telegram.botUsername');need(botRows.length<=1,'BOT_SINGLETON_REQUIRED');
  phase('QUERY_TOKENS');const apiTokens=await captureTokenClockEvidence(tx);
  phase('QUERY_CLOCK');const [clock]=await tx.$queryRawUnsafe("SELECT /*UNIT110:CLOCK*/ to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') at");
  return {version:2,mode:input.mode,runId:input.runId,revision:input.revision,capturedAt:clock.at,tableNames,tables,materials:{canonical:canonicalMaterial,tuples,references},catalog:{expectedNames,actualNames,idMismatchCount,timeMismatchCount},ledger:{preserved,records},schema,orgSetting:{count:tables.OrgSetting.count,otherRows,bot:botRows[0]??null},apiTokens,identity};
 },{isolationLevel:'RepeatableRead',maxWait:10000,timeout:120000});
}
const columnKeys=['table','name','ordinal','default','nullable','dataType','udtSchema','udtName','length','precision','scale','timePrecision','collation','collationSchema','domainSchema','domainName','intervalType','intervalPrecision','identity','identityGeneration','generated','generationExpression'];
function expectedColumn(table,name,ordinal,defaultValue=null,timestamp=false){return {table,name,ordinal,default:defaultValue,nullable:'NO',dataType:timestamp?'timestamp without time zone':'text',udtSchema:'pg_catalog',udtName:timestamp?'timestamp':'text',length:null,precision:null,scale:null,timePrecision:timestamp?3:null,collation:null,collationSchema:null,domainSchema:null,domainName:null,intervalType:null,intervalPrecision:null,identity:'NO',identityGeneration:null,generated:'NEVER',generationExpression:null};}
const sorted=rows=>[...rows].sort((a,b)=>canonical(a).localeCompare(canonical(b),'en'));
function validateDelta(delta,mode){
 keys(delta,['columns','constraints','indexes','triggers','relations','types','typeTemplates','materialColumns','materialOwnerHash'],'SCHEMA_DELTA_FIELDS_INVALID');
 keys(delta.materialColumns,['count','maxOrdinal'],'MATERIAL_COLUMN_SUMMARY_INVALID');need(count(delta.materialColumns.count)&&Number.isInteger(delta.materialColumns.maxOrdinal)&&delta.materialColumns.maxOrdinal>0&&SHA64.test(delta.materialOwnerHash??''),'MATERIAL_SCHEMA_INVALID');
 keys(delta.typeTemplates,['recordHash','arrayHash'],'TYPE_TEMPLATES_FIELDS_INVALID');need(SHA64.test(delta.typeTemplates.recordHash??'')&&SHA64.test(delta.typeTemplates.arrayHash??''),'TYPE_TEMPLATES_INVALID');
 for(const field of ['columns','constraints','indexes','triggers','relations','types'])need(Array.isArray(delta[field])&&delta[field].length<20,'SCHEMA_DELTA_ARRAY_INVALID');
 for(const row of delta.columns){keys(row,columnKeys,'COLUMN_METADATA_FIELDS_INVALID');need(['Material','MaterialUnit'].includes(row.table)&&['unit','unitId','id','name','createdAt','updatedAt'].includes(row.name)&&Number.isInteger(row.ordinal)&&row.ordinal>0,'COLUMN_SCOPE_INVALID');}
 if(mode==='before'){
  need(delta.columns.length===1&&delta.columns[0].ordinal<=delta.materialColumns.maxOrdinal,'OLD_UNIT_COLUMN_REQUIRED');same(delta.columns[0],expectedColumn('Material','unit',delta.columns[0].ordinal,"'шт'::text"),'OLD_UNIT_COLUMN_INVALID');
  for(const key of ['constraints','indexes','triggers','relations','types'])same(delta[key],[],'BEFORE_NEW_SCHEMA_NOT_ABSENT');
 }else{
  const unitId=delta.columns.find(row=>row.table==='Material'&&row.name==='unitId');need(unitId&&unitId.ordinal===delta.materialColumns.maxOrdinal,'NEW_UNIT_ID_COLUMN_REQUIRED');
  const columns=[expectedColumn('Material','unitId',unitId.ordinal,"'warehouse-unit-piece'::text"),expectedColumn('MaterialUnit','id',1),expectedColumn('MaterialUnit','name',2),expectedColumn('MaterialUnit','createdAt',3,'CURRENT_TIMESTAMP',true),expectedColumn('MaterialUnit','updatedAt',4,null,true)];same(sorted(delta.columns),sorted(columns),'CATALOG_COLUMN_CONTRACT_INVALID');
  const constraints=[{table:'MaterialUnit',name:'MaterialUnit_pkey',kind:'p',deferrable:false,deferred:false,validated:true,update:' ',delete:' ',match:' ',columns:['id'],referenceTable:null,referenceSchema:null,referenceColumns:[]},{table:'Material',name:'Material_unitId_fkey',kind:'f',deferrable:false,deferred:false,validated:true,update:'c',delete:'r',match:'s',columns:['unitId'],referenceTable:'MaterialUnit',referenceSchema:'public',referenceColumns:['id']}];same(sorted(delta.constraints),sorted(constraints),'UNIT_CONSTRAINT_CONTRACT_INVALID');
  const makeIndex=(table,name,key,primary=false,unique=false)=>({table,name,unique,primary,valid:true,ready:true,method:'btree',keys:[key],keyCount:1,attributeCount:1,expressions:null,predicate:null,opclasses:['pg_catalog.text_ops'],collations:['pg_catalog.default'],options:[0]});
  const indexes=[makeIndex('MaterialUnit','MaterialUnit_pkey','id',true,true),makeIndex('MaterialUnit','MaterialUnit_name_key','name',false,true),makeIndex('Material','Material_unitId_idx','unitId')];same(sorted(delta.indexes),sorted(indexes),'UNIT_INDEX_CONTRACT_INVALID');
  const triggers=[['Material','RI_FKey_check_ins',5],['Material','RI_FKey_check_upd',17],['MaterialUnit','RI_FKey_restrict_del',9],['MaterialUnit','RI_FKey_cascade_upd',17]].map(([table,fn,eventType])=>({table,function:fn,functionSchema:'pg_catalog',internal:true,enabled:'O',constraint:'Material_unitId_fkey',eventType}));same(sorted(delta.triggers),sorted(triggers),'UNIT_TRIGGER_CONTRACT_INVALID');
  const relations=['MaterialUnit','MaterialUnit_pkey','MaterialUnit_name_key','Material_unitId_idx'].map(name=>({name,kind:name==='MaterialUnit'?'r':'i',persistence:'p',rowSecurity:false,forceRowSecurity:false,options:null,acl:null,ownerHash:delta.materialOwnerHash}));same(sorted(delta.relations),sorted(relations),'UNIT_RELATION_CONTRACT_INVALID');
  const types=[{name:'MaterialUnit',attributesHash:delta.typeTemplates.recordHash,ownerHash:delta.materialOwnerHash,relationSchema:'public',relationName:'MaterialUnit',elementSchema:null,elementName:null,arraySchema:'public',arrayName:'_MaterialUnit'},{name:'_MaterialUnit',attributesHash:delta.typeTemplates.arrayHash,ownerHash:delta.materialOwnerHash,relationSchema:null,relationName:null,elementSchema:'public',elementName:'MaterialUnit',arraySchema:null,arrayName:null}];same(sorted(delta.types),sorted(types),'UNIT_COMPOSITE_ARRAY_TYPE_CONTRACT_INVALID');
 }
}
function shape(snapshot,input){
 inputShape(input,Object.hasOwn(input??{},'beforeRevision'));
 keys(snapshot,['version','mode','runId','revision','capturedAt','tableNames','tables','materials','catalog','ledger','schema','orgSetting','apiTokens','identity'],'SNAPSHOT_FIELDS_INVALID');
 need(snapshot.version===2&&snapshot.mode===input.mode&&snapshot.runId===input.runId&&snapshot.revision===input.revision&&time(snapshot.capturedAt),'SNAPSHOT_BINDING_INVALID');
 keys(snapshot.identity,['name','schema','readonly','primary'],'SNAPSHOT_IDENTITY_FIELDS_INVALID');same(snapshot.identity,{name:'crm',schema:'public',readonly:'on',primary:true},'SNAPSHOT_IDENTITY_INVALID');
 need(Array.isArray(snapshot.tableNames)&&snapshot.tableNames.length>0&&snapshot.tableNames.length<256&&snapshot.tableNames.every(name=>/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)),'SNAPSHOT_TABLE_SET_INVALID');same(snapshot.tableNames,[...new Set(snapshot.tableNames)].sort(),'SNAPSHOT_TABLE_SET_ORDER_INVALID');need(REQUIRED.every(name=>snapshot.tableNames.includes(name)),'SNAPSHOT_REQUIRED_TABLE_MISSING');keys(snapshot.tables,snapshot.tableNames,'SNAPSHOT_TABLE_FINGERPRINT_SET_INVALID');for(const value of Object.values(snapshot.tables))fp(value);
 keys(snapshot.materials,['canonical','tuples','references'],'MATERIAL_PROOF_FIELDS_INVALID');fp(snapshot.materials.canonical);fp(snapshot.materials.tuples);need(snapshot.materials.canonical.count===snapshot.tables.Material.count&&snapshot.materials.tuples.count===snapshot.tables.Material.count,'MATERIAL_AGGREGATE_COUNT_INVALID');
 if(snapshot.mode==='before')need(snapshot.materials.references===null,'BEFORE_REFERENCE_COUNTERS_INVALID');else{keys(snapshot.materials.references,['nulls','orphans'],'REFERENCE_COUNTERS_INVALID');need(count(snapshot.materials.references.nulls)&&count(snapshot.materials.references.orphans),'REFERENCE_COUNT_TYPE_INVALID');}
 keys(snapshot.catalog,['expectedNames','actualNames','idMismatchCount','timeMismatchCount'],'CATALOG_PROOF_FIELDS_INVALID');fp(snapshot.catalog.expectedNames);need(BigInt(snapshot.catalog.expectedNames.count)>=10n,'STANDARD_CATALOG_SET_INVALID');
 if(snapshot.mode==='before')need(snapshot.catalog.actualNames===null&&snapshot.catalog.idMismatchCount===null&&snapshot.catalog.timeMismatchCount===null,'BEFORE_CATALOG_NOT_ABSENT');else{fp(snapshot.catalog.actualNames);need(count(snapshot.catalog.idMismatchCount)&&count(snapshot.catalog.timeMismatchCount),'CATALOG_COUNTERS_INVALID');}
 keys(snapshot.ledger,['preserved','records'],'LEDGER_PROOF_FIELDS_INVALID');fp(snapshot.ledger.preserved);need(Array.isArray(snapshot.ledger.records)&&snapshot.ledger.records.length<8,'LEDGER_RECORDS_INVALID');for(const row of snapshot.ledger.records){keys(row,['id','name','checksum','startedAt','finishedAt','rolledBackAt','appliedStepsCount','logsNull'],'LEDGER_RECORD_FIELDS_INVALID');need(id(row.id)&&row.name===MIGRATION.name&&SHA64.test(row.checksum??'')&&time(row.startedAt)&&(row.finishedAt===null||time(row.finishedAt))&&(row.rolledBackAt===null||time(row.rolledBackAt))&&Number.isInteger(row.appliedStepsCount)&&typeof row.logsNull==='boolean','LEDGER_RECORD_INVALID');}
 keys(snapshot.schema,['stable','delta'],'SCHEMA_PROOF_FIELDS_INVALID');keys(snapshot.schema.stable,SCHEMA_KEYS,'SCHEMA_STABLE_KEYS_INVALID');for(const value of Object.values(snapshot.schema.stable))fp(value);validateDelta(snapshot.schema.delta,snapshot.mode);
 validateTokenClockEvidence(snapshot.apiTokens);same(snapshot.apiTokens.full,snapshot.tables.ApiToken,'TOKEN_FULL_TABLE_COHERENCE_REQUIRED');need(Date.parse(snapshot.apiTokens.capturedAt)<=Date.parse(snapshot.capturedAt),'TOKEN_END_AFTER_UNIT_END');
 keys(snapshot.orgSetting,['count','otherRows','bot'],'ORGSETTING_FIELDS_INVALID');fp(snapshot.orgSetting.otherRows);need(snapshot.orgSetting.count===snapshot.tables.OrgSetting.count&&BigInt(snapshot.orgSetting.otherRows.count)+(snapshot.orgSetting.bot?1n:0n)===BigInt(snapshot.orgSetting.count),'ORGSETTING_COUNTS_INVALID');
 if(snapshot.orgSetting.bot){const bot=snapshot.orgSetting.bot;keys(bot,['key','valueHash','stableFieldsHash','updatedAt'],'BOT_SETTING_FIELDS_INVALID');need(bot.key==='telegram.botUsername'&&SHA64.test(bot.valueHash??'')&&SHA64.test(bot.stableFieldsHash??'')&&time(bot.updatedAt)&&Date.parse(bot.updatedAt)<=Date.parse(snapshot.capturedAt),'BOT_SETTING_INVALID');}
 return snapshot;
}
export function verifyBefore(before,input){
 shape(before,input);need(input.mode==='before'&&!before.tableNames.includes('MaterialUnit'),'BEFORE_CATALOG_MUST_BE_ABSENT');same(before.ledger.records,[],'BEFORE_MIGRATION_MUST_BE_ABSENT');same(before.ledger.preserved,before.tables._prisma_migrations,'BEFORE_LEDGER_MISMATCH');same(before.materials.canonical,before.tables.Material,'BEFORE_CANONICAL_MATERIAL_MISMATCH');return {materialsVerified:before.tables.Material.count,tablesVerified:before.tableNames.length,dbReadOnly:true};
}
export function verifyAfter(before,after,input){
 inputShape(input,true);need(input.mode==='after'&&input.beforeRevision===before.revision,'BEFORE_REVISION_BINDING_REQUIRED');const previous={...input,mode:'before',revision:input.beforeRevision};delete previous.beforeRevision;verifyBefore(before,previous);shape(after,input);
 need(Date.parse(after.capturedAt)>Date.parse(before.capturedAt),'CAPTURE_CLOCK_ORDER_INVALID');same(after.tableNames,[...before.tableNames,'MaterialUnit'].sort(),'ONLY_CATALOG_TABLE_ADDITION_ALLOWED');
 same(after.materials.canonical,before.materials.canonical,'ORIGINAL_MATERIAL_ROWS_CHANGED');same(after.materials.tuples,before.materials.tuples,'ORIGINAL_MATERIAL_IDS_UNITS_BUSINESS_CHANGED');same(after.materials.references,{nulls:'0',orphans:'0'},'UNIT_REFERENCES_INVALID');
 same(after.catalog.expectedNames,before.catalog.expectedNames,'ORIGINAL_EXPECTED_LABELS_CHANGED');same(after.catalog.actualNames,before.catalog.expectedNames,'CATALOG_LABEL_SET_CHANGED');need(after.tables.MaterialUnit.count===before.catalog.expectedNames.count&&after.catalog.idMismatchCount==='0'&&after.catalog.timeMismatchCount==='0','CATALOG_ID_TIME_CONTRACT_INVALID');
 same(after.ledger.preserved,before.ledger.preserved,'ORIGINAL_MIGRATION_LEDGER_CHANGED');need(after.ledger.records.length===1&&BigInt(after.tables._prisma_migrations.count)===BigInt(before.tables._prisma_migrations.count)+1n,'EXACT_ONE_MIGRATION_REQUIRED');
 const ledger=after.ledger.records[0];need(ledger.checksum===MIGRATION.checksum&&ledger.rolledBackAt===null&&ledger.logsNull===true&&ledger.appliedStepsCount===1&&time(ledger.finishedAt)&&Date.parse(ledger.startedAt)>=Date.parse(before.capturedAt)&&Date.parse(ledger.finishedAt)>=Date.parse(ledger.startedAt)&&Date.parse(ledger.finishedAt)<=Date.parse(after.capturedAt),'MIGRATION_LEDGER_WINDOW_INVALID');
 same(after.schema.stable,before.schema.stable,'UNAPPROVED_SCHEMA_CHANGED');same(after.schema.delta.materialOwnerHash,before.schema.delta.materialOwnerHash,'MATERIAL_OWNER_CHANGED');same(after.schema.delta.typeTemplates,before.schema.delta.typeTemplates,'MATERIAL_TYPE_TEMPLATES_CHANGED');need(after.schema.delta.materialColumns.count===before.schema.delta.materialColumns.count&&after.schema.delta.materialColumns.maxOrdinal===before.schema.delta.materialColumns.maxOrdinal+1,'MATERIAL_COLUMN_REPLACEMENT_INVALID');
 same(after.orgSetting.otherRows,before.orgSetting.otherRows,'OTHER_SETTING_ROWS_CHANGED');same(after.orgSetting.count,before.orgSetting.count,'SETTING_COUNT_CHANGED');
 let operationalClockChanged=false;const oldBot=before.orgSetting.bot,newBot=after.orgSetting.bot;need(Boolean(oldBot)===Boolean(newBot),'BOT_SINGLETON_CHANGED');
 if(oldBot){same(newBot.key,oldBot.key,'BOT_KEY_CHANGED');same(newBot.valueHash,oldBot.valueHash,'BOT_VALUE_CHANGED');same(newBot.stableFieldsHash,oldBot.stableFieldsHash,'BOT_IMMUTABLE_FIELDS_CHANGED');operationalClockChanged=newBot.updatedAt!==oldBot.updatedAt;if(operationalClockChanged)need(Date.parse(newBot.updatedAt)>Date.parse(oldBot.updatedAt)&&Date.parse(newBot.updatedAt)<=Date.parse(after.capturedAt),'BOT_CLOCK_NOT_MONOTONIC');}
 if(!operationalClockChanged)same(after.tables.OrgSetting,before.tables.OrgSetting,'ORGSETTING_UNEXPLAINED_CHANGE');else need(after.tables.OrgSetting.hash!==before.tables.OrgSetting.hash,'BOT_CLOCK_HASH_INCOHERENT');
 const apiTokenClock=compareTokenClockEvidence(before.apiTokens,after.apiTokens);
 for(const table of before.tableNames)if(!['Material','OrgSetting','_prisma_migrations','ApiToken'].includes(table))same(after.tables[table],before.tables[table],'ORIGINAL_TABLE_CHANGED_'+table);
 return {materialsVerified:before.tables.Material.count,tablesVerified:before.tableNames.length,originalsPreserved:true,schemaVerified:true,catalogVerified:true,operationalClockChanged,apiTokenClocksChanged:apiTokenClock.changed,apiTokenStableFieldsMatched:apiTokenClock.stableFieldsMatched,dbReadOnly:true};
}
export function encodeSnapshot(snapshot,input){
 shape(snapshot,input);const raw=Buffer.from(JSON.stringify(snapshot),'utf8');need(raw.length<=RAW_CAP,'RAW_SNAPSHOT_LIMIT');const body={status:'READ_ONLY_CAPTURED',mode:input.mode,runId:input.runId,revision:input.revision,snapshotEncoding:'gzip-base64',snapshotSha256:createHash('sha256').update(raw).digest('hex'),snapshot:gzipSync(raw).toString('base64')};need(Buffer.byteLength(JSON.stringify(body),'utf8')<=WIRE_CAP,'COMPACT_WIRE_LIMIT');return body;
}
export async function main(){
 let db,result;try{
  phase('ENTRY_INPUT');const encoded=process.env.CRM_STAGING_BROWSER_INPUT;need(typeof encoded==='string'&&encoded.length>0&&encoded.length<=96*1024,'BOUNDED_INPUT_REQUIRED');const bytes=Buffer.from(encoded,'base64');need(bytes.toString('base64')===encoded,'CANONICAL_INPUT_REQUIRED');const input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  phase('STAGE_GUARD');const {proof}=stageGuard(input);phase('CLIENT_SETUP');db=new PrismaClient({log:[],errorFormat:'minimal'});const snapshot=await captureSnapshot(db,input,proof);phase('VERIFY_SNAPSHOT');shape(snapshot,input);if(input.mode==='before')verifyBefore(snapshot,input);phase('WIRE_OUTPUT');result=encodeSnapshot(snapshot,input);
 }catch(error){result=diagnosticStop(error,currentPhase);process.exitCode=1;}
 finally{if(db)try{phase('EXIT_DISCONNECT');await db.$disconnect();}catch(error){if(result?.status!=='STOP')result=diagnosticStop(error,'EXIT_DISCONNECT');process.exitCode=1;}}
 console.log(JSON.stringify(result));
}
const entry=process.argv[1];const direct=entry?path.resolve(entry)===fileURLToPath(import.meta.url):/\/(\[eval[0-9]+\]|\[stdin\])$/.test(import.meta.url);
if(direct&&process.env.CRM_STAGING_BROWSER_INPUT&&process.env.CRM_MODERNIZATION_TARGET==='staging')void main();
