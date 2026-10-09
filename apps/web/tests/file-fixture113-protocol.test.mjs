import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {FIXTURE_NAMESPACE as NS,DISABLED_PASSWORD,CLEANUP_ORDER,newFixturePlan,validatePlan,signed,verifySignedFixture,ownFileKey,ownFinanceKey,validateStorageVersions,digest,certificateForHandoff,cleanupIntent,compareFileDelete,fixtureStageGuard,preferencePairs,handoffSubjects,compareCurrentHandoff,publicDeleteMetadata,validateCompiledDeleteDescriptor} from './file-fixture113-protocol.mjs';
import {mediaBytes,compareOriginal,ownState,lockOwned,deleteOwnedRows,createOwnGraph,fixtureCookieProfiles,readFixtureUploadReply,FixtureUploadResponseError,safeFixtureUploadDiagnostic,fixtureUploadStopCode} from './file-fixture113-entry.mjs';
import {fixture113Bundle,fixture113Coordinator,immutablePublish} from './file-fixture113-runner.mjs';
import {lifecycleNativeGuard} from './file-fixture113-lifecycle-native.mjs';
const runId=randomUUID(),revision='a'.repeat(40),secret='QA113_TEST_ONLY_NOT_A_LIVE_SECRET',h=value=>createHash('sha256').update(value).digest('hex');
function plan(){return newFixturePlan(runId,revision);}
function deleteManifestFixture(){
 const product='app/(app)/products/[id]/page',project='app/(app)/projects/[id]/page';
 return {node:{['a'.repeat(42)]:{filename:'server/files/actions.ts',exportedName:'deleteFile',workers:{[product]:{moduleId:100,async:false},[project]:{moduleId:200,async:false}},layer:{[product]:'action-browser',[project]:'action-browser'}}},encryptionKey:'SYNTHETIC_PRIVATE_TEST_ONLY_KEY'};
}
const publicMetadata=()=>publicDeleteMetadata(Buffer.from(JSON.stringify(deleteManifestFixture())),revision);
test('fresh UUID graph uses only disabled-password ADMIN/MANAGER/ENGINEER and no original profiles/preferences',()=>{
 const p=plan();assert.equal(validatePlan(p),p);assert.equal(p.originalUsersReused,false);assert.equal(p.originalPreferencesReused,false);assert.deepEqual(Object.keys(p.actors).sort(),['admin','engineer','manager']);assert.ok(Object.values(p.actors).every(actor=>actor.passwordHash===DISABLED_PASSWORD&&actor.email.endsWith('@invalid.test')));
 assert.equal(new Set(Object.values(p.ids)).size,8);assert.equal(p.files.length,7);assert.equal(p.financeDocs.length,3);
 assert.ok(p.files.some(file=>file.key==='foreign-photo'&&file.actor==='admin'&&!file.cover));assert.ok(p.files.some(file=>file.key==='own-measure'&&file.actor==='engineer'));
});
for(const mutate of [
 p=>{p.actors.admin.id='existing';},p=>{p.actors.manager.passwordHash='existing-live-hash';},p=>{p.actors.engineer.roles=['ADMIN'];},p=>{p.originalPreferencesReused=true;},p=>{p.ids.cashAccount=p.ids.project;},p=>{p.finance.income='1000';},p=>{p.files[0].fileName='../original.png';},
])test('invalid existing/foreign namespace/financial scope is rejected '+mutate.toString(),()=>{const p=plan();mutate(p);assert.throws(()=>validatePlan(p));});
test('signed PRE and observation cannot be forged or borrowed from another run',()=>{
 const pre=signed({namespace:NS,version:2,kind:'pre',runId,revision,plan:plan()},secret);assert.equal(verifySignedFixture(pre,secret,'pre',{runId}).kind,'pre');
 for(const patch of [{runId:randomUUID()},{namespace:'legacy'},{version:1},{kind:'handoff'},{signature:'0'.repeat(64)},{plan:{...pre.plan,originalUsersReused:true}}])assert.throws(()=>verifySignedFixture({...pre,...patch},secret,'pre',{runId}));
});
test('only exact own regular original/thumb keys are owned',()=>{
 const p=plan(),media=p.files.find(row=>row.key==='foreign-photo'),file={projectId:p.ids.project,fileName:media.fileName,mimeType:media.mimeType,uploadedById:p.actors.admin.id,storedName:randomUUID()+'-'+media.fileName,hasThumb:true};
 assert.equal(ownFileKey(p,file,p.ids.project+'/'+file.storedName),true);assert.equal(ownFileKey(p,file,p.ids.project+'/thumbs/'+file.storedName+'.jpg'),true);
 for(const patch of [{projectId:'original'},{uploadedById:'original'},{fileName:'original.png'},{storedName:'../original.png'}])assert.equal(ownFileKey(p,{...file,...patch},p.ids.project+'/'+file.storedName),false);
});
test('only own ADMIN document UUID/key/content hash and planned mutation can be owned',()=>{
 const p=plan(),media=p.financeDocs[0],id=randomUUID(),hash=h('PDF fixture'),key='finance-documents/'+id+'/'+hash,doc={id,uploadedById:p.actors.admin.id,clientMutationId:media.clientMutationId,fileName:media.fileName,mimeType:media.mimeType,contentHash:hash,storageMode:'s3',storageKey:key};
 assert.equal(ownFinanceKey(p,doc,key),true);for(const patch of [{uploadedById:'original'},{clientMutationId:randomUUID()},{storageMode:'local'},{storageKey:'finance-documents/original/'+hash},{contentHash:'fake'}])assert.equal(ownFinanceKey(p,{...doc,...patch},key),false);
});
test('exact version cleanup cannot become prefix/current-key or unversioned blind deletion',()=>{
 const key='own/file',rows=[{key,versionId:'version1',deleteMarker:false,latest:true,etag:'"fixed"',size:10}];assert.equal(validateStorageVersions(rows,[key]),rows);
 for(const row of [{...rows[0],key:'original/file'},{...rows[0],versionId:null},{...rows[0],versionId:''},{...rows[0],unknown:true}])assert.throws(()=>validateStorageVersions([row],[key]));
 assert.throws(()=>validateStorageVersions([...rows,...rows],[key]));
});
test('fresh media includes genuine PNG, valid PDF xref/stream length and explicit unsupported CAD',async()=>{
 const p=plan(),image=await mediaBytes(p.files.find(row=>row.mimeType==='image/png'));assert.deepEqual([...image.subarray(0,8)],[137,80,78,71,13,10,26,10]);
 const pdf=(await mediaBytes(p.files.find(row=>row.mimeType==='application/pdf'))).toString('ascii');assert.ok(pdf.startsWith('%PDF-1.4\n'));const match=/\/Length (\d+) >>\nstream\n([\s\S]*?)endstream/.exec(pdf);assert.ok(match);assert.equal(Buffer.byteLength(match[2]),Number(match[1]));const xref=Number(/startxref\n(\d+)/.exec(pdf)[1]);assert.equal(pdf.slice(xref,xref+4),'xref');
 assert.match((await mediaBytes(p.files.find(row=>row.mimeType==='application/octet-stream'))).toString(),/unsupported CAD/);
});
test('certificate is source-backed with exact action/PRE/currentstate/storage/financial hashes and rejects bool/foreign binds',()=>{
 const handoff={namespace:NS,version:2,kind:'handoff',runId,revision,...Object.fromEntries(['preSha256','checkpointHash','currentOwnedStateHash','storageManifestHash','financialStateHash'].map(key=>[key,h(key)])),...publicMetadata()};
 const expected={...handoff,verifierSourceSha256:h('reviewed producer')},receipt={identity:{hostname:'crm-staging',revision},bundleSha256:h('bundle')};
 const cert=certificateForHandoff(handoff,receipt,expected);assert.equal(cert.kind,'current-owned-fixture-verification');assert.equal(cert.verified,true);assert.equal(cert.actionManifestHash,handoff.actionManifestHash);
 assert.throws(()=>certificateForHandoff(true,receipt,expected));assert.throws(()=>certificateForHandoff(handoff,receipt,{...expected,currentOwnedStateHash:h('other')}));assert.throws(()=>certificateForHandoff(handoff,{...receipt,identity:{...receipt.identity,revision:'b'.repeat(40)}},expected));
});
test('cleanup intent binds one signed observed state and known dependency order',()=>{
 const pre={namespace:NS,version:2,kind:'pre',runId,revision},observation={kind:'observation',runId,preSha256:digest(pre),currentOwnedStateHash:h('rows'),storageManifestHash:h('versions')};const intent=cleanupIntent(pre,observation,revision);
 assert.equal(intent.observationSha256,digest(observation));assert.deepEqual(intent.scopeTables,CLEANUP_ORDER);assert.ok(CLEANUP_ORDER.indexOf('Payment')<CLEANUP_ORDER.indexOf('FinanceDocument'));assert.ok(CLEANUP_ORDER.indexOf('UserPreference')<CLEANUP_ORDER.indexOf('User'));assert.throws(()=>cleanupIntent(pre,{...observation,preSha256:h('old')},revision));
});
test('draft coordinator refuses implicit runtime and bundle build/import remains source-only',async()=>{
 assert.throws(()=>fixture113Coordinator({authorized:false,revision,runId,outputDir:'relative'}));const pack=await fixture113Bundle();assert.ok(pack.bytes.length>0&&pack.bytes.length<=256*1024);assert.ok(pack.sources['file-fixture113-entry.mjs']);assert.ok(pack.sources['crm-acceptance-token-clock.mjs']);assert.ok(!pack.sources['engineer-sketch-qa-entry.mjs']);
 const entry=readFileSync(new URL('./file-fixture113-entry.mjs',import.meta.url),'utf8');assert.doesNotMatch(entry,/import.+engineer-sketch-qa-entry/);assert.match(entry,/VersionId:row.versionId/);assert.match(entry,/readonly/);assert.doesNotMatch(entry,/deleteBucket|DeleteObjectsCommand|forget|prune/);
});

