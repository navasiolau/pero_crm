// Source-only проверки: синтетические снимки, cold import со stub, build без DB/HTTP/S3.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {newFixturePlan,digest,canonical,FIXTURE_NAMESPACE as NS} from './file-fixture113-protocol.mjs';
import {FROZEN_SOURCES,FROZEN_EXTRA,ADAPTER_AUTORUN,ADAPTER_EXPORTS,NEGATIVE_CASES,derivedFrozenLibrary,bytesHash,sqlTimestampMicros,contextMedia,validateContextBefore,contextScope,coverUploadFingerprint,verifyContextReplacement,verifyNoop,cleanupDescriptor,verifyParentRejoined,sealParentObservation,sealContextAfter,verifyCompactContextAck,transportBudget,contextPacket,contextPreflight} from './file-fixture113-context-smoke.mjs';
import {contextSmokeBundle,frozenLibraryPlugin,contextSmokeCoordinator} from './file-fixture113-context-smoke-runner.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),require=createRequire(import.meta.url),{build}=createRequire(require.resolve('tsx/package.json'))('esbuild');
// Historical accepted bytes are a synthetic fixture; the current caller legitimately evolved.
const HISTORICAL_PINS={'file-fixture113-entry.mjs':'def45eb010e03daaa6526ac8862c1c752e91c135b022cabcb2fd8bc54f1501fb','file-fixture113-protocol.mjs':'7b1001d102408facba349ce3db4279421dc29d87ade4fb1e6c795751d706fe92','crm-acceptance-token-clock.mjs':'13407f3f719ef7962e2ffb21abb52089e7132b4ec402db87340d9c2fe3b7fc51','file-fixture113-runner.mjs':'b6dd281a1985b841843e4483241fb07dbd33f88cfdf5cdf0996d827823d875fe','file-fixture113-lifecycle-native.mjs':'60105e21a10a856343562aa1e4e12bf4ef33ce6e1872c6573064d9b2252862f0'};
function historicalRead(name){
 assert.ok(Object.hasOwn(HISTORICAL_PINS,name));let text=readFileSync(path.join(here,name),'utf8').replace(/\r?\n/g,'\n');
 if(name==='file-fixture113-runner.mjs'){const line="  if(mode==='delete-ack')delete input.priorObservation;\n";assert.equal(text.split(line).length,2,'exact documented caller evolution only');text=text.replace(line,'');}
 if(['file-fixture113-entry.mjs','crm-acceptance-token-clock.mjs'].includes(name))text=text.replace(/\n/g,'\r\n');
 const bytes=Buffer.from(text);assert.equal(bytesHash(bytes),HISTORICAL_PINS[name],'strict accepted historical byte fixture');return bytes;
}
const clone=value=>JSON.parse(JSON.stringify(value));
function sample(){
 const plan=newFixturePlan(randomUUID(),'c'.repeat(40));Object.assign(plan,{numberInt:1,projectNumber:'1',productNumber:'1.1',taskTitle:'QA113 files '+plan.runId});
 const pre={namespace:NS,version:2,kind:'pre',runId:plan.runId,revision:plan.revision,plan,sources:{...FROZEN_SOURCES},signature:'a'.repeat(64)};
 const fileMedia=plan.files.find(row=>row.key==='sketch'),file={id:'old-admin-sketch',projectId:plan.ids.project,productId:plan.ids.product,taskId:null,section:'PRODUCTION',fileName:fileMedia.fileName,storedName:randomUUID()+'-'+fileMedia.fileName,mimeType:'image/png',size:77,hasThumb:true,uploadedById:plan.actors.admin.id,legacyId:null,legacyTable:null,createdAt:'2026-10-09T11:30:00.123456'};
 const product={deletedAt:null,deletedById:null,id:plan.ids.product,projectId:plan.ids.project,number:plan.productNumber,suffixInt:1,title:'QA113 '+plan.runId,quantity:1,kind:null,status:'DESIGN',statusChangedAt:'2026-10-09T11:30:00.123456',expectedPrice:0,initialPrice:null,initialPriceCaptureEligible:false,description:null,assemblerId:null,engineerId:plan.actors.engineer.id,mounterId:null,noModel:false,surveyorId:null,sketchFileId:file.id,createdById:null,legacyId:null,legacyTable:null,createdAt:'2026-10-09T11:30:00.123456',updatedAt:'2026-10-09T12:30:00.123456'};
 const actor=plan.actors.engineer,log={id:'a-parent-log',actorType:'user',actorId:actor.id,actorName:actor.name,entity:'file',entityId:file.id,action:'create',field:null,oldValue:null,newValue:{fileName:file.fileName},source:'web',createdAt:product.createdAt};
 const rows={User:Object.values(plan.actors).map(row=>({...row,active:true})),Client:[{id:plan.ids.client,name:'QA113'}],Project:[{id:plan.ids.project,stage:'CONTRACT',currency:'BYN',clientId:plan.ids.client}],Product:[product],Task:[{id:plan.ids.task,title:plan.taskTitle}],CashAccount:[{id:plan.ids.cashAccount,currency:'BYN'}],ExpenseArticle:[{id:plan.ids.article}],Payment:[{id:plan.ids.income,amount:2},{id:plan.ids.expense,amount:1}],File:[file],FinanceDocument:[],UserPreference:[{userId:actor.id,key:'unit-only',value:{tab:'materials'}}],ChangeLog:[log],Notification:[{id:'a-parent-notification',userId:plan.actors.admin.id,body:file.fileName,type:'file.added'}],DomainEvent:[]};
 const scope=Object.fromEntries(Object.entries(rows).map(([key,list])=>[key,list.map(row=>row.id)]));scope.UserPreference=[{userId:actor.id,key:'unit-only'}];
 const keys=[file.projectId+'/'+file.storedName,file.projectId+'/thumbs/'+file.storedName+'.jpg'],storage=keys.map((key,index)=>({key,versionId:'old-version-'+index,deleteMarker:false,latest:true,etag:'"old-'+index+'"',size:index?88:77}));
 const before={namespace:NS,version:2,kind:'observation',runId:pre.runId,revision:pre.revision,preSha256:digest(pre),rows,scope,keys,storage,currentOwnedStateHash:digest(rows),storageManifestHash:digest(storage),originalVerification:{originalRelationsMatch:true,preferencesUntouched:true,tokenClockValid:true},signature:'b'.repeat(64)};
 const target=contextMedia(pre,before),media={target,size:100,contentHash:'1'.repeat(64),thumbSize:80,thumbHash:'2'.repeat(64)};
 const after=clone(before);after.kind='context-observation';after.capturedAt='2026-10-09T12:30:01.000000Z';after.rows.Product[0].sketchFileId='zz-child-engineer';after.rows.Product[0].updatedAt='2026-10-09T12:30:00.123457';
 const child={...clone(file),id:'zz-child-engineer',fileName:target.fileName,storedName:randomUUID()+'-'+target.fileName,size:media.size,uploadedById:actor.id,createdAt:after.rows.Product[0].updatedAt};after.rows.File.push(child);
 const audit=data=>({...clone(log),...data,actorId:actor.id,actorName:actor.name,createdAt:after.rows.Product[0].updatedAt});
 after.rows.ChangeLog.push(
  audit({id:'file-create-child',entity:'file',entityId:child.id,newValue:{projectId:target.projectId,productId:target.productId,fileName:target.fileName,section:'PRODUCTION'}}),
  audit({id:'product-change-child',entity:'product',entityId:target.productId,action:'cover.change',field:'sketchFileId',oldValue:{sketchFileId:file.id},newValue:{sketchFileId:child.id,uploaded:true}}),
  audit({id:'product-sketch:'+target.clientMutationId,entity:'product',entityId:target.productId,action:'cover.upload',field:'sketchFileId',newValue:{fingerprint:coverUploadFingerprint({...target,size:media.size,contentHash:media.contentHash}),result:{ok:true,id:child.id,sketchFileId:child.id,clientMutationId:target.clientMutationId}}}),
 );
 const recipients=[plan.actors.admin.id,plan.actors.manager.id];
 after.rows.Notification.push(...recipients.map((userId,index)=>({id:'n-child-'+index,userId,type:'file.added',title:'Файл к проекту '+plan.projectNumber,body:target.fileName,link:'/products/'+plan.productNumber,readAt:null,createdAt:after.rows.Product[0].updatedAt})));
 const childKeys=[child.projectId+'/'+child.storedName,child.projectId+'/thumbs/'+child.storedName+'.jpg'];after.keys.push(...childKeys);
 after.storage.push(...childKeys.map((key,index)=>({key,versionId:'known-new-version-'+index,deleteMarker:false,latest:true,etag:'"new-'+index+'"',size:index?media.thumbSize:media.size})));
 after.contentHashes={[childKeys[0]]:media.contentHash,[childKeys[1]]:media.thumbHash};after.scope=contextScope(before,after.rows);
 const response={method:'POST',path:'/api/files/upload',status:200,redirected:false,body:{ok:true,id:child.id,sketchFileId:child.id,clientMutationId:target.clientMutationId,sketch:{id:child.id,fileName:child.fileName,mimeType:child.mimeType,size:child.size,hasThumb:true,section:'PRODUCTION',uploadedById:actor.id}}};
 rehash(after);return {pre,before,after,media,response,recipients};
}
function rehash(obs){obs.currentOwnedStateHash=digest(obs.rows);obs.storageManifestHash=digest(obs.storage);}
function verify(s){return verifyContextReplacement(s.pre,s.before,s.after,s.media,s.response,s.recipients);}

