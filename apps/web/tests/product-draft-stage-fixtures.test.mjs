import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tags,stageGuard,sign,verifySigned,validatePluginPolicy,validateJournal,validateManager,compareOrgClock,originalMatch,exactCleanupState,prepare,RETIRED_FILE_STAGES_POLICY,PREFERENCE_KEYS} from './product-draft-stage-fixtures.mjs';
import {getManifest,listManifests} from '../src/server/plugins/registry.ts';

const runId='11111111-1111-4111-8111-111111111111',revision='b'.repeat(40),secret='QA_OWNERSHIP_SIGNATURE_ONLY';
const input={authorized:true,runId,revision};
const ids={actor:'22222222-2222-4222-8222-222222222222',client:'33333333-3333-4333-8333-333333333333',projectB:'44444444-4444-4444-8444-444444444444'};
const createdAt='2026-10-09T10:00:00.000Z';
const preBody={namespace:'PERO_PRODUCT_DRAFT_STAGE_QA_111_V1',kind:'pre',runId,revision,createdAt,ids,tags:tags(runId),prefsOriginal:Object.fromEntries(PREFERENCE_KEYS.map(key=>[key,null])),noHookPolicy:null,baseline:{}};
const pre=sign(preBody,secret);
const clone=value=>JSON.parse(JSON.stringify(value));
const fp=(hash='a',count='1')=>({count,hash:hash.repeat(64)});
function journal(){return {runId,revision,actions:[],preferences:{'projects.list':null,'products.list':null}};}
function intent(kind='project-stage'){return {id:'55555555-5555-4555-8555-555555555555',kind,atISO:'2026-10-09T10:00:01.000Z',ack:{atISO:'2026-10-09T10:00:02.000Z'}};}
const manager={id:ids.actor,active:true,sessionVersion:0,payScheme:'NONE',passwordDisabled:true,roles:['MANAGER']};

