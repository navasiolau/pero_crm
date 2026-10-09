// Opt-in narrow existing-income check. Import does no browser/network/DB action.
// SAFETY D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; read only, STOP target mismatch.
import {chromium,expect} from '@playwright/test';
import {createRequire} from 'node:module';
import {readFileSync,existsSync,lstatSync,realpathSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isPlainFileListStaticReadPath} from './plain-file-lists-staging-contract.mjs';
import {disableKanbanQaServiceWorkerApi} from './kanban-cover-staging-browser.mjs';
import {plainFileListPageErrorDiagnostic} from './plain-file-lists-staging-browser.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),web=path.resolve(here,'..'),require=createRequire(import.meta.url),{build}=createRequire(require.resolve('tsx/package.json'))('esbuild');
const ORIGIN='https://staging-crm.peromebel.by',SHA=/^[a-f0-9]{64}$/,REV=/^[a-f0-9]{40}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const need=(ok,code)=>{if(!ok)throw Error('INCOME_QA_'+code);};
const hash=v=>createHash('sha256').update(v).digest('hex');
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v!==null&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const digest=v=>hash(canonical(v));
export function incomeReadonlyRequest(request,projectId){
 let u;try{u=new URL(request.url);}catch{return'deny';}
 if(u.origin!==ORIGIN||u.username||u.password||u.hash)return'deny';
 if(!['GET','HEAD'].includes(request.method))return'block-write';
 if(request.prefetch)return'block-prefetch';
 if(['/api/health','/api/auth/session'].includes(u.pathname)&&!u.search)return'allow';
 const finance=u.pathname==='/finance/projects/'+projectId&&[...u.searchParams.keys()].every(k=>k==='_rsc');
 const project=u.pathname==='/projects/'+projectId&&[...u.searchParams.entries()].every(([k,v])=>k==='_rsc'||k==='tab'&&v==='finance');
 if(finance||project||isPlainFileListStaticReadPath(u.pathname)||(['/favicon.ico','/icon.svg','/apple-icon.png','/manifest.webmanifest'].includes(u.pathname)&&!u.search))return'allow';
 return'deny'; // Never document/photo body, downloads, print, finance writes or exports.
}
async function filteredRow(page,memory){
 const search=page.getByPlaceholder('Поиск по приходам…',{exact:true}),row=page.locator('[data-file-list-row="'+memory.documentId+'"]:visible');
 for(let attempt=1;attempt<=3;attempt++){
  await search.fill('');await search.fill(memory.fileName);
  try{await row.waitFor({state:'visible',timeout:2500});}
  catch(error){need(error?.name==='TimeoutError'&&!await row.isVisible(),'EXISTING_INCOME_LOCAL_FILTER_FAILED');continue;}
  await expect(row).toHaveCount(1);return row;
 }
 throw Error('INCOME_QA_EXISTING_INCOME_ROW_NOT_VISIBLE');
}
export async function runExistingIncomeReadonly(options={}){
 need(options.authorized===true&&REV.test(options.expectedRevision??'')&&UUID.test(options.runId??'')&&path.isAbsolute(options.outputDir??'')&&path.isAbsolute(options.producerWeb??'')&&SHA.test(options.expectedFinanceTabLfSha256??''),'ROOT_REVIEWED_SOURCE_SCOPE');
 const producerTests=path.join(options.producerWeb,'tests'),transportModule=await import(pathToFileURL(path.join(producerTests,'crm-acceptance-transport.mjs')).href),adapter=await import(pathToFileURL(path.join(producerTests,'file-fixture113-context-smoke.mjs')).href),coordinator=await import(pathToFileURL(path.join(producerTests,'file-fixture113-runner.mjs')).href);
 for(const[name,pin]of Object.entries(adapter.FROZEN_SOURCES))need(hash(readFileSync(path.join(producerTests,name)))===pin,'FROZEN_READONLY_BACKEND_PIN');
 const financeSource=readFileSync(path.join(web,'src','app','(app)','projects','[id]','finance-tab.tsx'),'utf8').replace(/\r\n/g,'\n');need(hash(financeSource)===options.expectedFinanceTabLfSha256,'SHARED_FINANCE_TAB_SOURCE_PIN');
 need(existsSync(options.outputDir)&&lstatSync(options.outputDir).isDirectory()&&!lstatSync(options.outputDir).isSymbolicLink()&&path.resolve(realpathSync(options.outputDir)).toLowerCase()===path.resolve(options.outputDir).toLowerCase(),'PRIVATE_EXISTING_OUTPUT_DIRECTORY');
 const sources=Object.fromEntries(['finance-income-readonly-entry.mjs','finance-income-readonly.mjs'].map(name=>[name,hash(readFileSync(path.join(here,name)))]));sources.financeTabLfSha256=options.expectedFinanceTabLfSha256;
 const plugin={name:'unchanged-original-readonly-guards',setup(builder){
  builder.onResolve({filter:/^task113:frozen-library$/},()=>({path:path.join(producerTests,'file-fixture113-entry.mjs'),namespace:'income-frozen'}));
  builder.onLoad({filter:/.*/,namespace:'income-frozen'},args=>({contents:adapter.derivedFrozenLibrary(readFileSync(args.path)),loader:'js',resolveDir:producerTests}));
  builder.onResolve({filter:/^task113:protocol$/},()=>({path:path.join(producerTests,'file-fixture113-protocol.mjs')}));
 }};
 const built=await build({entryPoints:[path.join(here,'finance-income-readonly-entry.mjs')],bundle:true,write:false,platform:'node',format:'esm',target:'node22',external:['@prisma/client','@aws-sdk/client-s3','sharp'],banner:{js:'import {createRequire as incomeQaRequire} from "node:module"; const require=incomeQaRequire(import.meta.url);'},define:{__FIXTURE_SOURCE_HASHES__:JSON.stringify(adapter.FROZEN_SOURCES),__INCOME_QA_SOURCE_HASHES__:JSON.stringify(sources)},plugins:[plugin],minify:true,logLevel:'silent'});
 const bytes=Buffer.from(built.outputFiles[0].contents);need(bytes.length<=256*1024,'UNCHANGED_BUNDLE_CAP');
 const transport=transportModule.qaTransport({target:'staging',revision:options.expectedRevision,outputDir:options.outputDir});let identity,part=0,before,memory,browser,context;
 const publish=(label,value)=>coordinator.immutablePublish(path.join(options.outputDir,'income-readonly-'+String(++part).padStart(3,'0')+'-'+label+'.json'),value);
 const base={authorized:true,runId:options.runId,revision:options.expectedRevision,operation:'inspect'};
 async function execute(mode,extra={}){
  const input={...base,mode,...extra},ascii=JSON.stringify(input).replace(/[\u007f-\uffff]/g,c=>String.fromCharCode(92)+'u'+c.charCodeAt(0).toString(16).padStart(4,'0'));need(Buffer.from(ascii).toString('base64').length<=96*1024,'UNCHANGED_INPUT_CAP');
  const r=await transport.execute(bytes,'inspect',input);need(r.receipt?.identity?.hostname==='crm-staging'&&r.receipt.identity.revision===options.expectedRevision&&r.receipt.bundleSha256===hash(bytes)&&r.receipt.exitCode===0,'ACTUAL_READONLY_NATIVE_RECEIPT');
  if(identity)need(canonical(identity)===canonical(r.receipt.identity),'DEPLOYMENT_CHANGED_DURING_INCOME_CHECK');else identity=r.receipt.identity;
  need(Buffer.byteLength(JSON.stringify(r.body))<=64*1024,'UNCHANGED_PRIVATE_REPLY_CAP');return r;
 }
 if(options.metadataOnly===true){const r=await execute('income-metadata');need(r.body.status==='EXISTING_READY_INCOME_AVAILABLE'&&r.body.credentialsMinted===false&&r.body.databaseReadOnly===true,'READONLY_METADATA_PROBE_ONLY');const result={status:r.body.status,selection:r.body.selection,identity,sourceHashes:sources,databaseReadOnly:true,credentialsMinted:false,browserStarted:false,documentContentRequests:0};const saved=publish('metadata',result);return{...result,resultSha256:saved.sha256};}
 const receipt={kind:'existing-income-file-row-readonly',status:'STARTED',runId:options.runId,revision:options.expectedRevision,sourceHashes:sources,rows:[],blockedWrites:0,blockedPrefetches:0,deniedReads:0,pageErrors:0,firstPageError:null,upstreamWrites:0,documentContentRequests:0,credentialsPersisted:false,screenshots:[],originalsMatch:false};
 const pending=new Set();let fatal=null;
 try{
  const initial=await execute('income-before');need(initial.body.status==='READONLY_INCOME_BEFORE'&&initial.body.credentialsMemoryOnly===true,'CURRENT_EXISTING_SELECTION_BEFORE_BROWSER');before=initial.body.before;memory=initial.body.memory;
  need(before?.kind==='income-readonly-before'&&before.runId===options.runId&&before.revision===options.expectedRevision&&canonical(before.sources)===canonical(sources)&&before.selection.adminIdSha256===digest(memory.adminId)&&before.selection.documentIdSha256===digest(memory.documentId)&&before.selection.filenameSha256===digest(memory.fileName)&&before.selection.adminActive===true&&canonical(memory.roles)==='["ADMIN"]','SOURCE_BOUND_EXISTING_ADMIN_DOCUMENT');
  publish('before',{kind:'signed-existing-income-before',before,identity,bundleSha256:hash(bytes),credentialsPersisted:false});receipt.selection=before.selection;
  const auth=await transportModule.qaBasicAuth();browser=await chromium.launch({headless:true,channel:'chromium'});
  for(const viewport of[{width:1440,height:900},{width:390,height:844}]){
   context=await browser.newContext({viewport,locale:'ru-RU',timezoneId:'Europe/Moscow',serviceWorkers:'block',httpCredentials:auth,ignoreHTTPSErrors:false});await context.addInitScript(disableKanbanQaServiceWorkerApi);
   await context.route('**/*',async route=>{const job=(async()=>{const r=route.request(),h=r.headers(),decision=incomeReadonlyRequest({url:r.url(),method:r.method(),prefetch:Boolean(h['next-router-prefetch']||h.purpose==='prefetch')},memory.projectId);
    if(fatal){await route.abort('blockedbyclient');return;}if(decision==='allow'){await route.continue();return;}if(decision==='block-write'){receipt.blockedWrites++;await route.abort('blockedbyclient');return;}if(decision==='block-prefetch'){receipt.blockedPrefetches++;await route.abort('blockedbyclient');return;}receipt.deniedReads++;throw Error('INCOME_QA_READ_NOT_ALLOWLISTED');
   })();pending.add(job);try{await job;}catch{fatal??='INCOME_QA_READ_GUARD_STOP';await route.abort('blockedbyclient').catch(()=>{});}finally{pending.delete(job);}});
   context.on('response',r=>{if(!['GET','HEAD'].includes(r.request().method())){receipt.upstreamWrites++;fatal??='INCOME_QA_UPSTREAM_WRITE';}});
   await context.addCookies(memory.cookies);const session=await context.request.get(ORIGIN+'/api/auth/session',{maxRedirects:0});need(session.status()===200,'CURRENT_ADMIN_SESSION_HTTP');const user=(await session.json()).user;need(user?.id===memory.adminId&&canonical(user.roles)==='["ADMIN"]','CURRENT_METADATA_SELECTED_ADMIN');
   const page=await context.newPage();page.on('pageerror',error=>{receipt.pageErrors++;receipt.firstPageError??=plainFileListPageErrorDiagnostic(error);fatal??='INCOME_QA_PAGE_ERROR';});
   for(const surface of[{kind:'finance-project',route:'/finance/projects/'+memory.projectId}]){
    const response=await page.goto(ORIGIN+surface.route,{waitUntil:'domcontentloaded'});need(response?.status()===200,'KNOWN_INCOME_SURFACE_HTTP');const row=await filteredRow(page,memory);need(!fatal,'READONLY_BROWSER_STOPPED');
    await row.scrollIntoViewIfNeeded();const label=(await row.innerText()).trim();need(digest(label)===before.selection.filenameSha256,'FILENAME_ONLY_HASH_MISMATCH');await expect(row.locator('img,iframe,video,time')).toHaveCount(0);await expect(row.getByRole('button',{name:'Удалить файл '+memory.fileName,exact:true})).toBeDisabled();
    const geometry=await row.evaluate(node=>{const r=node.getBoundingClientRect();return{left:r.left,right:r.right,width:r.width,viewport:innerWidth,overflow:node.scrollWidth>node.clientWidth+1};});need(geometry.width>0&&geometry.left>=-1&&geometry.right<=geometry.viewport+1&&!geometry.overflow,'INCOME_FILENAME_OVERFLOW');
    receipt.rows.push({surface:surface.kind,viewport:viewport.width,documentIdSha256:before.selection.documentIdSha256,filenameSha256:before.selection.filenameSha256,mimeType:memory.mimeType,urnDisabled:true,noThumbnail:true,noFileMetadata:true,geometry});
   }
   await Promise.allSettled([...pending]);await context.close();context=null;
  }
  need(!fatal&&receipt.upstreamWrites===0&&receipt.deniedReads===0&&receipt.pageErrors===0&&receipt.rows.length===2,'TWO_READONLY_INCOME_ROWS_REQUIRED');receipt.status='READ_ONLY_ROWS_PASS';
 }catch(error){receipt.status=before?'STOP_PRESERVE':'STOP_BEFORE_BROWSER';receipt.code=fatal??(/^INCOME_QA_[A-Z0-9_]+$/.test(error?.message??'')||['NO_CURRENT_ACTIVE_ADMIN_STOP_BEFORE_BROWSER','NO_SUITABLE_READY_INCOME_STOP_BEFORE_BROWSER'].includes(error?.message)?error.message:'INCOME_QA_CHECK_FAILED');}
 finally{await Promise.allSettled([...pending]);if(context)await context.close();if(browser)await browser.close();memory=null;}
 if(before){const late=await execute('income-after',{before,beforeSha256:digest(before)});need(late.body.status==='READONLY_INCOME_CLOSED'&&late.body.proof.beforeSha256===digest(before)&&late.body.proof.verification?.originalRelationsMatch===true&&late.body.proof.verification.preferencesUntouched===true&&late.body.proof.verification.tokenClockValid===true,'LATE_ALL_PUBLIC_SCHEMA_MONEY_MATCH');publish('closed',{kind:'signed-existing-income-closed',proof:late.body.proof,identity,bundleSha256:hash(bytes),credentialsPersisted:false});receipt.originalsMatch=true;if(receipt.status==='READ_ONLY_ROWS_PASS')receipt.status='PASS';}
 const saved=publish('result',receipt);return{...receipt,resultSha256:saved.sha256};
}
