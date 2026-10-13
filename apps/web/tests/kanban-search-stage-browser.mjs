/** QA117 запускается явно. Импорт не открывает браузер/сеть/БД и не создаёт артефакты. */
// SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; СТОП при несовпадении.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {lstat,mkdir,open,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium,expect} from '@playwright/test';
import {disableKanbanQaServiceWorkerApi} from './kanban-cover-staging-browser.mjs';
import {normalizeListQuery} from '../src/lib/list-state.ts';
import {encodeListFilterValue} from '../src/lib/list-filter-values.ts';
import {SEARCH117_NAMESPACE,COHORT163_NAMESPACE,COHORT163_ACTORS,canonical117,digest117,ownTerm117,assertCurrentCertificate117} from './kanban-search-owned-protocol.mjs';

export const SEARCH_STAGE_ORIGIN='https://staging-crm.peromebel.by';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const require=createRequire(import.meta.url),SHA40=/^[a-f0-9]{40}$/,SHA64=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const plain=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const need=(ok,code)=>{if(!ok)throw Error(code);};
const exact=(value,keys)=>plain(value)&&Object.keys(value).sort().join('|')===[...keys].sort().join('|');
const sha=value=>createHash('sha256').update(value).digest('hex');
const rolesSame=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&[...a].sort().join('|')===[...b].sort().join('|');
const prefKey=section=>`${section}.list`;
const safeCode=error=>/^K117_[A-Z0-9_]+$/.test(error?.message??'')?error.message:'K117_BROWSER_CHECK_FAILED';

/** Root заранее проверяет полный HMAC исходного checkpoint и physical PRE.
 * Браузер проверяет фиксированную цель, собственную живую сессию и каждый action.
 * Допускаются только собственные свежие QA-сессии, без выбора реальных пользователей. */
