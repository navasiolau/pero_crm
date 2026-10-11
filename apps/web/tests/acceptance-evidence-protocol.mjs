// Протокол evidence не превращает CI, identity или self-declared PASS в приёмку сценария.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const PROTOCOL='pero-crm-acceptance/v1';
const SHA=/^[a-f0-9]{64}$/,REV=/^[a-f0-9]{40}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,ID=/^[a-z0-9][a-z0-9.-]{0,100}$/;
const LEVELS=new Set(['unit','DI','Chromium-component','native-PostgreSQL','HTTP-runtime','staging-browser','runtime-node','visual-comparison','data-integrity','device']);
export const evidenceHash=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
export const declarationHash=value=>evidenceHash(canonical(value));
function need(value,code){assert.ok(value,code);}
export function validateDeclaration(value) {
  need(value?.protocol===PROTOCOL&&REV.test(value.revision??'')&&UUID.test(value.runId??''),'DECLARATION_BINDING_INVALID');
  need(['local','staging'].includes(value.target),'TEST_TARGET_ONLY');
  need(Array.isArray(value.requirements)&&value.requirements.length>0,'REQUIRED_SCENARIOS_EMPTY');
  const seen=new Set();
  for(const item of value.requirements) {
    need(ID.test(item.id??'')&&!seen.has(item.id),'SCENARIO_ID_INVALID');seen.add(item.id);
    need(Number.isInteger(item.taskId)&&item.taskId>0&&LEVELS.has(item.level),'SCENARIO_TASK_LEVEL_INVALID');
    need(ID.test(item.producerId??'')&&Number.isInteger(item.producerVersion)&&item.producerVersion>0,'PRODUCER_VERSION_REQUIRED');
    need(SHA.test(item.producerSourceSha256??'')&&SHA.test(item.bundleSha256??'')&&SHA.test(item.sourceManifestDigest??''),'PRODUCER_SOURCE_BINDING_REQUIRED');
    need(['readonly','rollback','owned-cleanup'].includes(item.preservation),'PRESERVATION_MODE_REQUIRED');
    if(item.preparation!==undefined)need(item.preparation==='durable-plan'&&item.preservation==='owned-cleanup'&&item.level==='native-PostgreSQL','PREPARATION_MODE_INVALID');
    need(Array.isArray(item.requiredChecks)&&item.requiredChecks.length>0&&item.requiredChecks.every(id=>ID.test(id))&&new Set(item.requiredChecks).size===item.requiredChecks.length,'SCENARIO_ASSERTIONS_REQUIRED');
  }
  return value;
}
function identityMatches(expected,actual,target,revision) {
  if(!expected||!actual||canonical(expected)!==canonical(actual))return false;
  if(target==='staging')return actual.hostname==='crm-staging'&&actual.revision===revision&&SHA.test((actual.image??'').replace(/^sha256:/,''))&&SHA.test(actual.web??'')&&SHA.test(actual.database??'')&&actual.databaseVolume==='crm-staging_pgdata'&&SHA.test(actual.outerW07Sha256??'');
  return actual.target==='local'&&actual.databaseName==='pero_crm'&&actual.port===5433&&actual.schema==='public'&&SHA.test(actual.containerId??'')&&actual.revision===revision;
}
export function evaluateReceipt(declaration,requirement,receipt,expectedIdentity) {
  validateDeclaration(declaration);
  if(!receipt)return {scenarioId:requirement.id,status:'NOT_RUN',code:'EVIDENCE_MISSING'};
  const blocked=code=>({scenarioId:requirement.id,status:'BLOCKED',code});
  if(receipt.protocol!==PROTOCOL||receipt.revision!==declaration.revision||receipt.runId!==declaration.runId||receipt.target!==declaration.target||receipt.scenarioId!==requirement.id)return blocked('RECEIPT_BINDING_MISMATCH');
  if(receipt.producerId!==requirement.producerId||receipt.producerVersion!==requirement.producerVersion||receipt.producerSourceSha256!==requirement.producerSourceSha256||receipt.bundleSha256!==requirement.bundleSha256||receipt.sourceManifestDigest!==requirement.sourceManifestDigest)return blocked('PRODUCER_SOURCE_MISMATCH');
  if(receipt.level!==requirement.level)return blocked('EVIDENCE_LEVEL_MISMATCH');
  if(!identityMatches(expectedIdentity,receipt.identity,declaration.target,declaration.revision))return blocked('TARGET_IDENTITY_MISMATCH');
  if(receipt.sourcePinsBefore!==requirement.sourceManifestDigest||receipt.sourcePinsAfter!==requirement.sourceManifestDigest)return blocked('SOURCE_CHANGED');
  if(receipt.status==='NOT_RUN')return {scenarioId:requirement.id,status:'NOT_RUN',code:'SCENARIO_NOT_RUN'};
  if(receipt.status==='UNKNOWN'||receipt.status==='BLOCKED')return blocked('SCENARIO_HOLD');
  if(receipt.status==='FAIL')return {scenarioId:requirement.id,status:'FAIL',code:'SCENARIO_FAILED'};
  if(receipt.status!=='PASS'||receipt.provenance?.kind!=='reviewed-adapter-execution'||!SHA.test(receipt.provenance?.rawReceiptSha256??''))return blocked('GENUINE_EXECUTION_REQUIRED');
  if(!Array.isArray(receipt.checks)||!requirement.requiredChecks.every(id=>receipt.checks.some(check=>check.id===id&&check.status==='PASS')))return blocked('SCENARIO_CHECKS_MISSING');
  if(requirement.preparation==='durable-plan'&&(!SHA.test(receipt.preparation?.sha256??'')||!SHA.test(receipt.preparation?.payloadSha256??'')))return blocked('OUTER_PRE_NOT_PROVEN');
  const preserve=receipt.preservation;
  if(preserve?.mode!==requirement.preservation||preserve.status!=='PASS'||!SHA.test(preserve.beforeDigest??'')||preserve.beforeDigest!==preserve.afterDigest)return blocked('PRESERVATION_NOT_PROVEN');
  if(requirement.preservation==='owned-cleanup'&&preserve.cleanup!=='VERIFIED')return blocked('OWNERSHIP_CLEANUP_NOT_PROVEN');
  if(requirement.preservation==='rollback'&&preserve.rollback!=='VERIFIED')return blocked('ROLLBACK_NOT_PROVEN');
  return {scenarioId:requirement.id,status:'PASS',code:'VERIFIED'};
}
export function readiness(declaration,receipts,identity) {
  validateDeclaration(declaration);
  need(Array.isArray(receipts),'RECEIPT_LIST_REQUIRED');
  const ids=receipts.map(receipt=>receipt.scenarioId);
  need(new Set(ids).size===ids.length,'DUPLICATE_SCENARIO_RECEIPTS');
  need(ids.every(id=>declaration.requirements.some(item=>item.id===id)),'UNDECLARED_SCENARIO_RECEIPT');
  const scenarios=declaration.requirements.map(item=>evaluateReceipt(declaration,item,receipts.find(receipt=>receipt.scenarioId===item.id),identity));
  const status=scenarios.every(item=>item.status==='PASS')?'PASS':scenarios.some(item=>item.status==='FAIL')?'FAIL':scenarios.some(item=>item.status==='BLOCKED')?'BLOCKED':'NOT_RUN';
  return {protocol:PROTOCOL,revision:declaration.revision,target:declaration.target,runId:declaration.runId,status,scenarios};
}
