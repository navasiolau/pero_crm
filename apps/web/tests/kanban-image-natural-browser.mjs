import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium,expect} from '@playwright/test';
import sharp from 'sharp';

const web=process.cwd(),require=createRequire(import.meta.url),{build}=createRequire(require.resolve('tsx/package.json'))('esbuild');
const directory=path.resolve(web,'../../.playwright-mcp/kanban114');
await mkdir(directory,{recursive:true});
const dimensions={landscape:[1600,400],square:[800,800],portrait:[200,2000]};
const assets=Object.fromEntries(await Promise.all(Object.entries(dimensions).map(async([id,[width,height]])=>{
 const radius=Math.min(width,height)/6;
 const svg=`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="${{landscape:'#55b6c8',square:'#f8ca77',portrait:'#9bb77b'}[id]}"/><path d="M0 0L${width} ${height}M${width} 0L0 ${height}" stroke="#293241" stroke-width="${radius/2}"/><circle cx="${width/2}" cy="${height/2}" r="${radius}" fill="white" stroke="#293241" stroke-width="${radius/8}"/><circle cx="${width/2}" cy="${height/2}" r="${radius/3}" fill="#ee6c4d"/></svg>`;
 return [id,await sharp(Buffer.from(svg)).png().toBuffer()];
})));
const entry=`
 import React from 'react';import {createRoot} from 'react-dom/client';
 import {ProductKanbanCard} from './src/components/product-kanban-card';import {ProjectKanbanCard} from './src/components/project-kanban-card';import {ProductHeroImage} from './src/components/product-hero-image';
 window.qa={opened:0,bubbled:0};function App(){const [dragging,setDragging]=React.useState(false);return <><button id="dragging" onClick={()=>setDragging(!dragging)}>Переключить dragging</button><main className="grid grid-cols-1 gap-4 md:grid-cols-2" style={{maxWidth:616,margin:16,alignItems:"start"}}>{["landscape","square","portrait","slow","fullscreen","broken","empty"].flatMap(shape=>["product","project"].map(kind=>{const cover=shape==="empty"?null:{id:shape,fileName:shape+".png",mimeType:"image/png",hasThumb:true};return <div data-case={kind+"-"+shape} key={kind+shape} onClick={()=>window.qa.bubbled++}>{kind==="product"?<ProductKanbanCard product={{number:"224.2",title:shape+" — изделие",statusChangedAt:new Date().toISOString(),expectedPrice:"1000",quantity:3,engineerName:"Инженер",sketchFile:cover}} showAmount currency="BYN" dragging={dragging} coverAction={shape==="fullscreen"?{type:"fullscreen"}:{type:"navigate",onOpen:()=>window.qa.opened++}}/>:<ProjectKanbanCard project={{id:"j",number:"224",title:shape+" — проект",clientName:"Проверка",currency:"BYN",totalPrice:"3000",stageChangedAt:new Date().toISOString(),coverFile:cover,hasMaterialShortage:false}} showAmount dragging={dragging} onOpen={()=>window.qa.opened++}/>}</div>;}))}</main><div data-detail style={{width:240,height:320}}><ProductHeroImage sketch={{id:"portrait",fileName:"original.png",mimeType:"image/png",hasThumb:true}} preview="cover" className="h-full w-full"/></div></>;}createRoot(document.getElementById("root")).render(<App/>);
 `;
