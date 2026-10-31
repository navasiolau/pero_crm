import assert from 'node:assert/strict';
import test, {before, after} from 'node:test';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {build}=createRequire(require.resolve('tsx/package.json'))('esbuild');
const {chromium}=require('@playwright/test');
const web=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let browser;
before(async()=>{browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();});
const bundle=build({stdin:{contents:`
import React from 'react';import {createRoot} from 'react-dom/client';
import {ProjectInlineProvider} from '@/components/project-inline-provider';
import {OverviewTab} from '@/app/(app)/projects/[id]/overview-tab';
import {SinglePercentageRow} from '@/app/(app)/products/[id]/product-percentage-panel';
function Percentages(){const people={ENGINEERING:{id:'e',name:'Инженер',roles:['ENGINEER']},ASSEMBLY:{id:'w',name:'Сборщик',roles:['WORKER']},INSTALLATION:{id:'i',name:'Монтажник',roles:['MOUNTER']}},profile=window.__profile,canManage=profile==='manager';return <main className="space-y-4 p-4">{Object.keys(people).map(kind=>{const person=people[kind],own=profile===person.id,amount=kind==='ENGINEERING'?'50':'150',section={kind,state:'DRAFT',hasConfiguration:true,currentRatePercent:'5',ratePercent:'5',unitPrice:'1000',price:'1000',quantity:3,productTotal:'3000',calculationVersion:4,productCurrency:'BYN',payrollCurrency:null,total:amount,members:own?[{userId:person.id,name:person.name,amount}]:[],ownMember:own?{userId:person.id,name:person.name,amount}:null,revision:1,canManage,canTransfer:false,legacyPaidSummary:null,skippedSnapshot:null,transferCandidates:[],assignee:{userId:person.id,name:person.name,active:true,eligible:true},recipientCandidates:[{userId:person.id,name:person.name}]};return <SinglePercentageRow key={kind} productId="p" kind={kind} section={section} assignedEngineerId="e" canManage={canManage} canViewAll={canManage} candidates={[{...person,active:true}]}/>;})}</main>;}
createRoot(document.getElementById('root')).render(window.__mode==='percentage'?<Percentages/>:<ProjectInlineProvider projectId="project" stage="LEAD" pricingProjection={null} initial={{title:"Order",clientId:"a",managerId:null,address:"HISTORIC PROJECT ADDRESS",delivery:null,unloading:null,installation:null,"client.phone":"100","client.address":"Client A"}}><OverviewTab project={{id:"project",number:"1",stage:"LEAD",stageChangedAt:new Date(0),createdAt:new Date(0),currency:"BYN",refusalReason:null,refusalComment:null,reclamationReason:null,reclamationDescription:null,reclamationFault:null}} createdByName={null} canManage={window.__canManage} showAmount={false} clients={[{id:"a",label:"Client A",phone:"100",address:"Client A"},{id:"b",label:"Client B",phone:"200",address:"Client B"}]} managers={[]} productEngineers={[]} doneAt={null}/></ProjectInlineProvider>);
`,resolveDir:web,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',tsconfig:path.join(web,'tsconfig.json'),define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'boundaries',setup(b){
b.onResolve({filter:/^(next\/navigation|sonner|@\/components\/(project-cover|project-stage-control|product-inline-provider)|@\/lib\/independent-(project|product-percentage)-action|@\/server\/(clients|product-percentage-pay)\/actions)$/},args=>({path:args.path,namespace:'boundary'}));
b.onLoad({filter:/.*/,namespace:'boundary'},args=>({contents:args.path==='@/components/project-cover'?'export const ProjectCover=()=>null;':args.path==='@/components/project-stage-control'?'export const ProjectStageControl=()=>null;':args.path==='@/components/product-inline-provider'?'export const useOptionalProductInline=()=>null;':args.path.includes('independent-product-percentage')?'export const invokeProductPercentagePatch=input=>window.__percentageSave(input);':args.path.includes('product-percentage-pay')?'export const retryProductPercentageAction=async()=>({ok:true});':args.path==='next/navigation'?'export const useRouter=()=>({refresh(){}});':args.path==='sonner'?'export const toast={error(){},success(){}};':args.path.includes('independent-project')?'export const invokeProjectPatch=input=>window.__save(input);':'export const clientSelectionOptions=async()=>window.__clientOptions??[{value:"a",label:"Client A",hint:"100"},{value:"b",label:"Client B",hint:"200"}];export const createClient=async()=>({ok:false});export const updateClient=async()=>({ok:false});',loader:'js'}));
}}],logLevel:'silent'});
const css=(async()=>{const postcss=createRequire(require.resolve('@tailwindcss/postcss'))('postcss'),tailwind=require('@tailwindcss/postcss');return(await postcss([tailwind({base:web})]).process(await readFile(path.join(web,'src/app/globals.css'),'utf8'),{from:path.join(web,'src/app/globals.css')})).css;})();
async function withContacts(canManage,run,profile=null,viewport={width:1440,height:900}){
 const context=await browser.newContext({viewport});
 try{const page=await context.newPage();page.setDefaultTimeout(5000);await page.route('http://127.0.0.1/contacts-component',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));await page.goto('http://127.0.0.1/contacts-component');
 await page.evaluate(value=>{window.__canManage=value;window.__calls=[];window.__save=async input=>{window.__calls.push(input);return{kind:'saved',field:input.field,value:input.value,clientMutationId:input.clientMutationId,derived:{clientId:'a',...(input.field==='client.phone'?{phone:input.value}:{clientAddress:input.value})}}};},canManage);
 await page.evaluate(value=>{window.__mode=value?'percentage':'contacts';window.__profile=value;window.__pending=[];window.__percentageCalls=[];window.__percentageSave=input=>{window.__percentageCalls.push(input);return new Promise((resolve,reject)=>window.__pending.push({input,resolve,reject}));};window.__reply=kind=>{const item=window.__pending.shift();if(kind==='lost')return item.reject(Error('NETWORK'));item.resolve(kind==='conflict'?{ok:false,kind:'conflict',currentValue:'5',currentRevision:20,error:'QA_CONFLICT'}:{ok:true,kind:'saved',field:item.input.field,value:item.input.value,revision:item.input.expectedRevision+1,clientMutationId:item.input.clientMutationId,noOp:false,repeated:false});};},profile);
 await page.addStyleTag({content:await css});await page.addScriptTag({content:(await bundle).outputFiles[0].text});await page.locator(profile?'[data-single-percentage-kind]':'#project-client-phone').first().waitFor();await run(page);
 }finally{await context.close();}
}
test('общий селектор видит весь справочник и нового клиента после открытия',async()=>{
 await withContacts(true,async page=>{
  await page.evaluate(()=>{window.__clientOptions=Array.from({length:125},(_,index)=>({value:'client-'+index,label:'Клиент '+index,hint:'000'+index}));});
  await page.locator('#project-inline-client').click();
  await page.getByPlaceholder('Поиск: клиент…').fill('Клиент 124');
  await page.getByRole('button',{name:'Клиент 124 000124',exact:true}).click();
  await page.waitForFunction(()=>window.__calls.some(call=>call.field==='clientId'&&call.value==='client-124'));
  await page.evaluate(()=>{window.__clientOptions.push({value:'created-client',label:'Новый клиент QA202',hint:'999'});});
  await page.locator('#project-inline-client').click();
  await page.getByPlaceholder('Поиск: клиент…').fill('Новый клиент QA202');
  await page.getByRole('button',{name:'Новый клиент QA202 999',exact:true}).waitFor();
 });
});

