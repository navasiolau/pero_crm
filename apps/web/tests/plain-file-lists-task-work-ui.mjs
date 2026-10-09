// One valid owned Task UI scenario; no Parent verifier runs while its Work child exists.
// SAFETY D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md: STOP unknown, never resend delete.
import {chromium, expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {FILE_LIST_STAGING_ORIGIN as ORIGIN,FILE_LIST_FIXTURE_NAMESPACE as NS,compiledDeleteFileActionId,plainFileListRequestDecision,plainFileDeleteFlightOutcome} from './plain-file-lists-staging-contract.mjs';
import {openOwnedTaskFileDialog,plainFileListPageErrorDiagnostic} from './plain-file-lists-staging-browser.mjs';
import {disableKanbanQaServiceWorkerApi} from './kanban-cover-staging-browser.mjs';
const SHA=/^[a-f0-9]{64}$/,REV=/^[a-f0-9]{40}$/;
const check=(ok,code)=>{if(!ok)throw Error('T115_'+code);};
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v!==null&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const digest=v=>createHash('sha256').update(canonical(v)).digest('hex');
const safe=e=>/^T115_[A-Z0-9_]+$/.test(e?.message??'')?e.message:'T115_UI_CHECK_FAILED';
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};}
export function taskWorkUiBinding(input,c){
 check(input?.authorized===true&&input.origin===ORIGIN&&REV.test(input.expectedRevision??'')&&typeof input.childVerifier?.verifyCurrentTaskChild==='function'&&SHA.test(input.childVerifier.sourceSha256??''),'REVIEWED_OWN_TASK_CHILD_REQUIRED');
 const intent=input.parentDeleteIntent,obs=intent?.observation;
 check(intent?.namespace===NS&&intent.kind==='delete-intent'&&intent.version===2&&intent.revision===input.expectedRevision&&SHA.test(intent.signature??'')&&obs?.kind==='observation'&&obs.preSha256===intent.preSha256,'SIGNED_PARENT_TASK_DELETE_REQUIRED');
 const task=obs.rows?.Task?.find(row=>row.id===c.taskId),file=obs.rows?.File?.find(row=>row.id===c.fileId),manager=obs.rows?.User?.find(row=>row.id===intent.actorId);
 check(task&&file&&manager&&task.workId===null&&file.taskId===task.id&&file.projectId===task.projectId&&file.productId===task.productId&&file.mimeType==='image/png'&&file.id===intent.fileId&&JSON.stringify(manager.roles)==='["MANAGER"]','EXACT_MANAGER_OWN_TASK_IMAGE_REQUIRED');
 check(c?.namespace===NS&&c.kind==='task-work-current-verification'&&c.runId===intent.runId&&c.revision===input.expectedRevision&&c.preSha256===intent.preSha256&&c.parentDeleteIntentSha256===digest(intent)&&c.fileDeleted===false&&c.proof?.cancelled===true&&c.verifierSourceSha256===input.childVerifier.sourceSha256&&SHA.test(c.beforeSha256??'')&&SHA.test(c.preparedSha256??'')&&SHA.test(c.currentChildStateHash??'')&&SHA.test(c.signature??'')&&c.originalVerification?.originalRelationsMatch===true&&c.originalVerification.preferencesUntouched===true&&c.originalVerification.tokenClockValid===true,'CURRENT_DISTINCT_CHILD_CERTIFICATE_REQUIRED');
 const identity=input.childVerifier.physicalIdentity;
 check(identity?.hostname==='crm-staging'&&identity.revision===input.expectedRevision&&digest(identity)===input.childVerifier.physicalIdentitySha256,'ACTUAL_CHILD_PHYSICAL_IDENTITY_REQUIRED');
 const profile=input.profiles?.manager;
 check(profile?.id===manager.id&&JSON.stringify(profile.roles)==='["MANAGER"]'&&Array.isArray(profile.cookies)&&profile.cookies.length>0&&profile.cookies.length<=2&&profile.cookies.every(row=>['__Secure-authjs.session-token','authjs.session-token'].includes(row.name)&&typeof row.value==='string'&&row.value.length>0&&!/[\r\n;]/.test(row.value)),'MEMORY_ONLY_OWN_MANAGER_SESSION_REQUIRED');
 check(file.id!==obs.rows.Product[0].sketchFileId&&file.id!==obs.rows.Project[0].coverFileId,'CURRENT_COVER_DELETE_FORBIDDEN');
 const actionId=compiledDeleteFileActionId(input.compiledDeleteFile,input.expectedRevision);
 return{origin:ORIGIN,expectedRevision:input.expectedRevision,runId:intent.runId,paths:{project:'/projects/'+task.projectId,product:'/products/'+obs.rows.Product[0].number,financeProject:'/finance/projects/'+task.projectId},finance:null,financeDocs:[],files:obs.rows.File,actionId,task,file,manager,profile,intentSha256:digest(intent),identity};
}
export async function runTaskWork115FileUi(input={}){
 const initial=await input.childVerifier?.verifyCurrentTaskChild({expectedDeleted:false}),binding=taskWorkUiBinding(input,initial);
 check(typeof input.publish==='function','DURABLE_PRIVATE_UI_PUBLISHER_REQUIRED');
 const receipt={kind:'actual-valid-task-file-ui',status:'STARTED',runId:binding.runId,revision:binding.expectedRevision,phase:'setup',reads:0,checks:[],openClicks:0,blockedWrites:0,blockedPrefetches:0,deniedReads:0,pageErrors:0,firstPageError:null,upstreamWrites:0,upstreamDeleteRequests:0,genuineHttpAcks:0,childDeleteProofs:0,cachedRowRemoved:false,cancelPreservedFile:false,pendingCloseBlocked:false,requestsDrained:false,browserClosed:false,parentAckDeferredUntilWorkRestore:true,credentialsPersisted:false};
 let browser,context,fatal=null,armed=false,consumed=false,started=deferred(),release=deferred();
 const pending=new Set();
 const fail=e=>{fatal??=safe(e);};
 const safeNow=()=>check(!fatal,'TRANSPORT_STOPPED');
 const publish=async(label,value)=>{const result=await input.publish(label,value);check(result?.recorded===true&&SHA.test(result.sha256??''),'DURABLE_UI_RECORD_REQUIRED');return result;};
 async function close(){await Promise.allSettled([...pending]);if(context){await context.close();context=null;}receipt.requestsDrained=true;}
 async function start(viewport){
  await close();context=await browser.newContext({viewport,locale:'ru-RU',timezoneId:'Europe/Moscow',serviceWorkers:'block',ignoreHTTPSErrors:false,...(input.basicAuth?{httpCredentials:input.basicAuth}:{})});await context.addInitScript(disableKanbanQaServiceWorkerApi);
  await context.route('**/*',async route=>{
   const job=(async()=>{
    const request=route.request(),headers=request.headers(),descriptor={url:request.url(),method:request.method(),actionId:headers['next-action'],body:request.postData(),prefetch:Boolean(headers['next-router-prefetch']||headers.purpose==='prefetch')},decision=plainFileListRequestDecision(descriptor,binding);
    if(fatal){await route.abort('blockedbyclient');return;}
    if(decision.kind==='continue'){receipt.reads++;await route.continue();return;}
    if(decision.kind==='abort-prefetch'){receipt.blockedPrefetches++;await route.abort('blockedbyclient');return;}
    if(decision.kind==='abort-write'){receipt.blockedWrites++;await route.abort('blockedbyclient');return;}
    if(decision.kind==='deny'){receipt.deniedReads++;throw Error('T115_READ_NOT_ALLOWLISTED');}
    let args;try{args=JSON.parse(descriptor.body??'');}catch{throw Error('T115_EXACT_DELETE_ARGS_REQUIRED');}
    check(armed&&!consumed&&Array.isArray(args)&&request.method()==='POST'&&descriptor.actionId===binding.actionId&&args.length===1&&args[0]===binding.file.id&&/^text\/plain\b/.test(headers['content-type']??''),'ONE_PRESEALED_TASK_DELETE_ONLY');
    consumed=true;armed=false;started.resolve();
    check(await release.promise,'PENDING_UI_GUARD_FAILED');safeNow();receipt.upstreamDeleteRequests++;
    const response=await route.fetch({maxRedirects:0,maxRetries:0,timeout:30000}),body=await response.body(),responseHeaders=response.headers();
    check(response.status()===200&&!responseHeaders.location&&!responseHeaders['x-action-redirect']&&/^text\/x-component\b/.test(responseHeaders['content-type']??'')&&plainFileDeleteFlightOutcome(body).ok===true,'GENUINE_DELETE_HTTP_RESULT_REQUIRED');
    receipt.genuineHttpAcks++;
    const current=await input.childVerifier.verifyCurrentTaskChild({expectedDeleted:true});
    check(current.kind==='task-work-current-verification'&&current.parentDeleteIntentSha256===binding.intentSha256&&current.beforeSha256===initial.beforeSha256&&current.preparedSha256===initial.preparedSha256&&current.fileId===binding.file.id&&current.fileDeleted===true&&current.proof?.deleted===true&&current.proof.versionsAccounted===true&&current.proof.priorOwnAuditPreserved===true&&current.proof.ownPreferencesUntouched===true&&current.originalVerification?.originalRelationsMatch===true&&current.originalVerification.preferencesUntouched===true&&current.originalVerification.tokenClockValid===true,'ACTUAL_KNOWN_CHILD_DELETE_DELTA_REQUIRED');
    safeNow();await publish('http-and-child-proof',{kind:'actual-task-delete-child-proof',runId:binding.runId,revision:binding.expectedRevision,parentDeleteIntentSha256:binding.intentSha256,httpStatus:response.status(),responseBodySha256:createHash('sha256').update(body).digest('hex'),certificate:current,parentAckDeferredUntilWorkRestore:true,credentialsPersisted:false});receipt.childDeleteProofs++;
    safeNow();await route.fulfill({response,body});
   })();pending.add(job);try{await job;}catch(error){fail(error);await route.abort('blockedbyclient').catch(()=>{});}finally{pending.delete(job);}
  });
  context.on('response',response=>{if(!['GET','HEAD'].includes(response.request().method())&&response.request().headers()['next-action']!==binding.actionId){receipt.upstreamWrites++;fail(Error('T115_OTHER_UPSTREAM_WRITE'));}});
  await context.addCookies(binding.profile.cookies.map(row=>({name:row.name,value:row.value,url:ORIGIN,secure:true,httpOnly:true,sameSite:'Lax'})));
  const session=await context.request.get(ORIGIN+'/api/auth/session',{maxRedirects:0});check(session.status()===200,'OWN_SESSION_HTTP');const user=(await session.json()).user;check(user?.id===binding.manager.id&&JSON.stringify(user.roles)==='["MANAGER"]','CURRENT_OWN_MANAGER');
  const page=await context.newPage();page.on('pageerror',error=>{receipt.pageErrors++;receipt.firstPageError??=plainFileListPageErrorDiagnostic(error);fail(Error('T115_PAGE_ERROR'));});return page;
 }
 async function open(page){
  const response=await page.goto(ORIGIN+binding.paths.project+'?tab=tasks',{waitUntil:'domcontentloaded'});check(response?.status()===200,'OWN_TASK_PAGE_HTTP');safeNow();
  return openOwnedTaskFileDialog(page,binding.task.title,()=>{receipt.openClicks++;},safeNow);
 }
 const rowOf=dialog=>dialog.locator('[data-file-list-row="'+binding.file.id+'"]:visible');
 async function rowProof(page,dialog,width){
  const row=rowOf(dialog);await expect(row).toHaveCount(1);await row.scrollIntoViewIfNeeded();check((await row.innerText()).trim()===binding.file.fileName,'TASK_FILENAME_ONLY');await expect(row.locator('img,iframe,video,time')).toHaveCount(0);
  const trash=row.getByRole('button',{name:'Удалить файл '+binding.file.fileName,exact:true});await expect(trash).toBeEnabled();
  const geometry=await row.evaluate(node=>{const r=node.getBoundingClientRect();return{left:r.left,right:r.right,width:r.width,viewport:innerWidth,overflow:node.scrollWidth>node.clientWidth+1};});check(geometry.width>0&&geometry.left>=-1&&geometry.right<=geometry.viewport+1&&!geometry.overflow,'TASK_FILENAME_OVERFLOW');
  const name=row.getByRole('button',{name:binding.file.fileName,exact:true});await name.focus();await name.press('Enter');const viewer=page.locator('[data-file-viewer-variant="image-fullscreen"]:visible');await expect(viewer).toHaveCount(1);const image=viewer.locator('[data-fullscreen-image] img');await expect.poll(()=>image.evaluate(node=>node.complete&&node.naturalWidth>0)).toBe(true);await expect(image).toHaveAttribute('src','/api/files/'+binding.file.id);check(await image.evaluate(node=>getComputedStyle(node).objectFit)==='contain','TASK_IMAGE_CROPPED');await viewer.getByRole('button',{name:'Закрыть полноэкранный просмотр',exact:true}).click();await expect(viewer).toHaveCount(0);await expect(dialog).toBeVisible();safeNow();receipt.checks.push({kind:'task-filename-original-fullscreen',viewport:width});return{row,trash};
 }
 try{
  await publish('intent',{kind:'owned-valid-task-ui-intent',runId:binding.runId,revision:binding.expectedRevision,parentDeleteIntentSha256:binding.intentSha256,taskId:binding.task.id,fileId:binding.file.id,workId:initial.workId,childSourceSha256:input.childVerifier.sourceSha256,credentialsPersisted:false,oneDelete:true});
  browser=await chromium.launch({headless:true,channel:'chromium'});
  for(const viewport of [{width:390,height:844},{width:1440,height:900}]){
   receipt.phase='task-files-read';const page=await start(viewport),dialog=await open(page);await rowProof(page,dialog,viewport.width);
   if(viewport.width!==1440)continue;
   receipt.phase='task-confirmed-delete';const row=rowOf(dialog),trash=row.getByRole('button',{name:'Удалить файл '+binding.file.fileName,exact:true});const popup=page.locator('[data-slot="popover-content"]:visible');
   await trash.click();await expect(popup).toBeVisible();await expect(popup.getByRole('button',{name:'Отмена',exact:true})).toBeFocused();await popup.getByRole('button',{name:'Отмена',exact:true}).click();await expect(popup).toHaveCount(0);await expect(row).toBeVisible();check(receipt.upstreamDeleteRequests===0,'CANCEL_SENT_DELETE');receipt.cancelPreservedFile=true;
   await trash.click();await expect(popup).toBeVisible();armed=true;await popup.getByRole('button',{name:'Удалить',exact:true}).click();await Promise.race([started.promise,new Promise((_,reject)=>setTimeout(()=>reject(Error('T115_DELETE_NOT_STARTED')),15000))]);
   await expect(popup.getByRole('button',{name:'Удаление…',exact:true})).toBeDisabled();await expect(popup.getByRole('button',{name:'Отмена',exact:true})).toBeDisabled();await expect(trash).toBeDisabled();await page.keyboard.press('Escape');await expect(popup).toBeVisible();await expect(dialog).toBeVisible();receipt.pendingCloseBlocked=true;release.resolve(true);
   await expect(row).toHaveCount(0,{timeout:65000});await Promise.allSettled([...pending]);safeNow();await expect(dialog).toBeVisible();receipt.cachedRowRemoved=true;check(receipt.upstreamDeleteRequests===1&&receipt.genuineHttpAcks===1&&receipt.childDeleteProofs===1,'EXACT_ONE_GENUINE_TASK_DELETE');
  }
  await close();safeNow();receipt.status='PASS_PENDING_WORK_RESTORE_AND_PARENT_ACK';
 }catch(error){receipt.status='STOP_PRESERVE_NO_RETRY';receipt.code=fatal??safe(error);}
 finally{release.resolve(false);await close();if(browser)await browser.close();receipt.browserClosed=true;}
 await publish('result',receipt);return receipt;
}
