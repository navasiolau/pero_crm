import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {launchCardBrowser} from './product-card-navigation-browser.mjs';
const web=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(path.join(web,'package.json'));
const {build}=createRequire(require.resolve('tsx/package.json'))('esbuild');
const entry=String.raw`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {ProductInlineProvider,useProductInline} from '@/components/product-inline-provider';
import {ProductTechnicalSpecifications} from '@/components/product-technical-specifications';
import {NewProductTechnicalSpecifications} from '@/components/product-technical-editor-fields';
import FurnitureSpecifications from '@pero/kp-template/furniture-specifications';
window.__requests=[];window.__mode='saved';window.__receipts=new Map();
window.__save=async input=>{window.__requests.push(structuredClone(input));let reply=window.__receipts.get(input.clientMutationId);if(!reply){reply={kind:'saved',field:input.field,value:input.value,clientMutationId:input.clientMutationId,derived:{technicalSpecificationSectionId:input.expectedSectionId??input.clientMutationId}};window.__receipts.set(input.clientMutationId,reply);}if(window.__mode==='lost')throw Error('Lost ACK');if(window.__mode==='hold')return new Promise(resolve=>window.__release=()=>resolve(reply));return reply;};
function Existing(){const {flush}=useProductInline();window.__flush=flush;return <ProductTechnicalSpecifications canEdit={!location.search.includes('readonly')}/>}
function App(){const [draft,setDraft]=useState(FurnitureSpecifications.empty);return <main className="mx-auto max-w-2xl p-4"><ProductInlineProvider productId="qa216" initial={{title:'QA',kind:null,description:'LEGACY JUNK',expectedPrice:null,quantity:1,engineerId:null,'project.clientId':'client'}}><Existing/></ProductInlineProvider>{location.search.includes('create')?<NewProductTechnicalSpecifications value={draft} onChange={setDraft}/>:null}</main>}
createRoot(document.getElementById('root')).render(<App/>);`;
test('плоский список: autosave без blur, IME, replay, очередь, readonly и 390/1440 CSS',{timeout:120000},async()=>{
 const boundaries={'@/lib/independent-product-action':'export const invokeProductPatch=input=>window.__save(input);'};
 const bundle=await build({stdin:{contents:entry,loader:'tsx',resolveDir:web},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',tsconfig:path.join(web,'tsconfig.json'),define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'transport',setup(b){b.onResolve({filter:/^@\/lib\/independent-product-action$/},args=>({path:args.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:boundaries[args.path],loader:'ts'}));}}]});
 const postcss=createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
 const css=(await postcss([require('@tailwindcss/postcss')({base:web})]).process(await readFile(path.join(web,'src/app/globals.css'),'utf8'),{from:path.join(web,'src/app/globals.css')})).css+'\n:root{--font-roboto:Arial} html,body{font-family:Arial,sans-serif}';
 const server=createServer((req,res)=>{assert.equal(req.method,'GET');const url=new URL(req.url,'http://localhost');res.setHeader('content-type',url.pathname==='/app.js'?'text/javascript':url.pathname==='/app.css'?'text/css':'text/html');res.end(url.pathname==='/app.js'?bundle.outputFiles[0].text:url.pathname==='/app.css'?css:'<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script></html>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await launchCardBrowser();const {expect}=await import('@playwright/test');const origin='http://127.0.0.1:'+server.address().port;const directory=path.resolve(web,'test-results/technical-list-216');await mkdir(directory,{recursive:true});
 try{for(const width of [390,1440]){const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);const list=page.locator('[data-product-technical-specifications]');await expect(list.locator('ol > li')).toHaveCount(9);await expect(list.locator('button,select,details,input')).toHaveCount(0);assert.equal(await list.innerText().then(t=>t.includes('LEGACY JUNK')),false);assert.equal(await page.evaluate(()=>window.__requests.length),0);
 const row=list.getByLabel('Корпус',{exact:true});await row.fill('Дуб\nМасло');await expect.poll(()=>page.evaluate(()=>window.__requests.length)).toBe(1);assert.equal(await row.evaluate(n=>n===document.activeElement),true);assert.equal(await page.evaluate(()=>window.__requests[0].expectedSectionId),null);
 await row.dispatchEvent('compositionstart');await row.fill('Дуб IME');await page.waitForTimeout(500);assert.equal(await page.evaluate(()=>window.__requests.length),1);await row.dispatchEvent('compositionend');await expect.poll(()=>page.evaluate(()=>window.__requests.length)).toBe(2);
 await page.evaluate(()=>window.__mode='hold');await row.fill('Очередь 1');await expect.poll(()=>page.evaluate(()=>window.__requests.length)).toBe(3);await row.fill('Очередь 2');await page.waitForTimeout(450);await page.evaluate(()=>{window.__mode='saved';window.__release();});await expect.poll(()=>page.evaluate(()=>window.__requests.length)).toBe(4);assert.equal(await page.evaluate(()=>window.__requests[3].expectedValue),'Очередь 1');
 await page.evaluate(()=>window.__mode='lost');await row.fill('Потерянный ответ');await expect(row).toHaveAttribute('aria-invalid','true');await page.evaluate(()=>window.__mode='saved');await row.press('Control+Enter');await expect(row).toHaveAttribute('aria-invalid','false');assert.deepEqual(await page.evaluate(()=>window.__requests.at(-1)),await page.evaluate(()=>window.__requests.at(-2)));
 await list.getByLabel('Фурнитура',{exact:true}).fill('Петли');assert.equal(await page.evaluate(()=>window.__flush()),true);await page.waitForTimeout(250);await page.screenshot({path:path.join(directory,`list-${width}.png`),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);await page.close();}
 const resized=await browser.newPage({viewport:{width:1440,height:1000}});
 await resized.goto(origin);const resizedBody=resized.getByLabel('Корпус',{exact:true}),resizedHardware=resized.getByLabel('Фурнитура',{exact:true});
 await resizedBody.fill('ЛДСП EGGER Серый Кашемир — материал корпуса и внутренних перегородок');
 await resizedHardware.fill('Петли Blum с доводчиком\nНаправляющие полного выдвижения, скрытого монтажа');
 for(const width of [1440,390,1440,390]){
  await resized.setViewportSize({width,height:1000});await resized.evaluate(()=>document.fonts.ready);
  await expect.poll(()=>resized.locator('textarea').evaluateAll(nodes=>nodes.every(node=>node.scrollHeight<=node.clientHeight))).toBe(true);
  assert.equal(await resizedBody.inputValue(),'ЛДСП EGGER Серый Кашемир — материал корпуса и внутренних перегородок');
  assert.equal(await resizedHardware.inputValue(),'Петли Blum с доводчиком\nНаправляющие полного выдвижения, скрытого монтажа');
 }
 await resized.screenshot({path:path.join(directory,'resize-1440-390.png'),fullPage:true});await resized.close();
 const page=await browser.newPage();await page.goto(origin+'/?readonly');await expect(page.locator('ol > li')).toHaveCount(9);await expect(page.locator('textarea,button')).toHaveCount(0);await page.goto(origin+'/?create');await expect(page.locator('[data-product-technical-specifications]')).toHaveCount(2);await expect(page.locator('ol > li')).toHaveCount(18);await page.close();
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});

