// Настоящие inline providers/controllers и поля; только transport заменён в памяти.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {KANBAN_RENDER_BINDINGS,observeKanbanRenders} from './kanban-render-observer.mjs';
import {launchCardBrowser} from './product-card-navigation-browser.mjs';
const web=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),root=path.resolve(web,'../..'),require=createRequire(path.join(web,'package.json'));
const beforeRevision='f479f46fe0bb30491f649e52a6962a5b1a7962d1',compareBefore=process.env.CRM_INLINE_COMPARE_BEFORE==='1';
const subjects=['src/components/product-inline-fields.tsx','src/components/project-inline-fields.tsx','src/components/inline-fields.tsx'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const pwRequire=createRequire(require.resolve('@playwright/test/package.json')),pwCoreRequire=createRequire(pwRequire.resolve('playwright/package.json'));
const {PNG}=pwCoreRequire(path.join(path.dirname(pwCoreRequire.resolve('playwright-core/package.json')),'lib/utilsBundle.js'));
const pixels=bytes=>{const png=PNG.sync.read(bytes);return{width:png.width,height:png.height,sha256:hash(png.data)};};
const entry=String.raw`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {ProductInlineProvider,useProductInline} from '@/components/product-inline-provider';
import {ProductInlineDetails} from '@/components/product-inline-fields';
import {ProjectInlineProvider,useProjectInline} from '@/components/project-inline-provider';
import {ProjectConfirmedTotal} from '@/components/project-inline-fields';import {InlineTextField} from '@/components/inline-fields';
import {PROJECT_SERVICE_FIELDS,projectServicePatch} from '@/lib/project-services';import {projectTotalText} from '@/lib/product-quantity';
window.__KANBAN_BODY_COUNTS__={};window.__requests=[];window.__mode='saved';window.__resolve=null;
const productInitial={title:'Изделие QA',kind:null,description:'Сохранённое описание',expectedPrice:'10.00',quantity:2,engineerId:null,'project.clientId':'qa144-client'};
const projectInitial={title:'Проект QA',managerId:null,servicesTotal:null,delivery:'20.00',unloading:'5.00',installation:null,clientId:'qa144-client','client.phone':'000','client.address':null};
const pricing={productsSubtotalBYN:'100.00',expectedTotalBYN:'125.00',pricingVersion:'1',servicesTotal:null,proposalRoundingAdjustment:'0.00',delivery:'20.00',unloading:'5.00',installation:null};
let serviceSnapshot={servicesTotal:null,delivery:'20.00',unloading:'5.00',installation:null},pricingVersion=1n;const receipts=new Map();
function savedReply(scope,input){
 const fingerprint=JSON.stringify({scope,...input}),previous=receipts.get(input.clientMutationId);
 if(previous){if(previous.fingerprint!==fingerprint)throw Error('MUTATION_REQUEST_CHANGED');return structuredClone(previous.reply);}
 const reply={kind:'saved',field:input.field,clientMutationId:input.clientMutationId,value:input.value};
 if(scope==='project'&&PROJECT_SERVICE_FIELDS.includes(input.field)){
  if(!input.expectedServices)throw Error('EXPECTED_SERVICE_SNAPSHOT_REQUIRED');
  serviceSnapshot={...serviceSnapshot,...projectServicePatch(serviceSnapshot,input.field,input.value,input.expectedServices)};
  reply.derived={...pricing,...serviceSnapshot,expectedTotalBYN:projectTotalText([{expectedPrice:'100.00',quantity:1}],serviceSnapshot),pricingVersion:String(++pricingVersion)};
 }
 receipts.set(input.clientMutationId,{fingerprint,reply});return structuredClone(reply);
}
// Услуга подтверждается полным versioned derived; lost ACK случается уже после записи receipt.
window.__save=async(scope,input)=>{window.__requests.push({scope,...structuredClone(input)});const reply=savedReply(scope,input);if(window.__mode==='hold')return await new Promise(resolve=>window.__resolve=()=>resolve(reply));if(window.__mode==='lost')throw Error('Controlled lost ACK');return reply;};
const readonly=new URLSearchParams(location.search).has('readonly');
function ProductAccess(){const{controller}=useProductInline();window.__product=controller;return<ProductInlineDetails canManage={!readonly} canEditTech={!readonly} showAmount={!readonly} currency="BYN" measurement={null} engineer={null}/>;}
function ProjectAccess(){const{controller}=useProjectInline();window.__project=controller;return<><InlineTextField id="qa-delivery" label="Доставка" controller={controller('delivery')} inputMode="decimal" readOnly={readonly}/>{!readonly?<section data-project-confirmed><ProjectConfirmedTotal/></section>:null}</>;}
function App(){const[initial,setInitial]=useState(projectInitial);window.__rsc=values=>setInitial(previous=>({...previous,...values}));return<main className="mx-auto flex max-w-4xl flex-col gap-6 p-4"><ProductInlineProvider productId="qa144-product" initial={productInitial}><ProductAccess/></ProductInlineProvider><ProjectInlineProvider projectId="qa144-project" initial={initial} stage="IN_WORK" pricingProjection={pricing}><ProjectAccess/></ProjectInlineProvider></main>;}
createRoot(document.getElementById('root')).render(<App/>);
`;
const boundaries={
 '@/lib/independent-product-action':'export const invokeProductPatch=input=>window.__save("product",input);',
 '@/lib/independent-project-action':'export const invokeProjectPatch=input=>window.__save("project",input);',
 '@/server/clients/actions':'const denied=()=>{throw Error("UNEXPECTED_CLIENT_WRITE")};export const createClient=denied;export const updateClient=denied;',
};
async function compile(variant){
 const{build}=createRequire(require.resolve('tsx/package.json'))('esbuild'),ts=require('typescript'),pins=new Map(),observed=[];
 const old=variant==='before'?new Map(subjects.slice(0,2).map(relative=>[relative,execFileSync('git',['-c','safe.directory='+root,'show',beforeRevision+':apps/web/'+relative],{cwd:root,encoding:'utf8'})])):new Map();
 const built=await build({stdin:{contents:entry,loader:'tsx',resolveDir:web},bundle:true,write:false,metafile:true,platform:'browser',format:'iife',jsx:'automatic',tsconfig:path.join(web,'tsconfig.json'),define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent',plugins:[{name:'existing-inline-memory-transport',setup(b){
  b.onResolve({filter:/^@\/(?:lib\/independent-(?:product|project)-action|server\/)/},args=>{if(Object.hasOwn(boundaries,args.path))return{path:args.path,namespace:'memory144'};assert.ok(['@/server/products/patch-contract','@/server/projects/patch-contract'].includes(args.path),'UNDECLARED_SERVER_IMPORT');});
  b.onLoad({filter:/.*/,namespace:'memory144'},args=>({contents:boundaries[args.path],loader:'ts',resolveDir:web}));
  b.onLoad({filter:/\.(?:tsx?|jsx?|mjs|cjs|json)$/,namespace:'file'},async args=>{
   const bytes=await readFile(args.path),relative=path.relative(web,args.path).split(path.sep).join('/');pins.set(args.path,hash(bytes));let source=old.get(relative)??bytes.toString('utf8');
   if(subjects.includes(relative)){const binding=KANBAN_RENDER_BINDINGS.find(x=>x.relative===relative);assert.ok(binding,'INLINE_COUNTER_BINDING_REQUIRED');const transformed=observeKanbanRenders(ts,source,binding);source=transformed.contents;observed.push(transformed);
    if(relative==='src/components/inline-fields.tsx'){const token=JSON.stringify(relative+'#InlineTextField');assert.equal(source.split(token).length-1,2);source=source.replaceAll(token,'('+token+'+":"+id)');}
   }
   const ext=path.extname(args.path);return{contents:source,loader:ext==='.tsx'?'tsx':ext==='.ts'?'ts':ext==='.json'?'json':ext==='.jsx'?'jsx':'js',resolveDir:path.dirname(args.path)};
  });
 }}]});
 assert.equal(observed.length,3);assert.equal(observed.flatMap(x=>x.bodies).length,3);assert.deepEqual(built.metafile.outputs[Object.keys(built.metafile.outputs)[0]].imports,[]);
 for(const[file,digest]of pins)assert.equal(hash(await readFile(file)),digest);
 return{bytes:Buffer.from(built.outputFiles[0].contents),pins,sha256:hash(built.outputFiles[0].contents)};
}
async function settle(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function counts(page){return page.evaluate(()=>({...window.__KANBAN_BODY_COUNTS__}));}
const detailKey='src/components/product-inline-fields.tsx#ProductInlineDetails',descriptionKey='src/components/inline-fields.tsx#InlineTextField:product-inline-description',totalKey='src/components/project-inline-fields.tsx#ProjectConfirmedTotal';

test('inline total subscriptions preserve fields and avoid unrelated renders',{timeout:120000},async()=>{
 let browser,server,failure,receipt;const directory=path.join(web,'test-results/inline-field-subscriptions',randomUUID());await mkdir(directory,{recursive:true});
 try{
  const before=compareBefore?await compile('before'):null,after=await compile('after'),postcss=createRequire(require.resolve('@tailwindcss/postcss'))('postcss'),tailwind=require('@tailwindcss/postcss');
  const css=(await postcss([tailwind({base:web})]).process(await readFile(path.join(web,'src/app/globals.css'),'utf8'),{from:path.join(web,'src/app/globals.css')})).css+'\nhtml,body{font-family:Arial,sans-serif}input,textarea{caret-color:transparent!important}';
  server=createServer((req,res)=>{const url=new URL(req.url,'http://localhost');if(req.method!=='GET'){res.writeHead(405);res.end();return;}if(url.pathname==='/app.js'){res.setHeader('content-type','text/javascript');res.end(url.searchParams.get('v')==='before'?before.bytes:after.bytes);}else if(url.pathname==='/app.css'){res.setHeader('content-type','text/css');res.end(css);}else if(url.pathname==='/'){res.setHeader('content-type','text/html');res.end('<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js?v='+url.searchParams.get('v')+'"></script></body></html>');}else{res.writeHead(404);res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;browser=await launchCardBrowser();const pw=await import('@playwright/test'),expect=pw.expect.configure({timeout:10000}),visuals=[],renders=[];
  for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:360,height:800}]){
   const captures={};for(const variant of compareBefore?['before','after']:['after']){
    const page=await browser.newPage({viewport,reducedMotion:'reduce'}),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
    try{await page.goto(origin+'/?v='+variant);await expect(page.locator('#product-inline-price')).toHaveValue('10.00');await page.evaluate(()=>document.fonts.ready);await settle(page);
     const bytes=await page.screenshot({animations:'disabled',path:path.join(directory,variant+'-'+viewport.width+'.png')});const shape=await page.evaluate(()=>[...document.querySelectorAll('main input,main textarea,main label,[data-project-confirmed],[data-product-price-quantity]')].map(n=>{const box=n.getBoundingClientRect(),style=getComputedStyle(n);return{tag:n.tagName,id:n.id,text:n.innerText??'',value:n.value??null,className:n.className,rect:{x:box.x,y:box.y,width:box.width,height:box.height},font:style.font,color:style.color,background:style.backgroundColor};}));captures[variant]={png:hash(bytes),pixels:pixels(bytes),shape};
     if(viewport.width===1440){
      const start=await counts(page),price=page.locator('#product-inline-price');await price.fill('');await price.pressSequentially('12,50',{delay:5});await expect(page.locator('[data-product-price-quantity]')).toContainText('25 BYN');await settle(page);const end=await counts(page);
      if(variant==='after'){assert.equal(end[detailKey],start[detailKey]);assert.equal(end[descriptionKey],start[descriptionKey]);}else{assert.ok(end[detailKey]>start[detailKey]);assert.ok(end[descriptionKey]>start[descriptionKey]);}renders.push({variant,scope:'product-price',start,end});
      const quantity=page.locator('#product-inline-quantity');await quantity.fill('');const qStart=await counts(page);await quantity.pressSequentially('3',{delay:5});await expect(page.locator('[data-product-price-quantity]')).toContainText('37,5 BYN');await settle(page);const qEnd=await counts(page);if(variant==='after'){assert.equal(qEnd[descriptionKey],qStart[descriptionKey]);assert.equal(qEnd[detailKey],qStart[detailKey]);}renders.push({variant,scope:'product-quantity',start:qStart,end:qEnd});
      const delivery=page.locator('#qa-delivery');await delivery.fill('');await settle(page);const dStart=await counts(page);await delivery.pressSequentially('30,50',{delay:5});await expect(page.locator('[data-project-confirmed]')).toContainText('125 BYN');await expect(page.locator('[data-project-confirmed]')).toContainText('после подтверждения');await settle(page);const dEnd=await counts(page);if(variant==='after')assert.equal(dEnd[totalKey],dStart[totalKey]);else assert.ok(dEnd[totalKey]>dStart[totalKey]);renders.push({variant,scope:'project-dirty-service',start:dStart,end:dEnd});
     }
     assert.deepEqual(errors,[]);
    }finally{await page.close();}
   }
   if(compareBefore){assert.deepEqual(captures.after.shape,captures.before.shape);assert.deepEqual(captures.after.pixels,captures.before.pixels);}visuals.push({viewport,matched:compareBefore,before:captures.before??null,after:captures.after});
  }
  const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(10000);
  try{
   await page.goto(origin+'/?v=after');const price=page.locator('#product-inline-price'),quantity=page.locator('#product-inline-quantity'),delivery=page.locator('#qa-delivery'),confirmed=page.locator('[data-project-confirmed]');
   await expect(confirmed).toContainText('125 BYN');await price.fill('');await expect(page.locator('[data-product-price-quantity]')).toContainText('—');await price.fill('0');await expect(page.locator('[data-product-price-quantity]')).toContainText('0 BYN');await price.fill('12,50');await expect(page.locator('[data-product-price-quantity]')).toContainText('25 BYN');await quantity.fill('3');await expect(page.locator('[data-product-price-quantity]')).toContainText('37,5 BYN');
   await page.evaluate(()=>window.__mode='hold');await delivery.fill('30,50');await delivery.press('Enter');await expect(page.locator('#qa-delivery-state')).toContainText('Сохраняется');
   assert.deepEqual(await page.evaluate(()=>window.__requests.at(-1).expectedServices),{servicesTotal:null,delivery:'20.00',unloading:'5.00',installation:null});
   await delivery.fill('40,00');await expect(confirmed).toContainText('125 BYN');await expect(confirmed).toContainText('после подтверждения');await page.evaluate(()=>{window.__mode='saved';window.__resolve();});await expect(delivery).toHaveValue('40,00');await expect(confirmed).toContainText('135,5 BYN');await expect(confirmed).toContainText('после подтверждения');
   assert.equal(await page.evaluate(()=>window.__project('delivery').getSnapshot().baseline),'30.50');
   await delivery.press('Enter');await expect(confirmed).toContainText('145 BYN');await expect(confirmed).not.toContainText('после подтверждения');
   assert.deepEqual(await page.evaluate(()=>window.__requests.at(-1).expectedServices),{servicesTotal:null,delivery:'30.50',unloading:'5.00',installation:null});
   await page.evaluate(()=>window.__mode='lost');await delivery.fill('50');await delivery.press('Enter');await expect(page.locator('#qa-delivery-state')).toContainText('Ответ не получен');await expect(delivery).toHaveValue('50');await expect(confirmed).toContainText('145 BYN');const uncertain=await page.evaluate(()=>window.__requests.at(-1));await page.evaluate(()=>window.__mode='saved');await page.locator('#qa-delivery-state').getByRole('button',{name:'Повторить сохранение',exact:true}).click();await expect(confirmed).toContainText('155 BYN');assert.equal(await page.evaluate(()=>window.__requests.at(-1).clientMutationId),uncertain.clientMutationId);assert.deepEqual(await page.evaluate(()=>window.__requests.at(-1)),uncertain);await expect(confirmed).not.toContainText('после подтверждения');
   await delivery.fill('60');await page.evaluate(()=>window.__rsc({delivery:'999.00'}));await expect(delivery).toHaveValue('60');await expect(confirmed).toContainText('155 BYN');
  }finally{await page.close();}
  const limited=await browser.newPage({viewport:{width:360,height:800}});try{
   await limited.goto(origin+'/?v=after&readonly=1');await expect(limited.locator('#product-inline-quantity')).toHaveAttribute('readonly','');await expect(limited.locator('#product-inline-price')).toHaveCount(0);await expect(limited.locator('[data-project-confirmed]')).toHaveCount(0);
   const beforeReadonly=await limited.evaluate(()=>[window.__product('quantity').getSnapshot(),window.__product('description').getSnapshot(),window.__project('delivery').getSnapshot()]);
   for(const [id,value]of [['product-inline-quantity','2'],['product-inline-description','Сохранённое описание'],['qa-delivery','20.00']]){
    const input=limited.locator('#'+id);await expect(input).toHaveAttribute('readonly','');await input.focus();await input.pressSequentially('999');await input.press('Enter');await input.press('Tab');await expect(input).toHaveValue(value);
   }
   assert.deepEqual(await limited.evaluate(()=>[window.__product('quantity').getSnapshot(),window.__product('description').getSnapshot(),window.__project('delivery').getSnapshot()]),beforeReadonly);
   assert.equal(await limited.evaluate(()=>window.__requests.length),0);
  }finally{await limited.close();}
  for(const compiled of [before,after].filter(Boolean))for(const[file,digest]of compiled.pins)assert.equal(hash(await readFile(file)),digest);
  receipt={status:'PASS',beforeRevision:compareBefore?beforeRevision:null,beforeComparison:compareBefore?'EXPLICIT_LOCAL':'NOT_REQUESTED',renders,visuals,contracts:['product-live-comma/null/zero','price-and-quantity-description-isolation','confirmed-dirty-service-no-render','late-ACK-keeps-draft-and-confirmed-baseline','lost-ACK-retries-identical-ID','dirty-RSC-does-not-overwrite','readonly-financial-privacy'],beforeBundle:before?.sha256??null,afterBundle:after.sha256};
 }catch(error){failure=error;}
 const cleanup=[];if(browser)try{await browser.close();}catch(error){cleanup.push(error);}if(server)try{server.closeAllConnections();await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}catch(error){cleanup.push(error);}
 if(cleanup.length)throw new AggregateError(failure?[failure,...cleanup]:cleanup,'OWN_CLEANUP_FAILED');if(failure)throw failure;
 receipt.cleanup='AWAITED';await writeFile(path.join(directory,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify({status:'INLINE_SUBSCRIPTIONS_PASS',directory,beforeComparison:receipt.beforeComparison,visualPairs:compareBefore?3:0,contracts:receipt.contracts.length}));
});