function deletionFixture(){
 const p=plan(),media=p.files.find(row=>row.key==='own-measure'),id='own-file',file={id,fileName:media.fileName,projectId:p.ids.project,storedName:randomUUID()+'-'+media.fileName,hasThumb:true};
 const keys=[file.projectId+'/'+file.storedName,file.projectId+'/thumbs/'+file.storedName+'.jpg'],storage=keys.map((key,index)=>({key,versionId:'old-'+index,deleteMarker:false,latest:true,etag:'hash',size:10}));
 const before={rows:{File:[file],ChangeLog:[],UserPreference:[],Payment:[{id:p.ids.income,amount:2}]},scope:{User:[p.actors.engineer.id]},storage,currentOwnedStateHash:h('before'),storageManifestHash:h('storage-before')};
 const after=structuredClone(before);after.rows.File=[];after.rows.ChangeLog=[{id:'audit-delete',entity:'file',entityId:id,action:'delete',actorId:p.actors.engineer.id,oldValue:{fileName:file.fileName}}];after.storage=storage.map(row=>({...row,latest:false})).concat(keys.map((key,index)=>({key,versionId:'marker-'+index,deleteMarker:true,latest:true,etag:null,size:null})));return {p,before,after,id};
}
test('compiled own delete proof accepts exact audit +accounted markers while financial bytes unchanged',()=>{const f=deletionFixture();assert.equal(compareFileDelete(f.before,f.after,f.id,f.p.actors.engineer.id).deleted,true);});
for(const mutate of [
 f=>{f.after.rows.Payment[0].amount=1;},f=>{f.after.rows.ChangeLog[0].actorId='foreign';},f=>{f.after.rows.ChangeLog=[];},f=>{f.after.rows.File=f.before.rows.File;},f=>{f.after.storage.at(-1).deleteMarker=false;},f=>{f.after.storage[0].etag='changedbytes';},f=>{f.after.storage.push({key:'unknown',versionId:'unknown',latest:true,deleteMarker:false,etag:'x',size:1});},
])test('delete receipt refuses unknown financial/audit/version drift '+mutate.toString(),()=>{const f=deletionFixture();mutate(f);assert.throws(()=>compareFileDelete(f.before,f.after,f.id,f.p.actors.engineer.id));});
test('cancelled deletion cannot change state/storage',()=>{const f=deletionFixture();assert.equal(compareFileDelete(f.before,f.before,f.id,f.p.actors.engineer.id,true).cancelled,true);assert.throws(()=>compareFileDelete(f.before,f.after,f.id,f.p.actors.engineer.id,true));});