export function validateKanbanSearchHandoff(input={}){
 const {authorized,origin,expectedRevision,identity,checkpoint,profile,subjects,tokens,action}=input;
 need(authorized===true&&origin===SEARCH_STAGE_ORIGIN,'K117_ROOT_STAGE_AUTH_REQUIRED');
 need(SHA40.test(expectedRevision??'')&&identity?.hostname==='crm-staging'&&identity.revision===expectedRevision&&identity.databaseVolume==='crm-staging_pgdata'&&SHA64.test(identity.outerW07Sha256??''),'K117_PHYSICAL_STAGE_REVISION_MISMATCH');
 need(checkpoint?.scope==='fresh-owned-qa'&&UUID.test(checkpoint.runId??'')&&checkpoint.revision===expectedRevision&&SHA64.test(checkpoint.signature??'')&&SHA64.test(checkpoint.originalPreSha256??''),'K117_OWNED_IMMUTABLE_PRE_REQUIRED');
 for(const key of ['createdActorIds','createdClientIds','createdProjectIds','createdProductIds'])need(Array.isArray(checkpoint[key])&&checkpoint[key].length>0&&checkpoint[key].length<=32&&checkpoint[key].every(id)&&new Set(checkpoint[key]).size===checkpoint[key].length,'K117_CREATED_ID_SET_INVALID');
 need(checkpoint.createdFileIds===undefined||Array.isArray(checkpoint.createdFileIds)&&checkpoint.createdFileIds.length<=64&&checkpoint.createdFileIds.every(id)&&new Set(checkpoint.createdFileIds).size===checkpoint.createdFileIds.length,'K117_CREATED_FILE_SET_INVALID');
 need(id(profile?.id)&&Array.isArray(checkpoint.createdActorIds)&&checkpoint.createdActorIds.includes(profile.id)&&
  (checkpoint.version===2?cohortActor163(checkpoint,profile):rolesSame(profile.roles,['MANAGER'])||rolesSame(profile.roles,['ADMIN']))&&rolesSame(profile.roles,checkpoint.actor?.roles)&&checkpoint.actor.id===profile.id,'K117_FRESH_OWN_ACTOR_REQUIRED');
 need(exact(subjects,['client','project','product'])&&id(subjects.client?.id)&&id(subjects.project?.id)&&id(subjects.product?.id)&&
  checkpoint.createdClientIds?.includes(subjects.client.id)&&checkpoint.createdProjectIds?.includes(subjects.project.id)&&checkpoint.createdProductIds?.includes(subjects.product.id),'K117_OWN_SUBJECTS_REQUIRED');
 const {client,project,product}=subjects;
 need(/^[1-9][0-9]{0,10}$/.test(project.number??'')&&typeof product.number==='string'&&new RegExp(`^${project.number}[.-][1-9][0-9]{0,9}$`).test(product.number)&&project.clientId===client.id&&product.projectId===project.id,'K117_OWN_RELATIONS_NUMBERS_MISMATCH');
 need(exact(tokens,['projectTitle','productTitle','client','technical'])&&Object.values(tokens).every(value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{11,99}$/.test(value))&&new Set(Object.values(tokens)).size===4,'K117_DISTINCT_QA_TOKENS_REQUIRED');
 for(const [field,token] of [[project.title,tokens.projectTitle],[product.title,tokens.productTitle],[client.name,tokens.client],[product.description,tokens.technical]])need(typeof field==='string'&&field.includes(token),'K117_PRE_FIELD_TOKEN_NOT_PRESENT');
 for(const [field,excluded] of [[project.title,[tokens.productTitle,tokens.client,tokens.technical]],[product.title,[tokens.projectTitle,tokens.client,tokens.technical]]])
  need(excluded.every(token=>!field.toLowerCase().includes(token.toLowerCase())),'K117_IDENTITY_TOKEN_COLLISION');
 const originals=checkpoint.originalPreferences;
 need(Array.isArray(originals)&&originals.length===2&&originals.every(row=>exact(row,['userId','key','value'])&&row.userId===profile.id&&['projects.list','products.list'].includes(row.key)&&row.value===null)&&new Set(originals.map(row=>row.key)).size===2,'K117_FRESH_ABSENT_PREFERENCES_REQUIRED');
 need(exact(action,['id','exportedName','filename','revision','manifestSha256'])&&/^[a-f0-9]{42}$/.test(action.id)&&action.exportedName==='saveListPreference'&&typeof action.filename==='string'&&action.filename.replaceAll('\\','/')==='src/server/list-preferences-actions.ts'&&action.revision===expectedRevision&&SHA64.test(action.manifestSha256??''),'K117_COMPILED_PREFERENCE_ACTION_REQUIRED');
 need(Array.isArray(profile.cookies)&&profile.cookies.length>=1&&profile.cookies.length<=2,'K117_PRIVATE_COOKIE_REQUIRED');
 const names=new Set(),cookies=profile.cookies.map(cookie=>{
  need(['authjs.session-token','__Secure-authjs.session-token'].includes(cookie?.name)&&!names.has(cookie.name)&&typeof cookie.value==='string'&&cookie.value.length>0&&cookie.value.length<8192,'K117_SESSION_COOKIE_INVALID');
  need((cookie.url===undefined||cookie.url===origin)&&(cookie.domain===undefined||cookie.domain==='staging-crm.peromebel.by')&&(cookie.path===undefined||cookie.path==='/')&&(cookie.secure===undefined||cookie.secure===true)&&(cookie.httpOnly===undefined||cookie.httpOnly===true),'K117_COOKIE_SCOPE_MISMATCH');names.add(cookie.name);
  return{name:cookie.name,value:cookie.value,url:origin,httpOnly:true,secure:true,sameSite:'Lax'};
 });
 need(!input.basicAuth||(typeof input.basicAuth.username==='string'&&typeof input.basicAuth.password==='string'),'K117_PRIVATE_BASIC_AUTH_INVALID');
 if(checkpoint.version===2)validateCohortHandoff163(checkpoint,identity);
 const terms={projects:[project.number,tokens.projectTitle,tokens.client,tokens.technical,tokens.productTitle],products:[product.number,tokens.productTitle,tokens.client,tokens.technical,tokens.projectTitle]};
 return{origin,revision:expectedRevision,runId:checkpoint.runId,preSha256:checkpoint.originalPreSha256,checkpointSignature:checkpoint.signature,actorId:profile.id,roles:[...profile.roles],cookies,
  actionId:action.id,actionManifestSha256:action.manifestSha256,subjects:structuredClone(subjects),tokens:{...tokens},terms,
  ownPrefix:checkpoint.version===2,readPaths:checkpoint.version===2?[...checkpoint.readPaths]:[],readonlyActions:checkpoint.version===2?checkpoint.actionGrants.filter(g=>g.actor===checkpoint.actors.find(a=>a.id===profile.id).key):[],preferenceAllowed:checkpoint.version!==2||rolesSame(profile.roles,['MANAGER']),
  ownIds:{projects:[...checkpoint.createdProjectIds],products:[...checkpoint.createdProductIds],files:[...(checkpoint.createdFileIds??[])]},originalPreferences:structuredClone(originals)};
}

