import assert from 'node:assert/strict';
import test,{before,after} from 'node:test';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve('tsx/package.json'))('esbuild'),{chromium}=require('@playwright/test');
const web=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');let browser;
before(async()=>{browser=await chromium.launch({headless:true});});after(async()=>{await browser?.close();});
const accounts=[{id:'byn',name:'Касса BYN',currency:'BYN',active:true,balance:10000},{id:'rub',name:'Касса RUB',currency:'RUB',active:true,balance:10000,isDefault:true}];
const bundle=build({stdin:{contents:`
import React from 'react';import {createRoot} from 'react-dom/client';
import {CashPayoutForm} from '@/app/(app)/advances/cash-payout-form';
import {FinancePayrollView} from '@/app/(app)/finance/payroll/finance-payroll-view';
import {LogisticsTripForm} from '@/components/logistics/trip-editor';
import {AccountsView} from '@/app/(app)/finance/accounts/accounts-view';
const user={id:'user',name:'Сотрудник',position:null};
function App(){const [accounts,setAccounts]=React.useState(window.__accounts),[snapshot,setSnapshot]=React.useState({revision:1,accountId:'rub'}),[key,setKey]=React.useState(0);
window.__accountsUpdate=setAccounts;window.__snapshot=setSnapshot;window.__remount=()=>setKey(k=>k+1);
if(window.__mode==='registry')return <AccountsView accounts={accounts} defaultCashAccount={snapshot} canManageDefault={window.__canManage!==false}/>;
if(window.__mode==='payroll')return <FinancePayrollView month='2026-10' currency='BYN' rows={[]} totals={{accrued:100,paid:0,advance:0,due:100}} payouts={[]} turnover={{total:100,paymentsCount:1,currency:'BYN'}} turnoverAccruals={[]} users={[user]} orgBalance={1000} dues={[{userId:'user',name:'Сотрудник',due:100}]} estimates={{}} cashAccounts={accounts} advanceUsers={[user]}/>;
if(window.__mode==='logistics')return <LogisticsTripForm key={key} trip={window.__trip??null} options={{projects:[],materials:[]}} moneyOptions={{cashAccounts:accounts}} onSaved={()=>{}} onReload={()=>{}} onBusyChange={()=>{}}/>;
return <CashPayoutForm key={key} mode={window.__mode==='salary'?'SALARY':'ADVANCE'} users={[user]} accounts={accounts}/>;
}createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:web,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',tsconfig:path.join(web,'tsconfig.json'),define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'boundaries',setup(b){
b.onResolve({filter:/^(next\/navigation|next\/link|sonner|@\/server\/payroll\/(actions|cash-actions)|@\/server\/finance\/actions|@\/server\/logistics\/(actions|money-actions))$/},a=>({path:a.path,namespace:'boundary'}));
b.onLoad({filter:/.*/,namespace:'boundary'},a=>({loader:'jsx',resolveDir:web,contents:a.path==='next/navigation'?`export const useRouter=()=>({refresh(){window.__refreshed=(window.__refreshed??0)+1},push(){}});export const usePathname=()=>'/finance/payroll';export const useSearchParams=()=>new URLSearchParams();`:a.path==='next/link'?`import React from 'react';export default function Link({children,...props}){return <a {...props}>{children}</a>}`:a.path==='sonner'?`export const toast={error(){},success(){}};`:a.path.includes('payroll/cash-actions')?
`export const previewCashPayout=async input=>({ok:true,preview:{amount:input.cashAmount,payrollCurrency:'BYN',cashAmount:input.cashAmount,cashCurrency:input.expectedCashCurrency,bynAmount:input.cashAmount,cashRate:'1',cashRateDate:'2026-10-17',payrollRate:'1',payrollRateDate:'2026-10-17'}});export const issueAdvance=async input=>{window.__sent??=[];window.__sent.push(input);if(window.__unknown)throw Error('lost');return {ok:true,cashAmount:input.cashAmount,cashCurrency:input.expectedCashCurrency,payrollAmount:input.cashAmount,payrollCurrency:'BYN'}};`:
a.path.includes('payroll/actions')?`export const addPayout=async input=>{window.__sent??=[];window.__sent.push(input);if(window.__unknown)throw Error('lost');return {ok:true,cashAmount:input.cashAmount,cashCurrency:input.expectedCashCurrency,payrollAmount:input.cashAmount,payrollCurrency:'BYN'}};export const accrueTurnover=async()=>({ok:true});export const deletePayout=async()=>({ok:true});export const settleAll=async()=>({ok:true});`:
a.path.includes('finance/actions')?`export const setDefaultCashAccount=async input=>{window.__setting=input;return {ok:true,snapshot:{revision:input.expectedRevision+1,accountId:input.accountId}}};export const addCashAccount=async()=>({ok:true});export const toggleCashAccount=async()=>({ok:true});`:
a.path.includes('money-actions')?`export const postLogisticsTrip=async()=>({ok:false,code:'NOOP'});export const correctLogisticsTripPosting=async()=>({ok:false,code:'NOOP'});`:
`export const createLogisticsTrip=async()=>({ok:false,code:'NOOP'});export const updateLogisticsTrip=async()=>({ok:false,code:'NOOP'});` }));}}],logLevel:'silent'});

async function withForm(mode,config,run){const context=await browser.newContext();try{const page=await context.newPage();page.setDefaultTimeout(5000);
await page.route('http://cash-forms.fixture/',r=>r.fulfill({contentType:'text/html',body:'<style>.z-50{z-index:50}[data-slot=dialog-content]{position:relative;z-index:50}</style><div id="root"></div>'}));await page.goto('http://cash-forms.fixture/');
await page.evaluate(v=>Object.assign(window,v),{__accounts:accounts,__mode:mode,...config});await page.addScriptTag({content:(await bundle).outputFiles[0].text});await page.locator('#root').locator('button').first().waitFor();await run(page);}finally{await context.close();}}

for(const mode of ['advance','salary'])test(`${mode} chooses default, retains manual draft during refresh and uses new default for a new operation`,async()=>withForm(mode,{},async page=>{
assert.ok(await page.getByRole('button',{name:/Касса RUB · RUB/}).count());
await page.getByRole('button',{name:/Касса RUB · RUB/}).click();await page.getByRole('button',{name:/Касса BYN · BYN/}).click();
await page.locator('#cash-payout-amount').fill('12');await page.locator('#cash-payout-description').fill('Работа');
await page.evaluate(()=>window.__accountsUpdate(window.__accounts.map(a=>({...a,isDefault:a.id==='rub'})).reverse()));
assert.equal(await page.locator('#cash-payout-amount').inputValue(),'12');assert.equal(await page.locator('#cash-payout-description').inputValue(),'Работа');assert.ok(await page.getByRole('button',{name:/Касса BYN · BYN/}).count());
await page.evaluate(()=>window.__remount());assert.equal(await page.locator('#cash-payout-amount').inputValue(),'');assert.ok(await page.getByRole('button',{name:/Касса RUB · RUB/}).count());
}));

test('unknown advance retries frozen account and UUID even after default refresh, then new operation uses latest default',async()=>withForm('advance',{__unknown:true},async page=>{
await page.getByRole('button',{name:'Выберите сотрудника…'}).click();await page.getByRole('button',{name:'Сотрудник',exact:true}).click();
await page.locator('#cash-payout-amount').fill('12');await page.locator('#cash-payout-description').fill('Работа');await page.getByRole('button',{name:'Рассчитать и проверить сумму'}).click();await page.getByRole('button',{name:'Подтвердить и выдать аванс'}).click();
await page.waitForFunction(()=>window.__sent?.length===1);const first=await page.evaluate(()=>window.__sent[0]);assert.equal(first.cashAccountId,'rub');assert.equal(first.expectedCashCurrency,'RUB');
await page.evaluate(()=>{window.__unknown=false;window.__accountsUpdate(window.__accounts.map(a=>({...a,isDefault:a.id==='byn'})));});await page.getByRole('button',{name:'Повторить тот же запрос'}).click();await page.waitForFunction(()=>window.__sent.length===2);assert.deepEqual(await page.evaluate(()=>window.__sent[1]),first);
await page.getByRole('button',{name:'Новая операция'}).click();assert.ok(await page.getByRole('button',{name:/Касса BYN · BYN/}).count());
}));

test('mass settlement picks default on each opening and preserves manual account during refresh',async()=>withForm('payroll',{},async page=>{
await page.getByRole('button',{name:'Рассчитать всех',exact:true}).click();let dialog=page.locator('[data-slot=dialog-content]');assert.ok(await dialog.getByRole('button',{name:/Касса RUB · RUB/}).count());
await dialog.getByRole('button',{name:/Касса RUB · RUB/}).click();await page.getByRole('button',{name:/Касса BYN · BYN/}).click();await page.evaluate(()=>window.__accountsUpdate(window.__accounts.map(a=>({...a,isDefault:a.id==='rub'})).reverse()));assert.ok(await dialog.getByRole('button',{name:/Касса BYN · BYN/}).count());
await dialog.getByRole('button',{name:'Отмена',exact:true}).click();await dialog.waitFor({state:'hidden'});await page.getByRole('button',{name:'Рассчитать всех',exact:true}).click();assert.ok(await page.locator('[data-slot=dialog-content]').getByRole('button',{name:/Касса RUB · RUB/}).count());
}));

test('logistics initializes default currency and retains manual amount and account on refresh',async()=>withForm('logistics',{},async page=>{
assert.ok(await page.locator('button').filter({hasText:'Касса RUB · RUB'}).count(),await page.locator('body').innerText());await page.locator('button').filter({hasText:'Касса RUB · RUB'}).click();await page.locator('button').filter({hasText:'Касса BYN · BYN'}).click();
await page.getByLabel('Общая сумма, BYN').fill('123');await page.evaluate(()=>window.__accountsUpdate(window.__accounts.map(a=>({...a,isDefault:a.id==='rub'})).reverse()));assert.equal(await page.getByLabel('Общая сумма, BYN').inputValue(),'123');assert.ok(await page.locator('button').filter({hasText:'Касса BYN · BYN'}).count());
}));

test('logistics correction keeps the recorded account over a newer global default',async()=>withForm('logistics',{__trip:{id:'trip',revision:1,date:'2026-10-17',comment:'',shares:[],lines:[],documents:[],money:{history:[],current:{cashAccountId:'byn',cashAccountName:'Касса BYN',currency:'BYN',amount:'25.00',bynAmount:'25.00',allocations:[]}}}},async page=>{
assert.ok(await page.locator('button').filter({hasText:'Касса BYN · BYN'}).count());assert.equal(await page.getByLabel('Общая сумма, BYN').inputValue(),'25.00');
}));

test('registry permits clearing default with expected revision and accountant receives a read-only label',async()=>{
await withForm('registry',{},async page=>{await page.locator('#default-cash-account').click();await page.getByRole('button',{name:'Без кассы по умолчанию',exact:true}).click();await page.waitForFunction(()=>window.__setting);assert.deepEqual(await page.evaluate(()=>window.__setting),{accountId:null,expectedRevision:1});});
await withForm('registry',{__canManage:false},async page=>{assert.equal(await page.locator('#default-cash-account').count(),0);assert.equal(await page.evaluate(()=>window.__setting),undefined);});
});
