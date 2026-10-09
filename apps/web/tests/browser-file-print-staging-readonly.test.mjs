import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readonlyFilePrintRequestDecision,filePrintOwnedCases} from './browser-file-print-staging-readonly.mjs';
const binding={origin:'https://staging-crm.peromebel.by',ids:{project:'owned-project',product:'owned-product',task:'owned-task'},files:[{id:'image',fileName:'Image.png',mimeType:'image/png',taskId:null,productId:'owned-product'},{id:'pdf',fileName:'Document.pdf',mimeType:'application/pdf',taskId:'owned-task',productId:'owned-product'},{id:'cad',fileName:'Model.b3d',mimeType:'application/octet-stream',productId:null}],finance:{incomeId:'income',expenseId:'expense'},financeDocs:[{id:'finance-pdf',mimeType:'application/pdf',paymentId:'expense'},{id:'finance-cad',mimeType:'application/octet-stream',paymentId:null}]};
const deny=()=>({kind:'deny',code:'shared-deny'});
test('readonly policy never forwards writes, even if shared policy would return a delete candidate',()=>{for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal(readonlyFilePrintRequestDecision({url:binding.origin+'/projects/owned-project',method},binding,()=>({kind:'candidate-delete'})).kind,'abort-write');});
test('only exact owned PDF view is added to shared GET scope',()=>{for(const path of ['/api/files/pdf?view=1','/api/finance/documents/finance-pdf?view=1'])assert.equal(readonlyFilePrintRequestDecision({url:binding.origin+path,method:'GET'},binding,deny).kind,'continue');for(const path of ['/api/files/image?view=1','/api/files/foreign?view=1','/api/files/pdf?view=1&view=1','/api/files/pdf?view=2'])assert.equal(readonlyFilePrintRequestDecision({url:binding.origin+path,method:'GET'},binding,deny).kind,'deny');});
test('cross-origin and prefetch cannot request PDF outside approved current transport',()=>{assert.equal(readonlyFilePrintRequestDecision({url:'https://crm.peromebel.by/api/files/pdf?view=1',method:'GET'},binding,deny).kind,'deny');assert.equal(readonlyFilePrintRequestDecision({url:binding.origin+'/api/files/pdf?view=1',method:'GET',prefetch:true},binding,deny).kind,'abort-prefetch');});
test('current signed arrays drive rows; no fake ids.financeDocuments or unlinked-finance UI is invented',()=>{const cases=filePrintOwnedCases(binding);assert.deepEqual(cases.map(item=>[item.source,item.surface,item.file.id]),[['project','product','image'],['project','task','pdf'],['project','project','cad'],['finance','expense','finance-pdf']]);});

import {runFilePrintStagingReadonly} from './browser-file-print-staging-readonly.mjs';
import {digest} from './file-fixture113-protocol.mjs';
function currentV5Input() {
 const revision='a'.repeat(40),hash='b'.repeat(64),descriptor={id:'c'.repeat(42),exportedName:'deleteFile',source:'src/server/files/actions.ts',routes:['/products/[id]','/projects/[id]'],revision,rawManifestSha256:'d'.repeat(64),actionManifestHash:'e'.repeat(64)};
 return {authorized:true,origin:binding.origin,expectedRevision:revision,identity:{hostname:'crm-staging',revision},handoff:{namespace:'PERO_FILE_ACCEPTANCE_113_V2',version:2,kind:'handoff',runId:'10000000-0000-4000-8000-000000000001',revision,preSha256:hash,checkpointHash:hash,signature:hash,currentOwnedStateHash:hash,storageManifestHash:hash,financialStateHash:hash,compiledDeleteFile:descriptor,actionManifestHash:descriptor.actionManifestHash,rawManifestSha256:descriptor.rawManifestSha256},saveNativeScreenshot:async()=>{throw Error('NATIVE_SINK_MUST_NOT_RUN');}};
}
test('actual merged V5 constructor rejects a boolean verifier before browser/native actions',async()=>{
 await assert.rejects(runFilePrintStagingReadonly({...currentV5Input(),fixtureVerifier:true}),/F115_REVIEWED_OWNER_VERIFIER_REQUIRED/);
});
test('actual merged V5 source-backed verifier receives only public descriptor provenance and three hashes',async()=>{
 const input=currentV5Input();let verifiedArgs;
 await assert.rejects(runFilePrintStagingReadonly({...input,actionManifest:{privateKey:'must-not-be-consumed'},fixtureVerifier:{sourceSha256:'f'.repeat(64),verifySignedFixture:async args=>{verifiedArgs=args;return true;}}}),/F115_CURRENT_OWNER_VERIFICATION_REQUIRED/);
 assert.equal(verifiedArgs.actionManifestHash,input.handoff.compiledDeleteFile.actionManifestHash);
 assert.equal(verifiedArgs.rawManifestSha256,input.handoff.compiledDeleteFile.rawManifestSha256);
 assert.equal(verifiedArgs.compiledDeleteFileHash,digest(input.handoff.compiledDeleteFile));
 assert.deepEqual(Object.keys(verifiedArgs).sort(),['handoff','identity','expectedRevision','actionManifestHash','rawManifestSha256','compiledDeleteFileHash'].sort());
 assert.equal(Object.hasOwn(verifiedArgs,'actionManifest'),false);
});