test('freshproducer pure physicalguard validates exact stage/DB/storage/secret metadata and rejects production',()=>{
 const host='c'.repeat(12),proof={hostname:'crm-staging',revision,databaseVolume:'crm-staging_pgdata',web:host+'d'.repeat(52),database:'e'.repeat(64),outerW07Sha256:'f'.repeat(64)},env={CRM_MODERNIZATION_TARGET:'staging',DATABASE_URL:'postgresql://qa:qa@db:5432/crm',CRM_FILE_STORAGE:'s3',S3_BUCKET:'pero-crm-staging',S3_ENDPOINT:'http://192.168.0.33:9000',AUTH_SECRET:secret,S3_ACCESS_KEY:'qa',S3_SECRET_KEY:'qa',CRM_MODERNIZATION_STAGE_PROOF:JSON.stringify(proof)},input={runId,revision,authorized:true};
 assert.equal(fixtureStageGuard(input,env,{host,docker:true}).proof.revision,revision);
 for(const patch of [{CRM_MODERNIZATION_TARGET:'local'},{DATABASE_URL:'postgresql://qa:qa@db:5432/production'},{S3_BUCKET:'production'},{CRM_MODERNIZATION_STAGE_PROOF:JSON.stringify({...proof,revision:'b'.repeat(40)})}])assert.throws(()=>fixtureStageGuard(input,{...env,...patch},{host,docker:true}));
 assert.throws(()=>fixtureStageGuard({...input,authorized:false},env,{host,docker:true}));assert.throws(()=>fixtureStageGuard(input,env,{host,docker:false}));
});

test('UserPreference is a composite pair with no id/FK, including zero and real nonempty own rows',()=>{
 const actors=['own-user'];assert.deepEqual(preferencePairs([],actors),[]);assert.deepEqual(preferencePairs([{userId:'own-user',key:'product.tab',value:'files'}],actors),[{userId:'own-user',key:'product.tab'}]);assert.throws(()=>preferencePairs([{id:'invented',userId:'own-user',key:'x'}],actors));assert.throws(()=>preferencePairs([{userId:'original-user',key:'x'}],actors));assert.throws(()=>preferencePairs([{userId:'own-user',key:'x'},{userId:'own-user',key:'x'}],actors));
});
for(const change of [
 f=>{f.before.rows.ChangeLog=[{id:'existing-own-log',actorId:f.p.actors.admin.id,value:1}];f.after.rows.ChangeLog.unshift({id:'existing-own-log',actorId:f.p.actors.admin.id,value:2});},
 f=>{f.before.rows.ChangeLog=[{id:'existing-own-log',value:1}];},
 f=>{f.after.rows.UserPreference=[{userId:f.p.actors.engineer.id,key:'product.tab',value:'changed'}];},
])test('delete never hides prior own audit or preference drift '+change.toString(),()=>{const f=deletionFixture();change(f);assert.throws(()=>compareFileDelete(f.before,f.after,f.id,f.p.actors.engineer.id));});

function coldImport(bytes,probe='none'){
 const preload=`
  import {createRequire} from 'node:module';import path from 'node:path';import net from 'node:net';import http from 'node:http';import https from 'node:https';
  const require=createRequire(path.resolve(process.cwd(),'package.json')),counts={prisma:0,s3:0,fetch:0,network:0};
  const absent=Object.keys(process.env).every(key=>!key.startsWith('CRM_')&&!['DATABASE_URL','S3_ENDPOINT','S3_BUCKET','S3_ACCESS_KEY','S3_SECRET_KEY','AUTH_SECRET','NEXTAUTH_SECRET'].includes(key));
  const fail=key=>{counts[key]++;throw Error('OFFLINE_'+key.toUpperCase()+'_FORBIDDEN');};
  Object.defineProperty(require('@prisma/client'),'PrismaClient',{value:class{constructor(){fail('prisma');}},configurable:true});
  Object.defineProperty(require('@aws-sdk/client-s3'),'S3Client',{value:class{constructor(){fail('s3');}},configurable:true});
  globalThis.fetch=()=>fail('fetch');net.Socket.prototype.connect=function(){return fail('network');};http.request=()=>fail('network');https.request=()=>fail('network');
  if(${JSON.stringify(probe)}==='prisma'){try{new (require('@prisma/client').PrismaClient)();}catch{}}
  if(${JSON.stringify(probe)}==='s3'){try{new (require('@aws-sdk/client-s3').S3Client)();}catch{}}
  if(${JSON.stringify(probe)}==='fetch'){try{fetch('http://127.0.0.1/');}catch{}}
  if(${JSON.stringify(probe)}==='network'){try{net.connect(1,'127.0.0.1');}catch{}}
  process.once('beforeExit',()=>{console.log(JSON.stringify({kind:'fixture113-offline-cold-import',inputsAbsent:absent,counts}));if(!absent||Object.values(counts).some(value=>value!==0))process.exitCode=1;});
 `;
 const env=Object.fromEntries(['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','PATHEXT'].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]]));
 const result=spawnSync(process.execPath,['--import','data:text/javascript;base64,'+Buffer.from(preload).toString('base64'),'--input-type=module'],{cwd:fileURLToPath(new URL('..',import.meta.url)),input:bytes,encoding:'utf8',env,timeout:15000,maxBuffer:128*1024});
 const line=(result.stdout??'').trim().split('\n').find(value=>value.startsWith('{"kind":"fixture113-offline-cold-import"'));
 return {status:result.status,signal:result.signal,receipt:line?JSON.parse(line):null,stderr:result.stderr};
}
test('exact emitted ESM stdin cold-import has no CRM input, client construction or network; instrumentation detects violations',async()=>{
 const pack=await fixture113Bundle(),actual=coldImport(pack.bytes);
 assert.equal(actual.signal,null);assert.equal(actual.status,0,'offline compiled import must finish normally: '+(actual.stderr?.match(/^(?:TypeError|ReferenceError|Error):[^\r\n]{1,160}/m)?.[0]??'NO_SAFE_ERROR'));assert.deepEqual(actual.receipt,{kind:'fixture113-offline-cold-import',inputsAbsent:true,counts:{prisma:0,s3:0,fetch:0,network:0}});
 for(const probe of ['prisma','s3','fetch','network']){const rejected=coldImport(pack.bytes,probe);assert.equal(rejected.status,1);assert.equal(rejected.receipt?.counts[probe],1);}
});

