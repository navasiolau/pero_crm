import assert from 'node:assert/strict';
import test from 'node:test';
import {SEARCH117_NAMESPACE,SEARCH117_ACTION_ROUTES,plan117,sign117,verify117,extractPreferenceAction117,ownedQuery117,validatePreferenceEvents117,digest117,assertCurrentCertificate117} from './kanban-search-owned-protocol.mjs';
import {certifySearch117Start,validateKanbanSearchHandoff} from './kanban-search-stage-browser.mjs';
const input={authorized:true,runId:'b1111111-1111-4111-8111-111111111111',revision:'a'.repeat(40)},secret='controlled-only-nonproduction-secret';
const makePlan=()=>{const p=plan117(input);p.number='199';return p;};
function manifest(){return {encryptionKey:'synthetic-do-not-export',node:{['e'.repeat(42)]:{exportedName:'saveListPreference',filename:'server/list-preferences-actions.ts',workers:Object.fromEntries(SEARCH117_ACTION_ROUTES.map((route,index)=>[route,{moduleId:String(index+100),async:false}])),layer:Object.fromEntries(SEARCH117_ACTION_ROUTES.map(route=>[route,'action-browser']))},['d'.repeat(42)]:{exportedName:'unrelated',filename:'server/other.ts'}}};}
function handoff(){const p=makePlan(),action=extractPreferenceAction117(Buffer.from(JSON.stringify(manifest())),input.revision).action,subjects={client:{id:p.ids.client,name:p.tokens.client},project:{id:p.ids.project,number:p.number,title:p.tokens.projectTitle,clientId:p.ids.client},product:{id:p.ids.product,number:p.number+'.1',title:p.tokens.productTitle,description:p.tokens.technical,projectId:p.ids.project}};return sign117({namespace:SEARCH117_NAMESPACE,version:1,kind:'browser-handoff',scope:'fresh-owned-qa',...input,originalPreSha256:'b'.repeat(64),actor:{id:p.ids.actor,roles:['MANAGER']},createdActorIds:[p.ids.actor],createdClientIds:[p.ids.client],createdProjectIds:[p.ids.project],createdProductIds:[p.ids.product],createdFileIds:[],originalPreferences:['projects.list','products.list'].map(key=>({userId:p.ids.actor,key,value:null})),subjects,tokens:p.tokens,action,currentOwnedStateHash:'c'.repeat(64),verifierSourceSha256:'d'.repeat(64)},secret);}

test('actual manifest source server/ maps uniquely to public src/ with both typed worker/layer references',()=>{
 const raw=Buffer.from(JSON.stringify(manifest())),result=extractPreferenceAction117(raw,input.revision);assert.equal(result.action.id,'e'.repeat(42));assert.equal(result.action.filename,'src/server/list-preferences-actions.ts');assert.equal(result.routes.length,2);assert.equal(JSON.stringify(result).includes('encryptionKey'),false);assert.equal(JSON.stringify(result).includes('synthetic-do-not-export'),false);
 for(const mutate of [m=>delete m.node['e'.repeat(42)],m=>m.node['f'.repeat(42)]={...m.node['e'.repeat(42)]},m=>m.node['e'.repeat(42)].filename='/app/server/list-preferences-actions.ts',m=>m.node['e'.repeat(42)].filename='../server/list-preferences-actions.ts',m=>m.node['e'.repeat(42)].filename='server/other.ts',m=>delete m.node['e'.repeat(42)].workers[SEARCH117_ACTION_ROUTES[0]],m=>m.node['e'.repeat(42)].workers[SEARCH117_ACTION_ROUTES[0]].moduleId=100,m=>m.node['e'.repeat(42)].layer[SEARCH117_ACTION_ROUTES[0]]='rsc']){const m=manifest();mutate(m);assert.throws(()=>extractPreferenceAction117(Buffer.from(JSON.stringify(m)),input.revision),/^Error: K117_/);}
});

test('complete source-bound HMAC cannot be replaced with guessed signature kind/run/revision',()=>{
 const p=makePlan(),signed=sign117({namespace:SEARCH117_NAMESPACE,version:1,kind:'pre',...input,plan:p},secret);assert.deepEqual(verify117(signed,secret,'pre',input).plan,p);
 for(const bad of [{...signed,signature:'0'.repeat(64)},{...signed,kind:'checkpoint'},{...signed,runId:'c1111111-1111-4111-8111-111111111111'},{...signed,revision:'b'.repeat(40)},{...signed,plan:{...p,number:'200'}}])assert.throws(()=>verify117(bad,secret,'pre',input),/^Error: K117_/);
 assert.throws(()=>verify117(signed,'different-secret','pre',input),/TAMPERED/);
});

