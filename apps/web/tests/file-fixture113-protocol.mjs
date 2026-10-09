// Fresh-owned acceptance protocol113/115/116. Pure functions only; no DB/network/storage on import.
// SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP at guard mismatch.
import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
export const FIXTURE_NAMESPACE='PERO_FILE_ACCEPTANCE_113_V2';
export const DISABLED_PASSWORD='PERO113_DISABLED_NOT_A_PASSWORD_HASH';
export const CLEANUP_ORDER=['Notification','DomainEvent','ChangeLog','UserPreference','Task','File','Payment','FinanceDocument','Product','Project','CashAccount','ExpenseArticle','Client','User'];
const SHA=/^[a-f0-9]{64}$/,REV=/^[a-f0-9]{40}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const need=(ok,code)=>{if(!ok)throw Error(code);};
export function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value!==null&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';return JSON.stringify(value);}
export const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function signed(value,secret){need(typeof secret==='string'&&secret.length>0,'PRIVATE_SIGNER_REQUIRED');return {...value,signature:createHmac('sha256',secret).update(FIXTURE_NAMESPACE+'\0'+canonical(value)).digest('hex')};}
export function verifySignedFixture(value,secret,kind,input){
 need(value?.namespace===FIXTURE_NAMESPACE&&value.version===2&&value.kind===kind&&value.runId===input.runId&&REV.test(value.revision??'')&&SHA.test(value.signature??''),'FRESH_SIGNED_FIXTURE_BINDING_REQUIRED');
 const {signature,...body}=value,expected=signed(body,secret).signature;need(timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(expected,'hex')),'FIXTURE_SIGNATURE_MISMATCH');return body;
}
export function newFixturePlan(runId,revision){
 need(UUID.test(runId??'')&&REV.test(revision??''),'EXACT_RUN_REVISION_REQUIRED');
 const ids=Object.fromEntries(['client','project','product','task','cashAccount','article','income','expense'].map(key=>[key,randomUUID()]));
 const actors=Object.fromEntries(['admin','manager','engineer'].map(key=>[key,{id:randomUUID(),roles:[key.toUpperCase()],name:'QA113 '+key+' '+runId,email:randomUUID()+'@invalid.test',passwordHash:DISABLED_PASSWORD,sessionVersion:0}]));
 const files=[
  {key:'sketch',actor:'admin',section:'PRODUCTION',target:'product',mimeType:'image/png',extension:'png',cover:true},
  {key:'foreign-photo',actor:'admin',section:'PRODUCTION',target:'product',mimeType:'image/png',extension:'png'},
  {key:'own-measure',actor:'engineer',section:'MEASUREMENT',target:'product',mimeType:'image/png',extension:'png'},
  {key:'production-pdf',actor:'manager',section:'PRODUCTION',target:'product',mimeType:'application/pdf',extension:'pdf'},
  {key:'installation-cad',actor:'manager',section:'INSTALLATION',target:'product',mimeType:'application/octet-stream',extension:'b3d'},
  {key:'task-image',actor:'engineer',section:'GENERAL',target:'task',mimeType:'image/png',extension:'png'},
  {key:'project-pdf',actor:'manager',section:'GENERAL',target:'project',mimeType:'application/pdf',extension:'pdf'},
 ].map(row=>({...row,clientMutationId:randomUUID(),fileName:'qa113-'+runId+'-'+row.key+'.'+row.extension}));
 const financeDocs=['pdf','image','cad'].map(key=>({key:'finance-'+key,actor:'admin',clientMutationId:randomUUID(),mimeType:key==='pdf'?'application/pdf':key==='image'?'image/png':'application/octet-stream',fileName:'qa113-'+runId+'-finance-'+key+'.'+(key==='pdf'?'pdf':key==='image'?'png':'b3d')}));
 need(files.every(file=>file.fileName.length<=80&&!/[\\/\0]/.test(file.fileName)),'EXACT_NAMESPACE_FILENAME_LIMIT');
 return {namespace:FIXTURE_NAMESPACE,version:2,kind:'plan',runId,revision,ids,actors,files,financeDocs,financeDate:new Date().toISOString().slice(0,10),finance:{currency:'BYN',income:'2.00',expense:'1.00',rate:'1.000000',initialLinks:{income:'finance-image',expense:'finance-pdf'},allowedLinkPhases:[{income:'finance-image',expense:'finance-pdf'},{income:'finance-cad',expense:'finance-image'},{income:'finance-pdf',expense:'finance-cad'}]},originalUsersReused:false,originalPreferencesReused:false};
}
export function validatePlan(plan){
 need(plan?.namespace===FIXTURE_NAMESPACE&&plan.version===2&&plan.kind==='plan'&&UUID.test(plan.runId??'')&&REV.test(plan.revision??''),'FRESH_PLAN_REQUIRED');
 need(Object.keys(plan.ids??{}).sort().join('|')==='article|cashAccount|client|expense|income|product|project|task'&&Object.values(plan.ids).every(id=>UUID.test(id)),'EXACT_PREDICTED_IDS_REQUIRED');
 need(Object.keys(plan.actors??{}).sort().join('|')==='admin|engineer|manager'&&Object.entries(plan.actors).every(([key,row])=>UUID.test(row.id)&&row.passwordHash===DISABLED_PASSWORD&&row.sessionVersion===0&&canonical(row.roles)===canonical([key.toUpperCase()])&&row.name==='QA113 '+key+' '+plan.runId&&/^[a-f0-9-]{36}@invalid\.test$/.test(row.email)),'FRESH_DISABLED_ACTORS_REQUIRED');
 const all=[...Object.values(plan.ids),...Object.values(plan.actors).map(row=>row.id)];need(new Set(all).size===all.length,'OWN_IDENTIFIERS_MUST_BE_UNIQUE');
 need(/^\d{4}-\d{2}-\d{2}$/.test(plan.financeDate??'')&&new Date(plan.financeDate).toISOString().slice(0,10)===plan.financeDate,'EXACT_OWN_FINANCE_DATE_REQUIRED');
 need(plan.originalUsersReused===false&&plan.originalPreferencesReused===false&&plan.files.length===7&&plan.financeDocs.length===3,'NO_EXISTING_PROFILE_SCOPE');
 for(const row of [...plan.files,...plan.financeDocs])need(UUID.test(row.clientMutationId)&&row.fileName.startsWith('qa113-'+plan.runId+'-')&&row.fileName.length<=80&&!/[\\/\0]/.test(row.fileName),'MEDIA_NAMESPACE_REQUIRED');
 need(canonical(plan.finance)===canonical({currency:'BYN',income:'2.00',expense:'1.00',rate:'1.000000',initialLinks:{income:'finance-image',expense:'finance-pdf'},allowedLinkPhases:[{income:'finance-image',expense:'finance-pdf'},{income:'finance-cad',expense:'finance-image'},{income:'finance-pdf',expense:'finance-cad'}]}),'EXACT_OWN_FINANCIAL_SCOPE_REQUIRED');
 return plan;
}
export function ownFileKey(plan,file,key){
 validatePlan(plan);if(file.projectId!==plan.ids.project||!plan.files.some(row=>row.fileName===file.fileName&&row.mimeType===file.mimeType&&plan.actors[row.actor].id===file.uploadedById))return false;
 if(!UUID.test(file.storedName?.slice(0,36)??'')||file.storedName.slice(36)!=='-'+file.fileName)return false;
 return key===plan.ids.project+'/'+file.storedName||(file.hasThumb&&key===plan.ids.project+'/thumbs/'+file.storedName+'.jpg');
}
export function ownFinanceKey(plan,doc,key){
 validatePlan(plan);return UUID.test(doc.id??'')&&doc.uploadedById===plan.actors.admin.id&&plan.financeDocs.some(row=>row.clientMutationId===doc.clientMutationId&&row.fileName===doc.fileName&&row.mimeType===doc.mimeType)&&SHA.test(doc.contentHash??'')&&doc.storageMode==='s3'&&key===doc.storageKey&&key==='finance-documents/'+doc.id+'/'+doc.contentHash;
}
export function validateStorageVersions(manifest,keys){
 need(Array.isArray(manifest)&&manifest.length<=100&&Array.isArray(keys)&&keys.length<=40&&new Set(keys).size===keys.length,'BOUNDED_EXACT_STORAGE_MANIFEST');
 const seen=new Set();for(const row of manifest){need(Object.keys(row).sort().join('|')==='deleteMarker|etag|key|latest|size|versionId'&&keys.includes(row.key)&&typeof row.versionId==='string'&&row.versionId.length>0&&row.versionId.length<=1024&&typeof row.deleteMarker==='boolean'&&typeof row.latest==='boolean'&&(row.etag===null||typeof row.etag==='string')&&(row.size===null||Number.isSafeInteger(row.size)&&row.size>=0),'EXACT_S3_VERSION_REQUIRED');const identity=row.key+'\0'+row.versionId;need(!seen.has(identity),'DUPLICATE_S3_VERSION');seen.add(identity);}
 return manifest;
}
export function certificateForHandoff(handoff,receipt,expected){
 need(handoff?.kind==='handoff'&&handoff.namespace===FIXTURE_NAMESPACE&&handoff.version===2&&handoff.runId===expected.runId&&handoff.revision===expected.revision&&receipt.identity?.revision===expected.revision&&receipt.identity.hostname==='crm-staging','VERIFIED_HANDOFF_REVISION_REQUIRED');
 for(const key of ['preSha256','checkpointHash','currentOwnedStateHash','storageManifestHash','financialStateHash','actionManifestHash','rawManifestSha256','compiledDeleteFileHash'])need(SHA.test(handoff[key]??'')&&handoff[key]===expected[key],'HANDOFF_PROVENANCE_'+key.toUpperCase());
 validateCompiledDeleteDescriptor(handoff.compiledDeleteFile,expected.revision);need(handoff.compiledDeleteFileHash===digest(handoff.compiledDeleteFile),'CERTIFIED_DELETE_DESCRIPTOR_HASH_REQUIRED');
 need(SHA.test(receipt.bundleSha256??'')&&SHA.test(expected.verifierSourceSha256??''),'REVIEWED_PRODUCER_BUNDLE_REQUIRED');
 return {kind:'current-owned-fixture-verification',namespace:FIXTURE_NAMESPACE,version:2,verified:true,verifierSourceSha256:expected.verifierSourceSha256,runId:handoff.runId,revision:handoff.revision,...Object.fromEntries(['preSha256','checkpointHash','currentOwnedStateHash','storageManifestHash','financialStateHash','actionManifestHash','rawManifestSha256','compiledDeleteFileHash'].map(key=>[key,handoff[key]])),bundleSha256:receipt.bundleSha256};
}
export function cleanupIntent(pre,observation,revision){
 need(pre.kind==='pre'&&observation.kind==='observation'&&observation.preSha256===digest(pre)&&observation.runId===pre.runId&&REV.test(revision??''),'PAIRED_CAPTURED_CLEANUP_REQUIRED');
 return {namespace:FIXTURE_NAMESPACE,version:2,kind:'cleanup-intent',runId:pre.runId,revision,preSha256:digest(pre),observationSha256:digest(observation),expectedOwnStateHash:observation.currentOwnedStateHash,expectedStorageManifestHash:observation.storageManifestHash,scopeTables:CLEANUP_ORDER,acknowledgement:'DELETE_ONLY_EXACT_FRESH_OWN_ROWS_AND_CAPTURED_S3_VERSIONS'};
}