test('historical producer bytes stay pinned and evolved caller is not silently accepted',()=>{
 assert.deepEqual({...FROZEN_SOURCES,...FROZEN_EXTRA},HISTORICAL_PINS);
 for(const [name,hash]of Object.entries(HISTORICAL_PINS))assert.equal(bytesHash(historicalRead(name)),hash);
 assert.notEqual(bytesHash(readFileSync(path.join(here,'file-fixture113-runner.mjs'))),HISTORICAL_PINS['file-fixture113-runner.mjs']);
});
test('adapter removes exactly the final autorun and adds a private export allowlist',()=>{
 const bytes=historicalRead('file-fixture113-entry.mjs'),text=bytes.toString('utf8'),library=derivedFrozenLibrary(bytes);
 assert.equal(text.split(ADAPTER_AUTORUN).length,2);assert.ok(!library.includes(ADAPTER_AUTORUN));
 assert.equal(library,text.slice(0,text.indexOf(ADAPTER_AUTORUN))+'\nexport {'+ADAPTER_EXPORTS.join(',')+'};\n');
 assert.equal(bytesHash(historicalRead('file-fixture113-entry.mjs')),FROZEN_SOURCES['file-fixture113-entry.mjs']);
});
test('adapter refuses changed source even when its autorun still matches',()=>{
 const bytes=historicalRead('file-fixture113-entry.mjs');assert.throws(()=>derivedFrozenLibrary(Buffer.concat([bytes,Buffer.from(' ')])),/FROZEN_ENTRY_BYTES_CHANGED/);
});
test('cold library import under stdin/staging input has no autorun/client/fetch',async()=>{
 const stubs={name:'cold-only-stubs',setup(builder){
  builder.onResolve({filter:/^(@prisma\/client|@aws-sdk\/client-s3|@auth\/core\/jwt|sharp)$/},args=>({path:args.path,namespace:'cold-only'}));
  builder.onLoad({filter:/.*/,namespace:'cold-only'},args=>{
   const stop="throw Error('COLD_IMPORT_RUNTIME_CONSTRUCTION');";
   const contents=args.path==='@prisma/client'?'export class PrismaClient{constructor(){'+stop+'}}':
    args.path==='@auth/core/jwt'?'export function encode(){'+stop+'}':
    args.path==='sharp'?'export default function sharp(){'+stop+'}':
    ['S3Client','ListObjectVersionsCommand','GetObjectCommand','DeleteObjectCommand'].map(name=>'export class '+name+'{constructor(){'+stop+'}}').join('\n');
   return {contents,loader:'js'};
  });
 }};
 const result=await build({stdin:{contents:"import * as library from 'task113:frozen-library'; if(typeof library.original!=='function'||typeof library.cookies!=='function')throw Error('MISSING_LIBRARY');console.log('COLD_IMPORT_INERT');",resolveDir:here,sourcefile:'context-cold-unit.mjs'},bundle:true,write:false,platform:'node',format:'esm',target:'node22',treeShaking:false,plugins:[frozenLibraryPlugin(historicalRead),stubs],define:{__FIXTURE_SOURCE_HASHES__:JSON.stringify(FROZEN_SOURCES)},banner:{js:"process.argv[1]=undefined;globalThis.fetch=()=>{throw Error('COLD_IMPORT_FETCH');};"},logLevel:'silent'});
 const cold=spawnSync(process.execPath,['--input-type=module'],{input:result.outputFiles[0].contents,encoding:'utf8',timeout:20000,windowsHide:true,env:{...process.env,CRM_MODERNIZATION_TARGET:'staging',CRM_STAGING_BROWSER_INPUT:Buffer.from('{"authorized":true}').toString('base64')}});
 assert.equal(cold.status,0,cold.stderr);assert.equal(cold.stdout.trim(),'COLD_IMPORT_INERT');assert.equal(cold.stderr,'');
});
test('local bundle build stays inside existing caps and drops producer autorun/main',async()=>{
 const pack=await contextSmokeBundle(historicalRead);assert.ok(pack.bytes.length>0&&pack.bytes.length<=256*1024);
 assert.equal(pack.sha256,bytesHash(pack.bytes));assert.equal(pack.adapter.sourceFileModified,false);assert.deepEqual(pack.adapter.privateExports,ADAPTER_EXPORTS);
 assert.equal(canonical(pack.frozenSources),canonical(FROZEN_SOURCES));assert.equal(Object.keys(pack.sources).length,4);
 assert.ok(pack.bytes.toString('utf8').includes('CONTEXT_BEFORE'));assert.ok(!pack.bytes.toString('utf8').includes('PRE_CAPTURED'));
});
test('generated DMMF supports current File section and own Product typed CAS',()=>{
 const file=Prisma.dmmf.datamodel.models.find(row=>row.name==='File'),product=Prisma.dmmf.datamodel.models.find(row=>row.name==='Product');
 assert.ok(file.fields.some(row=>row.name==='section'));assert.ok(!file.fields.some(row=>['category','caption','stage'].includes(row.name)));
 assert.ok(product.fields.some(row=>row.name==='updatedAt'&&row.type==='DateTime'&&row.isUpdatedAt));assert.ok(product.fields.some(row=>row.name==='sketchFileId'));
});
test('valid single child preserves old ADMIN attachment and exact parent rows',()=>{
 const s=sample(),proof=verify(s);assert.equal(proof.fileId,s.response.body.id);assert.equal(proof.auditIds.length,3);assert.equal(proof.versions.length,2);assert.equal(proof.oldAdminFileUnchanged,true);assert.equal(proof.priorOwnAuditPreserved,true);
});
test('replacement requires assigned pure Engineer and initial foreign ADMIN sketch',()=>{
 const s=sample();s.before.rows.Product[0].engineerId=s.pre.plan.actors.manager.id;rehash(s.before);assert.throws(()=>validateContextBefore(s.pre,s.before),/EXACT_OWN_ASSIGNED_DESIGN_PRODUCT_REQUIRED/);
 const other=sample();other.before.rows.File[0].uploadedById=other.pre.plan.actors.engineer.id;rehash(other.before);assert.throws(()=>validateContextBefore(other.pre,other.before),/CURRENT_FOREIGN_ADMIN_SKETCH_REQUIRED/);
});
test('raw SQL timestamps keep all six fractional digits and offset semantics',()=>{
 assert.equal(sqlTimestampMicros('2026-10-09T12:30:00.123457')-sqlTimestampMicros('2026-10-09T12:30:00.123456'),1n);
 assert.equal(sqlTimestampMicros('2026-10-09T15:30:00.123456+03:00'),sqlTimestampMicros('2026-10-09T12:30:00.123456Z'));
 assert.throws(()=>sqlTimestampMicros(new Date()),/RAW_SQL_TIMESTAMP_REQUIRED/);
});
for(const field of ['expectedPrice','initialPrice','status','title','quantity','engineerId','createdAt','statusChangedAt','deletedAt']){
 test('replacement rejects changes to other own Product field '+field,()=>{const s=sample();s.after.rows.Product[0][field]='changed';rehash(s.after);assert.throws(()=>verify(s),/OTHER_OWN_PRODUCT_FIELD_CHANGED/);});
}
for(const table of ['User','Client','Project','Task','CashAccount','ExpenseArticle','Payment','FinanceDocument','UserPreference','DomainEvent']){
 test('replacement rejects all unrelated own table changes '+table,()=>{const s=sample();if(s.after.rows[table].length)s.after.rows[table][0].unexpected='changed';else s.after.rows[table].push({id:'unknown-new-row'});rehash(s.after);assert.throws(()=>verify(s),new RegExp('PARENT_OWN_ROW_CHANGED_'+table));});
}
test('replacement rejects changed old File section and parent audits',()=>{
 const s=sample();s.after.rows.File[0].section='MEASUREMENT';rehash(s.after);assert.throws(()=>verify(s),/PREEXISTING_OWN_ROW_CHANGED_File/);
 const t=sample();t.after.rows.ChangeLog[0].newValue.changed=true;rehash(t.after);assert.throws(()=>verify(t),/PREEXISTING_OWN_ROW_CHANGED_ChangeLog/);
});
test('replacement rejects extra child/audit/notification rows',()=>{
 for(const table of ['File','ChangeLog','Notification']){const s=sample();s.after.rows[table].push({id:'extra-unowned'});rehash(s.after);assert.throws(()=>verify(s),new RegExp('EXACT_DELTA_COUNT_'+table));}
});
test('replacement rejects wrong genuine response pointer and replay ACK',()=>{
 const s=sample();s.response.body.sketchFileId='wrong';assert.throws(()=>verify(s),/ACTUAL_CHILD_ACK_ID_REQUIRED/);
 const t=sample();t.response.body.repeated=true;assert.throws(()=>verify(t),/GENUINE_NEW_COMPILED_COVER_ACK_REQUIRED/);
});
test('replacement requires all three exact compiled audit bodies',()=>{
 const s=sample();s.after.rows.ChangeLog.find(row=>row.action==='cover.upload').newValue.fingerprint='f'.repeat(64);rehash(s.after);assert.throws(()=>verify(s),/EXACT_COMPILED_COVER_RECEIPT_REQUIRED/);
 const t=sample();t.after.rows.ChangeLog.find(row=>row.action==='cover.change').oldValue.sketchFileId='wrong';rehash(t.after);assert.throws(()=>verify(t),/COVER_PRIOR_POINTER_AUDIT_REQUIRED/);
});
test('replacement rejects wrong or read child notifications',()=>{
 const s=sample();s.after.rows.Notification[1].userId=s.pre.plan.actors.engineer.id;rehash(s.after);assert.throws(()=>verify(s),/CHILD_NOTIFICATION_RECIPIENTS_CHANGED/);
 const t=sample();t.after.rows.Notification[1].readAt='2026-10-09T12:30:01';rehash(t.after);assert.throws(()=>verify(t),/EXACT_CHILD_NOTIFICATIONS_REQUIRED/);
});
test('replacement rejects changed ADMIN storage and unknown child versions',()=>{
 const s=sample();s.after.storage[0].etag='"changed"';rehash(s.after);assert.throws(()=>verify(s),/OLD_ADMIN_AND_PARENT_STORAGE_CHANGED/);
 const t=sample();t.after.storage.push({...t.after.storage.at(-1),versionId:'unexpected-new-version'});rehash(t.after);assert.throws(()=>verify(t),/EXACT_TWO_KNOWN_CHILD_VERSIONS_REQUIRED/);
});
test('replacement rejects delete markers, null versions and wrong object bytes',()=>{
 for(const field of ['deleteMarker','versionId']){const s=sample();s.after.storage.at(-1)[field]=field==='deleteMarker'?true:'null';rehash(s.after);assert.throws(()=>verify(s),/EXACT_TWO_KNOWN_CHILD_VERSIONS_REQUIRED/);}
 const t=sample();t.after.contentHashes[t.after.keys.at(-1)]='e'.repeat(64);assert.throws(()=>verify(t),/ACTUAL_CHILD_BYTES_READBACK_REQUIRED/);
});
test('replacement requires genuine original table/schema/clock preservation proof',()=>{
 const s=sample();s.after.originalVerification.originalRelationsMatch=false;assert.throws(()=>verify(s),/ALL_ORIGINAL_TABLES_SCHEMA_PREFS_CLOCKS_REQUIRED/);
});
for(const key of NEGATIVE_CASES){
 test('existing own measure no-op contract '+key,()=>{
  const s=sample(),nonce=s.pre.plan.files.find(row=>row.key==='own-measure').clientMutationId,id='own-measure-existing';
  const body=['category','caption','stage'].includes(key)?{ok:false,kind:'validation',code:'UPLOAD_FORM_OUTDATED'}:
   key==='exact-replay'?{ok:true,repeated:true,id,clientMutationId:nonce}:{ok:false,kind:'conflict',code:'UPLOAD_REPLAY_CONFLICT',commitState:'notCommitted'};
  const response={method:'POST',path:'/api/files/upload',redirected:false,status:key==='exact-replay'?200:key==='section-conflict'?409:422,body};
  const proof=verifyNoop(s.pre,s.before,clone(s.before),key,response,id,nonce);assert.equal(proof.rowsUnchanged,true);assert.equal(proof.allVersionsUnchanged,true);
 });
}
test('no-op proof rejects DB or any old/new S3 version change',()=>{
 const s=sample(),response={method:'POST',path:'/api/files/upload',redirected:false,status:422,body:{ok:false,kind:'validation',code:'UPLOAD_FORM_OUTDATED'}},after=clone(s.before);
 after.rows.UserPreference[0].value='changed';rehash(after);assert.throws(()=>verifyNoop(s.pre,s.before,after,'category',response,'same','nonce'),/NEGATIVE_CONTRACT_DB_SIDE_EFFECT/);
 const other=clone(s.before);other.storage.push({...other.storage[0],versionId:'extra'});rehash(other);assert.throws(()=>verifyNoop(s.pre,s.before,other,'category',response,'same','nonce'),/NEGATIVE_CONTRACT_S3_SIDE_EFFECT/);
});
test('cleanup descriptor contains only captured child rows and exact versions',()=>{
 const s=sample(),before={parentSeal:sealParentObservation(s.pre,s.before)},ack={beforeSha256:digest(before),afterSeal:sealContextAfter(s.after),proof:verify(s)},descriptor=cleanupDescriptor(before,ack);
 assert.deepEqual(descriptor.fileIds,[s.response.body.id]);assert.equal(descriptor.auditIds.length,3);assert.equal(descriptor.storageVersions.length,2);assert.equal(descriptor.toSketchFileId,s.before.rows.Product[0].sketchFileId);assert.ok(!descriptor.fileIds.includes(s.before.rows.File[0].id));
});
test('parent13 rejoin requires exact raw Product timestamp and every earlier row',()=>{
 const s=sample();assert.equal(verifyParentRejoined(s.pre,s.before,clone(s.before)).parent13Compatible,true);
 const changed=clone(s.before);changed.rows.Product[0].updatedAt='2026-10-09T12:30:00.123';rehash(changed);assert.throws(()=>verifyParentRejoined(s.pre,s.before,changed),/SUPPLEMENTAL_CLEANUP_PARENT_ROWS_NOT_RESTORED/);
});
test('entry uses raw JSONB typed Product CAS before external child deletion',()=>{
 const text=readFileSync(path.join(here,'file-fixture113-context-smoke-entry.mjs'),'utf8');
 assert.ok(text.includes('to_jsonb(t)=$4::jsonb'));assert.ok(text.includes('"updatedAt"=$2::timestamp'));assert.ok(text.includes('JSON.stringify(expected)'));
 assert.ok(text.indexOf('FULL_RAW_PRODUCT_TYPED_CAS_REQUIRED')<text.indexOf('new DeleteObjectCommand'));
 assert.ok(text.indexOf('PRE_DELETE_S3_CAS_CHANGED')<text.indexOf('new DeleteObjectCommand'));
 assert.ok(!/import .*from ['"].\/file-fixture113-entry/.test(text));
});
test('coordinator refuses unapproved scope before filesystem/runtime',()=>{
 assert.throws(()=>contextSmokeCoordinator({authorized:false}),/ROOT_AUTHORIZED_SIGNED_PARENT13_REQUIRED/);
 assert.throws(()=>contextSmokeCoordinator({authorized:true,runId:randomUUID(),revision:'c'.repeat(40)}),/HASHED_DURABLE_PARENT_PRE_REQUIRED/);
});

function compact(s){
 const before={namespace:NS,version:2,kind:'context-before',runId:s.pre.runId,revision:s.pre.revision,preSha256:digest(s.pre),parentSeal:sealParentObservation(s.pre,s.before),media:s.media,notificationRecipients:s.recipients,sources:{contract:'a'.repeat(64),entry:'b'.repeat(64),runner:'c'.repeat(64),tests:'d'.repeat(64)},signature:'e'.repeat(64)};
 const proof=verify(s),ack={namespace:NS,version:2,kind:'context-ack',runId:s.pre.runId,revision:s.pre.revision,preSha256:digest(s.pre),beforeSha256:digest(before),intentSha256:'f'.repeat(64),response:s.response,afterSeal:sealContextAfter(s.after),childRows:{File:s.after.rows.File.filter(row=>row.id===proof.fileId),ChangeLog:s.after.rows.ChangeLog.filter(row=>proof.auditIds.includes(row.id)),Notification:s.after.rows.Notification.filter(row=>proof.notificationIds.includes(row.id))},proof,signature:'e'.repeat(64)};
 return {before,ack};
}
function realistic(){
 const s=sample(),p=s.pre.plan,oldFile=s.before.rows.File[0],newFile=s.after.rows.File.at(-1),newLogs=s.after.rows.ChangeLog.slice(1),newVersions=s.after.storage.slice(2);
 const members=Array.from({length:23},(_,i)=>i===0?p.actors.admin.id:i===1?p.actors.manager.id:'existing-office-user-'+String(i).padStart(3,'0'));s.recipients=members;
 s.before.rows.File=p.files.map((media,i)=>i===0?oldFile:{...clone(oldFile),id:'parent-file-'+i,fileName:media.fileName,mimeType:media.mimeType,storedName:randomUUID()+'-'+media.fileName,section:media.section,uploadedById:p.actors[media.actor].id,productId:media.target==='project'?null:p.ids.product,taskId:media.target==='task'?p.ids.task:null,hasThumb:media.mimeType==='image/png'});
 s.before.rows.FinanceDocument=p.financeDocs.map((media,i)=>({id:'parent-document-'+i,uploadedById:p.actors.admin.id,clientMutationId:media.clientMutationId,fileName:media.fileName,mimeType:media.mimeType,size:75,contentHash:'8'.repeat(64),storageMode:'s3',storageKey:'finance-documents/parent-document-'+i+'/'+'8'.repeat(64),state:'READY',createdAt:oldFile.createdAt,updatedAt:oldFile.createdAt}));
 s.before.rows.ChangeLog=Array.from({length:14},(_,i)=>({...clone(s.before.rows.ChangeLog[0]),id:'a-parent-log-'+String(i).padStart(2,'0'),entityId:s.before.rows.File[i%7].id,newValue:{fileName:s.before.rows.File[i%7].fileName,section:s.before.rows.File[i%7].section,clientMutationId:p.files[i%7].clientMutationId,uploadFingerprint:'9'.repeat(64)}}));
 s.before.rows.Notification=Array.from({length:161},(_,i)=>({id:'a-parent-notify-'+String(i).padStart(3,'0'),userId:members[i%members.length],type:'file.added',title:'Файл к проекту '+p.projectNumber,body:p.files[i%7].fileName,link:'/products/'+p.productNumber,readAt:null,createdAt:oldFile.createdAt}));
 s.before.keys=[...s.before.rows.File.flatMap(file=>[file.projectId+'/'+file.storedName,...(file.hasThumb?[file.projectId+'/thumbs/'+file.storedName+'.jpg']:[])]),...s.before.rows.FinanceDocument.map(doc=>doc.storageKey)];
 s.before.storage=s.before.keys.map((key,index)=>({key,versionId:'known-parent-version-'+index,deleteMarker:false,latest:true,etag:'"0123456789abcdef0123456789abcdef"',size:77}));
 const scopes=Object.fromEntries(Object.entries(s.before.rows).map(([table,rows])=>[table,rows.map(row=>row.id)]));scopes.UserPreference=s.before.scope.UserPreference;s.before.scope=scopes;
 const names=Array.from({length:54},(_,i)=>'PublicModel'+i),fp={count:'10000',hash:'6'.repeat(64)};
 s.pre.baseline={tables:names,fingerprints:Object.fromEntries(names.map(name=>[name,fp])),schema:{columns:fp,constraints:fp,indexes:fp,types:fp,triggers:fp},tokenClock:{kind:'crm-api-token-clock',version:1,capturedAt:'2026-10-09T12:30:00.123Z',stable:fp,full:fp,legacyStable:{count:'8',hash:'7'.repeat(32)},tokens:Array.from({length:8},(_,i)=>({idHash:bytesHash(Buffer.from('existing-token-'+i)),lastUsedAt:'2026-10-09T12:29:00.123Z'}))},org:{bot:{valueHash:'4'.repeat(64),stableHash:'5'.repeat(64),updatedAt:'2026-10-09T12:29:00.123Z'},other:fp}};
 s.pre.storageBaseline={hash:'3'.repeat(64),count:15000};s.before.preSha256=digest(s.pre);rehash(s.before);
 for(const table of Object.keys(s.before.rows))if(!['Product','File','ChangeLog','Notification'].includes(table))s.after.rows[table]=clone(s.before.rows[table]);
 s.after.rows.File=[...clone(s.before.rows.File),newFile];s.after.rows.ChangeLog=[...clone(s.before.rows.ChangeLog),...newLogs];
 s.after.rows.Notification=[...clone(s.before.rows.Notification),...members.map((userId,i)=>({id:'n-child-'+String(i).padStart(2,'0'),userId,type:'file.added',title:'Файл к проекту '+p.projectNumber,body:s.media.target.fileName,link:'/products/'+p.productNumber,readAt:null,createdAt:s.after.rows.Product[0].updatedAt}))];
 s.after.keys=[...s.before.keys,...newVersions.map(row=>row.key)];s.after.storage=[...clone(s.before.storage),...newVersions];s.after.scope=contextScope(s.before,s.after.rows);s.after.preSha256=digest(s.pre);rehash(s.after);
 return s;
}
test('compact parent seal retains every own table hash and full raw Product',()=>{
 const s=sample(),seal=sealParentObservation(s.pre,s.before);assert.deepEqual(seal.product,s.before.rows.Product[0]);
 assert.equal(seal.product.updatedAt,'2026-10-09T12:30:00.123456');assert.equal(seal.rowsHash,digest(s.before.rows));
 for(const [table,rows]of Object.entries(s.before.rows))assert.equal(seal.tableHashes[table],digest(rows));
 assert.equal(verifyParentRejoined(s.pre,seal,s.before).parent13Compatible,true);
});
test('compact ACK pins genuine child raw rows and exact response/versions',()=>{
 const s=sample(),{before,ack}=compact(s);assert.deepEqual(verifyCompactContextAck(s.pre,before,ack),ack.proof);
 const changed=clone(ack);changed.childRows.File[0].uploadedById=s.pre.plan.actors.admin.id;
 assert.throws(()=>verifyCompactContextAck(s.pre,before,changed),/COMPACT_REAL_CHILD_FILE_REQUIRED/);
});
test('all seven realistic54-table/7-file/3-doc/23-recipient phase packets fit unchanged caps',t=>{
 const s=realistic(),{before,ack}=compact(s),b={contextBefore:before,contextBeforeSha256:digest(before)},a={...b,contextAck:ack,contextAckSha256:digest(ack)};
 const intent={kind:'context-upload-intent',beforeSha256:digest(before),requestHash:digest(before.media),expectedOwnStateHash:before.parentSeal.rowsHash,expectedStorageManifestHash:before.parentSeal.storageHash,signature:'a'.repeat(64)};
 const cleanup={kind:'context-cleanup-intent',beforeSha256:digest(before),ackSha256:digest(ack),descriptor:cleanupDescriptor(before,ack),signature:'a'.repeat(64)};
 const negative={kind:'context-negative-intent',beforeSha256:digest(before),parentSeal:before.parentSeal,media:{fileName:s.pre.plan.files[2].fileName,clientMutationId:s.pre.plan.files[2].clientMutationId,contentHash:'8'.repeat(64),size:77},fileId:s.before.rows.File[2].id,cases:[...NEGATIVE_CASES],sources:before.sources,signature:'a'.repeat(64)};
 const phases=[
  ['inspect','context-before',{}],['prepare','context-upload',{...b,contextIntent:intent,contextIntentSha256:digest(intent)}],
  ['inspect','context-cleanup-intent',a],['restore','context-cleanup',{...a,contextCleanupIntent:cleanup,contextCleanupIntentSha256:digest(cleanup)}],
  ['inspect','context-closed',b],['inspect','context-negative-intent',b],['prepare','context-negatives',{...b,contextNegativeIntent:negative,contextNegativeIntentSha256:digest(negative)}],
 ];
 let peakDecoded=0,peakEncoded=0;for(const [operation,mode,extra]of phases){const packet=contextPacket(s.pre,operation,mode,extra),budget=transportBudget(packet);assert.ok(budget.decodedBytes<=64*1024,mode);assert.ok(budget.encodedBytes<=96*1024,mode);peakDecoded=Math.max(peakDecoded,budget.decodedBytes);peakEncoded=Math.max(peakEncoded,budget.encodedBytes);}t.diagnostic(JSON.stringify({syntheticPhaseBudget:{peakDecoded,peakEncoded,ackBodyBytes:Buffer.byteLength(JSON.stringify({status:'CONTEXT_ACK',ack}))}}));
 assert.equal(s.pre.baseline.tables.length,54);assert.equal(s.before.rows.File.length,7);assert.equal(s.before.rows.FinanceDocument.length,3);assert.equal(s.before.rows.Notification.length,161);
 assert.equal(contextPreflight(before.parentSeal,23),true);assert.ok(Buffer.byteLength(JSON.stringify(ack))<64*1024);
});
test('oversized full snapshots refuse before dispatch; decoded64 cap is strict',()=>{
 const s=realistic();let dispatches=0;
 assert.throws(()=>{const packet=contextPacket(s.pre,'prepare','context-upload',{uncompactedBefore:s.before,uncompactedAfter:s.after});dispatches++;return packet;},/EXISTING_CONTEXT_INPUT_CAP/);
 assert.equal(dispatches,0);assert.throws(()=>transportBudget({payload:'x'.repeat(64*1024)}),/EXISTING_CONTEXT_INPUT_CAP/);
});
test('pre-POST bound prevents child ACK overflow from unexpected fanout',()=>{
 const s=sample(),seal=sealParentObservation(s.pre,s.before);seal.rowCounts.Notification=199;
 assert.throws(()=>contextPreflight(seal,2),/CHILD_CAPTURE_BOUND_BEFORE_POST/);
});
test('legal original clock flags do not alter parent rows/storage no-op proof',()=>{
 const s=sample(),changed=clone(s.before);changed.originalVerification.tokenClockChanged=true;changed.originalVerification.botClockChanged=true;changed.signature='c'.repeat(64);
 assert.equal(verifyParentRejoined(s.pre,sealParentObservation(s.pre,s.before),changed).parent13Compatible,true);
 assert.notEqual(sealParentObservation(s.pre,changed).observationSha256,sealParentObservation(s.pre,s.before).observationSha256);
});
test('RW cleanup never calls RR-only original clock capture and requires late RO proof',()=>{
 const text=readFileSync(path.join(here,'file-fixture113-context-smoke-entry.mjs'),'utf8'),cleanup=text.slice(text.indexOf('export async function cleanupContext'),text.indexOf('export async function closeContext'));
 assert.ok(!cleanup.includes('frozen.original('));assert.ok(cleanup.includes('writeGuard:true'));assert.ok(cleanup.includes('await frozen.protectedWriteRows(tx,pre,parentState)'));
 assert.ok(text.includes('originalWriteRowsGuard:true,lateReadonlyClockAndSchemaProofRequired:true'));assert.ok(text.includes("kind:writeGuard?'context-write-snapshot':'context-observation'"));
 const upload=text.slice(text.indexOf('export async function uploadContext'),text.indexOf('function ackGuard'));
 assert.ok(upload.indexOf('contextPreflight(')<upload.indexOf('realPost('));
});

test('exact compiled stdin cold import loads real external CJS modules with zero clients/network',async t=>{
 const pack=await contextSmokeBundle(historicalRead);
 const preload=[
  "import {createRequire,syncBuiltinESMExports} from 'node:module';",
  "const require=createRequire(process.cwd()+'/context113-cold-preload.cjs');",
  "const counters={prismaConstructors:0,s3Constructors:0,networkCalls:0};",
  "const block=()=>{counters.networkCalls++;throw Error('REAL_COLD_NETWORK_CALL');};globalThis.fetch=block;",
  "for(const name of ['node:net','node:tls','node:http','node:https','node:dns']){const mod=require(name);for(const key of ['connect','createConnection','request','get','lookup','resolve','resolve4','resolve6'])if(typeof mod[key]==='function')mod[key]=block;}syncBuiltinESMExports();",
  "function guarded(name,field,counter){const id=require.resolve(name),real=require(name);if(typeof real[field]!=='function')throw Error('REAL_EXTERNAL_CONSTRUCTOR_MISSING');const copy=Object.create(Object.getPrototypeOf(real));for(const key of Reflect.ownKeys(real)){if(key===field)Object.defineProperty(copy,key,{enumerable:true,configurable:true,writable:true,value:new Proxy(real[field],{construct(){counters[counter]++;throw Error('REAL_COLD_CLIENT_CONSTRUCTION');}})});else Object.defineProperty(copy,key,Object.getOwnPropertyDescriptor(real,key));}require.cache[id].exports=copy;}",
  "guarded('@prisma/client','PrismaClient','prismaConstructors');guarded('@aws-sdk/client-s3','S3Client','s3Constructors');",
  "const sharp=require('sharp');if(typeof sharp!=='function'||!sharp.versions?.vips)throw Error('REAL_SHARP_CJS_LOAD_REQUIRED');",
  "process.once('beforeExit',()=>console.log(JSON.stringify({kind:'actual-context113-compiled-cold-import',stdinBundleSha256:'"+pack.sha256+"',realModules:['@prisma/client','@aws-sdk/client-s3','sharp'],...counters})));",
 ].join('\n');
 const env={...process.env};for(const key of ['CRM_STAGING_BROWSER_INPUT','CRM_MODERNIZATION_STAGE_PROOF','CRM_MODERNIZATION_TARGET','DATABASE_URL','AUTH_SECRET','NEXTAUTH_SECRET','S3_ACCESS_KEY','S3_SECRET_KEY'])delete env[key];
 const result=spawnSync(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(preload),'--input-type=module'],{cwd:path.resolve(here,'..'),input:pack.bytes,encoding:'utf8',env,timeout:20000,windowsHide:true});
 assert.equal(result.status,0,result.stderr);assert.equal(result.stderr,'');
 const lines=result.stdout.trim().split(/\r?\n/);assert.equal(lines.length,1,'actual bundle must not invoke either main');
 const receipt=JSON.parse(lines[0]);assert.equal(receipt.stdinBundleSha256,pack.sha256);
 assert.deepEqual(receipt.realModules,['@prisma/client','@aws-sdk/client-s3','sharp']);assert.equal(receipt.prismaConstructors,0);assert.equal(receipt.s3Constructors,0);assert.equal(receipt.networkCalls,0);
 t.diagnostic(JSON.stringify({sourceOnlyRealColdImport:{bundleBytes:pack.bytes.length,sha256:pack.sha256,prismaConstructors:0,s3Constructors:0,networkCalls:0}}));
});

test('fresh signed PRE/plan revision must match physical input before clients and writes',()=>{
 const text=readFileSync(path.join(here,'file-fixture113-context-smoke-entry.mjs'),'utf8'),main=text.slice(text.indexOf('export async function main')),guard=text.slice(text.indexOf('function beforeGuard'),text.indexOf('async function realPost'));
 assert.ok(main.indexOf('EXACT_FRESH_PARENT_PHYSICAL_REVISION_REQUIRED')<main.indexOf('new PrismaClient'));
 assert.ok(main.includes('input.pre?.revision===input.revision&&input.pre.plan?.revision===input.revision'));
 assert.ok(guard.includes('pre?.revision===input.revision&&pre.plan?.revision===input.revision'));
});
