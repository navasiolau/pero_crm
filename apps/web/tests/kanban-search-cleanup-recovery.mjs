// Явный ONE-SHOT Root recovery для доказанного remote refusal ДО container/SQL dispatch.
// Не меняет frozen117 producer/runner/source pins и не перезаписывает исходный ledger.
// SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; СТОП при mismatch.
import {readFileSync,openSync,writeFileSync,fsyncSync,closeSync,existsSync,lstatSync,realpathSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {acceptanceRoot,qaTransport} from './crm-acceptance-transport.mjs';
import {search117Bundle} from './kanban-search-root-runner.mjs';
import {SEARCH117_NAMESPACE,basic117,need117,digest117,bytes117,canonical117,validatePreferenceEvents117} from './kanban-search-owned-protocol.mjs';
const CAP_ENV=96*1024,CAP_BUNDLE=256*1024;
const names=['pre','checkpoint','observation','cleanup-events','cleanup-intent','browser-result'];
const same=(a,b,code)=>need117(canonical117(a)===canonical117(b),code);
function privateDirectory(options){basic117(options);need117(path.isAbsolute(options.directory??''),'K117_RECOVERY_PRIVATE_DIRECTORY_REQUIRED');const base=path.join(acceptanceRoot,'.playwright-mcp','search117'),dir=path.resolve(options.directory);need117(existsSync(base)&&realpathSync(base).toLowerCase()===base.toLowerCase()&&path.dirname(dir).toLowerCase()===base.toLowerCase()&&path.basename(dir)==='owned-'+options.runId&&lstatSync(dir).isDirectory()&&!lstatSync(dir).isSymbolicLink()&&realpathSync(dir).toLowerCase()===dir.toLowerCase(),'K117_RECOVERY_DIRECTORY_BINDING');return dir;}
/** Новый каталог только для transport diagnostics; никакие старые файлы не переиспользуются. */
export function create117RecoveryLogDirectory(directory){
 need117(typeof directory==='string'&&path.isAbsolute(directory)&&existsSync(directory)&&lstatSync(directory).isDirectory()&&!lstatSync(directory).isSymbolicLink()&&realpathSync(directory).toLowerCase()===path.resolve(directory).toLowerCase(),'K117_RECOVERY_LOG_PARENT_INVALID');
 const output=path.resolve(directory,'cleanup-recovery-transport');
 need117(path.isAbsolute(output)&&path.dirname(output).toLowerCase()===path.resolve(directory).toLowerCase()&&!existsSync(output),'K117_RECOVERY_LOG_DIRECTORY_ALREADY_EXISTS');
 mkdirSync(output,{mode:0o700});
 need117(lstatSync(output).isDirectory()&&!lstatSync(output).isSymbolicLink()&&realpathSync(output).toLowerCase()===output.toLowerCase(),'K117_RECOVERY_LOG_REPARSE_FORBIDDEN');return output;
}
function readArtifacts(dir){return Object.fromEntries(names.map(name=>{const f=path.join(dir,name+'.json');need117(existsSync(f)&&lstatSync(f).isFile()&&!lstatSync(f).isSymbolicLink(),'K117_RECOVERY_IMMUTABLE_ARTIFACT_REQUIRED');const bytes=readFileSync(f);return[name,{sha256:bytes117(bytes),value:JSON.parse(bytes.toString('utf8'))}];}));}
function immutable(dir,name,value){const f=path.join(dir,name+'.json');const fd=openSync(f,'wx',0o600);try{writeFileSync(fd,JSON.stringify(value,null,2)+String.fromCharCode(10));fsyncSync(fd);}finally{closeSync(fd);}return f;}
export function derive117CleanupRecovery(artifacts,options){
 basic117(options);const refusal=options.knownRefusal;
 need117(refusal?.code==='BROWSER_INPUT_TOO_LARGE'&&refusal.operation==='restore'&&/^[a-f0-9]{6,16}$/.test(refusal.toolChunkId??'')&&refusal.boundary==='protected-wrapper-before-container-dispatch','K117_RECOVERY_KNOWN_REMOTE_NODISPATCH_REQUIRED');
 const pre=artifacts.pre.value.value,cp=artifacts.checkpoint.value.value,obs=artifacts.observation.value.value,events=artifacts['cleanup-events'].value,intent=artifacts['cleanup-intent'].value,browser=artifacts['browser-result'].value;
 for(const[kind,value]of [['pre',pre],['checkpoint',cp],['observation',obs]])need117(value?.namespace===SEARCH117_NAMESPACE&&value.version===1&&value.kind===kind&&value.runId===options.runId&&value.revision===options.revision&&/^[a-f0-9]{64}$/.test(value.signature??''),'K117_RECOVERY_SIGNED_SCOPE_MISMATCH');
 need117(intent.runId===options.runId&&intent.revision===options.revision&&intent.observationSha256===digest117(obs)&&intent.eventHash===digest117(events),'K117_RECOVERY_ORIGINAL_INTENT_DIGEST_MISMATCH');
 need117(cp.preSha256===digest117(pre)&&obs.preSha256===digest117(pre)&&obs.checkpointHash===digest117(cp)&&obs.eventHash===digest117(events),'K117_RECOVERY_SIGNED_CHAIN_MISMATCH');
 const own=validatePreferenceEvents117(events,pre);same([...own].sort((a,b)=>a.key.localeCompare(b.key)),obs.preferences,'K117_RECOVERY_LAST_ACK_PREFS_MISMATCH');
 need117(browser.status==='BROWSER_CHECKS_PASSED_CLEANUP_REQUIRED'&&browser.requestsDrained===true&&!browser.unresolvedIntents&&browser.runId===options.runId&&browser.revision===options.revision,'K117_RECOVERY_BROWSER_NOT_DRAINED');
 same(artifacts.pre.value.sources,artifacts.checkpoint.value.sources,'K117_RECOVERY_FROZEN_CP_SOURCES_MISMATCH');same(artifacts.pre.value.sources,artifacts.observation.value.sources,'K117_RECOVERY_FROZEN_OBS_SOURCES_MISMATCH');
 same(artifacts.pre.value.receipt.identity,artifacts.checkpoint.value.receipt.identity,'K117_RECOVERY_ORIGINAL_PHYSICAL_CP_MISMATCH');same(artifacts.pre.value.receipt.identity,artifacts.observation.value.receipt.identity,'K117_RECOVERY_ORIGINAL_PHYSICAL_OBS_MISMATCH');
 const fullInput={operation:'restore',phase:'cleanup',authorized:true,runId:options.runId,revision:options.revision,pre,preSha256:digest117(pre),checkpoint:cp,events,observation:obs,observationSha256:digest117(obs)};
 const utf8Bytes=Buffer.byteLength(JSON.stringify(fullInput)),base64Chars=Buffer.from(JSON.stringify(fullInput)).toString('base64').length;
 need117(base64Chars>CAP_ENV,'K117_RECOVERY_EXPECTED_ORIGINAL_OVERSIZE_REQUIRED');
 const minimalInput={operation:'restore',phase:'cleanup',authorized:true,runId:options.runId,revision:options.revision};need117(Buffer.from(JSON.stringify(minimalInput)).toString('base64').length<=CAP_ENV,'K117_RECOVERY_MINIMAL_ENV_TOO_LARGE');
 return{fullInput,minimalInput,utf8Bytes,base64Chars,envCap:CAP_ENV,identity:artifacts.pre.value.receipt.identity,sources:artifacts.pre.value.sources,artifactDigests:Object.fromEntries(Object.entries(artifacts).map(([name,row])=>[name,row.sha256])),originalIntentSha256:artifacts['cleanup-intent'].sha256,knownRefusal:{...refusal}};
}
export async function build117CleanupRecovery(options){const directory=privateDirectory(options),artifacts=readArtifacts(directory),plan=derive117CleanupRecovery(artifacts,options),pack=await search117Bundle(plan.fullInput);same(pack.sources,plan.sources,'K117_RECOVERY_LIVE_SOURCE_PINS_CHANGED');need117(pack.bytes.length<=CAP_BUNDLE,'K117_RECOVERY_FROZEN_BUNDLE_CAP_EXCEEDED');return{directory,artifacts,plan,pack};}
function validatedRemote(result,phase,pack,plan){need117(result?.body?.status==='TECHNICAL_RESULT'&&result.body.phase===phase&&result.receipt?.operation===(phase==='cleanup'?'restore':'inspect')&&result.receipt.bundleSha256===pack.sha256,'K117_RECOVERY_ACTUAL_RESPONSE_BOUNDARY');same(result.receipt.identity,plan.identity,'K117_RECOVERY_PHYSICAL_IDENTITY_CHANGED');return result.body.result;}
/** Только Root после отдельного review. Ровно один restore; без retry/cap weakening/source edits. */
export async function execute117CleanupRecovery(options){
 const prepared=await build117CleanupRecovery(options),{directory,plan,pack}=prepared;
 need117(!existsSync(path.join(directory,'cleanup-ack.json'))&&!existsSync(path.join(directory,'closed-proof.json')),'K117_ORIGINAL_CLEANUP_ALREADY_ACKNOWLEDGED');
 for(const name of ['cleanup-recovery-intent','cleanup-recovery-ack','cleanup-recovery-stop','cleanup-recovery-closed-intent','cleanup-recovery-closed'])need117(!existsSync(path.join(directory,name+'.json')),'K117_RECOVERY_ALREADY_ATTEMPTED_STOP');
 const logDirectory=create117RecoveryLogDirectory(directory);
 const wrapper=path.join(acceptanceRoot,'deploy/acceptance/crm-modernization-staging.py');
 immutable(directory,'cleanup-recovery-intent',{kind:'known-remote-nodispatch-cleanup-recovery',version:1,runId:options.runId,revision:options.revision,knownRefusal:plan.knownRefusal,originalIntentSha256:plan.originalIntentSha256,artifactDigests:plan.artifactDigests,frozenSources:plan.sources,preSha256:plan.fullInput.preSha256,checkpointHash:digest117(plan.fullInput.checkpoint),observationSha256:plan.fullInput.observationSha256,eventHash:digest117(plan.fullInput.events),fullInputHash:digest117(plan.fullInput),fullInputUtf8Bytes:plan.utf8Bytes,originalBase64Chars:plan.base64Chars,minimalEnvBase64Chars:Buffer.from(JSON.stringify(plan.minimalInput)).toString('base64').length,envCap:CAP_ENV,bundleCap:CAP_BUNDLE,bundleBytes:pack.bytes.length,bundleSha256:pack.sha256,wrapperSourceSha256:bytes117(readFileSync(wrapper)),expectedPhysicalIdentity:plan.identity,recoveryTransportLogDirectory:logDirectory});
 const transport=qaTransport({target:'staging',revision:options.revision,outputDir:logDirectory});let phase='cleanup',restoreReturned=false;
 try{
  const result=await transport.execute(pack.bytes,'restore',plan.minimalInput),ack=validatedRemote(result,'cleanup',pack,plan);restoreReturned=true;
  need117(ack?.namespace===SEARCH117_NAMESPACE&&ack.kind==='cleanup-ack'&&ack.runId===options.runId&&ack.revision===options.revision&&ack.originalPreSha256===plan.fullInput.preSha256&&ack.observationHash===plan.fullInput.observationSha256&&ack.commitAck===true&&ack.counts?.User===1&&ack.counts?.Client===1&&ack.counts?.Project===1&&ack.counts?.Product===1&&ack.counts?.UserPreference===plan.fullInput.observation.preferences.length&&/^[a-f0-9]{64}$/.test(ack.signature??''),'K117_RECOVERY_ACTUAL_CLEANUP_ACK_REQUIRED');
  immutable(directory,'cleanup-recovery-ack',{kind:'actual-recovery-cleanup-ack',value:ack,receipt:result.receipt,sources:pack.sources});
  phase='closed';const closedFull={operation:'inspect',phase:'closed',authorized:true,runId:options.runId,revision:options.revision,pre:plan.fullInput.pre,preSha256:plan.fullInput.preSha256,cleanupAck:ack},closedPack=await search117Bundle(closedFull);same(closedPack.sources,plan.sources,'K117_RECOVERY_POST_ACK_SOURCES_CHANGED');
  const closedMinimal={operation:'inspect',phase:'closed',authorized:true,runId:options.runId,revision:options.revision};
  immutable(directory,'cleanup-recovery-closed-intent',{runId:options.runId,revision:options.revision,cleanupAckHash:digest117(ack),fullInputHash:digest117(closedFull),bundleBytes:closedPack.bytes.length,bundleSha256:closedPack.sha256,expectedPhysicalIdentity:plan.identity});
  const closedResult=await transport.execute(closedPack.bytes,'inspect',closedMinimal),closed=validatedRemote(closedResult,'closed',closedPack,plan);
  need117(closed?.namespace===SEARCH117_NAMESPACE&&closed.kind==='closed-proof'&&closed.runId===options.runId&&closed.revision===options.revision&&closed.originalPreSha256===plan.fullInput.preSha256&&closed.cleanupAckHash===digest117(ack)&&closed.remainingOwnedRows===0&&closed.originalsMatch===true&&/^[a-f0-9]{64}$/.test(closed.signature??''),'K117_RECOVERY_ACTUAL_CLOSED_PROOF_REQUIRED');
  immutable(directory,'cleanup-recovery-closed',{kind:'actual-recovery-closed-proof',value:closed,receipt:closedResult.receipt,sources:closedPack.sources});
  return{status:'PASS',revision:options.revision,runId:options.runId,knownOriginalBoundary:'remote physical wrapper before container/Prisma/SQL dispatch',cleanupCommitAcknowledged:true,counts:ack.counts,remainingOwnedRows:0,originalsMatch:true,browserChecks:prepared.artifacts['browser-result'].value.checks.length};
 }catch(error){const code=/^(?:K117|TOKEN_CLOCK|[A-Z]+)_[A-Z0-9_]+$/.test(error?.message??'')?error.message:'K117_RECOVERY_STOP_PRESERVE_STATE';immutable(directory,'cleanup-recovery-stop',{status:'STOP',phase,code,restoreReturned,restoreOutcome:restoreReturned?'returned-ack-needs-proof':'unknown-after-recovery-dispatch-no-retry',runId:options.runId,revision:options.revision});throw Error(code);}
}
