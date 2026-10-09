// Actual deployed Next UI/actions only. Root creates a fresh signed fixture first.
// No browser/network action on import; JWT cookies stay in caller memory.
import {randomUUID} from 'node:crypto';
import {chromium,expect} from '@playwright/test';
import {disableKanbanQaServiceWorkerApi} from './kanban-cover-staging-browser.mjs';
const STAGES=new Set(['LEAD','ESTIMATE','CONTRACT','IN_WORK','PAUSED','REFUSED']);
const STATUSES=new Set(['DRAFT','PREPARATION','DESIGN']);
function safeStageExtras(data){if(data.extras===undefined||data.extras==='$undefined')return true;return data.toStage==='REFUSED'&&data.extras&&typeof data.extras==='object'&&!Array.isArray(data.extras)&&Object.keys(data.extras).every(key=>['refusalReason','refusalComment'].includes(key))&&typeof data.extras.refusalReason==='string'&&data.extras.refusalReason.startsWith('QA111 ');}
const SAFE_FAILURE_CODES=new Set(['DRAFT111_ACTION_HTTP_FAILED','DRAFT111_ACTION_RESULT_UNEXPECTED','DRAFT111_ACTUAL_ACTION_ACK_REQUIRED','DRAFT111_ACTUAL_PROJECT_CREATED','DRAFT111_ACTUAL_SESSION_ID','DRAFT111_AUTHORIZED_STAGE_BINDING','DRAFT111_BROWSER_UNKNOWN','DRAFT111_CANONICAL_ACTION_ARGS_REQUIRED','DRAFT111_CLEAN_BROWSER','DRAFT111_CLIENT_ERROR','DRAFT111_DEPLOYED_REFERENCE_REQUIRED','DRAFT111_DURABLE_CALLBACKS_REQUIRED','DRAFT111_FRESH_MANAGER_PROFILE','DRAFT111_GLOBAL_COLUMNS_ORDER','DRAFT111_NESTED_COLUMNS_ORDER','DRAFT111_NEXT_ACTION_HEADER_REQUIRED','DRAFT111_OUTSIDE_ORIGIN_MUTATION','DRAFT111_OWN_GRAPH_REQUIRED','DRAFT111_OWN_PAGE_HTTP','DRAFT111_OWN_PATH_REQUIRED','DRAFT111_OWN_PRODUCT_SLOT','DRAFT111_OWN_TAGS_REQUIRED','DRAFT111_OWNED_ACTION_PAGE_REQUIRED','DRAFT111_PARTIAL_FILTER_ACK_REQUIRED','DRAFT111_PARTIAL_FILTER_WIDENED','DRAFT111_PREFERENCE_CAS_ACK','DRAFT111_PRODUCT_CREATE_ID','DRAFT111_PROJECT_CREATE_ID','DRAFT111_REPLAY_NOOP_GRAPH_CHANGED','DRAFT111_SAVED_PARTIAL_FILTER_WIDENED','DRAFT111_STOP_AFTER_UNKNOWN_RESPONSE','DRAFT111_UNOWNED_MUTATION_BLOCKED' ,'DRAFT111_JOURNAL_PERSIST_FAILED','DRAFT111_BROWSER_CLOSE_FAILED']);
const ERROR_KINDS=new Map([['Error','ERROR'],['TypeError','TYPE_ERROR'],['RangeError','RANGE_ERROR'],['ReferenceError','REFERENCE_ERROR'],['SyntaxError','SYNTAX_ERROR'],['TimeoutError','TIMEOUT_ERROR']]);
const safeErrorKind=error=>ERROR_KINDS.get(error?.name)??'UNKNOWN';
const LABELS={LEAD:'Лид',ESTIMATE:'Просчёт',CONTRACT:'Договор',IN_WORK:'В работе',PAUSED:'Пауза',REFUSED:'Отказ'};
const flightRows=bytes=>bytes.toString('utf8').split('\n').flatMap(line=>{try{return[JSON.parse(line.slice(line.indexOf(':')+1))];}catch{return[];}});
const need=(ok,code)=>{if(!ok)throw Error(code);};
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_:-]{1,160}$/.test(value);
export function classifyDraftQaAction(args,scope){
 if(!Array.isArray(args))return null;
 const [data]=args;
 if(args.length===1&&data&&typeof data==='object'&&!Array.isArray(data)){
  if(data.title===scope.tags.projectA&&data.clientId===scope.clientId&&data.managerId===scope.actorId&&[undefined,'$undefined',''].includes(data.address)&&Object.keys(data).every(key=>['title','clientId','managerId','address'].includes(key)))return {kind:'project-create'};
  if(scope.projectIds.has(data.projectId)&&scope.tags.products.includes(data.title)&&data.quantity===1&&data.expectedPrice===0&&Object.keys(data).every(key=>['projectId','title','kind','expectedPrice','quantity','description','engineerId'].includes(key))&&[undefined,'$undefined',''].includes(data.engineerId)&&[undefined,'$undefined',''].includes(data.kind)&&data.description==='')return {kind:'product-create',projectId:data.projectId,productTitle:data.title};
  if(scope.projectIds.has(data.projectId)&&STAGES.has(data.toStage)&&STAGES.has(data.expectedStage)&&uuid(data.clientMutationId)&&safeStageExtras(data)&&Object.keys(data).every(key=>['projectId','toStage','expectedStage','clientMutationId','extras'].includes(key)))return {kind:'project-stage',projectId:data.projectId,toStage:data.toStage};
 }
 if(args.length===2&&scope.productIds.has(args[0])&&STATUSES.has(args[1]))return {kind:'product-status',productId:args[0],toStatus:args[1]};
 if(args.length===3&&['projects','products'].includes(args[0])&&typeof args[1]==='string'&&args[1].length<=32768&&(args[2]===null||typeof args[2]==='string'))return {kind:'preference',key:args[0]+'.list'};
 return null;
}
export async function runProductDraftStageBrowser({authorized=false,origin,revision,profile,checkpoint,outputDir,basicAuth,onJournal,observe,launchBrowser=options=>chromium.launch(options)}){
 need(authorized===true&&origin==='https://staging-crm.peromebel.by'&&/^[a-f0-9]{40}$/.test(revision??'')&&checkpoint?.revision===revision&&/^[a-f0-9]{64}$/.test(checkpoint.signature??'')&&uuid(checkpoint.runId),'DRAFT111_AUTHORIZED_STAGE_BINDING');
 need(profile?.id===checkpoint.pre?.ids.actor&&JSON.stringify(profile.roles)===JSON.stringify(['MANAGER'])&&Array.isArray(profile.cookies)&&profile.cookies.length>0,'DRAFT111_FRESH_MANAGER_PROFILE');
 need(typeof onJournal==='function'&&typeof observe==='function'&&outputDir,'DRAFT111_DURABLE_CALLBACKS_REQUIRED');
 const tags=checkpoint.pre.tags,scope={actorId:profile.id,clientId:checkpoint.pre.ids.client,tags,projectIds:new Set([checkpoint.pre.ids.projectB]),productIds:new Set(),paths:new Set(['/projects','/products','/projects/'+checkpoint.pre.ids.projectB])};
 need(tags?.products?.length===10&&typeof tags.projectA==='string'&&typeof tags.client==='string'&&typeof tags.actor==='string','DRAFT111_OWN_TAGS_REQUIRED');
 const journal={runId:checkpoint.runId,revision,actions:[],preferences:{'projects.list':null,'products.list':null}};
 const receipt={kind:'product-draft-stage-browser',revision,runId:checkpoint.runId,status:'STARTED',checks:[],pageErrors:0,pageErrorKinds:[],pageHttpStatus:null,journalPersistFailures:0,closeFailures:0,blockedWrites:0,authentication:'fresh owned manager short-lived private JWT; password login not claimed'};
 const browser=await launchBrowser({headless:true,channel:'chromium'});
 const context=await browser.newContext({viewport:{width:1440,height:900},locale:'ru-RU',timezoneId:'Europe/Minsk',serviceWorkers:'block',httpCredentials:basicAuth});
 await context.addInitScript(disableKanbanQaServiceWorkerApi);await context.addCookies(profile.cookies.map(cookie=>({...cookie,url:origin})));
 const page=await context.newPage();page.on('pageerror',error=>{receipt.pageErrors++;if(receipt.pageErrorKinds.length<5)receipt.pageErrorKinds.push(safeErrorKind(error));});
 let step='BOOTSTRAP',queue=Promise.resolve(),failure,productStatusReference,stageReference,lastGraph,lastObservation;
 async function durable(){try{await onJournal(structuredClone(journal));}catch{receipt.journalPersistFailures++;throw Error('DRAFT111_JOURNAL_PERSIST_FAILED');}}
 function stop(error){receipt.status='STOP';receipt.code=SAFE_FAILURE_CODES.has(error?.message)?error.message:'DRAFT111_BROWSER_UNKNOWN';receipt.failureStep=step;receipt.errorKind=safeErrorKind(error);}
 function ackResult(bytes){const rows=flightRows(bytes).filter(row=>row&&typeof row==='object'&&typeof row.ok==='boolean');need(rows.length===1,'DRAFT111_ACTUAL_ACTION_ACK_REQUIRED');return rows[0];}
 async function processWrite(route,request,url,args,action){
  need(!failure,'DRAFT111_STOP_AFTER_UNKNOWN_RESPONSE');
  const classified=classifyDraftQaAction(args,scope);
  if(!classified){
   if(Array.isArray(args)&&args.length===0){await route.abort('blockedbyclient');return;}
   receipt.blockedWrites++;throw Error('DRAFT111_UNOWNED_MUTATION_BLOCKED');
  }
  const atISO=new Date().toISOString(),intent={id:randomUUID(),kind:classified.kind,atISO,ack:null};
  if(classified.kind==='project-stage')intent.actionId=args[0].clientMutationId;
  for(const key of ['projectId','productId','productTitle','toStage','toStatus'])if(classified[key]!==undefined)intent[key]=classified[key];
  if(classified.kind==='preference')intent.preferenceKey=classified.key;
  journal.actions.push(intent);await durable();
  const response=await route.fetch({maxRetries:0,maxRedirects:0,timeout:45000}),bytes=await response.body();
  need(response.status()===200,'DRAFT111_ACTION_HTTP_FAILED');const result=ackResult(bytes);
  if(classified.kind==='project-create'&&result.ok){need(id(result.id),'DRAFT111_PROJECT_CREATE_ID');scope.projectIds.add(result.id);intent.ack={atISO:new Date().toISOString(),projectId:result.id};}
  else if(classified.kind==='product-create'&&result.ok){need(id(result.id),'DRAFT111_PRODUCT_CREATE_ID');scope.productIds.add(result.id);intent.ack={atISO:new Date().toISOString(),projectId:classified.projectId,productId:result.id};}
  else if(classified.kind==='preference'){
   need(result.ok===true&&typeof result.value==='string','DRAFT111_PREFERENCE_CAS_ACK');
   journal.preferences[classified.key]=result.value;intent.ack={atISO:new Date().toISOString(),value:result.value};
  }else{
   const denied=classified.kind==='product-status'&&classified.toStatus==='PREPARATION'&&args[0]===scope.denialProduct;
   need(denied?result.ok===false:result.ok===true,'DRAFT111_ACTION_RESULT_UNEXPECTED');
   intent.ack={atISO:new Date().toISOString(),...(classified.projectId?{projectId:classified.projectId}:{}),...(classified.productId?{productId:classified.productId}:{})};
   if(classified.kind==='product-status'&&result.ok)productStatusReference={action,url:url.pathname,headers:request.headers()};
   if(classified.kind==='project-stage'&&result.ok)stageReference={action,url:url.pathname,args,headers:request.headers()};
  }
  await durable();await route.fulfill({response,body:bytes});
 }
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  try{
   if(url.origin!==origin){if(['GET','HEAD'].includes(request.method())){await route.continue();return;}throw Error('DRAFT111_OUTSIDE_ORIGIN_MUTATION');}
   if(['GET','HEAD','OPTIONS'].includes(request.method())){if(url.pathname==='/my'){await route.abort('blockedbyclient');return;}await route.continue();return;}
   const action=request.headers()['next-action'];need(typeof action==='string'&&/^[a-f0-9]{40,80}$/.test(action),'DRAFT111_NEXT_ACTION_HEADER_REQUIRED');
   let args;try{args=JSON.parse(request.postData()??'');}catch{throw Error('DRAFT111_CANONICAL_ACTION_ARGS_REQUIRED');}
   const ownedPage=scope.paths.has(url.pathname)||[...scope.projectIds].some(value=>url.pathname==='/projects/'+value);
   need(ownedPage,'DRAFT111_OWNED_ACTION_PAGE_REQUIRED');
   const task=queue.then(()=>processWrite(route,request,url,args,action));queue=task.catch(error=>{failure??=error;});
   await task;
  }catch(error){failure??=error;await route.abort('blockedbyclient').catch(()=>{});}
 });
 async function settled(){await queue;if(failure)throw failure;need(receipt.pageErrors===0,'DRAFT111_CLIENT_ERROR');}
 async function ownGraph(){step='OWN_GRAPH';await settled();const observation=await observe(structuredClone(journal));lastObservation=observation.observation??observation;lastGraph=lastObservation.scopegraph;need(lastGraph?.projectB&&Array.isArray(lastGraph.products),'DRAFT111_OWN_GRAPH_REQUIRED');for(const subject of [lastGraph.projectA,lastGraph.projectB,...lastGraph.products].filter(Boolean)){need(typeof subject.path==='string'&&/^\/(?:projects|products)\/[A-Za-z0-9_.:-]+$/.test(subject.path),'DRAFT111_OWN_PATH_REQUIRED');scope.paths.add(subject.path);}return lastGraph;}
 async function goto(url,where='OWN_PAGE'){step=where;const response=await page.goto(origin+url,{waitUntil:'domcontentloaded'});const status=response?.status();receipt.pageHttpStatus=Number.isInteger(status)&&status>=100&&status<=599?status:null;need(status===200,'DRAFT111_OWN_PAGE_HTTP');await page.locator('main').waitFor({state:'visible'});await settled();}
 async function product(slot){const graph=await ownGraph(),value=graph.products.find(row=>row.titleSlot===slot);need(value&&scope.productIds.has(value.id),'DRAFT111_OWN_PRODUCT_SLOT');return value;}
 async function assertStatus(slot,status){await expect.poll(async()=>{const graph=await ownGraph();return graph.products.find(row=>row.titleSlot===slot)?.status;},{timeout:20000}).toBe(status);}
 async function addProduct(project,slot,status){
  await goto(project.path+'?tab=products','PRODUCTS_TAB');step='PRODUCT_DIALOG';await page.getByRole('button',{name:'Изделие',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Новое изделие'});await dialog.locator('#product-title').fill(tags.products[slot-1]);await dialog.locator('#product-price').fill('0');
  await dialog.getByRole('button',{name:'Создать изделие',exact:true}).click();await expect(dialog).not.toBeVisible();await assertStatus(slot,status);return product(slot);
 }
 async function stage(project,toStage){
  await goto(project.path+'?tab=overview','PROJECT_STAGE_PAGE');step='PROJECT_STAGE_SELECT';await page.getByRole('combobox',{name:'Статус',exact:true}).click();await page.getByRole('option',{name:LABELS[toStage],exact:true}).click();
  if(toStage==='REFUSED'){const dialog=page.getByRole('dialog');await dialog.locator('#refusalReason').fill('QA111 '+checkpoint.runId);await dialog.getByRole('button',{name:'Перевести в «Отказ»',exact:true}).click();await expect(dialog).not.toBeVisible();}
  await expect.poll(async()=>{const graph=await ownGraph();return graph.projectA?.id===project.id?graph.projectA.stage:graph.projectB.stage;},{timeout:20000}).toBe(toStage);
 }
 function check(value){receipt.checks.push(value);}
 async function direct(reference,args){
  need(reference,'DRAFT111_DEPLOYED_REFERENCE_REQUIRED');
  await page.evaluate(async ({pathname,action,tree,args})=>{
   const headers={'Next-Action':action,'Content-Type':'text/plain;charset=UTF-8'};if(tree)headers['Next-Router-State-Tree']=tree;
   const response=await fetch(pathname,{method:'POST',headers,body:JSON.stringify(args),credentials:'same-origin'});await response.text();
  },{pathname:reference.url,action:reference.action,tree:reference.headers['next-router-state-tree'],args});
  await settled();
 }
 try{
  step='SESSION';const session=await context.request.get(origin+'/api/auth/session',{maxRedirects:0});need(session.status()===200&&(await session.json()).user?.id===profile.id,'DRAFT111_ACTUAL_SESSION_ID');
  step='INITIAL_JOURNAL';await durable();await goto('/projects?view=kanban&q='+checkpoint.runId,'PROJECTS_BOARD');
  step='PROJECT_DIALOG_OPEN';await page.getByRole('button',{name:'Проект',exact:true}).click();const projectDialog=page.getByRole('dialog',{name:'Новый проект'});
  step='PROJECT_TITLE';await projectDialog.locator('#title').fill(tags.projectA);step='PROJECT_CLIENT';await projectDialog.getByRole('button',{name:'Выберите клиента…',exact:true}).click();await page.getByPlaceholder('Поиск клиента…').fill(tags.client);await page.getByRole('button',{name:tags.client,exact:true}).click();
  step='PROJECT_MANAGER';await projectDialog.getByRole('button',{name:'не назначен',exact:true}).click();await page.getByPlaceholder('Поиск менеджера…').fill(tags.actor);await page.getByRole('button',{name:tags.actor,exact:true}).click();
  step='PROJECT_CREATE';await projectDialog.getByRole('button',{name:'Создать проект',exact:true}).click();await expect(projectDialog).not.toBeVisible();
  let graph=await ownGraph();need(graph.projectA,'DRAFT111_ACTUAL_PROJECT_CREATED');const A=graph.projectA,B=graph.projectB;
  const a1=await addProduct(A,1,'DRAFT');
  await goto(a1.path);await expect(page.getByRole('combobox',{name:'Сменить статус'})).toBeDisabled();
  await goto('/products?view=kanban&project='+A.id+'&active=0');await expect(page.getByText(tags.products[0],{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Перетащить '+tags.products[0],exact:true})).toHaveCount(0);check('LEAD_create_DRAFT_disabled_status_and_global_drag');
  await stage(A,'ESTIMATE');await addProduct(A,2,'DRAFT');check('ESTIMATE_create_DRAFT');
  await stage(A,'CONTRACT');await assertStatus(1,'PREPARATION');await assertStatus(2,'PREPARATION');
  const firstContract=structuredClone(stageReference);
  const a3=await addProduct(A,3,'PREPARATION');await goto(a3.path);await page.getByRole('combobox',{name:'Сменить статус'}).click();await page.getByRole('option',{name:'Проектирование',exact:true}).click();await assertStatus(3,'DESIGN');check('CONTRACT_promotes_DRAFT_postcontract_create_PREPARATION');
  await stage(A,'LEAD');await assertStatus(1,'PREPARATION');await assertStatus(2,'PREPARATION');await assertStatus(3,'DESIGN');
  const a4=await addProduct(A,4,'DRAFT');scope.denialProduct=a4.id;await direct(productStatusReference,[a4.id,'PREPARATION']);await assertStatus(4,'DRAFT');scope.denialProduct=null;
  await goto(A.path+'?tab=products');const draftColumn=page.locator('[data-slot="kanban-column"]').filter({has:page.getByText('Черновики',{exact:true})});await expect(draftColumn.getByText(tags.products[3],{exact:true})).toBeVisible();await expect(draftColumn.getByRole('button',{name:'Перетащить '+tags.products[3]})).toHaveCount(0);
  await stage(A,'CONTRACT');await assertStatus(4,'PREPARATION');await assertStatus(3,'DESIGN');check('return_preserves_nonDRAFT_denial_and_contract_promotes_only_DRAFT');
  const noOp=structuredClone(stageReference);await ownGraph();const beforeReplay=JSON.stringify(lastObservation.rows);await direct(firstContract,firstContract.args);await direct(noOp,[{...noOp.args[0],expectedStage:'CONTRACT',toStage:'CONTRACT',clientMutationId:randomUUID()}]);await ownGraph();need(beforeReplay===JSON.stringify(lastObservation.rows),'DRAFT111_REPLAY_NOOP_GRAPH_CHANGED');check('actual_deployed_stage_replay_and_noop');
  await addProduct(B,5,'DRAFT');await stage(B,'REFUSED');await addProduct(B,6,'DRAFT');check('PAUSED_REFUSED_without_ordinary_history_default_DRAFT');
  await stage(B,'ESTIMATE');await addProduct(B,7,'DRAFT');await stage(B,'IN_WORK');for(const slot of [5,6,7])await assertStatus(slot,'DRAFT');await addProduct(B,8,'PREPARATION');check('skip_CONTRACT_no_autopromotion_active_create_PREPARATION');
  await stage(B,'PAUSED');await addProduct(B,9,'PREPARATION');await stage(B,'REFUSED');await addProduct(B,10,'PREPARATION');check('PAUSED_REFUSED_latest_ordinary_stage');
  for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:360,height:800}]){
   await page.setViewportSize(viewport);await goto(B.path+'?tab=products');
   const headers=await page.locator('[data-slot="kanban-column"]').locator('span.text-sm.font-medium').allTextContents();need(headers[0]==='Черновики'&&headers[1]==='Подготовка','DRAFT111_NESTED_COLUMNS_ORDER');
   await goto('/products?view=kanban&project='+B.id+'&active=0');const labels=await page.locator('[data-slot="kanban-column"]').locator('span.text-sm.font-medium').allTextContents();need(labels[0]==='Черновики'&&labels[1]==='Подготовка','DRAFT111_GLOBAL_COLUMNS_ORDER');
  }
  check('actual_global_and_nested_columns_desktop_mobile');
  const partial=new URLSearchParams({view:'kanban',project:B.id,active:'0',status:JSON.stringify(['DESIGN','PREPARATION'])});await goto('/products?'+partial);await ownGraph();
  need(typeof journal.preferences['products.list']==='string','DRAFT111_PARTIAL_FILTER_ACK_REQUIRED');const saved=JSON.parse(journal.preferences['products.list']);need(new URLSearchParams(saved.query).get('status')===JSON.stringify(['DESIGN','PREPARATION']),'DRAFT111_PARTIAL_FILTER_WIDENED');
  for(const slot of [5,6,7])await expect(page.getByText(tags.products[slot-1],{exact:true})).toHaveCount(0);await goto('/products');need(new URL(page.url()).searchParams.get('status')===JSON.stringify(['DESIGN','PREPARATION']),'DRAFT111_SAVED_PARTIAL_FILTER_WIDENED');
  for(const slot of [5,6,7])await expect(page.getByText(tags.products[slot-1],{exact:true})).toHaveCount(0);check('explicit_and_saved_partial_filter_not_extended_with_DRAFT');await settled();need(context.serviceWorkers().length===0&&receipt.pageErrors===0&&receipt.blockedWrites===0,'DRAFT111_CLEAN_BROWSER');
  receipt.status='PASS';
 }catch(error){stop(error);}
 finally{await queue.catch(()=>{});try{await durable();}catch(error){if(receipt.status!=='STOP')stop(error);}for(const resource of [context,browser])try{await resource.close();}catch{receipt.closeFailures++;if(receipt.status!=='STOP'){step='BROWSER_CLOSE';stop(Error('DRAFT111_BROWSER_CLOSE_FAILED'));}}}
 return {receipt,journal,scopegraph:lastGraph??null};
}
