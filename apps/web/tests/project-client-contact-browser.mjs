// Реальное приложение и bounded фикстуры существующего подписанного QA workflow.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bundleProjectQa} from './project-inline-qa-bundle.mjs';
import {qaTransport,qaBasicAuth,acceptanceRoot,acceptanceWeb} from './crm-acceptance-transport.mjs';
const require=createRequire(import.meta.url),{chromium}=require('@playwright/test');
const[target,revision]=process.argv.slice(2),origin=target==='local'?'http://127.0.0.1:3095':'https://staging-crm.peromebel.by';
const outputDir=path.join(acceptanceRoot,'.playwright-mcp','task95',`${target}-${randomUUID()}`);await mkdir(outputDir,{recursive:true});
if(target==='local')process.env.CRM_PROJECT_QA_LOCAL_UPLOADS_ROOT=path.join(acceptanceWeb,'uploads');
const transport=qaTransport({target,revision,outputDir}),sessionBytes=await bundleProjectQa('project-inline-session.mjs'),fixtureBytes=await bundleProjectQa('project-inline-browser-fixtures.mjs');
const session=(await transport.execute(sessionBytes,'prepare',{operation:'prepare'})).body;
await writeFile(path.join(outputDir,'session-checkpoint.private.json'),JSON.stringify(session.checkpoint));
const fixture=(await transport.execute(fixtureBytes,'prepare',{operation:'prepare',runId:randomUUID(),sessionCheckpoint:session.checkpoint})).body;
await writeFile(path.join(outputDir,'fixture-checkpoint.private.json'),JSON.stringify(fixture.checkpoint));
const mutations=new Map(),preferences=new Map(),checks=[];let captureFailure=false,browser;
const persist=()=>writeFile(path.join(outputDir,'journal.private.json'),JSON.stringify({mutationIds:[...mutations.keys()],preferenceWrites:[...preferences.values()]}));
async function cleanup(){
 const inspected=await transport.execute(fixtureBytes,'inspect',{operation:'inspect',checkpoint:fixture.checkpoint,mutationIds:[...mutations.keys()],stageMutationIds:[],legacyApiWrites:[]});
 const data=await transport.execute(fixtureBytes,'restore',{operation:'restore',checkpoint:fixture.checkpoint,observation:inspected.body.observation});
 const prefs=await transport.execute(sessionBytes,'restore',{operation:'restore',checkpoint:session.checkpoint,ownWrites:[...preferences.values()]});
 return{dataCleanup:data.body.status,prefCleanup:prefs.body.status};
}
try{
 browser=await chromium.launch({headless:true});
 async function context(profile){
  const ctx=await browser.newContext({viewport:{width:1440,height:900},...(target==='staging'?{httpCredentials:await qaBasicAuth()}:{})});
  await ctx.addCookies(profile.cookies.filter(c=>origin.startsWith('https:')||!c.name.startsWith('__Secure-')).map(c=>({...c,url:origin,secure:origin.startsWith('https:'),httpOnly:true,sameSite:'Lax'})));
  await ctx.route('**/*',async route=>{
   const request=route.request();if(request.method()!=='POST'){await route.continue();return;}
   let args;try{args=JSON.parse(request.postData()??'null');}catch{}
   const patch=Array.isArray(args)&&args.length===1&&args[0]?.projectId===fixture.ids.project&&['client.phone','client.address','clientId'].includes(args[0]?.field)?args[0]:null;
   const pref=Array.isArray(args)&&args.length===2&&args[0]==='project.tab'&&['overview','products','files'].includes(args[1])?{userId:profile.id,key:args[0],value:args[1]}:null;
   try{
    const response=await route.fetch(),body=await response.body(),text=body.toString('utf8');
    if(patch){
     const values=text.split('\n').flatMap(line=>{try{return[JSON.parse(line.slice(line.indexOf(':')+1))];}catch{return[];}});
     const saved=values.find(row=>row?.kind==='saved'&&row.clientMutationId===patch.clientMutationId);
     assert.ok(saved,'CONTACT_SERVER_ACK_REQUIRED');mutations.set(patch.clientMutationId,{actorId:profile.id,projectId:patch.projectId,field:patch.field,value:saved.value,clientMutationId:patch.clientMutationId,noOp:Boolean(saved.noOp),source:'web'});
    }
    if(pref){assert.equal(response.status(),200);assert.ok(!/^[0-9a-f]+:E/m.test(text));preferences.set(`${pref.userId}/${pref.key}`,pref);}
    await persist();if(patch?.field==='client.address'&&patch.value==='QA slow address 95')await new Promise(resolve=>setTimeout(resolve,400));
    await route.fulfill({response,body});
   }catch{captureFailure=true;await route.abort();}
  });return ctx;
 }
 const ctx=await context(session.profiles.manager),page=await ctx.newPage();page.setDefaultTimeout(15000);
 await page.goto(origin+fixture.paths.project,{waitUntil:'networkidle'});
 if(!await page.getByLabel('Телефон клиента').isVisible())await page.getByRole('tab',{name:'Общее',exact:true}).click();
 const phone=page.getByLabel('Телефон клиента'),address=page.getByLabel('Адрес клиента');
 assert.equal(await phone.inputValue(),'100');await phone.fill('20095');await phone.press('Enter');await page.locator('#project-client-phone-state').getByText('Сохранено',{exact:true}).waitFor();
 await address.fill('Минск, учебная улица 95');await address.press('Tab');await page.locator('#project-client-address-state').getByText('Сохранено',{exact:true}).waitFor();checks.push('real_server_Client_phone_address_Enter_blur');
 await phone.fill('');await phone.press('Enter');await page.getByRole('alert').getByText('Укажите телефон клиента',{exact:true}).waitFor();await phone.fill('20095');await phone.press('Enter');checks.push('required_phone_error_preserves_saved_value');
 for(const width of [1440,390,360]){await page.setViewportSize({width,height:width===1440?900:844});await phone.waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(outputDir,`contacts-${width}.png`),fullPage:true});}checks.push('desktop_1440_mobile_390_360_without_overflow');
 await address.fill('QA slow address 95');await address.press('Enter');await page.getByLabel('Клиент',{exact:true}).click();await page.getByRole('button',{name:new RegExp(fixture.initial.clientLabelB.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))}).click();
 await phone.waitFor();await page.waitForFunction(()=>document.querySelector('#project-client-phone')?.value==='999');assert.equal(await address.inputValue(),'');checks.push('switch_waits_for_delayed_contact_response_and_rebinds');
 await address.fill('');await address.press('Enter');assert.equal(await address.inputValue(),'');
 await ctx.close();
 const ro=await context(session.profiles.engineer),roPage=await ro.newPage();await roPage.goto(origin+fixture.paths.project,{waitUntil:'networkidle'});if(!await roPage.getByLabel('Телефон клиента').isVisible())await roPage.getByRole('tab',{name:'Общее',exact:true}).click();assert.equal(await roPage.getByLabel('Телефон клиента').getAttribute('readonly'),'');assert.equal(await roPage.getByLabel('Адрес клиента').getAttribute('readonly'),'');await ro.close();checks.push('assigned_engineer_readonly_contacts');
 assert.equal(captureFailure,false);await browser.close();browser=null;
 const report={status:'PASS',target,revision,checks,...await cleanup(),outputDir};await writeFile(path.join(outputDir,'receipt.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){if(browser)await browser.close();await persist();await writeFile(path.join(outputDir,'stop.private.log'),String(error.stack??error));let cleaned=null;if(!captureFailure)try{cleaned=await cleanup();}catch{}console.log(JSON.stringify({status:'STOP',target,revision,outputDir,cleaned,code:captureFailure?'RESPONSE_CAPTURE_FAILED':'BROWSER_CHECK_FAILED'}));process.exitCode=1;}
