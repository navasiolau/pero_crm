import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readonlyFilePrintRequestDecision,filePrintOwnedCases,nativePdfUriClass,remainingFilePrintOwnedCases,printPageErrorProvenance} from './browser-file-print-staging-readonly.mjs';
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

test('native PDF reads require current verified owned PDF phase; diagnostics expose closed classes only',()=>{
 const owned={...binding,files:binding.files.map(file=>({...file,contentHash:'a'.repeat(64)}))},phase={source:'project',fileId:'pdf',contentHash:'a'.repeat(64)};
 const urls=[['chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html','CHROME_PDF_EXTENSION'],['chrome://print/','CHROME_PRINT'],['chrome://resources/js/assert.js','CHROME_PRINT'],['chrome-untrusted://pdf/pdf_viewer.html','CHROME_UNTRUSTED_PDF'],['blob:'+binding.origin+'/11111111-1111-4111-8111-111111111111','SAME_ORIGIN_BLOB']];
 for(const[url,kind]of urls){assert.equal(nativePdfUriClass(url,binding.origin),kind);assert.equal(readonlyFilePrintRequestDecision({url,method:'GET'},owned,deny).kind,'deny');assert.equal(readonlyFilePrintRequestDecision({url,method:'GET'},owned,deny,phase).kind,'continue');assert.equal(readonlyFilePrintRequestDecision({url,method:'POST'},owned,deny,phase).kind,'abort-write');assert.equal(readonlyFilePrintRequestDecision({url,method:'GET'},owned,deny,{...phase,contentHash:'b'.repeat(64)}).kind,'deny');}
 for(const url of ['https://example.invalid/private','chrome-extension://foreign/index.html','blob:https://example.invalid/11111111-1111-4111-8111-111111111111','chrome://settings/']){assert.equal(nativePdfUriClass(url,binding.origin),'OTHER');assert.equal(readonlyFilePrintRequestDecision({url,method:'GET'},owned,deny,phase).kind,'deny');}
});
test('previous canceled ready one-page preview skips only unchanged current own file identity and content',()=>{
 const current={...binding,runId:'10000000-0000-4000-8000-000000000001',expectedRevision:'a'.repeat(40),files:binding.files.map(file=>({...file,contentHash:'b'.repeat(64)}))};
 const previous={runId:current.runId,revision:current.expectedRevision,native:[{source:'project',fileId:'image',contentHash:'b'.repeat(64),mimeType:'image/png',kind:'actual-native-preview',canceled:true,physicalPrintSubmitted:false,preview:{state:'1',error:'0',pageCount:'1',previewLoaded:true,isPdf:false}}]};
 const result=remainingFilePrintOwnedCases(current,previous);assert.equal(result.priorNativeMatched.length,1);assert.equal(result.cases.some(item=>item.file.id==='image'),false);assert.equal(result.cases.some(item=>item.file.id==='pdf'),true);
 for(const change of [{canceled:false},{contentHash:'c'.repeat(64)},{fileId:'deleted-image'}])assert.equal(remainingFilePrintOwnedCases(current,{...previous,native:[{...previous.native[0],...change}]}).priorNativeMatched.length,0);
 assert.throws(()=>remainingFilePrintOwnedCases(current,{...previous,revision:'c'.repeat(40)}),/F116_PREVIOUS_NATIVE_SCOPE_REQUIRED/);
});

test('pageerror provenance trusts exact native stack sites, keeps CRM and unknown fatal candidates and never returns message or stack',()=>{
 const message='controlled Minified React error #418',native='chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/pdf_viewer.js:12:3';
 const result=printPageErrorProvenance({name:'TypeError',message,stack:'TypeError: controlled\n    at cleanup ('+native+')'},binding.origin);assert.equal(result.originClass,'CHROME_PDF_EXTENSION');assert.equal(result.reactCode,418);assert.equal(result.name,'TypeError');assert.match(result.messageSha256,/^[a-f0-9]{64}$/);assert.equal(Object.hasOwn(result,'message'),false);assert.equal(Object.hasOwn(result,'stack'),false);
 assert.equal(printPageErrorProvenance({message,stack:'Error\n    at cleanup ('+native+')\n    at render ('+binding.origin+'/_next/static/app.js:1:2)'},binding.origin).originClass,'CRM');
 assert.equal(printPageErrorProvenance({message:native,stack:'Error: '+native},binding.origin).originClass,'UNKNOWN');
 assert.equal(printPageErrorProvenance({message,stack:'Error\n    at fail (https://example.invalid/app.js:1:2)'},binding.origin).originClass,'UNKNOWN');
});
