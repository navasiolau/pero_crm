// Root-only current-clock probe: SELECT only, no bearer/token authentication call.
// This independent historical comparison never changes task111's original comparator.
import {createHmac,timingSafeEqual} from 'node:crypto';
import {hostname} from 'node:os';
import {existsSync} from 'node:fs';
import {PrismaClient} from '@prisma/client';
import {captureTokenClockEvidence} from './crm-acceptance-token-clock.mjs';
const REVISION='87c404846bdb659a2f9f45e3b9d7a0a98c5ad17a',LEGACY_REVISION='322bd3d542e9d503e955127dc4c1f32644646bc4';
const LEGACY_RUN='fa98ed24-49a0-419e-b03d-09422a7625df',NS='PERO_ENGINEER_SKETCH_QA_112_V1';
const HASH=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const need=(ok,code)=>{if(!ok)throw Error(code);};
function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value!==null&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';return JSON.stringify(value);}
export function legacyTokenProjection(checkpoint,secret){
 need(checkpoint?.namespace===NS&&checkpoint.kind==='checkpoint'&&checkpoint.runId===LEGACY_RUN&&checkpoint.revision===LEGACY_REVISION&&HASH.test(checkpoint.signature??'')&&typeof secret==='string'&&secret.length>0,'TOKEN_PROBE_SIGNED_LEGACY_BINDING');
 const {signature,...body}=checkpoint,expected=createHmac('sha256',secret).update(NS+'\0'+canonical(body)).digest('hex');
 need(timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(expected,'hex')),'TOKEN_PROBE_LEGACY_SIGNATURE');
 const projection=checkpoint.baseline?.rows?.ApiToken;
 need(projection&&Object.keys(projection).sort().join('|')==='count|hash'&&projection.count==='3'&&/^[a-f0-9]{32}$/.test(projection.hash),'TOKEN_PROBE_LEGACY_PROJECTION');
 return {revision:LEGACY_REVISION,runId:LEGACY_RUN,count:projection.count,hash:projection.hash,signatureVerified:true};
}
export function tokenProbeGuard(input,env=process.env,container={host:hostname(),docker:existsSync('/.dockerenv')}){
 need(input&&Object.keys(input).sort().join('|')==='authorized|checkpoint|mode|operation|revision|runId'&&input.authorized===true&&input.operation==='inspect'&&input.mode==='token-clock'&&input.revision===REVISION&&UUID.test(input.runId??''),'TOKEN_PROBE_AUTHORIZED_BINDING');
 need(env.CRM_MODERNIZATION_TARGET==='staging'&&container.docker,'TOKEN_PROBE_STAGE_ONLY');
 let url,proof;try{url=new URL(env.DATABASE_URL??'');proof=JSON.parse(env.CRM_MODERNIZATION_STAGE_PROOF??'');}catch{throw Error('TOKEN_PROBE_ENV_INVALID');}
 const allowed=new Set(['schema','connection_limit','pool_timeout','connect_timeout','socket_timeout','sslmode']);
 need(['postgres:','postgresql:'].includes(url.protocol)&&url.hostname==='db'&&(url.port||'5432')==='5432'&&url.pathname==='/crm'&&!url.hash&&[...url.searchParams.keys()].every(key=>allowed.has(key)&&url.searchParams.getAll(key).length===1)&&(!url.searchParams.has('schema')||url.searchParams.get('schema')==='public'),'TOKEN_PROBE_DATABASE_BINDING');
 need(proof?.hostname==='crm-staging'&&proof.revision===REVISION&&proof.databaseVolume==='crm-staging_pgdata'&&HASH.test(proof.web??'')&&proof.web.startsWith(container.host)&&HASH.test(proof.database??'')&&HASH.test(proof.outerW07Sha256??''),'TOKEN_PROBE_PHYSICAL_PROOF');
 const secret=env.AUTH_SECRET??env.NEXTAUTH_SECRET,legacy=legacyTokenProjection(input.checkpoint,secret);
 return {legacy,proof};
}
export async function runTokenClockProbe(db,input,legacy){
 return db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  const[identity]=await tx.$queryRawUnsafe("SELECT current_database() name,current_schema() schema,NOT pg_is_in_recovery() AS "+'"primary"');
  need(identity?.name==='crm'&&identity.schema==='public'&&identity.primary===true,'TOKEN_PROBE_PRIMARY_IDENTITY');
  const evidence=await captureTokenClockEvidence(tx);
  need(evidence.stable.count==='3','TOKEN_PROBE_FIXED_COUNT');
  return {status:'TOKEN_CLOCK_CAPTURED',runId:input.runId,revision:input.revision,evidence,historicalComparison:{baselineRevision:legacy.revision,baselineRunId:legacy.runId,baselineCount:legacy.count,baselineHash:legacy.hash,currentCount:evidence.legacyStable.count,currentHash:evidence.legacyStable.hash,stableFieldsEqual:legacy.count===evidence.legacyStable.count&&legacy.hash===evidence.legacyStable.hash,signatureVerified:legacy.signatureVerified,exact111BeforeDecomposition:false,old111FullByteGuardPass:false},dbReadOnly:true,tokenAuthenticationCalled:false,mutations:false};
 },{isolationLevel:'RepeatableRead',maxWait:10000,timeout:120000});
}
export async function main(){
 let db,result;
 try{
  const encoded=process.env.CRM_STAGING_BROWSER_INPUT;need(typeof encoded==='string'&&encoded.length>0&&encoded.length<=96*1024,'TOKEN_PROBE_INPUT_BOUND');
  const bytes=Buffer.from(encoded,'base64');need(bytes.toString('base64')===encoded,'TOKEN_PROBE_CANONICAL_INPUT');
  const input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),{legacy}=tokenProbeGuard(input);
  db=new PrismaClient({log:[],errorFormat:'minimal'});result=await runTokenClockProbe(db,input,legacy);
 }catch(error){result={status:'TOKEN_CLOCK_STOP',code:/^[A-Z0-9_]{1,100}$/.test(error?.message??'')?error.message:'TOKEN_CLOCK_UNKNOWN'};process.exitCode=1;}
 finally{if(db)await db.$disconnect().catch(()=>{result={status:'TOKEN_CLOCK_STOP',code:'TOKEN_CLOCK_DISCONNECT'};process.exitCode=1;});}
 console.log(JSON.stringify(result));
}
const entry=process.argv[1],direct=!entry||import.meta.url===new URL('file:///'+entry.replaceAll('\\','/').replace(/^\//,'')).href;
if(direct&&process.env.CRM_STAGING_BROWSER_INPUT&&process.env.CRM_MODERNIZATION_TARGET==='staging')void main();
