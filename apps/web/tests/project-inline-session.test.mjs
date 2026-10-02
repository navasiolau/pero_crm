import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {test} from 'node:test';
const source=readFileSync(new URL('./project-inline-session.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/await main\(\);\s*$/,'');
function load(env={},platform='win32') {
 const process={env:{CRM_MODERNIZATION_TARGET:'local',DATABASE_URL:'postgresql://u:p@localhost:5433/pero_crm',AUTH_SECRET:'test-only-secret',...env},platform};
 const tokenCalls=[];
 const api=Function('createHash','createHmac','randomUUID','timingSafeEqual','process','encode',`${source};return {environmentGuard,prepare,restore,validateCheckpoint,validateOwnWrites,buildRestorePlan,checkpointSignature};`)(createHash,createHmac,randomUUID,timingSafeEqual,process,async options=>{tokenCalls.push(options);return 'private-test-token'});
 return {api,process,tokenCalls};
}
function fixture(combined=true){
 const users=[{id:'a',roles:['ADMIN'],active:true,sessionVersion:4},{id:'m',roles:['MANAGER'],active:true,sessionVersion:5},{id:'e',roles:['ENGINEER'],active:true,sessionVersion:6},...(combined?[{id:'c',roles:['ENGINEER','MANAGER'],active:true,sessionVersion:7}]:[])];
 const prefs=[];let readonly=false;let mutations=0;let businessHash="a".repeat(32);
 const tx={
  $executeRawUnsafe:async()=>{readonly=true},
  $queryRawUnsafe:async(sql,...values)=>sql.includes('current_database')?[{name:'pero_crm',schema:'public',readonly:readonly?'on':'off'}]:sql.includes('FOR UPDATE')?prefs.filter(row=>values.includes(row.userId)&&values.includes(row.key)):[{count:1,hash:businessHash}],
  user:{findMany:async()=>users},
  project:{findMany:async()=>[{id:'project',title:'A long BYN project'}]},
  product:{findMany:async()=>[{id:'product',projectId:'project',number:'P-1',title:'Design product',status:'DESIGN',engineerId:'e'}]},
  timeEntry:{findMany:async()=>[]},
  userPreference:{findMany:async()=>prefs,updateMany:async({where,data})=>{const row=prefs.find(r=>r.userId===where.userId&&r.key===where.key&&r.value===where.value);if(!row)return{count:0};row.value=data.value;mutations++;return{count:1}},deleteMany:async({where})=>{const index=prefs.findIndex(r=>r.userId===where.userId&&r.key===where.key&&r.value===where.value);if(index<0)return{count:0};prefs.splice(index,1);mutations++;return{count:1}}},
 };
 const db={$transaction:async fn=>{const before=structuredClone(prefs);readonly=false;try{return await fn(tx)}catch(error){prefs.splice(0,prefs.length,...before);throw error}}};
 return{db,users,prefs,changeProtectedData(){businessHash="b".repeat(32)},get mutations(){return mutations}};
}
test('prepare existing profiles has exact bounded prefs, real session versions and no business writes',async()=>{
 const {api,tokenCalls}=load();const f=fixture();const result=await api.prepare(f.db,'test-only-secret');
 assert.deepEqual(Object.keys(result.profiles),['admin','manager','combined','engineer']);assert.equal(result.originalPreferences.length,8);
 assert.deepEqual(new Set(result.originalPreferences.map(r=>r.key)),new Set(['projects.list','project.tab']));
 assert.equal(result.paths.engineerProject,'/projects/project');assert.equal(result.paths.project,'/projects/project');
 assert.equal(tokenCalls.length,8);assert.ok(tokenCalls.every(call=>call.maxAge===900));assert.equal(tokenCalls.find(call=>call.token.id==='a').token.sessionVersion,4);
 assert.equal(f.mutations,0);assert.equal(result.checkpoint.namespace,'PERO_CRM_PROJECT_INLINE_SESSION_V1');
 const changed=structuredClone(result.checkpoint);changed.profiles.admin.id='other';assert.throws(()=>api.validateCheckpoint(changed,'test-only-secret'),/SIGNATURE_MISMATCH/);
});
test('missing combined stays unavailable and admin is required',async()=>{
 const {api}=load();const f=fixture(false);const result=await api.prepare(f.db,'test-only-secret');assert.equal(result.availability.combined,false);assert.equal(result.originalPreferences.length,6);
 f.users.splice(0,1);await assert.rejects(api.prepare(f.db,'test-only-secret'),/EXISTING_ROLE_COHORT_MISSING/);
});
test('raw successful tab writes and exact normalized list bytes only',()=>{
 const {api}=load();const originals=[{userId:'u',key:'project.tab',value:'history'},{userId:'u',key:'projects.list',value:null}];
 assert.equal(api.validateOwnWrites(originals,[{userId:'u',key:'project.tab',value:'finance'}]).size,1);
 const value=JSON.stringify({version:1,revision:randomUUID(),query:'view=table'});assert.equal(api.validateOwnWrites(originals,[{userId:'u',key:'projects.list',value}]).size,1);
 for(const row of [{userId:'u',key:'product.tab',value:'finance'},{userId:'u',key:'project.tab',value:'history'},{userId:'u',key:'projects.list',value:'view=table'}])assert.throws(()=>api.validateOwnWrites(originals,[row]));
});
test('restore exact owned value CAS deletes missing originals, conflicts roll back without writes',async()=>{
 const {api}=load();const f=fixture(false);const result=await api.prepare(f.db,'test-only-secret');
 f.prefs.push({userId:'a',key:'project.tab',value:'finance'});
 const writes=[{userId:'a',key:'project.tab',value:'finance'}];const restored=await api.restore(f.db,'test-only-secret',result.checkpoint,writes);assert.equal(restored.counts.deleted,1);assert.equal(f.prefs.length,0);
 f.prefs.push({userId:'a',key:'project.tab',value:'finance'},{userId:'m',key:'project.tab',value:'overview'});const before=structuredClone(f.prefs);const previous=f.mutations;
 await assert.rejects(api.restore(f.db,'test-only-secret',result.checkpoint,writes),/PREFERENCE_CONFLICT/);assert.deepEqual(f.prefs,before);assert.equal(f.mutations,previous);
});
test('local and verified staging guards reject remote targets and missing outer proof',()=>{
 assert.equal(load().api.environmentGuard(),'test-only-secret');assert.throws(()=>load({},'linux').api.environmentGuard(),/LOCAL_DATABASE_REQUIRED/);
 assert.throws(()=>load({DATABASE_URL:'postgresql://u:p@production:5433/pero_crm'}).api.environmentGuard(),/LOCAL_DATABASE_REQUIRED/);
 const env={CRM_MODERNIZATION_TARGET:'staging',DATABASE_URL:'postgresql://u:p@db:5432/crm',S3_BUCKET:'pero-crm-staging'};
 assert.throws(()=>load(env,'linux').api.environmentGuard(),/VERIFIED_STAGE_PROOF_REQUIRED/);
 const proof={hostname:'crm-staging',web:'web-id',database:'db-id',revision:'a'.repeat(40),databaseVolume:'crm-staging_pgdata',outerW07Sha256:'b'.repeat(64)};
 assert.equal(load({...env,CRM_MODERNIZATION_STAGE_PROOF:JSON.stringify(proof)},'linux').api.environmentGuard(),'test-only-secret');
 assert.throws(()=>load({...env,CRM_MODERNIZATION_STAGE_PROOF:JSON.stringify({...proof,databaseVolume:'prod'})},'linux').api.environmentGuard(),/VERIFIED_STAGE_PROOF_REQUIRED/);
});

test('project six tabs use exact returned values and cannot cross actor/key scope',()=>{
 const {api}=load();const originals=[{userId:'u',key:'project.tab',value:'communications'}];for(const value of ['overview','products','files','tasks','materials','finance'])assert.equal(api.validateOwnWrites(originals,[{userId:'u',key:'project.tab',value}]).size,1);
 for(const row of [{userId:'u',key:'project.tab',value:'history'},{userId:'u',key:'product.tab',value:'tasks'},{userId:'other',key:'project.tab',value:'tasks'}])assert.throws(()=>api.validateOwnWrites(originals,[row]));
});
test('existing accountant and field cohorts are optional and produce no timer/user changes',async()=>{
 const {api}=load();const f=fixture(false);f.users.push({id:'accountant',roles:['ACCOUNTANT'],active:true,sessionVersion:1},{id:'worker',roles:['WORKER'],active:true,sessionVersion:2},{id:'mounter',roles:['MOUNTER'],active:true,sessionVersion:3});const initial=structuredClone(f.users);const result=await api.prepare(f.db,'test-only-secret');assert.equal(result.originalPreferences.length,12);assert.equal(result.availability.accountant,true);assert.equal(result.availability.worker,true);assert.equal(result.availability.mounter,true);assert.deepEqual(f.users,initial);assert.equal(f.mutations,0);
});
test('project prefs preserve unchanged business fingerprint protection',async()=>{
 const {api}=load();const f=fixture(false);const result=await api.prepare(f.db,'test-only-secret');f.prefs.push({userId:'a',key:'project.tab',value:'files'});f.changeProtectedData();await assert.rejects(api.restore(f.db,'test-only-secret',result.checkpoint,[{userId:'a',key:'project.tab',value:'files'}]),/BUSINESS_AUDIT_OR_TIME_CHANGED_BEFORE_RESTORE/);assert.equal(f.mutations,0);
});