test('real project contact inputs save Client fields with binding and support null address',async()=>{
 await withContacts(true,async page=>{
  assert.equal(await page.getByRole('button',{name:'Новый клиент',exact:true}).count(),1);
  assert.equal(await page.getByRole('button',{name:/^(BYN|USD|EUR|RUB)$/}).count(),0);
  assert.equal((await page.locator('body').textContent()).includes('HISTORIC PROJECT ADDRESS'),false);
  assert.equal(await page.getByLabel('Телефон клиента').count(),1);
  const phoneInput=page.getByLabel('Телефон клиента');await phoneInput.fill('');await phoneInput.focus();
  await phoneInput.evaluate(node=>{window.__imeKeys=[];node.addEventListener('keydown',event=>window.__imeKeys.push({key:event.key,composing:event.isComposing,trusted:event.isTrusted}));});
  const ime=await page.context().newCDPSession(page);
  try{
   await ime.send('Input.imeSetComposition',{text:'300',selectionStart:3,selectionEnd:3});await phoneInput.press('Enter');
   assert.ok(await page.evaluate(()=>window.__imeKeys.some(event=>event.key==='Enter'&&event.composing&&event.trusted)));assert.equal(await page.evaluate(()=>window.__calls.length),0);
   await ime.send('Input.insertText',{text:'300'});
  }finally{await ime.detach();}
  assert.equal(await phoneInput.inputValue(),'300');await phoneInput.press('Enter');
  await page.waitForFunction(()=>window.__calls.length===1);
  const phone=await page.evaluate(()=>window.__calls[0]);assert.equal(phone.field,'client.phone');assert.equal(phone.expectedClientId,'a');assert.equal(phone.expectedValue,'100');assert.equal(phone.value,'300');
  await page.getByLabel('Адрес клиента').fill('');await page.getByLabel('Адрес клиента').press('Tab');await page.waitForFunction(()=>window.__calls.length===2);
  const address=await page.evaluate(()=>window.__calls[1]);assert.equal(address.field,'client.address');assert.equal(address.value,null);assert.equal(address.expectedValue,'Client A');assert.equal(address.expectedClientId,'a');
 });
});