test('fresh plan has disjoint random actor/client/project/product and four distinct actual field tokens',()=>{
 const p=makePlan(),other=makePlan();assert.equal(new Set(Object.values(p.ids)).size,4);assert.equal(new Set(Object.values(p.tokens)).size,4);assert.ok(Object.keys(p.ids).every(key=>p.ids[key]!==other.ids[key]));assert.ok(Object.values(p.tokens).every(token=>token.includes(input.runId.replaceAll('-',''))));assert.equal(p.passwordHash,'QA117_DISABLED_NOT_A_PASSWORD_HASH');
});

test('journal validates exact last acknowledged canonical arrays and stops partial/foreign/unknown actions',()=>{
 const p=makePlan(),pre={...input,plan:p},query=ownedQuery117('products','199.1',p),requestId='b5428289-23f7-4e42-a967-212da990d141',value=JSON.stringify({version:2,revision:requestId,query});const first={sequence:1,kind:'INTENT',...input,actorId:p.ids.actor,requestId,section:'products',key:'products.list',query,expected:null,actionId:'e'.repeat(42),bodySha256:'b'.repeat(64)},ack={sequence:2,kind:'ACK',...input,actorId:p.ids.actor,requestId,key:'products.list',value,httpStatus:200,responseSha256:'c'.repeat(64)};
 assert.deepEqual(validatePreferenceEvents117([first,ack],pre),[{userId:p.ids.actor,key:'products.list',value}]);
 for(const events of [[first],[{...first,actorId:'real-user'},ack],[first,{...ack,requestId:'c5428289-23f7-4e42-a967-212da990d141'}],[{...first,query:query.replace('199.1','unowned')},ack],[{...first,expected:'unknown'},ack],[first,{...ack,httpStatus:500}],[first,{...ack,kind:'UNCERTAIN'}]])assert.throws(()=>validatePreferenceEvents117(events,pre),/^Error: K117_/);
});

test('current certificate callback is mandatory before browser and binds signed public fields/raw manifest hash',async()=>{
 const h=handoff(),value={authorized:true,origin:'https://staging-crm.peromebel.by',expectedRevision:input.revision,identity:{hostname:'crm-staging',revision:input.revision,databaseVolume:'crm-staging_pgdata',outerW07Sha256:'f'.repeat(64)},checkpoint:h,profile:{id:h.actor.id,roles:['MANAGER'],cookies:[{name:'__Secure-authjs.session-token',value:'synthetic-private-cookie'}]},subjects:h.subjects,tokens:h.tokens,action:h.action},binding=validateKanbanSearchHandoff(value);
 await assert.rejects(certifySearch117Start(value,binding),/CALLBACK_REQUIRED/);let calls=0;
 const verifier=async received=>{calls++;verify117(received,secret,'browser-handoff',input);return sign117({namespace:SEARCH117_NAMESPACE,version:1,kind:'current-browser-verification',...input,handoffHash:digest117(received),originalPreSha256:h.originalPreSha256,actorId:h.actor.id,actionManifestSha256:h.action.manifestSha256,verifierSourceSha256:h.verifierSourceSha256},secret);};
 const certificate=await certifySearch117Start(value,binding,verifier);assert.equal(calls,1);assert.equal(assertCurrentCertificate117(certificate,h,{'kanban-search-owned-fixtures.mjs':h.verifierSourceSha256}).kind,'current-browser-verification');
 await assert.rejects(certifySearch117Start({...value,subjects:{...value.subjects,product:{...value.subjects.product,title:'tampered'}}},binding,verifier),/FIELDS_TAMPERED/);assert.equal(calls,1,'tampered public fields never reach verifier');
 for(const bad of [{...certificate,handoffHash:'0'.repeat(64)},{...certificate,actorId:'real-user'},{...certificate,actionManifestSha256:'0'.repeat(64)},{...certificate,verifierSourceSha256:'0'.repeat(64)}])await assert.rejects(certifySearch117Start(value,binding,async()=>bad),/^Error: K117_/);
});
