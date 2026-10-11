import assert from 'node:assert/strict';
import test from 'node:test';
import {PROTOCOL,readiness,validateDeclaration} from './acceptance-evidence-protocol.mjs';
const sha='a'.repeat(64),revision='b'.repeat(40),runId='c7ec731a-f23f-45f9-9b8a-0d9287a35f38';
const requirement={id:'native.rollback',taskId:163,level:'native-PostgreSQL',producerId:'percentage-v4',producerVersion:1,producerSourceSha256:sha,bundleSha256:sha,sourceManifestDigest:sha,preservation:'rollback',requiredChecks:['constraints','original-rows']};
const declaration={protocol:PROTOCOL,revision,target:'staging',runId,requirements:[requirement]};
const identity={hostname:'crm-staging',revision,image:'sha256:'+sha,web:sha,database:sha,databaseVolume:'crm-staging_pgdata',outerW07Sha256:sha};
const proof=()=>({protocol:PROTOCOL,revision,target:'staging',runId,scenarioId:requirement.id,level:requirement.level,producerId:requirement.producerId,producerVersion:1,producerSourceSha256:sha,bundleSha256:sha,sourceManifestDigest:sha,identity,sourcePinsBefore:sha,sourcePinsAfter:sha,status:'PASS',
 provenance:{kind:'reviewed-adapter-execution',rawReceiptSha256:sha},checks:[{id:'constraints',status:'PASS'},{id:'original-rows',status:'PASS'}],preservation:{mode:'rollback',status:'PASS',beforeDigest:sha,afterDigest:sha,rollback:'VERIFIED'}});
test('missing native proof remains NOT_RUN despite known deployment identity',()=>{
 assert.equal(readiness(declaration,[],identity).status,'NOT_RUN');
 assert.equal(readiness(declaration,[proof()],identity).status,'PASS');
});
for(const [label,change] of [
 ['stale SHA',p=>p.revision='d'.repeat(40)],['foreign run',p=>p.runId='11111111-1111-4111-8111-111111111111'],
 ['production target',p=>p.target='production'],['wrong image',p=>p.identity={...identity,image:'sha256:'+'f'.repeat(64)}],
 ['DI level',p=>p.level='DI'],['producer version',p=>p.producerVersion=2],['source drift',p=>p.sourcePinsAfter='f'.repeat(64)],
 ['bare PASS',p=>delete p.provenance],['missing assertion',p=>p.checks.pop()],['rollback unknown',p=>delete p.preservation.rollback],
 ['changed original facts',p=>p.preservation.afterDigest='f'.repeat(64)],['unknown outcome',p=>p.status='UNKNOWN'],
 ])test('receipt cannot close native scenario: '+label,()=>{
   const p=proof();change(p);assert.equal(readiness(declaration,[p],identity).status,'BLOCKED');
 });
test('empty/duplicate declarations and duplicate receipt cannot silently narrow required scenario set',()=>{
 assert.throws(()=>validateDeclaration({...declaration,requirements:[]}),/REQUIRED_SCENARIOS_EMPTY/);
 assert.throws(()=>validateDeclaration({...declaration,requirements:[requirement,requirement]}),/SCENARIO_ID_INVALID/);
 assert.throws(()=>readiness(declaration,[proof(),proof()],identity),/DUPLICATE_SCENARIO_RECEIPTS/);
});
test('known failure remains FAIL and a blocked device does not become native PASS',()=>{
 const p=proof();p.status='FAIL';assert.equal(readiness(declaration,[p],identity).status,'FAIL');
 p.status='BLOCKED';assert.equal(readiness(declaration,[p],identity).status,'BLOCKED');
});
