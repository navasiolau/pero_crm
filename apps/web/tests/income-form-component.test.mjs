import assert from 'node:assert/strict';
import test from 'node:test';
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
  return <PaymentDialog direction={direction} open={true} onOpenChange={()=>{}} projectId={window.__testProjectId} projectCurrency="BYN" projectOptions={window.__testProjectId?undefined:[{id:'project-1',number:'П-2026-042',title:'Название не должно быть в форме'}]} cashAccounts={[{id:'cash-1',name:'Основная касса',currency:'BYN'}]} expenseArticles={window.__testExpenseArticles??[{id:'article-1',name:'Материалы'},{id:'article-2',name:'Логистика'}]}/>;
 }
 createRoot(document.getElementById('root')).render(<Harness/>);
 `,resolveDir:web,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',tsconfig:path.join(web,'tsconfig.json'),define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'test-boundaries',setup(b){
 b.onResolve({filter:/^(next\/navigation|sonner|@\/server\/payments\/actions|@\/server\/finance\/actions)$/},args=>({path:args.path,namespace:'boundary'}));
 b.onLoad({filter:/.*/,namespace:'boundary'},args=>({contents:args.path==='next/navigation'?'export const useRouter=()=>({refresh(){}});':args.path==='sonner'?'export const toast={error(){},success(){}};':args.path.includes('payments')?'export const addPayment=async input=>{window.__paymentInput=input;return {ok:true}};export const deletePayment=async()=>({ok:true});':'export const fetchNbrbRate=async()=>({ok:true,rate:3,date:"2026-10-04"});',loader:'js'}));
 }}],logLevel:'silent'});

async function withDialog(config,run){
 const bundle=await bundlePromise;
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();page.setDefaultTimeout(5000);
  await page.setContent('<style>.z-50{z-index:50}.isolate{isolation:isolate}[data-slot=dialog-content]{position:relative;z-index:50}</style><div id="root"></div>');
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
  assert.equal(await page.locator('#income-project').inputValue(),'');
  assert.deepEqual(await page.locator('#income-project option').allTextContents(),['Общий приход организации','П-2026-042']);
  assert.equal(await page.locator('#pay-comment').getAttribute('placeholder'),'Комментарий к приходу');
  await submitIncome(page,null);
  await page.locator('#income-project').selectOption('project-1');
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
  await page.getByRole('button',{name:'Внести расход',exact:true}).click();
  await page.waitForFunction(()=>window.__paymentInput);
  assert.equal((await page.evaluate(()=>window.__paymentInput)).expenseArticleId,'article-1');
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