export function compareFileDelete(before,after,fileId,actorId,cancelled=false){
 need(Array.isArray(before.rows.File)&&Array.isArray(after.rows.File),'FILE_SCOPE_REQUIRED');
 const file=before.rows.File.find(row=>row.id===fileId);need(file&&before.scope.User.includes(actorId),'EXACT_OWN_DELETE_TARGET');
 if(cancelled){need(canonical(before.rows)===canonical(after.rows)&&canonical(before.storage)===canonical(after.storage)&&before.currentOwnedStateHash===after.currentOwnedStateHash&&before.storageManifestHash===after.storageManifestHash,'CANCEL_DELETE_SIDE_EFFECT');return {cancelled:true,versionsAccounted:true,priorOwnAuditPreserved:true,ownPreferencesUntouched:true};}
 need(!after.rows.File.some(row=>row.id===fileId)&&after.rows.File.length===before.rows.File.length-1,'EXACT_ONE_FILE_DELETE');
 need(canonical(after.rows.File)===canonical(before.rows.File.filter(row=>row.id!==fileId)),'OTHER_FILE_CHANGED');
 for(const table of Object.keys(before.rows))if(!['File','ChangeLog'].includes(table))need(canonical(before.rows[table])===canonical(after.rows[table]),'DELETE_SIDE_EFFECT_'+table);
 const oldLogIds=new Set(before.rows.ChangeLog.map(row=>row.id));need(before.rows.ChangeLog.every(row=>after.rows.ChangeLog.some(current=>current.id===row.id&&canonical(current)===canonical(row))),'PREEXISTING_OWN_AUDIT_CHANGED');const added=after.rows.ChangeLog.filter(row=>!oldLogIds.has(row.id));
 need(added.length===1&&added[0].entity==='file'&&added[0].entityId===fileId&&added[0].action==='delete'&&added[0].actorId===actorId&&added[0].oldValue?.fileName===file.fileName,'COMPILED_EXACT_DELETE_AUDIT_REQUIRED');
 const targetKeys=[file.projectId+'/'+file.storedName,...(file.hasThumb?[file.projectId+'/thumbs/'+file.storedName+'.jpg']:[])];
 need(canonical(before.storage.filter(row=>!targetKeys.includes(row.key)))===canonical(after.storage.filter(row=>!targetKeys.includes(row.key))),'DELETE_OTHER_STORAGE_CHANGED');
 for(const row of after.storage.filter(row=>targetKeys.includes(row.key))){
  const old=before.storage.find(item=>item.key===row.key&&item.versionId===row.versionId);
  if(old){const a={...row},b={...old};delete a.latest;delete b.latest;need(canonical(a)===canonical(b),'DELETE_ORIGINAL_VERSION_CHANGED');}
  else need(row.deleteMarker&&row.latest&&row.size===null&&row.etag===null,'DELETE_UNKNOWN_NEW_VERSION');
 }
 need(targetKeys.every(key=>!after.storage.some(row=>row.key===key&&row.latest&&!row.deleteMarker)),'DELETED_CURRENT_OBJECT_REMAINS');
 return {deleted:true,auditId:added[0].id,versionsAccounted:true,priorOwnAuditPreserved:true,ownPreferencesUntouched:true};
}

