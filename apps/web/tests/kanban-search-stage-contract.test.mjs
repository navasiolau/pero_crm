import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {normalizeListQuery,encodeListPreference} from '../src/lib/list-state.ts';
import {encodeListFilterValue} from '../src/lib/list-filter-values.ts';
import {createListPreferenceService} from '../src/server/list-preference-service.ts';
import {ListStateController} from '../src/lib/list-state-controller.ts';
import {SEARCH_STAGE_ORIGIN,validateKanbanSearchHandoff,kanbanSearchQuery,kanbanSearchRequest,decodeKanbanPreferenceAck,KanbanPreferenceJournal,forwardKanbanPreference,buildKanbanPreferenceCleanup,finalizeKanbanSearchAcceptance} from './kanban-search-stage-browser.mjs';

function input(){
 const revision='a'.repeat(40),actor={id:'qa-fresh-manager',roles:['MANAGER']},tokens={projectTitle:'QA117-PROJECT-TITLE-UNIQUE',productTitle:'QA117-PRODUCT-TITLE-UNIQUE',client:'QA117-CLIENT-TOKEN-UNIQUE',technical:'QA117-TECHNICAL-TOKEN-UNIQUE'};
 return{authorized:true,origin:SEARCH_STAGE_ORIGIN,expectedRevision:revision,identity:{hostname:'crm-staging',revision,databaseVolume:'crm-staging_pgdata',outerW07Sha256:'b'.repeat(64)},
  checkpoint:{scope:'fresh-owned-qa',runId:'b1111111-1111-4111-8111-111111111111',revision,signature:'c'.repeat(64),originalPreSha256:'d'.repeat(64),actor,
   createdActorIds:[actor.id],createdClientIds:['qa-client'],createdProjectIds:['qa-project'],createdProductIds:['qa-product'],createdFileIds:['qa-file'],originalPreferences:['projects','products'].map(section=>({userId:actor.id,key:section+'.list',value:null}))},
  profile:{...actor,cookies:[{name:'__Secure-authjs.session-token',value:'synthetic-private-cookie',url:SEARCH_STAGE_ORIGIN,secure:true,httpOnly:true}]},
  subjects:{client:{id:'qa-client',name:tokens.client},project:{id:'qa-project',number:'199',title:tokens.projectTitle,clientId:'qa-client'},product:{id:'qa-product',number:'199.5',title:tokens.productTitle,description:tokens.technical,projectId:'qa-project'}},tokens,
  action:{id:'e'.repeat(42),exportedName:'saveListPreference',filename:'src/server/list-preferences-actions.ts',revision,manifestSha256:'f'.repeat(64)}};
}
const binding=()=>validateKanbanSearchHandoff(input());
const value=(query,revision='b5428289-23f7-4e42-a967-212da990d141')=>encodeListPreference(new URLSearchParams(query).has('client')?'projects':'products',query,revision);
async function encode(result,mode){
 const child=spawn(process.execPath,['--conditions=react-server',fileURLToPath(new URL('./helpers/product-description-flight-encode.mjs',import.meta.url))],{stdio:['pipe','pipe','pipe'],windowsHide:true}),out=[],err=[];
 child.stdout.on('data',chunk=>out.push(chunk));child.stderr.on('data',chunk=>err.push(chunk));child.stdin.end(JSON.stringify({result,mode}));
 const exit=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});assert.equal(exit,0,Buffer.concat(err).toString());return Buffer.from(Buffer.concat(out).toString(),'base64');
}
function post(b,section,query,expected=null){return{url:b.origin+'/'+section+'?'+kanbanSearchQuery(section,'',b),method:'POST',headers:{origin:b.origin,'content-type':'text/plain;charset=UTF-8','next-action':b.actionId},body:JSON.stringify([section,query,expected])};}
const headers={'content-type':'text/x-component','x-action-revalidated':'[[],0,0]'};


