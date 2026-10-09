import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyDraftQaAction} from './product-draft-stage-browser.mjs';
const scope={actorId:'own-manager',clientId:'own-client',tags:{projectA:'QA111 primary run',products:['QA111 product run 01']},projectIds:new Set(['123','own-paused']),productIds:new Set(['own-product'])};
const project={title:scope.tags.projectA,clientId:scope.clientId,managerId:scope.actorId,address:'$undefined'};
const product={projectId:'123',title:scope.tags.products[0],kind:'$undefined',expectedPrice:0,quantity:1,description:'',engineerId:'$undefined'};
const stage={projectId:'123',toStage:'CONTRACT',expectedStage:'LEAD',clientMutationId:'80502171-fcf9-4189-a3f8-c8a77e94efad',extras:'$undefined'};
test('only exact owned project creation is accepted',()=>{
 assert.equal(classifyDraftQaAction([project],scope).kind,'project-create');
 for(const data of [{...project,clientId:'foreign'},{...project,managerId:'foreign'},{...project,title:'foreign'},{...project,address:'real unrelated address'}])assert.equal(classifyDraftQaAction([data],scope),null);
});
test('owned product creation has zero price single quantity and no assignment',()=>{
 assert.equal(classifyDraftQaAction([product],scope).kind,'product-create');
 for(const data of [{...product,projectId:'foreign'},{...product,title:'foreign'},{...product,expectedPrice:1},{...product,quantity:2},{...product,engineerId:'foreign'},{...product,description:'unexpected text'}])assert.equal(classifyDraftQaAction([data],scope),null);
});
test('non-completion owned stages require CAS UUID and closed extras',()=>{
 assert.equal(classifyDraftQaAction([stage],scope).kind,'project-stage');
 assert.equal(classifyDraftQaAction([{...stage,toStage:'IN_WORK'}],scope).kind,'project-stage');
 assert.equal(classifyDraftQaAction([{...stage,toStage:'REFUSED',extras:{refusalReason:'QA111 run'}}],scope).kind,'project-stage');
 for(const data of [{...stage,projectId:'foreign'},{...stage,toStage:'DONE'},{...stage,clientMutationId:'bad'},{...stage,extras:{unexpected:1}},{...stage,toStage:'REFUSED',extras:{refusalReason:'foreign'}}])assert.equal(classifyDraftQaAction([data],scope),null);
});
test('status changes cannot touch original products or completion states',()=>{
 assert.equal(classifyDraftQaAction(['own-product','DESIGN'],scope).kind,'product-status');
 assert.equal(classifyDraftQaAction(['own-product','PREPARATION'],scope).kind,'product-status');
 for(const args of [['foreign','PREPARATION'],['own-product','DONE'],['own-product','PRODUCTION'],['own-product','DESIGN','unexpected']])assert.equal(classifyDraftQaAction(args,scope),null);
});
test('preference writes are restricted to exact two new-user sections',()=>{
 assert.equal(classifyDraftQaAction(['projects','view=kanban',null],scope).key,'projects.list');
 assert.equal(classifyDraftQaAction(['products','view=kanban','last-ack'],scope).key,'products.list');
 for(const args of [['my','view=kanban',null],['project.tab','products',null],['products','x'.repeat(32769),null],['projects',{},null]])assert.equal(classifyDraftQaAction(args,scope),null);
});
test('arbitrary or malformed action payloads are never accepted',()=>{for(const data of [null,{},'arbitrary',[],[{}],[project,product]])assert.equal(classifyDraftQaAction(data,scope),null);});

