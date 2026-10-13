import assert from 'node:assert/strict';
import {test} from 'node:test';
import {correctionProductActionOwned,correctionClientInputOwned,correctionProductListPreferenceOwned,correctionRecoveryAllowed,deriveCorrectionAck,finalUploadOwned,runUiCorrectionsBrowser} from './ui-corrections-browser.mjs';
import {createHash} from 'node:crypto';
import {finalQaMedia,finalFileId,finalFullscreenVisible} from './ui-corrections-browser.mjs';
import {correctionJournalScope} from './ui-corrections-stage-runner.mjs';
const id='00000000-0000-4000-8000-000000000001';
const fixture={checkpoint:{runId:id,correctionMode:true},numbers:{productA:'1.1',productB:'1.2'},ids:{project:'p',productA:'a',productB:'b',clientA:'ca',clientB:'cb'},paths:{productA:'/products/1.1',productB:'/products/1.2',project:'/projects/p'},actors:{admin:{id:'admin',roles:['ADMIN']},engineer:{id:'engineer',roles:['ENGINEER']}}};
test('products.list requires signed correction scope, exact owned kanban query and genuine baseline',()=>{
 const scope={namespace:'PERO_PRODUCT_ATTACHMENTS_SESSION_V1',correctionMode:true,signature:'a'.repeat(64),originalPreferences:[{userId:'admin',key:'products.list',value:'old'}]},args=['products','view=kanban&q=1.1','old'];
 assert.equal(correctionProductListPreferenceOwned(args,fixture,'admin',scope),true);
 for(const [request,actor,cp] of [[args,'admin',{...scope,correctionMode:undefined}],[args,'admin',{...scope,originalPreferences:[]}],[args,'engineer',scope],[['products','view=kanban&q=foreign','old'],'admin',scope],[['products','view=kanban&q=1.1','invented'],'admin',scope]])assert.equal(correctionProductListPreferenceOwned(request,fixture,actor,cp),false);
 assert.equal(correctionProductListPreferenceOwned(['products','view=kanban&q=1.1','known ACK'],fixture,'admin',scope,[{userId:'admin',key:'products.list',value:'known ACK'}]),true);
});
test('preserved recovery requires sole blocked no-upstream export plus signed seven-file client readback',()=>{
 const blocked={type:'blocked',method:'POST',path:'/products',actorId:'admin',argsShape:{length:3,types:['string','string','string']},actionHash:'b'.repeat(64)};
 const uploads=Array.from({length:7},(_,i)=>({type:'file-upload',phase:'response-captured',httpStatus:200,result:{ok:true,id:`file-${i}`}}));const journal={requests:[...uploads,blocked],pageErrors:[]};
 const proof={registeredActionExport:'saveListPreference',actionHash:blocked.actionHash,requestJournalHash:createHash('sha256').update(JSON.stringify(journal.requests)).digest('hex'),fileObservation:{runId:id,mode:'files',signature:'c'.repeat(64),files:uploads.map(row=>({id:row.result.id}))}};
 assert.equal(correctionRecoveryAllowed(journal,fixture,proof),true);assert.equal(correctionRecoveryAllowed(journal,fixture,{...proof,fileObservation:null}),false);assert.equal(correctionRecoveryAllowed(journal,fixture,{...proof,registeredActionExport:'changeProductStatus'}),false);
 for(const row of [{...blocked,responseMetadata:{}},{...blocked,httpStatus:200},{...blocked,path:'/foreign'}]){const changed={...journal,requests:[...uploads,row]};const p={...proof,requestJournalHash:createHash('sha256').update(JSON.stringify(changed.requests)).digest('hex')};assert.equal(correctionRecoveryAllowed(changed,fixture,p),false);}
});
test('decoded Action ACK authorizes captured client CAS only after journal update; status uses backward-only actor/product',()=>{
 const journal={extraClientWrites:[],statusWrites:[]},input={name:`QA33-${id}`,phone:'10033',address:'QA33 address'};
 const cas={productId:'a',field:'project.clientId',value:id,expectedValue:'ca',clientMutationId:id};
 assert.equal(correctionProductActionOwned(cas,fixture,fixture.paths.productA,journal.extraClientWrites),null);
 Object.assign(journal,deriveCorrectionAck('client-create',{ok:true,id},fixture,'admin',input,journal));
 assert.equal(correctionProductActionOwned(cas,fixture,fixture.paths.productA,journal.extraClientWrites),'scalar');assert.deepEqual(journal.extraClientWrites,[{actorId:'admin',id,input,saved:true}]);
 assert.throws(()=>deriveCorrectionAck('client-create',{ok:true,id},fixture,'admin',input,journal),/ONE_CLIENT_STOP/);
 Object.assign(journal,deriveCorrectionAck('status-back',{ok:true},fixture,'engineer',{productId:'b',toStatus:'DESIGN'},journal));assert.deepEqual(journal.statusWrites,[{ok:true,actorId:'engineer',productId:'b',fromStatus:'PRODUCTION',toStatus:'DESIGN'}]);
 assert.throws(()=>deriveCorrectionAck('status-back',{ok:true},fixture,'admin',{productId:'b',toStatus:'DESIGN'},{statusWrites:[],extraClientWrites:[]}),/BACK_ACTOR_STOP/);
 assert.throws(()=>deriveCorrectionAck('status-back',{ok:true},fixture,'engineer',{productId:'b',toStatus:'DONE'},{statusWrites:[],extraClientWrites:[]}),/BACK_TARGET_STOP/);
 assert.deepEqual(deriveCorrectionAck('retired-contact',{kind:'validation'},fixture,'admin',{},journal),{});assert.throws(()=>deriveCorrectionAck('retired-contact',{kind:'saved'},fixture,'admin',{},journal),/RETIRED_CONTACT_WRITER_STOP/);
 assert.deepEqual(deriveCorrectionAck('file-upload',{ok:true,id},fixture,undefined,undefined,journal),{});
 assert.throws(()=>deriveCorrectionAck('client-create',{id},fixture,'admin',input,{extraClientWrites:[],statusWrites:[]}),/ACK_BOOLEAN_STOP/);
});
test('closed scalar seven excludes retired contact/status/money writers, permits only captured extra client',()=>{
 const patch={productId:'a',field:'quantity',value:3,expectedValue:1,clientMutationId:id};assert.equal(correctionProductActionOwned(patch,fixture,fixture.paths.productA),'scalar');
 for(const change of [{productId:'foreign'},{clientMutationId:'guess'}])assert.equal(correctionProductActionOwned({...patch,...change},fixture,fixture.paths.productA),null);
 assert.equal(correctionProductActionOwned({...patch,kind:'ASSEMBLY',field:'assigneeId',value:'foreign',expectedValue:null,expectedRevision:0},fixture,fixture.paths.productA),null);
 for(const field of ['client.phone','project.address','initialPrice','status'])assert.equal(correctionProductActionOwned({...patch,field},fixture,fixture.paths.productA),null);
 assert.equal(correctionProductActionOwned({...patch,field:'project.clientId',value:id},fixture,fixture.paths.productA),null);assert.equal(correctionProductActionOwned({...patch,field:'project.clientId',value:id},fixture,fixture.paths.productA,[{id}]),'scalar');
 assert.equal(correctionProductActionOwned({...patch,kind:'ASSEMBLY',field:'ratePercent',value:'0',expectedValue:null,expectedRevision:0},fixture,fixture.paths.productA),'percentage');
});
test('one captured bounded new-client and backward-only status journal; no arbitrary clients or forward financial writes',()=>{
 const input={name:`QA33-${id}`,phone:'10033',address:'QA address'};assert.equal(correctionClientInputOwned(input,fixture),true);for(const change of [{name:'foreign'},{phone:''},{address:''},{legacyId:'foreign'}])assert.equal(correctionClientInputOwned({...input,...change},fixture),false);
 const base={ownWrites:[],preferenceOwnWrites:[],extraClientWrites:[{actorId:'admin',id,input,saved:true}],statusWrites:[{ok:true,actorId:'engineer',productId:'b',fromStatus:'PRODUCTION',toStatus:'DESIGN'}]};assert.equal(correctionJournalScope(fixture,base).extraClientWrites.length,1);
 for(const change of [{extraClientWrites:[...base.extraClientWrites,...base.extraClientWrites]},{extraClientWrites:[{...base.extraClientWrites[0],id:'foreign'}]},{statusWrites:[{...base.statusWrites[0],toStatus:'DONE'}]},{statusWrites:[{...base.statusWrites[0],productId:'a'}]}])assert.throws(()=>correctionJournalScope(fixture,{...base,...change}),/STOP/);
});
test('all seven exact-byte uploads exclude caption and context substitutions',async()=>{
 const cases=await finalQaMedia(fixture);assert.equal(cases.length,7);const row=cases.find(item=>item.key==='measurement'),file={name:row.name,mimeType:row.mimeType,size:row.buffer.length,hash:row.hash},fields={projectId:'p',productId:'a',section:row.section,clientMutationId:id};assert.equal(finalUploadOwned(fields,file,fixture,cases),true);assert.equal(finalUploadOwned({...fields,caption:'any'},file,fixture,cases),false);assert.equal(finalUploadOwned({...fields,projectId:'foreign'},file,fixture,cases),false);
 const cover=cases.find(item=>item.cover),project=cases.find(item=>item.key==='project');
 const asFile=item=>({name:item.name,mimeType:item.mimeType,size:item.buffer.length,hash:item.hash});
 const coverFields={projectId:fixture.ids.project,productId:fixture.ids.productA,section:'PRODUCTION',assignCover:'1',expectedSketchFileId:'null',clientMutationId:id};
 assert.equal(finalUploadOwned(coverFields,asFile(cover),fixture,cases),true);assert.equal(finalUploadOwned({...coverFields,expectedSketchFileId:'old'},asFile(cover),fixture,cases),false);assert.equal(finalUploadOwned(coverFields,{...asFile(cover),hash:'forged'},fixture,cases),false);
 assert.equal(finalUploadOwned({projectId:fixture.ids.project,section:'GENERAL',clientMutationId:id},asFile(project),fixture,cases),true);assert.equal(finalUploadOwned({projectId:'foreign',section:'GENERAL',clientMutationId:id},asFile(project),fixture,cases),false);
});
test('import/default authorization never opens browser or database',async()=>{await assert.rejects(runUiCorrectionsBrowser({}),/EXECUTION_AUTH_REQUIRED/);});

