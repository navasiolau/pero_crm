// Root-only fixture coordinator. All intents/PRE/ACK/meta are immutable private artifacts.
// Credentials from handoff stay in returned memory objects and are never published.
// SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP on mismatch.
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,openSync,closeSync,fsyncSync,renameSync,existsSync,lstatSync,realpathSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {qaTransport,acceptanceWeb,bundleHash} from './crm-acceptance-transport.mjs';
import {need,digest,canonical,FIXTURE_NAMESPACE} from './file-fixture113-protocol.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),results=path.resolve(acceptanceWeb,'test-results'),require=createRequire(import.meta.url),{build}=createRequire(require.resolve('tsx/package.json'))('esbuild');
const SHA=/^[a-f0-9]{64}$/,REV=/^[a-f0-9]{40}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function privatePath(file){
 const absolute=path.resolve(file),relative=path.relative(results,absolute);need(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'PRIVATE_RESULTS_PATH_REQUIRED');need(existsSync(results)&&!lstatSync(results).isSymbolicLink()&&realpathSync(results).toLowerCase()===results.toLowerCase(),'PRIVATE_RESULTS_ROOT_REQUIRED');
 let current=absolute;while(current.toLowerCase()!==results.toLowerCase()){if(existsSync(current))need(!lstatSync(current).isSymbolicLink(),'REPARSE_PATH_FORBIDDEN');current=path.dirname(current);}return absolute;
}
export function immutablePublish(file,value){
 const absolute=privatePath(file);need(!existsSync(absolute),'IMMUTABLE_PART_EXISTS');need(!Object.hasOwn(value,'profiles')&&!Object.hasOwn(value,'cookies')&&!JSON.stringify(value).includes('__Secure-authjs.session-token')&&!JSON.stringify(value).includes('"encryptionKey"'),'CREDENTIALS_MUST_REMAIN_MEMORY');
 const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');need(bytes.length<=256*1024,'PRIVATE_PART_CAP');const tmp=privatePath(path.join(path.dirname(absolute),'.publishing-'+randomUUID())),fd=openSync(tmp,'wx',0o600);
 try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}renameSync(tmp,absolute);return {file:absolute,sha256:hash(bytes),semanticSha256:digest(value)};
}
export function producerSources(){
 return Object.fromEntries(['file-fixture113-entry.mjs','file-fixture113-protocol.mjs','crm-acceptance-token-clock.mjs'].map(name=>[name,hash(readFileSync(path.join(here,name)))]));
}
export async function fixture113Bundle(){
 const sources=producerSources(),result=await build({entryPoints:[path.join(here,'file-fixture113-entry.mjs')],bundle:true,write:false,platform:'node',format:'esm',target:'node22',external:['@prisma/client','@aws-sdk/client-s3','sharp'],banner:{js:'import { createRequire as task113CreateRequire } from "node:module"; const require = task113CreateRequire(import.meta.url);'},define:{__FIXTURE_SOURCE_HASHES__:JSON.stringify(sources)},minify:true,logLevel:'silent'});
 const bytes=Buffer.from(result.outputFiles[0].contents);need(bytes.length>0&&bytes.length<=256*1024,'EXISTING_BUNDLE_CAP_REQUIRED');return {bytes,sources,sha256:bundleHash(bytes)};
}
function checked(result,revision,bundleSha){
 need(result.receipt?.identity?.hostname==='crm-staging'&&result.receipt.identity.revision===revision&&result.receipt.bundleSha256===bundleSha&&result.receipt.exitCode===0,'EXACT_PHYSICAL_PRODUCER_RECEIPT');
 need(result.body?.status!=='STOP'&&Buffer.byteLength(JSON.stringify(result.body))<=64*1024,'PRIVATE_OUTPUT_BOUND');return result.body;
}
export function fixture113Coordinator(options){
 need(options?.authorized===true&&REV.test(options.revision??'')&&UUID.test(options.runId??'')&&path.isAbsolute(options.outputDir??''),'ROOT_AUTHORIZED_FULL_REVISION_SCOPE');privatePath(options.outputDir);mkdirSync(options.outputDir,{recursive:true});
 let pre,priorObservation,part=0,expectedSources;
 if(options.resume){
  const resume=options.resume;need(SHA.test(resume.preFileSha256??'')&&SHA.test(resume.observationFileSha256??''),'HASHED_PRIVATE_RESUME_REQUIRED');
  const preBytes=readFileSync(privatePath(resume.preFile));need(hash(preBytes)===resume.preFileSha256,'RESUME_PRE_BYTES_CHANGED');const stored=JSON.parse(preBytes.toString('utf8'));need(stored.kind==='private-pre-receipt'&&stored.pre?.namespace===FIXTURE_NAMESPACE&&stored.pre.runId===options.runId,'RESUME_PRE_BINDING');pre=stored.pre;expectedSources=stored.sources;
  const obsBytes=readFileSync(privatePath(resume.observationFile));need(hash(obsBytes)===resume.observationFileSha256,'RESUME_OBSERVATION_BYTES_CHANGED');const meta=JSON.parse(obsBytes.toString('utf8'));priorObservation=meta.observation??meta.ack?.observation;need(priorObservation?.namespace===FIXTURE_NAMESPACE&&priorObservation.preSha256===digest(pre),'RESUME_OBSERVATION_BINDING');
  need(Number.isInteger(resume.partCount)&&resume.partCount>0&&resume.partCount<10000,'RESUME_EXACT_PART_COUNT_REQUIRED');part=resume.partCount;
 }

 const publish=(kind,value)=>immutablePublish(path.join(options.outputDir,String(++part).padStart(4,'0')+'-'+kind+'.json'),value);
 async function execute(operation,mode,extra={}){
  const pack=await fixture113Bundle();if(!expectedSources)expectedSources=pack.sources;need(canonical(expectedSources)===canonical(pack.sources),'SOURCE_CHANGED_DURING_LIFECYCLE');
  const input={authorized:true,runId:options.runId,revision:options.revision,operation,mode,...(pre?{pre,preSha256:digest(pre)}:{}),...(priorObservation?{priorObservation}:{}),...extra};
  const transport=qaTransport({target:'staging',revision:options.revision,outputDir:options.outputDir});const result=await transport.execute(pack.bytes,operation,input);return {body:checked(result,options.revision,pack.sha256),receipt:result.receipt,pack};
 }
 return {
  async pre(nativeReceipt){
   need(!pre&&nativeReceipt?.kind==='file-fixture113-finance-native'&&nativeReceipt.status==='PASS'&&nativeReceipt.rollbackVerified===true,'REVIEWED_NATIVE_PASS_FIRST');
   const result=await execute('inspect','pre',{nativePrerequisite:nativeReceipt});need(result.body.status==='PRE_CAPTURED'&&result.body.pre?.namespace===FIXTURE_NAMESPACE,'SIGNED_PRE_CAPTURE_REQUIRED');pre=result.body.pre;const saved=publish('pre',{kind:'private-pre-receipt',pre,receipt:result.receipt,sources:result.pack.sources});return {preSha256:digest(pre),saved};
  },
  async graph(){
   need(pre,'DURABLE_PRE_FIRST');publish('graph-intent',{kind:'graph-intent',preSha256:digest(pre),predictedIds:pre.plan.ids,predictedActors:Object.fromEntries(Object.entries(pre.plan.actors).map(([key,row])=>[key,row.id]))});
   const result=await execute('prepare','graph');need(result.body.status==='GRAPH_PREPARED'&&result.body.prepared?.commitAck===true,'EXACT_GRAPH_ACK');publish('graph-ack',{kind:'graph-ack',prepared:result.body.prepared,receipt:result.receipt});return result.body.prepared;
  },
  async observe(){
   need(pre,'PRE_REQUIRED');const result=await execute('inspect','observe');need(result.body.status==='OWN_CAPTURED','SIGNED_OBSERVATION_REQUIRED');priorObservation=result.body.observation;publish('observation',{kind:'observation-receipt',observation:priorObservation,receipt:result.receipt});return priorObservation;
  },
  async upload(mediaKey){
   need(pre,'PRE_REQUIRED');const planned=await execute('inspect','intent',{mediaKey});need(planned.body.status==='INTENT_CAPTURED','SIGNED_UPLOAD_INTENT_REQUIRED');const intent=planned.body.intent;publish('upload-intent',{kind:'durable-upload-intent',intent,receipt:planned.receipt});
   const result=await execute('prepare','upload',{intent,intentSha256:digest(intent)});need(result.body.status==='UPLOAD_ACK','COMPILED_UPLOAD_ACK_REQUIRED');priorObservation=result.body.ack.observation;publish('upload-ack',{kind:'upload-ack',ack:result.body.ack,receipt:result.receipt});return result.body.ack;
  },
  async financeLink(linkPhase){
   need(priorObservation,'CAPTURE_BEFORE_OWN_LINK_REQUIRED');publish('finance-link-intent',{kind:'finance-link-intent',preSha256:digest(pre),observationSha256:digest(priorObservation),linkPhase});
   const result=await execute('prepare','finance-link',{observation:priorObservation,observationSha256:digest(priorObservation),linkPhase});need(result.body.status==='LINK_ACK','OWN_LINK_ACK_REQUIRED');publish('finance-link-ack',{kind:'finance-link-ack',ack:result.body.ack,receipt:result.receipt});return this.observe();
  },
  async handoff(){
   need(pre,'PRE_REQUIRED');const result=await execute('inspect','handoff');need(result.body.status==='OWN_HANDOFF'&&result.body.credentialsMemoryOnly===true,'MEMORY_ONLY_HANDOFF_REQUIRED');priorObservation=result.body.observation;
   // Store only signed metadata, never the full receipt which carries cookie profiles.
   publish('handoff-meta',{kind:'handoff-metadata',handoff:result.body.handoff,certificate:result.body.certificate,identity:result.receipt.identity,bundleSha256:result.receipt.bundleSha256});
   return {handoff:result.body.handoff,profiles:result.body.profiles,certificate:result.body.certificate,producerReceipt:{identity:result.receipt.identity,bundleSha256:result.receipt.bundleSha256},sources:result.pack.sources};
  },
  fixtureVerifier(){
   need(pre&&priorObservation&&expectedSources,'CURRENT_SIGNED_HANDOFF_FIRST');const sourceSha256=expectedSources['file-fixture113-entry.mjs'];
   return {sourceSha256,async verifySignedFixture({handoff,identity,expectedRevision,actionManifestHash,rawManifestSha256,compiledDeleteFileHash}){
    need(expectedRevision===options.revision&&identity?.hostname==='crm-staging'&&identity.revision===options.revision&&handoff?.runId===options.runId&&handoff.preSha256===digest(pre)&&[actionManifestHash,rawManifestSha256,compiledDeleteFileHash].every(value=>SHA.test(value??'')),'CURRENT_VERIFIER_BINDING_REQUIRED');
    const result=await execute('inspect','verify-handoff',{handoff,actionManifestHash,rawManifestSha256,compiledDeleteFileHash});need(canonical(identity)===canonical(result.receipt.identity),'CURRENT_PHYSICAL_IDENTITY_CHANGED');
    need(result.body.status==='CURRENT_HANDOFF_VERIFIED'&&result.body.certificate?.verifierSourceSha256===sourceSha256&&result.body.certificate.currentOwnedStateHash===handoff.currentOwnedStateHash&&result.body.certificate.storageManifestHash===handoff.storageManifestHash&&['actionManifestHash','rawManifestSha256','compiledDeleteFileHash'].every(key=>result.body.certificate[key]===handoff[key]),'CURRENT_SOURCE_BACKED_VERIFICATION_REQUIRED');
    priorObservation=result.body.observation;publish('handoff-verification',{kind:'current-handoff-verification',certificate:result.body.certificate,receipt:result.receipt});return result.body.certificate;
   }};
  },
  async preDelete({fileId,actorKey}){
   const result=await execute('inspect','delete-intent',{fileId,actorKey});need(result.body.status==='DELETE_INTENT','PRODUCER_DELETE_INTENT_REQUIRED');const intent=result.body.intent;publish('delete-intent',{kind:'durable-delete-intent',intent,receipt:result.receipt});return intent;
  },
  async afterDelete(intent,{cancelled=false}={}){
   const result=await execute('inspect','delete-ack',{deleteIntent:intent,deleteIntentSha256:digest(intent),cancelled});need(result.body.status==='DELETE_ACK','COMPILED_DELETE_ACK_REQUIRED');priorObservation=result.body.ack.observation;publish('delete-ack',{kind:'delete-ack',ack:result.body.ack,receipt:result.receipt});return result.body.ack;
  },
  async verifyFinalState(){
   need(priorObservation,'CAPTURE_FINAL_STATE_FIRST');const result=await execute('inspect','final',{expectedOwnStateHash:priorObservation.currentOwnedStateHash});need(result.body.status==='OWN_FINAL_VERIFIED'&&result.body.certificate?.kind==='current-owned-final-verification','PRODUCER_FINAL_CERTIFICATE_REQUIRED');publish('final',{kind:'final-certificate',certificate:result.body.certificate,receipt:result.receipt});return result.body.certificate;
  },
  async cleanup(){
   need(pre,'PRE_REQUIRED');const planned=await execute('inspect','cleanup-intent');need(planned.body.status==='CLEANUP_INTENT','CAPTURED_CLEANUP_INTENT_REQUIRED');priorObservation=planned.body.observation;const intent=planned.body.intent;publish('cleanup-intent',{kind:'durable-cleanup-intent',intent,observation:priorObservation,receipt:planned.receipt});
   const result=await execute('restore','cleanup',{observation:priorObservation,cleanupIntent:intent,cleanupIntentSha256:digest(intent)});need(result.body.status==='OWN_CLEANED'&&result.body.ack?.commitAck===true,'ROOT_CLEANUP_ACK_REQUIRED');publish('cleanup-ack',{kind:'cleanup-ack',ack:result.body.ack,receipt:result.receipt});const closed=await execute('inspect','closed');need(closed.body.status==='OWN_CLOSED','POST_CLEANUP_LATE_PROOF_REQUIRED');publish('closed',{kind:'closed-proof',proof:closed.body,receipt:closed.receipt});return {ack:result.body.ack,closed:closed.body};
  },
  // The parent may freeze returned metadata; this object has no external side effects by itself.
  state(){return {preSha256:pre?digest(pre):null,currentObservationSha256:priorObservation?digest(priorObservation):null,partCount:part,sourceHashes:expectedSources};},
 };
}
const entry=process.argv[1];if(entry&&path.resolve(entry)===fileURLToPath(import.meta.url)){
 const [mode,out]=process.argv.slice(2);
 try{need(mode==='build'&&out&&path.isAbsolute(out),'ROOT_RUNTIME_API_ONLY_BUILD_CLI');const pack=await fixture113Bundle();const file=privatePath(out);need(!existsSync(file),'IMMUTABLE_BUNDLE_EXISTS');const fd=openSync(file,'wx',0o600);try{writeFileSync(fd,pack.bytes);fsyncSync(fd);}finally{closeSync(fd);}console.log(JSON.stringify({status:'BUILT',file,bytes:pack.bytes.length,sha256:pack.sha256,stageExecuted:false,dbExecuted:false,sources:pack.sources}));}
 catch(error){console.log(JSON.stringify({status:'STOP',code:/^[A-Z0-9_]{1,100}$/.test(error?.message??'')?error.message:'FIXTURE113_BUILD_STOP'}));process.exitCode=1;}
}