function ownedGraphFixture(){
 const p=plan();p.projectNumber='9999';p.productNumber='9999.1';p.taskTitle='QA113 files '+runId;
 const files=p.files.map(media=>({id:randomUUID(),fileName:media.fileName,mimeType:media.mimeType,section:media.section,uploadedById:p.actors[media.actor].id,projectId:p.ids.project,productId:media.target==='project'?null:p.ids.product,taskId:media.target==='task'?p.ids.task:null,storedName:randomUUID()+'-'+media.fileName,hasThumb:media.mimeType.startsWith('image/')}));
 const docs=p.financeDocs.map(media=>{const id=randomUUID(),contentHash=h(media.fileName);return {id,fileName:media.fileName,mimeType:media.mimeType,uploadedById:p.actors.admin.id,clientMutationId:media.clientMutationId,state:'READY',contentHash,storageMode:'s3',storageKey:'finance-documents/'+id+'/'+contentHash};});
 const rows={
  User:Object.values(p.actors).map(row=>({...row,active:true})),Client:[{id:p.ids.client}],Project:[{id:p.ids.project,clientId:p.ids.client,currency:'BYN',stage:'CONTRACT',coverFileId:null}],Product:[{id:p.ids.product,projectId:p.ids.project,engineerId:p.actors.engineer.id,status:'DESIGN',sketchFileId:files[0].id}],Task:[{id:p.ids.task,projectId:p.ids.project,productId:p.ids.product,assigneeId:p.actors.engineer.id}],CashAccount:[{id:p.ids.cashAccount,name:'QA113 cash '+runId}],ExpenseArticle:[{id:p.ids.article}],
  Payment:['income','expense'].map(key=>({id:p.ids[key],projectId:p.ids.project,cashAccountId:p.ids.cashAccount,createdById:p.actors.admin.id,currency:'BYN',rate:'1.000000',amount:key==='income'?'2.00':'1.00',bynAmount:key==='income'?'2.00':'1.00',projectAmount:key==='income'?'2.00':'1.00',direction:key==='income'?'INCOME':'EXPENSE',expenseArticleId:key==='income'?null:p.ids.article,deletionId:null,reportDocumentId:docs[key==='income'?1:0].id,paidAt:p.financeDate+'T12:00:00.000',comment:'QA113 '+runId})),
  File:files,FinanceDocument:docs,ChangeLog:[],Notification:[],DomainEvent:[],UserPreference:[]
 };
 const keys=[...files.flatMap(file=>[file.projectId+'/'+file.storedName,...(file.hasThumb?[file.projectId+'/thumbs/'+file.storedName+'.jpg']:[])]),...docs.map(doc=>doc.storageKey)];const storage=keys.map(key=>({key,versionId:'known-version',deleteMarker:false,latest:true,etag:'synthetic-etag',size:10}));
 return {p,observation:{rows,storage},contentHashes:Object.fromEntries(files.map(file=>[file.id,h(file.fileName)]))};
}
test('normalized handoff subjects are shaped BEFORE signing for the shared115116 ABI, including linked financial docs',()=>{
 const f=ownedGraphFixture(),subjects=handoffSubjects(f.p,f.observation,f.contentHashes),body=signed({namespace:NS,version:2,kind:'handoff',runId,revision,...subjects},secret);
 assert.equal(subjects.currentSketchFileId,f.observation.rows.Product[0].sketchFileId);assert.equal(subjects.currentProjectCoverFileId,null);assert.equal(subjects.paths.financeProject,'/finance/projects/'+f.p.ids.project);
 assert.deepEqual(subjects.finance,{accountId:f.p.ids.cashAccount,articleId:f.p.ids.article,incomeId:f.p.ids.income,expenseId:f.p.ids.expense,accountName:'QA113 cash '+runId,incomeComment:'QA113 '+runId,expenseComment:'QA113 '+runId,date:f.p.financeDate,currency:'BYN',incomeAmount:'2',expenseAmount:'1',rate:'1'});
 assert.ok(subjects.financeDocs.every(doc=>doc.status==='READY'&&[null,f.p.ids.income,f.p.ids.expense].includes(doc.paymentId)&&!Object.hasOwn(doc,'state')&&!Object.hasOwn(doc,'ownPaymentId')));assert.ok(!Object.hasOwn(body,'currentSketch'));assert.ok(Object.values(body.actors).every(actor=>!Object.hasOwn(actor,'passwordHash')&&!Object.hasOwn(actor,'email')));
 assert.equal(verifySignedFixture(body,secret,'handoff',{runId}).currentSketchFileId,subjects.currentSketchFileId);assert.throws(()=>verifySignedFixture({...body,currentSketchFileId:randomUUID()},secret,'handoff',{runId}));
 const thumb=f.observation.storage.find(row=>row.key.includes('/thumbs/'));const old=subjects.files[0].versionSetHash;thumb.versionId='changed-own-thumb';assert.notEqual(handoffSubjects(f.p,f.observation,f.contentHashes).files[0].versionSetHash,old);
});
for(const change of [
 f=>{f.observation.rows.Payment[0].amount='3';},f=>{f.observation.rows.Payment[1].paidAt='2000-01-01';},f=>{f.observation.rows.Payment[0].reportDocumentId='original-document';},f=>{f.observation.rows.FinanceDocument[0].uploadedById='original-user';},f=>{f.observation.rows.FinanceDocument[0].state='PENDING';},f=>{f.observation.rows.Product[0].sketchFileId='foreign-file';},f=>{delete f.contentHashes[f.observation.rows.File[0].id];},
])test('normalized signed ABI rejects changed amounts/dates/original links/not-ready/missing-owned-content '+change.toString(),()=>{const f=ownedGraphFixture();change(f);assert.throws(()=>handoffSubjects(f.p,f.observation,f.contentHashes));});