function memoryService(b){
 const values=new Map(),calls=[];
 const service=createListPreferenceService({sessionUser:async()=>b.actorId,revision:randomUUID,store:{
  get:async(userId,key)=>values.get(JSON.stringify([userId,key]))??null,
  compareAndSwap:async(userId,key,expected,next)=>{const id=JSON.stringify([userId,key]),current=values.get(id)??null;calls.push({userId,key,expected,next});if(current!==expected)return false;values.set(id,next);return true;},
 }});
 return{service,values,calls};
}
async function settledController(controller){for(let turn=0;turn<500&&controller.getSnapshot().pending;turn++)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(controller.getSnapshot().pending,false);}
for(const section of ['projects','products'])test(`${section} actual server normalization and startup save produce the adapter canonical query and genuine ACK`,async()=>{
 const b=binding(),axis=section==='projects'?'client':'project',ownId=section==='projects'?b.subjects.client.id:b.subjects.project.id;
 // Legacy scalar URL is normalized by the actual server before the controller boots.
 const raw=new URLSearchParams({view:'kanban',[axis]:ownId,active:'0'}).toString(),state=memoryService(b),loaded=await state.service.load(section,Object.fromEntries(new URLSearchParams(raw)));
 assert.equal(loaded.query,kanbanSearchQuery(section,'',b));assert.equal(new URLSearchParams(loaded.query).get(axis),encodeListFilterValue([ownId]));assert.equal(loaded.value,null);
 const events=[],journal=new KanbanPreferenceJournal(b,async event=>events.push(event)),navigations=[],errors=[];
 const controller=new ListStateController({section,query:loaded.query,preference:loaded.value,isCurrent:()=>true,navigate:query=>navigations.push(query),onError:error=>errors.push(error),save:async(query,expected)=>{
  const decision=kanbanSearchRequest(post(b,section,query,expected),b);assert.equal(decision.kind,'own-preference');let received;
  const result=await forwardKanbanPreference({fetch:async()=>{
   assert.equal(events.at(-1).kind,'INTENT');const result=await state.service.save(section,query,expected),body=await encode(result);return{body:async()=>body,headers:()=>headers,status:()=>200};
  },fulfill:async()=>{assert.equal(events.at(-1).kind,'ACK');received=journal.ownWrites().find(row=>row.key===section+'.list').value;}},decision,b,journal);
  assert.equal(received,result.value);return result;
 }});
 controller.start();await settledController(controller);assert.deepEqual(errors,[]);assert.deepEqual(navigations,[],'startup canonical save does not navigate');assert.equal(state.calls.length,1);
 assert.equal(JSON.parse(state.calls[0].next).query,loaded.query);assert.equal(state.calls[0].expected,null);assert.equal(journal.ownWrites()[0].value,state.calls[0].next);
 const startupValue=state.calls[0].next;controller.set({q:b.terms[section][0]});await settledController(controller);assert.deepEqual(errors,[]);assert.equal(state.calls.length,2);assert.equal(state.calls[1].expected,startupValue);
 assert.deepEqual(navigations,[kanbanSearchQuery(section,b.terms[section][0],b)]);assert.deepEqual(events.map(event=>event.kind),['INTENT','ACK','INTENT','ACK']);controller.stop();
});

test('fresh own session/subjects/tokens/prefs and exact compiled action bind without mutating private input',()=>{
 const source=input(),before=structuredClone(source),b=validateKanbanSearchHandoff(source);assert.deepEqual(source,before);assert.equal(b.actorId,source.profile.id);assert.notEqual(b.cookies[0],source.profile.cookies[0]);assert.equal(b.cookies[0].url,SEARCH_STAGE_ORIGIN);
 assert.equal(new URLSearchParams(kanbanSearchQuery('projects','199',b)).get('client'),encodeListFilterValue(['qa-client']));assert.equal(new URLSearchParams(kanbanSearchQuery('products','199.5',b)).get('project'),encodeListFilterValue(['qa-project']));
 assert.equal(kanbanSearchQuery('products','199.5',b),normalizeListQuery('products',kanbanSearchQuery('products','199.5',b)));assert.equal(kanbanSearchQuery('projects','199',b),normalizeListQuery('projects',kanbanSearchQuery('projects','199',b)));
});

