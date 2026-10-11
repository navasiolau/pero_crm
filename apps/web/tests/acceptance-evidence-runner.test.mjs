import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,writeFile,readFile,realpath,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {PROTOCOL,evidenceHash,declarationHash} from './acceptance-evidence-protocol.mjs';
import {acceptanceDirectory,executeApprovedScenario,verifyRun} from './acceptance-evidence-runner.mjs';

async function fixture(run) {
 const root=await mkdtemp(path.join(os.tmpdir(),'pero-evidence-run-'));
 try {
  const runId=randomUUID(),revision='b'.repeat(40),directory=await acceptanceDirectory(root,runId),file=path.join(root,'producer.mjs');
  await writeFile(file,'export const fixture=true;\n');const sourceSha=evidenceHash(await readFile(file)),bytes=Buffer.from('reviewed fixture'),bundleSha256=evidenceHash(bytes);
  const pins=[{scope:'producer',file,sha256:sourceSha}],manifest={version:1,revision,pins,digest:declarationHash({version:1,revision,pins})};
  const identity={hostname:'crm-staging',revision,image:'sha256:'+'a'.repeat(64),web:'a'.repeat(64),database:'a'.repeat(64),databaseVolume:'crm-staging_pgdata',outerW07Sha256:'a'.repeat(64)};
  const requirement={id:'di-fixture',taskId:163,level:'DI',producerId:'unit-fixture',producerVersion:1,producerSourceSha256:sourceSha,bundleSha256,sourceManifestDigest:manifest.digest,preservation:'readonly',requiredChecks:['actual-condition']};
  const declaration={protocol:PROTOCOL,revision,target:'staging',runId,requirements:[requirement]};
  const context={revision,target:'staging',runId,scenarioId:requirement.id,producerId:requirement.producerId,producerVersion:requirement.producerVersion};
  const body={...context,status:'PASS',level:'DI',checks:[{id:'actual-condition',status:'PASS'}],preservation:{mode:'readonly',status:'PASS',beforeDigest:sourceSha,afterDigest:sourceSha}};
  const prepared={bytes,bundleSha256,manifest,context},producer={id:'unit-fixture',version:1,file};
  const result={body,receipt:{identity,bundleSha256,operation:'readonly',result:body}};
  await run({root,directory,producer,prepared,declaration,identity,result,file});
 } finally {
  const actual=await realpath(root),parent=await realpath(os.tmpdir());
  assert.equal(actual,path.resolve(root));assert.ok(actual.startsWith(parent+path.sep)&&path.basename(actual).startsWith('pero-evidence-run-'));
  await rm(actual,{recursive:true,force:false});
 }
}
test('reviewed coordinator records real adapter boundary once and verify refuses changed normalized assertions',()=>fixture(async f=>{
 let calls=0;const transportFactory=()=>({execute:async()=>{calls++;return f.result;}});
 const receipt=await executeApprovedScenario({...f,scenarioId:'di-fixture',operation:'readonly',expectedIdentity:f.identity,transportFactory});
 assert.equal(receipt.status,'PASS');assert.equal(calls,1);
 assert.equal((await verifyRun({...f,identity:f.identity})).status,'PASS');
 await assert.rejects(executeApprovedScenario({...f,scenarioId:'di-fixture',operation:'readonly',expectedIdentity:f.identity,transportFactory}),/EEXIST/);
 assert.equal(calls,1);
 const file=path.join(f.directory,'di-fixture.receipt.json'),changed=JSON.parse(await readFile(file,'utf8'));
 changed.checks=[{id:'invented',status:'PASS'}];await writeFile(file,JSON.stringify(changed));
 await assert.rejects(verifyRun({...f,identity:f.identity}),/RAW_ASSERTIONS_CHANGED/);
}));
test('source drift after a possible effect leaves UNKNOWN/HOLD and cannot verify PASS',()=>fixture(async f=>{
 const transportFactory=()=>({execute:async()=>{await writeFile(f.file,'changed\n');return f.result;}});
 const receipt=await executeApprovedScenario({...f,scenarioId:'di-fixture',operation:'readonly',expectedIdentity:f.identity,transportFactory});
 assert.equal(receipt.status,'UNKNOWN');assert.equal((await verifyRun({...f,identity:f.identity})).status,'BLOCKED');
}));
test('unreviewed bytes fail before any transport call',()=>fixture(async f=>{
 let calls=0;const transportFactory=()=>({execute:async()=>{calls++;return f.result;}});
 await assert.rejects(executeApprovedScenario({...f,prepared:{...f.prepared,bytes:Buffer.from('foreign')},scenarioId:'di-fixture',operation:'readonly',expectedIdentity:f.identity,transportFactory}),/BUNDLE_CHANGED/);
 assert.equal(calls,0);
}));


test('manifest from revision A cannot execute against declaration/image B, even with matching reviewed digests',()=>fixture(async f=>{
 let calls=0;const transportFactory=()=>({execute:async()=>{calls++;return f.result;}});
 const revision='a'.repeat(40),manifest={...f.prepared.manifest,revision};
 manifest.digest=declarationHash({version:1,revision,pins:manifest.pins});
 const declaration={...f.declaration,requirements:[{...f.declaration.requirements[0],sourceManifestDigest:manifest.digest}]};
 await assert.rejects(executeApprovedScenario({...f,declaration,prepared:{...f.prepared,manifest},scenarioId:'di-fixture',operation:'readonly',expectedIdentity:f.identity,transportFactory}),/MANIFEST_REVISION_MISMATCH/);
 assert.equal(calls,0);
}));
test('different declared producer context is rejected before transport',()=>fixture(async f=>{
 let calls=0;const transportFactory=()=>({execute:async()=>{calls++;return f.result;}});
 await assert.rejects(executeApprovedScenario({...f,prepared:{...f.prepared,context:{...f.prepared.context,scenarioId:'foreign'}},scenarioId:'di-fixture',operation:'readonly',expectedIdentity:f.identity,transportFactory}),/PRODUCER_INPUT_BINDING_MISMATCH/);
 assert.equal(calls,0);
}));
for(const field of ['revision','target','runId','scenarioId','producerId','producerVersion'])
 test('actual result foreign '+field+' leaves HOLD, rather than labelling PASS with declared scope',()=>fixture(async f=>{
  f.result.body[field]=field==='producerVersion'?2:'foreign';
  const receipt=await executeApprovedScenario({...f,scenarioId:'di-fixture',operation:'readonly',expectedIdentity:f.identity,transportFactory:()=>({execute:async()=>f.result})});
  assert.equal(receipt.status,'UNKNOWN');assert.equal((await verifyRun({...f,identity:f.identity})).status,'BLOCKED');
 }));