test('actual ownState UserPreference SELECT/order/scope is composite with zero/nonempty fixtures and scalar bindings',async()=>{
 for(const nonempty of [false,true]){
  const f=ownedGraphFixture();if(nonempty)f.observation.rows.UserPreference=[{userId:f.p.actors.engineer.id,key:'product.tab',value:'files'},{userId:f.p.actors.manager.id,key:'project.tab',value:'files'}];const calls=[];
  const tx={$queryRawUnsafe:async(sql,...args)=>{calls.push({sql,args});const table=/FROM "([A-Za-z]+)"/.exec(sql)?.[1];assert.ok(table&&f.observation.rows[table]);assert.ok(args.every(value=>typeof value==='string'));if(table==='UserPreference'){assert.match(sql,/WHERE "userId" IN/);assert.match(sql,/ORDER BY "userId","key"/);assert.doesNotMatch(sql,/\bid\b/);}return f.observation.rows[table].map(row=>({row}));}};
  const state=await ownState(tx,{plan:f.p});assert.deepEqual(state.scope.UserPreference,preferencePairs(f.observation.rows.UserPreference,Object.values(f.p.actors).map(row=>row.id)));assert.equal(calls.filter(call=>call.sql.includes('FROM "UserPreference"')).length,1);
 }
});
test('actual owned row locks and cleanup use two-key preference CAS; zero rows avoid invented-id queries and foreign preferences remain outside',async()=>{
 const actor='fresh-actor',prefs=[{userId:actor,key:'product.tab',value:'files'},{userId:actor,key:'project.tab',value:'files'}];
 for(const rows of [[],prefs]){
  const locked=[],deleted=[],tx={$queryRawUnsafe:async(sql,...args)=>{locked.push({sql,args});return rows.map(({userId,key})=>({userId,key}));},userPreference:{deleteMany:async input=>{deleted.push(input);return {count:1};}}},state={rows:{UserPreference:rows},actors:[actor]};
  await lockOwned(tx,state);const result=await deleteOwnedRows(tx,state);assert.equal(result.UserPreference,rows.length);assert.deepEqual(deleted,rows.map(({userId,key})=>({where:{userId,key}})));
  assert.equal(locked.length,rows.length?1:0);if(rows.length){assert.doesNotMatch(locked[0].sql,/\bid\b/);assert.match(locked[0].sql,/ORDER BY "userId","key" FOR UPDATE/);assert.deepEqual(locked[0].args,[actor,'product.tab',actor,'project.tab']);}
 }
 await assert.rejects(()=>deleteOwnedRows({userPreference:{deleteMany:async()=>({count:0})}},{rows:{UserPreference:prefs},actors:[actor]}),/EXACT_PREFERENCE_PAIR_DELETE/);
});

test('current owner verifier rejects historical or post-sign normalized handoffs even with authentic signatures',()=>{
 const preSha256=h('signed pre'),meta=publicMetadata(),input={runId,revision,preSha256,...Object.fromEntries(['actionManifestHash','rawManifestSha256','compiledDeleteFileHash'].map(key=>[key,meta[key]]))},f=ownedGraphFixture();
 const current=signed({namespace:NS,version:2,kind:'handoff',runId,revision,preSha256,checkpointHash:preSha256,...meta,currentOwnedStateHash:h('current owned rows'),storageManifestHash:h('current storage'),financialStateHash:h('current finance'),...handoffSubjects(f.p,f.observation,f.contentHashes)},secret);
 assert.equal(compareCurrentHandoff(current,current,secret,input),true);
 for(const patch of [{revision:'b'.repeat(40)},{preSha256:h('foreign pre')},{currentOwnedStateHash:h('historical owned rows')},{storageManifestHash:h('old versions')},{finance:{...current.finance,incomeAmount:'3'}}]){const {signature,...body}=current;assert.throws(()=>compareCurrentHandoff(signed({...body,...patch},secret),current,secret,input));}
 assert.throws(()=>compareCurrentHandoff({...current,signature:'0'.repeat(64)},current,secret,input));assert.throws(()=>compareCurrentHandoff(current,current,secret,{...input,actionManifestHash:h('caller manifest')}));
});

function originalPair(){
 const tables=['ApiToken','File','Material','OrgSetting','Payment','PayrollEntry','UserPreference'],fingerprints=Object.fromEntries(tables.map(name=>[name,{count:'2',hash:h(name)}]));
 const tokenClock={kind:'crm-api-token-clock',version:1,capturedAt:'2026-10-09T00:10:00.000Z',stable:{count:'2',hash:h('token stable')},legacyStable:{count:'2',hash:'a'.repeat(32)},full:fingerprints.ApiToken,tokens:[{idHash:h('token1'),lastUsedAt:null},{idHash:h('token2'),lastUsedAt:'2026-10-09T00:00:00.000Z'}].sort((a,b)=>a.idHash.localeCompare(b.idHash))};
 const before={tables,fingerprints,schema:{columns:{count:'20',hash:h('exact catalogue')}},tokenClock,org:{other:{count:'1',hash:h('nonbot settings')},bot:{valueHash:h('unchanged bot value'),stableHash:h('exact bot stable fields'),updatedAt:'2026-10-09T00:00:00.000Z'}}},after=structuredClone(before);after.tokenClock.capturedAt='2026-10-09T00:20:00.000Z';return {before,after};
}
test('original fixture guard protects complete models/finance/storage references/preferences; only measured monotonic same-value clocks can differ',()=>{
 const p=originalPair();assert.equal(compareOriginal(p.before,p.after).originalRelationsMatch,true);
 p.after.tokenClock.tokens[0].lastUsedAt='2026-10-09T00:15:00.000Z';p.after.tokenClock.full.hash=h('actual changed token timestamp');p.after.fingerprints.ApiToken.hash=p.after.tokenClock.full.hash;
 p.after.org.bot.updatedAt='2026-10-09T00:17:00.000Z';p.after.fingerprints.OrgSetting.hash=h('actual changed bot timestamp');const result=compareOriginal(p.before,p.after);assert.equal(result.tokenClockChanged,true);assert.equal(result.botClockChanged,true);
});
for(const mutate of [
 p=>{p.after.tables.pop();},p=>{p.after.tables.push('UnknownModel');},p=>{p.after.schema.columns.hash=h('unknown DDL');},p=>{p.after.fingerprints.Payment.hash=h('changed money');},p=>{p.after.fingerprints.PayrollEntry.hash=h('changed payroll');},p=>{p.after.fingerprints.File.count='1';},p=>{p.after.fingerprints.Material.hash=h('changed stock');},p=>{p.after.fingerprints.UserPreference.hash=h('original-user changed preference');},
 p=>{p.after.tokenClock=null;},p=>{p.after.fingerprints.ApiToken.hash=h('incoherent token table');},p=>{p.after.tokenClock.stable.hash=h('token revoked');},p=>{p.after.org.other.hash=h('changed nonbot setting');},p=>{p.after.org.bot.stableHash=h('changed bot label');},p=>{p.after.org.bot.updatedAt='2026-10-08T23:59:59.000Z';},p=>{p.after.org.bot.updatedAt='2026-10-09T00:21:00.000Z';},p=>{p.after.fingerprints.OrgSetting.hash=h('unexplained whole table drift');},
])test('original source guard refuses missing/extra/schema/financial/reference/pref/unknown-clock drift '+mutate.toString(),()=>{const p=originalPair();mutate(p);assert.throws(()=>compareOriginal(p.before,p.after));});

