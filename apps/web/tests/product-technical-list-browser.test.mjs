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
window.__save=async input=>{window.__requests.push(structuredClone(input));let reply=window.__receipts.get(input.clientMutationId);if(!reply){reply={kind:'saved',field:input.field,value:input.row,clientMutationId:input.clientMutationId,derived:{technicalSpecificationSectionId:input.sectionId}};window.__receipts.set(input.clientMutationId,reply);}if(window.__mode==='lost')throw Error('Lost ACK');if(window.__mode==='hold')return new Promise(resolve=>window.__release=()=>resolve(reply));return reply;};
function Existing(){const {flush}=useProductInline();window.__flush=flush;return <ProductTechnicalSpecifications canEdit={!location.search.includes('readonly')}/>}
const json={sections:[{id:'body',type:'custom',group:'construction',label:'Название с двоеточием: допустимо',value:'Значение: остаётся'}],description:null,size:null,note:null,sourceGeneration:0};
function App(){const [draft,setDraft]=useState(FurnitureSpecifications.empty);return <main className="mx-auto max-w-2xl p-4"><ProductInlineProvider productId="qa218" technicalSpecifications={location.search.includes('json')?json:null} initial={{title:'QA',kind:null,description:location.search.includes('legacy')?'Каркас: ЛДСП\nФасад: МДФ\nСвободный текст <b>дословно</b>':null,expectedPrice:null,quantity:1,engineerId:null,'project.clientId':'client'}}><Existing/></ProductInlineProvider>{location.search.includes('create')?<NewProductTechnicalSpecifications value={draft} onChange={setDraft}/>:null}</main>}
createRoot(document.getElementById('root')).render(<App/>);`;
test('единое поле: пары, порядок, autosave, IME, replay, удаление и 390/1440 CSS',{timeout:120000},async()=>{
 const boundaries={'@/lib/independent-product-action':'export const invokeProductPatch=input=>window.__save(input);'};
 const bundle=await build({stdin:{contents:entry,loader:'tsx',resolveDir:web},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',tsconfig:path.join(web,'tsconfig.json'),define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'transport',setup(b){b.onResolve({filter:/^@\/lib\/independent-product-action$/},args=>({path:args.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:boundaries[args.path],loader:'ts'}));}}]});
 const postcss=createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
 const css=(await postcss([require('@tailwindcss/postcss')({base:web})]).process(await readFile(path.join(web,'src/app/globals.css'),'utf8'),{from:path.join(web,'src/app/globals.css')})).css+'\n:root{--font-roboto:Arial} html,body{font-family:Arial,sans-serif}';
 const server=createServer((req,res)=>{assert.equal(req.method,'GET');const url=new URL(req.url,'http://localhost');res.setHeader('content-type',(url.pathname==='/app.js'?'text/javascript':url.pathname==='/app.css'?'text/css':'text/html')+';charset=utf-8');res.end(url.pathname==='/app.js'?bundle.outputFiles[0].text:url.pathname==='/app.css'?css:'<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script></html>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await launchCardBrowser();const {expect}=await import('@playwright/test');const origin='http://127.0.0.1:'+server.address().port;const directory=path.resolve(web,'test-results/technical-columns-218');await mkdir(directory,{recursive:true});
 const marker=row=>row.evaluate(node=>getComputedStyle(node,'::marker').color);
 try{for(const width of [390,1440]){
 const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(origin);
 const field=page.locator('[data-technical-field]'),rows=field.locator('ol > li');await expect(rows).toHaveCount(1);assert.equal(Math.round((await field.boundingBox()).height),320);await expect(field.locator('button,input,select')).toHaveCount(0);assert.equal(await page.evaluate(()=>window.__requests.length),0);
 const emptyMarker=await marker(rows.first());
 await expect.poll(()=>field.locator('ol').evaluate(node=>getComputedStyle(node,'::before').borderLeftWidth)).toBe('1px');
 assert.equal(await field.locator('ol').evaluate(node=>{const line=getComputedStyle(node,'::before');return line.top==='0px'&&line.bottom==='0px';}),true);
 assert.equal(await field.locator('[aria-hidden]').count(),0);
 await field.click({position:{x:200,y:250}});const label=page.getByLabel('Название характеристики 1',{exact:true}),value=page.getByLabel('Значение характеристики 1',{exact:true});await expect(label).toBeFocused();
 const longLabel='Внутреннее наполнение и произвольное длинное название';await label.fill(longLabel);await expect(rows).toHaveCount(2);assert.notEqual(await marker(rows.first()),emptyMarker);assert.equal(await marker(rows.last()),emptyMarker);await value.fill('ЛДСП EGGER Серый Кашемир\nВторая строка');await expect.poll(()=>page.evaluate(()=>window.__requests.length)).toBeGreaterThan(0);await expect(value).toBeFocused();
 assert.equal(await page.evaluate(()=>window.__requests[0].sectionId===window.__requests[0].clientMutationId),true);const id=await rows.first().getAttribute('data-technical-row');
 await label.fill('Изменённый заголовок');await value.fill('Дуб');assert.equal(await page.evaluate(()=>window.__flush()),true);assert.equal(await rows.first().getAttribute('data-technical-row'),id);
 const before=await page.evaluate(()=>window.__requests.length);await value.dispatchEvent('compositionstart');await value.fill('IME значение');await page.waitForTimeout(500);assert.equal(await page.evaluate(()=>window.__requests.length),before);await value.dispatchEvent('compositionend');await expect.poll(()=>page.evaluate(()=>window.__requests.length)).toBeGreaterThan(before);
 await page.evaluate(()=>window.__mode='lost');await value.fill('Потерянный ответ');await expect(value).toHaveAttribute('aria-invalid','true');await page.evaluate(()=>window.__mode='saved');await value.press('Control+Enter');await expect(value).toHaveAttribute('aria-invalid','false');assert.deepEqual(await page.evaluate(()=>window.__requests.at(-1)),await page.evaluate(()=>window.__requests.at(-2)));
 await label.fill(longLabel);await value.fill('Петли Blum с доводчиком\nНаправляющие полного выдвижения');await page.evaluate(()=>window.__flush());
 for(const nextWidth of [1440,390,1440,390]){await page.setViewportSize({width:nextWidth,height:1000});await expect.poll(()=>field.locator('textarea').evaluateAll(nodes=>nodes.every(node=>node.scrollHeight<=node.clientHeight))).toBe(true);assert.equal(await label.inputValue(),longLabel);assert.equal(await field.evaluate(node=>node.scrollWidth<=node.clientWidth),true);const [nameBox,valueBox]=await Promise.all([label.boundingBox(),value.boundingBox()]);assert.ok(nameBox.x+nameBox.width<=valueBox.x+1);const columnStart=await rows.last().locator('textarea').last().boundingBox();assert.ok(Math.abs(columnStart.x-valueBox.x)<1);const metrics=await label.evaluate(node=>{const style=getComputedStyle(node),context=document.createElement('canvas').getContext('2d');context.font=style.font;return{available:node.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),words:['Внутреннее','наполнение'].map(word=>({word,width:context.measureText(word).width}))};});for(const word of metrics.words)assert.ok(word.width<=metrics.available,`${nextWidth}px: ${word.word} (${word.width}px) не помещается в колонку ${metrics.available}px`);}
 await page.setViewportSize({width,height:1000});
 await page.screenshot({path:path.join(directory,`field-${width}.png`),fullPage:true});
 await label.fill('');await value.fill('');await page.evaluate(()=>window.__flush());await page.getByLabel('Название характеристики 2',{exact:true}).focus();await expect(rows).toHaveCount(1);assert.equal(await page.evaluate(()=>window.__requests.at(-1).row),null);assert.deepEqual(errors,[]);await page.close();
 }
 const page=await browser.newPage();await page.goto(origin+'/?readonly');await expect(page.locator('[data-technical-field]')).toHaveCount(1);await expect(page.locator('textarea,button')).toHaveCount(0);await expect(page.locator('ol > li')).toHaveCount(0);
 await page.goto(origin+'/?readonly&json');await expect(page.locator('ol > li')).toHaveCount(1);assert.equal(await page.locator('ol > li').textContent(),'Название с двоеточием: допустимоЗначение: остаётся');await expect(page.locator('[aria-hidden]')).toHaveCount(0);
 await page.goto(origin+'/?legacy');await expect(page.getByLabel('Название характеристики 1',{exact:true})).toHaveValue('Каркас');await expect(page.getByLabel('Значение характеристики 1',{exact:true})).toHaveValue('ЛДСП\n');assert.equal(await page.evaluate(()=>window.__requests.length),0);await page.getByLabel('Название характеристики 1',{exact:true}).focus();await page.getByLabel('Значение характеристики 1',{exact:true}).focus();assert.equal(await page.evaluate(()=>window.__requests.length),0);await expect(page.locator('b')).toHaveCount(0);
 await page.goto(origin+'/?legacy&json');await expect(page.getByLabel('Название характеристики 1',{exact:true})).toHaveValue('Название с двоеточием: допустимо');await expect(page.locator('ol > li')).toHaveCount(2);
 await page.goto(origin+'/?create');await expect(page.locator('[data-technical-field]')).toHaveCount(2);await expect(page.locator('ol > li')).toHaveCount(2);const created=page.locator('[data-technical-field]').last();const originalColor=await marker(created.locator('li').first());await created.getByLabel('Значение характеристики 1',{exact:true}).fill('Новое значение');await expect(created.locator('li')).toHaveCount(2);assert.notEqual(await marker(created.locator('li').first()),originalColor);assert.equal(await marker(created.locator('li').last()),originalColor);await page.close();
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