test('tampered raw scope remains rejected even after recomputing raw artifact digest',()=>fixture(async f=>{
 await executeApprovedScenario({...f,scenarioId:'di-fixture',operation:'readonly',expectedIdentity:f.identity,transportFactory:()=>({execute:async()=>f.result})});
 const rawFile=path.join(f.directory,'di-fixture.raw.private.json'),receiptFile=path.join(f.directory,'di-fixture.receipt.json');
 const raw=JSON.parse(await readFile(rawFile,'utf8')),receipt=JSON.parse(await readFile(receiptFile,'utf8'));
 raw.result.scenarioId='foreign';receipt.provenance.rawReceiptSha256=evidenceHash(JSON.stringify(raw));
 await writeFile(rawFile,JSON.stringify(raw));await writeFile(receiptFile,JSON.stringify(receipt));
 await assert.rejects(verifyRun({...f,identity:f.identity}),/RAW_BINDING_CHANGED/);
}));

test('coordinator DI proof requires durable inspect PRE before owned native transport and detects PRE tampering',()=>fixture(async f=>{
 const inspectId='di-fixture',nativeId='owned.native',requirement=f.declaration.requirements[0];
 requirement.level='data-integrity';
 f.declaration.requirements.push({...requirement,id:nativeId,level:'native-PostgreSQL',preservation:'owned-cleanup',preparation:'durable-plan'});
 f.result.body.level='data-integrity';
 const plan={revision:f.declaration.revision,target:f.declaration.target,runId:f.declaration.runId,scenarioId:nativeId,baselineDigest:'a'.repeat(64)};
 f.result.body.plan=plan;f.result.body.planSha256=evidenceHash(JSON.stringify(plan));
 let calls=0;const transportFactory=()=>({execute:async()=>{calls++;return f.result;}});
 await executeApprovedScenario({...f,scenarioId:inspectId,operation:'inspect',expectedIdentity:f.identity,transportFactory});
 const nativeContext={...f.prepared.context,scenarioId:nativeId};
 await assert.rejects(executeApprovedScenario({...f,scenarioId:nativeId,prepared:{...f.prepared,context:nativeContext},operation:'native',expectedIdentity:f.identity,transportFactory}),/ENOENT/);
 assert.equal(calls,1);
 const {persistPreparedPlan}=await import('./acceptance-evidence-runner.mjs');
 const pre=await persistPreparedPlan({...f,scenarioId:inspectId,forScenarioId:nativeId,identity:f.identity});
 assert.equal(pre.planSha256,f.result.body.planSha256);
 const body={...nativeContext,status:'PASS',level:'native-PostgreSQL',checks:[{id:'actual-condition',status:'PASS'}],planSha256:pre.planSha256,outerPreparationReceiptSha256:pre.outerPreparationReceiptSha256,preservation:{mode:'owned-cleanup',status:'PASS',cleanup:'VERIFIED',beforeDigest:'a'.repeat(64),afterDigest:'a'.repeat(64)}};
 const result={body,receipt:{identity:f.identity,bundleSha256:f.prepared.bundleSha256,operation:'native',result:body}};
 const receipt=await executeApprovedScenario({...f,scenarioId:nativeId,prepared:{...f.prepared,context:nativeContext,preparation:pre.preparation},operation:'native',expectedIdentity:f.identity,transportFactory:()=>({execute:async()=>result})});
 assert.equal(receipt.status,'PASS');assert.equal((await verifyRun({...f,identity:f.identity})).status,'PASS');
 await writeFile(pre.preparation.file,'changed outer plan');
 await assert.rejects(verifyRun({...f,identity:f.identity}),/SAVED_OUTER_PRE_CHANGED/);
}));

test('local raw CID is immutable even if normalized receipt and caller expected identity are corrupted together',()=>fixture(async f=>{
 f.declaration.target='local';f.prepared.context.target='local';f.result.body.target='local';
 const identity={target:'local',revision:f.declaration.revision,containerId:'a'.repeat(64),databaseName:'pero_crm',schema:'public',port:5433};
 f.result.body.identity=identity;f.result.receipt=f.result.body;
 const receipt=await executeApprovedScenario({...f,scenarioId:'di-fixture',operation:'readonly',expectedIdentity:identity,transportFactory:()=>({execute:async()=>f.result})});
 assert.equal(receipt.status,'PASS');assert.equal((await verifyRun({...f,identity})).status,'PASS');
 const receiptFile=path.join(f.directory,'di-fixture.receipt.json'),changed=JSON.parse(await readFile(receiptFile,'utf8'));
 const foreign={...identity,containerId:'f'.repeat(64)};changed.identity=foreign;await writeFile(receiptFile,JSON.stringify(changed));
 await assert.rejects(verifyRun({...f,identity:foreign}),/RAW_TARGET_CHANGED/);
}));