test('fresh signed ownership rejects old namespace, changed scope, wrong revision and forged MAC',()=>{
 assert.equal(verifySigned(pre,secret,'pre',input).ids.actor,ids.actor);
 for(const value of [{...pre,namespace:'PERO_ENGINEER_SKETCH_QA_112_V1'},{...pre,revision:'c'.repeat(40)},{...pre,ids:{...ids,actor:ids.client}},{...pre,signature:'0'.repeat(64)}])assert.throws(()=>verifySigned(value,secret,'pre',input));
 assert.throws(()=>verifySigned(pre,'OTHER_KEY','pre',input));
});
test('deterministic tags have ten unique product slots and two distinct QA projects',()=>{
 const value=tags(runId);assert.equal(value.products.length,10);assert.equal(new Set(value.products).size,10);
 assert.ok(value.products.every((label,index)=>label.endsWith(String(index+1).padStart(2,'0'))));
 assert.notEqual(value.projectA,value.projectB);assert.throws(()=>tags('legacy-deleted-run'));
});
test('physical staging guard rejects production, alternate DB route and mismatched actual revision',()=>{
 const proof={hostname:'crm-staging',revision,databaseVolume:'crm-staging_pgdata',outerW07Sha256:'d'.repeat(64),web:'a'.repeat(64),database:'c'.repeat(64)};
 const env={CRM_MODERNIZATION_TARGET:'staging',DATABASE_URL:'postgresql://qa:qa@db:5432/crm?schema=public',CRM_FILE_STORAGE:'s3',S3_BUCKET:'pero-crm-staging',S3_ENDPOINT:'http://192.168.0.33:9000',CRM_MODERNIZATION_STAGE_PROOF:JSON.stringify(proof),AUTH_SECRET:'QA_GUARD_ONLY',S3_ACCESS_KEY:'QA_DUMMY',S3_SECRET_KEY:'QA_DUMMY'};
 const container={host:'a'.repeat(12),docker:true};assert.equal(stageGuard(input,env,container).proof.revision,revision);
 for(const patch of [{CRM_MODERNIZATION_TARGET:'production'},{DATABASE_URL:'postgresql://qa:qa@localhost:5433/pero_crm'},{DATABASE_URL:env.DATABASE_URL+'&options=unsafe'},{S3_BUCKET:'pero-crm'},{CRM_MODERNIZATION_STAGE_PROOF:JSON.stringify({...proof,revision:'e'.repeat(40)})}])assert.throws(()=>stageGuard(input,{...env,...patch},container));
});
test('enabled registered/unknown plugins stop before effects; only revision-bound retired file-stages absent from actual registry is accepted',()=>{
 validatePluginPolicy([],input);
 const policy={...input,noHookPolicy:{revision,plugins:[RETIRED_FILE_STAGES_POLICY]}};
 validatePluginPolicy([{id:'file-stages',version:'0.1.0',apiVersion:1}],policy);
 let effects=0;const afterPreflight=(rows,value=policy)=>{validatePluginPolicy(rows,value);effects++;};
 for(const rows of [[{id:'demo',version:'0.1.0',apiVersion:1}],[{id:'unknown',version:'0.1.0',apiVersion:1}],[{id:'file-stages',version:'0.2.0',apiVersion:1}],[{id:'file-stages',version:'0.1.0',apiVersion:2}]])assert.throws(()=>afterPreflight(rows));
 assert.throws(()=>validatePluginPolicy([{id:'file-stages',version:'0.1.0',apiVersion:1}],input));
 assert.throws(()=>afterPreflight([{id:'file-stages',version:'0.1.0',apiVersion:1}],{...policy,noHookPolicy:{revision:'c'.repeat(40),plugins:[RETIRED_FILE_STAGES_POLICY]}}));
 assert.throws(()=>afterPreflight([{id:'file-stages',version:'0.1.0',apiVersion:1}],{...policy,noHookPolicy:{revision,plugins:[{...RETIRED_FILE_STAGES_POLICY,sourceHash:'d'.repeat(64)}]}}));
 const manifests=listManifests(),registered={id:'file-stages',version:'0.1.0',apiVersion:1,name:'QA registered hook',permissions:[],hooks:{onDomainEvent:async()=>{throw Error('HOOK_MUST_NOT_RUN');}}};
 assert.equal(getManifest('file-stages'),undefined);assert.equal(typeof getManifest('demo')?.hooks?.onDomainEvent,'function');
 manifests.push(registered);
 try{assert.throws(()=>afterPreflight([{id:'file-stages',version:'0.1.0',apiVersion:1}]),/ENABLED_PLUGIN_REGISTERED_STOP/);}
 finally{assert.equal(manifests.pop(),registered);}
 assert.equal(effects,0);assert.equal(getManifest('file-stages'),undefined);
});
test('current actor requires exact fresh MANAGER role, active flag, session version and NONE pay',()=>{
 validateManager(manager,pre);
 for(const patch of [{id:ids.client},{active:false},{sessionVersion:1},{roles:['MANAGER','ENGINEER']},{roles:['ADMIN']},{payScheme:'PERCENT_PROJECT'},{passwordDisabled:false}])assert.throws(()=>validateManager({...manager,...patch},pre));
});
test('durable PRE hash and fsync are required before any DB call',async()=>{
 let calls=0;const db={$transaction(){calls++;throw Error('DB_MUST_NOT_BE_CALLED');}};
 for(const durablePre of [{hash:'0'.repeat(64),fsynced:true},{hash:'0'.repeat(64),fsynced:false},{hash:'broken',fsynced:true}])await assert.rejects(()=>prepare(db,{...input,durablePre},pre,secret));
 assert.equal(calls,0);
});
test('journal accepts agreed IN_WORK/DESIGN and rejects completed/monetary transition scope',()=>{
 const value=journal();value.actions=[{...intent(),toStage:'IN_WORK'}];validateJournal(value,pre,{complete:true});
 value.actions=[{...intent('product-status'),toStatus:'DESIGN'}];validateJournal(value,pre,{complete:true});
 for(const changes of [{toStage:'DONE'},{toStage:'IN_PROGRESS'},{toStatus:'PRODUCTION'},{toStatus:'DONE'}]){const invalid=journal();invalid.actions=[{...intent(),...changes}];assert.throws(()=>validateJournal(invalid,pre));}
});
test('one lost response may be inspected but cannot be cleaned or blindly stacked',()=>{
 const value=journal();value.actions=[{...intent('product-create'),productTitle:pre.tags.products[0],ack:null}];validateJournal(value,pre);
 assert.throws(()=>validateJournal(value,pre,{complete:true}));
 value.actions.push({...intent('project-create'),id:'66666666-6666-4666-8666-666666666666',ack:null});assert.throws(()=>validateJournal(value,pre));
});
test('fresh product intent tags are exact; generated UI numeric Project ids are supported',()=>{
 const value=journal();value.actions=[{...intent('project-create'),ack:{atISO:'2026-10-09T10:00:02.000Z',projectId:'210'}}];validateJournal(value,pre);
 value.actions=[{...intent('product-create'),productTitle:'original customer furniture'}];assert.throws(()=>validateJournal(value,pre));
 value.actions=[{...intent('project-create'),projectId:'../real'}];assert.throws(()=>validateJournal(value,pre));
});
test('two composite preference keys use exact opaque lastACK and explicit pending key',()=>{
 const value=journal();value.actions=[{...intent('preference'),preferenceKey:'products.list',ack:null}];validateJournal(value,pre);
 value.actions[0].preferenceKey='products.view';assert.throws(()=>validateJournal(value,pre));
 const bad=journal();bad.preferences['other.key']='foreign';assert.throws(()=>validateJournal(bad,pre));
 value.actions=[{...intent('preference'),preferenceKey:'projects.list',ack:{atISO:'2026-10-09T10:00:02.000Z',value:'opaque full stored envelope'}}];value.preferences['projects.list']='opaque full stored envelope';validateJournal(value,pre,{complete:true});
});
test('exact cleanup CAS rejects changed row hash, preference envelope and graph binding',()=>{
 const current={rows:{Product:[{id:'qa-product',hash:'a'.repeat(64)}]},preferences:[{userId:ids.actor,key:'products.list',value:'ack',hash:'b'.repeat(64)}],scopegraph:{projectA:{id:'210'},projectB:{id:ids.projectB},products:[]}};
 const observation=clone(current);exactCleanupState(current,observation);
 for(const changed of [
  {...clone(current),rows:{Product:[{id:'qa-product',hash:'c'.repeat(64)}]}},
  {...clone(current),preferences:[{userId:ids.actor,key:'products.list',value:'later',hash:'b'.repeat(64)}]},
  {...clone(current),scopegraph:{projectA:{id:'211'},projectB:{id:ids.projectB},products:[]}},
 ])assert.throws(()=>exactCleanupState(changed,observation));
});
test('samevalue bot clock allows only monotonic updatedAt; all other fields/rows remain exact',()=>{
 const before={full:fp(),otherRows:fp('b'),bot:{key:'telegram.botUsername',valueHash:'c'.repeat(64),stableFieldsHash:'d'.repeat(64),updatedAt:createdAt}};
 assert.deepEqual(compareOrgClock(before,clone(before)),{changed:false});
 const after=clone(before);after.bot.updatedAt='2026-10-09T10:01:00.000Z';after.full=fp('e');assert.deepEqual(compareOrgClock(before,after),{changed:true});
 for(const changed of [{...clone(after),otherRows:fp('f')},{...clone(after),bot:{...after.bot,valueHash:'f'.repeat(64)}},{...clone(after),bot:{...after.bot,stableFieldsHash:'f'.repeat(64)}},{...clone(after),bot:{...after.bot,updatedAt:'2026-10-09T09:00:00.000Z'}}])assert.throws(()=>compareOrgClock(before,changed));
});
function baseline(){
 const token={kind:'crm-api-token-clock',version:1,capturedAt:'2026-10-09T10:00:00.000Z',stable:fp('a'),legacyStable:{count:'1',hash:'a'.repeat(32)},full:fp('b'),tokens:[{idHash:'c'.repeat(64),lastUsedAt:null}]};
 const org={full:fp('d'),otherRows:fp('e','0'),bot:{key:'telegram.botUsername',valueHash:'f'.repeat(64),stableFieldsHash:'a'.repeat(64),updatedAt:createdAt}};
 return {tables:['ApiToken','OrgSetting','Payment','User'],rows:{ApiToken:token.full,OrgSetting:org.full,Payment:fp('f'),User:fp('a')},schema:'b'.repeat(64),apiClock:token,botClock:org};
}
test('fresh original comparison accepts only common hashed-id token clock plus same-value bot clock',()=>{
 const before=baseline(),after=clone(before);after.apiClock.capturedAt='2026-10-09T10:02:00.000Z';after.apiClock.tokens[0].lastUsedAt='2026-10-09T10:01:00.000Z';after.apiClock.full=fp('c');after.rows.ApiToken=after.apiClock.full;
 assert.deepEqual(originalMatch(after,before),{originalsPreserved:true,apiClockChanged:true,botClockChanged:false});
 for(const changed of [
  {...clone(after),rows:{...after.rows,Payment:fp('a')}},
  {...clone(after),schema:'e'.repeat(64)},
  {...clone(after),apiClock:{...after.apiClock,stable:fp('f')}},
  {...clone(after),apiClock:{...after.apiClock,tokens:[{idHash:'d'.repeat(64),lastUsedAt:null}]}},
 ])assert.throws(()=>originalMatch(changed,before));
});
test('clock evidence cannot be used to excuse incoherent full snapshot or retroactive stable-field drift',()=>{
 const before=baseline(),after=clone(before);after.rows.ApiToken=fp('f');assert.throws(()=>originalMatch(after,before));
 const drifting=clone(before);drifting.apiClock.stable=fp('f');drifting.apiClock.full=fp('f');drifting.rows.ApiToken=drifting.apiClock.full;assert.throws(()=>originalMatch(drifting,before));
});

