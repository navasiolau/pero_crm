// Root-only координатор. Перед каждым POST/cleanup — неизменяемый подписанный intent.
// SAFETY D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md: STOP при mismatch/unknown ACK, без повторов.
import {createRequire} from 'node:module';
import {readFileSync,existsSync,lstatSync,realpathSync,openSync,writeFileSync,fsyncSync,closeSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {qaTransport,acceptanceWeb} from './crm-acceptance-transport.mjs';
import {immutablePublish} from './file-fixture113-runner.mjs';
import {need,canonical,digest,FIXTURE_NAMESPACE} from './file-fixture113-protocol.mjs';
import {FROZEN_SOURCES,FROZEN_EXTRA,derivedFrozenLibrary,ADAPTER_EXPORTS,ADAPTER_AUTORUN,bytesHash,verifyCompactContextAck,verifyParentRejoined,contextPacket} from './file-fixture113-context-smoke.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),results=path.resolve(acceptanceWeb,'test-results'),require=createRequire(import.meta.url),{build}=createRequire(require.resolve('tsx/package.json'))('esbuild');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,REV=/^[a-f0-9]{40}$/,SHA=/^[a-f0-9]{64}$/;
const NAMES=['file-fixture113-context-smoke.mjs','file-fixture113-context-smoke-entry.mjs','file-fixture113-context-smoke-runner.mjs','file-fixture113-context-smoke.test.mjs'];
export function contextSmokeSourceHashes(){
 return Object.fromEntries(NAMES.map(name=>[name,bytesHash(readFileSync(path.join(here,name)))]));
}
export function frozenLibraryPlugin(readFrozen=name=>readFileSync(path.join(here,name))){
 return {name:'task113-explicit-frozen-library-adapter',setup(builder){
  builder.onResolve({filter:/^task113:frozen-library$/},()=>({path:path.join(here,'file-fixture113-entry.mjs'),namespace:'task113-frozen-library'}));
  builder.onLoad({filter:/.*/,namespace:'task113-frozen-library'},async args=>({contents:derivedFrozenLibrary(readFrozen('file-fixture113-entry.mjs')),loader:'js',resolveDir:here}));
 }};
}
export async function contextSmokeBundle(readFrozen=name=>readFileSync(path.join(here,name))){
 for(const [name,expected]of Object.entries({...FROZEN_SOURCES,...FROZEN_EXTRA}))need(bytesHash(readFrozen(name))===expected,'FROZEN_PRODUCER_BYTES_CHANGED');
 const sources=contextSmokeSourceHashes(),compiled=await build({entryPoints:[path.join(here,'file-fixture113-context-smoke-entry.mjs')],bundle:true,write:false,platform:'node',format:'esm',target:'node22',external:['@prisma/client','@aws-sdk/client-s3','sharp'],banner:{js:'import {createRequire as task113ContextRequire} from "node:module"; const require=task113ContextRequire(import.meta.url);'},define:{__FIXTURE_SOURCE_HASHES__:JSON.stringify(FROZEN_SOURCES),__CONTEXT_SMOKE_SOURCE_HASHES__:JSON.stringify(sources)},plugins:[frozenLibraryPlugin(readFrozen)],minify:true,logLevel:'silent'});
 const bytes=Buffer.from(compiled.outputFiles[0].contents);need(bytes.length>0&&bytes.length<=256*1024,'EXISTING_CONTEXT_BUNDLE_CAP');
 return {bytes,sha256:bytesHash(bytes),sources,frozenSources:{...FROZEN_SOURCES},adapter:{sourceSha256:FROZEN_SOURCES['file-fixture113-entry.mjs'],removedAutorunSha256:bytesHash(Buffer.from(ADAPTER_AUTORUN)),privateExports:[...ADAPTER_EXPORTS],sourceFileModified:false}};
}
function privateResultsPath(file){
 need(path.isAbsolute(file??''),'ABSOLUTE_PRIVATE_RESULTS_PATH_REQUIRED');
 const absolute=path.resolve(file),relative=path.relative(results,absolute);
 need(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'PRIVATE_RESULTS_SCOPE_REQUIRED');
 need(existsSync(results)&&!lstatSync(results).isSymbolicLink()&&realpathSync(results).toLowerCase()===results.toLowerCase(),'PRIVATE_RESULTS_ROOT_REQUIRED');
 let current=absolute;while(current.toLowerCase()!==results.toLowerCase()){if(existsSync(current))need(!lstatSync(current).isSymbolicLink(),'REPARSE_CONTEXT_PATH_FORBIDDEN');current=path.dirname(current);}
 return absolute;
}
export function loadSignedParentPre(options){
 need(SHA.test(options?.preFileSha256??''),'HASHED_DURABLE_PARENT_PRE_REQUIRED');
 const bytes=readFileSync(privateResultsPath(options.preFile));need(bytesHash(bytes)===options.preFileSha256,'DURABLE_PARENT_PRE_BYTES_CHANGED');
 let stored;try{stored=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));}catch{throw Error('DURABLE_PARENT_PRE_JSON_REQUIRED');}
 const pre=stored.pre;
 need(stored.kind==='private-pre-receipt'&&pre?.namespace===FIXTURE_NAMESPACE&&pre.kind==='pre'&&pre.version===2&&pre.runId===options.runId&&pre.revision===options.revision&&SHA.test(pre.signature??''),'FRESH_SIGNED_PARENT13_PRE_REQUIRED');
 need(canonical(stored.sources)===canonical(FROZEN_SOURCES)&&canonical(pre.sources)===canonical(FROZEN_SOURCES),'FROZEN_PARENT13_PRE_SOURCES_REQUIRED');
 return pre;
}
export function contextSmokeCoordinator(options){
 need(options?.authorized===true&&UUID.test(options.runId??'')&&REV.test(options.revision??''),'ROOT_AUTHORIZED_SIGNED_PARENT13_REQUIRED');
 const pre=loadSignedParentPre(options),outputDir=privateResultsPath(options.outputDir);
 need(existsSync(outputDir)&&lstatSync(outputDir).isDirectory(),'EXISTING_PRIVATE_PARENT_OUTPUT_DIR_REQUIRED');
 let phase='ready',part=0,before,intent,ack,cleanupIntent,negativeIntent,priorObservation=options.priorObservation,sourceHashes,physicalIdentity;
 const publish=(kind,value)=>immutablePublish(path.join(outputDir,'context13-'+String(++part).padStart(3,'0')+'-'+kind+'.json'),value);
 async function execute(operation,mode,extra={}){
  const pack=await contextSmokeBundle();if(!sourceHashes)sourceHashes=pack.sources;need(canonical(sourceHashes)===canonical(pack.sources),'CONTEXT_SOURCES_CHANGED_DURING_LIFECYCLE');
  const input=contextPacket(pre,operation,mode,extra);
  const result=await qaTransport({target:'staging',revision:options.revision,outputDir}).execute(pack.bytes,operation,input);
  need(result.receipt?.identity?.hostname==='crm-staging'&&result.receipt.identity.revision===options.revision&&result.receipt.bundleSha256===pack.sha256&&result.receipt.exitCode===0,'ACTUAL_CONTEXT_PHYSICAL_TRANSPORT_REQUIRED');
  if(!physicalIdentity)physicalIdentity=result.receipt.identity;else need(canonical(physicalIdentity)===canonical(result.receipt.identity),'CONTEXT_PHYSICAL_IDENTITY_CHANGED');
  need(result.body?.status!=='STOP'&&Buffer.byteLength(JSON.stringify(result.body))<=64*1024,'CONTEXT_TRANSPORT_STOP_OR_CAP');
  return {body:result.body,receipt:result.receipt,pack};
 }
 const contextInput=()=>({contextBefore:before,contextBeforeSha256:digest(before)});
 const ackInput=()=>({...contextInput(),contextAck:ack,contextAckSha256:digest(ack)});
 async function stoppedOperation(fn){try{return await fn();}catch(error){phase='stopped-preserve-no-retry';throw error;}}
 return {
  async begin(){
   need(phase==='ready','ONE_CONTEXT_BEGIN_ONLY');phase='beginning';
   return stoppedOperation(async()=>{
    const result=await execute('inspect','context-before',priorObservation?{priorObservation}:{});
    need(result.body.status==='CONTEXT_BEFORE'&&result.body.before?.kind==='context-before'&&result.body.intent?.kind==='context-upload-intent','SIGNED_CONTEXT_BEFORE_INTENT_REQUIRED');
    before=result.body.before;intent=result.body.intent;
    need(intent.beforeSha256===digest(before)&&intent.preSha256===digest(pre)&&before.preSha256===digest(pre),'CONTEXT_BEFORE_INTENT_BINDING_REQUIRED');
    publish('before',{kind:'durable-parent13-context-before',before,receipt:result.receipt,sources:result.pack.sources,adapter:result.pack.adapter});
    publish('upload-intent',{kind:'durable-parent13-context-upload-intent',intent});
    phase='upload-intent-durable';return {beforeSha256:digest(before),intentSha256:digest(intent),actorId:before.media.target.actorId};
   });
  },
  async upload(){
   need(phase==='upload-intent-durable','ONE_PENDING_CONTEXT_UPLOAD_ONLY');phase='upload-dispatched-no-retry';
   return stoppedOperation(async()=>{
    const result=await execute('prepare','context-upload',{...contextInput(),contextIntent:intent,contextIntentSha256:digest(intent)});
    need(result.body.status==='CONTEXT_ACK'&&result.body.ack?.kind==='context-ack','GENUINE_SIGNED_CONTEXT_ACK_REQUIRED');ack=result.body.ack;
    need(ack.beforeSha256===digest(before)&&ack.intentSha256===digest(intent),'CONTEXT_ACK_INTENT_BINDING_REQUIRED');
    const proof=verifyCompactContextAck(pre,before,ack);
    need(canonical(proof)===canonical(ack.proof),'CONTEXT_ACK_PROOF_MISMATCH');
    publish('upload-ack',{kind:'durable-parent13-context-ack',ack,receipt:result.receipt});
    phase='child-ack-durable';return ack.proof;
   });
  },
  async cleanup(){
   need(phase==='child-ack-durable','KNOWN_SIGNED_CHILD_ACK_REQUIRED_BEFORE_CLEANUP');phase='cleanup-planning';
   return stoppedOperation(async()=>{
    const planned=await execute('inspect','context-cleanup-intent',ackInput());
    need(planned.body.status==='CONTEXT_CLEANUP_INTENT'&&planned.body.intent?.kind==='context-cleanup-intent','SIGNED_KNOWN_CHILD_CLEANUP_INTENT_REQUIRED');
    cleanupIntent=planned.body.intent;publish('cleanup-intent',{kind:'durable-parent13-child-cleanup-intent',intent:cleanupIntent,receipt:planned.receipt});
    phase='cleanup-dispatched-no-retry';
    const result=await execute('restore','context-cleanup',{...ackInput(),contextCleanupIntent:cleanupIntent,contextCleanupIntentSha256:digest(cleanupIntent)});
    need(result.body.status==='CONTEXT_CLEANED'&&result.body.ack?.kind==='context-cleanup-ack'&&result.body.ack.commitAck===true,'ACTUAL_CHILD_CLEANUP_COMMIT_ACK_REQUIRED');
    publish('cleanup-ack',{kind:'durable-parent13-child-cleanup-ack',ack:result.body.ack,receipt:result.receipt});
    const late=await execute('inspect','context-closed',contextInput());
    need(late.body.status==='CONTEXT_CLOSED'&&late.body.closed?.kind==='context-closed','LATE_PARENT13_REJOIN_REQUIRED');
    const proof=verifyParentRejoined(pre,before.parentSeal,late.body.closed.parentSeal);
    need(canonical(proof)===canonical(late.body.closed.proof),'PARENT13_REJOIN_PROOF_CHANGED');
    priorObservation=late.body.closed.parentSeal;publish('closed',{kind:'durable-parent13-context-closed',closed:late.body.closed,receipt:late.receipt});phase='closed';
    return {ack:result.body.ack,closed:late.body.closed};
   });
  },
  async negatives(){
   need(phase==='closed','CHILD_CLOSED_BEFORE_FIVE_EXISTING_FILE_NOOPS');phase='negative-planning';
   return stoppedOperation(async()=>{
    const planned=await execute('inspect','context-negative-intent',contextInput());
    need(planned.body.status==='CONTEXT_NEGATIVE_INTENT'&&planned.body.intent?.kind==='context-negative-intent','SIGNED_OWN_MEASURE_NOOP_INTENT_REQUIRED');
    negativeIntent=planned.body.intent;publish('negative-before',{kind:'durable-parent13-negative-before',before:negativeIntent.parentSeal,receipt:planned.receipt});
    publish('negative-intent',{kind:'durable-parent13-five-noop-intent',intent:negativeIntent});
    phase='negative-dispatched-no-retry';
    const result=await execute('prepare','context-negatives',{...contextInput(),contextNegativeIntent:negativeIntent,contextNegativeIntentSha256:digest(negativeIntent)});
    need(result.body.status==='CONTEXT_NEGATIVE_ACK'&&result.body.ack?.kind==='context-negative-ack'&&result.body.ack.allFiveNoNewRowsOrVersions===true&&result.body.ack.noops?.length===5,'FIVE_GENUINE_SIGNED_ORDINARY_NOOP_ACKS_REQUIRED');
    need(result.body.ack.intentSha256===digest(negativeIntent),'NEGATIVE_ACK_INTENT_BINDING_REQUIRED');
    priorObservation=result.body.ack.parentSeal;verifyParentRejoined(pre,negativeIntent.parentSeal,priorObservation);
    publish('negative-ack',{kind:'durable-parent13-five-noop-ack',ack:result.body.ack,receipt:result.receipt});phase='complete';
    return result.body.ack;
   });
  },
  stopPreserve(){phase='stopped-preserve-no-retry';return {status:'STOP_PRESERVE_NO_RETRY'};},
  state(){return {phase,partCount:part,beforeSha256:before?digest(before):null,childAckSha256:ack?digest(ack):null,parentObservationSha256:priorObservation?digest(priorObservation):null,sourceHashes:sourceHashes??null};},
 };
}
const entry=process.argv[1];if(entry&&path.resolve(entry)===fileURLToPath(import.meta.url)){
 try{
  const [mode,out]=process.argv.slice(2);need(mode==='build'&&out,'CONTEXT_BUILD_ONLY_CLI');
  const pack=await contextSmokeBundle(),file=privateResultsPath(out);need(!existsSync(file),'IMMUTABLE_CONTEXT_BUNDLE_EXISTS');
  const fd=openSync(file,'wx',0o600);try{writeFileSync(fd,pack.bytes);fsyncSync(fd);}finally{closeSync(fd);}
  console.log(JSON.stringify({status:'BUILT',bytes:pack.bytes.length,sha256:pack.sha256,sources:pack.sources,adapter:pack.adapter,stageExecuted:false,dbExecuted:false,httpExecuted:false}));
 }catch(error){console.log(JSON.stringify({status:'STOP',code:/^[A-Z0-9_]{1,100}$/.test(error?.message??'')?error.message:'CONTEXT113_BUILD_STOP'}));process.exitCode=1;}
}