test('actual graph producer payloads use generated Prisma model fields/defaults; Payment.paidAt is required by the real SDK contract',async()=>{
 const f=ownedGraphFixture();f.p.numberInt=9999;f.p.articleCode=9999;const calls=[];
 const tx=Object.fromEntries(Prisma.dmmf.datamodel.models.map(model=>[model.name[0].toLowerCase()+model.name.slice(1),{create:async({data})=>{
  calls.push({model:model.name,data});const fields=new Map(model.fields.map(field=>[field.name,field]));
  assert.ok(Object.keys(data).every(key=>fields.has(key)),model.name+' contains unknown Prisma field');
  for(const field of model.fields)if(field.kind!=='object'&&field.isRequired&&!field.hasDefaultValue&&!field.isUpdatedAt)assert.ok(data[field.name]!==undefined,model.name+'.'+field.name+' missing required field');
  return data;
 }}]));
 await createOwnGraph(tx,f.p);assert.equal(calls.length,11);const payments=calls.filter(call=>call.model==='Payment');assert.equal(payments.length,2);assert.ok(payments.every(call=>call.data.paidAt instanceof Date&&call.data.paidAt.toISOString().slice(0,10)===f.p.financeDate&&!Object.hasOwn(call.data,'date')));
 const model=Prisma.dmmf.datamodel.models.find(model=>model.name==='Payment');assert.ok(model.fields.some(field=>field.name==='paidAt'));assert.ok(!model.fields.some(field=>field.name==='date'));
 await assert.rejects(()=>tx.payment.create({data:{date:new Date('2026-10-09T12:00:00.000Z')}}),/Payment contains unknown Prisma field/);
});