import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {mkdirSync,readdirSync,unlinkSync,rmdirSync} from 'node:fs';
import {runProductDraftStageBrowser} from './product-draft-stage-browser.mjs';
import {makeTechnicalStore} from './product-draft-stage-runner.mjs';
import {assertTechnicalPersistence} from './product-draft-stage-wire.mjs';
import {acceptanceWeb} from './crm-acceptance-transport.mjs';
const fixture={runId:'80502171-fcf9-4189-a3f8-c8a77e94efad',revision:'a'.repeat(40),signature:'b'.repeat(64),pre:{ids:{actor:'own-manager',client:'own-client',projectB:'own-paused'},tags:{actor:'QA111 manager run',client:'QA111 client run',projectA:'QA111 primary run',products:Array.from({length:10},(_,i)=>'QA111 product run '+(i+1))}}};
function fakeBrowser({status=503,pageError,request,throwOnClick,closeThrows=false}={}){
 const handlers=new Map(),state={launches:0,captures:0,fetches:0,aborts:0,contextClosed:false,browserClosed:false},page={
  on:(event,fn)=>{handlers.set(event,fn);},
  locator:()=>({waitFor:async()=>{}}),
  getByRole:()=>({click:async()=>{throw throwOnClick??Error('private-unexpected-selector-message');}}),
  goto:async()=>{
   if(pageError)handlers.get('pageerror')(pageError);
   if(request){const route={request:()=>({url:()=>request.url,method:()=>request.method,headers:()=>request.headers,postData:()=>request.body}),abort:async()=>{state.aborts++;},fetch:async()=>{state.fetches++;throw Error('UNEXPECTED_LIVE_FETCH');},continue:async()=>{throw Error('UNEXPECTED_LIVE_CONTINUE');}};
    await state.route(route);
   }
   return {status:()=>status};
  },
 },context={addInitScript:async()=>{},addCookies:async()=>{},newPage:async()=>page,route:async(_pattern,fn)=>{state.route=fn;},request:{get:async()=>({status:()=>200,json:async()=>({user:{id:fixture.pre.ids.actor}})})},close:async()=>{state.contextClosed=true;if(closeThrows)throw Error('private-close-error');}},browser={newContext:async()=>context,close:async()=>{state.browserClosed=true;}};
 return {state,launchBrowser:async()=>{state.launches++;return browser;}};
}
async function controlledEarlyStop(control,callbackFailure=false){
 const directory=path.join(acceptanceWeb,'test-results','draft111-early-stop-pure-'+randomUUID());mkdirSync(directory,{recursive:true});const store=makeTechnicalStore(directory);
 try{
  const result=await runProductDraftStageBrowser({authorized:true,origin:'https://staging-crm.peromebel.by',revision:fixture.revision,profile:{id:fixture.pre.ids.actor,roles:['MANAGER'],cookies:[{name:'authjs.session-token',value:'unit-private-never-persisted'}]},checkpoint:fixture,outputDir:directory,launchBrowser:control.launchBrowser,onJournal:async journal=>{if(callbackFailure)throw Error('PRIVATE_DURABLE_ERROR');store.put('journal',journal);},observe:async()=>{control.state.captures++;throw Error('UNEXPECTED_READONLY_OBSERVE');}});
  assertTechnicalPersistence(result);store.put('browser-result',result);const saved=store.get('browser-result');
  assert.equal(control.state.launches,1);assert.equal(control.state.contextClosed,true);assert.equal(control.state.browserClosed,true);assert.equal(control.state.captures,0);assert.equal(control.state.fetches,0);assert.equal(saved.scopegraph,null);assert.deepEqual(saved.journal.actions,[]);
  for(const secret of ['unit-private-never-persisted','private-pageerror-secret','private-selector-user-data','private-close-error','private-unexpected-selector-message'])assert.equal(JSON.stringify(saved).includes(secret),false);assert.equal(JSON.stringify(saved).includes('PRIVATE_DURABLE_ERROR'),false);return saved;
 }finally{for(const name of readdirSync(directory)){const file=path.join(directory,name);assert.equal(path.dirname(file),directory);unlinkSync(file);}rmdirSync(directory);}
}
test('actual browser callbacks persist first-page HTTP STOP with nullable graph and exact primary reason',async()=>{
 const saved=await controlledEarlyStop(fakeBrowser({status:503}));assert.equal(saved.receipt.status,'STOP');assert.equal(saved.receipt.code,'DRAFT111_OWN_PAGE_HTTP');assert.equal(saved.receipt.failureStep,'PROJECTS_BOARD');assert.equal(saved.receipt.pageHttpStatus,503);
 assert.throws(()=>assertTechnicalPersistence({...saved,scopegraph:undefined}),/PLAIN_VALUE_REQUIRED/);
});
test('actual browser pageerror STOP retains only bounded exception kind without raw sensitive message',async()=>{
 const saved=await controlledEarlyStop(fakeBrowser({status:200,pageError:TypeError('private-pageerror-secret')}));assert.equal(saved.receipt.code,'DRAFT111_CLIENT_ERROR');assert.equal(saved.receipt.failureStep,'PROJECTS_BOARD');assert.deepEqual(saved.receipt.pageErrorKinds,['TYPE_ERROR']);assert.equal(saved.receipt.pageErrors,1);
});
test('actual unknown POST guard aborts before intent/fetch and preserves primary route failure',async()=>{
 const control=fakeBrowser({status:200,request:{url:'https://staging-crm.peromebel.by/projects',method:'POST',headers:{'next-action':'c'.repeat(40)},body:JSON.stringify(['foreign-operation'])}}),saved=await controlledEarlyStop(control);
 assert.equal(control.state.aborts,1);assert.equal(saved.receipt.code,'DRAFT111_UNOWNED_MUTATION_BLOCKED');assert.equal(saved.receipt.blockedWrites,1);assert.equal(saved.receipt.failureStep,'PROJECTS_BOARD');
});
test('actual selector timeout carries safe step/kind and never stores arbitrary exception message',async()=>{
 const error=Error('private-selector-user-data');error.name='TimeoutError';const saved=await controlledEarlyStop(fakeBrowser({status:200,throwOnClick:error}));assert.equal(saved.receipt.code,'DRAFT111_BROWSER_UNKNOWN');assert.equal(saved.receipt.errorKind,'TIMEOUT_ERROR');assert.equal(saved.receipt.failureStep,'PROJECT_DIALOG_OPEN');
});
test('durable callback failure cannot allow navigation or mask error during final closure',async()=>{
 const saved=await controlledEarlyStop(fakeBrowser(),true);assert.equal(saved.receipt.code,'DRAFT111_JOURNAL_PERSIST_FAILED');assert.equal(saved.receipt.failureStep,'INITIAL_JOURNAL');assert.equal(saved.receipt.journalPersistFailures,2);
});
test('resource close failure keeps original primary HTTP failure and null graph',async()=>{
 const saved=await controlledEarlyStop(fakeBrowser({status:503,closeThrows:true}));assert.equal(saved.receipt.code,'DRAFT111_OWN_PAGE_HTTP');assert.equal(saved.receipt.failureStep,'PROJECTS_BOARD');assert.equal(saved.receipt.closeFailures,1);
});