export function fixtureStageGuard(input,env,container){
 need(input?.authorized===true&&UUID.test(input.runId??'')&&REV.test(input.revision??'')&&env.CRM_MODERNIZATION_TARGET==='staging'&&container.docker,'ROOT_STAGING_SCOPE_REQUIRED');
 let url,endpoint,proof;try{url=new URL(env.DATABASE_URL??'');endpoint=new URL(env.S3_ENDPOINT??'');proof=JSON.parse(env.CRM_MODERNIZATION_STAGE_PROOF??'');}catch{throw Error('STAGING_ENV_INVALID');}
 const options=new Set(['schema','connection_limit','pool_timeout','connect_timeout','socket_timeout','sslmode']);
 need(['postgres:','postgresql:'].includes(url.protocol)&&url.hostname==='db'&&(url.port||'5432')==='5432'&&url.pathname==='/crm'&&!url.hash&&[...url.searchParams.keys()].every(key=>options.has(key)&&url.searchParams.getAll(key).length===1)&&(!url.searchParams.has('schema')||url.searchParams.get('schema')==='public'),'STAGING_DB_GUARD');
 need(env.CRM_FILE_STORAGE==='s3'&&env.S3_BUCKET==='pero-crm-staging'&&endpoint.protocol==='http:'&&endpoint.hostname==='192.168.0.33'&&endpoint.port==='9000'&&!endpoint.username&&!endpoint.password&&!endpoint.search&&!endpoint.hash,'STAGING_STORAGE_GUARD');
 need(proof?.hostname==='crm-staging'&&proof.revision===input.revision&&proof.databaseVolume==='crm-staging_pgdata'&&SHA.test(proof.web??'')&&proof.web.startsWith(container.host)&&SHA.test(proof.database??'')&&SHA.test(proof.outerW07Sha256??''),'PHYSICAL_ROOT_PROOF_REQUIRED');
 const secret=env.AUTH_SECRET??env.NEXTAUTH_SECRET;need(typeof secret==='string'&&secret.length>0&&env.S3_ACCESS_KEY&&env.S3_SECRET_KEY,'PRIVATE_RUNTIME_CREDENTIALS_REQUIRED');return {secret,proof};
}

