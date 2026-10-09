// Только исходный дополнительный QA: один дочерний эскиз в подписанном scope родителя13.
// SAFETY D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md: STOP при mismatch/потерянном ACK.
import {createHash,randomUUID} from 'node:crypto';
import {need,canonical,digest,validatePlan,FIXTURE_NAMESPACE} from './file-fixture113-protocol.mjs';

export const FROZEN_SOURCES=Object.freeze({
 'file-fixture113-entry.mjs':'def45eb010e03daaa6526ac8862c1c752e91c135b022cabcb2fd8bc54f1501fb',
 'file-fixture113-protocol.mjs':'7b1001d102408facba349ce3db4279421dc29d87ade4fb1e6c795751d706fe92',
 'crm-acceptance-token-clock.mjs':'13407f3f719ef7962e2ffb21abb52089e7132b4ec402db87340d9c2fe3b7fc51',
});
export const FROZEN_EXTRA=Object.freeze({
 'file-fixture113-runner.mjs':'b6dd281a1985b841843e4483241fb07dbd33f88cfdf5cdf0996d827823d875fe',
 'file-fixture113-lifecycle-native.mjs':'60105e21a10a856343562aa1e4e12bf4ef33ce6e1872c6573064d9b2252862f0',
});
export const ADAPTER_AUTORUN="const entry=process.argv[1];if((!entry||path.resolve(entry)===fileURLToPath(import.meta.url))&&process.env.CRM_STAGING_BROWSER_INPUT&&process.env.CRM_MODERNIZATION_TARGET==='staging')void main();";
export const ADAPTER_EXPORTS=Object.freeze(['original','storage','readonly','cookies','preGuard','protectedWriteRows','selected','client']);
export const NEGATIVE_CASES=Object.freeze(['category','caption','stage','exact-replay','section-conflict']);
const SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,ID=/^[A-Za-z0-9:_-]{1,160}$/;
const equal=(a,b,code)=>need(canonical(a)===canonical(b),code);
export function contextPacket(pre,operation,mode,extra={}){
 const input={authorized:true,runId:pre.runId,revision:pre.revision,operation,mode,pre,preSha256:digest(pre),...extra};
 transportBudget(input);return input;
}
export function contextPreflight(seal,recipientCount){
 need(Number.isSafeInteger(recipientCount)&&recipientCount>0&&recipientCount<=200&&seal.rowCounts.File+1<=8&&seal.rowCounts.ChangeLog+3<=100&&seal.rowCounts.Notification+recipientCount<=200,'CHILD_CAPTURE_BOUND_BEFORE_POST');
 need(Buffer.byteLength(JSON.stringify(seal.product))<=8192,'RAW_OWN_PRODUCT_REPLY_BOUND_BEFORE_POST');
 return true;
}
export function transportBudget(input){
 const bytes=Buffer.byteLength(JSON.stringify(input)),encodedBytes=Buffer.from(JSON.stringify(input)).toString('base64').length;
 need(bytes<=64*1024&&encodedBytes<=96*1024,'EXISTING_CONTEXT_INPUT_CAP');
 return {decodedBytes:bytes,encodedBytes};
}
export function sealParentObservation(pre,obs){
 if(obs?.kind==='context-parent-seal'){
  need(obs.namespace===FIXTURE_NAMESPACE&&obs.version===2&&obs.runId===pre.runId&&obs.revision===pre.revision&&obs.preSha256===digest(pre),'EXACT_PARENT_SEAL_BINDING');
  need(SHA.test(obs.rowsHash??'')&&SHA.test(obs.storageHash??'')&&SHA.test(obs.observationSha256??'')&&Array.isArray(obs.tableNames)&&obs.tableNames.length===Object.keys(obs.tableHashes??{}).length&&obs.tableNames.every(table=>SHA.test(obs.tableHashes[table]??'')&&Number.isSafeInteger(obs.rowCounts[table])&&obs.rowCounts[table]>=0),'EXACT_ALL_PARENT_TABLE_HASHES_REQUIRED');
  need(obs.originalVerification?.originalRelationsMatch===true&&obs.originalVerification.preferencesUntouched===true&&obs.originalVerification.tokenClockValid===true&&obs.scope&&Array.isArray(obs.keys),'ORIGINAL_PARENT_SEAL_PROOF_REQUIRED');
  return obs;
 }
 observationGuard(obs,pre);
 const product=obs.rows.Product[0],oldSketch=obs.rows.File.find(row=>row.id===product.sketchFileId);
 return {namespace:FIXTURE_NAMESPACE,version:2,kind:'context-parent-seal',runId:pre.runId,revision:pre.revision,preSha256:digest(pre),observationSha256:digest(obs),rowsHash:obs.currentOwnedStateHash,storageHash:obs.storageManifestHash,tableNames:Object.keys(obs.rows).sort(),tableHashes:Object.fromEntries(Object.entries(obs.rows).map(([table,rows])=>[table,digest(rows)])),rowCounts:Object.fromEntries(Object.entries(obs.rows).map(([table,rows])=>[table,rows.length])),scope:obs.scope,keys:obs.keys,product,project:obs.rows.Project[0],engineer:obs.rows.User.find(row=>row.id===pre.plan.actors.engineer.id),oldSketch,originalVerification:{originalRelationsMatch:true,preferencesUntouched:true,tokenClockValid:true}};
}
export function sealContextAfter(after){
 return {currentOwnedStateHash:after.currentOwnedStateHash,storageManifestHash:after.storageManifestHash,financialStateHash:after.financialStateHash,scopeHash:digest(after.scope),keysHash:digest(after.keys),product:after.rows.Product[0],contentHashes:after.contentHashes,capturedAt:after.capturedAt};
}
export const bytesHash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function derivedFrozenLibrary(bytes){
 need(bytes instanceof Uint8Array&&bytesHash(bytes)===FROZEN_SOURCES['file-fixture113-entry.mjs'],'FROZEN_ENTRY_BYTES_CHANGED');
 const text=Buffer.from(bytes).toString('utf8'),matches=text.split(ADAPTER_AUTORUN);
 need(matches.length===2&&/^\r?\n?$/.test(matches[1]),'EXACT_ONE_FINAL_AUTORUN_REQUIRED');
 return matches[0]+'\nexport {'+ADAPTER_EXPORTS.join(',')+'};\n';
}
export function frozenSourceGuard(sources){
 equal(sources,FROZEN_SOURCES,'FROZEN_PARENT_SOURCES_CHANGED');
}
export function sqlTimestampMicros(value){
 need(typeof value==='string','RAW_SQL_TIMESTAMP_REQUIRED');
 const match=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
 need(match,'RAW_SQL_TIMESTAMP_FORMAT_REQUIRED');
 const milliseconds=Date.parse(match[1]+(match[3]??'Z'));
 need(Number.isSafeInteger(milliseconds),'RAW_SQL_TIMESTAMP_INVALID');
 return BigInt(milliseconds)*1000n+BigInt((match[2]??'').padEnd(6,'0'));
}
function observationGuard(obs,pre){
 need(obs?.namespace===FIXTURE_NAMESPACE&&obs.version===2&&obs.runId===pre.runId&&obs.revision===pre.revision&&obs.preSha256===digest(pre),'SIGNED_PARENT_OBSERVATION_BINDING');
 need(obs.rows&&obs.scope&&Array.isArray(obs.keys)&&Array.isArray(obs.storage),'FULL_PARENT_SNAPSHOT_REQUIRED');
 equal(obs.currentOwnedStateHash,digest(obs.rows),'OWN_RAW_SNAPSHOT_HASH_MISMATCH');
 equal(obs.storageManifestHash,digest(obs.storage),'OWN_VERSION_SNAPSHOT_HASH_MISMATCH');
 need(obs.originalVerification?.originalRelationsMatch===true&&obs.originalVerification.preferencesUntouched===true&&obs.originalVerification.tokenClockValid===true,'ALL_ORIGINAL_TABLES_SCHEMA_PREFS_CLOCKS_REQUIRED');
}
export function validateContextBefore(pre,obs){
 validatePlan(pre.plan);frozenSourceGuard(pre.sources);const seal=sealParentObservation(pre,obs);
 const p=pre.plan,product=seal.product,project=seal.project,engineer=seal.engineer;
 need(seal.rowCounts.Product===1&&seal.rowCounts.Project===1&&product.id===p.ids.product&&project.id===p.ids.project&&product.projectId===p.ids.project&&project.stage==='CONTRACT'&&product.status==='DESIGN'&&product.engineerId===p.actors.engineer.id,'EXACT_OWN_ASSIGNED_DESIGN_PRODUCT_REQUIRED');
 need(engineer?.active===true&&engineer.passwordHash===p.actors.engineer.passwordHash&&engineer.sessionVersion===0&&canonical(engineer.roles)==='["ENGINEER"]','EXISTING_DISABLED_PARENT_ENGINEER_REQUIRED');
 const media=p.files.find(row=>row.key==='sketch'),old=seal.oldSketch;
 need(media&&old&&old.fileName===media.fileName&&old.uploadedById===p.actors.admin.id&&old.section==='PRODUCTION'&&old.mimeType==='image/png'&&old.hasThumb&&old.projectId===p.ids.project&&old.productId===p.ids.product&&old.taskId===null,'CURRENT_FOREIGN_ADMIN_SKETCH_REQUIRED');
 sqlTimestampMicros(product.updatedAt);
 need(Object.hasOwn(product,'createdAt')&&Object.hasOwn(product,'statusChangedAt')&&Object.hasOwn(product,'expectedPrice')&&Object.hasOwn(product,'initialPrice')&&Object.hasOwn(product,'deletedAt'),'FULL_RAW_PRODUCT_JSON_REQUIRED');
 return {product,old};
}
export function contextMedia(pre,obs,clientMutationId=randomUUID()){
 const {product}=validateContextBefore(pre,obs),p=pre.plan;
 need(UUID.test(clientMutationId)&&![...p.files,...p.financeDocs].some(row=>row.clientMutationId===clientMutationId)&&!sealParentObservation(pre,obs).scope.ChangeLog.includes('product-sketch:'+clientMutationId),'FRESH_SINGLE_CHILD_NONCE_REQUIRED');
 return {key:'engineer-sketch',actorId:p.actors.engineer.id,projectId:p.ids.project,productId:p.ids.product,expectedSketchFileId:product.sketchFileId,clientMutationId,fileName:'qa113-'+pre.runId+'-engineer-sketch.png',mimeType:'image/png',section:'PRODUCTION',width:360,height:480,background:'#336699'};
}
export function validateContextMedia(pre,before,media){
 equal(media,contextMedia(pre,before,media?.clientMutationId),'EXACT_ONE_CHILD_IMAGE_SCOPE_REQUIRED');
 need(media.fileName.length<=80&&!/[\\/\0]/.test(media.fileName),'BOUNDED_CHILD_FILENAME_REQUIRED');
}
export function childKeys(pre,file,media){
 need(ID.test(file?.id??'')&&file.projectId===pre.plan.ids.project&&file.fileName===media.fileName&&UUID.test(file.storedName?.slice(0,36)??'')&&file.storedName.slice(36)==='-'+media.fileName&&file.hasThumb===true,'EXACT_CHILD_STORED_NAME_REQUIRED');
 return [file.projectId+'/'+file.storedName,file.projectId+'/thumbs/'+file.storedName+'.jpg'];
}
export function contextScope(before,rows){
 const scope={...before.scope};
 for(const table of ['File','ChangeLog','Notification'])scope[table]=[...new Set([...(before.scope[table]??[]),...rows[table].map(row=>row.id)])];
 return scope;
}
function preservingRows(before,after,exceptions){
 equal(Object.keys(after.rows).sort(),before.tableNames,'OWN_TABLE_SET_CHANGED');
 for(const table of before.tableNames)if(!exceptions.includes(table))equal(digest(after.rows[table]),before.tableHashes[table],'PARENT_OWN_ROW_CHANGED_'+table);
}
function exactDelta(before,after,table,count){
 const current=after.rows[table],ids=new Set(before.scope[table]),added=current.filter(row=>!ids.has(row.id));
 need(current.length===new Set(current.map(row=>row.id)).size&&current.length===before.rowCounts[table]+count&&added.length===count,'EXACT_DELTA_COUNT_'+table);
 equal(digest(current.filter(row=>ids.has(row.id))),before.tableHashes[table],'PREEXISTING_OWN_ROW_CHANGED_'+table);
 return added;
}
export function coverUploadFingerprint(media){
 return bytesHash(Buffer.from(JSON.stringify({operation:'upload',projectId:media.projectId,productId:media.productId,expectedSketchFileId:media.expectedSketchFileId,clientMutationId:media.clientMutationId,fileName:media.fileName,mimeType:media.mimeType,size:media.size,contentHash:media.contentHash})));
}
export function verifyContextReplacement(pre,beforeInput,after,media,response,notificationRecipients){
 const before=sealParentObservation(pre,beforeInput);
 validateContextMedia(pre,before,media.target);const target=media.target;
 observationGuard(after,pre);
 need(SHA.test(media.contentHash??'')&&SHA.test(media.thumbHash??'')&&Number.isSafeInteger(media.size)&&media.size>0&&Number.isSafeInteger(media.thumbSize)&&media.thumbSize>0,'SIGNED_EXACT_IMAGE_BYTES_REQUIRED');
 need(response?.method==='POST'&&response.path==='/api/files/upload'&&response.status===200&&response.redirected===false&&response.body?.ok===true&&response.body.repeated!==true&&response.body.clientMutationId===target.clientMutationId,'GENUINE_NEW_COMPILED_COVER_ACK_REQUIRED');
 const id=response.body.id;
 need(ID.test(id??'')&&response.body.sketchFileId===id,'ACTUAL_CHILD_ACK_ID_REQUIRED');
 const [file]=exactDelta(before,after,'File',1);need(file.id===id&&file.uploadedById===target.actorId&&file.productId===target.productId&&file.taskId===null&&file.section==='PRODUCTION'&&file.mimeType==='image/png'&&file.size===media.size&&file.legacyId===null&&file.legacyTable===null,'EXACT_NEW_ENGINEER_PRODUCTION_FILE_REQUIRED');
 equal(Object.keys(file).sort(),Object.keys(before.oldSketch).sort(),'CHILD_FILE_MODEL_SHAPE_CHANGED');
 equal(response.body.sketch,{id,fileName:file.fileName,mimeType:file.mimeType,size:file.size,hasThumb:file.hasThumb,section:file.section,uploadedById:file.uploadedById},'GENUINE_SKETCH_READBACK_MISMATCH');
 const keys=childKeys(pre,file,target),product=after.rows.Product[0],oldProduct=before.product;
 need(after.rows.Product.length===1&&product.id===oldProduct.id&&product.sketchFileId===id,'ACTUAL_OWN_PRODUCT_POINTER_REQUIRED');
 const stable=row=>{const copy={...row};delete copy.sketchFileId;delete copy.updatedAt;return copy;};
 equal(stable(product),stable(oldProduct),'OTHER_OWN_PRODUCT_FIELD_CHANGED');
 need(sqlTimestampMicros(product.updatedAt)>=sqlTimestampMicros(oldProduct.updatedAt)&&sqlTimestampMicros(product.updatedAt)<=sqlTimestampMicros(after.capturedAt),'LEGITIMATE_PRODUCT_UPDATED_AT_REQUIRED');
 preservingRows(before,after,['File','Product','ChangeLog','Notification']);
 const logs=exactDelta(before,after,'ChangeLog',3),engineer=pre.plan.actors.engineer;
 need(logs.every(row=>ID.test(row.id)&&row.actorId===engineer.id&&row.actorType==='user'&&row.actorName===engineer.name&&row.source==='web'),'EXACT_CHILD_ENGINEER_AUDIT_REQUIRED');
 const create=logs.filter(row=>row.entity==='file'&&row.entityId===id&&row.action==='create'),change=logs.filter(row=>row.entity==='product'&&row.entityId===target.productId&&row.action==='cover.change'),receipt=logs.filter(row=>row.id==='product-sketch:'+target.clientMutationId&&row.entity==='product'&&row.entityId===target.productId&&row.action==='cover.upload');
 need(create.length===1&&change.length===1&&receipt.length===1,'EXACT_THREE_COVER_AUDITS_REQUIRED');
 equal(create[0].newValue,{projectId:target.projectId,productId:target.productId,fileName:target.fileName,section:'PRODUCTION'},'FILE_CREATE_AUDIT_BODY_CHANGED');
 need(create[0].oldValue===null&&create[0].field===null&&change[0].field==='sketchFileId'&&receipt[0].field==='sketchFileId'&&receipt[0].oldValue===null,'EXACT_COVER_AUDIT_FIELDS_REQUIRED');
 equal(change[0].oldValue,{sketchFileId:target.expectedSketchFileId},'COVER_PRIOR_POINTER_AUDIT_REQUIRED');
 equal(change[0].newValue,{sketchFileId:id,uploaded:true},'COVER_NEW_POINTER_AUDIT_REQUIRED');
 equal(receipt[0].newValue,{fingerprint:coverUploadFingerprint({...target,size:media.size,contentHash:media.contentHash}),result:{ok:true,id,sketchFileId:id,clientMutationId:target.clientMutationId}},'EXACT_COMPILED_COVER_RECEIPT_REQUIRED');
 need(Array.isArray(notificationRecipients)&&notificationRecipients.length>0&&notificationRecipients.length<=200&&new Set(notificationRecipients).size===notificationRecipients.length,'EXACT_PREDICTED_NOTIFICATION_RECIPIENTS_REQUIRED');
 const notifications=exactDelta(before,after,'Notification',notificationRecipients.length);
 equal(notifications.map(row=>row.userId).sort(),[...notificationRecipients].sort(),'CHILD_NOTIFICATION_RECIPIENTS_CHANGED');
 need(notifications.every(row=>ID.test(row.id)&&row.type==='file.added'&&row.body===target.fileName&&row.title==='Файл к проекту '+pre.plan.projectNumber&&row.link==='/products/'+pre.plan.productNumber&&row.readAt===null),'EXACT_CHILD_NOTIFICATIONS_REQUIRED');
 equal(digest(after.storage.filter(row=>!keys.includes(row.key))),before.storageHash,'OLD_ADMIN_AND_PARENT_STORAGE_CHANGED');
 const versions=after.storage.filter(row=>keys.includes(row.key));
 need(versions.length===2&&keys.every(key=>versions.filter(row=>row.key===key).length===1)&&versions.every(row=>row.latest===true&&row.deleteMarker===false&&typeof row.versionId==='string'&&row.versionId.length>0&&row.versionId.length<=1024&&row.versionId!=='null'&&typeof row.etag==='string'),'EXACT_TWO_KNOWN_CHILD_VERSIONS_REQUIRED');
 need(versions.find(row=>row.key===keys[0]).size===media.size&&versions.find(row=>row.key===keys[1]).size===media.thumbSize,'EXACT_CHILD_OBJECT_SIZES_REQUIRED');
 equal(after.contentHashes,{[keys[0]]:media.contentHash,[keys[1]]:media.thumbHash},'ACTUAL_CHILD_BYTES_READBACK_REQUIRED');
 equal(after.keys,[...before.keys,...keys],'EXACT_PARENT_PLUS_CHILD_KEYS_REQUIRED');
 equal(after.scope,contextScope(before,after.rows),'EXACT_PARENT_PLUS_CHILD_SCOPE_REQUIRED');
 return {fileId:id,auditIds:logs.map(row=>row.id),notificationIds:notifications.map(row=>row.id),keys,versions,originalRelationsMatch:true,oldAdminFileUnchanged:true,ownMoneyUnchanged:true,ownPreferencesUntouched:true,priorOwnAuditPreserved:true,parent13RejoinRequired:true};
}
export function verifyNoop(pre,before,after,key,response,fileId,nonce){
 observationGuard(before,pre);observationGuard(after,pre);
 need(NEGATIVE_CASES.includes(key)&&response?.method==='POST'&&response.path==='/api/files/upload'&&response.redirected===false,'EXACT_NEGATIVE_CONTRACT_RESPONSE');
 if(['category','caption','stage'].includes(key))need(response.status===422&&response.body?.ok===false&&response.body.kind==='validation'&&response.body.code==='UPLOAD_FORM_OUTDATED','STALE_FORM_MUST_REJECT_422');
 else if(key==='exact-replay')need(response.status===200&&response.body?.ok===true&&response.body.repeated===true&&response.body.id===fileId&&response.body.clientMutationId===nonce,'ORDINARY_EXACT_REPLAY_REQUIRED');
 else need(response.status===409&&response.body?.ok===false&&response.body.code==='UPLOAD_REPLAY_CONFLICT'&&response.body.kind==='conflict'&&response.body.commitState==='notCommitted','ORDINARY_SECTION_CONFLICT_REQUIRED');
 equal(after.rows,before.rows,'NEGATIVE_CONTRACT_DB_SIDE_EFFECT');
 equal(after.storage,before.storage,'NEGATIVE_CONTRACT_S3_SIDE_EFFECT');
 equal(after.currentOwnedStateHash,before.currentOwnedStateHash,'NEGATIVE_CONTRACT_OWN_HASH_CHANGED');
 equal(after.storageManifestHash,before.storageManifestHash,'NEGATIVE_CONTRACT_VERSION_HASH_CHANGED');
 return {key,status:response.status,fileId,rowsUnchanged:true,allVersionsUnchanged:true,originalRelationsMatch:true};
}
export function cleanupDescriptor(before,ack){
 need(ack?.proof?.fileId&&ack.afterSeal&&ack.beforeSha256===digest(before),'SIGNED_KNOWN_CHILD_ACK_REQUIRED');
 return {productId:before.parentSeal.product.id,fromSketchFileId:ack.proof.fileId,toSketchFileId:before.parentSeal.product.sketchFileId,fileIds:[ack.proof.fileId],auditIds:[...ack.proof.auditIds],notificationIds:[...ack.proof.notificationIds],storageVersions:ack.proof.versions.map(row=>({...row})),expectedOwnStateHash:ack.afterSeal.currentOwnedStateHash,expectedStorageManifestHash:ack.afterSeal.storageManifestHash};
}
export function verifyCompactContextAck(pre,before,ack){
 const seal=sealParentObservation(pre,before.parentSeal);validateContextMedia(pre,seal,before.media.target);
 need(ack.beforeSha256===digest(before)&&ack.afterSeal&&SHA.test(ack.afterSeal.currentOwnedStateHash??'')&&SHA.test(ack.afterSeal.storageManifestHash??'')&&ack.proof?.fileId,'COMPACT_ACK_BOUND_TO_SIGNED_BEFORE_REQUIRED');
 const file=ack.childRows?.File?.[0],target=before.media.target,id=ack.proof.fileId;
 need(ack.childRows.File.length===1&&file.id===id&&file.uploadedById===target.actorId&&file.section==='PRODUCTION'&&file.projectId===target.projectId&&file.productId===target.productId&&file.taskId===null&&file.fileName===target.fileName&&file.mimeType==='image/png'&&file.size===before.media.size&&file.hasThumb,'COMPACT_REAL_CHILD_FILE_REQUIRED');
 equal(childKeys(pre,file,target),ack.proof.keys,'COMPACT_ACK_EXACT_CHILD_KEYS_REQUIRED');
 need(ack.response?.status===200&&ack.response.body?.ok===true&&ack.response.body.id===id&&ack.response.body.sketchFileId===id&&ack.response.body.clientMutationId===target.clientMutationId&&ack.response.body.repeated!==true,'COMPACT_ACK_GENUINE_RESPONSE_REQUIRED');
 equal(ack.childRows.ChangeLog.map(row=>row.id),ack.proof.auditIds,'COMPACT_ACK_AUDIT_IDS_REQUIRED');
 equal(ack.childRows.Notification.map(row=>row.id),ack.proof.notificationIds,'COMPACT_ACK_NOTIFICATION_IDS_REQUIRED');
 need(ack.proof.auditIds.length===3&&ack.proof.versions.length===2&&ack.proof.notificationIds.length===before.notificationRecipients.length,'COMPACT_ACK_EXACT_CHILD_COUNTS_REQUIRED');
 const stable=row=>{const out={...row};delete out.sketchFileId;delete out.updatedAt;return out;};
 equal(stable(ack.afterSeal.product),stable(seal.product),'COMPACT_ACK_OTHER_PRODUCT_FIELD_CHANGED');
 need(ack.afterSeal.product.sketchFileId===id&&sqlTimestampMicros(ack.afterSeal.product.updatedAt)>=sqlTimestampMicros(seal.product.updatedAt),'COMPACT_ACK_CURRENT_PRODUCT_REQUIRED');
 return ack.proof;
}
export function verifyParentRejoined(pre,before,restored){
 const seal=sealParentObservation(pre,before),actual=sealParentObservation(pre,restored);
 equal(actual.rowsHash,seal.rowsHash,'SUPPLEMENTAL_CLEANUP_PARENT_ROWS_NOT_RESTORED');
 equal(actual.storageHash,seal.storageHash,'SUPPLEMENTAL_CLEANUP_PARENT_STORAGE_NOT_RESTORED');
 equal(actual.scope,seal.scope,'SUPPLEMENTAL_CLEANUP_PARENT_SCOPE_CHANGED');
 equal(actual.keys,seal.keys,'SUPPLEMENTAL_CLEANUP_PARENT_KEYS_CHANGED');
 return {parent13Compatible:true,priorOwnRowsExact:true,priorRawProductExact:true,priorOwnAuditsPreserved:true,ownMoneyAndPrefsUnchanged:true,childRowsAndVersionsGone:true,originalRelationsMatch:true};
}
