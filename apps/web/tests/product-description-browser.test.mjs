import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DESCRIPTION_LF,descriptionPatchOwned,descriptionBrowserValue,descriptionPrivateDiagnostic,descriptionCapturedWrite} from './product-description-browser.mjs';
import {descriptionMutationIds} from './product-description-stage-runner.mjs';
import {runCrmBrowserZoom} from './crm-browser-zoom.mjs';
const fixture={ids:{productA:'own-a',productB:'own-b'},actors:{admin:{id:'a'},manager:{id:'m'},engineer:{id:'e'}}};
const id='b5428289-23f7-4e42-a967-212da990d141';
const patch={productId:'own-a',field:'description',value:DESCRIPTION_LF,expectedValue:' \t\r\n\r\n',clientMutationId:id};
test('description request guard is closed, exact raw baseline and owned IDs only',()=>{
 assert.equal(descriptionPatchOwned(patch,fixture),true);assert.equal(patch.value.startsWith('  '),true);assert.equal(patch.value.endsWith('\n\n'),true);assert.ok(patch.value.includes('\t'));assert.equal(patch.expectedValue,' \t\r\n\r\n');
 for(const input of [null,[],{...patch,productId:'foreign'},{...patch,field:'title'},{...patch,initialPrice:'0'},{...patch,clientMutationId:undefined},{...patch,expectedValue:1}])assert.equal(descriptionPatchOwned(input,fixture),false);
});
test('description coordinator IDs come only from captured allowed actor/field receipts, excluding no-op',()=>{
 const row={actorId:'m',productId:'own-a',field:'description',clientMutationId:id};const journal={ownWrites:[row,{...row,noOp:true}],preferenceOwnWrites:[{userId:'a',key:'product.tab',value:'overview'}]};assert.deepEqual(descriptionMutationIds(fixture,journal),[id]);
 for(const bad of [{...row,actorId:'foreign'},{...row,productId:'foreign'},{...row,field:'title'},{...row,clientMutationId:'guess'}])assert.throws(()=>descriptionMutationIds(fixture,{ownWrites:[bad]}),/SCOPE_STOP/);
 assert.throws(()=>descriptionMutationIds(fixture,{ownWrites:[],preferenceOwnWrites:[{userId:'a',key:'payroll.currency',value:'USD'}]}),/PREFERENCE_SCOPE_STOP/);
});
test('description zoom guards reject invalid mode/selector/ID/journal before any browser launch',async()=>{
 const args={origin:'http://127.0.0.1:3019',pagePath:'/products/own-a',ownedProductPaths:['/products/own-a'],readySelector:'#product-inline-description',descriptionMode:{productId:id},onOwnWrites:async()=>{},profile:{roles:['ADMIN'],cookies:[{name:'not-a-live-cookie',value:'test'}]},outputDir:'not-used-before-guard'};
 await assert.rejects(runCrmBrowserZoom({...args,descriptionMode:null}),/DESCRIPTION19_ZOOM_MODE_REQUIRED/);await assert.rejects(runCrmBrowserZoom({...args,descriptionMode:{productId:'foreign'}}),/OWNED_PRODUCT_REQUIRED/);await assert.rejects(runCrmBrowserZoom({...args,readySelector:'#product-inline-title'}),/DESCRIPTION_ZOOM_SELECTOR_REQUIRED/);await assert.rejects(runCrmBrowserZoom({...args,onOwnWrites:undefined}),/PREFERENCE_JOURNAL_REQUIRED/);
});


test('browser expected-value helper normalizes real CRLF while retaining literal backslash sequences',()=>{
 assert.equal(descriptionBrowserValue(' \t\r\n\r\n'),' \t\n\n');assert.equal(descriptionBrowserValue(String.raw`text\r\n`),String.raw`text\r\n`);
});
test('private diagnostic preserves actionable failure detail while redacting tokens and URL credentials',()=>{
 const detail=descriptionPrivateDiagnostic({message:'Timeout waiting for textarea Bearer test-secret-token https://user:password@qa.test',stack:'trace pero_abcdefghijklmnopqrstuvwxyz0123456789'});assert.match(detail.message,/Timeout waiting for textarea/);assert.doesNotMatch(detail.message,/test-secret-token|password/);assert.doesNotMatch(detail.stack,/abcdefghijklmnopqrstuvwxyz/);
});


test('capture matcher never borrows a preceding other-product response when the current field is a no-op',()=>{
 const make=(productId,value,actorId='a',clientMutationId=id)=>({type:'description',actorId,phase:'response-captured',request:{productId,field:'description',value,clientMutationId},result:{kind:'saved',field:'description',value,clientMutationId}});
 const previous=make('own-a','literal long text');assert.equal(descriptionCapturedWrite([previous],{from:1,actorId:'a',productId:'own-b',value:null}),undefined);assert.equal(descriptionCapturedWrite([previous],{actorId:'a',productId:'own-b',value:null}),undefined);
 const cleared=make('own-b',null);assert.equal(descriptionCapturedWrite([previous,cleared],{from:1,actorId:'a',productId:'own-b',value:null}),cleared);assert.equal(descriptionCapturedWrite([cleared],{actorId:'other',productId:'own-b',value:null}),undefined);
 assert.equal(descriptionCapturedWrite([{...cleared,result:{...cleared.result,clientMutationId:'foreign'}}],{actorId:'a',productId:'own-b',value:null}),undefined);
});

test('blocked diagnostic records only argument shape and action hash, never unknown body values', async()=>{
 const {descriptionBlockedRequestDiagnostic}=await import('./product-description-browser.mjs');
 const action='raw-next-action-secret';
 const detail=descriptionBlockedRequestDiagnostic({method:'POST',path:'/__nextjs_error_feedback',action,args:[{password:'secret-value',cookie:'secret-cookie',nested:{token:'secret-token'}},'unowned-body']});
 assert.equal(detail.method,'POST');assert.equal(detail.path,'/__nextjs_error_feedback');assert.equal(detail.actionHash.length,64);assert.equal(detail.argsShape.length,2);
 const serialized=JSON.stringify(detail);for(const secret of [action,'secret-value','secret-cookie','secret-token','unowned-body'])assert.ok(!serialized.includes(secret));
 assert.deepEqual(detail.argsShape.items[0].keys,['cookie','nested','password']);
});

test('DEV private hydration diagnostic preserves full React diff while redacting credentials',()=>{
 const full='Hydration failed '+ 'x'.repeat(7000)+' https://name:secret@local.test';
 const detail=descriptionPrivateDiagnostic({message:full},{fullMessage:true});
 assert.ok(detail.message.length>7000);assert.doesNotMatch(detail.message,/name:secret/);
});

test('description acceptance pins real Chromium new headless and does not expose caller launch overrides',async()=>{
 const {DESCRIPTION_BROWSER_LAUNCH}=await import('./product-description-browser.mjs');
 assert.deepEqual(DESCRIPTION_BROWSER_LAUNCH,{headless:true,channel:'chromium'});
 assert.ok(Object.isFrozen(DESCRIPTION_BROWSER_LAUNCH));
 assert.throws(()=>{DESCRIPTION_BROWSER_LAUNCH.channel='chrome'});
});
