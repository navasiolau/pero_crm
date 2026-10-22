import assert from 'node:assert/strict';
import test,{before,after} from 'node:test';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve('tsx/package.json'))('esbuild'),{chromium,expect}=require('@playwright/test');
const postcss=createRequire(require.resolve('@tailwindcss/postcss'))('postcss'),tailwind=require('@tailwindcss/postcss');
const web=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),shots=path.join(web,'../../node_modules/.cache/inline-article178');
const actor='00000178-0000-4000-8000-000000000010',documentId='00000178-0000-4000-8000-000000000020';let browser;
before(async()=>{browser=await chromium.launch({headless:true});await mkdir(shots,{recursive:true});});after(async()=>{await browser?.close();});
const bundle=build({stdin:{contents:`
import React from 'react';import {createRoot} from 'react-dom/client';import {PaymentDialog} from '@/components/payment-dialog';import {ArticlesView} from '@/app/(app)/finance/articles/articles-view';
function App(){const[open,setOpen]=React.useState(true),[articles,setArticles]=React.useState(window.__articles),[cash,setCash]=React.useState([{id:'rub',name:'Касса RUB',currency:'RUB',isDefault:true},{id:'byn',name:'Касса BYN',currency:'BYN'}]);
window.__open=setOpen;window.__articlesUpdate=setArticles;window.__cashUpdate=()=>setCash(current=>current.map(c=>({...c,isDefault:c.id==='byn'})).reverse());
if(window.__scope==='registry')return <ArticlesView articles={articles}/>;
return <PaymentDialog direction={window.__income?'INCOME':'EXPENSE'} open={open} onOpenChange={setOpen} projectCurrency='BYN' projectId={window.__scope==='project'?'project':undefined} projectOptions={window.__scope==='org'?[{id:'project',number:'321',title:'Проект'}]:undefined} cashAccounts={cash} expenseArticles={articles}
stockMaterials={window.__scope==='stock'?[{id:'material',name:'Материал',unit:'шт',sku:'А-1'}]:undefined}/>;}
createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:web,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',tsconfig:path.join(web,'tsconfig.json'),define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'boundaries',setup(b){
b.onResolve({filter:/^(next\/navigation|sonner|@\/server\/finance\/actions|@\/server\/payments\/actions|@\/server\/warehouse\/stock-purchase-actions|@\/server\/warehouse\/actions)$/},a=>({path:a.path,namespace:'qa'}));
b.onLoad({filter:/.*/,namespace:'qa'},a=>({loader:'js',contents:a.path==='@/server/warehouse/actions'?'export const addMaterial=async()=>{throw Error("UNEXPECTED_INLINE_MATERIAL")};export const updateMaterial=async()=>{throw Error("UNEXPECTED_INLINE_MATERIAL")};':a.path==='next/navigation'?`export const useRouter=()=>({refresh(){window.__refreshes=(window.__refreshes??0)+1}});`:a.path==='sonner'?`export const toast={success(){},error(){}};`:a.path.includes('finance/actions')?
`export const fetchNbrbRate=async()=>({ok:true,rate:0.035,date:'2026-10-12'});export const toggleExpenseArticle=async()=>({ok:true});export const addExpenseArticle=async input=>{window.__articleCalls??=[];window.__articleCalls.push(input);if(window.__delay)await new Promise(resolve=>window.__release=resolve);if(window.__articleFailure)return {ok:false,error:'Этот код статьи уже используется'};const article={id:'new-article',name:'Каноническая статья сервера'};return {ok:true,article}};`:
a.path.includes('payments/actions')?`export const getPaymentActorId=async()=>({ok:true,actorId:'${actor}'});export const deletePayment=async()=>({ok:true});export const addPayment=async input=>{window.__moneyCalls??=[];window.__moneyCalls.push(input);return {ok:false,outcome:'UNKNOWN',retrySafe:true,clientMutationId:input.clientMutationId,error:'Ответ потерян'}};`:
`export const addPaidStockReceipt=async input=>{window.__moneyCalls??=[];window.__moneyCalls.push(input);return {ok:false,outcome:'UNKNOWN',retrySafe:true,clientMutationId:input.clientMutationId,error:'Ответ потерян'}};`}));}}],logLevel:'silent'});
const css=(async()=>{const file=path.join(web,'src/app/globals.css');return(await postcss([tailwind({base:web,optimize:true})]).process(await readFile(file,'utf8'),{from:file})).css;})();
async function withPage(scope,config,run,{width=1440,dark=false}={}){const context=await browser.newContext({viewport:{width,height:width===1440?1000:844}});try{const page=await context.newPage();page.setDefaultTimeout(7000);
await page.route('http://article.fixture/',r=>r.fulfill({contentType:'text/html',body:`<html class="${dark?'dark':''}"><body><div id="root" style="padding:16px"></div></body></html>`}));
await page.route('**/api/finance/documents/upload',r=>r.fulfill({status:201,contentType:'application/json',body:JSON.stringify({ok:true,document:{id:documentId,source:'finance',fileName:'Чек.pdf',mimeType:'application/pdf',size:4,createdAt:'2026-10-17T00:00:00Z',paymentId:null}})}));
await page.goto('http://article.fixture/');await page.addStyleTag({content:await css+'\n:root{--font-roboto:Arial}body{font-family:Arial,sans-serif}'});await page.evaluate(v=>{Object.assign(window,v);if(v.__blocked){const scope=JSON.stringify(['payment','EXPENSE','project']);sessionStorage.setItem('pero:payment-intent:'+JSON.stringify([v.__actor,scope]),'broken');}},{__scope:scope,__actor:actor,__articles:[{id:'article',name:'Прежняя статья',code:5,active:true,comment:null}],...config});await page.addScriptTag({content:(await bundle).outputFiles[0].text});
if(scope==='registry')await page.getByRole('button',{name:'Добавить статью',exact:true}).waitFor();else{await page.locator('#pay-amount').waitFor();if(!config.__blocked)await page.waitForFunction(()=>!document.querySelector('fieldset').disabled);}await run(page);}finally{await context.close();}}
const parent=page=>page.locator('[data-slot=dialog-content]').filter({has:page.locator('#pay-amount')});
const child=page=>page.locator('[data-slot=dialog-content]').filter({has:page.locator('#article-name')});
async function fillPayment(page,scope){if(scope==='stock'){await page.locator('#purchase-material').click();await page.getByRole('button',{name:/Материал/}).last().click();await page.locator('#purchase-qty').fill('2');await page.locator('#purchase-price').fill('10.25');}else await page.locator('#pay-amount').fill('20.50');
await page.locator('#pay-date').fill('2026-10-12');await expect(page.locator('#pay-rate')).toHaveValue('0.035');await page.locator('#pay-rate').fill('0.034567');await page.locator('#pay-comment').fill('Комментарий расхода');
await page.locator('#pay-document').setInputFiles({name:'Чек.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF')});await expect(page.locator('#pay-document').locator('..').getByText('Чек.pdf',{exact:true})).toBeVisible();await page.locator('#pay-document').evaluate(el=>el.dataset.kept='yes');}
async function draft(page){return page.evaluate(()=>Object.fromEntries(['pay-amount','pay-rate','pay-date','pay-comment','purchase-qty','purchase-price'].map(id=>[id,document.getElementById(id)?.value??null]).concat([['documentNode',document.getElementById('pay-document')?.dataset.kept],['currency',document.querySelector('[data-slot=select-trigger]')?.textContent]])));}
async function openChild(page){await page.getByRole('button',{name:'Создать статью',exact:true}).click();await child(page).waitFor();await expect(child(page)).toHaveCSS('opacity','1');}
async function assertParentKept(page,before){assert.deepEqual(await draft(page),before);assert.equal(await parent(page).count(),1);assert.equal(await page.evaluate(()=>window.__moneyCalls?.length??0),0);}

for(const scope of ['org','project','stock'])test(`${scope} expense creates canonical article, preserves draft/document through props refresh, then conducts only on explicit submit`,async()=>withPage(scope,{__articles:[]},async page=>{
await fillPayment(page,scope);const before=await draft(page);await openChild(page);assert.equal(await page.locator('#article-code').inputValue(),'');
await page.locator('#article-name').fill('Новая статья');await page.locator('#article-comment').fill('Примечание статьи');if(scope==='project')await page.locator('#article-code').fill('73');
await page.evaluate(()=>{window.__cashUpdate();window.__articlesUpdate([{id:'foreign',name:'Изменение другого пользователя'}]);});await child(page).getByRole('button',{name:'Создать',exact:true}).click();await expect(child(page)).toHaveCount(0);
await assertParentKept(page,before);await expect(page.locator('#pay-article')).toContainText('Каноническая статья сервера');assert.equal(await page.locator('#pay-article').evaluate(el=>el===document.activeElement),false);
await expect(page.getByRole('button',{name:'Создать статью',exact:true})).toBeFocused();const call=await page.evaluate(()=>window.__articleCalls[0]);assert.equal(call.code,scope==='project'?'73':undefined);
await page.evaluate(()=>window.__articlesUpdate([{id:'new-article',name:'Каноническая статья сервера'}]));await page.locator('#pay-article').click();assert.equal(await page.getByRole('button',{name:'Каноническая статья сервера',exact:true}).count(),1);await page.keyboard.press('Escape');
await page.getByRole('button',{name:scope==='stock'?'Оплатить и принять на склад':'Внести расход',exact:true}).click();await page.waitForFunction(()=>window.__moneyCalls?.length===1);const money=await page.evaluate(()=>window.__moneyCalls[0]);assert.equal(money.expenseArticleId,'new-article');assert.equal(money.cashAccountId,'rub');assert.equal(money.currency,'RUB');assert.equal(money.rate,0.034567);assert.deepEqual(money.reportDocumentIds,[documentId]);
await expect(page.getByRole('button',{name:'Создать статью',exact:true})).toBeDisabled();await page.evaluate(()=>window.__open(false));await parent(page).waitFor({state:'hidden'});await page.evaluate(()=>window.__open(true));await page.getByRole('button',{name:'Проверить',exact:true}).click();await page.waitForFunction(()=>window.__moneyCalls.length===2);assert.deepEqual(await page.evaluate(()=>window.__moneyCalls[1]),money);
}));

test('child validation, server rejection, cancel and Escape preserve parent and never send money',async()=>withPage('project',{__articleFailure:true},async page=>{
await fillPayment(page,'project');const before=await draft(page);await openChild(page);await page.locator('#article-name').fill('Статья');await page.locator('#article-code').fill('0');await child(page).getByRole('button',{name:'Создать',exact:true}).click();await expect(child(page).getByRole('alert')).toContainText('целое число');assert.equal(await page.evaluate(()=>window.__articleCalls?.length??0),0);
await page.locator('#article-code').fill('73');await child(page).getByRole('button',{name:'Создать',exact:true}).click();await expect(child(page).getByRole('alert')).toContainText('уже используется');await assertParentKept(page,before);await child(page).getByRole('button',{name:'Отмена',exact:true}).click();await expect(child(page)).toHaveCount(0);await expect(page.getByRole('button',{name:'Создать статью',exact:true})).toBeFocused();
await openChild(page);assert.equal(await page.locator('#article-name').inputValue(),'');await page.keyboard.press('Escape');await expect(child(page)).toHaveCount(0);await assertParentKept(page,before);await expect(page.getByRole('button',{name:'Создать статью',exact:true})).toBeFocused();
}));

test('registry reuses dialog and proposes code over inactive rows without resetting dirty child on refresh',async()=>withPage('registry',{__articles:[{id:'one',code:73,name:'Архив',active:false,comment:null}]},async page=>{
await page.getByRole('button',{name:'Добавить статью',exact:true}).click();assert.equal(await page.locator('#article-code').inputValue(),'74');await page.locator('#article-name').fill('Статья каталога');await page.evaluate(()=>window.__articlesUpdate([{id:'two',code:99,name:'Другой',active:true,comment:null}]));assert.equal(await page.locator('#article-name').inputValue(),'Статья каталога');assert.equal(await page.locator('#article-code').inputValue(),'74');await child(page).getByRole('button',{name:'Создать',exact:true}).click();await expect(child(page)).toHaveCount(0);assert.equal((await page.evaluate(()=>window.__articleCalls[0])).code,'74');
}));

test('created article remains available on a quick reopen before server options arrive',async()=>withPage('org',{},async page=>{
await openChild(page);await page.locator('#article-name').fill('Новая');await child(page).getByRole('button',{name:'Создать',exact:true}).click();await expect(child(page)).toHaveCount(0);await parent(page).getByRole('button',{name:'Отмена',exact:true}).click();await parent(page).waitFor({state:'hidden'});
await page.evaluate(()=>window.__open(true));await page.locator('#pay-article').waitFor();await expect(page.locator('#pay-article')).toContainText('Каноническая статья сервера');
}));

for(const viewport of [{width:1440,dark:false},{width:390,dark:false},{width:1440,dark:true},{width:390,dark:true}])test(`nested focus and layout ${viewport.width}/${viewport.dark?'dark':'light'}`,async()=>withPage('project',{},async page=>{
await page.locator('#pay-amount').fill('33');await openChild(page);await page.locator('#article-name').fill('Длинное название статьи для проверки мобильной формы');
const bounds=await child(page).boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=viewport.width+1);assert.equal(await child(page).evaluate(el=>el.scrollWidth>el.clientWidth),false);await page.screenshot({animations:'disabled',path:path.join(shots,`${viewport.width}-${viewport.dark?'dark':'light'}.png`)});
await page.keyboard.press('Escape');await expect(child(page)).toHaveCount(0);assert.equal(await page.locator('#pay-amount').inputValue(),'33');await expect(page.getByRole('button',{name:'Создать статью',exact:true})).toBeFocused();
},viewport));

test('pending child prevents closing and no money runs; malformed UNKNOWN and income cannot create article',async()=>{
await withPage('project',{__delay:true},async page=>{await openChild(page);await page.locator('#article-name').fill('Статья');await child(page).getByRole('button',{name:'Создать',exact:true}).click();await page.waitForFunction(()=>window.__release);await page.keyboard.press('Escape');await expect(child(page)).toHaveCount(1);assert.equal(await page.evaluate(()=>window.__moneyCalls?.length??0),0);await page.evaluate(()=>window.__release());await expect(child(page)).toHaveCount(0);});
await withPage('project',{__blocked:true},async page=>{await expect(page.getByRole('button',{name:'Создать статью',exact:true})).toBeDisabled();assert.equal(await page.evaluate(()=>window.__articleCalls?.length??0),0);});
await withPage('project',{__income:true},async page=>{assert.equal(await page.getByRole('button',{name:'Создать статью',exact:true}).count(),0);});
});

for(const width of [1440,390])test(`three-document expense form fits and keeps every upload visible at ${width}`,async()=>withPage('project',{},async page=>{
 let serial=20;await page.route('**/api/finance/documents/upload',route=>{
  const name=/filename="([^"]+)"/.exec(route.request().postDataBuffer().toString('utf8'))?.[1];
  return route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({ok:true,document:{id:`00000195-0000-4000-8000-${String(++serial).padStart(12,'0')}`,source:'finance',fileName:name,mimeType:'application/pdf',size:4,createdAt:'2026-10-22T00:00:00Z',paymentId:null}})});
 });
 await page.locator('#pay-amount').fill('45');await page.locator('#pay-document').setInputFiles([1,2,3].map(index=>({name:`Подтверждение-${index}.pdf`,mimeType:'application/pdf',buffer:Buffer.from('%PDF')})));
 await page.getByRole('link',{name:'Подтверждение-3.pdf',exact:true}).waitFor();
 assert.equal(await page.getByRole('status').filter({hasText:'Готово'}).count(),3);
 assert.equal(await parent(page).evaluate(el=>el.scrollWidth>el.clientWidth),false);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.locator('#pay-document').locator('..').screenshot({path:path.join(shots,`multiple-documents-${width}.png`)});
}, {width}));
