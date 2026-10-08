/** Opt-in read-only staging QA 114. Import never starts a browser or creates files. */
import {chromium, expect} from '@playwright/test';
import {mkdir, realpath, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const KANBAN_STAGING_ORIGIN='https://staging-crm.peromebel.by';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const VIEWPORTS=[{width:1440,height:900},{width:390,height:844},{width:360,height:800}];
const STATIC_PATHS=new Set(['/favicon.ico','/icon.svg','/apple-icon.png','/manifest.webmanifest','/sw.js']);
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const number=value=>typeof value==='string'&&/^[A-Za-z0-9_.-]{1,128}$/.test(value);
const sameRoles=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length>0&&[...a].sort().join('|')===[...b].sort().join('|');
function requireThat(ok,code){if(!ok)throw Error(code);}

/** Run before app boot: an unsupported API lets Serwist skip registration instead of consuming Playwright's void stub. */
export function disableKanbanQaServiceWorkerApi(){
 let owner=navigator;
 while(owner){
  const descriptor=Object.getOwnPropertyDescriptor(owner,'serviceWorker');
  if(descriptor){
   if(!descriptor.configurable||!Reflect.deleteProperty(owner,'serviceWorker'))throw Error('K114_SW_API_DISABLE_FAILED');
   break;
  }
  owner=Object.getPrototypeOf(owner);
 }
 if('serviceWorker' in navigator)throw Error('K114_SW_API_DISABLE_FAILED');
}

/** The existing 112 stage bridge verifies the checkpoint HMAC and physical target before returning this private handoff. */
export function validateKanbanStagingHandoff(input={}){
 const {authorized,origin,expectedRevision,identity,checkpoint,profile,ownedPaths,currentSketchFileId}=input;
 requireThat(authorized===true,'K114_ROOT_AUTH_REQUIRED');
 requireThat(origin===KANBAN_STAGING_ORIGIN,'K114_STAGING_ORIGIN_REQUIRED');
 requireThat(/^[a-f0-9]{40}$/.test(expectedRevision??'')&&identity?.hostname==='crm-staging'&&identity.revision===expectedRevision,'K114_PHYSICAL_REVISION_MISMATCH');
 requireThat(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(checkpoint?.runId??'')&&checkpoint.revision===expectedRevision&&/^[a-f0-9]{64}$/.test(checkpoint.signature??''),'K114_CHECKPOINT_BINDING_REQUIRED');
 requireThat(id(checkpoint.ids?.product)&&id(checkpoint.ids?.project)&&number(checkpoint.productNumber)&&number(checkpoint.number),'K114_OWNED_SUBJECTS_REQUIRED');
 const manager=checkpoint.actors?.manager;
 requireThat(id(manager?.id)&&profile?.id===manager.id&&sameRoles(profile.roles,manager.roles)&&profile.roles.includes('MANAGER'),'K114_OWN_MANAGER_MISMATCH');
 const paths={product:`/products/${encodeURIComponent(checkpoint.productNumber)}`,project:`/projects/${encodeURIComponent(checkpoint.ids.project)}`};
 requireThat(ownedPaths?.product===paths.product&&ownedPaths?.project===paths.project,'K114_OWNED_PATHS_MISMATCH');
 requireThat(id(currentSketchFileId),'K114_CURRENT_OWN_SKETCH_REQUIRED');
 requireThat(Array.isArray(profile.cookies)&&profile.cookies.length>0&&profile.cookies.length<=2,'K114_PRIVATE_COOKIES_REQUIRED');
 const names=new Set();
 const cookies=profile.cookies.map(cookie=>{
  requireThat(['authjs.session-token','__Secure-authjs.session-token'].includes(cookie?.name)&&!names.has(cookie.name)&&typeof cookie.value==='string'&&cookie.value.length>0&&cookie.value.length<8192,'K114_SESSION_COOKIE_INVALID');
  requireThat((cookie.url===undefined||cookie.url===origin)&&(cookie.domain===undefined||cookie.domain==='staging-crm.peromebel.by')&&(cookie.path===undefined||cookie.path==='/')&&(cookie.secure===undefined||cookie.secure===true)&&(cookie.httpOnly===undefined||cookie.httpOnly===true),'K114_COOKIE_SCOPE_MISMATCH');
  names.add(cookie.name);
  return{name:cookie.name,value:cookie.value,url:origin,httpOnly:true,secure:true,sameSite:'Lax'};
 });
 requireThat(!input.basicAuth||(typeof input.basicAuth.username==='string'&&typeof input.basicAuth.password==='string'),'K114_PRIVATE_BASIC_AUTH_INVALID');
 return{origin,expectedRevision,runId:checkpoint.runId,paths,productNumber:checkpoint.productNumber,projectId:checkpoint.ids.project,currentSketchFileId,managerId:manager.id,roles:[...profile.roles],cookies};
}

function staticImageUrl(url){
 const source=url.searchParams.get('url');
 if(!source?.startsWith('/')||source.startsWith('//'))return false;
 const nested=new URL(source,KANBAN_STAGING_ORIGIN);
 return nested.origin===KANBAN_STAGING_ORIGIN&&(STATIC_PATHS.has(nested.pathname)||nested.pathname.startsWith('/icons/'));
}

/** Decisions contain no URL, source/id, headers or response body and are safe for aggregate evidence. */
export function kanbanReadonlyRequest({url,method,prefetch=false},binding){
 let parsed;try{parsed=new URL(url);}catch{return{kind:'deny',code:'K114_INVALID_REQUEST_URL'};}
 if(parsed.origin!==binding.origin||parsed.username||parsed.password)return{kind:'deny',code:'K114_CROSS_ORIGIN_REQUEST'};
 const p=parsed.pathname,boards=p==='/products'||p==='/projects',own=p===binding.paths.product||p===binding.paths.project;
 if(!['GET','HEAD'].includes(method))return{kind:boards||own?'abort-non-read':'deny',code:boards||own?'K114_NON_READ_BLOCKED':'K114_UNEXPECTED_MUTATION_ROUTE'};
 if(prefetch)return{kind:'abort-prefetch',code:'K114_PREFETCH_BLOCKED'};
 const fixed=STATIC_PATHS.has(p)||p==='/api/health'||p==='/api/auth/session';
 const assets=p.startsWith('/_next/static/')||p.startsWith('/icons/')||(p==='/_next/image'&&staticImageUrl(parsed));
 const image=/^\/api\/files\/[A-Za-z0-9_-]{1,128}$/.test(p)&&(!parsed.search||[...parsed.searchParams].every(([key,value])=>key==='preview'&&['card','cover','thumbnail'].includes(value)));
 if(!(boards||own||fixed||assets||image))return{kind:'deny',code:'K114_GET_ROUTE_FORBIDDEN'};
 if(boards){
  const keys=p==='/products'?new Set(['view','project','active','_rsc']):new Set(['view','active','_rsc']);
  if([...parsed.searchParams].some(([key,value])=>!keys.has(key)||(key==='view'&&value!=='kanban')||(key==='project'&&value!==binding.projectId)||(key==='active'&&!['0','1'].includes(value))))return{kind:'deny',code:'K114_BOARD_QUERY_FORBIDDEN'};
 }
 if(own&&[...parsed.searchParams].some(([key,value])=>key!=='_rsc'&&(key!=='tab'||p!==binding.paths.project||value!=='products')))return{kind:'deny',code:'K114_DETAIL_QUERY_FORBIDDEN'};
 return{kind:'continue',method};
}

export function kanbanCoverGeometryValid(m){
 return m?.loaded===true&&m.width>0&&Math.abs(m.height-m.width*4/3)<1&&m.fit==='cover'&&m.position==='50% 50%'&&['top','right','bottom','left'].every(key=>Math.abs(m.gaps?.[key]??Infinity)<1);
}
function aspectCategory(ratio){return ratio>1.05?'landscape':ratio<0.95?'portrait':'square';}
async function geometry(img,frame){
 const image=await img.evaluate(node=>{const r=node.getBoundingClientRect(),style=getComputedStyle(node);return{width:r.width,height:r.height,x:r.x,y:r.y,loaded:node.complete&&node.naturalWidth>0,naturalRatio:node.naturalWidth/node.naturalHeight,fit:style.objectFit,position:style.objectPosition};});
 const parent=await frame.boundingBox();requireThat(parent,'K114_IMAGE_FRAME_MISSING');
 return{width:image.width,height:image.height,loaded:image.loaded,fit:image.fit,position:image.position,naturalAspect:aspectCategory(image.naturalRatio),gaps:{left:image.x-parent.x,top:image.y-parent.y,right:parent.x+parent.width-image.x-image.width,bottom:parent.y+parent.height-image.y-image.height}};
}
function safeCode(error){return /^K114_[A-Z0-9_]+$/.test(error?.message??'')?error.message:'K114_BROWSER_CHECK_FAILED';}

/** No session prepare/restore, JWT minting, DB/storage access, writes, login, downloads, trace/HAR or storageState. */
export async function runKanbanCoverStagingBrowser(input={}){
 const binding=validateKanbanStagingHandoff(input);
 const root=await realpath(ROOT),base=await realpath(path.join(ROOT,'.playwright-mcp','kanban114'));
 const relativeBase=path.relative(root,base);requireThat(relativeBase&&!relativeBase.startsWith('..')&&!path.isAbsolute(relativeBase),'K114_EVIDENCE_BASE_MISMATCH');
 const directory=path.join(base,`staging-${binding.runId}-${Date.now()}`);
 await mkdir(directory,{recursive:false,mode:0o700});
 const actual=await realpath(directory),relative=path.relative(base,actual);
 requireThat(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'K114_EVIDENCE_PATH_MISMATCH');
 const receipt={status:'STARTED',revision:binding.expectedRevision,revisionProof:'caller reviewed physical qaTransport identity; health checked separately',origin:binding.origin,runId:binding.runId,mode:'GET/HEAD only; unsupported SW API in isolated QA; existing project numeric geometry is not pixel proof',checks:[],projectGeometry:[],blockedNonReads:0,blockedPrefetches:0,deniedReads:0,upstreamNonReadResponses:0,screenshots:[],pageErrorCount:0};
 let browser,phase='browser-setup',context;
 async function persist(){await writeFile(path.join(directory,'receipt.json'),JSON.stringify(receipt,null,2),{mode:0o600});}
 try{
  browser=await chromium.launch({headless:true,channel:'chromium'});
  for(const viewport of VIEWPORTS){
   context=await browser.newContext({viewport,locale:'ru-RU',timezoneId:'Europe/Moscow',serviceWorkers:'block',ignoreHTTPSErrors:false,...(input.basicAuth?{httpCredentials:input.basicAuth}:{})});
   await context.addInitScript(disableKanbanQaServiceWorkerApi);
   await context.route('**/*',async route=>{
    const request=route.request(),decision=kanbanReadonlyRequest({url:request.url(),method:request.method(),prefetch:Boolean(request.headers()['next-router-prefetch']||request.headers().purpose==='prefetch')},binding);
    if(decision.kind==='continue'){await route.continue();return;}
    if(decision.kind==='abort-non-read')receipt.blockedNonReads++;else if(decision.kind==='abort-prefetch')receipt.blockedPrefetches++;else receipt.deniedReads++;
    await route.abort('blockedbyclient');
   });
   context.on('response',response=>{if(!['GET','HEAD'].includes(response.request().method()))receipt.upstreamNonReadResponses++;});
   await context.addCookies(binding.cookies);
   phase='session-health';
   const health=await context.request.get(`${binding.origin}/api/health`,{maxRedirects:0});requireThat(health.status()===200,'K114_HEALTH_FAILED');
   const healthBody=await health.json();requireThat(healthBody.status==='ok'&&healthBody.database==='ok','K114_HEALTH_DEGRADED');
   const sessionResponse=await context.request.get(`${binding.origin}/api/auth/session`,{maxRedirects:0});requireThat(sessionResponse.status()===200,'K114_SESSION_HTTP_FAILED');
   const session=await sessionResponse.json();requireThat(session.user?.id===binding.managerId&&sameRoles(session.user.roles,binding.roles),'K114_CURRENT_SESSION_MISMATCH');
   const page=await context.newPage();page.on('pageerror',()=>receipt.pageErrorCount++);
   async function goto(route){
    const response=await page.goto(`${binding.origin}${route}`,{waitUntil:'domcontentloaded'});requireThat(response?.status()===200&&new URL(page.url()).origin===binding.origin,'K114_NAVIGATION_FAILED');
    const sw=await page.evaluate(()=>({apiAbsent:!('serviceWorker' in navigator),serwistAbsent:typeof window.serwist==='undefined'}));
    requireThat(sw.apiAbsent&&sw.serwistAbsent&&context.serviceWorkers().length===0,'K114_SW_API_DISABLE_FAILED');
   }
   async function ownCardProof(label){
    const card=page.locator('[data-slot="product-kanban-card"]').filter({has:page.getByText(binding.productNumber,{exact:true})});await expect(card).toHaveCount(1);
    const frame=card.locator('[data-slot="product-kanban-image"]'),img=frame.locator('img');await img.scrollIntoViewIfNeeded();await expect.poll(()=>img.evaluate(node=>node.complete&&node.naturalWidth>0)).toBe(true);
    requireThat(await img.getAttribute('src')===`/api/files/${binding.currentSketchFileId}?preview=card`,'K114_OWN_SKETCH_CHANGED');
    const measured=await geometry(img,frame);requireThat(kanbanCoverGeometryValid(measured),'K114_OWN_COVER_GEOMETRY_FAILED');
    const file=path.join(directory,`${label}-${viewport.width}.png`);await frame.screenshot({path:file});receipt.screenshots.push(file);receipt.checks.push({kind:label,viewport:viewport.width,metrics:measured});
   }
   phase='own-products-board';await goto(`/products?view=kanban&project=${encodeURIComponent(binding.projectId)}&active=0`);await ownCardProof('own-product-board');
   phase='own-nested-board';await goto(`${binding.paths.project}?tab=products`);await ownCardProof('own-product-nested');
   phase='own-detail';await goto(binding.paths.product);
   const detail=page.locator('[data-slot="product-cover-image"]'),detailImg=detail.locator('img');await detailImg.scrollIntoViewIfNeeded();await expect.poll(()=>detailImg.evaluate(node=>node.complete&&node.naturalWidth>0)).toBe(true);
   requireThat(await detailImg.getAttribute('src')===`/api/files/${binding.currentSketchFileId}?preview=cover`,'K114_DETAIL_SKETCH_CHANGED');
   const detailMetrics=await geometry(detailImg,detail);requireThat(detailMetrics.fit==='contain','K114_DETAIL_CROP_FORBIDDEN');
   const detailFile=path.join(directory,`own-detail-${viewport.width}.png`);await detail.screenshot({path:detailFile});receipt.screenshots.push(detailFile);receipt.checks.push({kind:'own-detail-contain',viewport:viewport.width,metrics:detailMetrics});
   phase='existing-project-geometry';await goto('/projects?view=kanban&active=0');
   // Structural cover-presence selection only. No project text/id/src/body or screenshot is read/exported.
   const projectImages=page.locator('[data-slot="project-kanban-card"] img');await expect.poll(()=>projectImages.count(),{timeout:20000}).toBeGreaterThan(0);
   const count=Math.min(await projectImages.count(),3),samples=[];
   for(let index=0;index<count;index++){
    const img=projectImages.nth(index);await img.scrollIntoViewIfNeeded();
    try{await expect.poll(()=>img.evaluate(node=>node.complete&&node.naturalWidth>0),{timeout:10000}).toBe(true);}catch{samples.push({loaded:false});continue;}
    const metrics=await geometry(img,img.locator('..'));requireThat(kanbanCoverGeometryValid(metrics),'K114_PROJECT_COVER_GEOMETRY_FAILED');samples.push(metrics);
   }
   requireThat(samples.some(sample=>sample.loaded),'K114_PROJECT_SAMPLE_UNAVAILABLE');receipt.projectGeometry.push({viewport:viewport.width,samples,proof:'actual geometry and computed CSS; no existing-content pixel screenshot'});
   requireThat(context.serviceWorkers().length===0&&receipt.deniedReads===0&&receipt.upstreamNonReadResponses===0,'K114_READONLY_TRANSPORT_VIOLATION');
   const finalSession=await context.request.get(`${binding.origin}/api/auth/session`,{maxRedirects:0});requireThat(finalSession.status()===200&&(await finalSession.json()).user?.id===binding.managerId,'K114_SESSION_EXPIRED');
   await context.close();context=null;
  }
  requireThat(receipt.pageErrorCount===0,'K114_CLIENT_ERROR_OBSERVED');receipt.status='PASS';
 }catch(error){receipt.status='STOP';receipt.phase=phase;receipt.code=safeCode(error);}
 finally{if(context)await context.close();if(browser)await browser.close();await persist();}
 return receipt;
}