test('a lost response cannot be followed by another actual action, even with a later ACK',()=>{
 const value=journal();value.actions=[{...intent('project-create'),ack:null},{...intent('project-stage'),id:'66666666-6666-4666-8666-666666666666',atISO:'2026-10-09T10:00:03.000Z',ack:{atISO:'2026-10-09T10:00:04.000Z'}}];
 assert.throws(()=>validateJournal(value,pre),/ACTION_AFTER_LOST_RESPONSE/);
});
test('preference value cannot be fabricated without ACK or differ from latest exact ACK',()=>{
 const missing=journal();missing.preferences['products.list']='not-acknowledged';assert.throws(()=>validateJournal(missing,pre),/PREFERENCE_VALUE_WITHOUT_ACK/);
 const stale=journal();stale.actions=[{...intent('preference'),preferenceKey:'products.list',ack:{atISO:'2026-10-09T10:00:02.000Z',value:'latest-ack'}}];stale.preferences['products.list']='old-ack';assert.throws(()=>validateJournal(stale,pre),/PREFERENCE_LAST_ACK_VALUE_REQUIRED/);
});
test('capture blocks an original project referencing the QA manager before any deletion or auth operation',async()=>{
 const {capture}=await import('./product-draft-stage-fixtures.mjs');
 const proofRow=id=>({id,hash:'a'.repeat(64),created:'2026-10-09T10:00:01.000Z',updated:'2026-10-09T10:00:01.000Z'});
 let execCalls=0,inboundChecked=false;
 const tx={
  async $executeRawUnsafe(sql){execCalls++;assert.equal(sql,'SET TRANSACTION READ ONLY');return 0;},
  async $queryRawUnsafe(sql){
   if(sql.includes('current_database()'))return [{name:'crm',schema:'public',readonly:'on',primary:true}];
   if(sql.includes('FROM "Plugin"'))return [];
   if(sql.startsWith('SELECT id,roles'))return [{...manager,tagOK:true}];
   if(sql.startsWith('SELECT id,(name='))return [{id:ids.client,valid:true}];
   if(sql.startsWith('SELECT id,number,stage::text'))return [{id:ids.projectB,number:'210',stage:'PAUSED',title:pre.tags.projectB,clientId:ids.client,managerId:ids.actor,createdById:ids.actor,deletedAt:null,coverFileId:null,currency:'BYN'}];
   if(sql.includes('FROM pg_constraint'))return [{name:'Project_managerId_fkey',source_schema:'public',source:'Project',target:'User',sc:['managerId'],tc:['id']}];
   if(sql.includes('FROM "Project" s JOIN "User" r')){inboundChecked=true;return [{n:1}];}
   if(sql.startsWith('SELECT count(*)::int'))return [{n:0}];
   if(sql.startsWith('SELECT t.id')){
    if(sql.includes('FROM "User"'))return [proofRow(ids.actor)];
    if(sql.includes('FROM "Client"'))return [proofRow(ids.client)];
    if(sql.includes('FROM "Project" t'))return [proofRow(ids.projectB)];
    return [];
   }
   if(sql.includes('FROM "Product" WHERE'))return [];
   if(sql.includes('FROM "UserPreference"'))return [];
   throw Error('UNEXPECTED_FAKE_QUERY');
  }
 };
 const db={async $transaction(work){return work(tx);}};
 await assert.rejects(()=>capture(db,input,pre,journal(),secret),/UNKNOWN_INBOUND_REFERENCE/);
 assert.equal(execCalls,1);assert.equal(inboundChecked,true);
});
