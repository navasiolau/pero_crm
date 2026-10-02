import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {test} from 'node:test';
const source=readFileSync(new URL('./product-attachments-session.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/await main\(\);\s*$/,'');
function load(env={},platform='win32') {
 const process={env:{CRM_MODERNIZATION_TARGET:'local',DATABASE_URL:'postgresql://u:p@localhost:5433/pero_crm',AUTH_SECRET:'test-only-secret',...env},platform};
 const tokenCalls=[];
 const api=Function('createHash','createHmac','randomUUID','timingSafeEqual','process','encode',`${source};return {readEnvelope,environmentGuard,prepare,resume,restore,validateCheckpoint,validateOwnWrites,buildRestorePlan,checkpointSignature};`)(createHash,createHmac,randomUUID,timingSafeEqual,process,async options=>{tokenCalls.push(options);return 'private-test-token'});
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
 assert.deepEqual(Object.keys(result.profiles),['admin','manager','combined','engineer']);assert.equal(result.originalPreferences.length,12);
 assert.deepEqual(new Set(result.originalPreferences.map(r=>r.key)),new Set(['projects.list','project.tab','product.tab']));
 assert.equal(result.paths.engineerProject,'/projects/project');assert.equal(result.paths.project,'/projects/project');
 assert.equal(tokenCalls.length,8);assert.ok(tokenCalls.every(call=>call.maxAge===900));assert.equal(tokenCalls.find(call=>call.token.id==='a').token.sessionVersion,4);
 assert.equal(f.mutations,0);assert.equal(result.checkpoint.namespace,'PERO_PRODUCT_ATTACHMENTS_SESSION_V1');
 const changed=structuredClone(result.checkpoint);changed.profiles.admin.id='other';assert.throws(()=>api.validateCheckpoint(changed,'test-only-secret'),/SIGNATURE_MISMATCH/);
});
test('missing combined stays unavailable and admin is required',async()=>{
 const {api}=load();const f=fixture(false);const result=await api.prepare(f.db,'test-only-secret');assert.equal(result.availability.combined,false);assert.equal(result.originalPreferences.length,9);
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
 const {api}=load();const f=fixture(false);f.users.push({id:'accountant',roles:['ACCOUNTANT'],active:true,sessionVersion:1},{id:'worker',roles:['WORKER'],active:true,sessionVersion:2},{id:'mounter',roles:['MOUNTER'],active:true,sessionVersion:3});const initial=structuredClone(f.users);const result=await api.prepare(f.db,'test-only-secret');assert.equal(result.originalPreferences.length,18);assert.equal(result.availability.accountant,true);assert.equal(result.availability.worker,true);assert.equal(result.availability.mounter,true);assert.deepEqual(f.users,initial);assert.equal(f.mutations,0);
});
test('project prefs preserve unchanged business fingerprint protection',async()=>{
 const {api}=load();const f=fixture(false);const result=await api.prepare(f.db,'test-only-secret');f.prefs.push({userId:'a',key:'project.tab',value:'files'});f.changeProtectedData();await assert.rejects(api.restore(f.db,'test-only-secret',result.checkpoint,[{userId:'a',key:'project.tab',value:'files'}]),/BUSINESS_AUDIT_OR_TIME_CHANGED_BEFORE_RESTORE/);assert.equal(f.mutations,0);
});

test('20 product tab preferences are exact raw successful values and cannot cross scope',()=>{const {api}=load();const originals=[{userId:'u',key:'product.tab',value:null}];for(const value of ['percentage','engineering','tasks','materials','files','history'])assert.equal(api.validateOwnWrites(originals,[{userId:'u',key:'product.tab',value}]).size,1);assert.throws(()=>api.validateOwnWrites(originals,[{userId:'u',key:'product.tab',value:'finance'}]));});

test('local resume uses current exact actors/session versions and retains immutable CP despite pending own business changes',async()=>{
 const {api,tokenCalls}=load(),f=fixture(),prepared=await api.prepare(f.db,'test-only-secret'),before=JSON.stringify(prepared.checkpoint);
 tokenCalls.length=0;f.users[0].sessionVersion=99;f.changeProtectedData();
 const result=await api.resume(f.db,'test-only-secret',prepared.checkpoint);
 assert.equal(result.status,'RESUMED');assert.equal(result.checkpointSignature,prepared.checkpoint.signature);assert.equal(JSON.stringify(prepared.checkpoint),before);assert.equal(f.mutations,0);
 assert.equal(tokenCalls.length,8);assert.ok(tokenCalls.every(call=>call.maxAge===900));assert.equal(tokenCalls.find(call=>call.token.id==='a').token.sessionVersion,99);assert.ok(Object.values(result.profiles).every(profile=>profile.canVisitMy===false));assert.ok(!('dataIntegrity' in result)&&!('checkpoint' in result));
});
test('resume rejects forged CP, inactive/changed roles/invalid version before token generation and refuses staging without DB use',async()=>{
 const {api,process,tokenCalls}=load(),f=fixture(),prepared=await api.prepare(f.db,'test-only-secret');tokenCalls.length=0;
 const forged=structuredClone(prepared.checkpoint);forged.profiles.admin.id='other';await assert.rejects(api.resume(f.db,'test-only-secret',forged),/SIGNATURE_MISMATCH/);
 f.users[0].active=false;await assert.rejects(api.resume(f.db,'test-only-secret',prepared.checkpoint),/USER_IDENTITY_CHANGED/);f.users[0].active=true;
 f.users[0].roles=['DIRECTOR'];await assert.rejects(api.resume(f.db,'test-only-secret',prepared.checkpoint),/USER_IDENTITY_CHANGED/);f.users[0].roles=['ADMIN'];f.users[0].sessionVersion=-1;await assert.rejects(api.resume(f.db,'test-only-secret',prepared.checkpoint),/SESSION_VERSION_INVALID/);
 assert.equal(tokenCalls.length,0);process.env.CRM_MODERNIZATION_TARGET='staging';await assert.rejects(api.resume({$transaction(){throw Error('DB must not be used')}},'test-only-secret',prepared.checkpoint),/LOCAL_SESSION_RESUME_ONLY/);
});

test('explicit correction prepare captures products.list only for eligible captured actors without changing default scope',async()=>{
 const {api}=load(),f=fixture(false);f.users.push({id:'accountant',roles:['ACCOUNTANT'],active:true,sessionVersion:1},{id:'worker',roles:['WORKER'],active:true,sessionVersion:1},{id:'mounter',roles:['MOUNTER'],active:true,sessionVersion:1});
 const prior=JSON.stringify({version:1,revision:randomUUID(),query:'view=table'});f.prefs.push({userId:'a',key:'products.list',value:prior});
 const old=await api.prepare(f.db,'test-only-secret');assert.equal(Object.hasOwn(old.checkpoint,'correctionMode'),false);assert.equal(old.originalPreferences.length,18);assert.equal(old.originalPreferences.some(row=>row.key==='products.list'),false);
 const current=await api.prepare(f.db,'test-only-secret',true);assert.equal(current.checkpoint.correctionMode,true);assert.equal(current.checkpoint.namespace,old.checkpoint.namespace);assert.equal(current.originalPreferences.length,22);
 assert.deepEqual(current.originalPreferences.filter(row=>row.key==='products.list').map(row=>row.userId),['a','m','e','accountant']);assert.equal(current.originalPreferences.find(row=>row.userId==='a'&&row.key==='products.list').value,prior);assert.equal(f.mutations,0);
 assert.equal(api.validateCheckpoint(old.checkpoint,'test-only-secret').length,18);assert.equal(api.validateCheckpoint(current.checkpoint,'test-only-secret').length,22);
});

test('old signed checkpoint cannot authorize products.list, missing signed flag/key sets are rejected',async()=>{
 const {api}=load(),f=fixture(),old=await api.prepare(f.db,'test-only-secret');const value=JSON.stringify({version:1,revision:randomUUID(),query:'view=kanban&q=205.1'});
 assert.throws(()=>api.validateOwnWrites(api.validateCheckpoint(old.checkpoint,'test-only-secret'),[{userId:'a',key:'products.list',value}]),/OWN_WRITE_NOT_ALLOWLISTED/);
 const unsigned=structuredClone(old.checkpoint);unsigned.correctionMode=true;assert.throws(()=>api.validateCheckpoint(unsigned,'test-only-secret'),/SIGNATURE_MISMATCH/);
 unsigned.signature=api.checkpointSignature(unsigned,'test-only-secret');assert.throws(()=>api.validateCheckpoint(unsigned,'test-only-secret'),/EXACT_ORIGINAL_PREFERENCE_SET_REQUIRED/);
 const injected=structuredClone(old.checkpoint);injected.originalPreferences.push({userId:'a',key:'products.list',value:null});injected.signature=api.checkpointSignature(injected,'test-only-secret');assert.throws(()=>api.validateCheckpoint(injected,'test-only-secret'),/EXACT_ORIGINAL_PREFERENCE_SET_REQUIRED/);
});

test('correction products.list restore uses exact captured ACK CAS and retains old namespace/checkpoint',async()=>{
 const {api}=load(),f=fixture(false),previous=JSON.stringify({version:1,revision:randomUUID(),query:'view=table'});f.prefs.push({userId:'a',key:'products.list',value:previous});const prepared=await api.prepare(f.db,'test-only-secret',true),immutable=JSON.stringify(prepared.checkpoint);
 const owned=JSON.stringify({version:1,revision:randomUUID(),query:'view=kanban&q=205.1'});f.prefs[0].value=owned;
 const result=await api.restore(f.db,'test-only-secret',prepared.checkpoint,[{userId:'a',key:'products.list',value:owned}]);assert.equal(result.status,'RESTORED');assert.equal(f.prefs[0].value,previous);assert.equal(result.counts.restored,1);assert.equal(JSON.stringify(prepared.checkpoint),immutable);
 f.prefs[0].value=owned;f.prefs.push({userId:'m',key:'products.list',value:owned});const before=structuredClone(f.prefs),mutations=f.mutations;
 await assert.rejects(api.restore(f.db,'test-only-secret',prepared.checkpoint,[{userId:'a',key:'products.list',value:owned}]),/PREFERENCE_CONFLICT/);assert.deepEqual(f.prefs,before);assert.equal(f.mutations,mutations);
});

test('correction envelope and new ACK query remain narrow and bounded without increasing old input limits',async()=>{
 const {api,process}=load();for(const input of [{operation:'prepare'},{operation:'prepare',correctionMode:true}]){process.env.CRM_STAGING_BROWSER_INPUT=Buffer.from(JSON.stringify(input)).toString('base64');assert.deepEqual(api.readEnvelope(),input);}
 for(const input of [{operation:'prepare',correctionMode:false},{operation:'resume',checkpoint:{},correctionMode:true},{operation:'prepare',productsList:true}]){process.env.CRM_STAGING_BROWSER_INPUT=Buffer.from(JSON.stringify(input)).toString('base64');assert.throws(()=>api.readEnvelope(),/INPUT_FIELDS_INVALID/);}
 const prepared=await api.prepare(fixture(false).db,'test-only-secret',true),originals=api.validateCheckpoint(prepared.checkpoint,'test-only-secret');
 const encode=query=>JSON.stringify({version:1,revision:randomUUID(),query});assert.equal(api.validateOwnWrites(originals,[{userId:'a',key:'products.list',value:encode('view=kanban&q=205.1')}]).size,1);
 for(const query of ['view=table&q=205.1','view=kanban&q=foreign','view=kanban&q=205.1&engineer=foreign','view=kanban&q='+('1'.repeat(1100))])assert.throws(()=>api.validateOwnWrites(originals,[{userId:'a',key:'products.list',value:encode(query)}]));
 process.env.CRM_STAGING_BROWSER_INPUT='A'.repeat(96*1024+4);assert.throws(()=>api.readEnvelope(),/PRIVATE_INPUT_REQUIRED_OR_TOO_LARGE/);
});
