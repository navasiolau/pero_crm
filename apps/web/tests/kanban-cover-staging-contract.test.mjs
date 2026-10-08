import assert from 'node:assert/strict';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import {KANBAN_STAGING_ORIGIN,validateKanbanStagingHandoff,kanbanReadonlyRequest,kanbanCoverGeometryValid,disableKanbanQaServiceWorkerApi} from './kanban-cover-staging-browser.mjs';

function input(){
 const revision='a'.repeat(40),manager={id:'qa-manager',roles:['MANAGER'],sessionVersion:1};
 return{authorized:true,origin:KANBAN_STAGING_ORIGIN,expectedRevision:revision,identity:{hostname:'crm-staging',revision},
  checkpoint:{runId:'a1111111-1111-4111-8111-111111111111',revision,signature:'b'.repeat(64),ids:{product:'qa-product',project:'qa-project'},productNumber:'QA112.1',number:'QA112',actors:{manager}},
  profile:{id:manager.id,roles:[...manager.roles],cookies:[{name:'__Secure-authjs.session-token',value:'synthetic-private-test-token',url:KANBAN_STAGING_ORIGIN,httpOnly:true,secure:true,sameSite:'Lax'}]},
  ownedPaths:{product:'/products/QA112.1',project:'/projects/qa-project'},currentSketchFileId:'qa-sketch'};
}

test('readonly handoff accepts only bound own manager and number-based paths and does not mutate private input',()=>{
 const value=input(),before=structuredClone(value),binding=validateKanbanStagingHandoff(value);
 assert.equal(binding.paths.product,'/products/QA112.1');assert.equal(binding.paths.project,'/projects/qa-project');assert.deepEqual(value,before);
 assert.notEqual(binding.cookies[0],value.profile.cookies[0]);assert.equal(binding.cookies[0].secure,true);
});

test('physical staging origin full SHA run identity and own manager are mandatory',()=>{
 for(const mutate of [
  value=>value.authorized=false,
  value=>value.origin='https://crm.peromebel.by',
  value=>value.identity.hostname='crm-prod',
  value=>value.identity.revision='c'.repeat(40),
  value=>value.checkpoint.revision='d'.repeat(40),
  value=>value.checkpoint.runId='-'.repeat(36),
  value=>value.checkpoint.signature='invalid',
  value=>value.profile.id='someone-else',
  value=>value.profile.roles=['ENGINEER'],
  value=>value.ownedPaths.product='/products/other',
  value=>value.ownedPaths.project='https://staging-crm.peromebel.by/projects/qa-project',
  value=>value.currentSketchFileId='../other',
 ]){const value=input();mutate(value);assert.throws(()=>validateKanbanStagingHandoff(value),/^Error: K114_/);}
});

test('private cookie scope rejects production namespaces duplicates and malformed transports',()=>{
 for(const mutate of [
  cookie=>cookie.url='https://crm.peromebel.by',cookie=>cookie.domain='crm.peromebel.by',cookie=>cookie.path='/my',
  cookie=>cookie.secure=false,cookie=>cookie.httpOnly=false,cookie=>cookie.name='other-cookie',cookie=>cookie.value='',
 ]){const value=input();mutate(value.profile.cookies[0]);assert.throws(()=>validateKanbanStagingHandoff(value),/^Error: K114_/);}
 const duplicate=input();duplicate.profile.cookies.push({...duplicate.profile.cookies[0]});assert.throws(()=>validateKanbanStagingHandoff(duplicate),/^Error: K114_/);
});

test('fixed boards own details protected images and static GET/HEAD namespaces are allowed',()=>{
 const binding=validateKanbanStagingHandoff(input());
 for(const route of [
  '/api/health','/api/auth/session','/products?view=kanban&project=qa-project&active=0','/projects?view=kanban&active=0',
  '/products/QA112.1','/projects/qa-project?tab=products','/_next/static/chunk.js','/icons/icon.png',
  '/api/files/qa-sketch?preview=card','/api/files/qa-sketch?preview=cover','/api/files/existing-protected-image?preview=card',
 ])for(const method of ['GET','HEAD'])assert.equal(kanbanReadonlyRequest({url:binding.origin+route,method},binding).kind,'continue');
});

test('all writes are aborted before upstream and unexpected write endpoints are denied',()=>{
 const binding=validateKanbanStagingHandoff(input());
 for(const method of ['POST','PUT','PATCH','DELETE','OPTIONS']){
  assert.equal(kanbanReadonlyRequest({url:binding.origin+'/products',method},binding).kind,'abort-non-read');
  assert.equal(kanbanReadonlyRequest({url:binding.origin+'/projects/qa-project',method},binding).kind,'abort-non-read');
  assert.equal(kanbanReadonlyRequest({url:binding.origin+'/api/files/upload',method},binding).kind,'deny');
 }
});