test('production origin revision/DB/W07 drift existing actors nonnull prefs and unrelated compiled actions fail before runtime',()=>{
 for(const change of [
  v=>v.authorized=false,v=>v.origin='https://crm.peromebel.by',v=>v.identity.hostname='crm-prod',v=>v.identity.revision='b'.repeat(40),v=>v.identity.databaseVolume='crm_pgdata',v=>v.identity.outerW07Sha256='',
  v=>v.checkpoint.originalPreSha256='',v=>v.checkpoint.signature='',v=>v.checkpoint.scope='existing-session',v=>v.checkpoint.createdClientIds='qa-client',v=>v.checkpoint.createdProductIds.push('qa-product'),v=>v.checkpoint.createdActorIds=[],v=>v.checkpoint.actor.id='real-user',v=>v.profile.roles=['ENGINEER'],v=>v.checkpoint.originalPreferences[0].value='existing-saved-value',
  v=>v.checkpoint.originalPreferences[1].key='projects.list',v=>v.action.exportedName='deleteProduct',v=>v.action.filename='src/server/products/actions.ts',v=>v.action.revision='b'.repeat(40),v=>v.action.id='e'.repeat(40),v=>v.action.filename=17,
  v=>v.subjects.product.projectId='foreign',v=>v.subjects.product.number='200.5',v=>v.subjects.project.title+=' '+v.tokens.client,v=>v.subjects.product.description='missing',v=>v.tokens.technical=v.tokens.client,
 ]){const source=input();change(source);assert.throws(()=>validateKanbanSearchHandoff(source),/^Error: K117_/);}
});

test('cookie scope duplicates production domains or widened roles never reach browser',()=>{
 for(const change of [cookie=>cookie.url='https://crm.peromebel.by',cookie=>cookie.domain='crm.peromebel.by',cookie=>cookie.name='other',cookie=>cookie.path='/my',cookie=>cookie.secure=false,cookie=>cookie.httpOnly=false,cookie=>cookie.value='']){const source=input();change(source.profile.cookies[0]);assert.throws(()=>validateKanbanSearchHandoff(source),/^Error: K117_/);}
 const source=input();source.profile.cookies.push({...source.profile.cookies[0]});assert.throws(()=>validateKanbanSearchHandoff(source),/^Error: K117_/);
});

test('GET scope is own constrained boards fixed health/session and static assets, all other reads/writes stop',()=>{
 const b=binding();for(const route of ['/projects?'+kanbanSearchQuery('projects',b.tokens.client,b),'/products?'+kanbanSearchQuery('products','199.5',b)+'&_rsc=abc123','/api/health','/api/auth/session','/_next/static/chunks/app.js','/icons/icon.png','/api/files/qa-file?preview=card'])
  for(const method of ['GET','HEAD'])assert.equal(kanbanSearchRequest({url:b.origin+route,method},b).kind,'continue-read');
 for(const route of ['/products?view=kanban&project=foreign&active=0','/products?view=kanban&project=qa-project&active=0','/products?view=table&project=qa-project&active=0','/projects?view=kanban&q=real-client&client=qa-client&active=0','/products/199.5','/projects/qa-project','/my','/api/files/foreign?preview=card','/api/files/qa-file?url=https://example.test','/api/auth/session?extra=1'])assert.equal(kanbanSearchRequest({url:b.origin+route,method:'GET'},b).kind,'deny',route);
 for(const method of ['PUT','PATCH','DELETE','OPTIONS'])assert.equal(kanbanSearchRequest({url:b.origin+'/projects',method},b).kind,'deny');
 assert.equal(kanbanSearchRequest({url:'https://crm.peromebel.by/products',method:'GET',prefetch:true},b).kind,'deny');assert.equal(kanbanSearchRequest({url:b.origin+'/my',method:'GET',prefetch:true},b).kind,'abort-prefetch');
});

