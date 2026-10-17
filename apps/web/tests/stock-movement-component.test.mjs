import assert from 'node:assert/strict';
import test, {before, after} from 'node:test';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve('tsx/package.json'))('esbuild'),{chromium}=require('@playwright/test');
const web=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const postcss=createRequire(require.resolve('@tailwindcss/postcss'))('postcss'),tailwind=require('@tailwindcss/postcss');
const css=(async()=>{const from=path.join(web,'src/app/globals.css');return (await postcss([tailwind({base:web,optimize:true})]).process(await readFile(from,'utf8'),{from})).css;})();
let browser;
before(async()=>{browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();});
const bundle=build({stdin:{contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';
 import {MaterialsTab} from '@/app/(app)/projects/[id]/materials-tab';
 import {OrganizationPaymentsView} from '@/components/organization-payments-view';
 import {ProjectExpenseLedger} from '@/components/project-expense-ledger';
 const material={id:'m',name:'Петля',sku:null,unit:'шт',purchasePrice:20,stock:5};
 const legacy={id:'line',materialId:'m',materialName:'Петля',materialSku:null,unit:'шт',purchasePrice:20,quantityPerUnit:2,quantity:2,issuedQty:4,debt:0,available:5,status:'FULFILLED',comment:null,warehouseReady:true,returnSources:[],legacyReturnQuantity:1};
 function Harness(){
  const [sources,setSources]=React.useState(window.__legacy?[]:[{id:'issue',materialId:'m',materialName:'Петля',unit:'шт',createdAt:'2026-10-08T00:00:00Z',quantity:3,unitPrice:'20.000000001'}]);
  window.__removeSources=()=>setSources([]);
  if(window.__ledger==='organization')return <OrganizationPaymentsView direction="EXPENSE" rows={window.__payments} cashAccounts={[{id:'cash',name:'Основная касса',currency:'BYN'}]} expenseArticles={[{id:'article',name:'Материалы'}]} projects={[]} stockMaterials={[material]}/>;
  if(window.__ledger==='project')return <ProjectExpenseLedger rows={window.__expenseRows} breakdown={window.__breakdown} onDelete={payment=>window.__deletedPayment=payment.id}/>;
  return <MaterialsTab productId="p" lines={window.__legacy?[legacy]:[]} movements={[]} options={[]} issueOptions={[material]} returnSources={sources} warehouseReady={true} materialsTotalByn={60} canManage={false} canIssueReturn={true} showMoney={true}/>;
 }
 createRoot(document.getElementById('root')).render(<Harness/>);
 `,resolveDir:web,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',tsconfig:path.join(web,'tsconfig.json'),define:{'process.env.NODE_ENV':'"production"'},
 plugins:[{name:'boundary',setup(b){
 const modules={
  'next/navigation':'export const useRouter=()=>({refresh(){window.__refreshed=true}});',
  'next/link':"import React from 'react';export default function Link(props){return React.createElement('a',props)}",
  'sonner':'export const toast={error(){},success(){}};',
  '@/server/warehouse/actions':'export const addMaterial=async()=>{throw Error("UNEXPECTED_INLINE_MATERIAL")};export const updateMaterial=async()=>{throw Error("UNEXPECTED_INLINE_MATERIAL")};export const requestMaterial=async input=>{window.__requests.push(input);return{ok:false,error:"retry"}};export const returnMaterial=async input=>{window.__returns.push(input);return{ok:false,error:"retry"}};export const addProjectMaterial=async()=>({ok:true});export const updateProjectMaterial=async()=>({ok:true});export const deleteProjectMaterial=async()=>({ok:true});',
  '@/server/payments/actions':'export const getPaymentActorId=async()=>({ok:true,actorId:"accountant"});export const addPayment=async()=>{throw Error("UNEXPECTED_PAYMENT_WRITE")};export const deletePayment=async()=>{throw Error("UNEXPECTED_PAYMENT_DELETE")};',
  '@/server/warehouse/stock-purchase-actions':'export const addPaidStockReceipt=async()=>{throw Error("UNEXPECTED_STOCK_WRITE")};',
  '@/server/finance/actions':'export const addExpenseArticle=async()=>({ok:true,article:{id:"fixture-article",name:"Статья"}});export const fetchNbrbRate=async()=>{throw Error("UNEXPECTED_FX_FETCH")};'
 };
 b.onResolve({filter:/.*/},args=>modules[args.path]?{path:args.path,namespace:'qa'}:undefined);
 b.onLoad({filter:/.*/,namespace:'qa'},args=>({loader:'js',resolveDir:web,contents:modules[args.path]}));
 }}],logLevel:'silent'});
async function withPage(legacy,run){
 const built=await bundle,context=await browser.newContext();
 try{
  const page=await context.newPage();page.setDefaultTimeout(5000);
  await page.route('http://localhost:3199/stock',async route=>route.fulfill({contentType:'text/html',body:'<style>'+await css+'</style><main id="root" class="min-w-0 p-4"></main>'}));
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

// Перенесены действующие UI условия из закрытых операторов97/99/100/101/103.
const documentView={id:'report',fileName:'Receipt103.pdf',mimeType:'application/pdf',source:'finance'};
const paidRow={id:'paid',direction:'EXPENSE',amount:60,currency:'BYN',rate:1,rateDate:null,bynAmount:60,projectAmount:null,paidAt:'2026-10-07T09:00:00Z',comment:'Оплаченная закупка',cashAccountName:'Основная касса',expenseArticleName:'Материалы',createdByName:'Бухгалтер',project:null,reportDocument:documentView,
 stockPurchase:{movementId:'movement',materialName:'Петля',unit:'шт',quantity:3,unitPrice:20,stockValueByn:60}};
async function withLedger(mode,run){
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 try{
  const page=await context.newPage();page.setDefaultTimeout(5000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('http://localhost:3199/**',route=>route.request().url()==='http://localhost:3199/ledger'?route.fulfill({contentType:'text/html',body:'<style>'+cssText+'</style><main id="root" class="min-w-0 p-4"></main>'}):route.abort());
  const cssText=await css;await page.goto('http://localhost:3199/ledger');
  await page.evaluate(({mode,paidRow})=>{window.__ledger=mode;window.__payments=[paidRow];window.__requests=[];window.__returns=[];}, {mode,paidRow});
  await page.route('**/api/finance/documents/upload',async route=>{
   const body=route.request().postDataBuffer();assert.ok(body?.includes(Buffer.from('Receipt103.pdf')));assert.ok(body?.includes(Buffer.from('clientMutationId')));
   await route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({ok:true,document:documentView})});
  });
  await page.addScriptTag({content:(await bundle).outputFiles[0].text});await page.getByRole('button',{name:'Приход на склад',exact:true}).waitFor();await run(page);assert.deepEqual(errors,[]);
 }finally{await context.close();}
}
test('paid stock keeps optional document, computed amount and mobile footer; ordinary expense requires confirmed upload',async()=>{
 await withLedger('organization',async page=>{
  await page.getByRole('button',{name:'Приход на склад',exact:true}).click();
  const stock=page.getByRole('dialog',{name:'Приход на склад',exact:true});
  await stock.getByText('Отчетный документ (необязательно)',{exact:true}).waitFor();
  await stock.locator('#purchase-material').click();await page.getByText('Петля',{exact:true}).last().click();
  await stock.locator('#purchase-qty').fill('3');await stock.locator('#purchase-price').fill('20');
  assert.equal(await stock.locator('#pay-amount').inputValue(),'60.00');
  const submit=stock.getByRole('button',{name:'Оплатить и принять на склад',exact:true});await submit.waitFor();assert.equal(await submit.isEnabled(),true);
  await stock.locator('#pay-document').setInputFiles({name:'Receipt103.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nfixture\n%%EOF')});
  await stock.getByRole('link',{name:'Receipt103.pdf',exact:true}).waitFor();
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'MOBILE_OVERFLOW');
  await submit.scrollIntoViewIfNeeded();const box=await submit.boundingBox();assert.ok(box&&box.y>=0&&box.y+box.height<=844,'PAID_STOCK_FOOTER_UNREACHABLE');
  await stock.getByRole('button',{name:'Отмена',exact:true}).click();await stock.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Добавить расход',exact:true}).click();
  const expense=page.getByRole('dialog',{name:'Расход организации',exact:true});await expense.locator('#pay-amount').fill('10');
  assert.ok((await expense.locator('#income-project').innerText()).includes('Общий расход организации'));
  const pay=expense.getByRole('button',{name:'Внести расход',exact:true});assert.equal(await pay.isDisabled(),true);
  await expense.locator('#pay-document').setInputFiles({name:'Receipt103.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nfixture\n%%EOF')});
  await expense.getByRole('link',{name:'Receipt103.pdf',exact:true}).waitFor();assert.equal(await pay.isEnabled(),true);
  await pay.scrollIntoViewIfNeeded();const expenseBox=await pay.boundingBox();assert.ok(expenseBox&&expenseBox.y>=0&&expenseBox.y+expenseBox.height<=844,'EXPENSE_FOOTER_UNREACHABLE');
  await expense.getByRole('button',{name:'Отмена',exact:true}).click();
  await page.getByRole('article').filter({hasText:'Приход на склад'}).click();
  const detail=page.getByRole('dialog',{name:'Расход',exact:true});await detail.getByRole('heading',{name:'Расход',exact:true}).waitFor();
  assert.ok((await detail.innerText()).includes('Стоимость запаса'));assert.match(await detail.innerText(),/60.*BYN/s);assert.equal(await detail.getByRole('button',{name:'Удалить',exact:true}).isDisabled(),true);
  const document=detail.getByRole('link',{name:'Receipt103.pdf',exact:true});assert.equal(await document.getAttribute('href'),'/api/finance/documents/report');assert.equal(await document.getAttribute('download'),'Receipt103.pdf');
 });
});

test('project expense UI filters precise frozen stock costs, follows return source and only deletes cash expenses',async()=>{
 const context=await browser.newContext({viewport:{width:1440,height:900}});
 try{
  const page=await context.newPage();page.setDefaultTimeout(5000);
  await page.route('http://localhost:3199/project-expenses',async route=>route.fulfill({contentType:'text/html',body:'<style>'+await css+'</style><main id="root" class="min-w-0 p-4"></main>'}));
  await page.goto('http://localhost:3199/project-expenses');
  await page.evaluate(()=>{
   const common={date:'2026-10-07T09:00:00Z',comment:null,createdByName:'Бухгалтер'};
   const stock={materialId:'m',materialName:'Петля',unit:'шт',quantity:'3',unitPrice:'20.000000001',product:{id:'p',number:'201.1'},sourceMovementId:null};
   window.__ledger='project';window.__expenseRows=[
    {...common,id:'issue',source:'WAREHOUSE_ISSUE',sourceId:'issue-source',article:{key:'warehouse',label:'Склад'},bynAmount:60,stock,payment:null},
    {...common,id:'return',source:'WAREHOUSE_RETURN',sourceId:'return-source',article:{key:'warehouse',label:'Склад'},bynAmount:-20,stock:{...stock,quantity:'1',sourceMovementId:'issue-source'},payment:null},
    {...common,id:'cash',source:'PAYMENT',sourceId:'cash-source',article:{key:'article:a',label:'Материалы'},bynAmount:10,stock:null,payment:{id:'cash-source',amount:10,currency:'BYN',cashAccountName:'Касса'}}
   ];window.__breakdown=[{key:'warehouse',label:'Склад',amount:40},{key:'article:a',label:'Материалы',amount:10}];
  });
  await page.addScriptTag({content:(await bundle).outputFiles[0].text});
  const filter=page.getByLabel('Статья расходов');await filter.selectOption('warehouse');assert.match(await page.getByText('По статье:').innerText(),/40/);
  await page.getByRole('row').filter({hasText:'Выдача со склада'}).getByRole('button',{name:'Открыть',exact:true}).click();
  let detail=page.getByRole('dialog',{name:'Выдача со склада',exact:true});assert.ok((await detail.innerText()).includes('20,000000001 BYN'));assert.equal(await detail.getByRole('button',{name:'Удалить расход',exact:true}).count(),0);
  await detail.locator('[data-slot="dialog-footer"]').getByRole('button',{name:'Закрыть',exact:true}).click();
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'MOBILE_OVERFLOW');
  await page.getByRole('article').filter({hasText:'Возврат на склад'}).click();detail=page.getByRole('dialog',{name:'Возврат на склад',exact:true});
  await detail.getByRole('button',{name:'issue-source',exact:true}).click();await page.getByRole('dialog',{name:'Выдача со склада',exact:true}).waitFor();
  await page.getByRole('dialog').locator('[data-slot="dialog-footer"]').getByRole('button',{name:'Закрыть',exact:true}).click();
  await filter.selectOption('article:a');assert.equal(await page.getByRole('article').count(),1);await page.getByRole('article').click();
  await page.getByRole('dialog').getByRole('button',{name:'Удалить расход',exact:true}).click();assert.equal(await page.evaluate(()=>window.__deletedPayment),'cash-source');
 }finally{await context.close();}
});