test('cross-origin redirects exports timers unowned details and arbitrary query or image proxy sources are denied',()=>{
 const binding=validateKanbanStagingHandoff(input());
 for(const url of [
  'https://crm.peromebel.by/products','https://example.test/_next/static/app.js',
  ...['/my','/finance/payroll/export','/projects/another','/products/another','/products?project=foreign','/products?view=table','/products?export=1','/projects/qa-project?tab=finance','/api/files/image?view=1','/api/files/image?url=https://example.test','/_next/image?url=https://example.test/image.png','/login'].map(route=>binding.origin+route),
 ])assert.equal(kanbanReadonlyRequest({url,method:'GET'},binding).kind,'deny');
 assert.equal(kanbanReadonlyRequest({url:binding.origin+'/my',method:'GET',prefetch:true},binding).kind,'abort-prefetch');
 assert.equal(kanbanReadonlyRequest({url:'https://crm.peromebel.by/my',method:'GET',prefetch:true},binding).kind,'deny');
});

test('cover geometry requires loaded 3:4 centered proportional filling with no gutters',()=>{
 const metrics={width:240,height:320,loaded:true,fit:'cover',position:'50% 50%',gaps:{left:0,right:0,top:0,bottom:0}};
 assert.equal(kanbanCoverGeometryValid(metrics),true);
 for(const patch of [{height:60},{height:2400},{fit:'fill'},{fit:'contain'},{position:'0% 0%'},{loaded:false},{gaps:{...metrics.gaps,bottom:2}}])assert.equal(kanbanCoverGeometryValid({...metrics,...patch}),false);
});
function bootstrap(fakeNavigator){return runInNewContext('('+disableKanbanQaServiceWorkerApi.toString()+')();',{navigator:fakeNavigator});}

test('unsupported SW bootstrap skips registration when the API is already absent',()=>{
 const navigator={language:'ru-RU',userAgent:'synthetic'};bootstrap(navigator);
 assert.equal('serviceWorker' in navigator,false);assert.equal(navigator.language,'ru-RU');
});

test('unsupported SW bootstrap removes a configurable prototype API without invoking its getter or registration',()=>{
 let accessed=0;const prototype={};Object.defineProperty(prototype,'serviceWorker',{configurable:true,get(){accessed++;return{register(){throw Error('REGISTRATION_MUST_NOT_RUN')}};}});
 Object.defineProperty(prototype,'language',{value:'ru-RU',configurable:false});const navigator=Object.create(prototype),before=Object.getOwnPropertyDescriptor(prototype,'language');
 bootstrap(navigator);assert.equal('serviceWorker' in navigator,false);assert.equal(accessed,0);assert.deepEqual(Object.getOwnPropertyDescriptor(prototype,'language'),before);
 // This is Serwist's exact unsupported-API gate, not a fake registration result.
 let serwistBooted=false;if('serviceWorker' in navigator)serwistBooted=true;assert.equal(serwistBooted,false);
});

test('unsupported SW bootstrap removes a configurable own API and preserves unrelated descriptors',()=>{
 const navigator={language:'ru-RU'};Object.defineProperty(navigator,'serviceWorker',{value:{register(){}},configurable:true});const before=Object.getOwnPropertyDescriptor(navigator,'language');
 bootstrap(navigator);assert.equal('serviceWorker' in navigator,false);assert.deepEqual(Object.getOwnPropertyDescriptor(navigator,'language'),before);
});

test('unsupported SW bootstrap stops on a non-configurable prototype or own API instead of mocking it',()=>{
 for(const onPrototype of [true,false]){
  let accessed=0;const prototype={},navigator=Object.create(prototype),owner=onPrototype?prototype:navigator;
  Object.defineProperty(owner,'serviceWorker',{configurable:false,get(){accessed++;return{};}});
  assert.throws(()=>bootstrap(navigator),/K114_SW_API_DISABLE_FAILED/);assert.equal('serviceWorker' in navigator,true);assert.equal(accessed,0);
 }
});

test('unsupported SW bootstrap fails closed if deleting a shadow leaves an inherited API visible',()=>{
 const prototype={};Object.defineProperty(prototype,'serviceWorker',{value:{},configurable:true});const navigator=Object.create(prototype);Object.defineProperty(navigator,'serviceWorker',{value:{},configurable:true});
 assert.throws(()=>bootstrap(navigator),/K114_SW_API_DISABLE_FAILED/);assert.equal('serviceWorker' in navigator,true);
});
