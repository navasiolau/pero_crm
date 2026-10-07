// Настоящий интерфейс с подписанными scoped QA fixtures; статус браузером не меняется.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bundleProjectQa} from './project-inline-qa-bundle.mjs';
import {qaTransport,qaBasicAuth,acceptanceRoot,acceptanceWeb} from './crm-acceptance-transport.mjs';
const require=createRequire(import.meta.url),{chromium}=require('@playwright/test');
const[target,revision]=process.argv.slice(2),origin=target==='local'?'http://127.0.0.1:3096':'https://staging-crm.peromebel.by';
const outputDir=path.join(acceptanceRoot,'.playwright-mcp','task96',`${target}-${randomUUID()}`);await mkdir(outputDir,{recursive:true});if(target==='local')process.env.CRM_PROJECT_QA_LOCAL_UPLOADS_ROOT=path.join(acceptanceWeb,'uploads');
const transport=qaTransport({target,revision,outputDir}),sessionBytes=await bundleProjectQa('project-inline-session.mjs'),fixtureBytes=await bundleProjectQa('project-inline-browser-fixtures.mjs');
const session=(await transport.execute(sessionBytes,'prepare',{operation:'prepare'})).body;await writeFile(path.join(outputDir,'session-checkpoint.private.json'),JSON.stringify(session.checkpoint));
const fixture=(await transport.execute(fixtureBytes,'prepare',{operation:'prepare',runId:randomUUID(),sessionCheckpoint:session.checkpoint})).body;await writeFile(path.join(outputDir,'fixture-checkpoint.private.json'),JSON.stringify(fixture.checkpoint));
const checks=[];let browser;async function cleanup(){const observed=await transport.execute(fixtureBytes,'inspect',{operation:'inspect',checkpoint:fixture.checkpoint,mutationIds:[],stageMutationIds:[],legacyApiWrites:[]});const data=await transport.execute(fixtureBytes,'restore',{operation:'restore',checkpoint:fixture.checkpoint,observation:observed.body.observation});const prefs=await transport.execute(sessionBytes,'restore',{operation:'restore',checkpoint:session.checkpoint,ownWrites:[]});return{dataCleanup:data.body.status,prefCleanup:prefs.body.status};}
try{
 browser=await chromium.launch({headless:true});
 async function context(profile){const ctx=await browser.newContext({viewport:{width:1440,height:900},...(target==='staging'?{httpCredentials:await qaBasicAuth()}:{})});await ctx.addCookies(profile.cookies.filter(c=>origin.startsWith('https:')||!c.name.startsWith('__Secure-')).map(c=>({...c,url:origin,secure:origin.startsWith('https:'),httpOnly:true,sameSite:'Lax'})));return ctx;}
 const ctx=await context(session.profiles.manager),page=await ctx.newPage();page.setDefaultTimeout(15000);await page.goto(origin+fixture.paths.productA,{waitUntil:'networkidle'});
 const status=page.getByRole('combobox',{name:'Сменить статус',exact:true});assert.equal((await status.innerText()).trim(),'Подготовка');await status.click();const labels=(await page.getByRole('option').allTextContents()).map(value=>value.trim());assert.deepEqual(labels,['Подготовка','Проектирование','В производстве','На складе ГП','Установка','Готово','Рекламация']);await page.keyboard.press('Escape');checks.push('actual_preparation_card_shared_status_select_order');
 for(const width of [1440,390,360]){await page.setViewportSize({width,height:width===1440?900:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(outputDir,`preparation-${width}.png`),fullPage:true});}checks.push('desktop_1440_mobile_390_360_no_overflow');await ctx.close();
 for(const role of ['engineer','worker','mounter']){if(!session.profiles[role])continue;const ro=await context(session.profiles[role]),tab=await ro.newPage();const response=await tab.goto(origin+fixture.paths.productA,{waitUntil:'networkidle'});assert.ok(response.status()===404||await tab.getByRole('heading',{name:'404',exact:true}).count()>0,`${role}_PREPARATION_MUST_BE_HIDDEN`);await ro.close();checks.push(`${role}_preparation_direct_page_denied`);}
 await browser.close();browser=null;const report={status:'PASS',target,revision,checks,...await cleanup(),outputDir};await writeFile(path.join(outputDir,'receipt.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){if(browser)await browser.close();await writeFile(path.join(outputDir,'stop.private.log'),String(error.stack??error));let cleaned=null;try{cleaned=await cleanup();}catch{}console.log(JSON.stringify({status:'STOP',target,revision,outputDir,cleaned}));process.exitCode=1;}