test('actual generic File CUID and explicit cover UUID are accepted; arbitrary/traversal IDs remain rejected',async()=>{
 assert.equal(finalFileId('c'+'a'.repeat(24)),true);assert.equal(finalFileId(id),true);
 for(const value of [null,'foreign','c'+'a'.repeat(23),'../file','c'+ '/'.repeat(24)])assert.equal(finalFileId(value),false);
});

test('fullscreen capture requires loaded opaque modal covering viewport and actual hit-test ownership',async()=>{
 const ready={popup:{x:0,y:0,width:1440,height:900},viewport:{x:0,y:0,width:1440,height:900},imageLoaded:true,centerInside:true,opacity:1};
 assert.equal(finalFullscreenVisible(ready),true);
 for(const change of [{imageLoaded:false},{centerInside:false},{opacity:0},{popup:{...ready.popup,y:900}},{popup:{...ready.popup,width:400}}])assert.equal(finalFullscreenVisible({...ready,...change}),false);
});

const upload={type:'file-upload',actorId:'admin',projectId:fixture.ids.project,productId:null,fileId:'file',saved:true};
const journal=ownWrites=>({ownWrites,preferenceOwnWrites:[],extraClientWrites:[],statusWrites:[]});
test('flat own project upload/delete is bounded to its captured file subject',()=>{
 assert.deepEqual(correctionJournalScope(fixture,journal([upload,{...upload,type:'file-delete'}])).mutationIds,[]);
 assert.throws(()=>correctionJournalScope(fixture,journal([{...upload,type:'file-delete',fileId:'unknown'}])),/DELETE_WITHOUT_CAPTURED_UPLOAD/);
});
test('unknown project file is rejected before inspection or cleanup',()=>{
 assert.throws(()=>correctionJournalScope(fixture,journal([{...upload,projectId:'foreign'}])),/SUBJECT_STOP/);
 assert.throws(()=>correctionJournalScope(fixture,journal([{...upload,productId:'a',projectId:'foreign'}])),/FILE_SCOPE_STOP/);
});
test('project scope never permits scalar or percentage writers without an owned product',()=>{
 assert.throws(()=>correctionJournalScope(fixture,journal([{...upload,type:'field',field:'title'}])),/SUBJECT_STOP/);
 assert.throws(()=>correctionJournalScope(fixture,journal([{...upload,type:'percentage'}])),/SUBJECT_STOP/);
});
