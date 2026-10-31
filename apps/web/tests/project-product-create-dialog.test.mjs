// Реальный ProductsTab/Dialog; только Next transport заменён memory fixtures.
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
const parent='src/app/(app)/projects/[id]/products-tab.tsx',beforeRevision='c6508448450813450b5dbb6a67d77494c37f6cdb';
const compareBefore=process.env.CRM_CREATE_DIALOG_COMPARE_BEFORE==='1';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const pwRequire=createRequire(require.resolve('@playwright/test/package.json')),playwrightRequire=createRequire(pwRequire.resolve('playwright/package.json'));
const {PNG}=playwrightRequire(path.join(path.dirname(playwrightRequire.resolve('playwright-core/package.json')),'lib/utilsBundle.js'));
function pixels(bytes,region){const image=PNG.sync.read(bytes);if(!region)return{width:image.width,height:image.height,rgbaSha256:hash(image.data)};const rows=[];for(let y=region.y;y<region.bottom;y++)rows.push(image.data.subarray((y*image.width+region.x)*4,(y*image.width+region.right)*4));return{region,rgbaSha256:hash(Buffer.concat(rows))};}
function pixelDifference(a,b){const left=PNG.sync.read(a),right=PNG.sync.read(b);assert.equal(left.width,right.width);assert.equal(left.height,right.height);let changedPixels=0,maxChannelDelta=0;for(let at=0;at<left.data.length;at+=4){let changed=false;for(let c=0;c<4;c++){const delta=Math.abs(left.data[at+c]-right.data[at+c]);changed||=delta>0;maxChannelDelta=Math.max(maxChannelDelta,delta);}changedPixels+=Number(changed);}return{changedPixels,maxChannelDelta};}
const entry=String.raw`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {Toaster} from 'sonner';
import {ProductsTab} from '@/app/(app)/projects/[id]/products-tab';
window.__KANBAN_BODY_COUNTS__={};window.__creates=[];window.__refreshes=0;window.__hold=false;window.__reply={ok:true};window.__append=false;window.__moves=[];window.__nav=[];
const roles=['MANAGER'],options=[{value:'engineer-a',label:'Инженер A'},{value:'engineer-b',label:'Инженер B'}];
const data=Array.from({length:20},(_,i)=>({id:'product-'+i,number:'143.'+(i+1),title:'Изделие QA '+i,status:i%2?'PRODUCTION':'PREPARATION',statusChangedAt:'2026-10-01T00:00:00.000Z',expectedPrice:null,quantity:1,engineerName:null,engineerId:null,isEngineeringParticipant:false,hasB3d:false,noModel:true,sketchFile:null}));
function App(){const[rows,setRows]=useState(data);window.__confirmed=()=>{if(window.__append){setRows(old=>[...old,{...data[0],id:'created',number:'143.21',title:'Созданное QA'}]);window.__append=false;}};
return <main style={{padding:16}}><ProductsTab projectId="qa143" projectStage="IN_WORK" currency="BYN" initialProducts={rows} canManage actorRoles={roles} actorUserId="manager" showAmount engineerOptions={options}/><Toaster/></main>;}
createRoot(document.getElementById('root')).render(<App/>);
`;
const boundaries={
 '@/server/clients/actions':'export async function clientSelectionOptions(){return [];}export async function createClient(){throw Error("CREATE_CLIENT_OUTSIDE_TEST")}export async function updateClient(){throw Error("UPDATE_CLIENT_OUTSIDE_TEST")}',
 'next/navigation':'export const useRouter=()=>({push:p=>window.__nav.push(p),refresh:()=>{window.__refreshes++;window.__confirmed();}});',
 'next/link':"import React from 'react';export default function Link({children,...props}){return <a {...props}>{children}</a>}",
 '@/server/products/actions':'export async function createProduct(data){window.__creates.push(data);if(window.__hold)return await new Promise(resolve=>window.__resolve=resolve);return window.__reply;}export async function changeProductStatus(id,status){window.__moves.push({id,status});return {ok:false,error:"Контролируемый отказ"};}',
};
async function compile(variant){
 const ts=require('typescript'),{build}=createRequire(require.resolve('tsx/package.json'))('esbuild'),pins=new Map(),observed=[];
 const original=variant==='before'?execFileSync('git',['-c','safe.directory='+root,'show',beforeRevision+':apps/web/'+parent],{cwd:root,encoding:'utf8'}):null;
 const built=await build({stdin:{contents:entry,loader:'tsx',resolveDir:web},bundle:true,write:false,metafile:true,platform:'browser',format:'iife',jsx:'automatic',tsconfig:path.join(web,'tsconfig.json'),define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent',plugins:[{name:'existing-memory-boundaries',setup(b){
  b.onResolve({filter:/^(?:next\/|@\/server\/)/},args=>{assert.ok(Object.hasOwn(boundaries,args.path),'UNDECLARED_SERVER_BOUNDARY');return{path:args.path,namespace:'memory143'};});
  b.onLoad({filter:/.*/,namespace:'memory143'},args=>({contents:boundaries[args.path],loader:'tsx',resolveDir:web}));
  b.onLoad({filter:/\.(?:tsx?|jsx?|mjs|cjs|json)$/,namespace:'file'},async args=>{
   const bytes=await readFile(args.path),relative=path.relative(web,args.path).split(path.sep).join('/');pins.set(args.path,hash(bytes));
   let text=relative===parent&&variant==='before'?original:bytes.toString('utf8'),binding=[parent,'src/components/product-kanban-card.tsx'].includes(relative)?KANBAN_RENDER_BINDINGS.find(item=>item.relative===relative):undefined;
   if(binding){const transformed=observeKanbanRenders(ts,text,binding);text=transformed.contents;observed.push(transformed);}
   const ext=path.extname(args.path);return{contents:text,loader:ext==='.tsx'?'tsx':ext==='.ts'?'ts':ext==='.json'?'json':ext==='.jsx'?'jsx':'js',resolveDir:path.dirname(args.path)};
  });
 }}]});
 assert.equal(observed.length,2);assert.equal(observed.flatMap(item=>item.bodies).length,4);
 for(const[file,expected]of pins)assert.equal(hash(await readFile(file)),expected);
 return{bytes:Buffer.from(built.outputFiles[0].contents),pins,observed,sha256:hash(built.outputFiles[0].contents)};
}
async function frames(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function values(page){return page.evaluate(()=>Object.fromEntries(['title','kind','price','quantity','description'].map(k=>[k,document.getElementById('product-'+k)?.value??null])));}
async function cards(page){return page.evaluate(()=>Object.fromEntries(Object.entries(window.__KANBAN_BODY_COUNTS__).filter(([key])=>/#(?:ProductsTab|StatusColumn|DraggableProduct|ProductKanbanCard)$/.test(key))));}
async function reset(page){await page.getByRole('button',{name:'Закрыть',exact:true}).click();await page.getByRole('button',{name:'Изделие',exact:true}).click();await page.getByRole('dialog').waitFor({state:'visible'});}
test('create-product form isolates real mini-kanban and preserves lifecycle',{timeout:180000},async()=>{
 let browser,server,failure,receipt;const directory=path.join(web,'test-results/create-product-dialog',randomUUID());await mkdir(directory,{recursive:true});
 try{
  const before=compareBefore?await compile('before'):null,after=await compile('after'),postcss=createRequire(require.resolve('@tailwindcss/postcss'))('postcss'),tailwind=require('@tailwindcss/postcss');
  const css=(await postcss([tailwind({base:web})]).process(await readFile(path.join(web,'src/app/globals.css'),'utf8'),{from:path.join(web,'src/app/globals.css')})).css+'\nhtml,body{font-family:Arial,sans-serif}input,textarea{caret-color:transparent!important}';
  server=createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname;if(req.method!=='GET'){res.writeHead(405);res.end();return;}if(name==='/app.css'){res.setHeader('content-type','text/css');res.end(css);}else if(name==='/app.js'){res.setHeader('content-type','text/javascript');res.end(new URL(req.url,'http://localhost').searchParams.get('v')==='before'?before.bytes:after.bytes);}else{res.setHeader('content-type','text/html');res.end('<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js?v='+new URL(req.url,'http://localhost').searchParams.get('v')+'"></script></body></html>');}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;browser=await launchCardBrowser();const pw=await import('@playwright/test'),expect=pw.expect.configure({timeout:10000}),visuals=[],counts=[];
  for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:360,height:800}]){
   const captures={};for(const variant of compareBefore?['before','after']:['after']){
    const page=await browser.newPage({viewport,reducedMotion:'reduce'}),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
    try{await page.goto(origin+'/?v='+variant);await expect(page.locator('[data-slot="product-kanban-card"]')).toHaveCount(20);await page.evaluate(()=>document.fonts.ready);await frames(page);
     const closed=await page.screenshot({animations:'disabled',path:path.join(directory,variant+'-closed-'+viewport.width+'.png')});
     await page.getByRole('button',{name:'Изделие',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.waitForTimeout(200);
     const shape=await page.getByRole('dialog').evaluate(n=>{const r=n.getBoundingClientRect(),style=getComputedStyle(n);return{text:n.innerText,inputs:[...n.querySelectorAll('input,textarea')].map(x=>({id:x.id,type:x.type,value:x.value,placeholder:x.placeholder,className:x.className})),controls:[...n.querySelectorAll('label,input,textarea,button')].map(x=>{const box=x.getBoundingClientRect(),css=getComputedStyle(x);return{tag:x.tagName,text:x.innerText??'',className:x.className,rect:{x:box.x,y:box.y,width:box.width,height:box.height},style:{font:css.font,color:css.color,background:css.backgroundColor,border:css.border,radius:css.borderRadius}};}),rect:{x:r.x,y:r.y,width:r.width,height:r.height},contentRegion:{x:Math.ceil(r.x+parseFloat(style.paddingLeft)),y:Math.ceil(r.y+parseFloat(style.paddingTop)),right:Math.min(innerWidth,Math.floor(r.right-parseFloat(style.paddingRight))),bottom:Math.min(innerHeight,Math.floor(r.bottom-parseFloat(style.paddingBottom)))}};});
     const opened=await page.screenshot({path:path.join(directory,variant+'-open-'+viewport.width+'.png')});captures[variant]={closed:hash(closed),opened:hash(opened),closedPixels:pixels(closed),openPixels:pixels(opened),contentPixels:pixels(opened,shape.contentRegion),shape};
     if(viewport.width===1440){
      const start=await cards(page);
      for(const[id,text]of [['title','Новая позиция QA'],['description','Описание QA'],['price','100'],['quantity','3']]){const field=page.locator('#product-'+id);await field.fill('');await field.pressSequentially(text,{delay:5});assert.deepEqual(await field.evaluate(n=>({value:n.value,active:document.activeElement===n,caret:n.selectionStart})),{value:text,active:true,caret:id==='price'?null:text.length});}
      await frames(page);await page.waitForTimeout(150);const end=await cards(page);counts.push({variant,start,end});
      for(const key of Object.keys(start))if(variant==='after')assert.equal(end[key],start[key],'UNCHANGED_AUTHORED_BODY_RERENDERED:'+key);else assert.ok(end[key]>start[key],'BEFORE_POSITIVE_COUNTER_REQUIRED');
     }
     assert.deepEqual(errors,[]);
    }finally{await page.close();}
   }
   visuals.push({viewport,before:captures.before??null,after:captures.after,wholeImageDifference:compareBefore?pixelDifference(await readFile(path.join(directory,'before-open-'+viewport.width+'.png')),await readFile(path.join(directory,'after-open-'+viewport.width+'.png'))):null});
  }
  const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});page.setDefaultTimeout(10000);
  try{
   await page.goto(origin+'/?v=after');await page.getByRole('button',{name:'Изделие',exact:true}).click();const submit=page.getByRole('button',{name:'Создать изделие',exact:true});
   await expect(submit).toBeDisabled();await page.locator('#product-title').fill('  Новое QA  ');await page.locator('#product-kind').fill(' Шкаф ');await page.locator('#product-quantity').fill('0');await expect(submit).toBeDisabled();await page.locator('#product-quantity').fill('2147483648');await expect(submit).toBeDisabled();await page.locator('#product-quantity').fill('3');await page.locator('#product-price').fill('-1');await expect(submit).toBeDisabled();await page.locator('#product-price').fill('100.25');await page.locator('#product-description').fill('технический QA');
   await page.getByRole('button',{name:'не назначен',exact:true}).click();await page.getByRole('button',{name:'Инженер A',exact:true}).click();const drafted=await values(page);
   await page.getByRole('button',{name:'Отмена',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await page.getByRole('button',{name:'Изделие',exact:true}).click();assert.deepEqual(await values(page),drafted);await expect(page.getByRole('button',{name:'Инженер A',exact:true})).toBeVisible();
   await page.evaluate(()=>window.__reply={ok:false,error:'Ошибка QA'});await submit.click();await expect.poll(()=>page.evaluate(()=>window.__creates.length)).toBe(1);await expect(submit).toBeEnabled();assert.deepEqual(await values(page),drafted);assert.equal(await page.evaluate(()=>window.__refreshes),0);
   const payload=await page.evaluate(()=>window.__creates[0]);assert.equal(payload.title,'Новое QA');assert.equal(payload.kind,'Шкаф');assert.equal(payload.quantity,3);assert.equal(payload.expectedPrice,100.25);assert.equal(payload.engineerId,'engineer-a');
   await reset(page);assert.deepEqual(await values(page),{title:'',kind:'',price:'',quantity:'1',description:''});await expect(page.getByRole('button',{name:'не назначен',exact:true})).toBeVisible();
   await page.locator('#product-title').fill('Успешное QA');await page.getByRole('button',{name:'не назначен',exact:true}).click();await page.getByRole('button',{name:'Инженер B',exact:true}).click();await page.evaluate(()=>{window.__reply={ok:true};window.__append=true;});await submit.click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect.poll(()=>page.evaluate(()=>window.__refreshes)).toBe(1);await expect(page.locator('[data-slot="product-kanban-card"]')).toHaveCount(21);
   await page.getByRole('button',{name:'Изделие',exact:true}).click();assert.deepEqual(await values(page),{title:'',kind:'',price:'',quantity:'1',description:''});await expect(page.getByRole('button',{name:'Инженер B',exact:true})).toBeVisible();
   await page.locator('#product-title').fill('Поздний QA');await page.evaluate(()=>window.__hold=true);await submit.click();await expect(page.getByRole('button',{name:'Создание…',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Отмена',exact:true}).click();await page.getByRole('button',{name:'Изделие',exact:true}).click();await page.locator('#product-title').fill('Новый черновик');await page.evaluate(()=>{window.__hold=false;window.__resolve({ok:false,error:'Поздняя ошибка'});});await expect(submit).toBeEnabled();await expect(page.locator('#product-title')).toHaveValue('Новый черновик');
   await page.evaluate(()=>window.__hold=true);await submit.click();await page.getByRole('button',{name:'Отмена',exact:true}).click();await page.getByRole('button',{name:'Изделие',exact:true}).click();await page.locator('#product-title').fill('Ещё черновик');await page.evaluate(()=>{window.__hold=false;window.__resolve({ok:true});});await expect(page.getByRole('dialog')).toHaveCount(0);
  }finally{await page.close();}
  if(compareBefore)for(const pair of visuals){assert.deepEqual(pair.after.shape,pair.before.shape);assert.deepEqual(pair.after.closedPixels,pair.before.closedPixels,'CLOSED_PIXELS_CHANGED');assert.deepEqual(pair.after.contentPixels,pair.before.contentPixels,'DIALOG_CONTENT_PIXELS_CHANGED');assert.ok(pair.wholeImageDifference.maxChannelDelta<=3,'OUTSIDE_KNOWN_SHADOW_VARIANCE');pair.contentMatched=true;pair.wholePixelsEqual=pair.wholeImageDifference.changedPixels===0;}
  for(const pack of [before,after].filter(Boolean))for(const[file,digest]of pack.pins)assert.equal(hash(await readFile(file)),digest);
  receipt={status:'PASS',beforeRevision:compareBefore?beforeRevision:null,beforeComparison:compareBefore?'EXPLICIT_LOCAL':'NOT_REQUESTED',sourceScope:'actual ProductsTab/CreateProductDialog with memory Next actions; no DB/full Next/iMac claim',counts,visuals,lifecycle:['validation','footer-cancel-keeps-drafts','X-clears-six','server-error-keeps-input','success-one-refresh-one-row','success-keeps-engineer','late-error-keeps-new-draft','late-success-closes-reopened'],beforeBundle:before?.sha256??null,afterBundle:after.sha256};
 }catch(error){failure=error;}
 const cleanup=[];if(browser)try{await browser.close();}catch(error){cleanup.push(error);}if(server)try{server.closeAllConnections();await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}catch(error){cleanup.push(error);}
 if(cleanup.length)throw new AggregateError(failure?[failure,...cleanup]:cleanup,'OWN_RESOURCES_CLOSE_FAILED');if(failure)throw failure;
 receipt.cleanup='AWAITED';await writeFile(path.join(directory,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify({status:'CREATE_DIALOG_ISOLATION_PASS',directory,visualPairs:compareBefore?6:0,lifecycle:receipt.lifecycle.length}));
});
