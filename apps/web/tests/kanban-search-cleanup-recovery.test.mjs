import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,unlinkSync,rmdirSync,realpathSync} from 'node:fs';
import path from 'node:path';
import {SEARCH117_NAMESPACE,plan117,ownedQuery117,sign117,digest117,bytes117} from './kanban-search-owned-protocol.mjs';
import {derive117CleanupRecovery,create117RecoveryLogDirectory} from './kanban-search-cleanup-recovery.mjs';
const options={authorized:true,runId:'b1111111-1111-4111-8111-111111111111',revision:'a'.repeat(40),knownRefusal:{code:'BROWSER_INPUT_TOO_LARGE',operation:'restore',toolChunkId:'6e7d68',boundary:'protected-wrapper-before-container-dispatch'}};
function fixtures(){const plan=plan117(options);plan.number='199';const secret='controlled-only-test-secret',sources={producer:'a'.repeat(64)},identity={hostname:'crm-staging',revision:options.revision,databaseVolume:'crm-staging_pgdata',web:'b'.repeat(64),image:'sha256:'+'c'.repeat(64),database:'d'.repeat(64),outerW07Sha256:'e'.repeat(64)};
 const pre=sign117({namespace:SEARCH117_NAMESPACE,version:1,kind:'pre',runId:options.runId,revision:options.revision,plan,sources},secret),cp=sign117({namespace:SEARCH117_NAMESPACE,version:1,kind:'checkpoint',runId:options.runId,revision:options.revision,preSha256:digest117(pre)},secret),events=[];let old=null;
 for(let n=0;n<100;n++){const requestId=randomUUID(),query=ownedQuery117('products','199.1',plan),value=JSON.stringify({version:2,revision:randomUUID(),query});events.push({sequence:events.length+1,kind:'INTENT',runId:options.runId,revision:options.revision,actorId:plan.ids.actor,requestId,section:'products',key:'products.list',query,expected:old,actionId:'a'.repeat(42),bodySha256:'b'.repeat(64)});events.push({sequence:events.length+1,kind:'ACK',runId:options.runId,revision:options.revision,actorId:plan.ids.actor,requestId,key:'products.list',value,httpStatus:200,responseSha256:'c'.repeat(64)});old=value;}
 const obs=sign117({namespace:SEARCH117_NAMESPACE,version:1,kind:'observation',runId:options.runId,revision:options.revision,preSha256:digest117(pre),checkpointHash:digest117(cp),eventHash:digest117(events),preferences:[{userId:plan.ids.actor,key:'products.list',value:old}]},secret),intent={runId:options.runId,revision:options.revision,observationSha256:digest117(obs),eventHash:digest117(events)},browser={status:'BROWSER_CHECKS_PASSED_CLEANUP_REQUIRED',runId:options.runId,revision:options.revision,requestsDrained:true,unresolvedIntents:0};
 const artifact=value=>({sha256:bytes117(Buffer.from(JSON.stringify(value))),value});return{pre:artifact({value:pre,sources,receipt:{identity:structuredClone(identity)}}),checkpoint:artifact({value:cp,sources,receipt:{identity:structuredClone(identity)}}),observation:artifact({value:obs,sources,receipt:{identity:structuredClone(identity)}}),'cleanup-events':artifact(events),'cleanup-intent':artifact(intent),'browser-result':artifact(browser)};}

test('known remote precontainer refusal recovers EXACT original signed input with unchanged minimal restore envelope/caps',()=>{
 const a=fixtures(),before=structuredClone(a),plan=derive117CleanupRecovery(a,options);assert.deepEqual(a,before);assert.equal(plan.fullInput.pre,a.pre.value.value);assert.equal(plan.fullInput.checkpoint,a.checkpoint.value.value);assert.equal(plan.fullInput.observation,a.observation.value.value);assert.equal(plan.fullInput.events,a['cleanup-events'].value);assert.equal(plan.originalIntentSha256,a['cleanup-intent'].sha256);assert.ok(plan.base64Chars>96*1024);assert.equal(plan.envCap,96*1024);assert.ok(Buffer.from(JSON.stringify(plan.minimalInput)).toString('base64').length<96*1024);assert.deepEqual(Object.keys(plan.minimalInput),['operation','phase','authorized','runId','revision']);assert.equal(plan.minimalInput.operation,'restore');assert.equal(plan.fullInput.phase,'cleanup');
});

test('unknown outcome wrong boundary or noncap refusal cannot authorize retry',()=>{
 for(const knownRefusal of [{...options.knownRefusal,code:'WRAPPER_FAILED'},{...options.knownRefusal,boundary:'local-before-ssh'},{...options.knownRefusal,boundary:'after-container-dispatch'},{...options.knownRefusal,operation:'inspect'},{...options.knownRefusal,toolChunkId:''}])assert.throws(()=>derive117CleanupRecovery(fixtures(),{...options,knownRefusal}),/KNOWN_REMOTE_NODISPATCH/);
});

test('original intent/pre/checkpoint/observation/event chain remains mandatory and tampering stops before any transport',()=>{
 for(const mutate of [a=>a['cleanup-intent'].value.observationSha256='0'.repeat(64),a=>a['cleanup-intent'].value.eventHash='0'.repeat(64),a=>a.checkpoint.value.value.preSha256='0'.repeat(64),a=>a.observation.value.value.checkpointHash='0'.repeat(64),a=>a.observation.value.value.runId='c1111111-1111-4111-8111-111111111111',a=>a['cleanup-events'].value.pop()]){const a=fixtures();mutate(a);assert.throws(()=>derive117CleanupRecovery(a,options),/^Error: K117_/);}
});

test('last exact ACK values, drained browser and frozen source/physical identity must agree',()=>{
 for(const mutate of [a=>a.observation.value.value.preferences[0].value='unknown',a=>a['browser-result'].value.unresolvedIntents=1,a=>a['browser-result'].value.requestsDrained=false,a=>a.checkpoint.value.sources={producer:'0'.repeat(64)},a=>a.observation.value.receipt.identity.image='other']){const a=fixtures();mutate(a);if(a.observation.value.value.preferences[0].value==='unknown')a['cleanup-intent'].value.observationSha256=digest117(a.observation.value.value);assert.throws(()=>derive117CleanupRecovery(a,options),/^Error: K117_/);}
});


test('exclusive recovery transport directory preserves existing original refusal log even if its name repeats',()=>{
 const base=path.resolve(process.cwd(),'test-results');mkdirSync(base,{recursive:true});const dir=mkdtempSync(path.join(base,'qa117-recovery-log-'));const original=path.join(dir,'transport-restore-unknown.stderr.private.log');writeFileSync(original,'ORIGINAL-REFUSAL-IMMUTABLE');let logs;
 try{logs=create117RecoveryLogDirectory(dir);assert.equal(path.dirname(logs),realpathSync(dir));assert.equal(path.basename(logs),'cleanup-recovery-transport');const recoveryLog=path.join(logs,'transport-restore-unknown.stderr.private.log');writeFileSync(recoveryLog,'NEW-RECOVERY-DIAGNOSTICS');assert.equal(readFileSync(original,'utf8'),'ORIGINAL-REFUSAL-IMMUTABLE');assert.equal(readFileSync(recoveryLog,'utf8'),'NEW-RECOVERY-DIAGNOSTICS');assert.throws(()=>create117RecoveryLogDirectory(dir),/ALREADY_EXISTS/);assert.throws(()=>create117RecoveryLogDirectory('relative'),/PARENT_INVALID/);unlinkSync(recoveryLog);}
 finally{if(logs)rmdirSync(logs);unlinkSync(original);rmdirSync(dir);}
});
