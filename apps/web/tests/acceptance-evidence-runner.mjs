// Shared coordinator: transport reuse, immutable intent, reviewed source/ABI, no implicit execute.
import assert from 'node:assert/strict';
import {mkdir,realpath,lstat,readFile,open} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PROTOCOL,evidenceHash,declarationHash,validateDeclaration,readiness} from './acceptance-evidence-protocol.mjs';
import {assertSourcePins,reviewedBundle} from './acceptance-source-manifest.mjs';
import {qaTransport} from './crm-acceptance-transport.mjs';

async function durableJson(file,value) {
 const handle=await open(file,'wx',0o600);
 try {await handle.writeFile(JSON.stringify(value,null,2)+'\n','utf8');await handle.sync();}
 finally {await handle.close();}
}
export async function acceptanceDirectory(root,runId) {
 assert.match(runId,/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,'RUN_ID_REQUIRED');
 const directory=path.join(path.resolve(root),'.playwright-mcp','revision-acceptance',runId);
 await mkdir(directory,{recursive:true});
 for(let checked=directory;checked!==path.resolve(root);checked=path.dirname(checked))assert.ok(!(await lstat(checked)).isSymbolicLink(),'PRIVATE_PATH_REPARSE');
 assert.equal(await realpath(directory),path.resolve(directory),'PRIVATE_PATH_CHANGED');
 return directory;
}
export async function executeApprovedScenario({declaration,scenarioId,producer,prepared,operation,expectedIdentity,directory,transportFactory=qaTransport}) {
 validateDeclaration(declaration);
 assert.equal(path.basename(directory),declaration.runId,'RUN_DIRECTORY_MISMATCH');
 assert.equal(path.basename(path.dirname(directory)),'revision-acceptance','PRIVATE_RUN_DIRECTORY_REQUIRED');
 assert.equal(await realpath(directory),path.resolve(directory),'PRIVATE_PATH_CHANGED');
 const required=declaration.requirements.find(item=>item.id===scenarioId);
 assert.ok(required,'UNDECLARED_SCENARIO');
 assert.ok(['readonly','native','prepare','inspect','restore'].includes(operation),'EXPLICIT_OPERATION_REQUIRED');
 assert.equal(producer.id,required.producerId,'PRODUCER_ID_MISMATCH');
 assert.equal(producer.version,required.producerVersion,'PRODUCER_VERSION_MISMATCH');
 assert.equal(evidenceHash(await readFile(producer.file)),required.producerSourceSha256,'PRODUCER_NOT_REVIEWED');
 assert.equal(prepared.bundleSha256,required.bundleSha256,'BUNDLE_NOT_REVIEWED');
 assert.equal(evidenceHash(prepared.bytes),required.bundleSha256,'BUNDLE_CHANGED');
 assert.equal(prepared.manifest.digest,required.sourceManifestDigest,'MANIFEST_NOT_REVIEWED');
 assert.equal(prepared.manifest.revision,declaration.revision,'MANIFEST_REVISION_MISMATCH');
 assert.deepEqual(prepared.context,{revision:declaration.revision,target:declaration.target,runId:declaration.runId,scenarioId,producerId:producer.id,producerVersion:producer.version},'PRODUCER_INPUT_BINDING_MISMATCH');
 const sourcePinsBefore=await assertSourcePins(prepared.manifest);
 let preparation;
 if(required.preparation==='durable-plan') {
  const preFile=path.join(directory,scenarioId+'.prepared.private.json');
  const preBytes=await readFile(preFile),pre=JSON.parse(preBytes.toString('utf8'));
  assert.equal(prepared.preparation?.file,preFile,'OUTER_PRE_FILE_REQUIRED');
  assert.equal(evidenceHash(preBytes),prepared.preparation.sha256,'OUTER_PRE_CHANGED');
  assert.deepEqual({revision:pre.revision,target:pre.target,runId:pre.runId,scenarioId:pre.scenarioId},{revision:declaration.revision,target:declaration.target,runId:declaration.runId,scenarioId},'OUTER_PRE_BINDING_MISMATCH');
  preparation={sha256:prepared.preparation.sha256,payloadSha256:pre.payloadSha256,outerPreparationReceiptSha256:pre.outerPreparationReceiptSha256};
 }
 const file=path.join(directory,scenarioId),intent={protocol:PROTOCOL,runId:declaration.runId,revision:declaration.revision,target:declaration.target,scenarioId,
  producerId:producer.id,producerVersion:producer.version,bundleSha256:required.bundleSha256,sourceManifestDigest:required.sourceManifestDigest,declarationDigest:declarationHash(declaration),...(preparation?{preparation}:{}),phase:'INTENT'};
 await durableJson(file+'.source.private.json',prepared.manifest);
 await durableJson(file+'.intent.json',intent); // Повтор unknown операции не создаёт новый intent автоматически.
 let receipt;
 try {
  const transport=transportFactory({target:declaration.target,revision:declaration.revision,outputDir:directory});
  const observed=await transport.execute(prepared.bytes,operation);
  const rawReceiptSha256=evidenceHash(JSON.stringify(observed.receipt));
  await durableJson(file+'.raw.private.json',observed.receipt);
  assert.deepEqual({revision:observed.body.revision,target:observed.body.target,runId:observed.body.runId,scenarioId:observed.body.scenarioId,producerId:observed.body.producerId,producerVersion:observed.body.producerVersion},prepared.context,'ACTUAL_RESULT_BINDING_MISMATCH');
  if(preparation){assert.equal(observed.body.planSha256,preparation.payloadSha256,'ACTUAL_PLAN_CHANGED');assert.equal(observed.body.outerPreparationReceiptSha256,preparation.outerPreparationReceiptSha256,'ACTUAL_PRE_RECEIPT_CHANGED');}
  assert.deepEqual(observed.body,declaration.target==='staging'?observed.receipt.result:observed.receipt,'ADAPTER_RAW_BODY_MISMATCH');
  if(declaration.target==='staging')assert.equal(observed.receipt.bundleSha256,required.bundleSha256,'ACTUAL_BUNDLE_MISMATCH');
  const identity=declaration.target==='staging'?observed.receipt.identity:observed.body.identity;
  assert.deepEqual(identity,expectedIdentity,'TARGET_CHANGED_DURING_SCENARIO');
  const sourcePinsAfter=await assertSourcePins(prepared.manifest);
  if(preparation)assert.equal(evidenceHash(await readFile(prepared.preparation.file)),preparation.sha256,'OUTER_PRE_CHANGED_DURING_EXECUTION');
  receipt={protocol:PROTOCOL,revision:declaration.revision,target:declaration.target,runId:declaration.runId,scenarioId,
   producerId:producer.id,producerVersion:producer.version,producerSourceSha256:required.producerSourceSha256,
   bundleSha256:required.bundleSha256,sourceManifestDigest:required.sourceManifestDigest,sourcePinsBefore,sourcePinsAfter,identity,
   level:observed.body.level,status:observed.body.status,checks:observed.body.checks,preservation:observed.body.preservation,...(preparation?{preparation}:{}),
   provenance:{kind:'reviewed-adapter-execution',rawReceiptSha256}};
 } catch {
  // Не печатаем arbitrary error/body/secret; intent остаётся для reviewed inspect.
  receipt={protocol:PROTOCOL,revision:declaration.revision,target:declaration.target,runId:declaration.runId,scenarioId,
   producerId:producer.id,producerVersion:producer.version,producerSourceSha256:required.producerSourceSha256,
   bundleSha256:required.bundleSha256,sourceManifestDigest:required.sourceManifestDigest,sourcePinsBefore,sourcePinsAfter:null,
   identity:expectedIdentity,level:required.level,status:'UNKNOWN',code:'EXECUTION_HOLD_INSPECT_REQUIRED'};
 }
 await durableJson(file+'.receipt.json',receipt);
 return receipt;
}
export async function verifyRun({declaration,identity,directory}) {
 validateDeclaration(declaration);
 assert.equal(path.basename(directory),declaration.runId,'RUN_DIRECTORY_MISMATCH');
 assert.equal(path.basename(path.dirname(directory)),'revision-acceptance','PRIVATE_RUN_DIRECTORY_REQUIRED');
 assert.equal(await realpath(directory),path.resolve(directory),'PRIVATE_PATH_CHANGED');
 const receipts=[];
 for(const item of declaration.requirements) {
  let receipt;
  try {receipt=JSON.parse(await readFile(path.join(directory,item.id+'.receipt.json'),'utf8'));}
  catch(error) {if(error.code==='ENOENT')continue;throw Error('PRIVATE_RECEIPT_INVALID');}
  if(receipt.status==='PASS') {
   const intent=JSON.parse(await readFile(path.join(directory,item.id+'.intent.json'),'utf8'));
   assert.equal(intent.declarationDigest,declarationHash(declaration),'INTENT_DECLARATION_CHANGED');
   assert.deepEqual({revision:intent.revision,target:intent.target,runId:intent.runId,scenarioId:intent.scenarioId,producerId:intent.producerId,producerVersion:intent.producerVersion,bundleSha256:intent.bundleSha256,sourceManifestDigest:intent.sourceManifestDigest},{revision:declaration.revision,target:declaration.target,runId:declaration.runId,scenarioId:item.id,producerId:item.producerId,producerVersion:item.producerVersion,bundleSha256:item.bundleSha256,sourceManifestDigest:item.sourceManifestDigest},'INTENT_BINDING_CHANGED');
   const manifest=JSON.parse(await readFile(path.join(directory,item.id+'.source.private.json'),'utf8'));
   assert.equal(manifest.revision,declaration.revision,'SAVED_MANIFEST_REVISION_CHANGED');
   assert.equal(manifest.digest,item.sourceManifestDigest,'SAVED_MANIFEST_DIGEST_CHANGED');
   await assertSourcePins(manifest);
   const raw=JSON.parse(await readFile(path.join(directory,item.id+'.raw.private.json'),'utf8'));
   assert.equal(evidenceHash(JSON.stringify(raw)),receipt.provenance?.rawReceiptSha256,'RAW_EXECUTION_ARTIFACT_CHANGED');
   assert.equal(raw.result?.status??raw.status,'PASS','RAW_EXECUTION_NOT_PASS');
   const body=raw.result??raw;
   assert.deepEqual({revision:body.revision,target:body.target,runId:body.runId,scenarioId:body.scenarioId,producerId:body.producerId,producerVersion:body.producerVersion},{revision:declaration.revision,target:declaration.target,runId:declaration.runId,scenarioId:item.id,producerId:item.producerId,producerVersion:item.producerVersion},'RAW_BINDING_CHANGED');
   assert.equal(body.level,receipt.level,'RAW_EVIDENCE_LEVEL_CHANGED');
   assert.deepEqual(body.checks,receipt.checks,'RAW_ASSERTIONS_CHANGED');
   assert.deepEqual(body.preservation,receipt.preservation,'RAW_PRESERVATION_CHANGED');
   if(item.preparation==='durable-plan') {
    const preBytes=await readFile(path.join(directory,item.id+'.prepared.private.json'));
    assert.equal(evidenceHash(preBytes),receipt.preparation?.sha256,'SAVED_OUTER_PRE_CHANGED');
    const pre=JSON.parse(preBytes.toString('utf8'));
    assert.equal(body.planSha256,pre.payloadSha256,'RAW_PLAN_CHANGED');
    assert.equal(body.outerPreparationReceiptSha256,pre.outerPreparationReceiptSha256,'RAW_PRE_RECEIPT_CHANGED');
    assert.deepEqual(intent.preparation,receipt.preparation,'INTENT_PREPARATION_CHANGED');
   }
   const rawIdentity=declaration.target==='staging'?raw.identity:body.identity;
   assert.deepEqual(rawIdentity,receipt.identity,'RAW_TARGET_CHANGED');
   assert.deepEqual(rawIdentity,identity,'RAW_TARGET_EXPECTATION_CHANGED');
   if(declaration.target==='staging') {
    assert.equal(raw.bundleSha256,item.bundleSha256,'RAW_BUNDLE_CHANGED');
   }
  }
  receipts.push(receipt);
 }
 return readiness(declaration,receipts,identity);
}
export async function persistPreparedPlan({declaration,scenarioId,forScenarioId,directory,identity}) {
 const report=await verifyRun({declaration,identity,directory});
 assert.equal(report.scenarios.find(row=>row.scenarioId===scenarioId)?.status,'PASS','INSPECT_RECEIPT_NOT_VERIFIED');
 const from=declaration.requirements.find(item=>item.id===scenarioId),into=declaration.requirements.find(item=>item.id===forScenarioId);
 assert.ok(from?.preservation==='readonly'&&from.level==='data-integrity'&&into?.preparation==='durable-plan','READONLY_INSPECT_THEN_NATIVE_REQUIRED');
 const receipt=JSON.parse(await readFile(path.join(directory,scenarioId+'.receipt.json'),'utf8'));
 const raw=JSON.parse(await readFile(path.join(directory,scenarioId+'.raw.private.json'),'utf8')),body=raw.result??raw,payload=body.plan;
 assert.deepEqual({revision:payload.revision,target:payload.target,runId:payload.runId,scenarioId:payload.scenarioId},{revision:declaration.revision,target:declaration.target,runId:declaration.runId,scenarioId:forScenarioId},'INSPECT_PAYLOAD_BINDING_MISMATCH');
 const payloadSha256=evidenceHash(JSON.stringify(payload));assert.equal(payloadSha256,body.planSha256,'INSPECT_PLAN_DIGEST_MISMATCH');
 const value={protocol:PROTOCOL,revision:declaration.revision,target:declaration.target,runId:declaration.runId,scenarioId:forScenarioId,inspectScenarioId:scenarioId,outerPreparationReceiptSha256:receipt.provenance.rawReceiptSha256,payloadSha256,plan:payload};
 const file=path.join(directory,forScenarioId+'.prepared.private.json');await durableJson(file,value);
 return {plan:payload,planSha256:payloadSha256,outerPreparationReceiptSha256:value.outerPreparationReceiptSha256,preparation:{file,sha256:evidenceHash(await readFile(file))}};
}
export async function prepareRuntimeProducer({root,sourceRoot,revision,target,runId,scenarioId,level='runtime-node'}) {
 assert.ok(['runtime-node','HTTP-runtime'].includes(level),'RUNTIME_LEVEL_REQUIRED');
 const directory=await acceptanceDirectory(root,runId),entry=path.join(root,'apps/web/tests/acceptance-runtime-entry.mjs');
 const input={target,revision,runId,scenarioId,evidenceLevel:level};
 const code="import {runAcceptanceRuntime} from "+JSON.stringify(path.resolve(entry))+";\n"+
  "try {const result=await runAcceptanceRuntime("+JSON.stringify(input)+");console.log(JSON.stringify(result));}"+
  "catch {console.log(JSON.stringify({status:'BLOCKED',code:'RUNTIME_ACCEPTANCE_FAILED'}));process.exitCode=1;}\n";
 const file=path.join(directory,scenarioId+'.producer.mjs');await durableBytes(file,code);
 const files=['apps/web/tests/acceptance-runtime-entry.mjs','apps/web/tests/acceptance-evidence-protocol.mjs','apps/web/tests/coverage-v8-intervals.mjs','apps/web/tests/helpers/native-acceptance-target.ts','apps/web/tests/helpers/local-crm-database.ts'];
 const reviewedProducers=[];
 for(const relative of files){const producerFile=path.join(root,relative);reviewedProducers.push({file:producerFile,sha256:evidenceHash(await readFile(producerFile))});}
 reviewedProducers.push({file,sha256:evidenceHash(Buffer.from(code))});
 const prepared=await reviewedBundle({entry:file,revision,sourceRoot,producerRoots:[root,sourceRoot],reviewedProducers});
 prepared.context={revision,target,runId,scenarioId,producerId:'acceptance-runtime',producerVersion:1};
 return {directory,prepared,producer:{id:'acceptance-runtime',version:1,file:entry},input};
}
async function durableBytes(file,bytes) {
 const handle=await open(file,'wx',0o600);
 try {await handle.writeFile(bytes,'utf8');await handle.sync();}finally {await handle.close();}
}

const direct=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(direct) {
 try {
 const [operation,declarationFile,identityFile,directory]=process.argv.slice(2);
 assert.equal(operation,'verify','EXPLICIT_VERIFY_ONLY_CLI');
 const declaration=JSON.parse(await readFile(declarationFile,'utf8')),identity=JSON.parse(await readFile(identityFile,'utf8'));
 const report=await verifyRun({declaration,identity,directory});
 console.log(JSON.stringify(report));if(report.status!=='PASS')process.exitCode=2;
 } catch {console.log(JSON.stringify({status:'BLOCKED',code:'ACCEPTANCE_VERIFY_FAILED'}));process.exitCode=2;}
}
