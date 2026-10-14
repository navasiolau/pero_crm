import assert from 'node:assert/strict';
import test, {before, after} from 'node:test';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve('tsx/package.json'))('esbuild'),{chromium}=require('@playwright/test');
const web=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let browser;
before(async()=>{browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();});
const bundle=build({stdin:{contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';
 import {MaterialsTab} from '@/app/(app)/projects/[id]/materials-tab';
 const material={id:'m',name:'Петля',sku:null,unit:'шт',purchasePrice:20,stock:5};
 const legacy={id:'line',materialId:'m',materialName:'Петля',materialSku:null,unit:'шт',purchasePrice:20,quantityPerUnit:2,quantity:2,issuedQty:4,debt:0,available:5,status:'FULFILLED',comment:null,warehouseReady:true,returnSources:[],legacyReturnQuantity:1};
 function Harness(){
  const [sources,setSources]=React.useState(window.__legacy?[]:[{id:'issue',materialId:'m',materialName:'Петля',unit:'шт',createdAt:'2026-10-08T00:00:00Z',quantity:3,unitPrice:'20.000000001'}]);
  window.__removeSources=()=>setSources([]);
  return <MaterialsTab productId="p" lines={window.__legacy?[legacy]:[]} movements={[]} options={[]} issueOptions={[material]} returnSources={sources} warehouseReady={true} materialsTotalByn={60} canManage={false} canIssueReturn={true} showMoney={true}/>;
 }
 createRoot(document.getElementById('root')).render(<Harness/>);
 `,resolveDir:web,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',tsconfig:path.join(web,'tsconfig.json'),define:{'process.env.NODE_ENV':'"production"'},
 plugins:[{name:'boundary',setup(b){
 b.onResolve({filter:/^(sonner|@\/server\/warehouse\/actions)$/},args=>({path:args.path,namespace:'qa'}));
 b.onLoad({filter:/.*/,namespace:'qa'},args=>({loader:'js',contents:args.path==='sonner'?'export const toast={error(){},success(){}};':
 'export const requestMaterial=async input=>{window.__requests.push(input);return{ok:false,error:"retry"}};export const returnMaterial=async input=>{window.__returns.push(input);return{ok:false,error:"retry"}};export const addProjectMaterial=async()=>({ok:true});export const updateProjectMaterial=async()=>({ok:true});export const deleteProjectMaterial=async()=>({ok:true});'}));
 }}],logLevel:'silent'});
async function withPage(legacy,run){
 const built=await bundle,context=await browser.newContext();
 try{
  const page=await context.newPage();page.setDefaultTimeout(5000);
  await page.route('http://localhost:3199/stock',route=>route.fulfill({contentType:'text/html',body:'<style>.z-50{z-index:50}.isolate{isolation:isolate}[data-slot=dialog-content]{position:relative;z-index:50}</style><div id="root"></div>'}));
  await page.goto('http://localhost:3199/stock');
  await page.evaluate(value=>{window.__legacy=value;window.__requests=[];window.__returns=[]},legacy);
  await page.addScriptTag({content:built.outputFiles[0].text});
  await page.getByRole('button',{name:'Выдать материал',exact:true}).waitFor();await run(page);
 }finally{await context.close();}
}
test('procurement issues without a need; quantity is bounded by stock and retry retains UUID',async()=>{
 await withPage(false,async page=>{
  assert.equal(await page.getByRole('button',{name:'Добавить материал',exact:true}).count(),0);
  await page.getByRole('button',{name:'Выдать материал',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Выдать материал на изделие',exact:true});
  await dialog.locator('#stock-material').click();await page.getByText('Петля',{exact:true}).click();
  await dialog.locator('#stock-quantity').fill('6');assert.equal(await dialog.getByRole('button',{name:'Выдать',exact:true}).isDisabled(),true);
  await dialog.locator('#stock-quantity').fill('3');
  await dialog.getByRole('button',{name:'Выдать',exact:true}).click();await page.waitForFunction(()=>window.__requests.length===1);
  await dialog.getByRole('button',{name:'Выдать',exact:true}).click();await page.waitForFunction(()=>window.__requests.length===2);
  const requests=await page.evaluate(()=>window.__requests);assert.deepEqual(requests[0],requests[1]);
  assert.equal(requests[0].productId,'p');assert.equal(requests[0].materialId,'m');assert.equal(requests[0].quantity,'3');
  assert.equal(requests[0].projectMaterialId,undefined);assert.equal(requests[0].unitPrice,undefined);
 });
});
test('snapshot return omits price and survives a refreshed source list after lost ACK',async()=>{
 await withPage(false,async page=>{
  await page.getByRole('button',{name:'Вернуть материал',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Вернуть материал на склад',exact:true});
  assert.equal(await dialog.locator('#stock-legacy-price').count(),0);
  await dialog.locator('#stock-quantity').fill('1');await dialog.getByRole('button',{name:'Вернуть',exact:true}).click();
  await page.waitForFunction(()=>window.__returns.length===1);await page.evaluate(()=>window.__removeSources());
  await dialog.getByRole('button',{name:'Вернуть',exact:true}).click();await page.waitForFunction(()=>window.__returns.length===2);
  const requests=await page.evaluate(()=>window.__returns);assert.deepEqual(requests[0],requests[1]);
  assert.equal(requests[0].sourceMovementId,'issue');assert.equal(requests[0].productId,'p');assert.equal(requests[0].unitPrice,undefined);
 });
});
test('fulfilled need still offers issue above plan; legacy return requires its explicit price',async()=>{
 await withPage(true,async page=>{
  await page.getByRole('button',{name:'Выдать со склада',exact:true}).click();
  let dialog=page.getByRole('dialog',{name:'Выдать материал на изделие',exact:true});
  assert.equal(await dialog.locator('#stock-legacy-price').count(),0);
  await dialog.locator('#stock-quantity').fill('3');assert.equal(await dialog.getByRole('button',{name:'Выдать',exact:true}).isDisabled(),false);
  await dialog.getByRole('button',{name:'Отмена',exact:true}).click();
  await page.getByRole('button',{name:'Вернуть материал',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'Вернуть материал на склад',exact:true});
  assert.equal(await dialog.getByRole('button',{name:'Вернуть',exact:true}).isDisabled(),true);
  await dialog.locator('#stock-legacy-price').fill('15');await dialog.getByRole('button',{name:'Вернуть',exact:true}).click();
  await page.waitForFunction(()=>window.__returns.length===1);
  const [input]=await page.evaluate(()=>window.__returns);assert.equal(input.projectMaterialId,'line');assert.equal(input.unitPrice,'15');assert.equal(input.sourceMovementId,undefined);
 });
});
