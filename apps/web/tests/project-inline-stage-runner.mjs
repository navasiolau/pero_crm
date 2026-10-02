// Координатор №18. Запуск только root; этот файл не импортирует Prisma и не удаляет storage.
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium,expect} from '@playwright/test';
import {qaTransport,qaProcess,qaBasicAuth,acceptanceRoot,acceptanceWeb,bundleHash} from './crm-acceptance-transport.mjs';
import {bundleProjectQa as bundleProjectQa18} from './project-inline-qa-bundle.mjs';
import {runProjectInlineBrowser} from './project-inline-browser.mjs';
import {runCrmBrowserZoom} from './crm-browser-zoom.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const FIELDS=new Set(['title','clientId','managerId','address','client.phone','delivery','unloading','installation']);
const STAGES=new Set(['LEAD','REFUSED','RECLAMATION']);
const requireThat=(ok,code)=>{if(!ok)throw Error(code)};
const ownPath=id=>`/projects/${encodeURIComponent(id)}`;
const outcomes=body=>body.toString('utf8').split('\n').flatMap(line=>{try{return[JSON.parse(line.slice(line.indexOf(':')+1))]}catch{return[]}});
const emptyJournal=()=>({ownWrites:[],preferenceOwnWrites:[]});

/** Только подтверждённые IDs. requested/lost без captured result не становятся receipts. */
export function projectJournalScope(fixture,journal){
 const actors=new Set(Object.values(fixture.actors).map(row=>row.id)),fields=new Set(),stages=new Set();
 requireThat(Array.isArray(journal.ownWrites)&&journal.ownWrites.length<=150,'OWNED_WRITE_JOURNAL_INVALID');
 for(const row of journal.ownWrites){
  requireThat(actors.has(row.actorId),'UNRECOGNIZED_OWNED_ACTOR_STOP');
  if(row.type==='file-delete'){requireThat(row.saved===true&&typeof row.fileId==='string','UNCONFIRMED_FILE_DELETE_STOP');continue;}
  requireThat(row.projectId===fixture.ids.project&&UUID.test(row.clientMutationId??''),'OWNED_MUTATION_SCOPE_STOP');
  if(row.type==='status'){requireThat(row.saved===true&&STAGES.has(row.toStage),'UNCONFIRMED_STAGE_WRITE_STOP');if(!row.noOp)stages.add(row.clientMutationId);}
  else {requireThat(FIELDS.has(row.field),'UNRECOGNIZED_FIELD_WRITE_STOP');if(!row.noOp)fields.add(row.clientMutationId);}
 }
 return{mutationIds:[...fields].sort(),stageMutationIds:[...stages].sort(),legacyApiWrites:[]};
}
export function closedProjectApiProbe(input,fixture){
 requireThat(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).sort().join('|')==='clientMutationId|expectedValue|field|projectId|value','API_CLOSED_INPUT_REQUIRED');
 requireThat(input.projectId===fixture.ids.project&&input.field==='title'&&UUID.test(input.clientMutationId??'')&&typeof input.value==='string'&&input.value.startsWith('QA18 ')&&input.value.length<=300&&typeof input.expectedValue==='string'&&input.expectedValue.length<=300,'API_OWNED_TITLE_INPUT_REQUIRED');
 return{projectId:input.projectId,field:'title',value:input.value,expectedValue:input.expectedValue,clientMutationId:input.clientMutationId};
}
function joinJournals(...journals){
 const own=new Map(),prefs=new Map();
 for(const journal of journals){for(const row of journal.ownWrites??[]){const key=row.type==='file-delete'?`file:${row.fileId}`:row.type==='status'?`stage:${row.clientMutationId}`:row.clientMutationId;own.set(key,row)}for(const row of journal.preferenceOwnWrites??[])prefs.set(`${row.userId}/${row.key}`,row)}
 return{ownWrites:[...own.values()],preferenceOwnWrites:[...prefs.values()]};
}
function profilesForOrigin(profiles,origin){return Object.fromEntries(Object.entries(profiles).map(([key,profile])=>[key,{id:profile.id,roles:profile.roles,cookies:profile.cookies.filter(cookie=>origin.startsWith('https:')||!cookie.name.startsWith('__Secure-')).map(cookie=>({...cookie,url:origin,secure:origin.startsWith('https:'),httpOnly:true,sameSite:'Lax'}))}]))}
function safeApiResult(raw,token){
 requireThat(raw&&typeof raw==='object'&&!Array.isArray(raw),'API_RESULT_OBJECT_REQUIRED');
 const allowed=['ok','kind','field','clientMutationId','value','currentValue','error','noOp','repeated','replayed'];const out={};
 for(const key of allowed)if(Object.hasOwn(raw,key)){const value=raw[key];requireThat(value===null||['string','boolean'].includes(typeof value),'API_RESULT_SCALAR_REQUIRED');out[key]=typeof value==='string'?value.replaceAll(token,'[REDACTED_SECRET]').replace(/Bearer\s+[^\s]+/gi,'Bearer [REDACTED_SECRET]'):value;}
 requireThat(['saved','validation','conflict','forbidden','not-found','failure'].includes(out.kind),'API_RESULT_KIND_REQUIRED');return out;
}
async function optionalJson(file,fallback){try{return JSON.parse(await readFile(file,'utf8'))}catch(error){if(error.code==='ENOENT')return fallback;throw Error('PRIVATE_JOURNAL_INVALID_STOP')}}
function uploadedFromRequests(requests,fixture){
 const ids=new Map();
 for(const row of requests.filter(row=>row.type==='file-upload')){
  requireThat(row.phase==='response-captured'&&row.httpStatus===200&&row.result?.ok===true&&typeof row.result.id==='string'&&row.fileName?.startsWith(`qa18-${fixture.ids.project}-`),'UNCONFIRMED_UPLOAD_STOP');
  requireThat(!ids.has(row.result.id)||ids.get(row.result.id)===row.fileName,'UPLOAD_ID_NAME_CONFLICT_STOP');ids.set(row.result.id,row.fileName);
 }
 requireThat(ids.size<=5,'UPLOAD_COUNT_SCOPE_STOP');return ids;
}

