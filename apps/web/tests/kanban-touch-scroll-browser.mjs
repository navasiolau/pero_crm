import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium,expect} from '@playwright/test';

const web=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(web,'package.json'));
// Настоящий общий контейнер и CSS; fixture не содержит сетевых server actions или DnD.
const entry=`import React from'react';import{createRoot}from'react-dom/client';import{KanbanScrollArea}from'@/components/kanban-scroll-area';
createRoot(document.getElementById('root')).render(<main style={{padding:16}}><h1>Канбан</h1><KanbanScrollArea label="Канбан"><>{Array.from({length:8},(_,i)=><section data-slot="kanban-column" className="w-64 shrink-0 rounded-xl border p-2" key={i}><h2>Колонка {i+1}</h2>{Array.from({length:9},(_,j)=><article data-kanban-card-id={i+'-'+j} className="mb-2 rounded border bg-background p-3" style={{height:100}} key={j}>Карточка {i+1}.{j+1}</article>)}</section>)}</></KanbanScrollArea></main>);`;

async function compile(){
 const{build}=createRequire(require.resolve('tsx/package.json'))('esbuild');
 const built=await build({stdin:{contents:entry,loader:'tsx',resolveDir:web},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',tsconfig:path.join(web,'tsconfig.json'),define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
 const postcss=createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
 const css=(await postcss([require('@tailwindcss/postcss')({base:web})]).process(await readFile(path.join(web,'src/app/globals.css'),'utf8'),{from:path.join(web,'src/app/globals.css')})).css;
 return {js:built.outputFiles[0].contents,css};
}
const positions=page=>page.evaluate(()=>{const board=document.querySelector('[data-slot="kanban-scroll"]'),bar=document.querySelector('[data-kanban-scrollbar]');return{left:board.scrollLeft,bar:bar.scrollLeft,max:board.scrollWidth-board.clientWidth,top:scrollY}});
async function samePosition(page){await expect.poll(async()=>{const value=await positions(page);return Math.abs(value.left-value.bar);}).toBeLessThanOrEqual(1);}
async function touch(client,from,to,{steps=18,pause=12}={}){
 await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[from]});
 for(let step=1;step<=steps;step++){
  const ratio=step/steps;
  await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from.x+(to.x-from.x)*ratio,y:from.y+(to.y-from.y)*ratio}]});
  await new Promise(resolve=>setTimeout(resolve,pause));
 }
 await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
}

