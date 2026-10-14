import {readFile} from 'node:fs/promises';import sharp from 'sharp';
import assert from 'node:assert/strict';import test, {before, after} from 'node:test';import {createRequire} from 'node:module';import path from 'node:path';import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve('tsx/package.json'))('esbuild'),{chromium,expect}=require('@playwright/test');
const web=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const postcss=createRequire(require.resolve('@tailwindcss/postcss'))('postcss'),tailwind=require('@tailwindcss/postcss');
const css=(async()=>{const from=path.join(web,'src/app/globals.css');return (await postcss([tailwind({base:web,optimize:true})]).process(await readFile(from,'utf8'),{from})).css;})();
let browser;
before(async()=>{browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();});
const preview={movementId:'root',planFingerprint:'a'.repeat(64),materialName:'Топливо',unit:'кг',before:{quantity:'30',value:'3000'},after:{quantity:'0',value:'0'},
 movements:[{id:'root',type:'INCOME',date:'2026-10-08T09:34:01.428Z',quantity:'37',money:'3700',productNumber:null,reason:'ROOT'},
 {id:'issue',type:'EXPENSE',date:'2026-10-08T09:35:00Z',quantity:'7',money:'700',productNumber:'201.1',reason:'STOCK'}],
 refunds:[{cashAccountId:'cash',cashName:'Основная касса',currency:'BYN',amount:'3700',bynAmount:'3700'}],projects:[{id:'project',number:'201',expenseDelta:'-700'}]};
const bundle=build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {WarehouseMovementDeleteDialog} from '@/components/warehouse-movement-delete-dialog';import {MovementsView} from '@/app/(app)/warehouse/movements/movements-view';
 function App(){const [open,setOpen]=React.useState(true),[canDelete,setCanDelete]=React.useState(true),[documents,setDocuments]=React.useState(true);window.__setCanDelete=setCanDelete;window.__hideDocuments=()=>setDocuments(false);if(window.__journal)return <MovementsView rows={documents?window.__rows:window.__rows.map(row=>({...row,reportDocument:null}))} materials={[]} showMoney canDelete={canDelete}/>;return open?<WarehouseMovementDeleteDialog movementId="root" onClose={()=>{window.__closed=true;setOpen(false)}}/>:<p>Закрыто</p>}createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:web,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',tsconfig:path.join(web,'tsconfig.json'),define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'boundaries',setup(b){
 b.onResolve({filter:/^(next\/navigation|next\/link|sonner|@\/server\/warehouse\/deletion-actions)$/},args=>({path:args.path,namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path==='next/link'?"import React from 'react';export default function Link(props){return React.createElement('a',props)}":args.path==='next/navigation'?'export const useRouter=()=>({refresh(){window.__refreshed=true}});':args.path==='sonner'?'export const toast={success(){}};':`export async function previewWarehouseMovementDeletion(){window.__previews=(window.__previews||0)+1;return {ok:true,preview:window.__preview}};
 export async function deleteWarehouseMovement(input){(window.__writes??=[]).push(input);if(window.__fail){const error=window.__fail;window.__fail=null;return {ok:false,error}}return {ok:true}};`,loader:'js',resolveDir:web}));}}],logLevel:'silent'});
async function withDialog(run){const context=await browser.newContext();try{const page=await context.newPage();page.setDefaultTimeout(5000);
 await page.route('http://delete.fixture/',async route=>route.fulfill({contentType:'text/html',body:'<style>'+await css+'</style><main id="root" class="min-w-0 p-4"></main>'}));
 await page.goto('http://delete.fixture/');await page.evaluate(p=>{window.__preview=p},preview);await page.addScriptTag({content:(await bundle).outputFiles[0].text});await page.getByText('Топливо',{exact:true}).waitFor();await run(page);
 }finally{await context.close();}}