test('native lifecycle prerequisite is import-inert and rejects stage/production/nonlocal/schema overrides before any client; execution is Root-only',()=>{
 const env={CRM_MODERNIZATION_TARGET:'local',DATABASE_URL:'postgresql://synthetic:synthetic@127.0.0.1:5433/pero_crm'};assert.equal(lifecycleNativeGuard(env,'win32'),true);
 for(const patch of [{CRM_MODERNIZATION_TARGET:'staging'},{CRM_MODERNIZATION_TARGET:'production'},{DATABASE_URL:'postgresql://synthetic:synthetic@remote:5433/pero_crm'},{DATABASE_URL:'postgresql://synthetic:synthetic@localhost:5432/pero_crm'},{DATABASE_URL:'postgresql://synthetic:synthetic@localhost:5433/crm'},{DATABASE_URL:env.DATABASE_URL+'?schema=private'},{DATABASE_URL:env.DATABASE_URL+'?unknown=yes'}])assert.throws(()=>lifecycleNativeGuard({...env,...patch},'win32'));assert.throws(()=>lifecycleNativeGuard(env,'linux'));
 const source=readFileSync(new URL('./file-fixture113-lifecycle-native.mjs',import.meta.url),'utf8');assert.match(source,/EXPECTED_NATIVE113_LIFECYCLE_ROLLBACK/);assert.match(source,/await createOwnGraph\(tx,p\)/);assert.match(source,/await ownState\(tx,/);assert.match(source,/await lockOwned\(tx,state\)/);assert.match(source,/await deleteOwnedRows\(tx,state\)/);assert.doesNotMatch(source,/\.send\(|\bfetch\(|ALTER TABLE|migrate deploy|VersionId:/);
});

test('private actual manifest yields only unique public signed descriptor, normalizes src prefix BEFORE HMAC and never exports key/modules/raw manifest',()=>{
 const raw=Buffer.from(JSON.stringify(deleteManifestFixture())),meta=publicDeleteMetadata(raw,revision);assert.equal(validateCompiledDeleteDescriptor(meta.compiledDeleteFile,revision),meta.compiledDeleteFile);
 assert.deepEqual(Object.keys(meta).sort(),['actionManifestHash','compiledDeleteFile','compiledDeleteFileHash','rawManifestSha256']);assert.equal(meta.compiledDeleteFile.source,'src/server/files/actions.ts');assert.deepEqual(meta.compiledDeleteFile.routes,['/products/[id]','/projects/[id]']);assert.equal(meta.compiledDeleteFileHash,digest(meta.compiledDeleteFile));
 assert.doesNotMatch(JSON.stringify(meta),/SYNTHETIC_PRIVATE_TEST_ONLY_KEY|encryptionKey|moduleId|action-browser|workers|"node"/);
 const prefixed=deleteManifestFixture();prefixed.node['a'.repeat(42)].filename='src/server/files/actions.ts';assert.equal(publicDeleteMetadata(Buffer.from(JSON.stringify(prefixed)),revision).compiledDeleteFile.source,'src/server/files/actions.ts');
 const whitespace=publicDeleteMetadata(Buffer.from(JSON.stringify(deleteManifestFixture(),null,2)),revision);assert.equal(whitespace.actionManifestHash,meta.actionManifestHash);assert.notEqual(whitespace.rawManifestSha256,meta.rawManifestSha256);
 const extra=deleteManifestFixture();extra.node['a'.repeat(42)].workers['app/(app)/finance/page']={moduleId:999,async:false};assert.deepEqual(publicDeleteMetadata(Buffer.from(JSON.stringify(extra)),revision).compiledDeleteFile.routes,meta.compiledDeleteFile.routes);
 const signedHandoff=signed({namespace:NS,version:2,kind:'handoff',runId,revision,...meta},secret);assert.throws(()=>verifySignedFixture({...signedHandoff,compiledDeleteFile:{...meta.compiledDeleteFile,id:'b'.repeat(42)}},secret,'handoff',{runId}));
});
for(const mutate of [
 m=>{m.node={};},m=>{m.node['b'.repeat(42)]=structuredClone(m.node['a'.repeat(42)]);},m=>{m.node['short']=m.node['a'.repeat(42)];delete m.node['a'.repeat(42)];},m=>{m.node['a'.repeat(42)].filename='unreviewed/src/server/files/actions.ts';},m=>{m.node['a'.repeat(42)].filename='../src/server/files/actions.ts';},m=>{delete m.node['a'.repeat(42)].workers['app/(app)/products/[id]/page'];},m=>{m.node['a'.repeat(42)].layer['app/(app)/projects/[id]/page']='unreviewed-layer';},m=>{m.node['a'.repeat(42)].workers['app/(app)/projects/[id]/page']=null;},
])test('private manifest extraction rejects missing/ambiguous/invalid export source or actual route worker '+mutate.toString(),()=>{const m=deleteManifestFixture();mutate(m);assert.throws(()=>publicDeleteMetadata(Buffer.from(JSON.stringify(m)),revision));});
for(const patch of [
 {id:'b'.repeat(40)},{source:'server/files/actions.ts'},{routes:['/projects/[id]']},{revision:'b'.repeat(40)},{encryptionKey:'MUST_NEVER_BE_PUBLIC'},
])test('public descriptor rejects foreign revision/source/route/ID or extra key '+JSON.stringify(patch),()=>{const meta=publicMetadata();assert.throws(()=>validateCompiledDeleteDescriptor({...meta.compiledDeleteFile,...patch},revision));});
test('invalid private manifest JSON diagnostics cannot echo raw secret or body',()=>{
 assert.throws(()=>publicDeleteMetadata(Buffer.from('{"encryptionKey":"SYNTHETIC_PRIVATE_TEST_ONLY_KEY" broken'),revision),error=>error.message==='PRIVATE_SERVER_MANIFEST_INVALID_JSON');
});

test('private publisher refuses nested full-manifest encryption key before any artifact bytes are written',()=>{
 const out=fileURLToPath(new URL('../test-results/forbidden-private-manifest-'+randomUUID()+'.json',import.meta.url));assert.throws(()=>immutablePublish(out,{manifest:deleteManifestFixture()}),/CREDENTIALS_MUST_REMAIN_MEMORY/);
});

// V6: genuine offline Auth.js decode proves both request protocols; no live profiles or requests.
test('fresh-only cookie issuer signs each namespace with its own salt for all own actors',async()=>{
 const p=plan(),calls=[];const profiles=await fixtureCookieProfiles(p,secret,async args=>{calls.push(args);return 'synthetic-token-'+args.token.id+'-'+args.salt;});
 assert.equal(calls.length,6);assert.deepEqual(Object.keys(profiles).sort(),['admin','engineer','manager']);
 for(const[key,actor]of Object.entries(p.actors)){
  assert.equal(profiles[key].id,actor.id);assert.deepEqual(profiles[key].roles,actor.roles);
  assert.deepEqual(profiles[key].cookies.map(row=>row.name),['__Secure-authjs.session-token','authjs.session-token']);
  for(const cookie of profiles[key].cookies){const call=calls.find(item=>item.token.id===actor.id&&item.salt===cookie.name);assert.equal(call.secret,secret);assert.equal(call.maxAge,1800);assert.equal(call.token.sessionVersion,0);assert.equal(call.token.sub,actor.id);assert.equal(cookie.domain,'staging-crm.peromebel.by');assert.equal(cookie.path,'/');assert.equal(cookie.secure,true);assert.equal(cookie.httpOnly,true);assert.equal(cookie.sameSite,'Lax');}
 }
});
test('actual Auth.js accepts the fresh issuer on HTTP and HTTPS; cross-namespace salt cannot decrypt',async()=>{
 const {Auth}=await import('@auth/core'),{decode}=await import('@auth/core/jwt'),p=plan(),profiles=await fixtureCookieProfiles(p,secret);
 for(const[key,actor]of Object.entries(p.actors))for(const protocol of ['http:','https:']){
  const profile=profiles[key],cookie=profile.cookies.map(row=>row.name+'='+row.value).join('; ');
  const response=await Auth(new Request(protocol+'//qa.invalid/api/auth/session',{headers:{cookie}}),{secret,trustHost:true,basePath:'/api/auth',providers:[],session:{strategy:'jwt'},callbacks:{jwt:async({token})=>{assert.equal(token.id,actor.id);assert.equal(token.sessionVersion,0);return token;},session:async({token})=>({user:{id:token.id,roles:token.roles}})},logger:{error(){},warn(){},debug(){}}});
  assert.equal(response.status,200);const body=await response.json();assert.equal(body.user.id,actor.id);assert.deepEqual(body.user.roles,actor.roles);
 }
 const admin=profiles.admin.cookies;for(const row of admin){const other=admin.find(item=>item.name!==row.name);await assert.rejects(()=>decode({token:row.value,secret,salt:other.name}));}
});
test('cookie issuer rejects foreign/invalid actor scope and empty or oversized encoder output before use',async()=>{
 for(const patch of [p=>{p.originalUsersReused=true;},p=>{p.actors.admin.passwordHash='foreign-original';},p=>{p.actors.engineer.roles=['ADMIN'];}]){const p=plan();patch(p);await assert.rejects(()=>fixtureCookieProfiles(p,secret));}
 for(const value of ['',null,'x'.repeat(8193)])await assert.rejects(()=>fixtureCookieProfiles(plan(),secret,async()=>value),/BOUNDED_PRIVATE_COOKIE_REQUIRED/);
});
test('safe upload diagnostics retain actual status and only closed codes/phases without body or headers',()=>{
 const response={status:401,headers:{'set-cookie':'PRIVATE_COOKIE'}},body={ok:false,code:'UPLOAD_HTTP_401',kind:'validation',details:{phase:'auth',message:'PRIVATE_MESSAGE'},error:'PRIVATE_EMAIL',requestId:'PRIVATE_ID',user:{id:'PRIVATE_USER'}};
 const diag=safeFixtureUploadDiagnostic(response,body);assert.deepEqual(diag,{httpStatus:401,replyShape:'json-object',ok:false,code:'UPLOAD_HTTP_401',kind:'validation',phase:'auth',commitState:null});assert.doesNotMatch(JSON.stringify(diag),/PRIVATE|user|requestId|headers|message/);
 const unknown=safeFixtureUploadDiagnostic({status:599},{ok:'PRIVATE',code:'PRIVATE_ACCOUNT_ID',kind:'PRIVATE_KIND',details:{phase:'PRIVATE_PHASE'},commitState:'PRIVATE_STATE'});assert.deepEqual(unknown,{httpStatus:599,replyShape:'json-object',ok:null,code:null,kind:null,phase:null,commitState:null});
 const storage=safeFixtureUploadDiagnostic({status:503},{ok:false,code:'STORAGE_TIMEOUT',kind:'failure',details:{phase:'storage-original'},commitState:'notCommitted'});assert.equal(storage.code,'STORAGE_TIMEOUT');assert.equal(storage.phase,'storage-original');assert.equal(storage.commitState,'notCommitted');
 assert.equal(safeFixtureUploadDiagnostic({status:'PRIVATE'},null,'PRIVATE_SHAPE').httpStatus,null);assert.equal(safeFixtureUploadDiagnostic({status:200},null,'PRIVATE_SHAPE').replyShape,'unknown');
});
test('bounded upload reply reads the genuine DTO and refuses malformed/array/large replies without leaking JSON text',async()=>{
 const good={ok:true,id:'own-file',sketchFileId:'own-file'},actual=await readFixtureUploadReply(Response.json(good));assert.deepEqual(actual,good);
 for(const[value,shape]of [['PRIVATE_SECRET broken','non-json'],['null','json-null'],['[]','json-array'],['"PRIVATE_SECRET"','json-string'],['7','json-number'],['true','json-boolean']]){
  await assert.rejects(()=>readFixtureUploadReply(new Response(value,{status:401})),error=>error instanceof FixtureUploadResponseError&&error.message==='COMPILED_OWN_UPLOAD_UNCONFIRMED'&&error.diagnostic.httpStatus===401&&error.diagnostic.replyShape===shape&&!JSON.stringify(error.diagnostic).includes('PRIVATE'));
 }
 let cancelled=false;const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(16*1024+1));},cancel(){cancelled=true;}});
 await assert.rejects(()=>readFixtureUploadReply(new Response(stream,{status:500})),error=>error instanceof FixtureUploadResponseError&&error.diagnostic.replyShape==='body-too-large'&&error.diagnostic.httpStatus===500);assert.equal(cancelled,true);
 const failed=new ReadableStream({start(controller){controller.error(Error('PRIVATE_READ_ERROR'));}});await assert.rejects(()=>readFixtureUploadReply(new Response(failed,{status:503})),error=>error instanceof FixtureUploadResponseError&&error.diagnostic.replyShape==='body-read-failed'&&!JSON.stringify(error.diagnostic).includes('PRIVATE'));
});
test('typed upload failure keeps the generic Error message and sanitizes attacker-controlled diagnostic fields',()=>{
 const error=new FixtureUploadResponseError({status:422},{ok:false,code:'UPLOAD_FORM_OUTDATED',kind:'validation',details:{phase:'request'},commitState:'notCommitted',error:'PRIVATE_USER_DATA'});assert.equal(error.message,'COMPILED_OWN_UPLOAD_UNCONFIRMED');assert.equal(error.diagnostic.code,'UPLOAD_FORM_OUTDATED');assert.doesNotMatch(JSON.stringify(error.diagnostic),/PRIVATE_USER_DATA/);
 const entry=readFileSync(new URL('./file-fixture113-entry.mjs',import.meta.url),'utf8');assert.match(entry,/error instanceof FixtureUploadResponseError/);assert.match(entry,/await readFixtureUploadReply\(response\)/);assert.doesNotMatch(entry,/const result=await response\.json\(\);need\(\(response\.status/);
});
test('actual existing fail-closed transport retains the bounded diagnosis on nonzero exit without emitting private body',async()=>{
 const {createRequire,syncBuiltinESMExports}=await import('node:module'),{EventEmitter}=await import('node:events'),{qaTransport}=await import('./crm-acceptance-transport.mjs');
 const require=createRequire(import.meta.url),childProcess=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
 const outputDir=fs.mkdtempSync(fileURLToPath(new URL('../test-results/v6-transport-',import.meta.url))),wrapper=fileURLToPath(new URL('../../../deploy/acceptance/crm-modernization-staging.py',import.meta.url)),wrapperHash=h(fs.readFileSync(wrapper));
 const diagnostic=safeFixtureUploadDiagnostic({status:401},{ok:false,code:'UPLOAD_HTTP_401',kind:'validation',details:{phase:'auth'},error:'PRIVATE_SECRET'}),code=fixtureUploadStopCode(diagnostic),commands=[];
 assert.equal(code,'FILE_QA_HTTP_401_UPLOAD_HTTP_401_AUTH_JSON_OBJECT');assert.match(code,/^[A-Z0-9_]{1,100}$/);assert.doesNotMatch(fixtureUploadStopCode({httpStatus:'PRIVATE',code:'PRIVATE_SECRET',phase:'PRIVATE_PHASE',replyShape:'PRIVATE_SHAPE'}),/PRIVATE/);
 const previousSpawn=childProcess.spawn;
 childProcess.spawn=(command,args)=>{
  const proc=new EventEmitter();proc.stdout=new EventEmitter();proc.stderr=new EventEmitter();proc.stdin=new EventEmitter();commands.push(command);
  proc.stdin.end=()=>queueMicrotask(()=>{const stdout=command==='scp'?'':args.includes('sha256sum')?wrapperHash+'  synthetic-wrapper.py\n':JSON.stringify({identity:{hostname:'crm-staging',revision},operation:'prepare',exitCode:1,result:{status:'STOP',phase:'upload',code,upload:diagnostic}});proc.stdout.emit('data',Buffer.from(stdout));proc.emit('close',commands.length===3?1:0);});return proc;
 };
 syncBuiltinESMExports();
 try{await assert.rejects(()=>qaTransport({target:'staging',revision,outputDir}).execute(Buffer.from('/* synthetic inert bundle */'),'prepare',{authorized:true}),error=>error.message===code&&!error.message.includes('PRIVATE'));assert.deepEqual(commands,['scp','ssh','ssh']);const saved=fs.readFileSync(path.join(outputDir,'transport-prepare-upload.stderr.private.log'),'utf8');assert.equal(saved,'');}
 finally{childProcess.spawn=previousSpawn;syncBuiltinESMExports();}
});