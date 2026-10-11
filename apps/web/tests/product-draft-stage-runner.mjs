// Root-only fresh task111 functional QA; no runtime/auth/DB/network action on import.
// SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP on guard mismatch.
import {sha,checkAncestors,durableWrite} from './helpers/qa-private-primitives.mjs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {existsSync,lstatSync,mkdirSync,readFileSync,realpathSync} from 'node:fs';
import {qaTransport,bundleHash,acceptanceWeb,qaBasicAuth} from './crm-acceptance-transport.mjs';
import {runProductDraftStageBrowser} from './product-draft-stage-browser.mjs';
import {technicalCanonical,assertTechnicalPersistence,packFunctionalInput,decodeFunctionalWire,OUTPUT_WIRE_LIMIT} from './product-draft-stage-wire.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),results=path.join(acceptanceWeb,'test-results'),root=path.resolve(acceptanceWeb,'../..');
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve('tsx/package.json'))('esbuild');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,SHA=/^[a-f0-9]{40}$/,HASH=/^[a-f0-9]{64}$/;
const need=(ok,code)=>{if(!ok)throw Error(code);},same=(a,b,code)=>need(technicalCanonical(a)===technicalCanonical(b),code);
const SOURCE_FILES=['helpers/qa-private-primitives.mjs','product-draft-stage-runner.mjs','product-draft-stage-browser.mjs','product-draft-stage-fixtures.mjs','product-draft-stage-wire.mjs','crm-acceptance-token-clock.mjs','crm-acceptance-transport.mjs','kanban-cover-staging-browser.mjs'];
export function functionalOptions(options){
 need(options&&Object.keys(options).every(key=>['phase','revision','runId','outputDir','authorized','noHookPolicy'].includes(key)),'DRAFT111_OPTIONS_FIELDS');
 need(options.authorized===true&&['plan','prepare','browser','capture','cleanup'].includes(options.phase)&&SHA.test(options.revision??'')&&UUID.test(options.runId??''),'DRAFT111_AUTHORIZED_OPTIONS');
 need(path.isAbsolute(options.outputDir??'')&&path.basename(options.outputDir)==='draft111-functional-'+options.runId,'DRAFT111_EXACT_PRIVATE_RUN_DIRECTORY');return options;
}
function privatePath(file){
 const absolute=path.resolve(file),relative=path.relative(results,absolute);need(relative.length>0&&!relative.startsWith('..')&&!path.isAbsolute(relative),'DRAFT111_PRIVATE_RESULTS_PATH');
 need(existsSync(results)&&realpathSync(results).toLowerCase()===results.toLowerCase(),'DRAFT111_PRIVATE_ROOT_IDENTITY');
 checkAncestors(absolute,results,false,'DRAFT111_PRIVATE_REPARSE_POINT','DRAFT111_PRIVATE_ANCESTOR',value=>value.toLowerCase());return absolute;
}
function sources(){return {...Object.fromEntries(SOURCE_FILES.map(name=>[name,sha(readFileSync(path.join(here,name)))])),outerWrapper:sha(readFileSync(path.join(root,'deploy/acceptance/crm-modernization-staging.py'))),fileStages:sha(readFileSync(path.join(root,'packages/plugins/file-stages/src/plugin.ts')))};}
function syncWrite(file,value){
 assertTechnicalPersistence(value);const bytes=Buffer.from(technicalCanonical(value)+'\n'),absolute=privatePath(file);
 durableWrite(absolute,bytes);
 need(sha(readFileSync(absolute))===sha(bytes),'DRAFT111_DURABLE_READBACK');return {file:absolute,sha256:sha(bytes)};
}
export function makeTechnicalStore(directory){
 privatePath(directory);mkdirSync(directory,{recursive:true});const ledger=privatePath(path.join(directory,'ledger.jsonl'));
 let records=[];
 if(existsSync(ledger)){
  need(!lstatSync(ledger).isSymbolicLink()&&lstatSync(ledger).size<=2*1024*1024,'DRAFT111_LEDGER_BOUNDED');const bytes=readFileSync(ledger),lines=bytes.toString('utf8').split('\n');need(lines.pop()==='','DRAFT111_LEDGER_COMPLETE');
  records=lines.map((line,index)=>{let record;try{record=JSON.parse(line);}catch{throw Error('DRAFT111_LEDGER_JSON');}const{hash,...body}=record;need(body.index===index,'DRAFT111_LEDGER_CHAIN');need(HASH.test(hash??'')&&sha(technicalCanonical(body))===hash,'DRAFT111_LEDGER_HASH');return record;});
  // map cannot read the in-progress target; validate predecessor after construction.
  for(let index=0;index<records.length;index++){need(records[index].previous===(index?records[index-1].hash:null),'DRAFT111_LEDGER_CHAIN');}
 }
 function put(kind,value){
  need(/^[a-z][a-z0-9-]{1,40}$/.test(kind),'DRAFT111_ARTIFACT_KIND');const filename=String(records.length).padStart(4,'0')+'-'+kind+'.json',saved=syncWrite(path.join(directory,filename),value),body={index:records.length,previous:records.at(-1)?.hash??null,kind,filename,sha256:saved.sha256},record={...body,hash:sha(technicalCanonical(body))};
  const old=existsSync(ledger)?readFileSync(ledger):Buffer.alloc(0);same(old.toString('utf8'),records.map(item=>technicalCanonical(item)+'\n').join(''),'DRAFT111_LEDGER_CURRENT_CAS');
  durableWrite(ledger,technicalCanonical(record)+'\n',existsSync(ledger)?'a':'wx');
  records.push(record);need(readFileSync(ledger).toString('utf8')===records.map(item=>technicalCanonical(item)+'\n').join(''),'DRAFT111_LEDGER_DURABLE_READBACK');return {...saved,kind,index:body.index};
 }
 function get(kind,{optional=false}={}){
  const record=records.findLast(item=>item.kind===kind);if(!record){need(optional,'DRAFT111_REQUIRED_ARTIFACT_MISSING');return null;}
  need(/^\d{4}-[a-z][a-z0-9-]{1,40}\.json$/.test(record.filename),'DRAFT111_ARTIFACT_FILENAME');const bytes=readFileSync(privatePath(path.join(directory,record.filename)));need(sha(bytes)===record.sha256,'DRAFT111_ARTIFACT_CHANGED');
  const value=JSON.parse(bytes.toString('utf8'));assertTechnicalPersistence(value);return value;
 }
 return {put,get,has:kind=>records.some(item=>item.kind===kind)};
}
export async function functionalBundle({privateHandoff=false}={}){
 const mainCode=privateHandoff?String.raw`import {PrismaClient} from '@prisma/client';import {handoff,stageGuard} from './product-draft-stage-fixtures.mjs';import {unpackFunctionalInput} from './product-draft-stage-wire.mjs';
let db;try{const input=unpackFunctionalInput(JSON.parse(Buffer.from(process.env.CRM_STAGING_BROWSER_INPUT??'','base64').toString('utf8')));if(input.phase!=='handoff'||input.operation!=='inspect')throw Error('DRAFT111_PRIVATE_HANDOFF_PHASE');const{secret}=stageGuard(input);db=new PrismaClient({log:[],errorFormat:'minimal'});const result=await handoff(db,input,input.checkpoint,secret);console.log(JSON.stringify({status:'PRIVATE_BROWSER_HANDOFF',...result}));}catch{process.exitCode=1;console.log(JSON.stringify({status:'STOP',code:'DRAFT111_PRIVATE_HANDOFF_STOP'}));}finally{if(db)await db.$disconnect();}`:"import {main} from './product-draft-stage-fixtures.mjs'; console.log(JSON.stringify(await main()));";
 const result=await build({stdin:{contents:mainCode,resolveDir:here,sourcefile:privateHandoff?'draft111-private-handoff.mjs':'draft111-functional-entry.mjs'},bundle:true,write:false,platform:'node',format:'esm',target:'node22',external:['@prisma/client'],banner:{js:'import {createRequire as draft111Require} from "node:module"; const require=draft111Require(import.meta.url);'},minify:true,logLevel:'silent'}),bytes=Buffer.from(result.outputFiles[0].contents);
 need(bytes.length>0&&bytes.length<=256*1024,'DRAFT111_REVIEWED_BUNDLE_LIMIT');return bytes;
}
function responseBinding(result,input,bytes,identity){
 need(result.receipt?.operation===input.operation&&result.receipt.bundleSha256===bundleHash(bytes)&&result.receipt.identity?.hostname==='crm-staging'&&result.receipt.identity.revision===input.revision&&HASH.test(result.receipt.identity.database??'')&&result.receipt.identity.databaseVolume==='crm-staging_pgdata'&&HASH.test(result.receipt.identity.outerW07Sha256??''),'DRAFT111_PHYSICAL_RECEIPT_BINDING');
 if(identity)same(result.receipt.identity,identity,'DRAFT111_PHYSICAL_LIFECYCLE_CHANGED');
}
function technicalReceipt(result){return {identity:result.receipt.identity,bundleSha256:result.receipt.bundleSha256,operation:result.receipt.operation,exitCode:result.receipt.exitCode};}
export async function runDraftFunctionalQa(options){
 functionalOptions(options);const store=makeTechnicalStore(options.outputDir),source=sources(),transport=qaTransport({target:'staging',revision:options.revision,outputDir:options.outputDir}),bytes=await functionalBundle();
 let metadata=store.get('metadata',{optional:true});
 if(options.phase==='plan'){need(!metadata&&!store.has('plan-intent'),'DRAFT111_FRESH_PLAN_NO_RETRY');}
 else{need(metadata&&metadata.runId===options.runId&&metadata.revision===options.revision,'DRAFT111_EXISTING_RUN_BINDING');same(metadata.sources,source,'DRAFT111_REVIEWED_SOURCES_CHANGED');}
 const common={revision:options.revision,runId:options.runId,authorized:true};
 async function invoke(phase,payload={}){
  const operation=phase==='prepare'?'prepare':phase==='cleanup'?'restore':'inspect',input=packFunctionalInput({operation,phase,...common},payload);
  need(Buffer.byteLength(Buffer.from(JSON.stringify(input)).toString('base64'))<=96*1024,'DRAFT111_OUTER_INPUT_LIMIT');
  const result=await transport.execute(bytes,operation,input);responseBinding(result,input,bytes,metadata?.identity);
  need(result.body?.status==='TECHNICAL_RESULT'&&result.body.phase===phase,'DRAFT111_TECHNICAL_RESULT_BINDING');
  const body=decodeFunctionalWire(result.body.wire,{maxWireBytes:OUTPUT_WIRE_LIMIT});same(sources(),source,'DRAFT111_SOURCE_CHANGED_DURING_PHASE');
  store.put('receipt-'+phase,technicalReceipt(result));return body;
 }
 function pre(){return store.get('pre');}
 function base(){return store.get('checkpoint',{optional:true})??pre();}
 function journal(){return store.get('journal',{optional:true})??{runId:options.runId,revision:options.revision,actions:[],preferences:{'projects.list':null,'products.list':null}};}
 if(options.phase==='plan'){
  store.put('plan-intent',{kind:'plan-intent',...common,sources:source});
  const result=await invoke('plan',{noHookPolicy:options.noHookPolicy??null});need(result.status==='PLANNED'&&result.pre?.runId===options.runId&&result.pre.revision===options.revision,'DRAFT111_SIGNED_PRE_REQUIRED');store.put('pre',result.pre);
  const planReceipt=store.get('receipt-plan');metadata={kind:'fresh-functional-scope',...common,sources:source,identity:planReceipt.identity};store.put('metadata',metadata);
  return {status:'PRE_DURABLE',revision:options.revision,runId:options.runId,stageMutationExecuted:false,outputDir:options.outputDir};
 }
 if(options.phase==='prepare'){
  need(!store.has('prepare-intent'),'DRAFT111_PREPARE_NO_RESPONSE_RETRY');const original=pre();store.put('prepare-intent',{kind:'prepare-intent',...common,preDigest:sha(technicalCanonical(original))});
  const result=await invoke('prepare',{pre:original,durablePre:{hash:sha(technicalCanonical(original)),fsynced:true},noHookPolicy:original.noHookPolicy});need(result.status==='PREPARED'&&result.checkpoint?.runId===options.runId,'DRAFT111_PREPARED_SCOPE_REQUIRED');store.put('checkpoint',result.checkpoint);
  return {status:'PREPARED',revision:options.revision,runId:options.runId,cleanupPending:true,outputDir:options.outputDir};
 }
 async function capture(currentJournal){
  const result=await invoke('capture',{...(store.has('checkpoint')?{checkpoint:store.get('checkpoint')}:{pre:pre()}),journal:currentJournal,noHookPolicy:pre().noHookPolicy});
  need(result.status==='CAPTURED'&&result.observation?.runId===options.runId&&result.observation.revision===options.revision,'DRAFT111_SIGNED_OBSERVATION_REQUIRED');store.put('observation',result.observation);return result.observation;
 }
 if(options.phase==='capture'){const observation=await capture(journal());return {status:'CAPTURED',revision:options.revision,runId:options.runId,originalsPreserved:observation.originalMatch?.originalsPreserved,cleanupPending:true,outputDir:options.outputDir};}
 if(options.phase==='browser'){
  need(store.has('checkpoint')&&!store.has('browser-intent'),'DRAFT111_BROWSER_NO_RESPONSE_RETRY');store.put('browser-intent',{kind:'browser-intent',...common,checkpointDigest:sha(technicalCanonical(base()))});
  const handoffBytes=await functionalBundle({privateHandoff:true}),input=packFunctionalInput({operation:'inspect',phase:'handoff',...common},{checkpoint:base(),noHookPolicy:pre().noHookPolicy}),handoff=await transport.execute(handoffBytes,'inspect',input);
  responseBinding(handoff,input,handoffBytes,metadata.identity);need(handoff.body?.status==='PRIVATE_BROWSER_HANDOFF'&&handoff.body.origin==='https://staging-crm.peromebel.by'&&handoff.body.runId===options.runId&&handoff.body.revision===options.revision&&handoff.body.profile?.id===pre().ids.actor,'DRAFT111_PRIVATE_HANDOFF_BINDING');
  // Deliberately never put handoff.body / full handoff.receipt into wire/files/stdout.
  store.put('handoff-metadata',technicalReceipt(handoff));
  const result=await runProductDraftStageBrowser({authorized:true,origin:handoff.body.origin,revision:options.revision,profile:handoff.body.profile,checkpoint:base(),outputDir:options.outputDir,basicAuth:await qaBasicAuth(),onJournal:async value=>{store.put('journal',value);},observe:capture});
  store.put('browser-result',result);return {status:result.receipt.status,revision:options.revision,runId:options.runId,checks:result.receipt.checks.length,pageErrors:result.receipt.pageErrors,code:result.receipt.code??null,cleanupPending:true,outputDir:options.outputDir};
 }
 need(!store.has('cleanup-intent'),'DRAFT111_CLEANUP_NO_RESPONSE_RETRY');const observation=store.get('observation'),lastJournal=journal();store.put('cleanup-intent',{kind:'cleanup-intent',...common,observationDigest:sha(technicalCanonical(observation)),journalDigest:sha(technicalCanonical(lastJournal))});
 const result=await invoke('cleanup',{...(!store.has('checkpoint')?{pre:pre()}:{checkpoint:base()}),observation,journal:lastJournal,noHookPolicy:pre().noHookPolicy});need(result.status==='CLEANED'&&result.cleanupCommitted===true,'DRAFT111_EXACT_CLEANUP_REQUIRED');store.put('cleanup-result',result);
 return {...result,functionalAcceptance:store.get('browser-result',{optional:true})?.receipt?.status==='PASS',outputDir:options.outputDir};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const[phase,revision,runId,outputDir,authorization]=process.argv.slice(2);
 try{need(authorization==='--authorized','DRAFT111_EXPLICIT_ROOT_REVIEW_REQUIRED');console.log(JSON.stringify(await runDraftFunctionalQa({phase,revision,runId,outputDir,authorized:true,noHookPolicy:{revision,plugins:[{id:'file-stages',version:'0.1.0',apiVersion:1,sourceHash:'d01325f64ecd7a2cb1cbcefcd7193d4a1c27f280470239f26a74ad95cb253544'}]}})));}
 catch(error){console.log(JSON.stringify({status:'STOP',phase,code:/^[A-Z0-9_]{1,110}$/.test(error?.message??'')?error.message:'DRAFT111_FUNCTIONAL_STOP_PRESERVE_STATE',outputDir,cleanupMayBeRequired:true}));process.exitCode=1;}
}
