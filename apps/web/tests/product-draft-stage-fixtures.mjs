// Fresh task111 staging QA only. SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md.
// No DB/auth/HTTP/S3 action on import. Root owns durable files and every actual UI action.
import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {hostname} from 'node:os';
import {existsSync} from 'node:fs';
import {PrismaClient} from '@prisma/client';
import {encode} from '@auth/core/jwt';
import {getManifest} from '../src/server/plugins/registry.ts';
import {captureTokenClockEvidence,compareTokenClockEvidence,validateTokenClockEvidence} from './crm-acceptance-token-clock.mjs';
import {unpackFunctionalInput,encodeFunctionalWire,OUTPUT_WIRE_LIMIT} from './product-draft-stage-wire.mjs';

const NS='PERO_PRODUCT_DRAFT_STAGE_QA_111_V1';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{40}$/,HASH=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9_:-]{1,160}$/,ISO=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
export const PREFERENCE_KEYS=['projects.list','products.list'];
const STAGES=['LEAD','ESTIMATE','CONTRACT','PAUSED','REFUSED','IN_WORK'];
const STATUSES=['DRAFT','PREPARATION','DESIGN'];
const TABLES=['User','Client','Project','Product','ProductPercentageConfig','ProductStatusHistory','ProjectStageHistory','ChangeLog','DomainEvent','Notification'];
const ORDER=['ProductPercentageConfig','ProductStatusHistory','ProjectStageHistory','ChangeLog','DomainEvent','Notification','UserPreference','Product','Project','Client','User'];
export const RETIRED_FILE_STAGES_POLICY=Object.freeze({id:'file-stages',version:'0.1.0',apiVersion:1});
class QaStop extends Error {constructor(code){super(code);this.checkId=code;}}
const need=(ok,code)=>{if(!ok)throw new QaStop(code);};
export function canonical(value){const v=JSON.parse(JSON.stringify(value));const walk=item=>Array.isArray(item)?'['+item.map(walk).join(',')+']':item&&typeof item==='object'?'{'+Object.keys(item).sort().map(key=>JSON.stringify(key)+':'+walk(item[key])).join(',')+'}':JSON.stringify(item);return walk(v);}
export const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const same=(a,b,code)=>need(canonical(a)===canonical(b),code);
function keys(value,list,code){need(value&&typeof value==='object'&&!Array.isArray(value),code);same(Object.keys(value).sort(),[...list].sort(),code);}
function quote(value){need(/^[A-Za-z_][A-Za-z0-9_]*$/.test(value),'SQL_IDENTIFIER_INVALID');return '"'+value+'"';}
const rowHash=alias=>"encode(sha256(convert_to(to_jsonb("+alias+")::text,'UTF8')),'hex')";
const iso=column=>"to_char("+column+",'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')";
function basic(input){need(input?.authorized===true&&UUID.test(input.runId??'')&&SHA.test(input.revision??''),'AUTHORIZED_FRESH_RUN_REQUIRED');}
export function tags(runId){
 need(UUID.test(runId),'RUN_UUID_REQUIRED');
 return {actor:'QA111 manager '+runId,client:'QA111 client '+runId,projectA:'QA111 primary '+runId,projectB:'QA111 paused '+runId,products:Array.from({length:10},(_,index)=>'QA111 product '+runId+' '+String(index+1).padStart(2,'0'))};
}
export function stageGuard(input,env=process.env,container={host:hostname(),docker:existsSync('/.dockerenv')}){
 basic(input);need(env.CRM_MODERNIZATION_TARGET==='staging'&&container.docker,'STAGING_ONLY_REQUIRED');
 let db,storage,proof;try{db=new URL(env.DATABASE_URL??'');storage=new URL(env.S3_ENDPOINT??'');proof=JSON.parse(env.CRM_MODERNIZATION_STAGE_PROOF??'');}catch{throw new QaStop('STAGING_ENV_INVALID');}
 const options=new Set(['schema','connection_limit','pool_timeout','connect_timeout','socket_timeout','sslmode']);
 need(['postgres:','postgresql:'].includes(db.protocol)&&db.hostname==='db'&&(db.port||'5432')==='5432'&&db.pathname==='/crm'&&!db.hash,'STAGING_DATABASE_MISMATCH');
 need([...db.searchParams.keys()].every(key=>options.has(key)&&db.searchParams.getAll(key).length===1)&&(!db.searchParams.has('schema')||db.searchParams.get('schema')==='public'),'DATABASE_OPTIONS_MISMATCH');
 need(env.CRM_FILE_STORAGE==='s3'&&env.S3_BUCKET==='pero-crm-staging'&&storage.protocol==='http:'&&storage.hostname==='192.168.0.33'&&storage.port==='9000'&&!storage.username&&!storage.password&&!storage.search&&!storage.hash,'STAGING_STORAGE_MISMATCH');
 need(proof?.hostname==='crm-staging'&&proof.revision===input.revision&&proof.databaseVolume==='crm-staging_pgdata'&&HASH.test(proof.outerW07Sha256??'')&&HASH.test(proof.web??'')&&/^[a-f0-9]{12,64}$/.test(container.host??'')&&proof.web.startsWith(container.host)&&HASH.test(proof.database??''),'VERIFIED_PHYSICAL_STAGE_REQUIRED');
 const secret=env.AUTH_SECRET??env.NEXTAUTH_SECRET;
 need(typeof secret==='string'&&secret.length>0&&env.S3_ACCESS_KEY&&env.S3_SECRET_KEY,'PRIVATE_RUNTIME_CREDENTIALS_REQUIRED');
 return {proof,secret};
}
export function sign(value,secret){need(typeof secret==='string'&&secret.length>0,'OWNERSHIP_SECRET_REQUIRED');return {...value,signature:createHmac('sha256',secret).update(NS+'\0'+canonical(value)).digest('hex')};}
export function verifySigned(value,secret,kind,input){
 basic(input);need(value?.namespace===NS&&value.kind===kind&&value.runId===input.runId&&value.revision===input.revision&&HASH.test(value.signature??''),'SIGNED_FRESH_SCOPE_REQUIRED');
 const{signature,...body}=value;const expected=sign(body,secret).signature;
 need(timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(expected,'hex')),'SIGNED_SCOPE_TAMPERED');
 return body;
}
function basePre(value,secret,input){
 if(value?.kind==='pre'){verifySigned(value,secret,'pre',input);return value;}
 const cp=verifySigned(value,secret,'checkpoint',input);verifySigned(cp.pre,secret,'pre',input);return cp.pre;
}
export function validatePluginPolicy(enabled,input){
 need(Array.isArray(enabled),'PLUGIN_PREFLIGHT_REQUIRED');
 if(!enabled.length)return;
 const policy=input.noHookPolicy;
 keys(policy,['revision','plugins'],'NOHOOK_POLICY_REQUIRED');need(policy.revision===input.revision&&Array.isArray(policy.plugins)&&policy.plugins.length===1,'NOHOOK_POLICY_REVISION_REQUIRED');
 same(policy.plugins[0],RETIRED_FILE_STAGES_POLICY,'NOHOOK_POLICY_RETIRED_METADATA_REQUIRED');
 for(const row of enabled){
  need(getManifest(row.id)===undefined,'ENABLED_PLUGIN_REGISTERED_STOP');
  need(row.id===RETIRED_FILE_STAGES_POLICY.id&&row.version===RETIRED_FILE_STAGES_POLICY.version&&row.apiVersion===RETIRED_FILE_STAGES_POLICY.apiVersion,'UNKNOWN_ENABLED_PLUGIN_STOP');
 }
}
export function validateJournal(journal,pre,{complete=false}={}){
 keys(journal,['runId','revision','actions','preferences'],'JOURNAL_FIELDS_INVALID');
 need(journal.runId===pre.runId&&journal.revision===pre.revision&&Array.isArray(journal.actions)&&journal.actions.length<=120,'JOURNAL_SCOPE_INVALID');
 keys(journal.preferences,PREFERENCE_KEYS,'PREFERENCE_SCOPE_INVALID');
 for(const value of Object.values(journal.preferences))need(value===null||(typeof value==='string'&&value.length<=32768),'PREFERENCE_ACK_INVALID');
 const seen=new Set();let pending=0,previousBoundary=pre.createdAt;
 for(const action of journal.actions){
  need(action&&Object.keys(action).every(key=>['id','kind','atISO','ack','projectId','productId','productTitle','toStage','toStatus','actionId','preferenceKey'].includes(key)),'ACTION_FIELDS_INVALID');
  need(UUID.test(action.id??'')&&!seen.has(action.id)&&ISO(action.atISO)&&action.atISO>=previousBoundary,'ACTION_INTENT_INVALID');seen.add(action.id);
  need(['project-create','product-create','project-stage','product-status','preference'].includes(action.kind),'ACTION_KIND_INVALID');
  for(const key of ['projectId','productId'])if(action[key]!==undefined)need(ID.test(action[key]),'ACTION_SUBJECT_ID_INVALID');
  if(action.actionId!==undefined)need(UUID.test(action.actionId),'ACTION_MUTATION_UUID_INVALID');
  if(action.productTitle!==undefined)need(pre.tags.products.includes(action.productTitle),'ACTION_PRODUCT_TAG_INVALID');
  if(action.toStage!==undefined)need(STAGES.includes(action.toStage),'UNSAFE_PROJECT_STAGE');
  if(action.toStatus!==undefined)need(STATUSES.includes(action.toStatus),'UNSAFE_PRODUCT_STATUS');
  if(action.kind==='preference')need(PREFERENCE_KEYS.includes(action.preferenceKey),'PREFERENCE_INTENT_KEY_REQUIRED');
  else need(action.preferenceKey===undefined,'PREFERENCE_KEY_ON_OTHER_ACTION');
  if(action.ack===null){need(action===journal.actions.at(-1),'ACTION_AFTER_LOST_RESPONSE');pending++;previousBoundary=action.atISO;continue;}
  need(action.ack&&Object.keys(action.ack).every(key=>['atISO','projectId','productId','value'].includes(key))&&ISO(action.ack.atISO)&&action.ack.atISO>=action.atISO,'ACTION_ACK_INVALID');
  for(const key of ['projectId','productId'])if(action.ack[key]!==undefined)need(ID.test(action.ack[key]),'ACTION_ACK_ID_INVALID');
  if(action.ack.value!==undefined)need(typeof action.ack.value==='string'&&action.ack.value.length<=32768,'ACTION_ACK_VALUE_INVALID');
  previousBoundary=action.ack.atISO;
 }
 need(pending<=1&&(!complete||pending===0),'PENDING_ACTION_STOP_NO_BLIND_RETRY');
 for(const key of PREFERENCE_KEYS){
  const acknowledgments=journal.actions.filter(action=>action.kind==='preference'&&action.preferenceKey===key&&action.ack);
  const last=acknowledgments.at(-1);
  if(last)need(typeof last.ack.value==='string'&&journal.preferences[key]===last.ack.value,'PREFERENCE_LAST_ACK_VALUE_REQUIRED');
  else need(journal.preferences[key]===null,'PREFERENCE_VALUE_WITHOUT_ACK');
 }
 return journal;
}
export function validateManager(manager,pre){
 need(manager?.id===pre.ids.actor&&manager.active===true&&manager.sessionVersion===0&&manager.payScheme==='NONE'&&manager.passwordDisabled===true,'CURRENT_FRESH_MANAGER_REQUIRED');
 same(manager.roles,['MANAGER'],'CURRENT_MANAGER_ROLE_CHANGED');return manager;
}
async function identity(tx,readOnly){
 const[row]=await tx.$queryRawUnsafe("SELECT current_database() name,current_schema() schema,current_setting('transaction_read_only') readonly,NOT pg_is_in_recovery() AS \"primary\"");
 need(row?.name==='crm'&&row.schema==='public'&&row.primary===true&&row.readonly===(readOnly?'on':'off'),'DATABASE_TARGET_MISMATCH');
}
async function readOnly(db,work){return db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');await identity(tx,true);return work(tx);},{isolationLevel:'RepeatableRead',maxWait:10000,timeout:120000});}
async function names(tx){const rows=await tx.$queryRawUnsafe("SELECT tablename name FROM pg_tables WHERE schemaname='public' ORDER BY tablename");const result=rows.map(row=>row.name);need(result.length>30&&result.length<150&&TABLES.every(table=>result.includes(table))&&result.includes('ApiToken')&&result.includes('OrgSetting')&&result.includes('UserPreference'),'PUBLIC_SCHEMA_REQUIRED');return result;}
async function fingerprint(tx,query,values=[]){
 const[row]=await tx.$queryRawUnsafe("SELECT count(*)::text count,encode(sha256(convert_to(COALESCE(string_agg(h,'' ORDER BY h),''),'UTF8')),'hex') hash FROM (SELECT "+rowHash('r')+" h FROM ("+query+") r) hashes",...values);
 need(row&&/^(?:0|[1-9][0-9]*)$/.test(row.count??'')&&HASH.test(row.hash??''),'FINGERPRINT_INVALID');return row;
}
async function schema(tx){
 const queries=[
  "SELECT * FROM information_schema.columns WHERE table_schema='public'",
  "SELECT t.relname,c.conname,pg_get_constraintdef(c.oid,true) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public'",
  "SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public'",
  "SELECT t.typname,e.enumlabel,e.enumsortorder FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public'",
  "SELECT c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,true) definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'",
  "SELECT p.proname,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p')",
  "SELECT * FROM pg_sequences WHERE schemaname='public'",
 ];
 const hashes=[];for(const query of queries)hashes.push(await fingerprint(tx,query));return digest(hashes);
}
async function orgClock(tx){
 const full=await fingerprint(tx,'SELECT t.* FROM "OrgSetting" t');
 const otherRows=await fingerprint(tx,'SELECT t.* FROM "OrgSetting" t WHERE t.key<>$1',['telegram.botUsername']);
 const rows=await tx.$queryRawUnsafe('SELECT key,encode(sha256(convert_to(to_jsonb(t.value)::text,\'UTF8\')),\'hex\') AS "valueHash",encode(sha256(convert_to((to_jsonb(t)-\'updatedAt\')::text,\'UTF8\')),\'hex\') AS "stableFieldsHash",'+iso('t."updatedAt"')+' AS "updatedAt" FROM "OrgSetting" t WHERE key=$1','telegram.botUsername');
 need(rows.length<=1,'BOT_SINGLETON_REQUIRED');return {full,otherRows,bot:rows[0]??null};
}
export function compareOrgClock(before,after){
 same(before.otherRows,after.otherRows,'OTHER_ORGSETTING_CHANGED');need(before.full.count===after.full.count,'ORGSETTING_COUNT_CHANGED');
 if(!before.bot||!after.bot){need(before.bot===after.bot,'BOT_SETTING_ADDED_REMOVED');same(before.full,after.full,'ORGSETTING_CHANGED');return {changed:false};}
 need(before.bot.key===after.bot.key&&before.bot.key==='telegram.botUsername'&&before.bot.valueHash===after.bot.valueHash&&before.bot.stableFieldsHash===after.bot.stableFieldsHash,'BOT_STABLE_FIELDS_CHANGED');
 need(ISO(before.bot.updatedAt)&&ISO(after.bot.updatedAt)&&after.bot.updatedAt>=before.bot.updatedAt,'BOT_CLOCK_MOVED_BACKWARD');
 const changed=before.bot.updatedAt!==after.bot.updatedAt;
 if(!changed)same(before.full,after.full,'BOT_CLOCK_INCOHERENT');
 else need(before.full.hash!==after.full.hash,'BOT_FULL_FINGERPRINT_INCOHERENT');
 return {changed};
}
function emptyRows(){return Object.fromEntries(TABLES.map(table=>[table,[]]));}
async function outside(tx,scope){
 const tables=await names(tx),rows={};
 for(const table of tables){
  const ids=scope?.rows?.[table]?.map(row=>row.id)??[];
  if(table==='UserPreference'&&scope?.preferences?.length){
   rows[table]=await fingerprint(tx,'SELECT t.* FROM "UserPreference" t WHERE NOT(t."userId"=$1 AND t.key=ANY($2::text[]))',[scope.actorId,scope.preferences.map(row=>row.key)]);
  }else rows[table]=await fingerprint(tx,'SELECT t.* FROM '+quote(table)+' t'+(ids.length?' WHERE NOT(t.id=ANY($1::text[]))':''),ids.length?[ids]:[]);
 }
 return {tables,rows,schema:await schema(tx)};
}
async function coherent(tx,scope){
 const snapshot=await outside(tx,scope),apiClock=await captureTokenClockEvidence(tx),botClock=await orgClock(tx);
 same(snapshot.rows.ApiToken,apiClock.full,'API_CLOCK_SNAPSHOT_NOT_COHERENT');same(snapshot.rows.OrgSetting,botClock.full,'BOT_CLOCK_SNAPSHOT_NOT_COHERENT');
 return {...snapshot,apiClock,botClock};
}
export function originalMatch(current,baseline){
 same(current.tables,baseline.tables,'PUBLIC_TABLES_CHANGED');same(current.schema,baseline.schema,'ORIGINAL_SCHEMA_CHANGED');
 validateTokenClockEvidence(baseline.apiClock);validateTokenClockEvidence(current.apiClock);
 same(current.rows.ApiToken,current.apiClock.full,'API_CLOCK_SNAPSHOT_NOT_COHERENT');same(current.rows.OrgSetting,current.botClock.full,'BOT_CLOCK_SNAPSHOT_NOT_COHERENT');
 const api=compareTokenClockEvidence(baseline.apiClock,current.apiClock),bot=compareOrgClock(baseline.botClock,current.botClock);
 for(const table of baseline.tables)if(!['ApiToken','OrgSetting'].includes(table))same(current.rows[table],baseline.rows[table],'ORIGINAL_ROWS_CHANGED');
 return {originalsPreserved:true,apiClockChanged:api.changed,botClockChanged:bot.changed};
}
async function enabledPlugins(tx,input){const rows=await tx.$queryRawUnsafe('SELECT id,version,"apiVersion" FROM "Plugin" WHERE enabled=true ORDER BY id');validatePluginPolicy(rows,input);return rows;}
async function now(tx){const[row]=await tx.$queryRawUnsafe("SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') at");return row.at;}
async function absent(tx,ids){
 for(const[table,id]of [['User',ids.actor],['Client',ids.client],['Project',ids.projectB]]){const[row]=await tx.$queryRawUnsafe('SELECT count(*)::int n FROM '+quote(table)+' WHERE id=$1',id);need(row.n===0,'PLANNED_ID_ALREADY_EXISTS');}
 const[prefs]=await tx.$queryRawUnsafe('SELECT count(*)::int n FROM "UserPreference" WHERE "userId"=$1',ids.actor);need(prefs.n===0,'PLANNED_PREFERENCES_EXIST');
}
export async function plan(db,input,secret){
 basic(input);
 return readOnly(db,async tx=>{
  await enabledPlugins(tx,input);
  const ids={actor:randomUUID(),client:randomUUID(),projectB:randomUUID()};await absent(tx,ids);
  const baseline=await coherent(tx),createdAt=await now(tx);
  return sign({namespace:NS,kind:'pre',runId:input.runId,revision:input.revision,createdAt,ids,tags:tags(input.runId),baseline,prefsOriginal:Object.fromEntries(PREFERENCE_KEYS.map(key=>[key,null])),noHookPolicy:input.noHookPolicy??null},secret);
 });
}
function preValid(pre,input,secret){
 verifySigned(pre,secret,'pre',input);need(ISO(pre.createdAt)&&UUID.test(pre.ids?.actor??'')&&UUID.test(pre.ids?.client??'')&&UUID.test(pre.ids?.projectB??'')&&new Set(Object.values(pre.ids)).size===3,'PRE_SCOPE_IDS_INVALID');
 same(pre.tags,tags(input.runId),'PRE_TAGS_CHANGED');same(pre.prefsOriginal,Object.fromEntries(PREFERENCE_KEYS.map(key=>[key,null])),'FRESH_PREF_BASELINE_REQUIRED');
 return pre;
}
async function metadata(tx,table,where,values=[],extra=''){
 return tx.$queryRawUnsafe('SELECT t.id,'+rowHash('t')+' hash,'+iso('t."createdAt"')+' created,CASE WHEN to_jsonb(t) ? \'updatedAt\' THEN to_char((to_jsonb(t)->>\'updatedAt\')::timestamp,\'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') ELSE NULL END updated'+extra+' FROM '+quote(table)+' t WHERE '+where+' ORDER BY t.id',...values);
}
async function moneyZero(tx,pre,projectIds,productIds,configIds){
 const checks=[
  ['Task','"projectId"=ANY($1::text[]) OR "productId"=ANY($2::text[]) OR "assigneeId"=$3',[projectIds,productIds,pre.ids.actor]],
  ['Work','"projectId"=ANY($1::text[]) OR "productId"=ANY($2::text[])',[projectIds,productIds]],
  ['File','"projectId"=ANY($1::text[]) OR "productId"=ANY($2::text[]) OR "uploadedById"=$3',[projectIds,productIds,pre.ids.actor]],
  ['Payment','"projectId"=ANY($1::text[]) OR "createdById"=$2',[projectIds,pre.ids.actor]],
  ['PayrollEntry','"projectId"=ANY($1::text[]) OR "productId"=ANY($2::text[]) OR "userId"=$3',[projectIds,productIds,pre.ids.actor]],
  ['Payout','"userId"=$1 OR "createdById"=$1',[pre.ids.actor]],
  ['ProjectMaterial','"productId"=ANY($1::text[])',[productIds]],
  ['StockMovement','"productId"=ANY($1::text[]) OR "createdById"=$2',[productIds,pre.ids.actor]],
  ['ProductPercentageParticipant','"configId"=ANY($1::text[]) OR "userId"=$2',[configIds,pre.ids.actor]],
  ['ProductPercentageCompletion','"productId"=ANY($1::text[]) OR "recipientId"=$2 OR "completedById"=$2',[productIds,pre.ids.actor]],
  ['ProductStagePayPool','"productId"=ANY($1::text[]) OR "legacyProjectId"=ANY($2::text[]) OR "createdById"=$3',[productIds,projectIds,pre.ids.actor]],
  ['ProductStageSettlement','"productId"=ANY($1::text[]) OR "projectId"=ANY($2::text[]) OR "closedById"=$3',[productIds,projectIds,pre.ids.actor]],
  ['NotificationPreference','"userId"=$1',[pre.ids.actor]],
 ];
 for(const[table,where,values]of checks){const[row]=await tx.$queryRawUnsafe('SELECT count(*)::int n FROM '+quote(table)+' WHERE '+where,...values);need(row.n===0,'OWN_UNSAFE_LINKS_'+table.toUpperCase());}
}
async function graph(tx,pre,journal){
 const rows=emptyRows(),actorId=pre.ids.actor;
 const users=await tx.$queryRawUnsafe('SELECT id,roles::text[] roles,active,"sessionVersion","payScheme"::text AS "payScheme",("passwordHash"=$2) "passwordDisabled",(name=$3 AND email=$4) AS "tagOK" FROM "User" WHERE id=$1',actorId,'QA111_STAGE_DISABLED_NOT_A_PASSWORD_HASH',pre.tags.actor,'qa111-stage-'+pre.runId+'@invalid.test');
 const clients=await tx.$queryRawUnsafe('SELECT id,(name=$2 AND phone=$3 AND email IS NULL AND "legacyId" IS NULL) valid FROM "Client" WHERE id=$1',pre.ids.client,pre.tags.client,'111');
 const projects=await tx.$queryRawUnsafe('SELECT id,number,stage::text stage,title,"clientId","managerId","createdById","deletedAt","coverFileId",currency FROM "Project" WHERE id=$1 OR ("clientId"=$2 AND title=$3)',pre.ids.projectB,pre.ids.client,pre.tags.projectA);
 const setup=users.length+clients.length+projects.filter(row=>row.id===pre.ids.projectB).length;
 need(setup===0||setup===3,'PARTIAL_SETUP_STOP');
 if(setup===0){need(projects.length===0,'ORPHAN_OWN_PROJECT_STOP');return {actorId,rows,preferences:[],scopegraph:{projectA:null,projectB:null,products:[]},manager:null};}
 validateManager(users[0],pre);need(users[0].tagOK===true&&clients[0].valid===true,'FRESH_ACTOR_CLIENT_TAGS_CHANGED');
 need(projects.length>=1&&projects.length<=2,'EXACT_TWO_PROJECT_SCOPE_REQUIRED');
 for(const p of projects)need(p.clientId===pre.ids.client&&p.managerId===actorId&&p.createdById===actorId&&p.deletedAt===null&&p.coverFileId===null&&p.currency==='BYN'&&STAGES.includes(p.stage)&&p.title===(p.id===pre.ids.projectB?pre.tags.projectB:pre.tags.projectA),'PROJECT_LINEAGE_CHANGED');
 const projectIds=projects.map(row=>row.id),A=projects.find(row=>row.id!==pre.ids.projectB),B=projects.find(row=>row.id===pre.ids.projectB);
 const products=await tx.$queryRawUnsafe('SELECT id,"projectId",number,status::text status,title,(quantity=1 AND ("expectedPrice" IS NULL OR "expectedPrice"=0) AND ("initialPrice" IS NULL OR "initialPrice"=0) AND "engineerId" IS NULL AND "assemblerId" IS NULL AND "mounterId" IS NULL AND "surveyorId" IS NULL AND "sketchFileId" IS NULL AND "deletedAt" IS NULL AND "createdById"=$2) valid FROM "Product" WHERE "projectId"=ANY($1::text[]) ORDER BY id',projectIds,actorId);
 need(products.length<=10&&new Set(products.map(row=>row.title)).size===products.length,'PRODUCT_SCOPE_LIMIT_OR_DUPLICATE');
 for(const p of products)need(p.valid===true&&pre.tags.products.includes(p.title)&&STATUSES.includes(p.status),'UNSAFE_OWN_PRODUCT');
 const productIds=products.map(row=>row.id);
 rows.User=await metadata(tx,'User','t.id=$1',[actorId]);rows.Client=await metadata(tx,'Client','t.id=$1',[pre.ids.client]);
 rows.Project=await metadata(tx,'Project','t.id=ANY($1::text[])',[projectIds]);rows.Product=await metadata(tx,'Product','t.id=ANY($1::text[])',[productIds]);
 rows.ProductPercentageConfig=await metadata(tx,'ProductPercentageConfig','t."productId"=ANY($1::text[])',[productIds],',"productId",kind::text kind,revision');
 need(rows.ProductPercentageConfig.length===3*products.length&&rows.ProductPercentageConfig.every(row=>row.revision===1),'DEFAULT_CONFIG_SCOPE_CHANGED');
 const configIds=rows.ProductPercentageConfig.map(row=>row.id);
 await moneyZero(tx,pre,projectIds,productIds,configIds);
 rows.ProductStatusHistory=await metadata(tx,'ProductStatusHistory','t."productId"=ANY($1::text[])',[productIds],',"productId","changedById","fromStatus"::text AS "fromStatus","toStatus"::text AS "toStatus"');
 need(rows.ProductStatusHistory.every(row=>row.changedById===actorId&&(row.fromStatus===null||STATUSES.includes(row.fromStatus))&&STATUSES.includes(row.toStatus)),'PRODUCT_HISTORY_OUTSIDE_OWN');
 rows.ProjectStageHistory=await metadata(tx,'ProjectStageHistory','t."projectId"=ANY($1::text[])',[projectIds],',"projectId","changedById","fromStage"::text AS "fromStage","toStage"::text AS "toStage"');
 need(rows.ProjectStageHistory.every(row=>row.changedById===actorId&&(row.fromStage===null||STAGES.includes(row.fromStage))&&STAGES.includes(row.toStage)),'PROJECT_HISTORY_OUTSIDE_OWN');
 rows.ChangeLog=await metadata(tx,'ChangeLog','t."actorId"=$1',[actorId],',"actorType","entity","entityId",action,source');
 need(rows.ChangeLog.every(row=>row.actorType==='user'&&row.source==='web'&&((row.entity==='project'&&projectIds.includes(row.entityId)&&['create','stage'].includes(row.action))||(row.entity==='product'&&productIds.includes(row.entityId)&&['create','status','inline.update','update','initialPrice.capture'].includes(row.action)))),'UNKNOWN_OWN_AUDIT');
 rows.DomainEvent=await metadata(tx,'DomainEvent','t.actor=$1',[actorId],',type,("processedAt" IS NOT NULL) processed,("lastError" IS NULL) delivered,payload->>\'projectId\' AS "projectId",payload->>\'productId\' AS "productId"');
 need(rows.DomainEvent.every(row=>row.processed===true&&row.delivered===true&&((['project.created','project.stageChanged'].includes(row.type)&&projectIds.includes(row.projectId))||(row.type==='product.statusChanged'&&productIds.includes(row.productId)))),'UNKNOWN_OR_PENDING_OWN_EVENT');
 const links=[...projectIds.map(id=>'/projects/'+id),...productIds.map(id=>'/products/'+id)];
 rows.Notification=await metadata(tx,'Notification','t.link=ANY($1::text[]) AND t."createdAt">=$2::timestamp',[links,pre.createdAt],',type,link');
 need(rows.Notification.every(row=>{
  if(!['project.created','project.stageChanged','product.statusChanged'].includes(row.type)||!links.includes(row.link))return false;
  const subject=row.link.startsWith('/projects/')?row.link.slice('/projects/'.length):row.link.slice('/products/'.length);
  return rows.DomainEvent.some(event=>event.type===row.type&&event.created<=row.created&&(row.type==='product.statusChanged'?event.productId===subject:event.projectId===subject));
 }),'UNKNOWN_NOTIFICATION_OWNERSHIP');
 const preferences=await tx.$queryRawUnsafe('SELECT "userId",key,value,'+rowHash('t')+' hash FROM "UserPreference" t WHERE "userId"=$1 ORDER BY key',actorId);
 const pendingPreference=journal.actions.find(action=>action.ack===null&&action.kind==='preference');
 need(preferences.length<=2&&preferences.every(row=>PREFERENCE_KEYS.includes(row.key)&&(journal.preferences[row.key]===row.value||pendingPreference?.preferenceKey===row.key)),'PREFERENCE_LAST_ACK_REQUIRED');
 for(const table of TABLES)for(const row of rows[table])need(ISO(row.created)&&row.created>=pre.createdAt&&HASH.test(row.hash??''),'OWN_ROW_TIME_HASH_INVALID');
 const scopegraph={projectA:A?{id:A.id,number:A.number,stage:A.stage,path:'/projects/'+A.id}:null,projectB:{id:B.id,number:B.number,stage:B.stage,path:'/projects/'+B.id},products:products.map(p=>({id:p.id,projectId:p.projectId,number:p.number,status:p.status,titleSlot:pre.tags.products.indexOf(p.title)+1,path:'/products/'+p.id}))};
 for(const action of journal.actions)if(action.ack){if(action.ack.projectId)need(projectIds.includes(action.ack.projectId),'ACK_PROJECT_OUTSIDE_SCOPE');if(action.ack.productId)need(productIds.includes(action.ack.productId),'ACK_PRODUCT_OUTSIDE_SCOPE');}
 return {actorId,rows,preferences,scopegraph,manager:{id:actorId,roles:['MANAGER'],sessionVersion:0}};
}
async function backrefs(tx,scope,pre){
 const ids=Object.fromEntries(TABLES.map(table=>[table,scope.rows[table].map(row=>row.id)]));
 const fks=await tx.$queryRawUnsafe(`SELECT c.conname name,sn.nspname source_schema,s.relname source,r.relname target,
  ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(n,ord) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.n ORDER BY k.ord) sc,
  ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(n,ord) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.n ORDER BY k.ord) tc
  FROM pg_constraint c JOIN pg_class s ON s.oid=c.conrelid JOIN pg_namespace sn ON sn.oid=s.relnamespace
  JOIN pg_class r ON r.oid=c.confrelid JOIN pg_namespace rn ON rn.oid=r.relnamespace
  WHERE c.contype='f' AND rn.nspname='public' AND r.relname=ANY($1::text[])`,TABLES);
 for(const fk of fks){
  need(fk.source_schema==='public'&&Array.isArray(fk.sc)&&Array.isArray(fk.tc)&&fk.sc.length>0&&fk.sc.length===fk.tc.length,'FK_SHAPE_UNKNOWN');
  const join=fk.sc.map((col,index)=>'s.'+quote(col)+'=r.'+quote(fk.tc[index])).join(' AND '),allowed=ids[fk.source]??[];
  const[row]=await tx.$queryRawUnsafe('SELECT count(*)::int n FROM '+quote(fk.source)+' s JOIN '+quote(fk.target)+' r ON '+join+' WHERE r.id=ANY($1::text[])'+(allowed.length?' AND NOT(s.id=ANY($2::text[]))':''),ids[fk.target],...(allowed.length?[allowed]:[]));
  need(row.n===0,'UNKNOWN_INBOUND_REFERENCE');
 }
 // Typed scalar references; numeric UI Project IDs never use generic substring search.
 const columns=await tx.$queryRawUnsafe("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND data_type IN ('text','character varying') AND (column_name ~ '(userId|ownerId|actorId|createdById|changedById|completedById|deletedById|uploadedById|projectId|legacyProjectId|productId)$') ORDER BY table_name,column_name");
 for(const column of columns){
  const table=column.table_name,name=column.column_name,allowed=ids[table]??[];
  const targets=/[Pp]rojectId$/.test(name)?ids.Project:/[Pp]roductId$/.test(name)?ids.Product:[pre.ids.actor];
  let exclude=allowed.length?' AND NOT(t.id=ANY($2::text[]))':'';
  const values=[targets];if(allowed.length)values.push(allowed);
  if(table==='UserPreference'){exclude=' AND NOT(t."userId"=$2 AND t.key=ANY($3::text[]))';values.push(pre.ids.actor,scope.preferences.map(row=>row.key));}
  const[row]=await tx.$queryRawUnsafe('SELECT count(*)::int n FROM '+quote(table)+' t WHERE t.'+quote(name)+'=ANY($1::text[])'+exclude,...values);
  need(row.n===0,'UNKNOWN_TYPED_REFERENCE');
 }
 const projectIds=ids.Project,productIds=ids.Product;
 for(const[table,predicate,values]of [
  ['ChangeLog','("actorId"=$1 OR (entity=\'project\' AND "entityId"=ANY($2::text[])) OR (entity=\'product\' AND "entityId"=ANY($3::text[])))',[pre.ids.actor,projectIds,productIds]],
  ['DomainEvent','(actor=$1 OR payload->>\'projectId\'=ANY($2::text[]) OR payload->>\'productId\'=ANY($3::text[]))',[pre.ids.actor,projectIds,productIds]],
  ['Notification','link=ANY($1::text[])',[[...projectIds.map(id=>'/projects/'+id),...productIds.map(id=>'/products/'+id)]]],
 ]){
  const[row]=await tx.$queryRawUnsafe('SELECT count(*)::int n FROM '+quote(table)+' WHERE '+predicate+' AND NOT(id=ANY($'+(values.length+1)+'::text[]))',...values,ids[table]);
  need(row.n===0,'UNKNOWN_EVENT_AUDIT_LINK');
 }
}
function emptyJournal(pre){return {runId:pre.runId,revision:pre.revision,actions:[],preferences:Object.fromEntries(PREFERENCE_KEYS.map(key=>[key,null]))};}
export async function prepare(db,input,pre,secret){
 preValid(pre,input,secret);keys(input.durablePre,['hash','fsynced'],'DURABLE_PRE_REQUIRED');
 need(input.durablePre.fsynced===true&&input.durablePre.hash===digest(pre),'DURABLE_PRE_DIGEST_REQUIRED');
 same(input.noHookPolicy??null,pre.noHookPolicy,'NOHOOK_POLICY_CHANGED');
 const fresh=await readOnly(db,async tx=>{await enabledPlugins(tx,input);await absent(tx,pre.ids);const state=await coherent(tx);originalMatch(state,pre.baseline);return state;});
 return db.$transaction(async tx=>{
  await identity(tx,false);
  await tx.$queryRawUnsafe('SELECT 1 FROM pg_advisory_xact_lock(18435,55001)');
  await tx.$executeRawUnsafe('LOCK TABLE '+fresh.tables.map(quote).join(',')+' IN SHARE ROW EXCLUSIVE MODE');
  await absent(tx,pre.ids);const raw=await outside(tx);same(raw.rows,fresh.rows,'PREPARE_RAW_CAS_CHANGED');same(raw.schema,fresh.schema,'PREPARE_SCHEMA_CHANGED');await enabledPlugins(tx,input);
  await tx.user.create({data:{id:pre.ids.actor,email:'qa111-stage-'+pre.runId+'@invalid.test',name:pre.tags.actor,passwordHash:'QA111_STAGE_DISABLED_NOT_A_PASSWORD_HASH',roles:['MANAGER'],active:true,payScheme:'NONE'}});
  await tx.client.create({data:{id:pre.ids.client,name:pre.tags.client,phone:'111'}});
  const max=(await tx.project.aggregate({_max:{numberInt:true}}))._max.numberInt??0;
  await tx.project.create({data:{id:pre.ids.projectB,number:String(max+1),numberInt:max+1,title:pre.tags.projectB,stage:'PAUSED',currency:'BYN',clientId:pre.ids.client,managerId:pre.ids.actor,createdById:pre.ids.actor}});
  const scoped=await graph(tx,pre,emptyJournal(pre));need(scoped.rows.ProjectStageHistory.length===0,'PAUSED_BASELINE_HISTORY_MUST_BE_EMPTY');
  const actual=await outside(tx,scoped);same(actual.rows,fresh.rows,'PREPARE_ORIGINALS_CHANGED');same(actual.schema,fresh.schema,'PREPARE_ORIGINAL_SCHEMA_CHANGED');await backrefs(tx,scoped,pre);
  return sign({namespace:NS,kind:'checkpoint',runId:pre.runId,revision:pre.revision,createdAt:await now(tx),pre,initial:scoped},secret);
 },{isolationLevel:'Serializable',maxWait:10000,timeout:120000});
}
export async function capture(db,input,base,journal,secret){
 const pre=preValid(basePre(base,secret,input),input,secret);validateJournal(journal,pre);
 return readOnly(db,async tx=>{
  await enabledPlugins(tx,input);const scope=await graph(tx,pre,journal);
  if(base.kind==='checkpoint'){const cp=verifySigned(base,secret,'checkpoint',input);for(const table of ['User','Client'])same(scope.rows[table],cp.initial.rows[table],'IMMUTABLE_SETUP_ROW_CHANGED');}
  await backrefs(tx,scope,pre);
  const current=await coherent(tx,scope),matched=originalMatch(current,pre.baseline);
  return sign({namespace:NS,kind:'observation',runId:pre.runId,revision:pre.revision,createdAt:await now(tx),preHash:digest(pre),journalHash:digest(journal),scopegraph:scope.scopegraph,rows:scope.rows,preferences:scope.preferences,manager:scope.manager,originalMatch:matched,clocks:{api:current.apiClock,org:current.botClock},outside:current},secret);
 });
}
export function exactCleanupState(current,observation){same(current.rows,observation.rows,'OWN_ROW_CAS_CHANGED');same(current.preferences,observation.preferences,'OWN_PREFERENCE_CAS_CHANGED');same(current.scopegraph,observation.scopegraph,'OWN_GRAPH_CAS_CHANGED');}
export async function cleanup(db,input,base,observation,journal,secret){
 const pre=preValid(basePre(base,secret,input),input,secret);verifySigned(observation,secret,'observation',input);
 need(observation.preHash===digest(pre)&&observation.journalHash===digest(journal),'OBSERVATION_BASELINE_JOURNAL_CHANGED');validateJournal(journal,pre,{complete:true});
 const fresh=await readOnly(db,async tx=>{const scope=await graph(tx,pre,journal);exactCleanupState(scope,observation);await backrefs(tx,scope,pre);const current=await coherent(tx,scope);originalMatch(current,pre.baseline);return current;});
 const counts=await db.$transaction(async tx=>{
  await identity(tx,false);await tx.$executeRawUnsafe('LOCK TABLE '+fresh.tables.map(quote).join(',')+' IN SHARE ROW EXCLUSIVE MODE');
  const scope=await graph(tx,pre,journal);exactCleanupState(scope,observation);await backrefs(tx,scope,pre);
  const original=await outside(tx,scope);same(original.rows,fresh.rows,'CLEANUP_ORIGINAL_RAW_CAS_CHANGED');same(original.schema,fresh.schema,'CLEANUP_ORIGINAL_SCHEMA_CHANGED');
  const removed={};
  // Config-first; composite preference PK is disposed only after owned logs.
  for(const table of ORDER){
   removed[table]=0;
   if(table==='UserPreference'){
    for(const pref of scope.preferences){
     need(pre.prefsOriginal[pref.key]===null&&journal.preferences[pref.key]===pref.value,'PREFERENCE_DELETE_SCOPE_INVALID');
     const n=await tx.$executeRawUnsafe('DELETE FROM "UserPreference" t WHERE t."userId"=$1 AND t.key=$2 AND t.value=$3 AND '+rowHash('t')+'=$4',pre.ids.actor,pref.key,pref.value,pref.hash);
     need(n===1,'PREFERENCE_DELETE_CAS_FAILED');removed[table]++;
    }
   }else for(const row of scope.rows[table]){
    const n=await tx.$executeRawUnsafe('DELETE FROM '+quote(table)+' t WHERE t.id=$1 AND '+rowHash('t')+'=$2',row.id,row.hash);
    need(n===1,'DELETE_OWN_CAS_FAILED');removed[table]++;
   }
  }
  const after=await outside(tx);same(after.rows,fresh.rows,'CLEANUP_ORIGINAL_ROWS_CHANGED');same(after.schema,fresh.schema,'CLEANUP_ORIGINAL_SCHEMA_CHANGED');
  const[zero]=await tx.$queryRawUnsafe('SELECT count(*)::int n FROM "UserPreference" WHERE "userId"=$1',pre.ids.actor);need(zero.n===0,'OWN_PREFERENCES_NOT_ZERO');
  return removed;
 },{isolationLevel:'Serializable',maxWait:10000,timeout:120000});
 let verified;
 try{verified=await readOnly(db,async tx=>{await absent(tx,pre.ids);const current=await coherent(tx);return {...originalMatch(current,pre.baseline),fullOriginalByteMatch:canonical(current.rows)===canonical(pre.baseline.rows)};});}
 catch{return {status:'CLEANED_WITH_LATER_EXTERNAL_CHANGE',runId:pre.runId,revision:pre.revision,counts,cleanupCommitted:true,originalsPreservedAtCommit:true,postCommitVerified:false};}
 return {status:'CLEANED',runId:pre.runId,revision:pre.revision,counts,cleanupCommitted:true,...verified,freshOriginalsPreserved:true};
}
export async function handoff(db,input,checkpoint,secret){
 const cp=verifySigned(checkpoint,secret,'checkpoint',input),pre=preValid(cp.pre,input,secret);
 const manager=await readOnly(db,async tx=>{
  await enabledPlugins(tx,input);
  const rows=await tx.$queryRawUnsafe('SELECT id,roles::text[] roles,active,"sessionVersion","payScheme"::text AS "payScheme",("passwordHash"=$2) "passwordDisabled",(name=$3 AND email=$4) AS "tagOK" FROM "User" WHERE id=$1',pre.ids.actor,'QA111_STAGE_DISABLED_NOT_A_PASSWORD_HASH',pre.tags.actor,'qa111-stage-'+pre.runId+'@invalid.test');
  need(rows.length===1&&rows[0].tagOK===true,'FRESH_HANDOFF_ACTOR_MISSING');
  same(await metadata(tx,'User','t.id=$1',[pre.ids.actor]),cp.initial.rows.User,'HANDOFF_ACTOR_CAS_CHANGED');
  return validateManager(rows[0],pre);
 });
 const cookies=[];
 for(const name of ['authjs.session-token','__Secure-authjs.session-token'])cookies.push({name,value:await encode({secret,salt:name,token:{id:manager.id,roles:manager.roles,sessionVersion:manager.sessionVersion},maxAge:15*60})});
 // Caller-private memory only. main deliberately has no handoff operation.
 return {origin:'https://staging-crm.peromebel.by',runId:pre.runId,revision:pre.revision,profile:{id:manager.id,roles:['MANAGER'],sessionVersion:manager.sessionVersion,cookies}};
}
export async function main(){
 let db,result;
 try{
  const encoded=process.env.CRM_STAGING_BROWSER_INPUT;need(typeof encoded==='string'&&encoded.length<=128*1024,'BOUNDED_PRIVATE_INPUT_REQUIRED');
  const bytes=Buffer.from(encoded,'base64');need(bytes.toString('base64')===encoded,'CANONICAL_PRIVATE_INPUT_REQUIRED');
  const outer=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  const input=unpackFunctionalInput(outer),{secret}=stageGuard(input);
  const operation={plan:'inspect',prepare:'prepare',capture:'inspect',cleanup:'restore'}[input.phase];
  need(operation&&input.operation===operation,'CANONICAL_FIXTURE_OPERATION_REQUIRED');
  db=new PrismaClient({log:[],errorFormat:'minimal'});
  if(input.phase==='plan')result={status:'PLANNED',pre:await plan(db,input,secret)};
  else if(input.phase==='prepare')result={status:'PREPARED',checkpoint:await prepare(db,input,input.pre,secret)};
  else if(input.phase==='capture')result={status:'CAPTURED',observation:await capture(db,input,input.checkpoint??input.pre,input.journal,secret)};
  else result=await cleanup(db,input,input.checkpoint??input.pre,input.observation,input.journal,secret);
  result={status:'TECHNICAL_RESULT',phase:input.phase,wire:encodeFunctionalWire(result,{maxWireBytes:OUTPUT_WIRE_LIMIT})};
 }catch(error){process.exitCode=1;result={status:'STOP',code:error instanceof QaStop?error.checkId:/^TOKEN_CLOCK_[A-Z0-9_]{1,70}$/.test(error?.message??'')?error.message:'TASK111_STAGE_FIXTURE_STOP_PRESERVE_STATE'};}
 finally{if(db)try{await db.$disconnect();}catch{process.exitCode=1;result=result?.status==='TECHNICAL_RESULT'?{status:'STOP',code:'STAGE_FIXTURE_DISCONNECT_FAILED_AFTER_RESULT',technicalResult:result}:{status:'STOP',code:'STAGE_FIXTURE_DISCONNECT_FAILED'};}}
 return result;
}
// Root's reviewed bundle explicitly calls main(); importing this module never does.