/** Удаление остаётся реальным compiled Server Action с точным UI подтверждением. */
async function deleteRemainingFiles({origin,profile,basicAuth,fixture,files,onJournal}){
 if(!files.length)return;
 const browser=await chromium.launch({headless:true});let context;let pending=new Set();let closing=false;let permit=null;let bellId;let stopped=false;
 const requests=[],journal=emptyJournal();const pagePath=ownPath(fixture.ids.project),known=new Set(files.map(file=>file.id));
 async function persist(){await onJournal(journal,requests)}
 try{
  context=await browser.newContext({viewport:{width:1440,height:900},httpCredentials:basicAuth,serviceWorkers:'allow'});await context.addCookies(profile.cookies);
  const session=await context.request.get(`${origin}/api/auth/session`);requireThat(session.status()===200,'CLEANUP_SESSION_HTTP_STOP');const auth=await session.json();requireThat(auth.user?.id===profile.id&&auth.user.roles?.includes('ADMIN'),'CLEANUP_ADMIN_ACTOR_STOP');
  await context.route('**/*',async route=>{
   const request=route.request();if(['GET','HEAD','OPTIONS'].includes(request.method())){await route.continue();return;}
   const url=new URL(request.url());let args;try{args=JSON.parse(request.postData()??'')}catch{}
   const action=request.headers()['next-action'];const owned=request.method()==='POST'&&url.origin===origin&&url.pathname===pagePath&&action;
   const empty=Array.isArray(args)&&args.length===0;
   // Source-verified mount/poll NotificationsBell; никакие markRead здесь не разрешены.
   if(owned&&empty)bellId??=action;
   if(owned&&empty&&action===bellId){await route.continue();return;}
   const deletion=owned&&Array.isArray(args)&&args.length===1&&args[0]===permit&&known.has(args[0]);
   const preference=owned&&Array.isArray(args)&&args.length===2&&args[0]==='project.tab'&&['overview','files'].includes(args[1]);
   if(closing||(!deletion&&!preference)){stopped=true;await route.abort('blockedbyclient');return;}
   const record={type:deletion?'file-delete':'preference',actorId:profile.id,path:pagePath,request:deletion?{fileId:args[0]}:{args},phase:'requested'};requests.push(record);await persist();
   const task=(async()=>{
    const response=await route.fetch({maxRetries:0,maxRedirects:0,timeout:30000}),body=await response.body();const matches=outcomes(body).filter(row=>typeof row?.ok==='boolean');
    requireThat(response.status()===200&&matches.length===1,'CLEANUP_ACTION_RESULT_NOT_CAPTURED_STOP');record.httpStatus=response.status();record.result={ok:matches[0].ok};record.phase='response-captured';
    requireThat(matches[0].ok===true,'CLEANUP_APP_ACTION_FAILED_STOP');
    if(deletion)journal.ownWrites.push({actorId:profile.id,type:'file-delete',fileId:args[0],saved:true});
    else{const value=args[1];journal.preferenceOwnWrites=journal.preferenceOwnWrites.filter(row=>row.key!=='project.tab');journal.preferenceOwnWrites.push({userId:profile.id,key:'project.tab',value});}
    await persist();await route.fulfill({response,body});
   })();pending.add(task);try{await task}catch{stopped=true;await route.abort('blockedbyclient').catch(()=>{})}finally{pending.delete(task)}
  });
  const page=await context.newPage();const response=await page.goto(`${origin}${pagePath}`,{waitUntil:'networkidle'});requireThat(response?.status()===200&&new URL(page.url()).pathname===pagePath,'CLEANUP_OWNED_PROJECT_HTTP_STOP');await page.getByRole('tab',{name:/^Файлы/}).waitFor();
  requireThat(!stopped,'CLEANUP_UNKNOWN_MUTATION_STOP');await page.getByRole('tab',{name:/^Файлы/}).click();await page.locator('[data-project-files="flat"]').waitFor();
  for(const file of files){
   requireThat(file.projectId===fixture.ids.project&&file.fileName.startsWith(`qa18-${fixture.ids.project}-`)&&known.has(file.id),'CLEANUP_SIGNED_FILE_SCOPE_STOP');
   permit=file.id;const row=page.locator('[data-project-files="flat"] [data-slot="card"]').filter({has:page.getByText(file.fileName,{exact:true})});await expect(row).toHaveCount(1);await row.getByRole('button',{name:'Удалить',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Удалить',exact:true}).click();await expect(page.getByText(file.fileName,{exact:true})).toHaveCount(0);await Promise.all([...pending]);requireThat(!stopped&&journal.ownWrites.some(row=>row.fileId===file.id&&row.saved),'CLEANUP_DELETE_UNCONFIRMED_STOP');permit=null;
  }
 }finally{closing=true;await Promise.allSettled([...pending]);if(context)await context.close();await browser.close();await persist();}
 requireThat(!stopped,'CLEANUP_UNRECOGNIZED_MUTATION_STOP');
}

export async function runProjectInlineStage({target,revision,operation}){
 requireThat(['local','staging'].includes(target)&&/^[a-f0-9]{40}$/.test(revision??''),'PROJECT_QA_TARGET_REVISION_REQUIRED');
 requireThat(['native','browser','zoom'].includes(operation),'PROJECT_QA_OPERATION_REQUIRED');
 const outputDir=path.join(acceptanceRoot,'.playwright-mcp','modernization',`${target}-project-inline-${operation}-${randomUUID()}`);await mkdir(outputDir,{recursive:true});
 const transport=qaTransport({target,revision,outputDir});
 async function save(name,value){const file=path.join(outputDir,name);await writeFile(`${file}.tmp`,JSON.stringify(value,null,2),{mode:0o600});await rename(`${file}.tmp`,file)}
 try{
  if(operation==='native'){
   const file=path.join(acceptanceWeb,'test-results/project-inline-native.mjs');const built=await qaProcess(process.execPath,[path.join(acceptanceWeb,'tests/project-inline-native-runner.mjs'),file]);requireThat(built.code===0,'PROJECT_NATIVE_BUILD_FAILED');
   const bytes=await readFile(file),result=await transport.execute(bytes,'native');requireThat(result.body.kind==='project-inline-native-acceptance'&&result.body.rollbackVerified===true&&Array.isArray(result.body.checks)&&result.body.checks.length>0,'PROJECT_NATIVE_RECEIPT_REQUIRED');await save('native-receipt.json',{revision,bundleSha256:bundleHash(bytes),...result.receipt});
   const report={status:'PASS',target,revision,operation,checks:result.body.checks.length,rollbackVerified:result.body.rollbackVerified,outputDir};console.log(JSON.stringify(report));return report;
  }
  if(target==='local')requireThat(typeof process.env.CRM_PROJECT_QA_LOCAL_UPLOADS_ROOT==='string'&&path.isAbsolute(process.env.CRM_PROJECT_QA_LOCAL_UPLOADS_ROOT)&&path.resolve(process.env.CRM_PROJECT_QA_LOCAL_UPLOADS_ROOT).toLowerCase()===path.join(acceptanceWeb,'uploads').toLowerCase(),'EXPLICIT_LOCAL_UPLOADS_ROOT_REQUIRED');
  const sessionBytes=await bundleProjectQa18('project-inline-session.mjs'),fixtureBytes=await bundleProjectQa18('project-inline-browser-fixtures.mjs');
  const prepared=await transport.execute(sessionBytes,'prepare',{operation:'prepare'}),session=prepared.body;await save('session-checkpoint.json',session.checkpoint);
  // Полный baseline preferences ДО fixtures, а не после разрешённых собственных writes.
  const owned=await transport.execute(fixtureBytes,'prepare',{operation:'prepare',runId:randomUUID(),sessionCheckpoint:session.checkpoint}),fixture=owned.body;await save('fixture-checkpoint.json',fixture.checkpoint);
  requireThat(fixture.privateApiToken?.token&&fixture.actors.manager?.id&&fixture.privateApiToken.allowedActorIds.includes(fixture.actors.manager.id),'PRIVATE_API_SCOPE_REQUIRED');
  const origin=target==='staging'?'https://staging-crm.peromebel.by':'http://127.0.0.1:3018',profiles=profilesForOrigin(session.profiles,origin),basicAuth=target==='staging'?await qaBasicAuth():undefined;
  let browser,zoom,dataCleanup,prefCleanup,fileObservation=null;let uiJournal=emptyJournal(),apiJournal=emptyJournal(),cleanupJournal=emptyJournal();const apiRequests=[];
  const journal=()=>joinJournals(uiJournal,apiJournal,cleanupJournal);
  async function persistCoordinator(){await save('owned-write-journal.json',journal());await save('api-request-journal.json',apiRequests)}
  async function scope(){return projectJournalScope(fixture,journal())}
  async function inspectFiles(ids,name){const result=await transport.execute(fixtureBytes,'inspect',{operation:'inspect',mode:'files',checkpoint:fixture.checkpoint,uploadedFileIds:ids,...await scope(),...(fileObservation?{fileObservation}:{})});requireThat(result.body.status==='FILES_CAPTURED'&&result.body.fileObservation?.signature,'SIGNED_FILE_OBSERVATION_REQUIRED');await save(name,result.body.fileObservation);return result.body.fileObservation}
  async function apiProbe(input){
   const patch=closedProjectApiProbe(input,fixture),actorId=fixture.actors.manager.id,apiPath=`/api/v1/bot/projects/${fixture.ids.project}`;
   requireThat(fixture.privateApiToken.allowedPaths.includes(apiPath),'API_PATH_NOT_OWNED_STOP');
   if(target==='staging'){
    const checked=await transport.execute(Buffer.from('console.log(JSON.stringify({status:"READONLY_API_BINDING_CHECK"}));'),'readonly');
    requireThat(checked.body.status==='READONLY_API_BINDING_CHECK'&&checked.receipt.identity?.hostname==='crm-staging'&&checked.receipt.identity.revision===revision&&checked.receipt.identity.outerW07Sha256===prepared.receipt.identity.outerW07Sha256&&checked.receipt.identity.web===prepared.receipt.identity.web,'API_STAGE_DEPLOYMENT_GUARD_STOP');await save('api-staging-identity.json',checked.receipt.identity);
   }
   const record={type:'api-patch',actorId,path:apiPath,request:patch,phase:'requested'};apiRequests.push(record);await persistCoordinator();
   let response,raw;try{
    const base=target==='staging'?'http://192.168.0.30':'http://127.0.0.1:3018';
    response=await fetch(`${base}${apiPath}`,{method:'PATCH',redirect:'error',headers:{'content-type':'application/json',authorization:`Bearer ${fixture.privateApiToken.token}`,'x-acting-user':actorId},body:JSON.stringify(patch),signal:AbortSignal.timeout(30000)});
    const text=await response.text();requireThat(Buffer.byteLength(text)<64000,'API_RESPONSE_TOO_LARGE_STOP');raw=JSON.parse(text);
   }catch{record.phase='unconfirmed-upstream-result';await persistCoordinator();throw Error('API_RESULT_UNKNOWN_STOP_PRESERVE_STATE');}
   const result=safeApiResult(raw,fixture.privateApiToken.token);record.status=response.status;record.result=result;record.phase='response-captured';
   if(result.kind==='saved'){requireThat(result.clientMutationId===patch.clientMutationId&&result.field===patch.field,'API_SAVED_RECEIPT_MISMATCH_STOP');apiJournal.ownWrites.push({actorId,projectId:fixture.ids.project,field:patch.field,value:result.value,clientMutationId:patch.clientMutationId,noOp:Boolean(result.noOp),source:'telegram'});}
   await persistCoordinator();return{status:response.status,result,actorId};
  }
  if(operation==='browser')browser=await runProjectInlineBrowser({origin,profiles,fixture,outputDir,basicAuth,onOwnWrites:async value=>{uiJournal=value;await persistCoordinator()},onOwnFiles:async({uploadedFileIds})=>{fileObservation=await inspectFiles(uploadedFileIds,'file-observation-before-first-delete.json')},apiProbe});
  if(operation==='zoom'||browser?.status==='PASS')zoom=await runCrmBrowserZoom({origin,profile:profiles.admin,outputDir,basicAuth,pagePath:fixture.paths.project,ownedProjectPaths:[fixture.paths.project],readySelector:'#project-inline-title'});
  // Helpers close their contexts/holds before returning. Read their durable capture, not guessed DOM state.
  uiJournal=await optionalJson(path.join(outputDir,'project-inline-owned-writes.json'),uiJournal);const requests=await optionalJson(path.join(outputDir,'project-inline-request-journal.json'),[]);await persistCoordinator();
  requireThat(!browser?.failures?.some(row=>typeof row==='string'&&/UNAUTHORIZED_MUTATION|ACTION_CAPTURE_FAILED/.test(row)),'UNRECOGNIZED_BROWSER_MUTATION_STOP_PRESERVE_STATE');
  requireThat(!apiRequests.some(row=>row.phase!=='response-captured'),'API_UNCONFIRMED_WRITE_STOP_PRESERVE_STATE');
  const uploads=uploadedFromRequests(requests,fixture),deleted=new Set(journal().ownWrites.filter(row=>row.type==='file-delete'&&row.saved===true).map(row=>row.fileId));requireThat([...deleted].every(id=>uploads.has(id)),'UNOWNED_FILE_DELETE_JOURNAL_STOP');
  if(uploads.size){
   fileObservation??=await optionalJson(path.join(outputDir,'file-observation-before-first-delete.json'),null);
   const alive=[...uploads.keys()].filter(id=>!deleted.has(id));const beforeCleanup=await inspectFiles(alive,'file-observation-before-cleanup.json');
   if(!fileObservation){requireThat(deleted.size===0,'MISSING_PREDELETE_SIGNED_FILE_OBSERVATION_STOP');fileObservation=beforeCleanup;await save('file-observation-before-first-delete.json',fileObservation)}
   requireThat(fileObservation.files.length===uploads.size&&fileObservation.files.every(file=>uploads.get(file.id)===file.fileName),'SIGNED_ALL_UPLOADS_COVERAGE_REQUIRED');
   await deleteRemainingFiles({origin,profile:profiles.admin,basicAuth,fixture,files:beforeCleanup.files,onJournal:async(value,records)=>{cleanupJournal=value;await save('cleanup-request-journal.json',records);await persistCoordinator()}});
  }
  const inspected=await transport.execute(fixtureBytes,'inspect',{operation:'inspect',checkpoint:fixture.checkpoint,...await scope(),...(fileObservation?{fileObservation}:{})});await save('fixture-observation.json',inspected.body.observation);
  dataCleanup=await transport.execute(fixtureBytes,'restore',{operation:'restore',checkpoint:fixture.checkpoint,observation:inspected.body.observation});await save('fixture-cleanup.json',dataCleanup.receipt);
  prefCleanup=await transport.execute(sessionBytes,'restore',{operation:'restore',checkpoint:session.checkpoint,ownWrites:journal().preferenceOwnWrites});await save('preference-cleanup.json',prefCleanup.receipt);
  const status=(operation==='zoom'||browser?.status==='PASS')&&zoom?.status==='PASS'?'PASS':'FAIL';await save('browser-receipt.json',{status,target,revision,browser,zoom,dataCleanup:dataCleanup.body,prefCleanup:prefCleanup.body,identity:target==='staging'?prepared.receipt.identity:null});
  const report={status,target,revision,operation,checks:browser?.checks.length??zoom?.checks.length??0,zoom:zoom?.status,dataCleanup:dataCleanup.body.status,prefCleanup:prefCleanup.body.status,uploadedFiles:uploads.size,outputDir};console.log(JSON.stringify(report));return report;
 }catch(error){const code=/^[A-Z0-9_]+$/.test(error?.message??'')?error.message:'PROJECT_QA_STOP_PRESERVE_STATE';await save('stop-receipt.json',{status:'STOP',code,target,revision,operation});console.error(JSON.stringify({status:'STOP',code,target,revision,operation,outputDir}));return{status:'STOP',code,outputDir};}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const[target,revision,operation]=process.argv.slice(2);const result=await runProjectInlineStage({target,revision,operation});if(result.status!=='PASS')process.exitCode=1;}