export async function runKanbanTouchScrollBrowser(){
 const{js,css}=await compile();
 const directory=path.join(web,'test-results/kanban-touch-scroll',randomUUID());await mkdir(directory,{recursive:true});
 let server,browser;
 const checks=[],traces=[],errors=[];
 try{
  server=createServer((request,response)=>{
   const pathname=new URL(request.url,'http://localhost').pathname;
   if(request.method!=='GET'||!['/','/app.js','/app.css'].includes(pathname)){response.writeHead(404);response.end();return;}
   response.setHeader('content-type',pathname==='/app.js'?'text/javascript':pathname==='/app.css'?'text/css':'text/html; charset=utf-8');
   response.end(pathname==='/app.js'?js:pathname==='/app.css'?css:'<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({headless:true});
  for(const viewport of[{width:390,height:844},{width:360,height:800},{width:844,height:390}]){
   const context=await browser.newContext({viewport,isMobile:true,hasTouch:true});
   const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
   await page.addInitScript(()=>{
    window.__scrollTrace=[];
    const original=Object.getOwnPropertyDescriptor(Element.prototype,'scrollLeft');
    Object.defineProperty(Element.prototype,'scrollLeft',{...original,set(value){
     if(this.matches('[data-slot="kanban-scroll"]'))window.__scrollTrace.push({from:original.get.call(this),to:value});
     original.set.call(this,value);
    }});
   });
   await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'networkidle'});
   await page.locator('[data-kanban-scrollbar]').waitFor();
   const client=await context.newCDPSession(page);
   await client.send('Emulation.setCPUThrottlingRate',{rate:viewport.width<768?4:1});
   for(let attempt=0;attempt<3;attempt++){
    await touch(client,{x:viewport.width-35,y:220},{x:55,y:224});
    await page.waitForTimeout(650);
   }
   await samePosition(page);
   const forward=await positions(page),writes=await page.evaluate(()=>window.__scrollTrace);
   traces.push({viewport,writes,forward});
   await writeFile(path.join(directory,'traces.json'),JSON.stringify(traces,null,2));
   assert.ok(forward.left>400,'Свайпы должны открыть следующие колонки');
   assert.deepEqual(writes,[],'Нативный свайп/инерция не должны получать обратные программные scrollLeft-записи');
   checks.push(viewport.width+':native-touch-without-feedback');
   await touch(client,{x:60,y:220},{x:viewport.width-35,y:224});await page.waitForTimeout(650);
   assert.ok((await positions(page)).left<forward.left-100,'Обратный свайп должен возвращать к предыдущим колонкам');await samePosition(page);
   await touch(client,{x:120,y:viewport.height-100},{x:120,y:130});await page.waitForTimeout(250);
   assert.ok((await positions(page)).top>100,'Вертикальная прокрутка страницы остаётся нативной');
   checks.push(viewport.width+':reverse-and-vertical');
   await page.screenshot({path:path.join(directory,'mobile-'+viewport.width+'.png')});await context.close();
  }
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'networkidle'});
  const board=page.getByRole('region',{name:'Канбан',exact:true}),bar=page.getByRole('region',{name:'Канбан: горизонтальная прокрутка',exact:true});
  await board.focus();await page.keyboard.press('End');await expect.poll(async()=>{const p=await positions(page);return Math.abs(p.left-p.max);}).toBeLessThanOrEqual(1);await samePosition(page);
  await page.keyboard.press('Home');await expect.poll(async()=>(await positions(page)).left).toBe(0);
  await page.keyboard.press('ArrowRight');await expect.poll(async()=>(await positions(page)).left).toBeGreaterThan(200);await samePosition(page);
  const duplicateEcho=await page.evaluate(()=>{
   const board=document.querySelector('[data-slot="kanban-scroll"]'),bar=document.querySelector('[data-kanban-scrollbar]');
   const next=board.scrollLeft+30;
   // Движение уже дошло до DOM, а его собственный scroll ещё ждёт следующую задачу.
   board.scrollLeft=next;
   bar.dispatchEvent(new Event('scroll'));bar.dispatchEvent(new Event('scroll'));
   return {expected:next,actual:board.scrollLeft};
  });
  assert.equal(duplicateEcho.actual,duplicateEcho.expected,'Повторное отложенное эхо не должно возвращать предыдущую позицию');await samePosition(page);
  await bar.focus();await page.keyboard.press('ArrowLeft');await expect.poll(async()=>(await positions(page)).left).toBeLessThan(duplicateEcho.actual-200);await samePosition(page);
  await page.keyboard.press('Home');await expect.poll(async()=>(await positions(page)).left).toBe(0);await samePosition(page);
  await board.hover();await page.keyboard.down('Shift');await page.mouse.wheel(0,120);await page.keyboard.up('Shift');await expect.poll(async()=>(await positions(page)).left).toBeGreaterThan(50);await samePosition(page);
  const bounds=await bar.boundingBox();assert.ok(bounds);await page.mouse.move(bounds.x+80,bounds.y+bounds.height/2);await page.mouse.wheel(280,0);
  await expect.poll(async()=>(await positions(page)).left).toBeGreaterThan(300);await samePosition(page);
  checks.push('desktop:keyboard-duplicate-echo-shift-wheel-and-native-bottom-scroll');
  assert.deepEqual(errors,[]);await writeFile(path.join(directory,'receipt.json'),JSON.stringify({status:'PASS',checks,traces,errors,scope:'Chromium CDP touch, actual shared component/CSS; no physical-device or WebKit claim'},null,2));
  console.log(JSON.stringify({status:'PASS',checks:checks.length,directory}));
 }finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));}
}