export function kanbanSearchQuery(section,term,binding){
 need(['projects','products'].includes(section)&&ownTerm117(term,binding.terms[section],binding.ownPrefix===true),'K117_QUERY_TERM_NOT_OWNED');
 const params=new URLSearchParams({view:'kanban'});if(term)params.set('q',term);
 const ownId=section==='projects'?binding.subjects.client.id:binding.subjects.project.id;
 params.set(section==='projects'?'client':'project',encodeListFilterValue([ownId]));params.set('active','0');
 return normalizeListQuery(section,params.toString());
}
function canonicalQuery(section,query,binding){
 let params;try{params=new URLSearchParams(query);}catch{throw Error('K117_QUERY_INVALID');}
 const term=params.get('q')??'';need(query===kanbanSearchQuery(section,term,binding),'K117_QUERY_CANONICAL_SCOPE_REQUIRED');return term;
}
export function kanbanSearchRequest({url,method,headers={},body='',prefetch=false},binding){
 let parsed;try{parsed=new URL(url);}catch{return{kind:'deny',code:'K117_INVALID_REQUEST_URL'};}
 if(parsed.origin!==binding.origin||parsed.username||parsed.password)return{kind:'deny',code:'K117_CROSS_ORIGIN_FORBIDDEN'};
 const board=parsed.pathname==='/projects'||parsed.pathname==='/products',section=parsed.pathname.slice(1);
 if(method==='POST'){
  const grant=binding.readonlyActions?.find(g=>g.id===headers['next-action']&&g.paths.includes(parsed.pathname));
  if(grant){try{need(headers.origin===binding.origin&&/^(?:text\/plain|application\/json)(?:;|$)/i.test(headers['content-type']??'')&&body==='[]','K117_READONLY_ACTION_ARGS_SCOPE');if(board)canonicalQuery(section,parsed.search.slice(1),binding);else need(!parsed.search,'K117_READONLY_DETAIL_QUERY_SCOPE');return{kind:'continue-readonly-action'};}catch(error){return{kind:'deny',code:safeCode(error)};}}
  if(binding.preferenceAllowed===false||!board||headers['next-action']!==binding.actionId)return{kind:'abort-unrelated-action',code:'K117_OTHER_POST_BLOCKED'};
  try{
   canonicalQuery(section,parsed.search.slice(1),binding);
   need(headers.origin===binding.origin&&/^(?:text\/plain|application\/json)(?:;|$)/i.test(headers['content-type']??''),'K117_PREFERENCE_HTTP_BOUNDARY');
   need(typeof body==='string'&&Buffer.byteLength(body)<=4096,'K117_PREFERENCE_BODY_LIMIT');
   const args=JSON.parse(body);need(Array.isArray(args)&&args.length===3&&args[0]===section&&typeof args[1]==='string'&&(args[2]===null||typeof args[2]==='string'&&args[2].length<=2048),'K117_PREFERENCE_ARGS_REQUIRED');
   canonicalQuery(section,args[1],binding);return{kind:'own-preference',section,args};
  }catch(error){return{kind:'deny',code:safeCode(error)};}
 }
 if(!['GET','HEAD'].includes(method))return{kind:'deny',code:'K117_METHOD_FORBIDDEN'};
 if(prefetch)return{kind:'abort-prefetch',code:'K117_PREFETCH_BLOCKED'};
 if(board){
  try{const params=new URLSearchParams(parsed.search);if(params.has('_rsc')){need(params.getAll('_rsc').length===1&&/^[A-Za-z0-9_.-]{1,128}$/.test(params.get('_rsc')),'K117_RSC_QUERY_INVALID');params.delete('_rsc');}canonicalQuery(section,params.toString(),binding);return{kind:'continue-read'};}catch(error){return{kind:'deny',code:safeCode(error)};}
 }
 if(binding.readPaths?.includes(parsed.pathname)){try{const params=new URLSearchParams(parsed.search);if(params.has('_rsc')){need(params.getAll('_rsc').length===1&&/^[A-Za-z0-9_.-]{1,128}$/.test(params.get('_rsc')),'K117_RSC_QUERY_INVALID');params.delete('_rsc');}if(parsed.pathname===binding.readPaths[0]){need(params.size===0||params.size===1&&params.getAll('tab').length===1&&params.get('tab')==='products','K117_UNOWNED_DETAIL_QUERY');}else if(params.size){need(params.size===1&&params.getAll('returnTo').length===1,'K117_UNOWNED_DETAIL_QUERY');const back=params.get('returnTo');if(back!==binding.readPaths[0]+'?tab=products'){need(back.startsWith('/products?'),'K117_UNOWNED_RETURN_PATH');canonicalQuery('products',back.slice('/products?'.length),binding);}}return{kind:'continue-read'};}catch(error){return{kind:'deny',code:safeCode(error)};}}
 const staticPath=new Set(['/favicon.ico','/icon.svg','/apple-icon.png','/manifest.webmanifest','/sw.js']);
 if((staticPath.has(parsed.pathname)||parsed.pathname==='/api/health'||parsed.pathname==='/api/auth/session')&&!parsed.search)return{kind:'continue-read'};
 if((parsed.pathname.startsWith('/_next/static/')||parsed.pathname.startsWith('/icons/'))&&!parsed.pathname.includes('%2e')&&!parsed.pathname.includes('%2f'))return{kind:'continue-read'};
 const match=parsed.pathname.match(/^\/api\/files\/([A-Za-z0-9_-]{1,128})$/);
 if(match&&binding.ownIds.files.includes(match[1])&&[...parsed.searchParams].every(([key,value])=>key==='preview'&&['card','cover','thumbnail'].includes(value)))return{kind:'continue-read'};
 return{kind:'deny',code:'K117_UNOWNED_GET_FORBIDDEN'};
}

