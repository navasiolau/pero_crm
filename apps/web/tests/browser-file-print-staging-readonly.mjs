/** Source-only readonly acceptance 116. Import performs no browser/network/DB/file action. */
import {createHash} from 'node:crypto';
import {inspectNativeFilePrintPreview} from './helpers/native-file-print-preview.mjs';

const check = (ok, code) => {if (!ok) throw Error(`F116_${code}`);};
const mime = value => String(value ?? '').split(';',1)[0].trim().toLowerCase();
const printable = file => file.mimeType === 'application/pdf' || /^image\/(?:png|jpeg|gif|webp|avif|bmp|svg\+xml|x-icon|apng)$/.test(file.mimeType);
const safeError = error => /^F(?:115|116)_[A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : 'F116_ACCEPTANCE_FAILED';

const SHA=/^[a-f0-9]{64}$/;
const NATIVE_URI_CLASSES=['CHROME_PDF_EXTENSION','CHROME_PRINT','CHROME_UNTRUSTED_PDF','SAME_ORIGIN_BLOB','OTHER'];
export function nativePdfUriClass(value, origin) {
 let url;try {url=new URL(value);} catch {return 'OTHER';}
 if(url.username||url.password||url.hash||url.pathname.includes('..')||/%(?:2e|2f|5c)/i.test(url.pathname))return 'OTHER';
 if(url.protocol==='chrome-extension:'&&url.hostname==='mhjfbmdgcfjbbpaeojofohoefgiehjai'&&url.pathname.startsWith('/'))return 'CHROME_PDF_EXTENSION';
 if(url.protocol==='chrome:'&&['print','resources'].includes(url.hostname)&&url.pathname.startsWith('/'))return 'CHROME_PRINT';
 if(url.protocol==='chrome-untrusted:'&&url.hostname==='pdf'&&url.pathname.startsWith('/'))return 'CHROME_UNTRUSTED_PDF';
 if(url.protocol==='blob:'&&url.origin===origin&&url.pathname.startsWith(origin+'/')&&/^[a-f0-9-]{36}$/.test(url.pathname.slice(origin.length+1)))return 'SAME_ORIGIN_BLOB';
 return 'OTHER';
}
/** Only V8 call-site URLs classify provenance; message text and raw stacks never leave memory. */
export function printPageErrorProvenance(error, origin) {
 const message=String(error?.message??''),stack=String(error?.stack??'').slice(0,65536),names=['Error','TypeError','ReferenceError','RangeError','SyntaxError','SecurityError','AbortError','DOMException'];
 const urls=stack.split('\n').filter(line=>/^\s*at\s/.test(line)).flatMap(line=>{const match=line.match(/(?:\(|\s)([a-z][a-z0-9+.-]*:\/\/[^\s)]+)\)?$/);return match?[match[1].replace(/:\d+(?::\d+)?$/,'')]:[];});
 const nativeKinds=new Set(['CHROME_PDF_EXTENSION','CHROME_PRINT','CHROME_UNTRUSTED_PDF']);
 let originClass='UNKNOWN';
 if(urls.some(value=>{try{return new URL(value).origin===origin;}catch{return false;}}))originClass='CRM';
 else if(urls.length&&urls.every(value=>nativeKinds.has(nativePdfUriClass(value,origin))))originClass=nativePdfUriClass(urls[0],origin);
 const react=message.match(/Minified React error #(\d{1,4})/);
 return {originClass,name:names.includes(error?.name)?error.name:'OTHER',reactCode:react?Number(react[1]):null,messageSha256:createHash('sha256').update(message).digest('hex')};
}

function currentVerifiedPdf(binding, phase) {
 const files=phase?.source==='project'?binding.files:phase?.source==='finance'?binding.financeDocs:[];
 return SHA.test(phase?.contentHash??'')&&files.some(file=>file.id===phase.fileId&&file.mimeType==='application/pdf'&&file.contentHash===phase.contentHash);
}

/** Only the reviewed common 115 GET allowlist plus exact owned PDF ?view=1. No delete permit exists. */
export function readonlyFilePrintRequestDecision(request, binding, sharedDecision, verifiedPdf = null) {
 if (!['GET','HEAD'].includes(request.method)) return {kind:'abort-write',code:'F116_WRITE_FORBIDDEN'};
 if (request.prefetch) return {kind:'abort-prefetch'};
 const nativeClass=nativePdfUriClass(request.url,binding.origin);
 if(nativeClass!=='OTHER')return currentVerifiedPdf(binding,verifiedPdf)?{kind:'continue'}:{kind:'deny',code:'F116_NATIVE_PDF_GATE_REQUIRED'};
 let url;try {url=new URL(request.url);} catch {return {kind:'deny',code:'F116_INVALID_URL'};}
 if (url.origin !== binding.origin || url.username || url.password || url.hash) return {kind:'deny',code:'F116_CROSS_ORIGIN'};
 const file = binding.files.find(file=>url.pathname===`/api/files/${file.id}`) ?? binding.financeDocs.find(file=>url.pathname===`/api/finance/documents/${file.id}`);
 if (file?.mimeType==='application/pdf' && url.search==='?view=1') return {kind:'continue'};
 return sharedDecision(request,binding);
}

export function filePrintOwnedCases(binding) {
 const cases = [];
 for (const file of binding.files) {
  const surface = file.taskId === binding.ids.task ? 'task' : file.productId === binding.ids.product && !file.isCurrentSketch ? 'product' : !file.isCurrentProjectCover ? 'project' : null;
  if (surface) cases.push({source:'project',surface,file});
 }
 for (const file of binding.financeDocs) {
  const surface = file.paymentId === binding.finance?.expenseId ? 'expense' : file.paymentId === binding.finance?.incomeId ? 'income' : null;
  if (surface) cases.push({source:'finance',surface,file});
 }
 check(cases.length>0 && cases.length<=16 && cases.some(item=>printable(item.file)),'BOUNDED_OWN_PRINT_CASES_REQUIRED');
 return cases;
}

/** Reuse only Root's actual canceled ready previews for unchanged current IDs/content. */
export function remainingFilePrintOwnedCases(binding, previous) {
 const all=filePrintOwnedCases(binding);if(!previous)return {cases:all,priorNativeMatched:[]};
 check(previous.runId===binding.runId&&previous.revision===binding.expectedRevision&&Array.isArray(previous.native)&&previous.native.length<=16,'PREVIOUS_NATIVE_SCOPE_REQUIRED');
 const matches=all.filter(item=>previous.native.some(old=>old.source===item.source&&old.fileId===item.file.id&&old.contentHash===item.file.contentHash&&SHA.test(old.contentHash??'')&&old.mimeType===item.file.mimeType&&old.kind==='actual-native-preview'&&old.canceled===true&&old.physicalPrintSubmitted===false&&old.preview?.state==='1'&&old.preview.error==='0'&&old.preview.pageCount==='1'&&old.preview.previewLoaded===true&&old.preview.isPdf===(item.file.mimeType==='application/pdf')));
 return {cases:all.filter(item=>!matches.includes(item)),priorNativeMatched:matches.map(item=>({source:item.source,fileId:item.file.id,contentHash:item.file.contentHash}))};
}

/** Called only by root with coordinator113.handoff(), producerReceipt.identity and fixtureVerifier().
 * Credentials remain in the private binding; output/sinks receive no profile, cookie, body, trace or storageState. */
export async function runFilePrintStagingReadonly(input = {}) {
 const {verifyPlainFileListStagingBinding,plainFileListRequestDecision} = await import('./plain-file-lists-staging-contract.mjs');
 const {disableKanbanQaServiceWorkerApi} = await import('./kanban-cover-staging-browser.mjs');
 check(typeof input.saveNativeScreenshot==='function','NATIVE_EVIDENCE_SINK_REQUIRED');
 const binding = await verifyPlainFileListStagingBinding(input), {cases,priorNativeMatched} = remainingFilePrintOwnedCases(binding,input.previousNativeReceipt);
 const {chromium,expect} = await import('@playwright/test');
 const receipt = {status:'STARTED',runId:binding.runId,revision:binding.expectedRevision,checks:[],native:[],priorNativeMatched,nativeUriCounts:Object.fromEntries(NATIVE_URI_CLASSES.map(kind=>[kind,0])),deniedUriCounts:Object.fromEntries(NATIVE_URI_CLASSES.map(kind=>[kind,0])),blockedWrites:0,blockedPrefetches:0,deniedReads:0,pageErrors:0,pageErrorProvenance:[],nativeShutdownErrors:0,storageWriteAttempts:0,upstreamWrites:0};
 let browser,context,fatal=null,verifiedPdf=null,completedPdf=null,nativeOperationActive=false;const routes=new Set();
 const fail = error => {fatal ??= safeError(error);};
 const assertSafe = () => check(!fatal && receipt.pageErrors===0 && receipt.deniedReads===0 && receipt.upstreamWrites===0 && receipt.storageWriteAttempts===0,'READONLY_OR_PAGE_VIOLATION');
 async function goto(page,path) {
  const response=await page.goto(binding.origin+path,{waitUntil:'domcontentloaded'});
  check(response?.status()===200 && new URL(page.url()).origin===binding.origin,'OWN_NAVIGATION_FAILED');
  check(await page.evaluate(()=>!('serviceWorker' in navigator)&&typeof window.serwist==='undefined') && context.serviceWorkers().length===0,'SW_BOOTSTRAP_MISMATCH');assertSafe();
 }
 async function locate(page,item) {
  if (item.surface==='task') {
   // The sealed standalone QA task has no Work and is absent from the task workspace.
   // Its owned attachment remains in the actual project flat files list with the same printer row.
   await goto(page,`${binding.paths.project}?tab=files`);
   return page.locator(`[data-file-id="${item.file.id}"][data-file-source="project"]:visible`);
  }
  if (item.surface==='project') await goto(page,`${binding.paths.project}?tab=files`);
  else if (item.surface==='product') await goto(page,binding.paths.product);
  else await goto(page,item.surface==='expense'?'/finance/expenses':'/finance/income');
  if(item.surface==='income') {
   await page.getByPlaceholder('Поиск по приходам…',{exact:true}).fill(binding.finance.incomeComment);
   const ownIncome=page.locator('tr:visible,article[data-slot="mobile-list-card"]:visible').filter({has:page.getByText(binding.finance.accountName,{exact:true})});
   await expect(ownIncome).toHaveCount(1);await ownIncome.click();
  }
  return page.locator(`[data-file-id="${item.file.id}"][data-file-source="${item.source}"]:visible`);
 }
 try {
  browser=await chromium.launch({channel:'chromium',headless:false,args:['--window-position=-20000,-20000']});
  context=await browser.newContext({viewport:{width:1440,height:900},locale:'ru-RU',timezoneId:'Europe/Moscow',serviceWorkers:'block',acceptDownloads:true,ignoreHTTPSErrors:false,...(input.basicAuth?{httpCredentials:input.basicAuth}:{})});
  await context.addInitScript(disableKanbanQaServiceWorkerApi);
  await context.exposeBinding('reportFilePrintStorageAttempt',()=>{receipt.storageWriteAttempts++;fail(Error('F116_STORAGE_WRITE_FORBIDDEN'));});
  await context.addInitScript(()=>{for(const name of ['setItem','removeItem','clear'])Object.defineProperty(Storage.prototype,name,{configurable:true,value(){window.reportFilePrintStorageAttempt();throw Error('F116_STORAGE_WRITE_FORBIDDEN');}});});
  await context.route('**/*',async route=>{
   const work=(async()=>{
    const request=route.request(),headers=request.headers();
    const decision=readonlyFilePrintRequestDecision({url:request.url(),method:request.method(),prefetch:Boolean(headers['next-router-prefetch']||headers.purpose==='prefetch')},binding,plainFileListRequestDecision,verifiedPdf);
    const uriClass=nativePdfUriClass(request.url(),binding.origin);if(uriClass!=='OTHER')receipt.nativeUriCounts[uriClass]++;
    if(fatal||decision.kind==='deny'){receipt.deniedUriCounts[uriClass]++;receipt.deniedReads++;fail(Error(decision.code??'F116_TRANSPORT_STOPPED'));await route.abort('blockedbyclient');}
    else if(decision.kind==='abort-write'){receipt.blockedWrites++;await route.abort('blockedbyclient');}
    else if(decision.kind==='abort-prefetch'){receipt.blockedPrefetches++;await route.abort('blockedbyclient');}
    else {check(decision.kind==='continue','READONLY_DECISION_REQUIRED');await route.continue();}
   })();routes.add(work);try{await work;}catch(error){fail(error);await route.abort('blockedbyclient').catch(()=>{});}finally{routes.delete(work);}
  });
  context.on('response',response=>{if(!['GET','HEAD'].includes(response.request().method())){receipt.upstreamWrites++;fail(Error('F116_UPSTREAM_WRITE'));}});
  await context.addCookies(binding.profiles.admin.cookies);
  const health=await context.request.get(`${binding.origin}/api/health`,{maxRedirects:0});check(health.status()===200,'HEALTH_FAILED');const healthBody=await health.json();check(healthBody.status==='ok'&&healthBody.database==='ok','HEALTH_DEGRADED');
  const session=await context.request.get(`${binding.origin}/api/auth/session`,{maxRedirects:0});check(session.status()===200,'SESSION_FAILED');const current=await session.json();check(current.user?.id===binding.profiles.admin.id&&JSON.stringify(current.user.roles)===JSON.stringify(binding.profiles.admin.roles),'CURRENT_ADMIN_SESSION_MISMATCH');
  const page=await context.newPage();page.on('pageerror',error=>{
   const diagnostic=printPageErrorProvenance(error,binding.origin);
   const nativeKnown=['CHROME_PDF_EXTENSION','CHROME_PRINT','CHROME_UNTRUSTED_PDF'].includes(diagnostic.originClass);
   const afterVerifiedPdfCancel=verifiedPdf===null&&!nativeOperationActive&&nativeKnown&&diagnostic.reactCode===null&&currentVerifiedPdf(binding,completedPdf);
   receipt.pageErrorProvenance.push({...diagnostic,afterVerifiedPdfCancel,fatal:!afterVerifiedPdfCancel});
   if(afterVerifiedPdfCancel)receipt.nativeShutdownErrors++;else{receipt.pageErrors++;fail(Error('F116_PAGE_ERROR'));}
  });
  for(const item of cases) {
   const file=item.file,source=item.source==='finance'?`/api/finance/documents/${file.id}`:`/api/files/${file.id}`;
   const original=await context.request.get(binding.origin+source,{maxRedirects:0});check(original.status()===200&&mime(original.headers()['content-type'])===mime(file.mimeType),'OWN_ORIGINAL_METADATA_FAILED');
   const bytes=await original.body();check(createHash('sha256').update(bytes).digest('hex')===file.contentHash,'OWN_ORIGINAL_BYTES_CHANGED');
   const row=await locate(page,item);await expect(row).toHaveCount(1);await row.scrollIntoViewIfNeeded();check((await row.innerText()).trim()===file.fileName,'OWN_FILENAME_OR_METADATA_FAILED');await expect(row.locator('img,iframe,video,time')).toHaveCount(0);
   const printer=row.getByRole('button',{name:`Распечатать ${file.fileName}`,exact:true});
   if(item.source==='finance')await expect(row.getByRole('button',{name:`Удалить файл ${file.fileName}`,exact:true})).toBeDisabled();
   if(!printable(file)){await expect(printer).toHaveCount(0);receipt.checks.push({kind:'unsupported-no-printer',source:item.source,fileId:file.id});assertSafe();continue;}
   await expect(printer).toBeEnabled();
   let native;
   if(file.mimeType==='application/pdf')verifiedPdf={source:item.source,fileId:file.id,contentHash:file.contentHash};
   nativeOperationActive=true;try {native=await inspectNativeFilePrintPreview({browser,isPdf:file.mimeType==='application/pdf',trigger:async()=>{assertSafe();await printer.click();},saveScreenshot:async png=>{await input.saveNativeScreenshot({source:item.source,fileId:file.id,contentHash:file.contentHash,png});}});}
   finally {verifiedPdf=null;nativeOperationActive=false;}

   receipt.native.push({source:item.source,fileId:file.id,mimeType:file.mimeType,contentHash:file.contentHash,...native});
   if(file.mimeType==='application/pdf'&&native.kind==='actual-native-preview'&&native.canceled===true&&native.physicalPrintSubmitted===false&&native.preview?.state==='1'&&native.preview.error==='0'&&native.preview.pageCount==='1'&&native.preview.previewLoaded===true)completedPdf={source:item.source,fileId:file.id,contentHash:file.contentHash};
   assertSafe();
  }
  await Promise.allSettled([...routes]);assertSafe();
  const after=await verifyPlainFileListStagingBinding(input);
  check(['currentOwnedStateHash','storageManifestHash','financialStateHash','preSha256','checkpointHash','expectedRevision'].every(key=>after[key]===binding[key]),'CURRENT_OWNER_STATE_CHANGED');
  receipt.status='READ_ONLY_CAPTURED';receipt.visualReviewRequired=true;receipt.ownerCertificateRevalidated=true;receipt.credentialsPersisted=false;receipt.physicalPrintSubmitted=false;
 }catch(error){receipt.status='STOP';receipt.code=fatal??safeError(error);}
 finally{await Promise.allSettled([...routes]);if(context)await context.close();if(browser)await browser.close();}
 return receipt;
}
