// Координатор №19: root запускает existing local/staging. Здесь нет Prisma/storage cleanup.
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {qaTransport,qaProcess,qaBasicAuth,acceptanceRoot,acceptanceWeb,bundleHash} from './crm-acceptance-transport.mjs';
import {bundleProductDescriptionQa} from './product-description-qa-bundle.mjs';
import {runProductDescriptionBrowser} from './product-description-browser.mjs';
import {runCrmBrowserZoom} from './crm-browser-zoom.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const requireThat=(ok,code)=>{if(!ok)throw Error(code)};
const empty=()=>({ownWrites:[],preferenceOwnWrites:[]});
export function descriptionMutationIds(fixture,journal){
 requireThat(Array.isArray(journal.ownWrites)&&journal.ownWrites.length<=100,'DESCRIPTION_JOURNAL_REQUIRED');const actors=new Set(Object.values(fixture.actors).map(row=>row.id)),ids=new Set();
 for(const row of journal.ownWrites){requireThat(actors.has(row.actorId)&&[fixture.ids.productA,fixture.ids.productB].includes(row.productId)&&row.field==='description'&&UUID.test(row.clientMutationId??''),'DESCRIPTION_OWNED_RECEIPT_SCOPE_STOP');if(!row.noOp)ids.add(row.clientMutationId)}
 for(const row of journal.preferenceOwnWrites??[])requireThat(actors.has(row.userId)&&row.key==='product.tab'&&row.value==='overview','DESCRIPTION_PREFERENCE_SCOPE_STOP');return[...ids].sort();
}
const join=(ui,zoom)=>{const prefs=new Map();for(const row of [...(ui.preferenceOwnWrites??[]),...(zoom.preferenceOwnWrites??[])])prefs.set(`${row.userId}/${row.key}`,row);return{ownWrites:ui.ownWrites??[],preferenceOwnWrites:[...prefs.values()]}};
async function readOptional(file,fallback){try{return JSON.parse(await readFile(file,'utf8'))}catch(error){if(error.code==='ENOENT')return fallback;throw Error('DESCRIPTION_PRIVATE_JOURNAL_INVALID_STOP')}}
export async function runProductDescriptionStage({target,revision,operation}){
 requireThat(['local','staging'].includes(target)&&/^[a-f0-9]{40}$/.test(revision??''),'DESCRIPTION_TARGET_REVISION_REQUIRED');requireThat(['native','browser','zoom'].includes(operation),'DESCRIPTION_OPERATION_REQUIRED');
 const outputDir=path.join(acceptanceRoot,'.playwright-mcp','modernization',`${target}-description-${operation}-${randomUUID()}`);await mkdir(outputDir,{recursive:true});const transport=qaTransport({target,revision,outputDir});
 async function save(name,value){const file=path.join(outputDir,name);await writeFile(`${file}.tmp`,JSON.stringify(value,null,2),{mode:0o600});await rename(`${file}.tmp`,file)}
 try{
  if(operation==='native'){
   const file=path.join(acceptanceWeb,'test-results/product-description-native.mjs'),built=await qaProcess(process.execPath,[path.join(acceptanceWeb,'tests/product-description-native-runner.mjs'),file]);requireThat(built.code===0,'DESCRIPTION_NATIVE_BUILD_FAILED');const bytes=await readFile(file),result=await transport.execute(bytes,'native');requireThat(result.body.kind==='product-description-native'&&result.body.rollbackVerified===true&&Array.isArray(result.body.checks)&&result.body.checks.length>0,'DESCRIPTION_NATIVE_RECEIPT_REQUIRED');await save('native-receipt.json',{revision,bundleSha256:bundleHash(bytes),...result.receipt});const report={status:'PASS',target,revision,operation,checks:result.body.checks.length,rollbackVerified:true,outputDir};console.log(JSON.stringify(report));return report;
  }
  const sessionBytes=await bundleProductDescriptionQa('product-description-session.mjs'),fixtureBytes=await bundleProductDescriptionQa('product-description-browser-fixtures.mjs');
  // Signed исходные business/prefs снимки предшествуют own fixtures и всем UI-контекстам.
  const prepared=await transport.execute(sessionBytes,'prepare',{operation:'prepare'}),session=prepared.body;requireThat(session.checkpoint.namespace==='PERO_PRODUCT_DESCRIPTION_SESSION_V1','DESCRIPTION_SESSION_NAMESPACE_STOP');await save('session-checkpoint.json',session.checkpoint);
  const owned=await transport.execute(fixtureBytes,'prepare',{operation:'prepare',runId:randomUUID(),sessionCheckpoint:session.checkpoint}),fixture=owned.body;requireThat(fixture.checkpoint.namespace==='PERO_PRODUCT_DESCRIPTION_BROWSER_FIXTURES_V1','DESCRIPTION_FIXTURE_NAMESPACE_STOP');await save('fixture-checkpoint.json',fixture.checkpoint);
  for(const[key,profile]of Object.entries(session.profiles))requireThat(fixture.actors[key]?.id===profile.id,'DESCRIPTION_FIXTURE_PROFILE_BINDING_STOP');
  const origin=target==='local'?'http://127.0.0.1:3019':'https://staging-crm.peromebel.by',profiles=Object.fromEntries(Object.entries(session.profiles).map(([key,profile])=>[key,{id:profile.id,roles:profile.roles,cookies:profile.cookies.filter(cookie=>origin.startsWith('https:')||!cookie.name.startsWith('__Secure-')).map(cookie=>({...cookie,url:origin,secure:origin.startsWith('https:'),httpOnly:true,sameSite:'Lax'}))}]));
  const basicAuth=target==='staging'?await qaBasicAuth():undefined;let browser,zoom,runtimeFailed=false,ui=empty(),zoomJournal=empty(),dataCleanup,prefCleanup;
  const journal=()=>join(ui,zoomJournal);async function persist(){await save('owned-write-journal.json',journal())}
  try{
   if(operation==='browser')browser=await runProductDescriptionBrowser({origin,profiles,fixture,outputDir,basicAuth,onOwnWrites:async value=>{ui=value;await persist()}});
   if(operation==='zoom'||browser?.status==='PASS')zoom=await runCrmBrowserZoom({origin,profile:profiles.admin,basicAuth,outputDir,pagePath:fixture.paths.productB,ownedProductPaths:[fixture.paths.productA,fixture.paths.productB],readySelector:'#product-inline-description',descriptionMode:{productId:fixture.ids.productB},onOwnWrites:async value=>{zoomJournal=value;await save('zoom-preference-journal.json',value);await persist()}});
  }catch{runtimeFailed=true;await save('runtime-stop.json',{code:'DESCRIPTION_BROWSER_RUNTIME_FAILED',capturedState:'inspect own receipt scope before guarded cleanup'})}
  finally{
   // Browser helpers release holds/drain requests/close contexts before this exact cleanup.
   ui=await readOptional(path.join(outputDir,'product-description-owned-writes.json'),ui);const requests=await readOptional(path.join(outputDir,'product-description-request-journal.json'),[]);zoomJournal=await readOptional(path.join(outputDir,'zoom-preference-journal.json'),zoomJournal);await persist();
   requireThat(!browser?.failures?.some(row=>typeof row==='string'&&/UNAUTHORIZED_MUTATION|ACTION_CAPTURE_FAILED/.test(row)),'DESCRIPTION_UNRECOGNIZED_MUTATION_STOP_PRESERVE_STATE');
   requireThat(!zoom?.checks?.some(row=>row.label==='unknown mutating request blocked'),'DESCRIPTION_ZOOM_UNRECOGNIZED_MUTATION_STOP_PRESERVE_STATE');
   requireThat(requests.every(row=>['response-captured','response-lost-after-upstream-commit'].includes(row.phase)&&row.result),'DESCRIPTION_UNCONFIRMED_UPSTREAM_RESULT_STOP_PRESERVE_STATE');
   const mutationIds=descriptionMutationIds(fixture,journal());const inspected=await transport.execute(fixtureBytes,'inspect',{operation:'inspect',checkpoint:fixture.checkpoint,mutationIds});requireThat(inspected.body.observation?.signature,'DESCRIPTION_SIGNED_OBSERVATION_REQUIRED');await save('fixture-observation.json',inspected.body.observation);
   dataCleanup=await transport.execute(fixtureBytes,'restore',{operation:'restore',checkpoint:fixture.checkpoint,observation:inspected.body.observation});await save('fixture-cleanup.json',dataCleanup.receipt);requireThat(dataCleanup.body.status==='CLEANED','DESCRIPTION_FIXTURE_CLEANUP_NOT_CONFIRMED');
   prefCleanup=await transport.execute(sessionBytes,'restore',{operation:'restore',checkpoint:session.checkpoint,ownWrites:journal().preferenceOwnWrites});await save('preference-cleanup.json',prefCleanup.receipt);requireThat(prefCleanup.body.status==='RESTORED','DESCRIPTION_SESSION_CLEANUP_NOT_CONFIRMED');
  }
  const status=!runtimeFailed&&(operation==='zoom'||browser?.status==='PASS')&&zoom?.status==='PASS'?'PASS':'FAIL';await save('description-receipt.json',{status,target,revision,browser,zoom,dataCleanup:dataCleanup.body,prefCleanup:prefCleanup.body,identity:target==='staging'?prepared.receipt.identity:null,sourceNamespaces:{session:session.checkpoint.namespace,fixture:fixture.checkpoint.namespace}});
  const report={status,target,revision,operation,checks:browser?.checks.length??zoom?.checks.length??0,skips:browser?.skips.length??0,zoom:zoom?.status,dataCleanup:dataCleanup.body.status,prefCleanup:prefCleanup.body.status,outputDir};console.log(JSON.stringify(report));return report;
 }catch(error){const code=/^[A-Z0-9_]+$/.test(error?.message??'')?error.message:'DESCRIPTION_QA_STOP_PRESERVE_STATE';await save('stop-receipt.json',{status:'STOP',target,revision,operation,code});console.error(JSON.stringify({status:'STOP',target,revision,operation,code,outputDir}));return{status:'STOP',code,outputDir};}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const[target,revision,operation]=process.argv.slice(2),result=await runProductDescriptionStage({target,revision,operation});if(result.status!=='PASS')process.exitCode=1;}