export function preferencePairs(rows,actorIds){
 need(Array.isArray(rows)&&rows.length<=60&&Array.isArray(actorIds),'BOUNDED_OWN_PREFERENCE_ROWS');
 const pairs=rows.map(row=>{need(actorIds.includes(row.userId)&&typeof row.key==='string'&&row.key.length>0&&row.key.length<=160&&!Object.hasOwn(row,'id'),'EXACT_COMPOSITE_OWN_PREFERENCE');return {userId:row.userId,key:row.key};});
 need(new Set(pairs.map(pair=>pair.userId+'\0'+pair.key)).size===pairs.length,'DUPLICATE_PREFERENCE_PAIR');return pairs;
}

/** Normalize the current owned subject ABI BEFORE HMAC; consumers receive this exact signed metadata. */
export function handoffSubjects(plan,observation,fileContentHashes){
 validatePlan(plan);const rows=observation.rows,actors=Object.fromEntries(Object.entries(plan.actors).map(([name,row])=>[name,{id:row.id,roles:[...row.roles],sessionVersion:row.sessionVersion}]));
 need(typeof plan.productNumber==='string'&&/^[A-Za-z0-9_.-]{1,128}$/.test(plan.productNumber)&&typeof plan.taskTitle==='string'&&plan.taskTitle.includes(plan.runId),'EXACT_HANDOFF_LABELS_REQUIRED');
 need(canonical(Object.keys(fileContentHashes).sort())===canonical(rows.File.map(row=>row.id).sort()),'EXACT_FILE_CONTENT_HASH_SET');
 const files=rows.File.map(file=>{
  need(SHA.test(fileContentHashes[file.id]??''),'VERIFIED_FILE_CONTENT_REQUIRED');
  const keys=[file.projectId+'/'+file.storedName,...(file.hasThumb?[file.projectId+'/thumbs/'+file.storedName+'.jpg']:[])];
  need(keys.every(key=>ownFileKey(plan,file,key)),'SIGNED_FILE_KEY_OWNERSHIP_REQUIRED');
  return {id:file.id,fileName:file.fileName,mimeType:file.mimeType,section:file.section,uploadedById:file.uploadedById,projectId:file.projectId,productId:file.productId??null,taskId:file.taskId??null,contentHash:fileContentHashes[file.id],versionSetHash:digest(observation.storage.filter(row=>keys.includes(row.key)))};
 });
 const income=rows.Payment.find(row=>row.id===plan.ids.income),expense=rows.Payment.find(row=>row.id===plan.ids.expense),account=rows.CashAccount.find(row=>row.id===plan.ids.cashAccount);
 need(rows.Payment.length===2&&income&&expense&&account&&income.currency==='BYN'&&expense.currency==='BYN'&&Number(income.amount)===2&&Number(expense.amount)===1&&Number(income.rate)===1&&Number(expense.rate)===1,'SIGNED_CURRENT_OWN_FINANCIAL_FACT_REQUIRED');
 need([income,expense].every(row=>typeof row.paidAt==='string'&&row.paidAt.slice(0,10)===plan.financeDate&&typeof row.comment==='string'&&row.comment.includes(plan.runId))&&typeof account.name==='string'&&account.name.includes(plan.runId),'SIGNED_FINANCE_DATE_LABEL_REQUIRED');
 const finance={accountId:account.id,articleId:plan.ids.article,incomeId:income.id,expenseId:expense.id,accountName:account.name,incomeComment:income.comment,expenseComment:expense.comment,date:plan.financeDate,currency:'BYN',incomeAmount:'2',expenseAmount:'1',rate:'1'};
 const financeDocs=rows.FinanceDocument.map(doc=>{
  need(doc.state==='READY'&&ownFinanceKey(plan,doc,doc.storageKey),'SIGNED_READY_OWN_DOCUMENT_REQUIRED');
  const linked=rows.Payment.filter(row=>row.reportDocumentId===doc.id);need(linked.length<=1,'DOCUMENT_UNIQUE_PAYMENT_REQUIRED');
  return {id:doc.id,fileName:doc.fileName,mimeType:doc.mimeType,status:doc.state,paymentId:linked[0]?.id??null,uploadedById:doc.uploadedById,contentHash:doc.contentHash,versionSetHash:digest(observation.storage.filter(row=>row.key===doc.storageKey))};
 });
 need([income,expense].every(row=>row.reportDocumentId===null||financeDocs.some(doc=>doc.id===row.reportDocumentId)),'SIGNED_FOREIGN_FINANCE_LINK');
 const currentSketchFileId=rows.Product[0]?.sketchFileId??null,currentProjectCoverFileId=rows.Project[0]?.coverFileId??null;
 need(files.some(file=>file.id===currentSketchFileId&&file.mimeType.startsWith('image/'))&&(currentProjectCoverFileId===null||files.some(file=>file.id===currentProjectCoverFileId)),'SIGNED_CURRENT_COVERS_REQUIRED');
 return {actors,ids:{...plan.ids},paths:{project:'/projects/'+plan.ids.project,product:'/products/'+plan.productNumber,financeProject:'/finance/projects/'+plan.ids.project},productNumber:plan.productNumber,taskTitle:plan.taskTitle,currentSketchFileId,currentProjectCoverFileId,files,finance,financeDocs};
}