test('only exact compiled preference POST with own canonical query/body can proceed; every other action aborts',()=>{
 const b=binding(),query=kanbanSearchQuery('products','199.5',b),request=post(b,'products',query);assert.equal(kanbanSearchRequest(request,b).kind,'own-preference');
 for(const change of [r=>r.url=b.origin+'/products?view=kanban&project=foreign&active=0',r=>r.headers.origin='https://crm.peromebel.by',r=>r.headers['content-type']='multipart/form-data',r=>r.body=JSON.stringify(['projects',query,null]),r=>r.body=JSON.stringify(['products','view=kanban&q=199.5',null]),r=>r.body=JSON.stringify(['products',query,null,'extra']),r=>r.body='x'.repeat(4100)]){const r=structuredClone(request);change(r);assert.equal(kanbanSearchRequest(r,b).kind,'deny');}
 const other=structuredClone(request);other.headers['next-action']='f'.repeat(42);assert.equal(kanbanSearchRequest(other,b).kind,'abort-unrelated-action');
 assert.equal(kanbanSearchRequest({...request,url:b.origin+'/api/files/upload'},b).kind,'abort-unrelated-action');
});

test('handcrafted scalar filter ACK cannot bypass actual backend canonical arrays',async()=>{
 const b=binding(),section='products',scalar='view=kanban&q=199.5&project=qa-project&active=0';
 assert.equal(kanbanSearchRequest(post(b,section,scalar),b).kind,'deny');
 const synthetic={ok:true,value:JSON.stringify({version:2,revision:randomUUID(),query:scalar})};
 await assert.rejects(decodeKanbanPreferenceAck({body:await encode(synthetic),status:200,headers,section,query:scalar},b),/CANONICAL_SCOPE_REQUIRED/);
 const server=memoryService(b),actual=await server.service.save(section,scalar,null);assert.equal(new URLSearchParams(JSON.parse(actual.value).query).get('project'),encodeListFilterValue(['qa-project']));
 await assert.rejects(decodeKanbanPreferenceAck({body:await encode(actual),status:200,headers,section,query:scalar},b),/ACK_VALUE_QUERY_MISMATCH/);
});

test('genuine Next15 compact preference ACK preserves exact query/version/revision and rejects CAS conflicts',async()=>{
 const b=binding(),section='products',query=kanbanSearchQuery(section,b.tokens.productTitle,b),server=memoryService(b),result=await server.service.save(section,query,null);
 assert.deepEqual(await decodeKanbanPreferenceAck({body:await encode(result),status:200,headers,section,query},b),result);
 assert.deepEqual(await decodeKanbanPreferenceAck({body:await encode(result),status:200,headers:{...headers,'x-action-revalidated':'[[],0,1]'},section,query},b),result);
 for(const invalid of [{ok:false,value:null},{ok:true,value:value(query,'foreign-revision')},{ok:true,value:value(kanbanSearchQuery(section,b.tokens.client,b))},{ok:true,value:JSON.stringify({version:1,revision:'b5428289-23f7-4e42-a967-212da990d141',query})},{ok:true,value:result.value,extra:1}])
  await assert.rejects(decodeKanbanPreferenceAck({body:await encode(invalid),status:200,headers,section,query},b),/^Error: K117_/);
});

test('full RSC modules redirect revalidation or unexpected HTTP/content type fail the real decoder',async()=>{
 const b=binding(),section='projects',query=kanbanSearchQuery(section,'199',b),result={ok:true,value:value(query)},body=await encode(result);
 for(const mode of ['module','full-rsc','metadata'])await assert.rejects(decodeKanbanPreferenceAck({body:await encode(result,mode),status:200,headers,section,query},b),/^Error: K117_/);
 for(const altered of [{status:500},{headers:{'content-type':'application/json'}},{headers:{...headers,'x-action-redirect':'/other'}},{headers:{...headers,'x-action-revalidated':'[["/projects"],0,0]'}},{headers:{...headers,location:'/other'}},{headers:{...headers,'x-nextjs-action-not-found':'1'}}])
  await assert.rejects(decodeKanbanPreferenceAck({body,status:200,headers,section,query,...altered},b),/^Error: K117_/);
});

