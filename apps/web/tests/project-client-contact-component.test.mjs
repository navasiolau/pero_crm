import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const {build}=createRequire(require.resolve('tsx/package.json'))('esbuild');
const {chromium}=require('@playwright/test');
const web=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const bundle=build({stdin:{contents:`
import React from 'react';import {createRoot} from 'react-dom/client';
import {ProjectInlineProvider} from '@/components/project-inline-provider';
import {ProjectInlineContacts} from '@/components/project-inline-fields';
createRoot(document.getElementById('root')).render(<ProjectInlineProvider projectId="project" stage="LEAD" pricingProjection={null} initial={{title:"Order",clientId:"a",managerId:null,delivery:null,unloading:null,installation:null,"client.phone":"100","client.address":"Client A"}}><ProjectInlineContacts canManage={window.__canManage} clients={[{id:"a",label:"Client A",phone:"100",address:"Client A"},{id:"b",label:"Client B",phone:"200",address:"Client B"}]}/></ProjectInlineProvider>);
`,resolveDir:web,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',tsconfig:path.join(web,'tsconfig.json'),define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'boundaries',setup(b){
b.onResolve({filter:/^(next\/navigation|sonner|@\/lib\/independent-project-action|@\/server\/clients\/actions)$/},args=>({path:args.path,namespace:'boundary'}));
b.onLoad({filter:/.*/,namespace:'boundary'},args=>({contents:args.path==='next/navigation'?'export const useRouter=()=>({refresh(){}});':args.path==='sonner'?'export const toast={error(){},success(){}};':args.path.includes('independent-project')?'export const invokeProjectPatch=input=>window.__save(input);':'export const createClient=async()=>({ok:false});export const updateClient=async()=>({ok:false});',loader:'js'}));
}}],logLevel:'silent'});
async function withContacts(canManage,run){
 const browser=await chromium.launch({headless:true});
 try{const page=await browser.newPage();page.setDefaultTimeout(5000);await page.route('http://127.0.0.1/contacts-component',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));await page.goto('http://127.0.0.1/contacts-component');
 await page.evaluate(value=>{window.__canManage=value;window.__calls=[];window.__save=async input=>{window.__calls.push(input);return{kind:'saved',field:input.field,value:input.value,clientMutationId:input.clientMutationId,derived:{clientId:'a',...(input.field==='client.phone'?{phone:input.value}:{clientAddress:input.value})}}};},canManage);
 await page.addScriptTag({content:(await bundle).outputFiles[0].text});await page.getByLabel('Клиент',{exact:true}).waitFor();await run(page);
 }finally{await browser.close();}
}
test('real project contact inputs save Client fields with binding and support null address',async()=>{
 await withContacts(true,async page=>{
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
test('readonly project contacts retain values and never submit writes',async()=>{
 await withContacts(false,async page=>{
 assert.equal(await page.getByLabel('Телефон клиента').count(),1);assert.equal(await page.getByLabel('Телефон клиента').getAttribute('readonly'),'');
 assert.equal(await page.getByLabel('Адрес клиента').getAttribute('readonly'),'');assert.equal(await page.getByLabel('Телефон клиента').inputValue(),'100');
 for(const [label,value]of [['Телефон клиента','100'],['Адрес клиента','Client A']]){
  const input=page.getByLabel(label);await input.focus();await input.pressSequentially('999');await input.press('Enter');await input.press('Tab');assert.equal(await input.inputValue(),value);
 }
 assert.equal(await page.locator('[role="alert"]').count(),0);
 assert.equal(await page.evaluate(()=>window.__calls.length),0);
 });
});
