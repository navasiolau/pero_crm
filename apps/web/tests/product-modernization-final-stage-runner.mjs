// Root-only final coordinator. No runtime is entered merely by importing this file.
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {qaTransport,qaProcess,qaBasicAuth,acceptanceRoot,acceptanceWeb,bundleHash} from './crm-acceptance-transport.mjs';
import {bundleProductAttachmentsQa} from './product-attachments-qa-bundle.mjs';
import {runProductModernizationFinalBrowser} from './product-modernization-final-browser.mjs';
const requireThat=(ok,code)=>{if(!ok)throw Error(code)};
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function finalJournalScope(fixture,journal){
 requireThat(Array.isArray(journal.ownWrites)&&journal.ownWrites.length<=100,'FINAL_JOURNAL_REQUIRED');
 const actors=new Set(Object.values(fixture.actors).map(row=>row.id)),products=[fixture.ids.productA,fixture.ids.productB];
 const scalarFields=['title','kind','description','expectedPrice','quantity','engineerId','project.clientId','project.address','client.phone'];
 const mutationIds=[],percentageMutationIds=[],percentageWrites=[],sketchWrites=[],noModelWrites=[],coverWrites=[];
 const uploads=journal.ownWrites.filter(row=>row.type==='file-upload'&&row.saved===true);
 for(const row of journal.ownWrites){
  const fileWrite=['file-upload','file-delete'].includes(row.type);
  requireThat(actors.has(row.actorId)&&(products.includes(row.productId)||(fileWrite&&row.productId===null&&row.projectId===fixture.ids.project)),'FINAL_JOURNAL_SUBJECT_STOP');
  if(row.type==='field'){
   requireThat(scalarFields.includes(row.field)&&uuid(row.clientMutationId)&&row.saved===true,'FINAL_SCALAR_SCOPE_STOP');
   if(!row.noOp&&!mutationIds.includes(row.clientMutationId))mutationIds.push(row.clientMutationId);
  }else if(row.type==='percentage'){
   const input=row.input;
   requireThat(row.saved===true&&uuid(row.clientMutationId)&&['ENGINEERING','ASSEMBLY','INSTALLATION'].includes(row.kind)&&['ratePercent','assigneeId'].includes(row.field)&&input&&Object.keys(input).sort().join('|')==='clientMutationId|expectedRevision|expectedValue|field|kind|productId|value'&&input.clientMutationId===row.clientMutationId&&input.productId===row.productId&&input.kind===row.kind&&input.field===row.field,'FINAL_PERCENTAGE_RAW_SCOPE_STOP');
   if(!row.noOp&&!percentageMutationIds.includes(row.clientMutationId)){percentageMutationIds.push(row.clientMutationId);percentageWrites.push(structuredClone(row));}
  }else if(row.type==='sketch'){
   requireThat(row.ok===true&&uuid(row.clientMutationId)&&typeof row.fileId==='string'&&['upload','delete'].includes(row.operation),'FINAL_SKETCH_SCOPE_STOP');sketchWrites.push(structuredClone(row));
  }else if(row.type==='no-model'){
   requireThat(row.ok===true&&typeof row.before==='boolean'&&typeof row.value==='boolean','FINAL_NOMODEL_SCOPE_STOP');noModelWrites.push(structuredClone(row));
  }else if(fileWrite){
   requireThat(row.saved===true&&typeof row.fileId==='string'&&row.projectId===fixture.ids.project,'FINAL_FILE_SCOPE_STOP');
   if(row.type==='file-delete')requireThat(uploads.some(upload=>upload.fileId===row.fileId&&upload.projectId===row.projectId&&upload.productId===row.productId),'FINAL_DELETE_WITHOUT_CAPTURED_UPLOAD_STOP');
  }
  else throw Error('FINAL_UNKNOWN_OWN_WRITE_STOP');
 }
 requireThat(Array.isArray(journal.preferenceOwnWrites)&&journal.preferenceOwnWrites.length<=30&&journal.preferenceOwnWrites.every(row=>actors.has(row.userId)&&['projects.list','project.tab','product.tab'].includes(row.key)&&typeof row.value==='string'&&row.value.length<=8192),'FINAL_PREFERENCE_SCOPE_STOP');
 return{mutationIds,percentageMutationIds,percentageWrites,sketchWrites,noModelWrites,coverWrites};
}
export async function runProductModernizationFinalStage({target,revision,authorized=false}){
 requireThat(authorized===true&&['local','staging'].includes(target)&&/^[a-f0-9]{40}$/.test(revision??''),'FINAL_AUTHORIZED_TARGET_REVISION_REQUIRED');
 const outputDir=path.join(acceptanceRoot,'.playwright-mcp','modernization',`${target}-final-${randomUUID()}`);await mkdir(outputDir,{recursive:true});
 async function save(name,value){const file=path.join(outputDir,name);await writeFile(`${file}.tmp`,JSON.stringify(value,null,2),{mode:0o600});await rename(`${file}.tmp`,file)}
 const transport=qaTransport({target,revision,outputDir});
 try{
  const checked=await qaProcess(process.execPath,['--check',path.join(acceptanceWeb,'tests/product-modernization-final-browser.mjs')]);requireThat(checked.code===0,'FINAL_HELPER_SYNTAX_STOP');
  if(target==='local')requireThat(typeof process.env.CRM_PROJECT_QA_LOCAL_UPLOADS_ROOT==='string'&&path.resolve(process.env.CRM_PROJECT_QA_LOCAL_UPLOADS_ROOT).toLowerCase()===path.join(acceptanceWeb,'uploads').toLowerCase(),'FINAL_LOCAL_UPLOADS_ROOT_REQUIRED');
  const sessionBytes=await bundleProductAttachmentsQa('product-attachments-session.mjs'),fixtureBytes=await bundleProductAttachmentsQa('product-attachments-fixtures.mjs');
  const prepared=await transport.execute(sessionBytes,'prepare',{operation:'prepare'}),session=prepared.body;requireThat(session.status==='PREPARED','FINAL_SESSION_PREPARE_STOP');await save('session-checkpoint.json',session.checkpoint);
  const owned=await transport.execute(fixtureBytes,'prepare',{operation:'prepare',runId:randomUUID(),sessionCheckpoint:session.checkpoint}),fixture=owned.body;requireThat(fixture.status==='PREPARED','FINAL_FIXTURE_PREPARE_STOP');await save('fixture-checkpoint.json',fixture.checkpoint);
  const origin=target==='local'?'http://127.0.0.1:3019':'https://staging-crm.peromebel.by';
  const profiles=Object.fromEntries(Object.entries(session.profiles).map(([key,profile])=>[key,{id:profile.id,roles:profile.roles,cookies:profile.cookies.filter(cookie=>origin.startsWith('https:')||!cookie.name.startsWith('__Secure-')).map(cookie=>({...cookie,url:origin,secure:origin.startsWith('https:'),httpOnly:true,sameSite:'Lax'}))}]));
  const basicAuth=target==='staging'?await qaBasicAuth():undefined;
  let journal={ownWrites:[],preferenceOwnWrites:[]},fileObservation=null;
  const scope=()=>finalJournalScope(fixture,journal);
  const browser=await runProductModernizationFinalBrowser({origin,expectedRevision:revision,authorized:true,profiles,fixture,outputDir,basicAuth,runZoom:true,
   onOwnWrites:async value=>{journal=structuredClone(value);scope();await save('owned-write-journal.json',journal)},
   onOwnFiles:async({uploadedFileIds})=>{
    requireThat(Array.isArray(uploadedFileIds)&&uploadedFileIds.length>0&&uploadedFileIds.length<=12&&new Set(uploadedFileIds).size===uploadedFileIds.length,'FINAL_ONCE_PREDELETE_FILE_MANIFEST_REQUIRED');
    const uploads=journal.ownWrites.filter(row=>row.type==='file-upload'&&row.saved).map(row=>row.fileId);requireThat(uploads.length===uploadedFileIds.length&&uploads.every(id=>uploadedFileIds.includes(id)),'FINAL_PREDELETE_ALL_UPLOADS_REQUIRED');
    // Functional recovery reuses the exact immutable pre-delete signature.
    // It may neither add a new file nor observe already deleted keys as live.
    if(fileObservation){requireThat(fileObservation.files.length===uploadedFileIds.length&&fileObservation.files.every(row=>uploadedFileIds.includes(row.id)),'FINAL_PREDELETE_MANIFEST_CHANGED_STOP');return;}
    const result=await transport.execute(fixtureBytes,'inspect',{operation:'inspect',mode:'files',checkpoint:fixture.checkpoint,uploadedFileIds,...scope()});
    requireThat(result.body.fileObservation?.signature&&result.body.fileObservation.files.length===uploadedFileIds.length,'FINAL_SIGNED_FILE_MANIFEST_REQUIRED');
    fileObservation=result.body.fileObservation;await save('file-observation-before-first-delete.json',fileObservation);
   }});
  const requests=JSON.parse(await readFile(path.join(outputDir,'final-request-journal.json'),'utf8'));
  requireThat(browser.protocolStopped!==true&&!browser.failures?.some(code=>typeof code==='string'&&/STOP|UNAUTHORIZED_MUTATION|CAPTURE_FAILED/.test(code)),'FINAL_PROTOCOL_STOP_PRESERVE_STATE');
  requireThat(Array.isArray(requests)&&requests.every(row=>['response-captured','aborted-before-upstream'].includes(row.phase)||(row.phase==='response-lost-after-upstream-commit'&&row.type==='scalar'&&row.result?.kind==='saved'&&row.result.clientMutationId===row.input?.clientMutationId&&journal.ownWrites.some(write=>write.type==='field'&&write.saved===true&&write.clientMutationId===row.input.clientMutationId))),'FINAL_UNCONFIRMED_REQUEST_STOP_PRESERVE_STATE');
  const uploads=[...new Set(journal.ownWrites.filter(row=>row.type==='file-upload'&&row.saved).map(row=>row.fileId))];
  requireThat(!uploads.length||(fileObservation&&fileObservation.files.length===uploads.length&&fileObservation.files.every(row=>uploads.includes(row.id))),'FINAL_ALL_FILE_KEYS_COVERAGE_REQUIRED');
  const inspected=await transport.execute(fixtureBytes,'inspect',{operation:'inspect',checkpoint:fixture.checkpoint,...scope(),...(fileObservation?{fileObservation}:{})});
  requireThat(inspected.body.status==='INSPECTED'&&inspected.body.originalData==='MATCH','FINAL_ORIGINAL_DATA_INSPECT_STOP');await save('fixture-observation.json',inspected.body.observation);
  const cleaned=await transport.execute(fixtureBytes,'restore',{operation:'restore',checkpoint:fixture.checkpoint,observation:inspected.body.observation});
  requireThat(cleaned.body.status==='CLEANED'&&cleaned.body.originalData==='MATCH','FINAL_ORIGINAL_DATA_RESTORE_STOP');await save('fixture-cleanup.json',cleaned.body);
  const prefInspected=await transport.execute(sessionBytes,'inspect',{operation:'inspect',checkpoint:session.checkpoint,ownWrites:journal.preferenceOwnWrites});requireThat(prefInspected.body.status==='INSPECTED'&&prefInspected.body.restoreAllowedByRecordedValues===true&&prefInspected.body.dataIntegrity?.status==='MATCH','FINAL_ORIGINAL_PREFERENCES_INSPECT_STOP');await save('preferences-before-restore.json',prefInspected.body);
  const prefCleaned=await transport.execute(sessionBytes,'restore',{operation:'restore',checkpoint:session.checkpoint,ownWrites:journal.preferenceOwnWrites});
  requireThat(prefCleaned.body.status==='RESTORED'&&prefCleaned.body.dataIntegrity?.status==='PASS','FINAL_ORIGINAL_PREFERENCES_RESTORE_STOP');await save('preference-cleanup.json',prefCleaned.body);
  const status=browser.status==='PASS'?'PASS':'FAIL';await save('final-receipt.json',{status,target,revision,bundleHashes:{session:bundleHash(sessionBytes),fixtures:bundleHash(fixtureBytes)},browser,originalData:cleaned.body.originalData,preferences:prefCleaned.body});
  const report={status,checks:browser.checks?.length??0,files:uploads.length,outputDir};console.log(JSON.stringify(report));return report;
 }catch(error){const code=/^[A-Z0-9_]+$/.test(error?.message??'')?error.message:'FINAL_QA_STOP_PRESERVE_STATE';await save('stop-receipt.json',{status:'STOP',target,revision,code});const report={status:'STOP',checks:0,outputDir};console.error(JSON.stringify(report));return{...report,code}}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const[target,revision,authorization]=process.argv.slice(2);const result=await runProductModernizationFinalStage({target,revision,authorized:authorization==='authorized'});if(result.status!=='PASS')process.exitCode=1}
