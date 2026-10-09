// Root-only bridge for ONE real FinanceDocumentUpload UI request in the sealed parent13 scope.
// Import is inert. No app/producer edits, direct backend upload, actors, schema or extra planned docs.
// SAFETY D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP on mismatch/lost ACK, never retry.
import {createHash} from 'node:crypto';
import {fixture113Bundle,immutablePublish} from './file-fixture113-runner.mjs';
import {qaTransport} from './crm-acceptance-transport.mjs';
import {need,canonical,digest,FIXTURE_NAMESPACE} from './file-fixture113-protocol.mjs';
import path from 'node:path';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,SHA=/^[a-f0-9]{64}$/,REV=/^[a-f0-9]{40}$/;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function plannedUiNonceMapping(intent,request,parent){
 need(intent?.kind==='upload-intent'&&intent.namespace===FIXTURE_NAMESPACE&&intent.runId===parent.runId&&intent.revision===parent.revision&&SHA.test(intent.signature??'')&&intent.mediaKey==='finance-image','ACTUAL_PARENT_IMAGE_INTENT_REQUIRED');
 need(request?.method==='POST'&&request.url==='https://staging-crm.peromebel.by/api/finance/documents/upload'&&request.actorId===parent.adminId&&Array.isArray(request.fieldNames)&&request.fieldNames.length===2&&canonical([...request.fieldNames].sort())===canonical(['clientMutationId','file']),'EXACT_REAL_UI_REQUEST_REQUIRED');
 need(UUID.test(request.uiMutationId??'')&&request.uiMutationId!==intent.clientMutationId&&UUID.test(intent.clientMutationId??'')&&request.bytes instanceof Uint8Array,'FRESH_UI_NONCE_AND_BYTES_REQUIRED');
 need(request.fileName===intent.fileName&&request.mimeType===intent.mimeType&&request.bytes.byteLength===intent.size&&hash(request.bytes)===intent.contentHash,'ACTUAL_UI_FILE_BYTES_MISMATCH');
 return {kind:'planned-finance-ui-nonce-mapping',runId:parent.runId,revision:parent.revision,mediaKey:intent.mediaKey,actorId:parent.adminId,uiMutationId:request.uiMutationId,effectiveMutationId:intent.clientMutationId,intentSha256:digest(intent),fileName:intent.fileName,mimeType:intent.mimeType,size:intent.size,contentHash:intent.contentHash,parentStateHash:intent.expectedOwnedStateHash,parentStorageHash:intent.expectedStorageManifestHash};
}
export function verifyActualUiUpload(before,after,intent,response,parent){
 need([200,201].includes(response?.status)&&response.redirected===false&&response.body?.ok===true&&typeof response.body.document?.id==='string','GENUINE_COMPILED_FINANCE_RESPONSE_REQUIRED');
 const id=response.body.document.id,oldIds=new Set(before.rows.FinanceDocument.map(row=>row.id)),doc=after.rows.FinanceDocument.find(row=>row.id===id);
 need(doc&&!oldIds.has(id)&&after.rows.FinanceDocument.length===before.rows.FinanceDocument.length+1&&doc.clientMutationId===intent.clientMutationId&&doc.uploadedById===parent.adminId&&doc.fileName===intent.fileName&&doc.mimeType===intent.mimeType&&doc.size===intent.size&&doc.contentHash===intent.contentHash&&doc.state==='READY'&&doc.storageMode==='s3'&&doc.storageKey==='finance-documents/'+id+'/'+intent.contentHash,'ACTUAL_READY_PLANNED_DOC_REQUIRED');
 need(canonical(after.rows.FinanceDocument.filter(row=>row.id!==id))===canonical(before.rows.FinanceDocument),'PREEXISTING_FINANCE_DOC_CHANGED');
 for(const table of Object.keys(before.rows))if(!['FinanceDocument','ChangeLog'].includes(table))need(canonical(before.rows[table])===canonical(after.rows[table]),'UI_UPLOAD_OWN_SIDE_EFFECT_'+table);
 const oldLogs=new Set(before.rows.ChangeLog.map(row=>row.id));need(before.rows.ChangeLog.every(row=>after.rows.ChangeLog.some(current=>current.id===row.id&&canonical(current)===canonical(row))),'UI_UPLOAD_PREVIOUS_AUDIT_CHANGED');
 const added=after.rows.ChangeLog.filter(row=>!oldLogs.has(row.id));need(added.length===1&&added[0].id==='finance-document:'+id&&added[0].entity==='financeDocument'&&added[0].entityId===id&&added[0].actorId===parent.adminId&&added[0].action==='create','ACTUAL_UI_UPLOAD_AUDIT_REQUIRED');
 need(after.originalVerification?.originalRelationsMatch===true&&after.originalVerification.preferencesUntouched===true&&after.originalVerification.tokenClockValid===true,'ORIGINAL_RELATIONS_CLOCK_PREFS_REQUIRED');
 need(canonical(after.storage.filter(row=>row.key!==doc.storageKey))===canonical(before.storage)&&after.storage.some(row=>row.key===doc.storageKey&&row.latest&&!row.deleteMarker&&row.size===intent.size),'UI_UPLOAD_EXACT_OWN_STORAGE_REQUIRED');
 return {kind:'verified-actual-finance-ui-upload',fileId:id,stateHash:after.currentOwnedStateHash,storageHash:after.storageManifestHash,originalRelationsMatch:true,ownMoneyUnchanged:true,preferencesUntouched:true,priorOwnAuditPreserved:true,storageVersionsAccounted:true,tokenClockValid:true};
}
/** Parent PRE must be loaded from its existing hashed private receipt; never resigner/alter its planned nonce. */
export function createPlannedFinanceUiBridge(options){
 need(options?.authorized===true&&REV.test(options.revision??'')&&UUID.test(options.runId??'')&&options.pre?.namespace===FIXTURE_NAMESPACE&&options.pre.runId===options.runId&&SHA.test(options.pre.signature??'')&&path.isAbsolute(options.outputDir??''),'ROOT_SEALED_PARENT_SCOPE_REQUIRED');
 const parent={runId:options.runId,revision:options.revision,adminId:options.pre.plan.actors.admin.id},pre=options.pre;let before,intent,mapping,completed=false,stopped=false,part=0;
 const publish=(label,value)=>immutablePublish(path.join(options.outputDir,'ui13-'+String(++part).padStart(3,'0')+'-'+label+'.json'),value);
 async function inspect(mode,extra={}){
  const bundle=await fixture113Bundle();need(canonical(bundle.sources)===canonical(pre.sources),'FROZEN_PARENT_SOURCES_CHANGED');
  const result=await qaTransport({target:'staging',revision:parent.revision,outputDir:options.outputDir}).execute(bundle.bytes,'inspect',{authorized:true,operation:'inspect',mode,revision:parent.revision,runId:parent.runId,pre,preSha256:digest(pre),...(options.priorObservation?{priorObservation:options.priorObservation}:{}),...extra});
  need(result.receipt?.identity?.hostname==='crm-staging'&&result.receipt.identity.revision===parent.revision&&result.receipt.bundleSha256===bundle.sha256&&result.receipt.exitCode===0&&result.body.status!=='STOP','ACTUAL_PARENT_TRANSPORT_REQUIRED');return result;
 }
 return {
  async beginUpload(){
   need(!intent&&!stopped,'ONE_UI_UPLOAD_ONLY');const captured=await inspect('observe');need(captured.body.status==='OWN_CAPTURED','CURRENT_PARENT_OBSERVATION_REQUIRED');before=captured.body.observation;
   need(!before.rows.FinanceDocument.some(doc=>doc.clientMutationId===pre.plan.financeDocs.find(row=>row.key==='finance-image').clientMutationId),'PLANNED_IMAGE_NOT_YET_UPLOADED');
   const planned=await inspect('intent',{mediaKey:'finance-image'});need(planned.body.status==='INTENT_CAPTURED','SIGNED_PARENT_UPLOAD_INTENT_REQUIRED');intent=planned.body.intent;need(intent.expectedOwnedStateHash===before.currentOwnedStateHash&&intent.expectedStorageManifestHash===before.storageManifestHash,'UI_INTENT_STATE_CAS');
   publish('before',{kind:'actual-ui-upload-before',before,receipt:captured.receipt});publish('intent',{kind:'durable-actual-ui-upload-intent',intent,receipt:planned.receipt});return {intent,actorId:parent.adminId};
  },
  async beforeUpstream(request){
   need(intent&&!mapping&&!completed&&!stopped,'ONE_PENDING_REAL_UI_REQUEST');mapping=plannedUiNonceMapping(intent,request,parent);publish('mapping',{kind:'durable-ui-nonce-mapping',mapping});return {recorded:true,effectiveMutationId:mapping.effectiveMutationId,mappingSha256:digest(mapping)};
  },
  async afterActualUpload(response){
   need(mapping&&!completed&&!stopped,'PREINTENT_MAPPING_FIRST');completed=true;
   try{const captured=await inspect('observe');need(captured.body.status==='OWN_CAPTURED','AFTER_UI_PARENT_OBSERVATION_REQUIRED');const proof=verifyActualUiUpload(before,captured.body.observation,intent,response,parent);publish('ack',{kind:'durable-actual-ui-upload-ack',mappingSha256:digest(mapping),intentSha256:digest(intent),proof,observation:captured.body.observation,receipt:captured.receipt});return {...proof,recorded:true};}
   catch(error){stopped=true;throw error;}
  },
  async unknown(){stopped=true;const captured=await inspect('observe');publish('unknown',{kind:'unknown-ui-upload-preserve-no-retry',mappingSha256:mapping?digest(mapping):null,observation:captured.body.observation,receipt:captured.receipt});return {status:'STOP_PRESERVE_NO_RETRY'};},
  state(){return {intentSha256:intent?digest(intent):null,mappingSha256:mapping?digest(mapping):null,completed,stopped};},
 };
}
