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
test('income form renders articles first, number-only optional project and submits explicit article',async()=>{
 const bundle=await build({stdin:{contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';
 import {PaymentDialog} from '@/app/(app)/projects/[id]/finance-tab';
 const direction=window.__testDirection||'INCOME';
 createRoot(document.getElementById('root')).render(<PaymentDialog direction={direction} open={true} onOpenChange={()=>{}} projectCurrency="BYN" projectOptions={direction==='INCOME'?[{id:'project-1',number:'П-2026-042',title:'Название не должно быть в форме'}]:undefined} cashAccounts={[{id:'cash-1',name:'Основная касса',currency:'BYN'}]} expenseArticles={[{id:'article-1',name:'Материалы'},{id:'article-2',name:'Логистика'}]}/>);
 `,resolveDir:web,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',tsconfig:path.join(web,'tsconfig.json'),define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'test-boundaries',setup(b){
 b.onResolve({filter:/^(next\/navigation|sonner|@\/server\/payments\/actions|@\/server\/finance\/actions)$/},args=>({path:args.path,namespace:'boundary'}));
 b.onLoad({filter:/.*/,namespace:'boundary'},args=>({contents:args.path==='next/navigation'?'export const useRouter=()=>({refresh(){}});':args.path==='sonner'?'export const toast={error(){},success(){}};':args.path.includes('payments')?'export const addPayment=async input=>{window.__paymentInput=input;return {ok:true}};export const deletePayment=async()=>({ok:true});':'export const fetchNbrbRate=async()=>({ok:true,rate:3,date:"2026-10-04"});',loader:'js'}));
 }}],logLevel:'silent'});
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();page.setDefaultTimeout(5000);
  await page.setContent('<style>.z-50{z-index:50}.isolate{isolation:isolate}[data-slot=dialog-content]{position:relative;z-index:50}</style><div id="root"></div>');await page.addScriptTag({content:bundle.outputFiles[0].text});
  const labels=page.locator('[data-slot="dialog-content"] label');await labels.first().waitFor();
  assert.match(await labels.nth(0).textContent(),/Статья/);
  assert.equal(await labels.nth(1).textContent(),'Проект (необязательно)');
  assert.equal(await page.locator('#income-project').inputValue(),'');
  assert.deepEqual(await page.locator('#income-project option').allTextContents(),['Общий приход организации','П-2026-042']);
  assert.equal(await page.locator('#pay-comment').getAttribute('placeholder'),'Комментарий к приходу');
  const article=page.locator('#pay-article');assert.match(await article.textContent(),/Выберите статью/);
  await page.locator('#pay-amount').fill('123.45');
  await page.getByRole('button',{name:'Внести приход',exact:true}).click();
  await page.waitForFunction(()=>window.__paymentInput);
  const general=await page.evaluate(()=>window.__paymentInput);
  assert.equal(general.expenseArticleId,undefined);assert.equal(general.projectId,null);
  await page.evaluate(()=>{window.__paymentInput=null});
  await article.click();await page.getByRole('option',{name:'Логистика',exact:true}).click();
  await page.locator('#income-project').selectOption('project-1');
  await page.getByRole('button',{name:'Внести приход',exact:true}).click();
  await page.waitForFunction(()=>window.__paymentInput);
  const input=await page.evaluate(()=>window.__paymentInput);
  assert.equal(input.expenseArticleId,'article-2');assert.equal(input.projectId,'project-1');assert.equal(input.direction,'INCOME');assert.equal(input.amount,123.45);
  await page.close();
  const expense=await browser.newPage();await expense.setContent('<style>.z-50{z-index:50}.isolate{isolation:isolate}[data-slot=dialog-content]{position:relative;z-index:50}</style><div id="root"></div>');
  // Отдельная монтировка сохраняет прежний auto-first EXPENSE.
  await expense.evaluate(()=>{window.__testDirection="EXPENSE"});
  await expense.addScriptTag({content:bundle.outputFiles[0].text});
  await expense.locator('#pay-amount').fill('10');
  await expense.getByRole('button',{name:'Внести расход',exact:true}).click();await expense.waitForFunction(()=>window.__paymentInput);
  assert.equal((await expense.evaluate(()=>window.__paymentInput)).expenseArticleId,'article-1');
 }finally{await browser.close()}
});
