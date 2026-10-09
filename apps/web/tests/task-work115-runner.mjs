// Root-only child coordinator: durable before/ACK/restore intent; credentials never stored here.
// SAFETY D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP mismatch/unknown, no retries.
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {qaTransport} from './crm-acceptance-transport.mjs';
import {immutablePublish} from './file-fixture113-runner.mjs';
import {need,digest,canonical,sha} from './file-fixture113-protocol.mjs';
import {frozenLibraryPlugin,loadSignedParentPre} from './file-fixture113-context-smoke-runner.mjs';
import {FROZEN_SOURCES} from './file-fixture113-context-smoke.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),require=createRequire(import.meta.url),{build}=createRequire(require.resolve('tsx/package.json'))('esbuild');
const NAMES=['task-work115-core.mjs','task-work115-entry.mjs','task-work115-runner.mjs'];
export const taskWork115Sources=()=>Object.fromEntries(NAMES.map(name=>[name,sha(readFileSync(path.join(here,name)))]));
export function taskWork115Packet(pre,intent,operation,mode,extra={}){
 const input={authorized:true,runId:pre.runId,revision:pre.revision,operation,mode,pre,preSha256:digest(pre),parentDeleteIntent:intent,parentDeleteIntentSha256:digest(intent),...extra};
 const ascii=JSON.stringify(input).replace(/[\u007f-\uffff]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));need(Buffer.from(ascii).toString('base64').length<=96*1024,'EXISTING_TASK_CHILD_INPUT_CAP');return input;
}
export async function taskWork115Bundle(){
 for(const[name,hash]of Object.entries(FROZEN_SOURCES))need(sha(readFileSync(path.join(here,name)))===hash,'FROZEN_BACKEND_SOURCE_CHANGED');
 const sources=taskWork115Sources(),pack=await build({entryPoints:[path.join(here,'task-work115-entry.mjs')],bundle:true,write:false,platform:'node',format:'esm',target:'node22',external:['@prisma/client','@aws-sdk/client-s3','sharp'],banner:{js:'import {createRequire as taskWork115Require} from "node:module"; const require=taskWork115Require(import.meta.url);'},define:{__FIXTURE_SOURCE_HASHES__:JSON.stringify(FROZEN_SOURCES),__TASK_WORK115_SOURCES__:JSON.stringify(sources)},plugins:[frozenLibraryPlugin()],minify:true,logLevel:'silent'});
 const bytes=Buffer.from(pack.outputFiles[0].contents);need(bytes.length>0&&bytes.length<=256*1024,'EXISTING_TASK_CHILD_BUNDLE_CAP');return {bytes,sha256:sha(bytes),sources};
}
export function taskWork115Coordinator(options){
 const pre=loadSignedParentPre(options),intent=options.parentDeleteIntent;need(options.authorized===true&&intent?.kind==='delete-intent'&&intent.runId===pre.runId&&intent.revision===pre.revision&&intent.preSha256===digest(pre)&&typeof intent.signature==='string','SAME_SIGNED_PARENT_DELETE_REQUIRED');
 let before,ack,restoreIntent,phase='ready',part=0,identity,pinned;
 const publish=(kind,value)=>immutablePublish(path.join(options.outputDir,'task-work115-'+String(++part).padStart(3,'0')+'-'+kind+'.json'),value);
 const beforeInput=()=>({taskBefore:before,taskBeforeSha256:digest(before)}),ackInput=()=>({...beforeInput(),taskPrepared:ack,taskPreparedSha256:digest(ack)});
 async function execute(operation,mode,extra={}){
  const pack=await taskWork115Bundle();if(!pinned)pinned=pack.sources;need(canonical(pinned)===canonical(pack.sources),'TASK_WORK_SOURCES_CHANGED');
  const result=await qaTransport({target:'staging',revision:pre.revision,outputDir:options.outputDir}).execute(pack.bytes,operation,taskWork115Packet(pre,intent,operation,mode,extra));
  need(result.receipt?.identity?.hostname==='crm-staging'&&result.receipt.identity.revision===pre.revision&&result.receipt.bundleSha256===pack.sha256&&result.receipt.exitCode===0,'ACTUAL_TASK_CHILD_RECEIPT_REQUIRED');if(!identity)identity=result.receipt.identity;else need(canonical(identity)===canonical(result.receipt.identity),'TASK_CHILD_PHYSICAL_IDENTITY_CHANGED');need(result.body?.status!=='STOP','TASK_CHILD_STOP_PRESERVE');return {...result,pack};
 }
 async function step(fn){try{return await fn();}catch(error){phase='stopped-preserve-no-retry';throw error;}}
 return {
  async begin(){need(phase==='ready','ONE_TASK_CHILD_BEGIN_ONLY');return step(async()=>{const r=await execute('inspect','task-before');need(r.body.status==='TASK_CHILD_BEFORE','SIGNED_TASK_CHILD_BEFORE_REQUIRED');before=r.body.before;publish('before',{kind:'signed-task-child-before',before,receipt:r.receipt,sources:r.pack.sources});phase='before-durable';return {beforeSha256:digest(before),workId:before.workId};});},
  async prepare(){need(phase==='before-durable','DURABLE_BEFORE_CREATE_ONLY');publish('prepare-intent',{kind:'task-work-prepare-intent',beforeSha256:digest(before),parentDeleteIntentSha256:digest(intent),workId:before.workId});phase='prepare-dispatched-no-retry';return step(async()=>{const r=await execute('prepare','task-prepare',beforeInput());need(r.body.status==='TASK_CHILD_PREPARED'&&r.body.ack.commitAck===true,'GENUINE_TASK_WORK_PREPARED_ACK');ack=r.body.ack;publish('prepared',{kind:'signed-task-work-prepared',ack,receipt:r.receipt});phase='prepared';return {workId:before.workId,taskId:pre.plan.ids.task,fileId:intent.fileId,rawTaskHash:digest(ack.rawTask),preparedSha256:digest(ack)};});},
  fixtureVerifier(){need(phase==='prepared'&&pinned,'PREPARED_TASK_CHILD_REQUIRED');return {sourceSha256:pinned['task-work115-entry.mjs'],get physicalIdentity(){need(identity?.hostname==='crm-staging'&&identity.revision===pre.revision,'ACTUAL_CHILD_IDENTITY_REQUIRED');return JSON.parse(JSON.stringify(identity));},get physicalIdentitySha256(){need(identity?.hostname==='crm-staging'&&identity.revision===pre.revision,'ACTUAL_CHILD_IDENTITY_REQUIRED');return digest(identity);},async verifyCurrentTaskChild({expectedDeleted=false}={}){need(typeof expectedDeleted==='boolean'&&phase==='prepared','ONLY_ACTIVE_CHILD_VERIFICATION');return step(async()=>{const r=await execute('inspect','task-current',{...ackInput(),expectedDeleted});const c=r.body.certificate;need(r.body.status==='TASK_CHILD_CURRENT'&&c.kind==='task-work-current-verification'&&c.runId===pre.runId&&c.revision===pre.revision&&c.preSha256===digest(pre)&&c.beforeSha256===digest(before)&&c.preparedSha256===digest(ack)&&c.parentDeleteIntentSha256===digest(intent)&&c.workId===before.workId&&c.taskId===pre.plan.ids.task&&c.fileId===intent.fileId&&c.fileDeleted===expectedDeleted&&c.verifierSourceSha256===pinned['task-work115-entry.mjs'],'CURRENT_TASK_CHILD_CERTIFICATE_BINDING');publish('verification',{kind:'current-task-child-verification',certificate:c,receipt:r.receipt});return c;});}};},
  async restore({expectedDeleted=true}={}){need(phase==='prepared'&&typeof expectedDeleted==='boolean','KNOWN_TASK_CHILD_RESTORE_ONLY');return step(async()=>{const planned=await execute('inspect','task-restore-intent',{...ackInput(),expectedDeleted});need(planned.body.status==='TASK_CHILD_RESTORE_INTENT','SIGNED_TASK_RESTORE_INTENT_REQUIRED');restoreIntent=planned.body.intent;publish('restore-intent',{kind:'signed-task-work-restore-intent',intent:restoreIntent,receipt:planned.receipt});phase='restore-dispatched-no-retry';const r=await execute('restore','task-restore',{...ackInput(),taskRestoreIntent:restoreIntent,taskRestoreIntentSha256:digest(restoreIntent)});need(r.body.status==='TASK_CHILD_RESTORED'&&r.body.ack.commitAck===true,'ACTUAL_TASK_RESTORE_ACK_REQUIRED');publish('restore-ack',{kind:'signed-task-work-restored',ack:r.body.ack,receipt:r.receipt});const late=await execute('inspect','task-closed',{...beforeInput(),expectedDeleted});need(late.body.status==='TASK_CHILD_CLOSED'&&late.body.closed.ownWorkGone&&late.body.closed.rawTaskRestored,'LATE_PARENT_TASK_REJOIN_REQUIRED');publish('closed',{kind:'task-work-closed',closed:late.body.closed,receipt:late.receipt});phase='closed';return late.body.closed;});},
  state(){return {phase,partCount:part,workId:before?.workId??null,beforeSha256:before?digest(before):null,preparedSha256:ack?digest(ack):null};},
 };
}