test('durable intent gates one upstream call; exact ACK persists before browser receives unmodified bytes',async()=>{
 const b=binding(),section='products',query=kanbanSearchQuery(section,'199.5',b),events=[],ordering=[];
 const journal=new KanbanPreferenceJournal(b,async event=>{ordering.push(event.kind);events.push(structuredClone(event));}),server=memoryService(b),request=post(b,section,query),decision=kanbanSearchRequest(request,b);let body;
 const route={fetch:async options=>{ordering.push('FETCH');assert.deepEqual(options,{maxRetries:0,maxRedirects:0,timeout:30000});body=await encode(await server.service.save(section,query,null));return{body:async()=>body,headers:()=>headers,status:()=>200};},fulfill:async response=>{ordering.push('FULFILL');assert.deepEqual(response.body,body);assert.equal(journal.ownWrites().length,1);}};
 await forwardKanbanPreference(route,decision,b,journal);assert.deepEqual(ordering,['INTENT','FETCH','ACK','FULFILL']);assert.equal(events[0].expected,null);assert.equal(events[1].requestId,events[0].requestId);assert.equal(events[1].httpStatus,200);assert.equal(journal.uncertain,0);assert.equal(journal.active,null);assert.equal(server.calls.length,1);assert.equal(journal.ownWrites()[0].value,server.calls[0].next);
 const current=journal.ownWrites();assert.deepEqual(buildKanbanPreferenceCleanup(b,current,current),[{kind:'noop',userId:b.actorId,key:'projects.list'},{kind:'delete',userId:b.actorId,key:'products.list',expectedValue:current[0].value}]);
});

test('failed journal write prevents fetch and unresolved action never fabricates an ACK or permits automatic retry',async()=>{
 const b=binding(),section='products',query=kanbanSearchQuery(section,'199.5',b),decision=kanbanSearchRequest(post(b,section,query),b);let calls=0;
 const blocked=new KanbanPreferenceJournal(b,async()=>{throw Error('disk-refused');});await assert.rejects(forwardKanbanPreference({fetch:async()=>{calls++;}},decision,b,blocked),/disk-refused/);assert.equal(calls,0);assert.deepEqual(blocked.ownWrites(),[]);
 const events=[],uncertain=new KanbanPreferenceJournal(b,async event=>events.push(event));await assert.rejects(forwardKanbanPreference({fetch:async()=>{calls++;throw Error('transport-lost');}},decision,b,uncertain),/transport-lost/);assert.equal(calls,1);assert.deepEqual(events.map(event=>event.kind),['INTENT','UNCERTAIN']);assert.equal(uncertain.uncertain,1);assert.deepEqual(uncertain.ownWrites(),[]);await assert.rejects(uncertain.begin(section,decision.args),/UNRESOLVED/);
});

test('sequential CAS uses last exact ACK; overlapping or stale expected values stop before another upstream call',async()=>{
 const b=binding(),query=kanbanSearchQuery('projects','199',b),events=[],journal=new KanbanPreferenceJournal(b,async event=>events.push(event)),server=memoryService(b);const intent=await journal.begin('projects',['projects',query,null]);
 await assert.rejects(journal.begin('projects',['projects',query,null]),/CONCURRENT/);const saved=await server.service.save('projects',query,null);await journal.acknowledge(intent,saved,{responseSha256:'1'.repeat(64),httpStatus:200});
 await assert.rejects(journal.begin('projects',['projects',query,null]),/EXPECTED_PREFERENCE_CAS_CHANGED/);const next=await journal.begin('projects',['projects',query,saved.value]);assert.equal(next.expected,saved.value);
});

