// Узкий signed child: один нулевой Work, временная привязка собственной Task, одна разрешённая file deletion.
// SAFETY D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP unknown/CAS mismatch, никаких retries.
import {PrismaClient} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {hostname} from 'node:os';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import * as frozen from 'task113:frozen-library';
import {need,canonical,digest,signed,verifySignedFixture,fixtureStageGuard,compareFileDelete,FIXTURE_NAMESPACE as NS} from './file-fixture113-protocol.mjs';
import {workData,validateOwnTask,validatePreparedTask,validateOwnWork,createTaskWork,restoreTaskWork} from './task-work115-core.mjs';
const equal=(a,b,code)=>need(canonical(a)===canonical(b),code);
const sources=()=>{need(typeof __TASK_WORK115_SOURCES__!=='undefined','REVIEWED_TASK_CHILD_BUNDLE_REQUIRED');return __TASK_WORK115_SOURCES__;};
const bind=(pre,input)=>({namespace:NS,version:2,runId:pre.runId,revision:input.revision,preSha256:digest(pre)});
function parentIntent(pre,input,secret){
 frozen.preGuard(pre,secret,input);need(pre.revision===input.revision,'EXACT_PARENT_REVISION_REQUIRED');const intent=input.parentDeleteIntent;verifySignedFixture(intent,secret,'delete-intent',input);verifySignedFixture(intent.observation,secret,'observation',input);
 need(input.parentDeleteIntentSha256===digest(intent)&&intent.preSha256===digest(pre)&&intent.observation.preSha256===digest(pre)&&intent.revision===input.revision,'OLD_PARENT_DELETE_INTENT_BINDING');
 const file=intent.observation.rows.File.find(row=>row.id===intent.fileId),planned=pre.plan.files.find(row=>row.key==='task-image');
 need(file&&file.fileName===planned.fileName&&file.taskId===pre.plan.ids.task&&file.productId===pre.plan.ids.product&&file.projectId===pre.plan.ids.project&&file.uploadedById===pre.plan.actors[planned.actor].id&&intent.actorId===pre.plan.actors.manager.id,'EXACT_OWN_TASK_IMAGE_INTENT_REQUIRED');return intent;
}
function beforeGuard(pre,input,secret){
 const intent=parentIntent(pre,input,secret),before=input.taskBefore;verifySignedFixture(before,secret,'task-work-before',input);
 need(before.revision===input.revision&&before.preSha256===digest(pre)&&before.parentDeleteIntentSha256===digest(intent)&&input.taskBeforeSha256===digest(before),'DURABLE_TASK_CHILD_BEFORE_REQUIRED');equal(before.sources,sources(),'TASK_CHILD_SOURCE_CHANGED');workData(pre.plan,before.workId);validateOwnTask(pre.plan,before.rawTask);return {intent,before};
}
function ackGuard(pre,input,secret){
 const {intent,before}=beforeGuard(pre,input,secret),ack=input.taskPrepared;verifySignedFixture(ack,secret,'task-work-prepared',input);
 need(ack.revision===input.revision&&ack.beforeSha256===digest(before)&&ack.parentDeleteIntentSha256===digest(intent)&&input.taskPreparedSha256===digest(ack),'SIGNED_KNOWN_WORK_ACK_REQUIRED');validatePreparedTask(before.rawTask,ack.rawTask,before.workId);validateOwnWork(pre.plan,ack.rawWork,before.workId);return {intent,before,ack};
}
function normalizedSnapshot(state,versions,before){
 const rows={...state.rows,Task:[before.rawTask]};return {rows,scope:state.scope,storage:versions.own,currentOwnedStateHash:digest(rows),storageManifestHash:digest(versions.own)};
}
function taskDelta(intent,state,versions,before,expectedDeleted){
 const normalized=normalizedSnapshot(state,versions,before),present=state.rows.File.some(row=>row.id===intent.fileId);need(present===!expectedDeleted,'EXACT_TASK_FILE_DELETION_PHASE_REQUIRED');
 return compareFileDelete(intent.observation,normalized,intent.fileId,intent.actorId,!expectedDeleted);
}
async function capture(tx,s3,pre,intent,before,secret,input,{write=false}={}){
 const state=await frozen.ownState(tx,pre,intent.observation),workRows=await frozen.selected(tx,'Work',[before.workId]);need(workRows.length===1,'KNOWN_OWN_WORK_REQUIRED');
 const scope={...state.scope,Work:[before.workId]},actors=Object.values(pre.plan.actors).map(row=>row.id);let verification;
 if(write){await frozen.protectedWriteRows(tx,pre,{scope,actors});verification={originalWriteRowsGuard:true,lateReadonlyProofRequired:true};}
 else verification=frozen.compareOriginal(pre.baseline,await frozen.original(tx,scope,actors));
 const versions=await frozen.storage(s3,state.keys);need(versions.originalHash===pre.storageBaseline.hash&&versions.originalCount===pre.storageBaseline.count,'ALL_ORIGINAL_S3_CHANGED');
 return {state,work:workRows[0],versions,verification};
}
export async function issueTaskChild(db,s3,pre,input,secret){
 const intent=parentIntent(pre,input,secret),observation=await frozen.observe(db,s3,pre,{...input,priorObservation:intent.observation},secret);equal(digest(observation.rows),digest(intent.observation.rows),'PARENT_DELETE_BEFORE_ROWS_CHANGED');equal(observation.storageManifestHash,intent.observation.storageManifestHash,'PARENT_DELETE_BEFORE_S3_CHANGED');
 const rawTask=observation.rows.Task[0];validateOwnTask(pre.plan,rawTask);const workId=input.workId??randomUUID();workData(pre.plan,workId);
 await frozen.readonly(db,async tx=>{need((await frozen.selected(tx,'Work',[workId])).length===0,'WORK_UUID_ALREADY_EXISTS');});
 return signed({...bind(pre,input),kind:'task-work-before',parentDeleteIntentSha256:digest(intent),rawTask,rawTaskHash:digest(rawTask),workId,sources:sources(),acknowledgement:'CREATE_ONE_ZERO_LEGACY_WORK_AND_RESTORE_OWN_TASK_EXACTLY'},secret);
}
export async function prepareTaskChild(db,s3,pre,input,secret){
 const {intent,before}=beforeGuard(pre,input,secret),observed=await frozen.observe(db,s3,pre,{...input,priorObservation:intent.observation},secret);equal(digest(observed.rows),digest(intent.observation.rows),'PARENT_ROWS_CHANGED_BEFORE_WORK');equal(observed.storageManifestHash,intent.observation.storageManifestHash,'PARENT_S3_CHANGED_BEFORE_WORK');
 const created=await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(18435,55113)');const state=await frozen.ownState(tx,pre,intent.observation);await frozen.lockOwned(tx,state);equal(digest(state.rows),digest(intent.observation.rows),'PARENT_ROWS_CREATE_CAS_CHANGED');await frozen.protectedWriteRows(tx,pre,state);
  need((await frozen.storage(s3,state.keys)).originalHash===pre.storageBaseline.hash,'PRE_WORK_ORIGINAL_S3_CHANGED');return createTaskWork(tx,pre.plan,before.rawTask,before.workId);
 },{isolationLevel:'Serializable',maxWait:10000,timeout:120000});
 const current=await frozen.readonly(db,tx=>capture(tx,s3,pre,intent,before,secret,input));equal(current.state.rows.Task[0],created.task,'PREPARED_TASK_RAW_CHANGED');equal(current.work,created.work,'PREPARED_WORK_RAW_CHANGED');taskDelta(intent,current.state,current.versions,before,false);
 return signed({...bind(pre,input),kind:'task-work-prepared',beforeSha256:digest(before),parentDeleteIntentSha256:digest(intent),rawTask:created.task,rawWork:created.work,workId:before.workId,commitAck:true,originalVerification:current.verification},secret);
}
export async function currentTaskChild(db,s3,pre,input,secret){
 const {intent,before,ack}=ackGuard(pre,input,secret),current=await frozen.readonly(db,tx=>capture(tx,s3,pre,intent,before,secret,input));equal(current.state.rows.Task[0],ack.rawTask,'PREPARED_TASK_RAW_CAS_CHANGED');equal(current.work,ack.rawWork,'PREPARED_WORK_RAW_CAS_CHANGED');
 const expectedDeleted=input.expectedDeleted===true,proof=taskDelta(intent,current.state,current.versions,before,expectedDeleted);
 return signed({...bind(pre,input),kind:'task-work-current-verification',beforeSha256:digest(before),preparedSha256:digest(ack),parentDeleteIntentSha256:digest(intent),taskId:pre.plan.ids.task,workId:before.workId,fileId:intent.fileId,fileDeleted:expectedDeleted,currentChildStateHash:digest({rows:current.state.rows,work:current.work}),storageManifestHash:digest(current.versions.own),financialStateHash:digest({payments:current.state.rows.Payment,docs:current.state.rows.FinanceDocument,cash:current.state.rows.CashAccount,article:current.state.rows.ExpenseArticle}),originalVerification:current.verification,proof,verifierSourceSha256:sources()['task-work115-entry.mjs']},secret);
}
export async function issueTaskRestore(db,s3,pre,input,secret){
 const {intent,before,ack}=ackGuard(pre,input,secret),current=await frozen.readonly(db,tx=>capture(tx,s3,pre,intent,before,secret,input));equal(current.state.rows.Task[0],ack.rawTask,'TASK_RESTORE_INTENT_RAW_CAS_CHANGED');equal(current.work,ack.rawWork,'WORK_RESTORE_INTENT_RAW_CAS_CHANGED');taskDelta(intent,current.state,current.versions,before,input.expectedDeleted===true);
 return signed({...bind(pre,input),kind:'task-work-restore-intent',beforeSha256:digest(before),preparedSha256:digest(ack),parentDeleteIntentSha256:digest(intent),expectedDeleted:input.expectedDeleted===true,currentChildStateHash:digest({rows:current.state.rows,work:current.work}),storageManifestHash:digest(current.versions.own),acknowledgement:'RESTORE_ONLY_RAW_OWN_TASK_AND_DELETE_EXACT_CAPTURED_ZERO_WORK'},secret);
}
export async function restoreTaskChild(db,s3,pre,input,secret){
 const {intent,before,ack}=ackGuard(pre,input,secret),restore=input.taskRestoreIntent;verifySignedFixture(restore,secret,'task-work-restore-intent',input);
 need(input.taskRestoreIntentSha256===digest(restore)&&restore.beforeSha256===digest(before)&&restore.preparedSha256===digest(ack)&&restore.parentDeleteIntentSha256===digest(intent)&&restore.revision===input.revision,'DURABLE_TASK_RESTORE_INTENT_REQUIRED');
 const current=await frozen.readonly(db,tx=>capture(tx,s3,pre,intent,before,secret,input));equal(current.state.rows.Task[0],ack.rawTask,'OWN_TASK_RESTORE_CAS_CHANGED');equal(current.work,ack.rawWork,'OWN_WORK_RESTORE_CAS_CHANGED');taskDelta(intent,current.state,current.versions,before,restore.expectedDeleted);
 equal(digest({rows:current.state.rows,work:current.work}),restore.currentChildStateHash,'TASK_CHILD_RESTORE_STATE_HASH_CHANGED');equal(digest(current.versions.own),restore.storageManifestHash,'TASK_CHILD_RESTORE_S3_HASH_CHANGED');
 const restored=await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(18435,55113)');await frozen.lockOwned(tx,{rows:{...current.state.rows,Work:[current.work]},actors:Object.values(pre.plan.actors).map(row=>row.id)});
  const locked=await capture(tx,s3,pre,intent,before,secret,input,{write:true});equal(digest(locked.state.rows),digest(current.state.rows),'TASK_CHILD_ROWS_CHANGED_BEFORE_RESTORE');equal(locked.work,current.work,'TASK_CHILD_WORK_CHANGED_BEFORE_RESTORE');equal(digest(locked.versions.own),digest(current.versions.own),'TASK_CHILD_S3_CHANGED_BEFORE_RESTORE');taskDelta(intent,locked.state,locked.versions,before,restore.expectedDeleted);
  const result=await restoreTaskWork(tx,before.rawTask,ack.rawTask,ack.rawWork),state=await frozen.ownState(tx,pre,intent.observation);await frozen.protectedWriteRows(tx,pre,state);equal(state.rows.Task[0],before.rawTask,'RAW_TASK_REJOIN_NOT_EXACT');return result;
 },{isolationLevel:'Serializable',maxWait:10000,timeout:120000});
 return signed({...bind(pre,input),kind:'task-work-restored',beforeSha256:digest(before),preparedSha256:digest(ack),counts:{Work:1,TaskRestored:1},rawTaskHash:digest(restored.task),expectedDeleted:restore.expectedDeleted,commitAck:true,lateParentProofRequired:true},secret);
}
export async function closeTaskChild(db,s3,pre,input,secret){
 const {intent,before}=beforeGuard(pre,input,secret),observation=await frozen.observe(db,s3,pre,{...input,priorObservation:intent.observation},secret);await frozen.readonly(db,async tx=>need((await frozen.selected(tx,'Work',[before.workId])).length===0,'OWN_WORK_REMAINS'));
 equal(observation.rows.Task[0],before.rawTask,'RAW_TASK_NOT_RESTORED');const proof=compareFileDelete(intent.observation,observation,intent.fileId,intent.actorId,input.expectedDeleted!==true);
 return signed({...bind(pre,input),kind:'task-work-closed',beforeSha256:digest(before),parentDeleteIntentSha256:digest(intent),workId:before.workId,ownWorkGone:true,rawTaskRestored:true,originalVerification:observation.originalVerification,proof,parentObservation:observation},secret);
}
let phase='guard';
export async function main(){let db,s3,result;try{
 const encoded=process.env.CRM_STAGING_BROWSER_INPUT;need(typeof encoded==='string'&&encoded.length>0&&encoded.length<=96*1024,'BOUNDED_TASK_CHILD_INPUT');const input=JSON.parse(Buffer.from(encoded,'base64').toString('utf8')),guard=fixtureStageGuard(input,process.env,{host:hostname(),docker:existsSync('/.dockerenv')});
 const modes={inspect:['task-before','task-current','task-restore-intent','task-closed'],prepare:['task-prepare'],restore:['task-restore']};need(modes[input.operation]?.includes(input.mode),'EXACT_TASK_CHILD_MODE_REQUIRED');frozen.preGuard(input.pre,guard.secret,input);sources();
 db=new PrismaClient({log:[],errorFormat:'minimal'});s3=frozen.client();phase=input.mode;
 if(input.mode==='task-before')result={status:'TASK_CHILD_BEFORE',before:await issueTaskChild(db,s3,input.pre,input,guard.secret)};
 else if(input.mode==='task-prepare')result={status:'TASK_CHILD_PREPARED',ack:await prepareTaskChild(db,s3,input.pre,input,guard.secret)};
 else if(input.mode==='task-current')result={status:'TASK_CHILD_CURRENT',certificate:await currentTaskChild(db,s3,input.pre,input,guard.secret)};
 else if(input.mode==='task-restore-intent')result={status:'TASK_CHILD_RESTORE_INTENT',intent:await issueTaskRestore(db,s3,input.pre,input,guard.secret)};
 else if(input.mode==='task-restore')result={status:'TASK_CHILD_RESTORED',ack:await restoreTaskChild(db,s3,input.pre,input,guard.secret)};
 else result={status:'TASK_CHILD_CLOSED',closed:await closeTaskChild(db,s3,input.pre,input,guard.secret)};
 need(Buffer.byteLength(JSON.stringify(result))<=64*1024,'TASK_CHILD_OUTPUT_CAP');
 }catch(error){result={status:'STOP',phase,code:/^[A-Z0-9_]{1,100}$/.test(error?.message??'')?error.message:'TASK_WORK115_STOP_PRESERVE_STATE'};process.exitCode=1;}finally{await db?.$disconnect();s3?.destroy();}console.log(JSON.stringify(result));}
const entry=process.argv[1];if((!entry||path.resolve(entry)===fileURLToPath(import.meta.url))&&process.env.CRM_STAGING_BROWSER_INPUT&&process.env.CRM_MODERNIZATION_TARGET==='staging')void main();