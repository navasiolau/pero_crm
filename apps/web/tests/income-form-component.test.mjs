import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url);
const {build}=createRequire(require.resolve('tsx/package.json'))('esbuild');
const {chromium}=require('@playwright/test');
const web=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

// Реальный PaymentDialog и UI-компоненты; подменяются только внешние границы.
// Минимальная CSS здесь обеспечивает stacking для кликов, но не проверяет layout.
const bundlePromise=build({stdin:{contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';
 import {PaymentDialog} from '@/app/(app)/projects/[id]/finance-tab';
 function Harness(){
  const [direction,setDirection]=React.useState(window.__testDirection||'INCOME');
  window.__setDirection=setDirection;
  const [open,setOpen]=React.useState(true);window.__setOpen=setOpen;
  return <PaymentDialog direction={direction} open={open} onOpenChange={()=>{}} projectId={window.__testProjectId} projectCurrency="BYN" projectOptions={window.__testProjectId?undefined:[{id:'project-1',number:'П-2026-042',title:'Название не должно быть в форме'}]} cashAccounts={[{id:'cash-1',name:'Основная касса',currency:'BYN'}]} stockMaterials={window.__testStockMaterials} expenseArticles={window.__testExpenseArticles??[{id:'article-1',name:'Материалы'},{id:'article-2',name:'Логистика'}]}/>;
 }
 createRoot(document.getElementById('root')).render(<Harness/>);
 `,resolveDir:web,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',tsconfig:path.join(web,'tsconfig.json'),define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'test-boundaries',setup(b){
 b.onResolve({filter:/^(next\/navigation|sonner|@\/server\/payments\/actions|@\/server\/finance\/actions|@\/server\/warehouse\/stock-purchase-actions)$/},args=>({path:args.path,namespace:'boundary'}));
 b.onLoad({filter:/.*/,namespace:'boundary'},args=>({contents:args.path==='next/navigation'?'export const useRouter=()=>({refresh(){}});':args.path==='sonner'?'export const toast={error(){},success(){}};':args.path.includes('stock-purchase')?'export const addPaidStockReceipt=async input=>{window.__stockInput=input;return window.__stockResult??{ok:true}};':args.path.includes('payments')?'export const addPayment=async input=>{window.__paymentInput=input;return window.__paymentResult??{ok:true}};export const deletePayment=async()=>({ok:true});':'export const fetchNbrbRate=async()=>({ok:true,rate:3,date:"2026-10-04"});',loader:'js'}));
 }}],logLevel:'silent'});

async function withDialog(config,run){
 const bundle=await bundlePromise;
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();page.setDefaultTimeout(5000);
  await page.route('http://finance.fixture/',route=>route.fulfill({contentType:'text/html',body:'<style>.z-50{z-index:50}.isolate{isolation:isolate}[data-slot=dialog-content]{position:relative;z-index:50}</style><div id="root"></div>'}));
  await page.route('**/api/finance/documents/upload',route=>route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({ok:true,document:{id:randomUUID(),source:'finance',fileName:'Чек.pdf',mimeType:'application/pdf',size:4,createdAt:new Date().toISOString(),paymentId:null}})}));
  await page.goto('http://finance.fixture/');
  await page.evaluate(values=>Object.assign(window,values),config);
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.locator('[data-slot="dialog-content"] label').first().waitFor();
  await run(page);
 }finally{await browser.close()}
}

async function assertNoArticle(page){
 assert.equal(await page.locator('#pay-article').count(),0);
 assert.equal(await page.locator('label[for="pay-article"]').count(),0);
 assert.equal(await page.getByText('Нет статей — создайте их в Финансы → Статьи расходов',{exact:true}).count(),0);
}

async function submitIncome(page,projectId){
 await page.locator('#pay-amount').fill('123.45');
 await page.getByRole('button',{name:'Внести приход',exact:true}).click();
 await page.waitForFunction(()=>window.__paymentInput);
 const input=await page.evaluate(()=>window.__paymentInput);
 assert.equal(await page.evaluate(()=>Object.hasOwn(window.__paymentInput,'expenseArticleId')),false);
 assert.equal(input.projectId,projectId);assert.equal(input.direction,'INCOME');assert.equal(input.amount,123.45);
 await page.evaluate(()=>{window.__paymentInput=null});
}

test('general income has no article and retains optional number-only project and comment',async()=>{
 await withDialog({__testExpenseArticles:[]},async page=>{
  await assertNoArticle(page);
  assert.equal(await page.locator('[data-slot="dialog-content"] label').first().textContent(),'Проект (необязательно)');
  assert.equal((await page.locator('#income-project').textContent()).trim(),'Общий приход организации');
  await page.locator('#income-project').click();
  assert.equal(await page.getByPlaceholder('Номер проекта…').count(),1);
  assert.equal(await page.getByText('Название не должно быть в форме',{exact:true}).count(),0);
  await page.getByRole('button',{name:'П-2026-042',exact:true}).click();
  await page.locator('#income-project').click();
  await page.getByRole('button',{name:'Общий приход организации',exact:true}).last().click();
  assert.equal(await page.locator('#pay-comment').getAttribute('placeholder'),'Комментарий к приходу');
  await submitIncome(page,null);
  await page.locator('#income-project').click();
  await page.getByRole('button',{name:'П-2026-042',exact:true}).click();
  await submitIncome(page,'project-1');
 });
});

test('project income has no article and submits the fixed project',async()=>{
 await withDialog({__testProjectId:'project-1'},async page=>{
  await assertNoArticle(page);
  assert.equal(await page.locator('#income-project').count(),0);
  assert.equal(await page.locator('#pay-comment').getAttribute('placeholder'),'Комментарий к приходу');
  await submitIncome(page,'project-1');
 });
});

test('income omits an article left in shared state after switching from expense',async()=>{
 await withDialog({__testDirection:'EXPENSE',__testProjectId:'project-1'},async page=>{
  await page.locator('#pay-article').click();
  await page.getByRole('option',{name:'Логистика',exact:true}).click();
  await page.evaluate(()=>window.__setDirection('INCOME'));
  await page.getByRole('button',{name:'Внести приход',exact:true}).waitFor();
  await submitIncome(page,'project-1');
  await assertNoArticle(page);
 });
});

test('expense keeps its required article and submits the selected article',async()=>{
 await withDialog({__testDirection:'EXPENSE',__testProjectId:'project-1'},async page=>{
  assert.equal(await page.locator('label[for="pay-article"]').textContent(),'Статья расхода *');
  await page.locator('#pay-amount').fill('10');
  assert.equal(await page.getByRole('button',{name:'Внести расход',exact:true}).isDisabled(),true);
  await uploadDocument(page);
  await page.getByRole('button',{name:'Внести расход',exact:true}).click();
  await page.waitForFunction(()=>window.__paymentInput);
  const submitted=await page.evaluate(()=>window.__paymentInput);
  assert.equal(submitted.expenseArticleId,'article-1');assert.ok(submitted.reportDocumentId);assert.match(submitted.clientMutationId,/^[a-f0-9-]{36}$/);
  await page.evaluate(()=>{window.__paymentInput=null});
  await page.locator('#pay-article').click();
  await page.getByRole('option',{name:'Логистика',exact:true}).click();
  await page.getByRole('button',{name:'Внести расход',exact:true}).click();
  await page.waitForFunction(()=>window.__paymentInput);
  assert.equal((await page.evaluate(()=>window.__paymentInput)).expenseArticleId,'article-2');
 });
});

test('expense cannot submit when no article is available',async()=>{
 await withDialog({__testDirection:'EXPENSE',__testProjectId:'project-1',__testExpenseArticles:[]},async page=>{
  assert.equal(await page.locator('#pay-article').count(),1);
  await page.locator('#pay-amount').fill('10');
  assert.equal(await page.getByRole('button',{name:'Внести расход',exact:true}).isDisabled(),true);
  assert.equal(await page.evaluate(()=>window.__paymentInput),undefined);
 });
});

test('general expense has explicit organization context and submits document without a project',async()=>{
 await withDialog({__testDirection:'EXPENSE'},async page=>{
  assert.ok((await page.locator('#income-project').textContent()).includes('Общий расход организации'));
  assert.equal(await page.getByRole('heading',{name:'Расход организации',exact:true}).count(),1);
  assert.equal(await page.getByText('Расход уменьшит маржу проекта',{exact:true}).count(),0);
  await page.locator('#pay-amount').fill('25');await uploadDocument(page);
  await page.getByRole('button',{name:'Внести расход',exact:true}).click();await page.waitForFunction(()=>window.__paymentInput);
  const input=await page.evaluate(()=>window.__paymentInput);assert.equal(input.projectId,null);assert.equal(input.direction,'EXPENSE');assert.ok(input.reportDocumentId);
 });
});

async function uploadDocument(page){
 await page.locator('#pay-document').setInputFiles({name:'Чек.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF')});
 await page.getByRole('link',{name:'Чек.pdf',exact:true}).waitFor();
 assert.equal(await page.getByRole('link',{name:'Чек.pdf',exact:true}).getAttribute('download'),'Чек.pdf');
 assert.equal(await page.getByRole('button',{name:'Удалить файл Чек.pdf',exact:true}).isDisabled(),true);
}

test('paid warehouse mode permits no document, computes invoice amount and retries the same purchase UUID',async()=>{
 await withDialog({__testDirection:'EXPENSE',__testStockMaterials:[{id:'material',name:'Петля',unit:'шт',sku:null}],__stockResult:{ok:false,error:'lost acknowledgement'}},async page=>{
  assert.equal(await page.getByRole('heading',{name:'Приход на склад',exact:true}).count(),1);
  assert.equal(await page.locator('#pay-document').count(),1);
  assert.equal(await page.getByText('Отчетный документ (необязательно)',{exact:true}).count(),1);
  assert.equal(await page.locator('#income-project').count(),0);
  await page.locator('#purchase-material').click();
  await page.getByText('Петля',{exact:true}).click();
  await page.locator('#purchase-qty').fill('3');await page.locator('#purchase-price').fill('20');
  assert.equal(await page.locator('#pay-amount').inputValue(),'60.00');
  assert.equal(await page.locator('#pay-amount').getAttribute('readonly'),'');
  await page.getByRole('button',{name:'Оплатить и принять на склад',exact:true}).click();
  await page.waitForFunction(()=>window.__stockInput);
  const first=await page.evaluate(()=>window.__stockInput);
  assert.equal(first.materialId,'material');assert.equal(first.quantity,'3');assert.equal(first.unitPrice,'20');
  assert.equal(first.cashAccountId,'cash-1');assert.equal(first.expenseArticleId,'article-1');
  for(const field of ['amount','projectId','reportDocumentId','skipReportDocument'])assert.equal(Object.hasOwn(first,field),false);
  assert.equal(await page.evaluate(()=>window.__paymentInput),undefined);
  await page.evaluate(()=>{window.__stockInput=null});
  await page.getByRole('button',{name:'Оплатить и принять на склад',exact:true}).click();
  await page.waitForFunction(()=>window.__stockInput);
  assert.deepEqual(await page.evaluate(()=>window.__stockInput),first);
 });
});

test('paid warehouse receipt submits optional uploaded document and preserves it on retry',async()=>{
 await withDialog({__testDirection:'EXPENSE',__testStockMaterials:[{id:'material',name:'Петля',unit:'шт',sku:null}],__stockResult:{ok:false,error:'lost acknowledgement'}},async page=>{
  await page.locator('#purchase-material').click();await page.getByText('Петля',{exact:true}).click();
  await page.locator('#purchase-qty').fill('3');await page.locator('#purchase-price').fill('20');await uploadDocument(page);
  await page.getByRole('button',{name:'Оплатить и принять на склад',exact:true}).click();await page.waitForFunction(()=>window.__stockInput);
  const first=await page.evaluate(()=>window.__stockInput);assert.ok(first.reportDocumentId);
  await page.evaluate(()=>{window.__stockInput=null});
  await page.getByRole('button',{name:'Оплатить и принять на склад',exact:true}).click();await page.waitForFunction(()=>window.__stockInput);
  assert.deepEqual(await page.evaluate(()=>window.__stockInput),first);
 });
});

test('failed monetary acknowledgement preserves document and UUID for exact retry',async()=>{
 await withDialog({__testDirection:'EXPENSE',__testProjectId:'project-1',__paymentResult:{ok:false,error:'try again'}},async page=>{
  await page.locator('#pay-amount').fill('15');await uploadDocument(page);
  await page.getByRole('button',{name:'Внести расход',exact:true}).click();await page.waitForFunction(()=>window.__paymentInput);
  const first=await page.evaluate(()=>window.__paymentInput);await page.evaluate(()=>{window.__paymentInput=null});
  await page.getByRole('button',{name:'Внести расход',exact:true}).click();await page.waitForFunction(()=>window.__paymentInput);
  assert.deepEqual(await page.evaluate(()=>window.__paymentInput),first);
 });
});

test('late upload acknowledgement cannot attach a document to a newly opened form',async()=>{
 await withDialog({__testDirection:'EXPENSE',__testProjectId:'project-1'},async page=>{
  let release;let arrived;const wait=new Promise(resolve=>{arrived=resolve});
  await page.route('**/api/finance/documents/upload',async route=>{arrived();await new Promise(resolve=>{release=resolve});
   await route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({ok:true,document:{id:randomUUID(),source:'finance',fileName:'Late.pdf',mimeType:'application/pdf',size:4,createdAt:new Date().toISOString(),paymentId:null}})});
  });
  try{
   await page.locator('#pay-document').setInputFiles({name:'Late.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF')});await wait;
   await page.evaluate(()=>window.__setOpen(false));await page.locator('[data-slot="dialog-content"]').waitFor({state:'hidden'});
   await page.evaluate(()=>window.__setOpen(true));await page.locator('#pay-amount').fill('15');
   const finished=page.waitForResponse(response=>response.url().endsWith('/api/finance/documents/upload'));release();await finished;
   assert.equal(await page.getByRole('button',{name:'Внести расход',exact:true}).isDisabled(),true);
   assert.equal(await page.getByRole('link',{name:'Late.pdf',exact:true}).count(),0);
  }finally{release?.()}
 });
});