function checkedPreference(value,section,query,binding){
 need(typeof value==='string'&&value.length<=2048,'K117_ACK_VALUE_REQUIRED');let parsed;try{parsed=JSON.parse(value);}catch{throw Error('K117_ACK_JSON_INVALID');}
 need(exact(parsed,['version','revision','query'])&&parsed.version===2&&UUID.test(parsed.revision??'')&&parsed.query===query,'K117_ACK_VALUE_QUERY_MISMATCH');canonicalQuery(section,query,binding);return value;
}
/** Реальный установленный Next codec; ответы предпочтений не должны содержать RSC/модули. */
export async function decodeKanbanPreferenceAck({body,status,headers,section,query},binding){
 need(require('next/package.json').version==='15.5.20','K117_FLIGHT_VERSION_MISMATCH');const bytes=Buffer.from(body),metadata=new Headers(headers);
 need(status===200&&bytes.length<=65536&&metadata.get('content-type')?.startsWith('text/x-component')&&!metadata.has('location')&&!metadata.has('x-action-redirect')&&metadata.get('x-nextjs-action-not-found')!=='1','K117_FLIGHT_HTTP_BOUNDARY');
 // Next15 tuple: [paths,tagInvalidation,sessionCookieRefresh]. Допускается
 // обновление cookie собственной сессии; path/tag invalidation запрещено.
 let revalidated;try{revalidated=JSON.parse(metadata.get('x-action-revalidated')??'[[],0,0]');}catch{throw Error('K117_FLIGHT_REVALIDATION_INVALID');}
 need(Array.isArray(revalidated)&&revalidated.length===3&&Array.isArray(revalidated[0])&&!revalidated[0].length&&(revalidated[1]===0||revalidated[1]===false)&&(revalidated[2]===0||revalidated[2]===1||revalidated[2]===false||revalidated[2]===true),'K117_PREFERENCE_REVALIDATION_FORBIDDEN');
 let denied=false;const denyModules=new Proxy(Object.create(null),{get(){denied=true;throw Error('K117_FLIGHT_MODULE_FORBIDDEN');}});
 const {createFromFetch}=require('next/dist/compiled/react-server-dom-webpack/client.edge');let timer;
 try{
  const decode=(async()=>{
   const envelope=await createFromFetch(Promise.resolve(new Response(bytes,{status,headers:metadata})),{serverConsumerManifest:{moduleMap:denyModules,serverModuleMap:denyModules,moduleLoading:null},replayConsoleLogs:false});
   need(plain(envelope)&&Object.keys(envelope).every(key=>['a','f','b'].includes(key))&&envelope.a&&typeof envelope.a.then==='function','K117_ACTION_ENVELOPE_REQUIRED');
   need(envelope.f===undefined||envelope.f===null||envelope.f===''||Array.isArray(envelope.f)&&!envelope.f.length,'K117_FULL_RSC_FORBIDDEN');
   const result=await envelope.a;need(exact(result,['ok','value'])&&typeof result.ok==='boolean','K117_ACK_RESULT_SHAPE');
   if(!result.ok)throw Error('K117_PREFERENCE_CAS_CONFLICT');
   checkedPreference(result.value,section,query,binding);return{ok:true,value:result.value};
  })();
  return await Promise.race([decode,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('K117_FLIGHT_TIMEOUT')),10000);})]);
 }catch(error){if(denied)throw Error('K117_FLIGHT_MODULE_FORBIDDEN');throw error;}finally{clearTimeout(timer);}
}

async function durable(file,value){const fd=await open(file,'wx',0o600);try{await fd.writeFile(JSON.stringify(value,null,2)+'\n');await fd.sync();}finally{await fd.close();}}
export class KanbanPreferenceJournal{
 constructor(binding,publish){this.binding=binding;this.publish=publish;this.values=new Map(binding.originalPreferences.map(row=>[row.key,row.value]));this.own=new Map();this.events=[];this.active=null;this.uncertain=0;}
 async event(kind,data){const item={sequence:this.events.length+1,at:new Date().toISOString(),kind,runId:this.binding.runId,revision:this.binding.revision,actorId:this.binding.actorId,...data};await this.publish(item);this.events.push(item);return item;}
 async begin(section,args){need(!this.uncertain,'K117_UNRESOLVED_PREFERENCE_STOP');need(!this.active,'K117_CONCURRENT_PREFERENCE_FORBIDDEN');need(args[0]===section&&args.length===3&&args[2]===this.values.get(prefKey(section)),'K117_EXPECTED_PREFERENCE_CAS_CHANGED');canonicalQuery(section,args[1],this.binding);
  const intent={requestId:randomUUID(),section,key:prefKey(section),query:args[1],expected:args[2],bodySha256:sha(JSON.stringify(args)),actionId:this.binding.actionId};this.active=intent;
  try{await this.event('INTENT',intent);}catch(error){this.active=null;throw error;}return intent;
 }
 async acknowledge(intent,result,response){need(this.active?.requestId===intent.requestId&&result?.ok===true,'K117_ACK_INTENT_MISMATCH');checkedPreference(result.value,intent.section,intent.query,this.binding);
  await this.event('ACK',{requestId:intent.requestId,key:intent.key,value:result.value,responseSha256:response.responseSha256,httpStatus:response.httpStatus});this.values.set(intent.key,result.value);this.own.set(intent.key,{userId:this.binding.actorId,key:intent.key,value:result.value});this.active=null;
 }
 async ambiguous(intent,code){this.uncertain++;try{await this.event('UNCERTAIN',{requestId:intent.requestId,key:intent.key,code});}finally{this.active=null;}}
 ownWrites(){return [...this.own.values()].map(row=>({...row}));}
}
/** Тест подставляет controlled Playwright Route; реальный adapter делает fetch ровно один раз. */
export async function forwardKanbanPreference(route,decision,binding,journal){
 need(decision.kind==='own-preference','K117_PREFERENCE_DECISION_REQUIRED');const intent=await journal.begin(decision.section,decision.args);
 try{
  const response=await route.fetch({maxRetries:0,maxRedirects:0,timeout:30000}),body=await response.body(),headers=response.headers();
  const result=await decodeKanbanPreferenceAck({body,status:response.status(),headers,section:decision.section,query:decision.args[1]},binding);
  await journal.acknowledge(intent,result,{responseSha256:sha(body),httpStatus:response.status()});
  await route.fulfill({response,body});return result;
 }catch(error){
  // Известный ACK сохраняется, даже если передать ответ браузеру не удалось.
  if(journal.active?.requestId===intent.requestId)await journal.ambiguous(intent,safeCode(error));throw error;
 }
}
/** Root выполняет точный план в guarded transaction, затем проверяет отсутствие строк. */
export function buildKanbanPreferenceCleanup(binding,ownWrites,currentRows){
 const current=new Map(),own=new Map(),allowed=new Set(['projects.list','products.list']);
 for(const [rows,target] of [[currentRows,current],[ownWrites,own]]){
  need(Array.isArray(rows)&&rows.length<=2,'K117_CLEANUP_ROW_LIMIT');
  for(const row of rows){need(exact(row,['userId','key','value'])&&row.userId===binding.actorId&&allowed.has(row.key)&&typeof row.value==='string'&&!target.has(row.key),'K117_CLEANUP_SCOPE_MISMATCH');
   checkedPreference(row.value,row.key.split('.')[0],JSON.parse(row.value).query,binding);target.set(row.key,row.value);}
 }
 return binding.originalPreferences.map(original=>{
  need(original.value===null,'K117_NONFRESH_CLEANUP_FORBIDDEN');const actual=current.get(original.key);if(actual===undefined)return{kind:'noop',userId:binding.actorId,key:original.key};
  need(own.get(original.key)===actual,'K117_UNKNOWN_CURRENT_PREFERENCE_STOP');return{kind:'delete',userId:binding.actorId,key:original.key,expectedValue:actual};
 });
}

