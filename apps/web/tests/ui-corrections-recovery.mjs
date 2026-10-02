// Root-only recovery of one preserved local QA. Import never runs browser/DB/SSH.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,rename,readdir} from 'node:fs/promises';
import path from 'node:path';
import {qaTransport,acceptanceRoot,acceptanceWeb,bundleHash} from './crm-acceptance-transport.mjs';
import {bundleProductAttachmentsQa} from './product-attachments-qa-bundle.mjs';
import {correctionJournalScope} from './ui-corrections-stage-runner.mjs';
import {cleanupUiCorrectionsFiles,correctionRecoveryAllowed} from './ui-corrections-browser.mjs';
const RUN='local-corrections-62c498d2-4895-433d-83a4-3a4d21d26c2b';
const hash=value=>bundleHash(Buffer.from(JSON.stringify(value)));
async function registeredExport(actionHash){
 const server=path.join(acceptanceWeb,'.next','server'),manifest=JSON.parse(await readFile(path.join(server,'server-reference-manifest.json'),'utf8'));
 const hits=['node','edge'].flatMap(kind=>Object.keys(manifest[kind]??{})).filter(id=>bundleHash(Buffer.from(id))===actionHash);assert.equal(hits.length,1,'RECOVERY_ACTION_HASH_MATCH_STOP');
 const candidates=await readdir(server,{recursive:true});let confirmed=false;
 for(const file of candidates.filter(file=>file.endsWith('.js'))){const text=await readFile(path.join(server,file),'utf8');for(let offset=text.indexOf(hits[0]);offset>=0;offset=text.indexOf(hits[0],offset+1)){if(text.slice(Math.max(0,offset-180),offset+hits[0].length+220).includes('saveListPreference'))confirmed=true;}}
 assert.ok(confirmed,'RECOVERY_ACTION_EXPORT_STOP');return 'saveListPreference';
}
export function validateRecoveryReadonlyEvidence({proof,originalFileBytes,signedFileBytes,blockedActionHash}){
 assert.equal(proof.kind,'corrections-exact-scope-readonly-reconciliation','RECOVERY_READONLY_KIND_STOP');assert.equal(proof.status,'MATCH','RECOVERY_READONLY_MATCH_STOP');assert.equal(proof.target,'local','RECOVERY_READONLY_TARGET_STOP');
 for(const key of ['originalFingerprintsMatched','financialDependenciesZero','capturedInputPreserved'])assert.equal(proof[key],true,'RECOVERY_READONLY_INVARIANTS_STOP');
 assert.equal(proof.knownFileCount,7,'RECOVERY_READONLY_FILES_STOP');assert.equal(proof.knownExtraClientCount,1,'RECOVERY_READONLY_CLIENT_STOP');assert.equal(proof.knownStatusBackCount,1,'RECOVERY_READONLY_BACK_STOP');assert.equal(proof.dbWrites,0,'RECOVERY_READONLY_DB_WRITES_STOP');assert.equal(proof.storageWrites,0,'RECOVERY_READONLY_STORAGE_WRITES_STOP');
 assert.equal(proof.blockedPreferenceProof,'ROOT36_SOURCE_BEFORE_UPSTREAM_BRANCH_NO_RESPONSE','RECOVERY_READONLY_ABORT_PROOF_STOP');assert.equal(proof.blockedPreferenceActionHash,blockedActionHash,'RECOVERY_READONLY_ACTION_HASH_STOP');assert.equal(proof.originalBrowserStatus,'FAILED_UNCHANGED','RECOVERY_OLD_FAIL_UNCHANGED_STOP');
 const names=['fixture-checkpoint.json','owned-write-journal.json','final-browser-receipt.json'];assert.deepEqual(Object.keys(proof.originalFilesHashes??{}).sort(),[...names].sort(),'RECOVERY_ORIGINAL_HASH_SET_STOP');
 for(const name of names)assert.equal(bundleHash(originalFileBytes[name]),proof.originalFilesHashes[name],'RECOVERY_ORIGINAL_FILE_HASH_STOP');assert.equal(bundleHash(signedFileBytes),proof.signedFileObservationHash,'RECOVERY_SIGNED_MANIFEST_HASH_STOP');return true;
}
export async function recoverKnownUiCorrections({revision,authorized=false}={}){
 assert.equal(authorized,true,'RECOVERY_ROOT_AUTH_REQUIRED');assert.match(revision??'',/^[a-f0-9]{40}$/,'RECOVERY_REVISION_REQUIRED');
 const directory=path.join(acceptanceRoot,'.playwright-mcp','corrections',RUN),outputDir=path.join(directory,`root-reviewed-recovery-${randomUUID()}`);await mkdir(outputDir,{recursive:false});
 const read=name=>readFile(path.join(directory,name),'utf8').then(JSON.parse);
 async function save(name,value){const file=path.join(outputDir,name);await writeFile(file+'.tmp',JSON.stringify(value,null,2),{mode:0o600,flag:'wx'});await rename(file+'.tmp',file);}
 let phase='read-only-evidence';
 try{
  const fixtureCheckpoint=await read('fixture-checkpoint.json'),sessionCheckpoint=await read('session-checkpoint.json'),originalReceipt=await read('final-browser-receipt.json'),originalJournal=await read('owned-write-journal.json'),requests=await read('final-request-journal.json');
  assert.deepEqual(requests,originalReceipt.requests,'RECOVERY_REQUEST_JOURNAL_BINDING_STOP');assert.equal(fixtureCheckpoint.target,'local','RECOVERY_TARGET_STOP');assert.equal(fixtureCheckpoint.correctionMode,true,'RECOVERY_FIXTURE_MODE_STOP');assert.ok(!sessionCheckpoint.correctionMode&&!sessionCheckpoint.originalPreferences.some(row=>row.key==='products.list'),'RECOVERY_OLD_PREF_SCOPE_STOP');
  const fixture={checkpoint:fixtureCheckpoint,ids:fixtureCheckpoint.ids,actors:fixtureCheckpoint.actors,numbers:fixtureCheckpoint.numbers,paths:{productA:`/products/${fixtureCheckpoint.numbers.productA}`,productB:`/products/${fixtureCheckpoint.numbers.productB}`,project:`/projects/${fixtureCheckpoint.ids.project}`}};
  let journal=structuredClone(originalJournal);const scope=()=>correctionJournalScope(fixture,journal,sessionCheckpoint);
  const known={...originalReceipt,requests,ownWrites:journal.ownWrites,extraClientWrites:journal.extraClientWrites,statusWrites:journal.statusWrites};
  const blocked=requests.filter(row=>row.type==='blocked');assert.equal(blocked.length,1,'RECOVERY_UNKNOWN_COUNT_STOP');assert.ok(!['responseMetadata','result','httpStatus','delivery'].some(key=>Object.hasOwn(blocked[0],key)),'RECOVERY_UPSTREAM_EVIDENCE_STOP');
  const readonlyProof=await read('corrections-readonly-proof.json'),signedFileBytes=await readFile(path.join(directory,'reconciled-signed-file-observation.json'));const originalFileBytes=Object.fromEntries(await Promise.all(['fixture-checkpoint.json','owned-write-journal.json','final-browser-receipt.json'].map(async name=>[name,await readFile(path.join(directory,name))])));validateRecoveryReadonlyEvidence({proof:readonlyProof,originalFileBytes,signedFileBytes,blockedActionHash:blocked[0].actionHash});
  const exportName=await registeredExport(blocked[0].actionHash);
  const uploadedFileIds=journal.ownWrites.filter(row=>row.type==='file-upload'&&row.saved).map(row=>row.fileId);assert.equal(uploadedFileIds.length,7,'RECOVERY_EXACT_SEVEN_UPLOADS_STOP');assert.equal(new Set(uploadedFileIds).size,7,'RECOVERY_UPLOAD_DUPLICATE_STOP');assert.ok(!journal.ownWrites.some(row=>row.type==='file-delete'||row.type==='sketch'&&row.operation==='delete'),'RECOVERY_PRIOR_DELETE_STOP');scope();
  const transport=qaTransport({target:'local',revision,outputDir}),fixtureBytes=await bundleProductAttachmentsQa('product-attachments-fixtures.mjs'),sessionBytes=await bundleProductAttachmentsQa('product-attachments-session.mjs');
  // Root's actual read-only MATCH includes the extra Client and seven files;
  // preserve and consume its unchanged signed pre-delete observation.
  const fileObservation=JSON.parse(signedFileBytes.toString('utf8'));
  const proof={registeredActionExport:exportName,actionHash:blocked[0].actionHash,requestJournalHash:hash(requests),fileObservation};assert.ok(correctionRecoveryAllowed(known,fixture,proof),'RECOVERY_CLOSED_PROOF_STOP');await save('unknown-no-upstream-and-client-match-proof.private.json',proof);
  phase='resume-old-session';const resumed=await transport.execute(sessionBytes,'readonly',{operation:'resume',checkpoint:sessionCheckpoint});assert.equal(resumed.body.status,'RESUMED','RECOVERY_EXISTING_SESSION_RESUME_STOP');assert.equal(resumed.body.checkpointSignature,sessionCheckpoint.signature,'RECOVERY_SESSION_CP_CHANGED_STOP');
  const origin='http://127.0.0.1:3019',profiles=Object.fromEntries(Object.entries(resumed.body.profiles).map(([key,profile])=>[key,{id:profile.id,roles:profile.roles,cookies:profile.cookies.filter(cookie=>!cookie.name.startsWith('__Secure-')).map(cookie=>({...cookie,url:origin,secure:false,httpOnly:true,sameSite:'Lax'}))}]));
  const fileWrites=new Map(journal.ownWrites.map(row=>[row.clientMutationId??`${row.type}:${row.fileId}`,row]));
  phase='exact-app-deletes';const browser=await cleanupUiCorrectionsFiles({origin,expectedRevision:revision,authorized:true,profiles,fixture,outputDir:path.join(outputDir,'app-delete'),knownJournal:known,recoveryProof:proof,signedPreferenceScope:sessionCheckpoint,
   onOwnWrites:async value=>{for(const row of value.ownWrites)fileWrites.set(row.clientMutationId??`${row.type}:${row.fileId}`,row);journal={...journal,ownWrites:[...fileWrites.values()],preferenceOwnWrites:[...originalJournal.preferenceOwnWrites,...value.preferenceOwnWrites]};scope();await save('recovery-owned-journal.private.json',journal);},
   onOwnFiles:async({uploadedFileIds:ids})=>{assert.deepEqual([...ids].sort(),[...uploadedFileIds].sort(),'RECOVERY_SIGNED_FILE_IDS_CHANGED_STOP');}});
  assert.equal(browser.protocolStopped,false,'RECOVERY_APP_PROTOCOL_STOP');const deletes=journal.ownWrites.filter(row=>row.type==='file-delete'&&row.saved||row.type==='sketch'&&row.operation==='delete'&&row.ok);assert.deepEqual([...new Set(deletes.map(row=>row.fileId))].sort(),[...uploadedFileIds].sort(),'RECOVERY_EXACT_CONFIRMED_DELETES_STOP');await save('app-cleanup-render-result.private.json',{status:browser.status,failures:browser.failures,protocolStopped:browser.protocolStopped});
  phase='signed-absence-and-original-fingerprints';const observation=await transport.execute(fixtureBytes,'inspect',{operation:'inspect',checkpoint:fixtureCheckpoint,fileObservation,...scope()});assert.equal(observation.body.status,'INSPECTED','RECOVERY_POST_DELETE_INSPECT_STOP');assert.equal(observation.body.originalData,'MATCH','RECOVERY_ORIGINAL_DATA_STOP');await save('recovery-fixture-observation.private.json',observation.body.observation);
  const cleanup=await transport.execute(fixtureBytes,'restore',{operation:'restore',checkpoint:fixtureCheckpoint,observation:observation.body.observation});assert.equal(cleanup.body.status,'CLEANED','RECOVERY_FIXTURE_RESTORE_STOP');assert.equal(cleanup.body.originalData,'MATCH','RECOVERY_ORIGINAL_POST_RESTORE_STOP');await save('recovery-fixture-cleanup.private.json',cleanup.body);
  phase='old-three-key-preferences';const preferences=await transport.execute(sessionBytes,'inspect',{operation:'inspect',checkpoint:sessionCheckpoint,ownWrites:journal.preferenceOwnWrites});assert.equal(preferences.body.status,'INSPECTED','RECOVERY_PREF_INSPECT_STOP');assert.equal(preferences.body.restoreAllowedByRecordedValues,true,'RECOVERY_PREF_CAS_STOP');
  const restored=await transport.execute(sessionBytes,'restore',{operation:'restore',checkpoint:sessionCheckpoint,ownWrites:journal.preferenceOwnWrites});assert.equal(restored.body.status,'RESTORED','RECOVERY_PREF_RESTORE_STOP');assert.equal(restored.body.dataIntegrity?.status,'PASS','RECOVERY_PREF_ORIGINAL_STOP');
  await save('recovery-receipt.private.json',{status:'CLEANED',priorRunStatus:'STOP',revision,bundleHashes:{fixtures:bundleHash(fixtureBytes),session:bundleHash(sessionBytes)},files:7,originalData:cleanup.body.originalData,preferences:restored.body,appCleanupStatus:browser.status,readonlyProofHash:bundleHash(await readFile(path.join(directory,'corrections-readonly-proof.json'))),originalFilesHashes:readonlyProof.originalFilesHashes,signedFileObservationHash:readonlyProof.signedFileObservationHash});const report={status:'CLEANED',files:7,originalData:'MATCH',preferences:'RESTORED'};console.log(JSON.stringify(report));return report;
 }catch(error){const direct=error?.message??'';const code=/^[A-Z0-9_]+$/.test(direct)?direct:direct.match(/\bRECOVERY_[A-Z0-9_]+\b/)?.[0]??'RECOVERY_FAILED_PRESERVE_STATE';await save('recovery-stop-receipt.private.json',{status:'STOP',preserveState:true,revision,phase,code});const report={status:'STOP',preserveState:true,phase,code};console.log(JSON.stringify(report));return report;}
}
