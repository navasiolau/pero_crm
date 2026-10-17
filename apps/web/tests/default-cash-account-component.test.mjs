import assert from 'node:assert/strict';
import test, {before, after} from 'node:test';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url),{build}=createRequire(require.resolve('tsx/package.json'))('esbuild');
const {chromium}=require('@playwright/test'),web=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let browser;
before(async()=>{browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();});
const actor='00000175-0000-4000-8000-000000000010';
const accounts=[{id:'byn',name:'Касса BYN',currency:'BYN',active:true,balance:10000},{id:'rub',name:'Касса RUB',currency:'RUB',active:true,balance:10000,isDefault:true}];
const bundlePromise=build({stdin:{contents:`
import React from 'react';import {createRoot} from 'react-dom/client';
import {PaymentDialog} from '@/components/payment-dialog';
function App(){const [open,setOpen]=React.useState(true),[accounts,setAccounts]=React.useState(window.__accounts),[projectCurrency,setProjectCurrency]=React.useState('BYN');window.__open=setOpen;window.__accountsUpdate=setAccounts;window.__projectCurrencyUpdate=setProjectCurrency;
return <PaymentDialog direction={window.__direction??'INCOME'} open={open} onOpenChange={setOpen} projectCurrency={projectCurrency} cashAccounts={accounts} expenseArticles={[{id:'article',name:'Материалы'}]}/>;}
createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:web,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',tsconfig:path.join(web,'tsconfig.json'),define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'boundaries',setup(b){
b.onResolve({filter:/^(next\/navigation|sonner|@\/server\/payments\/actions|@\/server\/finance\/actions|@\/server\/warehouse\/stock-purchase-actions)$/},a=>({path:a.path,namespace:'boundary'}));
b.onLoad({filter:/.*/,namespace:'boundary'},a=>({loader:'js',contents:a.path==='next/navigation'?'export const useRouter=()=>({refresh(){}});':a.path==='sonner'?'export const toast={error(){},success(){}};':a.path.includes('stock-purchase')?'export const addPaidStockReceipt=async()=>({ok:false});':a.path.includes('payments')?
`export const getPaymentActorId=async()=>({ok:true,actorId:'${actor}'});export const addPayment=async input=>{window.__sent??=[];window.__sent.push(input);return {ok:false,outcome:'UNKNOWN',retrySafe:true,clientMutationId:input.clientMutationId,error:'lost acknowledgement'}};`:
`export const fetchNbrbRate=async()=>({ok:true,rate:0.035,date:'2026-10-17'});` }));}}],logLevel:'silent'});

async function withPayment(config,run){const context=await browser.newContext();try{const page=await context.newPage();page.setDefaultTimeout(5000);
await page.route('http://default-cash.fixture/',r=>r.fulfill({contentType:'text/html',body:'<style>.z-50{z-index:50}[data-slot=dialog-content]{position:relative;z-index:50}</style><div id="root"></div>'}));
await page.route('**/api/finance/documents/upload',r=>r.fulfill({status:201,contentType:'application/json',body:JSON.stringify({ok:true,document:{id:'00000175-0000-4000-8000-000000000020',source:'finance',fileName:'Чек.pdf',mimeType:'application/pdf',size:4,createdAt:'2026-10-17T00:00:00Z',paymentId:null}})}));
await page.goto('http://default-cash.fixture/');await page.evaluate(v=>Object.assign(window,v),{__accounts:accounts,...config});await page.addScriptTag({content:(await bundlePromise).outputFiles[0].text});await page.locator('#pay-amount').waitFor();
await page.waitForFunction(()=>!document.querySelector('fieldset').disabled);await run(page);}finally{await context.close();}}

test('new payment selects the default cash account and its currency over project currency',async()=>withPayment({},async page=>{
assert.ok((await page.locator('[data-slot=select-trigger]').nth(0).textContent()).includes('RUB'));
assert.ok((await page.locator('[data-slot=select-trigger]').nth(1).textContent()).includes('Касса RUB'));
}));

test('no default retains ordinary first-account choice in the project currency',async()=>withPayment({__accounts:accounts.map(a=>({...a,isDefault:false}))},async page=>{
assert.ok((await page.locator('[data-slot=select-trigger]').nth(0).textContent()).includes('BYN'));
assert.ok((await page.locator('[data-slot=select-trigger]').nth(1).textContent()).includes('Касса BYN'));
}));

test('manual selection and dirty expense survive options refresh; reopening takes the new default',async()=>withPayment({__direction:'EXPENSE'},async page=>{
await page.locator('[data-slot=select-trigger]').nth(0).click();await page.getByRole('option',{name:'BYN',exact:true}).click();
await page.locator('#pay-amount').fill('12.34');await page.locator('#pay-comment').fill('Сохранить ввод');await page.locator('#pay-date').fill('2026-10-12');
await page.locator('#pay-document').setInputFiles({name:'Чек.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF')});
await page.getByRole('button',{name:'Внести расход',exact:true}).waitFor();await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Внести расход')?.disabled);
await page.locator('#pay-document').evaluate(el=>{el.dataset.kept='yes';});
await page.evaluate(()=>{window.__accountsUpdate(window.__accounts.map(a=>({...a,isDefault:a.id==='rub'})).reverse());window.__projectCurrencyUpdate('USD');});
assert.equal(await page.locator('#pay-amount').inputValue(),'12.34');assert.equal(await page.locator('#pay-comment').inputValue(),'Сохранить ввод');assert.equal(await page.locator('#pay-date').inputValue(),'2026-10-12');assert.equal(await page.locator('#pay-document').getAttribute('data-kept'),'yes');
assert.ok((await page.locator('[data-slot=select-trigger]').nth(0).textContent()).includes('BYN'));
await page.evaluate(()=>window.__open(false));await page.locator('#pay-amount').waitFor({state:'hidden'});await page.evaluate(()=>window.__open(true));await page.locator('#pay-amount').waitFor();
await page.waitForFunction(()=>!document.querySelector('fieldset').disabled);assert.equal(await page.locator('#pay-amount').inputValue(),'');assert.ok((await page.locator('[data-slot=select-trigger]').nth(0).textContent()).includes('RUB'));
}));

test('restored unknown payment keeps exact cash currency document and UUID after default changes',async()=>withPayment({__direction:'EXPENSE'},async page=>{
await page.locator('#pay-amount').fill('20');await page.locator('#pay-document').setInputFiles({name:'Чек.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF')});
await page.getByRole('button',{name:'Внести расход',exact:true}).click();await page.waitForFunction(()=>window.__sent?.length===1);const first=await page.evaluate(()=>window.__sent[0]);
await page.evaluate(()=>{window.__accountsUpdate(window.__accounts.map(a=>({...a,isDefault:a.id==='byn'})));window.__open(false);});await page.locator('#pay-amount').waitFor({state:'hidden'});
await page.evaluate(()=>window.__open(true));await page.getByRole('button',{name:'Проверить',exact:true}).click();await page.waitForFunction(()=>window.__sent.length===2);
assert.deepEqual(await page.evaluate(()=>window.__sent[1]),first);assert.equal(first.cashAccountId,'rub');assert.equal(first.currency,'RUB');assert.ok(first.reportDocumentId);
}));