test('cleanup requires own exact actor/key/value, not equal query or last guessed revision',()=>{
 const b=binding(),query=kanbanSearchQuery('products','199.5',b),ack={userId:b.actorId,key:'products.list',value:value(query)},different={...ack,value:value(query,'c5428289-23f7-4e42-a967-212da990d141')};
 assert.throws(()=>buildKanbanPreferenceCleanup(b,[ack],[different]),/UNKNOWN_CURRENT/);assert.throws(()=>buildKanbanPreferenceCleanup(b,[{...ack,userId:'real-user'}],[ack]),/SCOPE/);assert.throws(()=>buildKanbanPreferenceCleanup(b,[ack],[{...ack,key:'products.view'}]),/SCOPE/);assert.throws(()=>buildKanbanPreferenceCleanup(b,[],[ack]),/UNKNOWN_CURRENT/);
});

test('browser-only success cannot count as staging acceptance without actual CAS cleanup and original/owned closure proof',()=>{
 const b=binding(),browser={status:'BROWSER_CHECKS_PASSED_CLEANUP_REQUIRED',revision:b.revision,runId:b.runId,unresolvedIntents:0,deniedRequests:0,pageErrors:0,requestsDrained:true,checks:[1]},cleanup={status:'CAS_RESTORED',runId:b.runId,actorId:b.actorId,checkedKeys:2,remainingPreferenceRows:0,requestOutcomesSettled:true},proof={status:'ORIGINALS_MATCH_OWNED_CLOSED',runId:b.runId,revision:b.revision,originalPreSha256:b.preSha256,originalsMatch:true,remainingOwnedRows:0,physicalIdentityMatch:true};
 assert.equal(finalizeKanbanSearchAcceptance(b,browser,cleanup,proof).status,'PASS');
 for(const bad of [{...browser,status:'PASS'},{...browser,unresolvedIntents:1},{...browser,deniedRequests:1},{...browser,requestsDrained:false}])assert.throws(()=>finalizeKanbanSearchAcceptance(b,bad,cleanup,proof),/^Error: K117_/);
 for(const bad of [{...cleanup,status:'PLANNED'},{...cleanup,remainingPreferenceRows:1},{...cleanup,actorId:'real-user'},{...cleanup,requestOutcomesSettled:false}])assert.throws(()=>finalizeKanbanSearchAcceptance(b,browser,bad,proof),/^Error: K117_/);
 for(const bad of [{...proof,originalsMatch:false},{...proof,remainingOwnedRows:1},{...proof,revision:'b'.repeat(40)},{...proof,originalPreSha256:'1'.repeat(64)}])assert.throws(()=>finalizeKanbanSearchAcceptance(b,browser,cleanup,bad),/^Error: K117_/);
});

import {COHORT163_NAMESPACE,COHORT163_ACTORS,digest117} from './kanban-search-owned-protocol.mjs';
function cohortHandoff(){const v=input(),keys=[...COHORT163_ACTORS,'client','project','productA','productB'],ids=Object.fromEntries(keys.map((key,i)=>[key,(i+1)+'1111111-1111-4111-8111-111111111111']));v.subjects.client.id=ids.client;v.subjects.project.id=ids.project;v.subjects.project.clientId=ids.client;v.subjects.product.id=ids.productA;v.subjects.product.projectId=ids.project;const h=v.checkpoint;Object.assign(h,{namespace:COHORT163_NAMESPACE,version:2,registry:{namespace:COHORT163_NAMESPACE,version:2,runId:h.runId,revision:h.revision,ids,identity:v.identity,actionGrants:[]},createdActorIds:COHORT163_ACTORS.map(k=>ids[k]),createdClientIds:[ids.client],createdProjectIds:[ids.project],createdProductIds:[ids.productA,ids.productB],createdFileIds:[],subjects:structuredClone(v.subjects),actors:COHORT163_ACTORS.map(key=>({key,id:ids[key],roles:[key==='manager'?'MANAGER':key==='accountant'?'ACCOUNTANT':'ENGINEER']})),productB:{id:ids.productB,number:v.subjects.project.number+'.6',title:'QA163_SYNTHETIC_PRODUCT_B',projectId:ids.project},readPaths:['/projects/'+ids.project,'/products/'+v.subjects.product.number,'/products/'+v.subjects.project.number+'.6'],actionGrants:[]});h.registrySha256=digest117(h.registry);h.actor={id:ids.manager,roles:['MANAGER']};v.profile.id=ids.manager;h.originalPreferences.forEach(p=>p.userId=ids.manager);return v;}

