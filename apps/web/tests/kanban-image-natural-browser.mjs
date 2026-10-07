import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium,expect} from '@playwright/test';
import sharp from 'sharp';
const web=process.cwd(),require=createRequire(import.meta.url),{build}=createRequire(require.resolve('tsx/package.json'))('esbuild');
const directory=path.resolve(web,'../../.playwright-mcp/kanban92');await mkdir(directory,{recursive:true});
const dimensions={landscape:[1600,800],square:[800,800],portrait:[800,1600]};
const assets=Object.fromEntries(await Promise.all(Object.entries(dimensions).map(async([id,[width,height]])=>[id,await sharp({create:{width,height,channels:3,background:{landscape:'#55b6c8',square:'#f8ca77',portrait:'#9bb77b'}[id]}}).png().toBuffer()])));
const entry=`
 import React from 'react';import {createRoot} from 'react-dom/client';
 import {ProductKanbanCard} from './src/components/product-kanban-card';import {ProjectKanbanCard} from './src/components/project-kanban-card';
 window.qa={opened:0};function App(){const [dragging,setDragging]=React.useState(false);return <><button id="dragging" onClick={()=>setDragging(!dragging)}>Переключить dragging</button><main className="grid grid-cols-1 gap-4 md:grid-cols-2" style={{maxWidth:616,margin:16,alignItems:"start"}}>{["landscape","square","portrait","slow","fullscreen","broken","empty"].flatMap(shape=>["product","project"].map(kind=>{const cover=shape==="empty"?null:{id:shape,fileName:shape+".png",mimeType:"image/png",hasThumb:true};return <div data-case={kind+"-"+shape} key={kind+shape}>{kind==="product"?<ProductKanbanCard product={{number:"209.1",title:"Изделие",statusChangedAt:new Date().toISOString(),expectedPrice:"1000",quantity:3,engineerName:"Инженер",sketchFile:cover}} showAmount currency="BYN" dragging={dragging} coverAction={shape==="fullscreen"?{type:"fullscreen"}:{type:"navigate",onOpen:()=>window.qa.opened++}}/>:<ProjectKanbanCard project={{id:"j",number:"209",title:"Проект",clientName:"Проверка",currency:"BYN",totalPrice:"3000",stageChangedAt:new Date().toISOString(),coverFile:cover,hasMaterialShortage:false}} showAmount dragging={dragging} onOpen={()=>window.qa.opened++}/>}</div>;}))}</main></>;}createRoot(document.getElementById("root")).render(<App/>);
 `;
const bundle=await build({stdin:{contents:entry,loader:'tsx',resolveDir:web},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'}});
const postcss=createRequire(require.resolve('@tailwindcss/postcss'))('postcss'),tailwind=require('@tailwindcss/postcss');
const css=(await postcss([tailwind({base:web})]).process(await readFile(path.join(web,'src/app/globals.css'),'utf8'),{from:path.join(web,'src/app/globals.css')})).css;
const server=createServer((request,response)=>{
 const url=new URL(request.url,'http://localhost');
 if(url.pathname.startsWith('/api/files/')){const id=url.pathname.split('/').at(-1);if(id==='broken'){response.writeHead(404);response.end();return;}response.setHeader('content-type','image/png');response.setHeader('cache-control','public,max-age=3600');if(id==='slow')setTimeout(()=>response.end(assets.landscape),300);else response.end(id==='fullscreen'?assets.landscape:assets[id]);return;}
 response.setHeader('content-type',url.pathname==='/app.js'?'text/javascript':url.pathname==='/app.css'?'text/css':'text/html');
 response.end(url.pathname==='/app.js'?bundle.outputFiles[0].text:url.pathname==='/app.css'?css:'<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body style="font-family:Arial,sans-serif"><div id="root"></div><script src="/app.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true,channel:'chromium'}),checks=[],screenshots=[];
try{
 for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:360,height:800}]){
  const page=await browser.newPage({viewport}),errors=[];page.on('pageerror',error=>errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  for(const kind of ['product','project']){
   for(const [shape,[width,height]] of Object.entries(dimensions)){
    const item=page.locator(`[data-case="${kind}-${shape}"]`),img=item.locator('img');
    await img.scrollIntoViewIfNeeded();await expect.poll(()=>img.evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
    const geometry=await img.evaluate(image=>{const r=image.getBoundingClientRect(),p=image.parentElement.getBoundingClientRect();return {width:r.width,height:r.height,parentHeight:p.height,top:r.top-p.top,bottom:p.bottom-r.bottom};});
    assert.ok(Math.abs(geometry.height-geometry.width*height/width)<1,`${kind} ${shape} ${viewport.width}: ${JSON.stringify(geometry)}`);
    assert.ok(Math.abs(geometry.top)<1&&Math.abs(geometry.bottom)<1);
    checks.push(`${kind}:${shape}:${viewport.width}:natural_ratio_no_bands`);
   }
   const slow=page.locator(`[data-case="${kind}-slow"] img`);await slow.scrollIntoViewIfNeeded();await expect.poll(()=>slow.evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
   const broken=page.locator(`[data-case="${kind}-broken"]`);await broken.scrollIntoViewIfNeeded();await expect(broken.getByRole('img',{name:'Эскиз не загрузился'})).toBeVisible();
   assert.ok((await broken.getByRole('img',{name:'Эскиз не загрузился'}).boundingBox()).height<130);
   assert.equal(await page.locator(`[data-case="${kind}-empty"] img`).count(),0);
  }
  await page.locator('[data-case="project-landscape"] button').click();assert.equal(await page.evaluate(()=>window.qa.opened),1);
  await page.locator('[data-case="product-landscape"] button').click();assert.equal(await page.evaluate(()=>window.qa.opened),2);
  await page.locator('[data-case="product-fullscreen"] button').click();await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button',{name:'Закрыть полноэкранный просмотр',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('#dragging').click();
  await expect(page.locator('[data-case="product-landscape"] button')).toBeDisabled();await expect(page.locator('[data-case="project-landscape"] button')).toBeDisabled();
  await page.locator('#dragging').click();
  await page.reload();await expect.poll(()=>page.locator('[data-case="product-landscape"] img').evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
  for(const kind of ['product','project'])for(const shape of ['landscape','square','portrait','slow','fullscreen']){
   const img=page.locator(`[data-case="${kind}-${shape}"] img`);await img.scrollIntoViewIfNeeded();await expect.poll(()=>img.evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
  }
  await page.locator('#dragging').scrollIntoViewIfNeeded();
  assert.deepEqual(errors,[]);
  const file=path.join(directory,`cards-${viewport.width}.png`);await page.screenshot({path:file,fullPage:true});screenshots.push(file);
  checks.push(`${viewport.width}:delayed_error_empty_click_dragging_cache`);
  await page.close();
 }
 const receipt={status:'PASS',mode:'real kanban components and CSS; synthetic PNG transport',checks,screenshots};await writeFile(path.join(directory,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
