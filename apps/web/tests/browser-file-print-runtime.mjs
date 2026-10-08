import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url), { chromium } = require('@playwright/test');
const { build } = createRequire(require.resolve('tsx/package.json'))('esbuild');
const sharp = require('sharp'), webRoot = fileURLToPath(new URL('../', import.meta.url));
const artifactRoot = new URL('../test-results/browser-file-print/', import.meta.url);
await mkdir(artifactRoot, { recursive:true });
const nativePreview = process.argv.includes('--native-preview');
const cases = [], requests = [];
function pdfBytes(label) {
 const stream=`BT /F1 24 Tf 72 720 Td (${label}) Tj ET`;
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
 let text='%PDF-1.4\n', offsets=[0];
 for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
 const xref=Buffer.byteLength(text);text+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
 for(const offset of offsets.slice(1))text+=`${String(offset).padStart(10,'0')} 00000 n \n`;
 return Buffer.from(text+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}
const pdfProject=pdfBytes('PROJECT116 SELECTED PDF'), pdfFinance=pdfBytes('FINANCE116 SELECTED PDF');
const images=new Map();
for(const [name,width,height] of [['tall',300,1200],['wide',1200,300],['square',500,500]]){
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/><rect x="0" y="0" width="${width}" height="20" fill="red"/><rect x="0" y="${height-20}" width="${width}" height="20" fill="green"/><rect x="0" y="20" width="20" height="${height-40}" fill="blue"/><rect x="${width-20}" y="20" width="20" height="${height-40}" fill="magenta"/><text x="30" y="65" font-size="24">ALL FOUR EDGES</text></svg>`;
 images.set(`image-${name}`, await sharp(Buffer.from(svg)).png().toBuffer());
}
const bundle=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{Toaster}from'sonner';import{FilePrintButton}from'./src/components/file-print-button';import*as printer from'./src/lib/browser-file-print';const root=createRoot(document.querySelector('#row'));window.fixture={...printer,unmount:()=>root.unmount(),render:file=>root.render(React.createElement('div',{onClick:()=>window.printMetrics.rowClicks++},React.createElement(FilePrintButton,{file}),React.createElement(Toaster)))};window.fixture.render({id:'image-wide',fileName:'Эскиз.png',mimeType:'image/png'});`,resolveDir:webRoot,loader:'tsx'},bundle:true,platform:'browser',format:'iife',jsx:'automatic',write:false,define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
const server=createServer((request,response)=>{
 const url=new URL(request.url,'http://127.0.0.1');
 if(url.pathname==='/runtime.js'){response.writeHead(200,{'Content-Type':'text/javascript'});response.end(bundle.outputFiles[0].contents);return;}
 if(url.pathname.startsWith('/api/')){
  requests.push({path:url.pathname,query:url.search,cookie:request.headers.cookie??''});
  const id=url.pathname.split('/').at(-1), isFinance=url.pathname.includes('/finance/');
  if(!request.headers.cookie?.includes('fixture=allowed')){response.writeHead(401,{'Content-Type':'application/json'});response.end('{"error":"Недоступно"}');return;}
  if(id==='denied'){response.writeHead(403,{'Content-Type':'application/json'});response.end('{"error":"Недоступно"}');return;}
  if(id==='login'){response.writeHead(200,{'Content-Type':'text/html'});response.end('<html>Login page</html>');return;}
  if(id==='redirect'){response.writeHead(302,{Location:'/login'});response.end();return;}
  let body, type;
  if(id==='pdf') {body=isFinance?pdfFinance:pdfProject;type='application/pdf';}
  else if(id==='broken-pdf'){body=Buffer.from('%PDF-1.7\nbroken');type='application/pdf';}
  else if(id==='bad-image'){body=Buffer.from('broken PNG');type='image/png';}
  else if(id==='svg'){body=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><script>parent.svgExecuted=true</script><rect width="100" height="100" fill="green"/></svg>');type='image/svg+xml';}
  else {body=images.get(id==='slow'?'image-wide':id);type='image/png';}
  if(!body){response.writeHead(404);response.end();return;}
  const send=()=>{response.writeHead(200,{'Content-Type':type,'Content-Disposition':type==='application/pdf'&&url.searchParams.get('view')==='1'?'inline':'attachment',...(isFinance?{'Content-Security-Policy':'sandbox'}:{})});response.end(body);};
  if(id==='slow'||nativePreview)setTimeout(send,300);else send();return;
 }
 response.writeHead(200,{'Content-Type':'text/html'});response.end('<!DOCTYPE html><title>CRM fixture</title><h1>CRM_CHROME_MUST_NOT_PRINT</h1><div id="row"></div><script>window.printMetrics??={calls:[],created:[],revoked:[],rowClicks:0};</script><script src="/runtime.js"></script>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const address=server.address(),base=`http://127.0.0.1:${address.port}`;
const browser=await chromium.launch({channel:'chromium',headless:!nativePreview,...(nativePreview?{args:['--window-position=-20000,-20000']}:{} )});
const context=await browser.newContext({viewport:{width:1440,height:900}});
await context.addCookies([{name:'fixture',value:'allowed',url:base}]);
if(!nativePreview)await context.addInitScript(()=>{
 if(window.top===window){window.printMetrics={calls:[],created:[],revoked:[],rowClicks:0};const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=blob=>{const url=create(blob);window.printMetrics.created.push(url);return url;};URL.revokeObjectURL=url=>{window.printMetrics.revoked.push(url);revoke(url);};}
 window.print=()=>{const image=document.querySelector('img'),metrics=window.parent.printMetrics;metrics.calls.push({url:location.href,contentType:document.contentType,title:document.title,text:document.body.textContent,image:image?{width:image.naturalWidth,height:image.naturalHeight,fit:getComputedStyle(image).objectFit,bodyWidth:document.body.style.width,css:document.head.textContent}:null});if(window.parent.autoAfterPrint!==false)queueMicrotask(()=>window.dispatchEvent(new Event('afterprint')));};
});
const page=await context.newPage();
const file=(id,mimeType='image/png',source)=>({id,fileName:`${id}.${mimeType==='application/pdf'?'pdf':'png'}`,mimeType,...(source?{source}:{})});
const record=(name,data={})=>{cases.push({name,...data});console.log(JSON.stringify({passed:name,...data}));};
async function reset(){await page.goto(base);await page.waitForFunction(()=>window.fixture);}
async function print(selected,options={}){await page.evaluate(async({selected,options})=>window.fixture.printViewableFile(selected,options),{selected,options});}
async function expectRejected(selected,options={},pattern){const result=await page.evaluate(async({selected,options})=>{try{await window.fixture.printViewableFile(selected,options);return {ok:true};}catch(error){return {ok:false,message:error.message,name:error.name};}},{selected,options});assert.equal(result.ok,false);if(pattern)assert.match(result.message,pattern);return result;}
async function settle(){await page.waitForFunction(()=>document.querySelectorAll('[data-file-print]').length===0);}
try{
 if(!nativePreview){
  await reset();await page.evaluate(selected=>window.fixture.render(selected),file('slow'));const button=page.getByRole('button',{name:'Распечатать slow.png'});await button.click();await page.waitForFunction(()=>document.querySelector('button')?.disabled);await page.evaluate(()=>document.querySelector('button').click());assert.equal(await button.getAttribute('aria-busy'),'true');await settle();await page.waitForFunction(()=>window.printMetrics.calls.length===1);await page.waitForFunction(()=>!document.querySelector('button').disabled);assert.equal(await page.evaluate(()=>window.printMetrics.rowClicks),0);assert.equal(requests.filter(r=>r.path.endsWith('/slow')).length,1);record('busy, rapid double click and stopPropagation');
  for(const [id,width,height]of[['image-tall',300,1200],['image-wide',1200,300],['image-square',500,500]]){await reset();await print(file(id));await settle();const metrics=await page.evaluate(()=>window.printMetrics);assert.equal(metrics.calls.length,1);assert.deepEqual([metrics.calls[0].image.width,metrics.calls[0].image.height],[width,height]);assert.equal(metrics.calls[0].image.fit,'contain');assert.doesNotMatch(metrics.calls[0].text,/CRM_CHROME/);assert.equal(metrics.revoked.length,1);record(`whole original ${id}`);}
  for(const source of ['project','finance']){await reset();await print(file('pdf','application/pdf',source));await settle();const metrics=await page.evaluate(()=>window.printMetrics);assert.equal(metrics.calls.length,1);assert.equal(metrics.calls[0].contentType,'application/pdf');assert.doesNotMatch(metrics.calls[0].text,/CRM_CHROME/);assert.equal(metrics.revoked.length,1);record(`PDF loaded before print: ${source}`);}
  for(const[id,mime]of[['denied','image/png'],['login','image/png'],['redirect','image/png'],['broken-pdf','application/pdf'],['bad-image','image/png']]){await reset();await expectRejected(file(id,mime));const metrics=await page.evaluate(()=>window.printMetrics);assert.equal(metrics.calls.length,0);assert.equal(await page.locator('[data-file-print]').count(),0);assert.equal(metrics.created.length,metrics.revoked.length);record(`error before print: ${id}`);}
  await reset();const canceled=await page.evaluate(async selected=>{const controller=new AbortController();const result=window.fixture.printViewableFile(selected,{signal:controller.signal}).catch(error=>error.name);setTimeout(()=>controller.abort(),20);return result;},file('slow'));assert.equal(canceled,'AbortError');await new Promise(resolve=>setTimeout(resolve,350));assert.equal(await page.evaluate(()=>window.printMetrics.calls.length),0);assert.equal(await page.locator('[data-file-print]').count(),0);record('cancel preparation, no late print');
  await reset();await expectRejected(file('slow'),{prepareTimeoutMs:25},/время ожидания/i);await new Promise(resolve=>setTimeout(resolve,350));assert.equal(await page.evaluate(()=>window.printMetrics.calls.length),0);record('preparation timeout, no late print');
  await reset();const concurrent=await page.evaluate(async selected=>{const first=window.fixture.printViewableFile(selected);const second=window.fixture.printViewableFile(selected).then(()=>'',error=>error.message);await first;return second;},file('slow'));assert.match(concurrent,/уже готовится/i);assert.equal(await page.evaluate(()=>window.printMetrics.calls.length),1);record('global duplicate preparation guard');
  await reset();await page.evaluate(()=>window.autoAfterPrint=false);await print(file('image-wide'),{resourceTimeoutMs:50});assert.equal(await page.locator('[data-file-print]').count(),1);await settle();assert.equal(await page.evaluate(()=>window.printMetrics.revoked.length),1);record('bounded retained context cleanup');
  await reset();await page.evaluate(()=>window.autoAfterPrint=false);await print(file('image-wide'));await print(file('image-tall'));assert.equal(await page.locator('[data-file-print]').count(),1);assert.equal(await page.evaluate(()=>window.printMetrics.revoked.length),1);await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));await settle();assert.equal(await page.evaluate(()=>window.printMetrics.revoked.length),2);record('next print and pagehide cleanup: max one iframe');
  await reset();await print(file('svg','image/svg+xml'));await settle();assert.equal(await page.evaluate(()=>!!window.svgExecuted),false);record('SVG stays image, scripts do not execute');
  await reset();await page.evaluate(()=>{const original=document.createElement.bind(document);document.createElement=(tag,...rest)=>{const element=original(tag,...rest);if(tag==='iframe')Object.defineProperty(element,'contentDocument',{get:()=>document});return element;};});await expectRejected(file('pdf','application/pdf'),{},/PDF/i);assert.equal(await page.evaluate(()=>window.printMetrics.calls.length),0);assert.equal(await page.locator('[data-file-print]').count(),0);record('HTML context cannot masquerade as loaded PDF');
  await reset();await page.evaluate(()=>Object.defineProperty(navigator,'pdfViewerEnabled',{value:false}));await expectRejected(file('pdf','application/pdf'),{},/отключён/i);assert.equal(await page.evaluate(()=>window.printMetrics.calls.length),0);assert.equal(await page.locator('[data-file-print]').count(),0);record('disabled native PDF viewer never prints HTML');
  await reset();await page.evaluate(()=>window.autoAfterPrint=false);await page.getByRole('button',{name:'Распечатать Эскиз.png'}).click();await page.waitForFunction(()=>window.printMetrics.calls.length===1);assert.equal(await page.locator('[data-file-print]').count(),1);await page.evaluate(()=>window.fixture.unmount());await settle();assert.equal(await page.evaluate(()=>window.printMetrics.revoked.length),1);record('button unmount disposes retained print resources');
  const protectedRequests=requests.filter(request=>request.path.startsWith('/api/'));assert.ok(protectedRequests.every(request=>request.cookie.includes('fixture=allowed')));assert.ok(protectedRequests.filter(request=>request.path.endsWith('/pdf')).every(request=>request.query==='?view=1'));record('current same-origin auth and protected original routes');
 }else{
  const cdp=await browser.newBrowserCDPSession();
  const selectedCases=[file('pdf','application/pdf','project'),file('pdf','application/pdf','finance'),file('image-tall'),file('image-wide')].filter(selected=>!process.argv.includes('--pdf-only')||selected.mimeType==='application/pdf');
  for(const selected of selectedCases){
   await reset();await page.evaluate(selected=>window.fixture.render(selected),selected);const requestsBefore=requests.length;await page.getByRole('button',{name:`Распечатать ${selected.fileName}`}).click();await page.evaluate(()=>document.querySelector('button')?.click());
   let target;for(let attempt=0;attempt<100;attempt++){target=(await cdp.send('Target.getTargets')).targetInfos.find(info=>info.url==='chrome://print/');if(target)break;await new Promise(resolve=>setTimeout(resolve,100));}assert.ok(target,'real native chrome://print target must appear');
   const{sessionId}=await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:false});let sequence=1;const pending=new Map();const onMessage=event=>{if(event.sessionId!==sessionId)return;const payload=JSON.parse(event.message),reply=pending.get(payload.id);if(reply){pending.delete(payload.id);reply(payload);}};cdp.on('Target.receivedMessageFromTarget',onMessage);
   async function raw(method,params={}){const id=sequence++,reply=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout ${method}`));},5000);pending.set(id,payload=>{clearTimeout(timer);resolve(payload);});});await cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method,params})});return reply;}
   let preview;for(let attempt=0;attempt<100;attempt++){const result=await raw('Runtime.evaluate',{expression:`(()=>{const app=document.querySelector('print-preview-app'),sidebar=app?.shadowRoot?.querySelector('print-preview-sidebar'),area=app?.shadowRoot?.querySelector('print-preview-preview-area');return {state:sidebar?.getAttribute('state'),pageCount:sidebar?.getAttribute('page-count'),isPdf:sidebar?.hasAttribute('is-pdf'),error:sidebar?.getAttribute('error'),previewLoaded:area?.shadowRoot?.querySelector('print-preview-margin-control-container')?.hasAttribute('preview-loaded')};})()`,returnByValue:true});preview=result.result?.result?.value;if(preview?.state==='1'&&preview.previewLoaded)break;await new Promise(resolve=>setTimeout(resolve,100));}
   assert.equal(requests.length-requestsBefore,1,'rapid second click must not fetch/print again');
   assert.equal(preview.pageCount,'1');assert.equal(preview.error,'0');assert.equal(preview.previewLoaded,true);assert.equal(preview.isPdf,selected.mimeType==='application/pdf');
   await raw('Page.bringToFront');
   // Дополнительный compositor settle для снимка, не критерий готовности/успеха PDF.
   await new Promise(resolve=>setTimeout(resolve,2500));
   const render=await raw('Runtime.evaluate',{expression:`(()=>{const app=document.querySelector('print-preview-app'),area=app?.shadowRoot?.querySelector('print-preview-preview-area'),sidebar=app?.shadowRoot?.querySelector('print-preview-sidebar');return {area:area?.shadowRoot?.innerHTML,sidebar:sidebar?.shadowRoot?.innerHTML,focus:document.hasFocus()};})()`,returnByValue:true});
   await writeFile(new URL(`native-${selected.source??'project'}-${selected.id}-dom.json`,artifactRoot),JSON.stringify(render.result?.result?.value,null,2));
   const screenshotName=`native-${selected.source??'project'}-${selected.id}.png`,capture=await raw('Page.captureScreenshot',{format:'png'});await writeFile(new URL(screenshotName,artifactRoot),Buffer.from(capture.result.data,'base64'));
   const cancel=await raw('Runtime.evaluate',{expression:`(()=>{function find(root){for(const button of root.querySelectorAll('button,cr-button'))if(/^(Cancel|Отмена)$/.test(button.textContent.trim()))return button;for(const element of root.querySelectorAll('*'))if(element.shadowRoot){const match=find(element.shadowRoot);if(match)return match;}}const button=find(document);if(!button)return false;button.click();return true;})()`,returnByValue:true});assert.equal(cancel.result.result.value,true,'cancel native preview without sending printer job');
   for(let attempt=0;attempt<50;attempt++){if(!(await cdp.send('Target.getTargets')).targetInfos.some(info=>info.targetId===target.targetId))break;await new Promise(resolve=>setTimeout(resolve,100));}
   assert.equal((await cdp.send('Target.getTargets')).targetInfos.some(info=>info.targetId===target.targetId),false);cdp.off('Target.receivedMessageFromTarget',onMessage);
   record(`native preview ${selected.source??'project'} ${selected.id}`,{preview,screenshot:screenshotName,canceled:true});
  }
 }
 await writeFile(new URL(nativePreview?'native-preview.json':'runtime.json',artifactRoot),JSON.stringify({kind:nativePreview?'actual-native-preview':'controlled-print-spy',browser:browser.version(),cases,requests},null,2));
 console.log(JSON.stringify({result:'passed',kind:nativePreview?'actual-native-preview':'controlled-print-spy',caseCount:cases.length}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