/** Actual producer сравнивает полный HMAC/текущие rows/compiled manifest внутри guarded web. */
export async function certifySearch117Start(input,binding,verifySignedCurrent){
 need(typeof verifySignedCurrent==='function','K117_CURRENT_PRODUCER_CALLBACK_REQUIRED');
 const h=input.checkpoint;need(((h?.namespace===SEARCH117_NAMESPACE&&h.version===1)||(h?.namespace===COHORT163_NAMESPACE&&h.version===2))&&h.kind==='browser-handoff'&&/^[a-f0-9]{64}$/.test(h.verifierSourceSha256??'')&&/^[a-f0-9]{64}$/.test(h.currentOwnedStateHash??''),'K117_ACTUAL_SIGNED_PRODUCER_HANDOFF_REQUIRED');
 need(canonical117(h.subjects)===canonical117(input.subjects)&&canonical117(h.tokens)===canonical117(input.tokens)&&canonical117(h.action)===canonical117(input.action),'K117_PUBLIC_HANDOFF_FIELDS_TAMPERED');
 const certificate=await verifySignedCurrent(h);
 assertCurrentCertificate117(certificate,h,{'kanban-search-owned-fixtures.mjs':h.verifierSourceSha256});
 need(certificate.actorId===binding.actorId&&certificate.revision===binding.revision,'K117_CURRENT_PRODUCER_ACTOR_MISMATCH');return certificate;
}