test('V2 four own profiles enforce role-bound readonly detail paths and manager-only preference actions',()=>{
 const v=cohortHandoff();for(const actor of v.checkpoint.actors){const a=structuredClone(v);a.profile.id=actor.id;a.profile.roles=actor.roles;a.checkpoint.actor=actor;a.checkpoint.originalPreferences.forEach(p=>p.userId=actor.id);const binding=validateKanbanSearchHandoff(a);assert.equal(binding.preferenceAllowed,actor.key==='manager');assert.equal(kanbanSearchRequest({url:binding.origin+binding.readPaths[0],method:'GET'},binding).kind,'continue-read');assert.equal(kanbanSearchRequest({url:binding.origin+'/projects/unowned',method:'GET'},binding).kind,'deny');const query=kanbanSearchQuery('products',binding.tokens.productTitle.slice(0,3),binding),req=post(binding,'products',query);assert.equal(kanbanSearchRequest(req,binding).kind,actor.key==='manager'?'own-preference':'abort-unrelated-action');}
 for(const change of [a=>a.checkpoint.createdActorIds.pop(),a=>a.checkpoint.readPaths.push('/finance'),a=>a.checkpoint.registry.ids.productA='real-product',a=>a.profile.roles=['ADMIN'],a=>a.checkpoint.actors[1].id=a.checkpoint.actors[0].id]){const a=structuredClone(v);change(a);assert.throws(()=>validateKanbanSearchHandoff(a),/^Error: K117_/);}
});

test('V2 prefixes never permit missing own filter, arbitrary detail query or multipart status action',()=>{
 const b=validateKanbanSearchHandoff(cohortHandoff()),query=kanbanSearchQuery('projects',b.tokens.projectTitle.slice(0,1),b);assert.equal(kanbanSearchRequest({url:b.origin+'/projects?'+query,method:'GET'},b).kind,'continue-read');
 for(const url of ['/projects?view=kanban&q=Q&active=0',b.readPaths[0]+'?tab=foreign',b.readPaths[1]+'?returnTo=/finance'])assert.equal(kanbanSearchRequest({url:b.origin+url,method:'GET'},b).kind,'deny');assert.equal(kanbanSearchRequest({url:b.origin+b.readPaths[1],method:'POST',headers:{'next-action':'b'.repeat(42)},body:'["DESIGN"]'},b).kind,'abort-unrelated-action');
});

test('V2 real product navigation preserves only exact own products returnTo or own project products tab',()=>{
 const b=validateKanbanSearchHandoff(cohortHandoff()),global='/products?'+kanbanSearchQuery('products',b.subjects.product.number,b),project=b.readPaths[0]+'?tab=products';for(const returnTo of [global,project]){const url=b.origin+b.readPaths[1]+'?'+new URLSearchParams({returnTo});assert.equal(kanbanSearchRequest({url,method:'GET'},b).kind,'continue-read');}
 assert.equal(kanbanSearchRequest({url:b.origin+project,method:'GET'},b).kind,'continue-read');
 for(const returnTo of ['/finance','/projects/real-project?tab=products','/products?view=kanban&active=0','https://crm.peromebel.by/products',global+'&project=foreign'])assert.equal(kanbanSearchRequest({url:b.origin+b.readPaths[1]+'?'+new URLSearchParams({returnTo}),method:'GET'},b).kind,'deny');
 for(const query of ['tab=finance','tab=products&tab=products','returnTo=/finance'])assert.equal(kanbanSearchRequest({url:b.origin+b.readPaths[0]+'?'+query,method:'GET'},b).kind,'deny');
});
