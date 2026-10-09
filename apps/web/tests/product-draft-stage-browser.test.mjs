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
import {runProductDraftStageBrowser,productDialogTechnicalState,draftQaPageErrorMetadata} from './product-draft-stage-browser.mjs';
import {makeTechnicalStore} from './product-draft-stage-runner.mjs';
import {assertTechnicalPersistence} from './product-draft-stage-wire.mjs';
import {acceptanceWeb} from './crm-acceptance-transport.mjs';
const fixture={runId:'80502171-fcf9-4189-a3f8-c8a77e94efad',revision:'a'.repeat(40),signature:'b'.repeat(64),pre:{ids:{actor:'own-manager',client:'own-client',projectB:'own-paused'},tags:{actor:'QA111 manager run',client:'QA111 client run',projectA:'QA111 primary run',products:Array.from({length:10},(_,i)=>'QA111 product run '+(i+1))}}};
function fakeBrowser({status=503,pageError,request,afterGotoRequest,reply,rscResponseBeforeError=false,throwOnClick,closeThrows=false,mainNodes=[{classes:['@container/main']}]}={}){
 const handlers=new Map(),state={launches:0,captures:0,fetches:0,aborts:0,contextClosed:false,browserClosed:false,mainWaits:[]},page={
  on:(event,fn)=>{handlers.set(event,fn);},
  locator:selector=>({waitFor:async()=>{const match=/^main(?:\[class~="([^"]+)"\])?$/.exec(selector);assert.ok(match,'MAIN_SELECTOR_SUPPORTED');const matchedCount=mainNodes.filter(node=>!match[1]||node.classes.includes(match[1])).length;state.mainWaits.push({selector,matchedCount});if(matchedCount!==1)throw Error('STRICT_MODE_MAIN_COUNT');}}),
  getByRole:()=>({click:async()=>{if(afterGotoRequest){const request=afterGotoRequest;await state.route({request:()=>({url:()=>request.url,method:()=>request.method,headers:()=>request.headers,postData:()=>request.body}),abort:async()=>{state.aborts++;},fetch:async()=>{state.fetches++;if(reply)return {status:()=>200,body:async()=>Buffer.from('1:'+JSON.stringify(reply)+'\n')};throw Error('UNEXPECTED_LIVE_FETCH');},fulfill:async()=>{state.fulfilled=true;}});}throw throwOnClick??Error('private-unexpected-selector-message');}}),
  goto:async url=>{
   if(rscResponseBeforeError)handlers.get('response')({url:()=>url,request:()=>({method:()=>'GET',headers:()=>({rsc:'1',authorization:'unit-private-never-persisted'})})});if(pageError)handlers.get('pageerror')(pageError);
   if(request){const route={request:()=>({url:()=>request.url,method:()=>request.method,headers:()=>request.headers,postData:()=>request.body}),abort:async()=>{state.aborts++;},fetch:async()=>{state.fetches++;throw Error('UNEXPECTED_LIVE_FETCH');},continue:async()=>{throw Error('UNEXPECTED_LIVE_CONTINUE');}};
    await state.route(route);
   }
   return {status:()=>status};
  },
 },context={addInitScript:async()=>{},addCookies:async()=>{},newPage:async()=>page,route:async(_pattern,fn)=>{state.route=fn;},request:{get:async()=>({status:()=>200,json:async()=>({user:{id:fixture.pre.ids.actor}})})},close:async()=>{state.contextClosed=true;if(closeThrows)throw Error('private-close-error');}},browser={newContext:async()=>context,close:async()=>{state.browserClosed=true;}};
 return {state,launchBrowser:async()=>{state.launches++;return browser;}};
}
async function controlledEarlyStop(control,callbackFailure=false,expectedWrites=0){
 const directory=path.join(acceptanceWeb,'test-results','draft111-early-stop-pure-'+randomUUID());mkdirSync(directory,{recursive:true});const store=makeTechnicalStore(directory);
 try{
  const result=await runProductDraftStageBrowser({authorized:true,origin:'https://staging-crm.peromebel.by',revision:fixture.revision,profile:{id:fixture.pre.ids.actor,roles:['MANAGER'],cookies:[{name:'authjs.session-token',value:'unit-private-never-persisted'}]},checkpoint:fixture,outputDir:directory,launchBrowser:control.launchBrowser,onJournal:async journal=>{if(callbackFailure)throw Error('PRIVATE_DURABLE_ERROR');store.put('journal',journal);},observe:async()=>{control.state.captures++;throw Error('UNEXPECTED_READONLY_OBSERVE');}});
  assertTechnicalPersistence(result);store.put('browser-result',result);const saved=store.get('browser-result');
  assert.equal(control.state.launches,1);assert.equal(control.state.contextClosed,true);assert.equal(control.state.browserClosed,true);assert.equal(control.state.captures,0);assert.equal(control.state.fetches,expectedWrites);assert.equal(saved.scopegraph,null);assert.equal(saved.journal.actions.length,expectedWrites);
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

test('nested SidebarInset and AppShell mains select only the intended class-token inner main',async()=>{
 const error=Error('private-selector-user-data');error.name='TimeoutError';
 const control=fakeBrowser({status:200,mainNodes:[{classes:['peer','relative']},{classes:['flex','@container/main','min-w-0']}],throwOnClick:error}),saved=await controlledEarlyStop(control);
 assert.deepEqual(control.state.mainWaits,[{selector:'main[class~="@container/main"]',matchedCount:1}]);
 assert.equal(saved.receipt.pageHttpStatus,200);assert.equal(saved.receipt.pageErrors,0);assert.equal(saved.receipt.failureStep,'PROJECT_DIALOG_OPEN');
 const nodes=[{classes:['peer']},{classes:['@container/main']}];assert.equal(nodes.length,2);assert.equal(nodes.filter(node=>node.classes.includes('@container/main')).length,1);
});

test('product dialog diagnostics expose only bounded state flags, even for failed or nonboolean getters',async()=>{
 const locator=(visible,enabled)=>({isVisible:async()=>{if(visible instanceof Error)throw visible;return visible;},isEnabled:async()=>{if(enabled instanceof Error)throw enabled;return enabled;}});
 const state=await productDialogTechnicalState({page:{url:()=> 'https://staging-crm.peromebel.by/projects/217?tab=products'},project:{path:'/projects/217'},trigger:locator(true,true),dialog:locator(true,true),title:locator(true,true),price:locator(true,true),submit:locator(true,false)});
 assert.deepEqual(state,{ownsPath:true,tabIsProducts:true,triggerVisible:true,triggerEnabled:true,dialogVisible:true,titleVisible:true,titleEnabled:true,priceVisible:true,priceEnabled:true,submitVisible:true,submitEnabled:false,busyVisible:null});assertTechnicalPersistence(state);
 const failed=await productDialogTechnicalState({page:{url:()=> 'https://staging-crm.peromebel.by/projects/217'},project:{path:'/projects/217'},trigger:locator(Error('private-data'),true),dialog:locator(false,false),title:locator('private-value',false),price:locator(true,Error('private-value')),submit:locator(true,{password:'private'})});
 assert.equal(failed.tabIsProducts,false);assert.equal(failed.triggerVisible,null);assert.equal(failed.titleVisible,null);assert.equal(failed.priceEnabled,null);assert.equal(failed.submitEnabled,null);assertTechnicalPersistence(failed);assert.equal(JSON.stringify(failed).includes('private'),false);
});
test('actual route guard failure wins over following UI timeout and never forwards business POST',async()=>{
 const secondary=Error('private-selector-user-data');secondary.name='TimeoutError';
 const control=fakeBrowser({status:200,afterGotoRequest:{url:'https://staging-crm.peromebel.by/projects',method:'POST',headers:{'next-action':'c'.repeat(40)},body:JSON.stringify(['foreign-operation'])},throwOnClick:secondary}),saved=await controlledEarlyStop(control);
 assert.equal(control.state.aborts,1);assert.equal(saved.receipt.code,'DRAFT111_UNOWNED_MUTATION_BLOCKED');assert.equal(saved.receipt.errorKind,'ERROR');assert.equal(saved.receipt.failureStep,'PROJECT_DIALOG_OPEN');assert.equal(saved.receipt.blockedWrites,1);
});

test('local product OPEN may be missed before hydration then attached handler opens before any field action',async()=>{
 const {openDraftQaProductDialog}=await import('./product-draft-stage-browser.mjs');let opens=0,visible=false,guards=0;const attempts=[];
 const timeout=()=>{const error=Error('private-wait');error.name='TimeoutError';return error;};
 await openDraftQaProductDialog({trigger:{click:async()=>{opens++;if(opens>=2)visible=true;}},dialog:{waitFor:async options=>{assert.equal(options.state,'visible');assert.equal(options.timeout,1500);if(!visible)throw timeout();},isVisible:async()=>visible},settled:async()=>{guards++;},onAttempt:value=>attempts.push(value)});
 assert.equal(opens,2);assert.equal(visible,true);assert.deepEqual(attempts,[1,2]);assert.equal(guards,4);
});
test('local OPEN stops after three missed handlers with bounded static code',async()=>{
 const {openDraftQaProductDialog}=await import('./product-draft-stage-browser.mjs');let opens=0;
 await assert.rejects(()=>openDraftQaProductDialog({trigger:{click:async()=>{opens++;}},dialog:{waitFor:async()=>{const error=Error('private-wait');error.name='TimeoutError';throw error;},isVisible:async()=>false},settled:async()=>{}}),error=>error.message==='DRAFT111_PRODUCT_DIALOG_OPEN_TIMEOUT');assert.equal(opens,3);
});
test('a known route failure prevents a local OPEN repeat and submit is never repeated',async()=>{
 const {openDraftQaProductDialog}=await import('./product-draft-stage-browser.mjs');let opens=0,failed=false;
 await assert.rejects(()=>openDraftQaProductDialog({trigger:{click:async()=>{opens++;failed=true;}},dialog:{waitFor:async()=>{const error=Error('private-wait');error.name='TimeoutError';throw error;},isVisible:async()=>false},settled:async()=>{if(failed)throw Error('DRAFT111_ACTION_HTTP_FAILED');}}),/DRAFT111_ACTION_HTTP_FAILED/);assert.equal(opens,1);
});
test('local OPEN never retries a strict dialog ambiguity or a failed trigger click',async()=>{
 const {openDraftQaProductDialog}=await import('./product-draft-stage-browser.mjs');let opens=0;
 await assert.rejects(()=>openDraftQaProductDialog({trigger:{click:async()=>{opens++;}},dialog:{waitFor:async()=>{throw Error('strict ambiguity');},isVisible:async()=>false},settled:async()=>{}}),/strict ambiguity/);assert.equal(opens,1);
 opens=0;await assert.rejects(()=>openDraftQaProductDialog({trigger:{click:async()=>{opens++;const error=Error('click failed');error.name='TimeoutError';throw error;}},dialog:{waitFor:async()=>{}},settled:async()=>{}}),/click failed/);assert.equal(opens,1);
});

test('pageerror metadata extracts bounded React code and hashes message without decoded args or URLs',()=>{
 const raw='Minified React error #185; visit https://react.dev/errors/185?args[]=private-pageerror-secret',meta=draftQaPageErrorMetadata(Error(raw));
 assert.equal(meta.family,'REACT_MINIFIED');assert.equal(meta.reactCode,185);assert.match(meta.messageSha256,/^[a-f0-9]{64}$/);assert.equal(JSON.stringify(meta).includes('private'),false);assert.equal(JSON.stringify(meta).includes('https'),false);assertTechnicalPersistence(meta);
 for(const message of ['Minified React error #123456789; secret','Minified React error #000; secret','PREFIX Minified React error #185; secret'])assert.equal(draftQaPageErrorMetadata(Error(message)).reactCode,null);
 assert.equal(draftQaPageErrorMetadata(Error('x'.repeat(65537))).messageSha256,null);
});
test('known pageerror families are diagnostic only and retain fatal pageerror gate with RSC provenance',async()=>{
 for(const [raw,family] of [['Failed to fetch private-pageerror-secret','FETCH'],['serwist waiting private-pageerror-secret','SERWIST'],['Hydration failed private-pageerror-secret','HYDRATION'],['Loading chunk 12 failed','CHUNK_LOAD']]){const meta=draftQaPageErrorMetadata(Error(raw));assert.equal(meta.family,family);assert.equal(JSON.stringify(meta).includes('private'),false);}
 const error=Error('request aborted private-pageerror-secret');error.name='AbortError';assert.equal(draftQaPageErrorMetadata(error).family,'ABORT');
 const saved=await controlledEarlyStop(fakeBrowser({status:200,pageError:Error('Minified React error #185; private-pageerror-secret'),rscResponseBeforeError:true}));
 assert.equal(saved.receipt.status,'STOP');assert.equal(saved.receipt.code,'DRAFT111_CLIENT_ERROR');assert.equal(saved.receipt.pageErrors,1);assert.equal(saved.receipt.pageErrorMetadata[0].reactCode,185);assert.equal(saved.receipt.pageErrorMetadata[0].step,'PROJECTS_BOARD');assert.equal(saved.receipt.pageErrorMetadata[0].navigation.rscResponseSeen,true);assert.equal(saved.receipt.failureProvenance.lastAction,null);
});
test('actual route ACK provenance is recorded only after durable intent ACK and fulfilled response',async()=>{
 const error=Error('private-selector-user-data');error.name='TimeoutError';
 const request={url:'https://staging-crm.peromebel.by/projects',method:'POST',headers:{'next-action':'c'.repeat(40)},body:JSON.stringify([{title:fixture.pre.tags.projectA,clientId:fixture.pre.ids.client,managerId:fixture.pre.ids.actor,address:'$undefined'}])};
 const control=fakeBrowser({status:200,afterGotoRequest:request,reply:{ok:true,id:'217'},throwOnClick:error}),saved=await controlledEarlyStop(control,false,1);
 assert.equal(control.state.fulfilled,true);assert.equal(saved.journal.actions[0].kind,'project-create');assert.equal(saved.journal.actions[0].ack.projectId,'217');
 assert.deepEqual(saved.receipt.failureProvenance.lastAction,{kind:'project-create',phase:'FULFILLED',httpStatus:200,ackDurable:true,fulfilled:true});assert.equal(JSON.stringify(saved.receipt.failureProvenance).includes('body'),false);
});

test('one-shot product action may take 15413ms: ACK and route completion are awaited beyond default UI five seconds',async()=>{
 const {waitDraftQaProductAck}=await import('./product-draft-stage-browser.mjs');let clock=0,ack=false,fulfilled=false;const submits=1;
 await waitDraftQaProductAck({now:()=>clock,delay:async()=>{clock+=1000;if(clock>=15000)ack=true;if(clock>=16000)fulfilled=true;},settled:async()=>{},ready:()=>ack&&fulfilled});
 assert.equal(clock,16000);assert.equal(submits,1);assert.equal(ack,true);assert.equal(fulfilled,true);
});
test('known product action failure stops ACK waiting immediately without resubmission',async()=>{
 const {waitDraftQaProductAck}=await import('./product-draft-stage-browser.mjs');let waits=0;
 await assert.rejects(()=>waitDraftQaProductAck({now:()=>0,settled:async()=>{throw Error('DRAFT111_ACTION_HTTP_FAILED');},ready:()=>false,delay:async()=>{waits++;}}),/DRAFT111_ACTION_HTTP_FAILED/);assert.equal(waits,0);
});
test('ACK wait stops at fixed65s when response never becomes acknowledged and fulfilled',async()=>{
 const {waitDraftQaProductAck}=await import('./product-draft-stage-browser.mjs');let clock=0;
 await assert.rejects(()=>waitDraftQaProductAck({now:()=>clock,settled:async()=>{},ready:()=>false,delay:async()=>{clock+=1000;}}),/DRAFT111_PRODUCT_CREATE_ACK_TIMEOUT/);assert.equal(clock,65000);
});

test('project stage uses exact source trigger and exact portal item with a single selection',async()=>{
 const {selectDraftQaProjectStageOption}=await import('./product-draft-stage-browser.mjs'),calls=[],popup={isVisible:async()=>false,waitFor:async value=>{assert.deepEqual(value,{state:'visible',timeout:1500});calls.push('visible');},locator:selector=>{assert.equal(selector,'[data-slot="select-item"]');return {filter:value=>{assert.equal(value.hasText.test('Просчёт'),true);assert.equal(value.hasText.test('Просчёт проекта'),false);return {click:async()=>calls.push('select-once')};}}}};
 await selectDraftQaProjectStageOption({locator:selector=>selector==='[data-slot="select-content"]'?popup:{click:async()=>{assert.equal(selector,'[data-slot="select-trigger"][aria-label="Статус"]');calls.push('open-once');}}},'ESTIMATE');
 assert.deepEqual(calls,['open-once','visible','select-once']);await assert.rejects(()=>selectDraftQaProjectStageOption({},'DONE'),/DRAFT111_STAGE_OPTION_INVALID/);
});

test('stage popup may miss SSR local OPEN but exactly one hydrated option selection is sent',async()=>{
 const {selectDraftQaProjectStageOption}=await import('./product-draft-stage-browser.mjs');let opens=0,options=0,visible=false;
 const popup={isVisible:async()=>visible,waitFor:async()=>{if(!visible){const error=Error('popup missed');error.name='TimeoutError';throw error;}},locator:()=>({filter:()=>({click:async()=>{options++;}})})};
 await selectDraftQaProjectStageOption({locator:selector=>selector==='[data-slot="select-content"]'?popup:{click:async()=>{opens++;if(opens===2)visible=true;}}},'ESTIMATE');
 assert.equal(opens,2);assert.equal(options,1);
});

test('product status local popup selects one DESIGN option after hydration without another backend click',async()=>{
 const {selectDraftQaProductDesign}=await import('./product-draft-stage-browser.mjs');let opens=0,options=0,visible=false;
 const popup={isVisible:async()=>visible,waitFor:async()=>{if(!visible){const error=Error('popup missed');error.name='TimeoutError';throw error;}},locator:()=>({filter:value=>{assert.equal(value.hasText.test('Проектирование'),true);return {click:async()=>{options++;}};}})};
 await selectDraftQaProductDesign({locator:selector=>selector==='[data-slot="select-content"]'?popup:{click:async()=>{assert.equal(selector,'[data-slot="select-trigger"][aria-label="Сменить статус"]');opens++;if(opens===2)visible=true;}}});
 assert.equal(opens,2);assert.equal(options,1);
});