const bundle=await build({stdin:{contents:entry,loader:'tsx',resolveDir:web},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'}});
const postcss=createRequire(require.resolve('@tailwindcss/postcss'))('postcss'),tailwind=require('@tailwindcss/postcss');
const css=(await postcss([tailwind({base:web})]).process(await readFile(path.join(web,'src/app/globals.css'),'utf8'),{from:path.join(web,'src/app/globals.css')})).css;
let slowReleased=false;const slowResponses=[];
const server=createServer((request,response)=>{
 const url=new URL(request.url,'http://localhost');
 if(url.pathname==='/release-slow'){slowReleased=true;for(const pending of slowResponses)pending.end(assets.landscape);slowResponses.length=0;response.end('ok');return;}
 if(url.pathname.startsWith('/api/files/')){
  const id=url.pathname.split('/').at(-1);
  if(id==='broken'){response.writeHead(404);response.end();return;}
  response.setHeader('content-type','image/png');response.setHeader('cache-control','public,max-age=3600');
  if(id==='slow'&&!slowReleased)slowResponses.push(response);else response.end(id==='slow'||id==='fullscreen'?assets.landscape:assets[id]);
  return;
 }
 response.setHeader('content-type',url.pathname==='/app.js'?'text/javascript':url.pathname==='/app.css'?'text/css':'text/html');
 response.end(url.pathname==='/app.js'?bundle.outputFiles[0].text:url.pathname==='/app.css'?css:'<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body style="font-family:Arial,sans-serif"><div id="root"></div><script src="/app.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true,channel:'chromium'}),checks=[],screenshots=[];
async function imageGeometry(img){return img.evaluate(image=>{
 const r=image.getBoundingClientRect(),p=image.parentElement.getBoundingClientRect(),style=getComputedStyle(image);
 return {width:r.width,height:r.height,parentWidth:p.width,parentHeight:p.height,left:r.left-p.left,top:r.top-p.top,right:p.right-r.right,bottom:p.bottom-r.bottom,fit:style.objectFit,position:style.objectPosition,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight};
});}
function fixedFrame(geometry,label){
 assert.ok(geometry.width>0&&Math.abs(geometry.height-geometry.width*4/3)<1,`${label}: ${JSON.stringify(geometry)}`);
 for(const edge of ['left','top','right','bottom'])assert.ok(Math.abs(geometry[edge])<1,`${label} ${edge}: ${JSON.stringify(geometry)}`);
}
try{
 for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:360,height:800}]){
  slowReleased=false;
  const page=await browser.newPage({viewport}),errors=[];page.on('pageerror',error=>errors.push(String(error)));

  await page.goto(origin,{waitUntil:'domcontentloaded'});
  for(const kind of ['product','project']){
   const slow=page.locator(''+ '[data-case=' + String.fromCharCode(34) + kind + '-slow' + String.fromCharCode(34) + '] img');await slow.scrollIntoViewIfNeeded();
   fixedFrame(await imageGeometry(slow),kind+' loading '+viewport.width);assert.equal(await slow.evaluate(image=>image.complete),false);
  }
  await page.request.get(origin+'/release-slow');
  for(const kind of ['product','project']){
   for(const [shape,[width,height]] of Object.entries(dimensions)){
    const img=page.locator(`[data-case="${kind}-${shape}"] img`);
    await img.scrollIntoViewIfNeeded();await expect.poll(()=>img.evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
    const geometry=await imageGeometry(img);fixedFrame(geometry,`${kind} ${shape} ${viewport.width}`);
    assert.equal(geometry.fit,'cover');assert.equal(geometry.position,'50% 50%');
    assert.equal(geometry.naturalWidth,width);assert.equal(geometry.naturalHeight,height);
    checks.push(`${kind}:${shape}:${viewport.width}:3x4_center_crop_no_gutters`);
   }
   const slow=page.locator(`[data-case="${kind}-slow"] img`);await slow.scrollIntoViewIfNeeded();
   await expect.poll(()=>slow.evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);fixedFrame(await imageGeometry(slow),`${kind} loaded ${viewport.width}`);
   const broken=page.locator(`[data-case="${kind}-broken"]`);await broken.scrollIntoViewIfNeeded();
   const placeholder=broken.getByRole('img',{name:'Эскиз не загрузился'});await expect(placeholder).toBeVisible();
   const box=await placeholder.boundingBox();assert.ok(Math.abs(box.height-box.width*4/3)<1);
   const empty=page.locator(`[data-case="${kind}-empty"]`);assert.equal(await empty.locator('img').count(),0);assert.equal(await empty.getByRole('img').count(),0);
   assert.ok((await empty.boundingBox()).height<200);
  }
  const detail=page.locator('[data-detail] img');await detail.scrollIntoViewIfNeeded();await expect.poll(()=>detail.evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
  assert.equal((await imageGeometry(detail)).fit,'contain');assert.equal(await detail.getAttribute('src'),'/api/files/portrait?preview=cover');
  await page.locator('[data-case="project-landscape"] button').click();assert.equal(await page.evaluate(()=>window.qa.opened),1);
  await page.locator('[data-case="product-landscape"] button').click();assert.equal(await page.evaluate(()=>window.qa.opened),2);assert.equal(await page.evaluate(()=>window.qa.bubbled),0);
  await page.locator('[data-case="product-fullscreen"] button').click();await expect(page.getByRole('dialog')).toBeVisible();
  const fullImage=page.getByRole('dialog').locator('img');await expect.poll(()=>fullImage.evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
  assert.equal(await fullImage.getAttribute('src'),'/api/files/fullscreen');assert.equal((await imageGeometry(fullImage)).fit,'contain');
  await page.getByRole('button',{name:'Закрыть полноэкранный просмотр',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('#dragging').click();
  await expect(page.locator('[data-case="product-landscape"] button')).toBeDisabled();await expect(page.locator('[data-case="project-landscape"] button')).toBeDisabled();
  for(const kind of ['product','project']){
   const img=page.locator(`[data-case="${kind}-landscape"] img`);
   assert.equal(await img.evaluate(image=>getComputedStyle(image).objectFit),'cover');
   const box=await img.evaluate(image=>({width:image.offsetWidth,height:image.offsetHeight}));assert.ok(Math.abs(box.height-box.width*4/3)<1);
  }
  await page.locator('#dragging').click();await page.setViewportSize({width:viewport.width-20,height:viewport.height});
  for(const kind of ['product','project'])fixedFrame(await imageGeometry(page.locator(`[data-case="${kind}-portrait"] img`)),`${kind} resized ${viewport.width}`);
  await page.setViewportSize(viewport);
  await page.reload({waitUntil:'domcontentloaded'});
  for(const kind of ['product','project'])for(const shape of ['landscape','square','portrait','slow','fullscreen']){
   const img=page.locator(`[data-case="${kind}-${shape}"] img`);await img.scrollIntoViewIfNeeded();await expect.poll(()=>img.evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);fixedFrame(await imageGeometry(img),`${kind} cached ${shape}`);
  }
  await page.locator('#dragging').scrollIntoViewIfNeeded();assert.deepEqual(errors,[]);
  const file=path.join(directory,`cards-${viewport.width}.png`);await page.screenshot({path:file,fullPage:true});screenshots.push(file);
  const viewportFile=path.join(directory,'viewport-cards-'+viewport.width+'.png');await page.screenshot({path:viewportFile});screenshots.push(viewportFile);
  checks.push(`${viewport.width}:delayed_error_empty_detail_fullscreen_click_dragging_resize_cache`);await page.close();
 }
 const receipt={status:'PASS',mode:'actual React kanban components and Tailwind CSS; synthetic PNG transport; no DB mutations',checks,screenshots};
 await writeFile(path.join(directory,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
}finally{for(const pending of slowResponses)pending.destroy();await browser.close();await new Promise(resolve=>server.close(resolve));}