export function compareCurrentHandoff(supplied,current,secret,input){
 verifySignedFixture(supplied,secret,'handoff',input);verifySignedFixture(current,secret,'handoff',input);
 need(supplied.revision===input.revision&&current.revision===input.revision&&supplied.preSha256===input.preSha256&&supplied.checkpointHash===input.preSha256,'CURRENT_HANDOFF_SCOPE_REQUIRED');
 validateCompiledDeleteDescriptor(current.compiledDeleteFile,input.revision);need(current.compiledDeleteFileHash===digest(current.compiledDeleteFile),'CURRENT_DELETE_DESCRIPTOR_HASH_REQUIRED');
 for(const key of ['actionManifestHash','rawManifestSha256','compiledDeleteFileHash'])need(SHA.test(input[key]??'')&&current[key]===input[key],'CURRENT_SERVER_MANIFEST_REQUIRED');
 need(canonical(supplied)===canonical(current),'CURRENT_HANDOFF_OR_VERSIONS_CHANGED');return true;
}

const DELETE_ROUTES=['/products/[id]','/projects/[id]'];
export function validateCompiledDeleteDescriptor(descriptor,revision){
 need(descriptor&&typeof descriptor==='object'&&!Array.isArray(descriptor)&&Object.keys(descriptor).sort().join('|')==='actionManifestHash|exportedName|id|rawManifestSha256|revision|routes|source','EXACT_PUBLIC_DELETE_DESCRIPTOR_REQUIRED');
 need(/^[a-f0-9]{42}$/.test(descriptor.id??'')&&descriptor.exportedName==='deleteFile'&&descriptor.source==='src/server/files/actions.ts'&&canonical(descriptor.routes)===canonical(DELETE_ROUTES)&&descriptor.revision===revision&&REV.test(revision??'')&&SHA.test(descriptor.rawManifestSha256??'')&&SHA.test(descriptor.actionManifestHash??''),'COMPILED_DELETE_DESCRIPTOR_BINDING_REQUIRED');return descriptor;
}
/** Only this small public descriptor leaves the process; the manifest/encryptionKey/worker module IDs stay private. */
export function publicDeleteMetadata(bytes,revision){
 need(bytes instanceof Uint8Array&&bytes.byteLength>0&&bytes.byteLength<=4*1024*1024&&REV.test(revision??''),'BOUNDED_PRIVATE_SERVER_MANIFEST_REQUIRED');
 let manifest;try{manifest=JSON.parse(Buffer.from(bytes).toString('utf8'));}catch{throw Error('PRIVATE_SERVER_MANIFEST_INVALID_JSON');}
 need(manifest?.node&&typeof manifest.node==='object'&&!Array.isArray(manifest.node),'NODE_SERVER_MANIFEST_REQUIRED');
 const found=Object.entries(manifest.node).filter(([,entry])=>entry?.exportedName==='deleteFile');need(found.length===1,'DELETE_EXPORT_MISSING_OR_AMBIGUOUS');
 const[id,entry]=found[0];need(/^[a-f0-9]{42}$/.test(id)&&['server/files/actions.ts','src/server/files/actions.ts'].includes(entry.filename),'EXACT_DELETE_EXPORT_SOURCE_REQUIRED');
 const workers=entry.workers;need(workers&&typeof workers==='object'&&!Array.isArray(workers),'DELETE_WORKERS_REQUIRED');
 for(const route of DELETE_ROUTES){const key='app/(app)'+route+'/page',worker=workers[key];need(Object.hasOwn(workers,key)&&worker&&typeof worker==='object'&&!Array.isArray(worker)&&['string','number'].includes(typeof worker.moduleId)&&String(worker.moduleId).length>0&&typeof worker.async==='boolean'&&entry.layer?.[key]==='action-browser','ACTUAL_DELETE_ROUTE_WORKER_REQUIRED');}
 const rawManifestSha256=sha(bytes),actionManifestHash=sha(Buffer.from(JSON.stringify(manifest))),compiledDeleteFile={id,exportedName:'deleteFile',source:'src/server/files/actions.ts',routes:[...DELETE_ROUTES],revision,rawManifestSha256,actionManifestHash};
 validateCompiledDeleteDescriptor(compiledDeleteFile,revision);return {rawManifestSha256,actionManifestHash,compiledDeleteFile,compiledDeleteFileHash:digest(compiledDeleteFile)};
}
