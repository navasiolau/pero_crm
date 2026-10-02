// Явная приёмка №17: сначала чистятся точные QA-данные, затем CAS preferences.
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {qaTransport,qaBundle,qaProcess,qaBasicAuth,acceptanceRoot,acceptanceWeb,bundleHash} from './crm-acceptance-transport.mjs';
import {runProductInlineBrowser} from './product-inline-browser.mjs';
import {runCrmBrowserZoom} from './crm-browser-zoom.mjs';
const [target,revision,operation]=process.argv.slice(2);
if(!['native','browser','zoom'].includes(operation))throw new Error('INLINE_QA_OPERATION_REQUIRED');
const outputDir=path.join(acceptanceRoot,'.playwright-mcp','modernization',`${target}-inline-${operation}-${randomUUID()}`);
await mkdir(outputDir,{recursive:true});
const transport=qaTransport({target,revision,outputDir});
const save=(name,value)=>writeFile(path.join(outputDir,name),JSON.stringify(value,null,2),{mode:0o600});
async function main(){
 if(operation==='native'){
  const file=path.join(acceptanceWeb,'test-results/product-inline-native.mjs');
  const built=await qaProcess(process.execPath,[path.join(acceptanceWeb,'tests/product-inline-native-runner.mjs'),file]);
  if(built.code!==0)throw new Error('INLINE_NATIVE_BUILD_FAILED');
  const bytes=await readFile(file),result=await transport.execute(bytes,'native');
  await save('native-receipt.json',{revision,bundleSha256:bundleHash(bytes),...result.receipt});
  console.log(JSON.stringify({status:'PASS',target,revision,operation,checks:result.body.checks.length,rollbackVerified:result.body.rollbackVerified,outputDir}));return;
 }
 const sessionBytes=await qaBundle('crm-modernization-session.mjs'),fixtureBytes=await qaBundle('product-inline-browser-fixtures.mjs');
 // Baseline предшествует созданию fixtures. После их удаления business guard
 // сессий вновь сравнивает полный исходный набор без ослабления защиты.
 const prepared=await transport.execute(sessionBytes,'prepare',{operation:'prepare'}),session=prepared.body;
 await save('session-checkpoint.json',session.checkpoint);
 const owned=await transport.execute(fixtureBytes,'prepare',{operation:'prepare',runId:randomUUID()}),fixture=owned.body;
 await save('fixture-checkpoint.json',fixture.checkpoint);
 const origin=target==='staging'?'https://staging-crm.peromebel.by':'http://127.0.0.1:3017';
 const profiles=Object.fromEntries(Object.entries(session.profiles).map(([key,profile])=>[key,{id:profile.id,roles:profile.roles,
  cookies:profile.cookies.filter(cookie=>origin.startsWith('https:')||!cookie.name.startsWith('__Secure-')).map(cookie=>({...cookie,url:origin,secure:origin.startsWith('https:'),httpOnly:true,sameSite:'Lax'}))}]));
 let browser,zoom,dataCleanup,prefCleanup,journal={ownWrites:[],preferenceOwnWrites:[]};
 try{
  if(operation==='browser')browser=await runProductInlineBrowser({origin,profiles,fixture,outputDir,...(target==='staging'?{basicAuth:await qaBasicAuth()}:{}),onOwnWrites:async value=>{journal=value;await save('owned-write-journal.json',value);}});
  if(operation==='zoom'||browser.status==='PASS')zoom=await runCrmBrowserZoom({origin,profile:profiles.admin,outputDir,...(target==='staging'?{basicAuth:await qaBasicAuth()}:{}),pagePath:fixture.paths.productB,ownedProductPaths:[fixture.paths.productA,fixture.paths.productB],readySelector:'#product-inline-title'});
 }finally{
  try{journal=JSON.parse(await readFile(path.join(outputDir,'product-inline-owned-writes.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const ids=[...new Set(journal.ownWrites.filter(row=>!row.noOp&&typeof row.clientMutationId==='string').map(row=>row.clientMutationId))];
  const inspected=await transport.execute(fixtureBytes,'inspect',{operation:'inspect',checkpoint:fixture.checkpoint,mutationIds:ids});
  await save('fixture-observation.json',inspected.body.observation);
  dataCleanup=await transport.execute(fixtureBytes,'restore',{operation:'restore',checkpoint:fixture.checkpoint,observation:inspected.body.observation});
  await save('fixture-cleanup.json',dataCleanup.receipt);
  prefCleanup=await transport.execute(sessionBytes,'restore',{operation:'restore',checkpoint:session.checkpoint,ownWrites:journal.preferenceOwnWrites});
  await save('preference-cleanup.json',prefCleanup.receipt);
 }
 const status=(operation==='zoom'||browser?.status==='PASS')&&zoom?.status==='PASS'?'PASS':'FAIL';
 await save('browser-receipt.json',{status,target,revision,browser,zoom,dataCleanup:dataCleanup.body,prefCleanup:prefCleanup.body,identity:target==='staging'?prepared.receipt.identity:null});
 console.log(JSON.stringify({status,target,revision,operation,checks:browser?.checks.length??zoom?.checks.length??0,failures:browser?.failures??[],zoom:zoom?.status,dataCleanup:dataCleanup.body.status,prefCleanup:prefCleanup.body.status,outputDir}));
 if(status!=='PASS')process.exitCode=1;
}
main().catch(error=>{const code=typeof error?.message==='string'&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'INLINE_QA_STOP_PRESERVE_STATE';console.error(JSON.stringify({status:'STOP',code,target,operation,outputDir}));process.exitCode=1;});