async function privateDirectory(input,binding){
 need(path.isAbsolute(input.outputDir??''),'K117_PRIVATE_OUTPUT_REQUIRED');const base=await realpath(path.join(ROOT,'.playwright-mcp','search117')),root=await realpath(ROOT);
 need(path.relative(root,base)&&!path.relative(root,base).startsWith('..'),'K117_PRIVATE_BASE_MISMATCH');
 const directory=path.resolve(input.outputDir);need(path.dirname(directory).toLowerCase()===base.toLowerCase()&&path.basename(directory)===`staging-${binding.runId}`,'K117_PRIVATE_DIRECTORY_SCOPE');
 await mkdir(directory,{recursive:false,mode:0o700});need(!(await lstat(directory)).isSymbolicLink()&&(await realpath(directory)).toLowerCase()===directory.toLowerCase(),'K117_PRIVATE_REPARSE_FORBIDDEN');return directory;
}
async function twoFrames(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function boardPosition(page){return page.locator('[data-slot="kanban-scroll"]').evaluate(node=>({left:node.scrollLeft,top:scrollY}));}
async function columns(page){return page.locator('[data-slot="kanban-column"]').evaluateAll(nodes=>nodes.map(node=>({width:node.offsetWidth,left:node.offsetLeft,label:node.firstElementChild.firstElementChild.textContent})));}
async function centerMetrics(target){return target.evaluate(card=>{
 const board=card.closest('[data-slot="kanban-scroll"]'),b=board.getBoundingClientRect(),r=card.getBoundingClientRect(),center=(Math.max(0,b.left)+Math.min(innerWidth,b.right))/2,clamp=(value,max)=>Math.max(0,Math.min(max,value));
 return{left:board.scrollLeft,top:scrollY,wantedLeft:clamp(board.scrollLeft+r.left+r.width/2-center,board.scrollWidth-board.clientWidth),wantedTop:clamp(scrollY+r.top+r.height/2-innerHeight/2,document.scrollingElement.scrollHeight-innerHeight),bottom:document.querySelector('[data-kanban-scrollbar]')?.scrollLeft,cardWidth:r.width,cardHeight:r.height};
 });}

/** Здесь нет создания JWT, входа, DB/storage/business mutations, trace/HAR/storageState.
 * Записываются только предпочтения свежего QA actor. Root очищает их через CAS
 * и закрывает все reused own fixtures; BROWSER_CHECKS_PASSED_CLEANUP_REQUIRED ещё не приёмка. */
export async function runKanbanSearchStagingBrowser(input={},callbacks={}){
 const binding=validateKanbanSearchHandoff(input),certificate=await certifySearch117Start(input,binding,callbacks.verifySignedCurrent),directory=await privateDirectory(input,binding);
 const journal=new KanbanPreferenceJournal(binding,event=>durable(path.join(directory,`${String(event.sequence).padStart(4,'0')}-${event.kind.toLowerCase()}.json`),event));
 await durable(path.join(directory,'before.json'),{version:1,runId:binding.runId,revision:binding.revision,actorId:binding.actorId,checkpointSignature:binding.checkpointSignature,originalPreSha256:binding.preSha256,originalPreferences:binding.originalPreferences,actionId:binding.actionId,actionManifestSha256:binding.actionManifestSha256,currentVerificationCertificate:certificate});
 const receipt={status:'STARTED',revision:binding.revision,runId:binding.runId,mode:'fixed staging browser; only fresh actor list-preference action; root guarded cleanup still required',checks:[],screenshots:[],blockedOtherPosts:0,blockedPrefetches:0,deniedRequests:0,pageErrors:0,ownWrites:[],unresolvedIntents:0};
 let browser,context,phase='browser-setup',accepting=false,stop=null;const captures=new Set();
 function captureJob(promise){captures.add(promise);void promise.finally(()=>captures.delete(promise)).catch(()=>{});return promise;}
 async function drain(){accepting=false;await Promise.allSettled([...captures]);need(!captures.size&&!journal.active,'K117_ACTIONS_NOT_DRAINED');}
 try{
  browser=await chromium.launch({headless:true});
  for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:360,height:800}]){
   context=await browser.newContext({viewport,hasTouch:viewport.width<768,locale:'ru-RU',timezoneId:'Europe/Moscow',reducedMotion:'reduce',serviceWorkers:'block',...(input.basicAuth?{httpCredentials:input.basicAuth}:{})});
   await context.addInitScript(disableKanbanQaServiceWorkerApi);await context.addCookies(binding.cookies);accepting=true;
   await context.route('**/*',async route=>{
    const request=route.request(),headers=request.headers(),decision=kanbanSearchRequest({url:request.url(),method:request.method(),headers,body:request.postData()??'',prefetch:Boolean(headers['next-router-prefetch']||headers.purpose==='prefetch')},binding);
    if(decision.kind==='continue-read'||decision.kind==='continue-readonly-action'){await route.continue();return;}
    if(decision.kind==='abort-prefetch'){receipt.blockedPrefetches++;await route.abort();return;}
    if(decision.kind==='abort-unrelated-action'||!accepting){receipt.blockedOtherPosts++;await route.abort();return;}
    if(decision.kind==='own-preference'){
     try{await captureJob(forwardKanbanPreference(route,decision,binding,journal));}catch(error){stop=safeCode(error);accepting=false;await route.abort().catch(()=>{});}return;
    }
    receipt.deniedRequests++;stop=decision.code;accepting=false;await route.abort();
   });
   phase='own-session-health';const health=await context.request.get(`${binding.origin}/api/health`,{maxRedirects:0});need(health.status()===200,'K117_HEALTH_HTTP_FAILED');const h=await health.json();need(h.status==='ok'&&h.database==='ok','K117_HEALTH_DEGRADED');
   async function liveSession(){const response=await context.request.get(`${binding.origin}/api/auth/session`,{maxRedirects:0});need(response.status()===200,'K117_SESSION_HTTP_FAILED');const session=await response.json();need(session.user?.id===binding.actorId&&rolesSame(session.user.roles,binding.roles),'K117_LIVE_OWN_SESSION_MISMATCH');}
   await liveSession();const page=await context.newPage();page.on('pageerror',error=>{receipt.pageErrors++;if(error.message.includes('K114_SW_API_DISABLE_FAILED'))stop='K117_SW_API_DISABLE_FAILED';});
   async function healthy(){if(stop)throw Error(stop);need(!receipt.pageErrors,'K117_CLIENT_ERROR_OBSERVED');}
   async function ownCards(section){const ids=await page.locator('[data-kanban-card-id]').evaluateAll(nodes=>nodes.map(node=>node.dataset.kanbanCardId));need(ids.every(value=>binding.ownIds[section].includes(value)),'K117_UNOWNED_CARD_VISIBLE');return ids;}
   async function openSearch(){if(viewport.width<768){await page.getByRole('button',{name:'Фильтры',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();}return page.getByPlaceholder('Номер, название…');}
   async function closeSearch(){if(viewport.width<768){await page.getByRole('button',{name:'Показать результаты',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await twoFrames(page);}}
   async function typed(section,term){const input=await openSearch();await input.fill(term);await expect.poll(()=>new URL(page.url()).searchParams.get('q'),{timeout:20000}).toBe(term||null);await expect(page.locator('[data-pending]')).toHaveCount(0);await twoFrames(page);await healthy();return input;}
   for(const section of ['projects','products']){
    phase=`${section}-${viewport.width}`;const response=await page.goto(`${binding.origin}/${section}?${kanbanSearchQuery(section,'',binding)}`,{waitUntil:'domcontentloaded'});need(response?.status()===200&&new URL(page.url()).origin===binding.origin,'K117_BOARD_NAVIGATION_FAILED');
    await expect(page.locator('[data-slot="kanban-scroll"]')).toBeVisible();await expect(page.locator('[data-pending]')).toHaveCount(0);await twoFrames(page);await healthy();
    const initialIds=await ownCards(section),beforeColumns=await columns(page),subject=binding.subjects[section==='projects'?'project':'product'];need(initialIds.includes(subject.id),'K117_OWN_TARGET_NOT_AVAILABLE');
    const target=page.locator(`[data-kanban-card-id="${subject.id}"]`);await expect(target).toHaveCount(1);
    const initialMetrics=await centerMetrics(target);const wrong=await page.locator('[data-slot="kanban-scroll"]').evaluate((node,wanted)=>{const max=node.scrollWidth-node.clientWidth;const left=wanted>max/2?0:max;node.scrollTo({left,behavior:'instant'});return left;},initialMetrics.wantedLeft);await twoFrames(page);need(Math.abs(wrong-initialMetrics.wantedLeft)>8,'K117_MEANINGFUL_FOCUS_DISTANCE_REQUIRED');
    const lockedPosition=await boardPosition(page),searchInput=await typed(section,subject.number);
    if(viewport.width<768){need(await page.getByRole('dialog').count()===1,'K117_SHEET_AUTO_CLOSED');assert.deepEqual(await boardPosition(page),lockedPosition);await closeSearch();}
    await expect.poll(async()=>{await healthy();const m=await centerMetrics(target);return Math.max(Math.abs(m.left-m.wantedLeft),Math.abs(m.top-m.wantedTop));},{timeout:20000}).toBeLessThan(2);
    const focused=await centerMetrics(target);need(Math.abs(focused.left-lockedPosition.left)>8&&Math.abs(focused.bottom-focused.left)<2,'K117_FOCUS_OR_BOTTOM_SYNC_FAILED');assert.deepEqual(await columns(page),beforeColumns);
    const ids=await ownCards(section);assert.deepEqual(ids,initialIds.filter(value=>ids.includes(value)));
    if(viewport.width>=768)assert.deepEqual(await searchInput.evaluate(input=>({active:document.activeElement===input,start:input.selectionStart,end:input.selectionEnd})),{active:true,start:subject.number.length,end:subject.number.length});
    const screenshot=path.join(directory,`${section}-${viewport.width}.png`);await page.screenshot({path:screenshot});receipt.screenshots.push(screenshot);receipt.checks.push({section,viewport:viewport.width,kind:'exact-number-real-response-center-no-reorder-caret-sheet-bottom-sync',metrics:focused});
    for(const [kind,term,expectTarget] of [['own-title',binding.tokens[section==='projects'?'projectTitle':'productTitle'],true],['client-negative',binding.tokens.client,false],['technical-negative',binding.tokens.technical,false],['related-title-negative',binding.tokens[section==='projects'?'productTitle':'projectTitle'],false]]){
     await page.locator('[data-slot="kanban-scroll"]').evaluate((node,left)=>node.scrollTo({left,behavior:'instant'}),wrong);await twoFrames(page);const previous=await boardPosition(page);
     await typed(section,term);await closeSearch();await healthy();const matched=await ownCards(section);if(expectTarget)need(matched.includes(subject.id),'K117_OWN_TITLE_NOT_MATCHED');else need(matched.length===0,'K117_NONIDENTITY_SEARCH_MATCHED');
     assert.deepEqual(await columns(page),beforeColumns);need(Math.abs((await boardPosition(page)).left-previous.left)<2,'K117_NONNUMBER_AUTOSCROLL_FORBIDDEN');receipt.checks.push({section,viewport:viewport.width,kind,returnedCount:matched.length});
    }
   }
   await healthy();await liveSession();await drain();await context.close();context=null;
  }
  need(!journal.uncertain&&!stop&&receipt.deniedRequests===0&&receipt.pageErrors===0,'K117_UNKNOWN_REQUEST_OUTCOME_STOP');receipt.status='BROWSER_CHECKS_PASSED_CLEANUP_REQUIRED';
 }catch(error){receipt.status='STOP';receipt.phase=phase;receipt.code=safeCode(error);}
 finally{
  await drain().catch(()=>{receipt.status='STOP';receipt.code='K117_ACTIONS_NOT_DRAINED';});if(context)await context.close();if(browser)await browser.close();receipt.ownWrites=journal.ownWrites();receipt.unresolvedIntents=journal.uncertain;receipt.requestsDrained=captures.size===0&&!journal.active;
  await durable(path.join(directory,'browser-ended.json'),{...receipt,requestsDrained:captures.size===0&&!journal.active,endedAt:new Date().toISOString()});
 }
 return receipt;
}

/** Browser-only успех и предполагаемая очистка не подтверждают staging-приёмку. */
export function finalizeKanbanSearchAcceptance(binding,browserReceipt,cleanupReceipt,afterProof){
 need(browserReceipt.status==='BROWSER_CHECKS_PASSED_CLEANUP_REQUIRED'&&browserReceipt.revision===binding.revision&&browserReceipt.runId===binding.runId&&!browserReceipt.unresolvedIntents&&!browserReceipt.deniedRequests&&!browserReceipt.pageErrors&&browserReceipt.requestsDrained===true,'K117_BROWSER_ACCEPTANCE_INCOMPLETE');
 need(cleanupReceipt?.status==='CAS_RESTORED'&&cleanupReceipt.runId===binding.runId&&cleanupReceipt.actorId===binding.actorId&&cleanupReceipt.checkedKeys===2&&cleanupReceipt.remainingPreferenceRows===0&&cleanupReceipt.requestOutcomesSettled===true,'K117_ACTUAL_PREFERENCE_CLEANUP_REQUIRED');
 need(afterProof?.status==='ORIGINALS_MATCH_OWNED_CLOSED'&&afterProof.runId===binding.runId&&afterProof.revision===binding.revision&&afterProof.originalPreSha256===binding.preSha256&&afterProof.originalsMatch===true&&afterProof.remainingOwnedRows===0&&afterProof.physicalIdentityMatch===true,'K117_ACTUAL_POST_CLEANUP_PROOF_REQUIRED');
 return{status:'PASS',revision:binding.revision,runId:binding.runId,checks:browserReceipt.checks.length,preferencesRestored:true,originalsMatch:true,ownedRowsRemaining:0};
}

function cohortActor163(checkpoint,profile){const actor=checkpoint.actors?.find(a=>a.id===profile.id);return Boolean(actor&&COHORT163_ACTORS.includes(actor.key)&&rolesSame(actor.roles,profile.roles)&&rolesSame(profile.roles,[actor.key==='manager'?'MANAGER':actor.key==='accountant'?'ACCOUNTANT':'ENGINEER']));}
export function validateCohortHandoff163(h,identity){
 need(h.namespace===COHORT163_NAMESPACE&&h.version===2&&h.registry?.runId===h.runId&&h.registry.revision===h.revision&&digest117(h.registry)===h.registrySha256&&canonical117(h.registry.identity)===canonical117(identity),'K117_COHORT_HANDOFF_REGISTRY_MISMATCH');
 const expected=h.registry.ids;need(expected&&Object.keys(expected).length===8&&new Set(Object.values(expected)).size===8,'K117_COHORT_EXACT_IDS_REQUIRED');
 for(const [key,ids]of [['createdActorIds',COHORT163_ACTORS.map(k=>expected[k])],['createdClientIds',[expected.client]],['createdProjectIds',[expected.project]],['createdProductIds',[expected.productA,expected.productB]]])need(canonical117([...h[key]].sort())===canonical117([...ids].sort()),'K117_COHORT_HANDOFF_IDS_MISMATCH');
 need(h.createdFileIds.length===0&&h.subjects.client.id===expected.client&&h.subjects.project.id===expected.project&&h.subjects.product.id===expected.productA&&h.productB.id===expected.productB&&h.productB.projectId===expected.project,'K117_COHORT_SUBJECTS_MISMATCH');
 need(Array.isArray(h.actors)&&h.actors.length===4&&new Set(h.actors.map(a=>a.key)).size===4&&h.actors.every(a=>COHORT163_ACTORS.includes(a.key)&&a.id===expected[a.key]&&rolesSame(a.roles,[a.key==='manager'?'MANAGER':a.key==='accountant'?'ACCOUNTANT':'ENGINEER'])),'K117_COHORT_ACTOR_MAP_MISMATCH');
 need(canonical117(h.readPaths)===canonical117(['/projects/'+expected.project,'/products/'+h.subjects.product.number,'/products/'+h.productB.number]),'K117_COHORT_READ_PATHS_MISMATCH');
 need(Array.isArray(h.actionGrants)&&h.actionGrants.length===h.registry.actionGrants.length,'K117_COHORT_ACTION_MAP_MISMATCH');
 for(const [index,g]of h.actionGrants.entries()){const source=h.registry.actionGrants[index],{id,revision,manifestSha256,args,...declared}=g;need(canonical117(declared)===canonical117(source)&&g.kind==='readonly-bell'&&g.exportedName==='getBellData'&&g.filename==='src/server/notifications/actions.ts'&&/^[a-f0-9]{42}$/.test(id)&&revision===h.revision&&SHA64.test(manifestSha256??'')&&canonical117(args)==='[]','K117_COHORT_ACTION_EFFECT_SCOPE_MISMATCH');}
 return h;
}