test('real percentage rows preserve live draft, step, late ACK, retry and conflict',async()=>{
 for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:360,height:800}])await withContacts(true,async page=>{
  for(const[kind,multiplier]of [['ENGINEERING',10],['ASSEMBLY',30],['INSTALLATION',30]]){
   const row=page.locator(`[data-single-percentage-kind="${kind}"]`),input=row.locator('input').first(),amount=row.locator('[data-percentage-amount]');
   await input.fill('6');assert.ok((await amount.innerText()).includes(String(6*multiplier)));assert.equal(await page.evaluate(()=>window.__pending.length),0);
   await input.press('Enter');await page.waitForFunction(()=>window.__pending.length===1);await input.fill('7');await input.press('Enter');
   await page.evaluate(()=>window.__reply());await page.waitForFunction(()=>window.__pending.length===1);assert.equal(await input.inputValue(),'7');assert.ok((await amount.innerText()).includes(String(7*multiplier)));await page.evaluate(()=>window.__reply());
   await input.press('ArrowUp');assert.equal(await input.inputValue(),'7.5');await page.waitForFunction(()=>window.__pending.length===1);await page.evaluate(()=>window.__reply());
   await row.getByRole('button',{name:'Процент, %: уменьшить на 0.5'}).click();assert.equal(await input.inputValue(),'7');await page.waitForFunction(()=>window.__pending.length===1);await page.evaluate(()=>window.__reply());
   await input.fill('8');await input.press('Enter');await page.waitForFunction(()=>window.__pending.length===1);const envelope=await page.evaluate(()=>window.__pending[0].input);
   await page.evaluate(()=>window.__reply('lost'));await row.getByRole('button',{name:'Повторить сохранение'}).click();await page.waitForFunction(()=>window.__pending.length===1);assert.deepEqual(await page.evaluate(()=>window.__pending[0].input),envelope);await page.evaluate(()=>window.__reply());
   await input.fill('9');await input.press('Enter');await page.waitForFunction(()=>window.__pending.length===1);await page.evaluate(()=>window.__reply('conflict'));assert.equal(await input.inputValue(),'9');await row.getByRole('alert').filter({hasText:'QA_CONFLICT'}).waitFor();
   await row.getByRole('button',{name:'Принять сохранённое'}).click();await page.waitForFunction(id=>document.querySelector(`[data-single-percentage-kind="${id}"] input`).value==='5',kind);
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 },'manager',viewport);
});

test('real percentage readonly rows show only own payout without controls or writes',async()=>{
 for(const profile of ['e','w','i','stranger'])await withContacts(false,async page=>{
  assert.equal(await page.locator('[data-single-percentage-kind]').count(),3);assert.equal(await page.locator('input').count(),0);
  const text=await page.locator('main').innerText();assert.equal(text.includes('Процент, %'),false);assert.doesNotMatch(text.replace(/\p{White_Space}/gu,''),/1000|3000/);assert.equal((text.match(/Оплата:/g)??[]).length,Number(profile!=='stranger'));
  await page.keyboard.press('Enter');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>window.__percentageCalls.length),0);
 },profile,{width:360,height:800});
});
test('readonly project contacts retain values and never submit writes',async()=>{
 await withContacts(false,async page=>{
 assert.equal(await page.getByRole('button',{name:'Новый клиент',exact:true}).count(),0);
 assert.equal(await page.getByLabel('Телефон клиента').count(),1);assert.equal(await page.getByLabel('Телефон клиента').getAttribute('readonly'),'');
 assert.equal(await page.getByLabel('Адрес клиента').getAttribute('readonly'),'');assert.equal(await page.getByLabel('Телефон клиента').inputValue(),'100');
 for(const [label,value]of [['Телефон клиента','100'],['Адрес клиента','Client A']]){
  const input=page.getByLabel(label);await input.focus();await input.pressSequentially('999');await input.press('Enter');await input.press('Tab');assert.equal(await input.inputValue(),value);
 }
 assert.equal(await page.locator('[role="alert"]').count(),0);
 assert.equal(await page.evaluate(()=>window.__calls.length),0);
 });
});