test('confirmation lists full cascade, cash refund and project delta; cancel sends no write',async()=>{await withDialog(async page=>{
 assert.equal(await page.getByRole('listitem').count(),2);assert.match(await page.getByRole('dialog').innerText(),/3.700.*BYN/s);assert.match(await page.getByRole('dialog').innerText(),/201.*700/s);
 await page.getByRole('button',{name:'Отмена',exact:true}).click();assert.equal(await page.evaluate(()=>window.__writes?.length??0),0);
});});
test('lost response keeps UUID and preview; stale preview disables confirmation until recalculated',async()=>{await withDialog(async page=>{
 await page.evaluate(()=>{window.__fail='Ответ не получен'});await page.getByRole('button',{name:'Удалить',exact:true}).click();await page.getByRole('alert').waitFor();
 await page.evaluate(()=>{window.__fail='Склад изменился. Обновите расчёт'});await page.getByRole('button',{name:'Удалить',exact:true}).click();
 await page.waitForFunction(()=>window.__writes.length===2);const writes=await page.evaluate(()=>window.__writes);assert.deepEqual(writes[0],writes[1]);
 assert.equal(await page.getByRole('button',{name:'Удалить',exact:true}).isEnabled(),false);
 await page.getByRole('button',{name:'Обновить расчёт',exact:true}).click();await page.getByText('Топливо',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Удалить',exact:true}).click();await page.getByText('Закрыто',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.__refreshed),true);
});});

// Действующий журнал и viewer заменяют закрытые warehouse109/document97 операторы.
async function withJournal(run){
 const context=await browser.newContext({viewport:{width:1440,height:900}});
 try{
  const page=await context.newPage();page.setDefaultTimeout(5000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const image=await sharp({create:{width:640,height:360,channels:3,background:'#dbeafe'}}).png().toBuffer();
  await page.route('http://warehouse.fixture/**',async route=>{
   if(new URL(route.request().url()).pathname==='/journal')return route.fulfill({contentType:'text/html',body:'<style>'+await css+'</style><main id="root" class="min-w-0 p-4"></main>'});
   if(new URL(route.request().url()).pathname==='/api/finance/documents/report')return route.fulfill({contentType:'image/png',body:image});
   return route.abort();
  });
  await page.goto('http://warehouse.fixture/journal');
  const rows=preview.movements.map(row=>({...row,materialId:'material',materialName:'Топливо',materialUnit:'кг',quantity:Number(row.quantity),totalByn:Number(row.money),unitPrice:100,receiptKind:row.type==='INCOME'?'PAID':null,productId:row.productNumber?'product':null,createdByName:'Снабженец',createdAt:row.date,comment:'Ошибочная операция',reportDocument:row.id==='root'?{id:'report',fileName:'Отчет.png',mimeType:'image/png',source:'finance'}:null}));
  rows.push({...rows[0],id:'inventory',receiptKind:'INVENTORY',comment:'Без документа',reportDocument:null});
  await page.evaluate(values=>Object.assign(window,values),{__journal:true,__preview:preview,__rows:rows});
  await page.addScriptTag({content:(await bundle).outputFiles[0].text});await page.getByRole('row').nth(1).waitFor();await run(page);assert.deepEqual(errors,[]);
 }finally{await context.close();}
}
test('actual movement journal keeps desktop/mobile delete entry, reachable cascade controls and role revocation',async()=>{
 await withJournal(async page=>{
  assert.equal(await page.getByRole('row').nth(1).getByRole('cell').last().innerText(),'Удалить');
  await page.getByRole('row').nth(1).getByRole('button',{name:'Удалить',exact:true}).click();
  let dialog=page.getByRole('dialog');assert.equal(await dialog.getByRole('listitem').count(),2);assert.match(await dialog.innerText(),/3.700.*BYN/s);assert.match(await dialog.innerText(),/201.*700/s);
  await dialog.getByRole('button',{name:'Отмена',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>window.__writes?.length??0),0);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.getByRole('article').count(),3);
  await page.getByRole('article').filter({has:page.locator('[data-file-id="report"]')}).getByRole('button',{name:'Удалить',exact:true}).click();dialog=page.getByRole('dialog');
  assert.equal(await dialog.getByRole('listitem').count(),2);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'MOBILE_OVERFLOW');
  assert.ok(await dialog.evaluate(node=>node.querySelector('[data-slot="dialog-title"]').getBoundingClientRect().top>=node.getBoundingClientRect().top),'PREVIEW_HEADER_CLIPPED');
  for(const name of ['Отмена','Удалить']){const button=dialog.getByRole('button',{name,exact:true});await button.scrollIntoViewIfNeeded();const box=await button.boundingBox();assert.ok(box&&box.y>=0&&box.y+box.height<=844,'DELETE_FOOTER_UNREACHABLE:'+name);}
  await dialog.getByRole('button',{name:'Удалить',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>window.__writes[0].movementId),'root');
  await page.evaluate(()=>window.__setCanDelete(false));await page.waitForFunction(()=>![...document.querySelectorAll('button')].some(node=>node.textContent==='Удалить'));assert.equal(await page.getByRole('button',{name:'Удалить',exact:true}).count(),0);
 });
});
test('stock document opens byte-backed full-screen image without row activation; inventory and hidden projection expose no document',async()=>{
 await withJournal(async page=>{
  assert.equal(await page.getByRole('row').filter({hasText:'Инвентарный приход'}).getByRole('button',{name:'Отчет.png',exact:true}).count(),0);
  const open=page.getByRole('button',{name:'Отчет.png',exact:true});assert.equal(await open.count(),1);
  for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
   await page.setViewportSize(viewport);await page.getByRole('button',{name:'Отчет.png',exact:true}).click();
   const dialog=page.getByRole('dialog',{name:'Полноэкранный просмотр изображения',exact:true});await dialog.waitFor();
   const picture=dialog.getByRole('img',{name:'Отчет.png',exact:true});await page.waitForFunction(()=>document.querySelector('img[alt="Отчет.png"]')?.naturalWidth===640);
   assert.equal(await picture.evaluate(node=>node.naturalHeight),360);await expect.poll(async()=>{const box=await dialog.boundingBox();return !!box&&Math.abs(box.x)<2&&Math.abs(box.y)<2&&Math.abs(box.width-viewport.width)<2&&Math.abs(box.height-viewport.height)<2;},{message:'VIEWER_NOT_FULLSCREEN'}).toBe(true);
   assert.equal(await page.getByRole('dialog').count(),1);assert.equal(page.context().pages().length,1);assert.equal(await dialog.getByRole('button',{name:'Удалить',exact:true}).count(),0);
   await dialog.getByRole('button',{name:'Закрыть полноэкранный просмотр',exact:true}).click();await dialog.waitFor({state:'hidden'});
  }
  await page.evaluate(()=>window.__hideDocuments());await page.waitForFunction(()=>!document.querySelector('[data-file-id="report"]'));assert.equal(await page.getByRole('button',{name:'Отчет.png',exact:true}).count(),0);assert.ok(!(await page.content()).includes('data-file-id="report"'));
 });
});
