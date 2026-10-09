// Только Root вызывает этот bundle через существующий transport; импорт производного library инертен.
// SAFETY D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md: STOP, сохранять состояние, не повторять POST.
import {PrismaClient} from '@prisma/client';
import sharp from 'sharp';
import {GetObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {hostname} from 'node:os';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import * as frozen from 'task113:frozen-library';
import {need,canonical,digest,sha,signed,verifySignedFixture,fixtureStageGuard,FIXTURE_NAMESPACE as NS} from './file-fixture113-protocol.mjs';
import {FROZEN_SOURCES,contextMedia,validateContextMedia,validateContextBefore,childKeys,contextScope,verifyContextReplacement,verifyNoop,verifyParentRejoined,cleanupDescriptor,NEGATIVE_CASES,bytesHash,sealParentObservation,sealContextAfter,transportBudget,contextPreflight} from './file-fixture113-context-smoke.mjs';
const MAX_INPUT=96*1024,MAX_OUTPUT=64*1024;
let phase='guard';
const sourceHashes=()=>{need(typeof __CONTEXT_SMOKE_SOURCE_HASHES__!=='undefined','REVIEWED_CONTEXT_BUNDLE_REQUIRED');return __CONTEXT_SMOKE_SOURCE_HASHES__;};
const binding=(pre,input)=>({namespace:NS,version:2,runId:pre.runId,revision:input.revision,preSha256:digest(pre)});
const equal=(a,b,code)=>need(canonical(a)===canonical(b),code);
async function imageBytes(){
 const bytes=await frozen.mediaBytes({mimeType:'image/png'}),thumb=await sharp(bytes).rotate().resize(480,480,{fit:'inside',withoutEnlargement:true}).jpeg({quality:80}).toBuffer();
 return {bytes,thumb};
}
async function recipients(db,pre){
 return frozen.readonly(db,async tx=>{
  const rows=await tx.$queryRawUnsafe('SELECT u.id::text id FROM "User" u LEFT JOIN "NotificationPreference" p ON p."userId"=u.id AND p.type=$1 WHERE u.active=true AND u.id<>$2 AND u.roles::text[] && ARRAY[$3,$4,$5,$6]::text[] AND p.enabled IS DISTINCT FROM false ORDER BY u.id','file.added',pre.plan.actors.engineer.id,'ADMIN','DIRECTOR','MANAGER','PROCUREMENT');
  need(rows.length>0&&rows.length<=200,'BOUNDED_EXACT_NOTIFICATION_FANOUT_REQUIRED');return rows.map(row=>row.id);
 });
}
async function parentObserve(db,s3,pre,input,secret,seal){
 frozen.preGuard(pre,secret,input);
 return frozen.readonly(db,async tx=>{
  const state=await frozen.ownState(tx,pre,{scope:seal.scope,keys:seal.keys}),actual=await frozen.original(tx,state.scope,state.actors),originalVerification=frozen.compareOriginal(pre.baseline,actual),versions=await frozen.storage(s3,state.keys);
  need(versions.originalHash===pre.storageBaseline.hash&&versions.originalCount===pre.storageBaseline.count,'PARENT_OBSERVE_ORIGINAL_S3_CHANGED');
  for(const file of [...state.rows.File,...state.rows.FinanceDocument])if(file.state!=='PENDING'){
   const key=file.storageKey??file.projectId+'/'+file.storedName,head=versions.own.find(row=>row.key===key&&row.latest&&!row.deleteMarker);need(head&&head.size===file.size,'CURRENT_PARENT_ORIGINAL_MISSING');
  }
  return signed({...binding(pre,input),kind:'observation',checkpointHash:digest(pre),rows:state.rows,scope:state.scope,keys:state.keys,currentOwnedStateHash:digest(state.rows),financialStateHash:digest({payments:state.rows.Payment,docs:state.rows.FinanceDocument,cash:state.rows.CashAccount,article:state.rows.ExpenseArticle}),storage:versions.own,storageManifestHash:digest(versions.own),originalVerification},secret);
 });
}
async function assertObjectBytes(s3,row,expectedHash){
 need(row&&!row.deleteMarker&&row.latest&&row.versionId&&Number.isSafeInteger(row.size)&&row.size>0&&row.size<=256*1024,'EXACT_SMALL_VERSIONED_OBJECT_REQUIRED');
 const object=await s3.send(new GetObjectCommand({Bucket:'pero-crm-staging',Key:row.key,VersionId:row.versionId}));
 need(object.ContentLength===row.size&&object.Body,'ACTUAL_VERSIONED_OBJECT_LENGTH_REQUIRED');
 const bytes=Buffer.from(await object.Body.transformToByteArray());need(bytes.length===row.size&&bytesHash(bytes)===expectedHash,'ACTUAL_VERSIONED_OBJECT_HASH_MISMATCH');return expectedHash;
}
export async function issueContext(db,s3,pre,input,secret){
 const parentBefore=await frozen.observe(db,s3,pre,input,secret);validateContextBefore(pre,parentBefore);
 const target=contextMedia(pre,parentBefore,input.clientMutationId),image=await imageBytes(),notificationRecipients=await recipients(db,pre);
 const media={target,size:image.bytes.length,contentHash:sha(image.bytes),thumbSize:image.thumb.length,thumbHash:sha(image.thumb)};
 const before=signed({...binding(pre,input),kind:'context-before',parentSeal:sealParentObservation(pre,parentBefore),media,notificationRecipients,sources:sourceHashes()},secret);
 contextPreflight(before.parentSeal,notificationRecipients.length);return {before,intent:uploadIntent(before,pre,input,secret)};
}
function uploadIntent(before,pre,input,secret){
 return signed({...binding(pre,input),kind:'context-upload-intent',beforeSha256:digest(before),actorId:before.media.target.actorId,requestHash:digest(before.media),expectedOwnStateHash:before.parentSeal.rowsHash,expectedStorageManifestHash:before.parentSeal.storageHash,acknowledgement:'ONE_REAL_ENGINEER_IMAGE_REPLACES_EXISTING_ADMIN_SKETCH'},secret);
}
function beforeGuard(pre,input,secret){
 need(pre?.revision===input.revision&&pre.plan?.revision===input.revision,'EXACT_FRESH_PARENT_PHYSICAL_REVISION_REQUIRED');
 frozen.preGuard(pre,secret,input);equal(pre.sources,FROZEN_SOURCES,'FROZEN_PARENT_SOURCES_CHANGED');
 const before=input.contextBefore;verifySignedFixture(before,secret,'context-before',input);
 need(before.preSha256===digest(pre)&&input.contextBeforeSha256===digest(before),'DURABLE_SIGNED_CONTEXT_BEFORE_REQUIRED');
 validateContextMedia(pre,before.parentSeal,before.media.target);
 equal(before.sources,sourceHashes(),'CONTEXT_SOURCE_CHANGED_DURING_LIFECYCLE');
 need(before.parentSeal.preSha256===digest(pre),'SIGNED_PARENT_BEFORE_BINDING');
 return before;
}
async function realPost(pre,secret,media,bytes,negativeKey=null){
 const profile=(await frozen.cookies(pre.plan,secret)).engineer;
 need(profile.id===pre.plan.actors.engineer.id&&canonical(profile.roles)==='["ENGINEER"]','EXISTING_PARENT_ENGINEER_COOKIE_REQUIRED');
 const form=new FormData();form.append('file',new File([new Uint8Array(bytes)],media.fileName,{type:'image/png'}));
 form.append('projectId',media.projectId);form.append('productId',media.productId);form.append('section',negativeKey==='section-conflict'?'INSTALLATION':media.section);form.append('clientMutationId',media.clientMutationId);
 if(negativeKey===null){form.append('assignCover','1');form.append('expectedSketchFileId',media.expectedSketchFileId);}
 else if(['category','caption','stage'].includes(negativeKey))form.append(negativeKey,negativeKey==='caption'?'QA113 obsolete metadata':negativeKey==='category'?'MEASUREMENT':'PRODUCTION');
 const response=await fetch('http://127.0.0.1:3000/api/files/upload',{method:'POST',headers:{cookie:profile.cookies.map(row=>row.name+'='+row.value).join('; ')},body:form,redirect:'manual',signal:AbortSignal.timeout(60000)});
 const text=await response.text();need(Buffer.byteLength(text)<=16*1024,'BOUNDED_COMPILED_UPLOAD_RESPONSE_REQUIRED');
 let body;try{body=JSON.parse(text);}catch{throw Error('LOST_OR_NONJSON_HTTP_ACK_PRESERVE_NO_RETRY');}
 return {method:'POST',path:'/api/files/upload',status:response.status,redirected:response.redirected,body};
}
async function rawContext(tx,s3,pre,before,fileId,secret,input,{writeGuard=false}={}){
 const base=before.parentSeal,p=pre.plan,actors=Object.values(p.actors).map(row=>row.id),rows={};
 const ordinary=['User','Client','Project','Product','Task','CashAccount','ExpenseArticle','Payment'];
 for(const table of ordinary)rows[table]=await frozen.selected(tx,table,base.scope[table]);
 rows.File=await frozen.selected(tx,'File',[p.ids.project],'projectId');
 rows.FinanceDocument=await frozen.selected(tx,'FinanceDocument',p.financeDocs.map(row=>row.clientMutationId),'clientMutationId');
 rows.UserPreference=await frozen.selected(tx,'UserPreference',actors,'userId');
 rows.ChangeLog=await frozen.selected(tx,'ChangeLog',actors,'actorId');
 rows.Notification=await tx.$queryRawUnsafe('SELECT to_jsonb(t) row FROM "Notification" t WHERE type=$1 AND body LIKE $2 AND (link=$3 OR link=$4) ORDER BY id','file.added','qa113-'+p.runId+'-%','/projects/'+p.ids.project,'/products/'+p.productNumber).then(items=>items.map(row=>row.row));
 rows.DomainEvent=await tx.$queryRawUnsafe('SELECT to_jsonb(t) row FROM "DomainEvent" t WHERE actor IN ($1,$2,$3) ORDER BY id',...actors).then(items=>items.map(row=>row.row));
 need(rows.File.length<=8&&rows.ChangeLog.length<=100&&rows.Notification.length<=200&&rows.UserPreference.length<=60,'BOUNDED_CONTEXT_CAPTURE_REQUIRED');
 const file=rows.File.find(row=>row.id===fileId),keys=[...base.keys,...childKeys(pre,file,before.media.target)],scope=contextScope(base,rows);
 let originalVerification;
 if(writeGuard){
  await frozen.protectedWriteRows(tx,pre,{scope,actors});
  originalVerification={originalWriteRowsGuard:true,lateReadonlyClockAndSchemaProofRequired:true};
 }else{const actual=await frozen.original(tx,scope,actors);originalVerification=frozen.compareOriginal(pre.baseline,actual);}
 const versions=await frozen.storage(s3,keys);
 need(versions.originalHash===pre.storageBaseline.hash&&versions.originalCount===pre.storageBaseline.count,'ALL_ORIGINAL_S3_VERSIONS_CHANGED');
 const child=childKeys(pre,file,before.media.target),contentHashes={};
 for(const [index,key]of child.entries())contentHashes[key]=await assertObjectBytes(s3,versions.own.find(row=>row.key===key&&row.latest&&!row.deleteMarker),index===0?before.media.contentHash:before.media.thumbHash);
 const [clock]=await tx.$queryRawUnsafe("SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') value");
 return signed({...binding(pre,input),kind:writeGuard?'context-write-snapshot':'context-observation',rows,scope,keys,storage:versions.own,currentOwnedStateHash:digest(rows),storageManifestHash:digest(versions.own),financialStateHash:digest({payments:rows.Payment,docs:rows.FinanceDocument,cash:rows.CashAccount,article:rows.ExpenseArticle}),originalVerification,capturedAt:clock.value,contentHashes},secret);
}
async function captureContext(db,s3,pre,before,id,secret,input){
 return frozen.readonly(db,tx=>rawContext(tx,s3,pre,before,id,secret,input));
}
export async function uploadContext(db,s3,pre,input,secret){
 const before=beforeGuard(pre,input,secret),intent=input.contextIntent;
 verifySignedFixture(intent,secret,'context-upload-intent',input);
 equal(intent,uploadIntent(before,pre,input,secret),'EXACT_DURABLE_CHILD_INTENT_REQUIRED');need(input.contextIntentSha256===digest(intent),'CHILD_INTENT_BYTES_BINDING_REQUIRED');
 contextPreflight(before.parentSeal,before.notificationRecipients.length);
 const current=await parentObserve(db,s3,pre,input,secret,before.parentSeal);
 verifyParentRejoined(pre,before.parentSeal,current);
 const image=await imageBytes();need(image.bytes.length===before.media.size&&sha(image.bytes)===before.media.contentHash&&image.thumb.length===before.media.thumbSize&&sha(image.thumb)===before.media.thumbHash,'SIGNED_IMAGE_BYTES_CHANGED');
 const response=await realPost(pre,secret,before.media.target,image.bytes);
 need(response.status===200&&response.body?.ok===true&&typeof response.body.id==='string','UNKNOWN_HTTP_RESULT_PRESERVE_NO_RETRY');
 const after=await captureContext(db,s3,pre,before,response.body.id,secret,input),proof=verifyContextReplacement(pre,before.parentSeal,after,before.media,response,before.notificationRecipients);
 const childRows={File:after.rows.File.filter(row=>row.id===proof.fileId),ChangeLog:after.rows.ChangeLog.filter(row=>proof.auditIds.includes(row.id)),Notification:after.rows.Notification.filter(row=>proof.notificationIds.includes(row.id))};
 return signed({...binding(pre,input),kind:'context-ack',beforeSha256:digest(before),intentSha256:digest(intent),response,afterSeal:sealContextAfter(after),childRows,proof},secret);
}
function ackGuard(pre,input,secret){
 const before=beforeGuard(pre,input,secret),ack=input.contextAck;verifySignedFixture(ack,secret,'context-ack',input);
 need(input.contextAckSha256===digest(ack)&&ack.beforeSha256===digest(before)&&ack.preSha256===digest(pre),'EXACT_SIGNED_CHILD_ACK_BINDING_REQUIRED');
 need(ack.afterSeal&&ack.childRows&&ack.proof&&ack.intentSha256===digest(uploadIntent(before,pre,input,secret)),'KNOWN_COMPACT_CHILD_ACK_REQUIRED');
 return {before,ack};
}
function unchangedContext(expected,after){
 const actual=sealContextAfter(after);
 for(const field of ['currentOwnedStateHash','storageManifestHash','financialStateHash','scopeHash','keysHash','product','contentHashes'])equal(actual[field],expected[field],'CHILD_CLEANUP_CAS_CHANGED_'+field.toUpperCase());
}
function actualAckGuard(pre,before,ack,current){
 unchangedContext(ack.afterSeal,current);
 equal(ack.proof,verifyContextReplacement(pre,before.parentSeal,current,before.media,ack.response,before.notificationRecipients),'SIGNED_CHILD_PROOF_CHANGED');
 equal(ack.childRows,{File:current.rows.File.filter(row=>row.id===ack.proof.fileId),ChangeLog:current.rows.ChangeLog.filter(row=>ack.proof.auditIds.includes(row.id)),Notification:current.rows.Notification.filter(row=>ack.proof.notificationIds.includes(row.id))},'SIGNED_CHILD_RAW_ROWS_CHANGED');
}
export async function issueCleanup(db,s3,pre,input,secret){
 const {before,ack}=ackGuard(pre,input,secret),current=await captureContext(db,s3,pre,before,ack.proof.fileId,secret,input);actualAckGuard(pre,before,ack,current);
 return signed({...binding(pre,input),kind:'context-cleanup-intent',beforeSha256:digest(before),ackSha256:digest(ack),descriptor:cleanupDescriptor(before,ack),acknowledgement:'RESTORE_ONLY_OWN_PRODUCT_SKETCH_AND_TIMESTAMP_DELETE_EXACT_CAPTURED_CHILD_IDS_AND_VERSIONS'},secret);
}
export async function cleanupContext(db,s3,pre,input,secret){
 const {before,ack}=ackGuard(pre,input,secret),intent=input.contextCleanupIntent;
 verifySignedFixture(intent,secret,'context-cleanup-intent',input);need(input.contextCleanupIntentSha256===digest(intent)&&intent.preSha256===digest(pre)&&intent.beforeSha256===digest(before)&&intent.ackSha256===digest(ack),'DURABLE_CHILD_CLEANUP_INTENT_REQUIRED');
 const descriptor=cleanupDescriptor(before,ack);equal(intent.descriptor,descriptor,'EXACT_CAPTURED_CHILD_CLEANUP_SCOPE_REQUIRED');
 const current=await captureContext(db,s3,pre,before,ack.proof.fileId,secret,input);actualAckGuard(pre,before,ack,current);
 return db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(18435,55113)');
  await frozen.lockOwned(tx,{rows:current.rows,actors:Object.values(pre.plan.actors).map(row=>row.id)});
  const locked=await rawContext(tx,s3,pre,before,ack.proof.fileId,secret,input,{writeGuard:true});unchangedContext(ack.afterSeal,locked);
  await frozen.protectedWriteRows(tx,pre,{scope:locked.scope,actors:Object.values(pre.plan.actors).map(row=>row.id)});
  // JSONB CAS включает всю исходную строку; timestamp берётся из SQL JSON без Date/округления.
  const previous=before.parentSeal.product,expected=ack.afterSeal.product;
  const restored=await tx.$queryRawUnsafe('UPDATE "Product" t SET "sketchFileId"=$1,"updatedAt"=$2::timestamp WHERE t.id=$3 AND to_jsonb(t)=$4::jsonb RETURNING to_jsonb(t) row',previous.sketchFileId,previous.updatedAt,previous.id,JSON.stringify(expected));
  need(restored.length===1,'FULL_RAW_PRODUCT_TYPED_CAS_REQUIRED');equal(restored[0].row,previous,'OWN_RAW_PRODUCT_RESTORE_NOT_EXACT');
  for(const [model,ids]of [['notification',descriptor.notificationIds],['changeLog',descriptor.auditIds],['file',descriptor.fileIds]]){
   need(ids.length>0&&ids.length<=200,'EXACT_CAPTURED_CHILD_IDS_REQUIRED');need((await tx[model].deleteMany({where:{id:{in:ids}}})).count===ids.length,'EXACT_CHILD_DELETE_COUNT_'+model.toUpperCase());
  }
  // Все DB locks/CAS/guards и readback выполнены до первого внешнего удаления.
  const parentState=await frozen.ownState(tx,pre,{scope:before.parentSeal.scope,keys:before.parentSeal.keys});
  equal(digest(parentState.rows),before.parentSeal.rowsHash,'PRE_S3_CLEANUP_PARENT_ROWS_NOT_EXACT');
  equal(parentState.scope,before.parentSeal.scope,'PRE_S3_CLEANUP_PARENT_SCOPE_NOT_EXACT');
  equal(parentState.keys,before.parentSeal.keys,'PRE_S3_CLEANUP_PARENT_KEYS_NOT_EXACT');
  await frozen.protectedWriteRows(tx,pre,parentState);
  const storageGuard=await frozen.storage(s3,locked.keys);equal(digest(storageGuard.own),ack.afterSeal.storageManifestHash,'PRE_DELETE_S3_CAS_CHANGED');
  need(storageGuard.originalHash===pre.storageBaseline.hash&&storageGuard.originalCount===pre.storageBaseline.count,'PRE_DELETE_ORIGINAL_S3_CHANGED');
  need(descriptor.storageVersions.length===2&&descriptor.storageVersions.every(row=>ack.proof.keys.includes(row.key)&&!before.parentSeal.keys.includes(row.key)&&row.versionId&&row.versionId!=='null'&&!row.deleteMarker),'ONLY_KNOWN_CHILD_VERSIONS_DELETE');
  for(const row of descriptor.storageVersions)await s3.send(new DeleteObjectCommand({Bucket:'pero-crm-staging',Key:row.key,VersionId:row.versionId}));
  const remaining=await frozen.storage(s3,before.parentSeal.keys);
  equal(digest(remaining.own),before.parentSeal.storageHash,'POST_CHILD_DELETE_PARENT_S3_CHANGED');
  need(remaining.originalHash===pre.storageBaseline.hash&&remaining.originalCount===pre.storageBaseline.count,'CHILD_OR_UNKNOWN_STORAGE_REMAINS');
  return signed({...binding(pre,input),kind:'context-cleanup-ack',beforeSha256:digest(before),ackSha256:digest(ack),cleanupIntentSha256:digest(intent),counts:{File:1,ChangeLog:3,Notification:descriptor.notificationIds.length,ProductRestored:1},knownChildVersionsRemoved:2,commitAck:true,lateParentObserveRequired:true},secret);
 },{isolationLevel:'Serializable',maxWait:10000,timeout:120000});
}
export async function closeContext(db,s3,pre,input,secret){
 const before=beforeGuard(pre,input,secret),parentObservation=await parentObserve(db,s3,pre,input,secret,before.parentSeal),proof=verifyParentRejoined(pre,before.parentSeal,parentObservation);
 return signed({...binding(pre,input),kind:'context-closed',beforeSha256:digest(before),parentSeal:sealParentObservation(pre,parentObservation),proof},secret);
}
export async function issueNegatives(db,s3,pre,input,secret){
 const before=beforeGuard(pre,input,secret);
 const parentBefore=await parentObserve(db,s3,pre,input,secret,before.parentSeal);verifyParentRejoined(pre,before.parentSeal,parentBefore);
 const p=pre.plan,planned=p.files.find(row=>row.key==='own-measure'),file=parentBefore.rows.File.find(row=>row.fileName===planned.fileName),bytes=await frozen.mediaBytes(planned);
 need(file&&planned.actor==='engineer'&&file.uploadedById===p.actors.engineer.id&&file.section==='MEASUREMENT'&&file.projectId===p.ids.project&&file.productId===p.ids.product&&file.taskId===null&&file.size===bytes.length,'EXISTING_PLANNED_OWN_MEASURE_REQUIRED');
 const media={actorId:p.actors.engineer.id,projectId:p.ids.project,productId:p.ids.product,section:'MEASUREMENT',clientMutationId:planned.clientMutationId,fileName:planned.fileName,mimeType:'image/png',size:bytes.length,contentHash:sha(bytes)};
 const fingerprint=bytesHash(Buffer.from(JSON.stringify({actorId:media.actorId,projectId:media.projectId,productId:media.productId,taskId:null,section:media.section,fileName:media.fileName,mimeType:media.mimeType,size:media.size,contentHash:media.contentHash})));
 const receipt=parentBefore.rows.ChangeLog.find(row=>row.id==='file-upload:'+media.clientMutationId);
 need(receipt?.entityId===file.id&&receipt.actorId===media.actorId&&receipt.action==='create'&&receipt.newValue?.uploadFingerprint===fingerprint,'IMMUTABLE_ORDINARY_UPLOAD_RECEIPT_REQUIRED');
 await assertObjectBytes(s3,parentBefore.storage.find(row=>row.key===file.projectId+'/'+file.storedName&&row.latest&&!row.deleteMarker),media.contentHash);
 return signed({...binding(pre,input),kind:'context-negative-intent',beforeSha256:digest(before),parentSeal:sealParentObservation(pre,parentBefore),media,fileId:file.id,cases:[...NEGATIVE_CASES],sources:sourceHashes(),acknowledgement:'EXACT_FIVE_EXISTING_OWN_MEASURE_CONTRACT_REQUESTS_NO_NEW_ROWS_OR_OBJECTS'},secret);
}
export async function runNegatives(db,s3,pre,input,secret){
 frozen.preGuard(pre,secret,input);const intent=input.contextNegativeIntent;verifySignedFixture(intent,secret,'context-negative-intent',input);
 need(intent.preSha256===digest(pre)&&input.contextNegativeIntentSha256===digest(intent),'DURABLE_SIGNED_NEGATIVE_INTENT_REQUIRED');
 const before=beforeGuard(pre,input,secret);need(intent.beforeSha256===digest(before),'NEGATIVE_PARENT_BEFORE_BINDING');equal(intent.sources,sourceHashes(),'NEGATIVE_SOURCE_CHANGED');equal(intent.cases,NEGATIVE_CASES,'EXACT_FIVE_NEGATIVE_CASES_REQUIRED');
 const current=await issueNegatives(db,s3,pre,input,secret);
 for(const field of ['media','fileId','cases','sources','beforeSha256'])equal(current[field],intent[field],'IMMUTABLE_NEGATIVE_BEFORE_CAS_CHANGED');
 const actualBefore=await parentObserve(db,s3,pre,input,secret,intent.parentSeal);verifyParentRejoined(pre,intent.parentSeal,actualBefore);
 const bytes=await frozen.mediaBytes({mimeType:'image/png'});need(sha(bytes)===intent.media.contentHash&&bytes.length===intent.media.size,'IMMUTABLE_NEGATIVE_BYTES_CHANGED');
 let parentObservation=actualBefore;const noops=[];
 for(const key of NEGATIVE_CASES){
  const response=await realPost(pre,secret,intent.media,bytes,key),after=await parentObserve(db,s3,pre,input,secret,intent.parentSeal);
  noops.push(verifyNoop(pre,parentObservation,after,key,response,intent.fileId,intent.media.clientMutationId));parentObservation=after;
 }
 return signed({...binding(pre,input),kind:'context-negative-ack',intentSha256:digest(intent),noops,parentSeal:sealParentObservation(pre,parentObservation),allFiveNoNewRowsOrVersions:true},secret);
}
export async function main(){
 let db,s3,result;
 try{
  const encoded=process.env.CRM_STAGING_BROWSER_INPUT;need(typeof encoded==='string'&&encoded.length>0&&encoded.length<=MAX_INPUT,'BOUNDED_PRIVATE_CONTEXT_INPUT_REQUIRED');
  const decoded=Buffer.from(encoded,'base64');need(decoded.length<=64*1024,'EXISTING_CONTEXT_DECODED_INPUT_CAP');const input=JSON.parse(decoded.toString('utf8'));transportBudget(input);const guard=fixtureStageGuard(input,process.env,{host:hostname(),docker:existsSync('/.dockerenv')});
  const modes={inspect:['context-before','context-cleanup-intent','context-closed','context-negative-intent'],prepare:['context-upload','context-negatives'],restore:['context-cleanup']};
  need(modes[input.operation]?.includes(input.mode),'EXACT_ROOT_CONTEXT_OPERATION_REQUIRED');
  need(input.pre?.revision===input.revision&&input.pre.plan?.revision===input.revision,'EXACT_FRESH_PARENT_PHYSICAL_REVISION_REQUIRED');
  frozen.preGuard(input.pre,guard.secret,input);sourceHashes();
  db=new PrismaClient({log:[],errorFormat:'minimal'});s3=frozen.client();phase=input.mode;
  if(input.mode==='context-before')result={status:'CONTEXT_BEFORE',...await issueContext(db,s3,input.pre,input,guard.secret)};
  else if(input.mode==='context-upload')result={status:'CONTEXT_ACK',ack:await uploadContext(db,s3,input.pre,input,guard.secret)};
  else if(input.mode==='context-cleanup-intent')result={status:'CONTEXT_CLEANUP_INTENT',intent:await issueCleanup(db,s3,input.pre,input,guard.secret)};
  else if(input.mode==='context-cleanup')result={status:'CONTEXT_CLEANED',ack:await cleanupContext(db,s3,input.pre,input,guard.secret)};
  else if(input.mode==='context-closed')result={status:'CONTEXT_CLOSED',closed:await closeContext(db,s3,input.pre,input,guard.secret)};
  else if(input.mode==='context-negative-intent')result={status:'CONTEXT_NEGATIVE_INTENT',intent:await issueNegatives(db,s3,input.pre,input,guard.secret)};
  else result={status:'CONTEXT_NEGATIVE_ACK',ack:await runNegatives(db,s3,input.pre,input,guard.secret)};
  need(Buffer.byteLength(JSON.stringify(result))<=MAX_OUTPUT,'PRIVATE_CONTEXT_OUTPUT_CAP');
 }catch(error){result={status:'STOP',phase,code:/^[A-Z0-9_]{1,100}$/.test(error?.message??'')?error.message:'CONTEXT113_STOP_PRESERVE_STATE',preserveNoRetry:true};process.exitCode=1;}
 finally{await db?.$disconnect();s3?.destroy();}
 console.log(JSON.stringify(result));
}
const entry=process.argv[1];if((!entry||path.resolve(entry)===fileURLToPath(import.meta.url))&&process.env.CRM_STAGING_BROWSER_INPUT&&process.env.CRM_MODERNIZATION_TARGET==='staging')void main();
