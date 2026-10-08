import assert from 'node:assert/strict';import test from 'node:test';import {createRequire} from 'node:module';import path from 'node:path';import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve('tsx/package.json'))('esbuild'),{chromium}=require('@playwright/test');
const web=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const preview={movementId:'root',planFingerprint:'a'.repeat(64),materialName:'Топливо',unit:'кг',before:{quantity:'30',value:'3000'},after:{quantity:'0',value:'0'},
 movements:[{id:'root',type:'INCOME',date:'2026-10-08T09:34:01.428Z',quantity:'37',money:'3700',productNumber:null,reason:'ROOT'},
 {id:'issue',type:'EXPENSE',date:'2026-10-08T09:35:00Z',quantity:'7',money:'700',productNumber:'201.1',reason:'STOCK'}],
 refunds:[{cashAccountId:'cash',cashName:'Основная касса',currency:'BYN',amount:'3700',bynAmount:'3700'}],projects:[{id:'project',number:'201',expenseDelta:'-700'}]};
const bundle=build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {WarehouseMovementDeleteDialog} from '@/components/warehouse-movement-delete-dialog';
 function App(){const [open,setOpen]=React.useState(true);return open?<WarehouseMovementDeleteDialog movementId="root" onClose={()=>{window.__closed=true;setOpen(false)}}/>:<p>Закрыто</p>}createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:web,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',tsconfig:path.join(web,'tsconfig.json'),define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'boundaries',setup(b){
 b.onResolve({filter:/^(next\/navigation|sonner|@\/server\/warehouse\/deletion-actions)$/},args=>({path:args.path,namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path==='next/navigation'?'export const useRouter=()=>({refresh(){window.__refreshed=true}});':args.path==='sonner'?'export const toast={success(){}};':`export async function previewWarehouseMovementDeletion(){window.__previews=(window.__previews||0)+1;return {ok:true,preview:window.__preview}};
 export async function deleteWarehouseMovement(input){(window.__writes??=[]).push(input);if(window.__fail){const error=window.__fail;window.__fail=null;return {ok:false,error}}return {ok:true}};`,loader:'js'}));}}],logLevel:'silent'});
async function withDialog(run){const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();page.setDefaultTimeout(5000);
 await page.route('http://delete.fixture/',route=>route.fulfill({contentType:'text/html',body:'<style>.z-50{z-index:50}.isolate{isolation:isolate}[data-slot=dialog-content]{position:relative;z-index:50}</style><div id="root"></div>'}));
 await page.goto('http://delete.fixture/');await page.evaluate(p=>{window.__preview=p},preview);await page.addScriptTag({content:(await bundle).outputFiles[0].text});await page.getByText('Топливо',{exact:true}).waitFor();await run(page);
 }finally{await browser.close();}}
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
