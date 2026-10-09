import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium,expect} from '@playwright/test';
import sharp from 'sharp';

const web=process.cwd(),require=createRequire(import.meta.url),{build}=createRequire(require.resolve('tsx/package.json'))('esbuild');
const directory=path.resolve(web,'../../.playwright-mcp/files115');await mkdir(directory,{recursive:true});
const files=[
 {id:'image',fileName:'Очень_длинное_полное_исходное_название_эскиза_изделия_без_сокращения_и_скрытия_расширения.png',mimeType:'image/png',canDelete:true},
 {id:'pdf',fileName:'Проверка_счёт.pdf',mimeType:'application/pdf',canDelete:true},
 {id:'video',fileName:'Монтаж.mp4',mimeType:'video/mp4',canDelete:true},
 {id:'cad',fileName:'Шкаф.b3d',mimeType:'application/octet-stream',canDelete:true},
 {id:'finance',fileName:'Финансовый_документ.pdf',mimeType:'application/pdf',source:'finance',canDelete:true},
 {id:'finance-image',fileName:'Чек.jpg',mimeType:'image/jpeg',source:'finance',canDelete:false},
 {id:'denied',fileName:'Чужой_файл.pdf',mimeType:'application/pdf',canDelete:false},
 {id:'linked',fileName:'Связанный_отчёт.pdf',mimeType:'application/pdf',source:'finance',canDelete:false},
 {id:'success',fileName:'Удаляемый.docx',mimeType:'application/octet-stream',canDelete:true},
 {id:'fail',fileName:'Не_удаляется.txt',mimeType:'text/plain',canDelete:true},
 {id:'throw',fileName:'Сбой.docx',mimeType:'application/octet-stream',canDelete:true},
];
const image=await sharp({create:{width:800,height:500,channels:3,background:'#497b89'}}).png().toBuffer();
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {FileList} from './src/components/file-list';
window.qa={parentClicks:0,parentKeys:0,deleteCalls:[],refreshes:0,busy:[]};
function App(){const [files,setFiles]=React.useState(${JSON.stringify(files)});return <main style={{padding:16,maxWidth:720}}><div data-parent tabIndex={0} onClick={()=>window.qa.parentClicks++} onKeyDown={e=>{if(e.key==='Enter')window.qa.parentKeys++;}}><FileList files={files} onBusyChange={busy=>window.qa.busy.push(busy)} onDelete={async file=>{window.qa.deleteCalls.push(file.id);if(file.id==='fail')return {ok:false,error:'Сервер отказал в удалении'};if(file.id==='throw')throw Error('NETWORK');await new Promise(resolve=>window.qa.resolveDelete=resolve);return {ok:true};}} onDeleted={file=>{window.qa.refreshes++;setFiles(previous=>previous.filter(item=>item.id!==file.id));}}/></div></main>;}
createRoot(document.getElementById('root')).render(<App/>);`;
const bundle=await build({stdin:{contents:entry,loader:'tsx',resolveDir:web},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'}});
const postcss=createRequire(require.resolve('@tailwindcss/postcss'))('postcss'),tailwind=require('@tailwindcss/postcss');
const css=(await postcss([tailwind({base:web})]).process(await readFile(path.join(web,'src/app/globals.css'),'utf8'),{from:path.join(web,'src/app/globals.css')})).css;
const server=createServer((request,response)=>{
 const url=new URL(request.url,'http://localhost');
 if(url.pathname.startsWith('/api/')){
  const file=files.find(file=>file.id===url.pathname.split('/').at(-1));
  if(!file){response.writeHead(404);response.end();return;}
  response.setHeader('content-type',file.mimeType);response.setHeader('content-disposition',`${file.mimeType.startsWith('image/')?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
  response.end(file.mimeType.startsWith('image/')?image:Buffer.from('QA document payload'));return;
 }
 response.setHeader('content-type',url.pathname==='/app.js'?'text/javascript':url.pathname==='/app.css'?'text/css':'text/html');
 response.end(url.pathname==='/app.js'?bundle.outputFiles[0].text:url.pathname==='/app.css'?css:'<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body style="font-family:Arial,sans-serif"><div id="root"></div><script src="/app.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true,channel:'chromium'}),checks=[],screenshots=[];
try{
 for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:360,height:800}]){
  const page=await browser.newPage({viewport,acceptDownloads:true}),errors=[],popups=[];
  page.on('pageerror',error=>errors.push(String(error)));page.on('popup',popup=>popups.push(popup));await page.goto(origin);
  const row=id=>page.locator(`[data-file-list-row="${id}"]`),popup=page.locator('[data-slot="popover-content"]');
  await expect(row('image')).toBeVisible();assert.equal(await page.locator('img,video,iframe').count(),0);
  assert.equal(await row('image').innerText(),files[0].fileName);
  const layout=await row('image').evaluate(element=>({right:element.getBoundingClientRect().right,viewport:innerWidth,scroll:document.documentElement.scrollWidth,width:innerWidth,wrap:element.querySelector('button').scrollHeight,client:element.querySelector('button').clientHeight}));
  assert.ok(layout.right<=layout.viewport);assert.ok(layout.scroll<=layout.width);assert.equal(layout.wrap,layout.client);
  for(const id of ['denied','linked','finance-image'])await expect(row(id).getByRole('button',{name:/Удалить файл/})).toBeDisabled();
  const listShot=path.join(directory,`list-${viewport.width}.png`);await page.screenshot({path:listShot});screenshots.push(listShot);
  for(const id of ['pdf','video','cad','finance']){
   const file=files.find(file=>file.id===id),downloadPromise=page.waitForEvent('download');await row(id).getByRole('link',{name:file.fileName,exact:true}).click();const download=await downloadPromise;
   assert.equal(download.suggestedFilename(),file.fileName);assert.equal(download.url(),origin+(file.source==='finance'?'/api/finance/documents/':'/api/files/')+id);
   assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.locator('iframe,video').count(),0);
  }
  const keyboardDownload=page.waitForEvent('download');await row('pdf').getByRole('link').focus();await page.keyboard.press('Enter');await keyboardDownload;
  for(const id of ['image','finance-image']){
   await row(id).getByRole('button',{name:files.find(file=>file.id===id).fileName,exact:true}).focus();await page.keyboard.press('Enter');
   await expect(page.getByRole('dialog')).toBeVisible();const img=page.getByRole('dialog').locator('img');await expect.poll(()=>img.evaluate(element=>element.complete&&element.naturalWidth>0)).toBe(true);
   assert.equal(await img.getAttribute('src'),id==='finance-image'?'/api/finance/documents/finance-image':'/api/files/image');assert.equal(await img.evaluate(element=>getComputedStyle(element).objectFit),'contain');
   await page.getByRole('button',{name:'Закрыть полноэкранный просмотр',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  assert.equal(await page.evaluate(()=>window.qa.parentClicks),0);assert.equal(await page.evaluate(()=>window.qa.parentKeys),0);assert.equal(popups.length,0);
  const trash=row('success').getByRole('button',{name:/Удалить файл/});await trash.focus();await page.keyboard.press('Enter');await expect(popup).toBeVisible();
  await expect(popup.getByRole('button',{name:'Отмена',exact:true})).toBeFocused();await popup.getByRole('button',{name:'Отмена',exact:true}).click();await expect(popup).toHaveCount(0);assert.deepEqual(await page.evaluate(()=>window.qa.deleteCalls),[]);
  await trash.click();await expect(popup).toBeVisible();await page.keyboard.press('Escape');await expect(popup).toHaveCount(0);
  await trash.click();const popupBox=await popup.boundingBox();assert.ok(popupBox.width<viewport.width&&popupBox.height<330&&popupBox.x>=0&&popupBox.y>=0);
  await expect.poll(()=>popup.evaluate(element=>getComputedStyle(element).opacity)).toBe('1');
  const popupShot=path.join(directory,`confirm-${viewport.width}.png`);await page.screenshot({path:popupShot});screenshots.push(popupShot);
  await popup.getByRole('button',{name:'Удалить',exact:true}).evaluate(button=>{button.click();button.click();});
  await expect(popup.getByRole('button',{name:'Удаление…',exact:true})).toBeDisabled();await expect(popup.getByRole('button',{name:'Отмена',exact:true})).toBeDisabled();await expect(row('pdf').getByRole('button',{name:/Удалить файл/})).toBeDisabled();
  assert.deepEqual(await page.evaluate(()=>window.qa.deleteCalls),['success']);await page.keyboard.press('Escape');await expect(popup).toBeVisible();await page.mouse.click(2,2);await expect(popup).toBeVisible();
  await page.evaluate(()=>window.qa.resolveDelete());await expect(row('success')).toHaveCount(0);await expect(popup).toHaveCount(0);assert.equal(await page.evaluate(()=>window.qa.refreshes),1);assert.deepEqual(await page.evaluate(()=>window.qa.busy),[true,false]);
  for(const [id,message] of [['fail','Сервер отказал в удалении'],['throw','Не удалось подтвердить удаление. Повторите попытку.']]){
   await row(id).getByRole('button',{name:/Удалить файл/}).click();await popup.getByRole('button',{name:'Удалить',exact:true}).click();await expect(popup.getByRole('alert')).toHaveText(message);await expect(row(id)).toBeVisible();
   assert.equal(await page.evaluate(()=>window.qa.refreshes),1);await popup.getByRole('button',{name:'Отмена',exact:true}).click();await expect(popup).toHaveCount(0);
  }
  assert.equal(await page.evaluate(()=>window.qa.parentClicks),0);assert.equal(await page.evaluate(()=>window.qa.parentKeys),0);assert.deepEqual(errors,[]);
  checks.push(`${viewport.width}:original_names_no_metadata_thumbnails_no_overflow`,` ${viewport.width}:ordinary_finance_pdf_video_cad_downloads_keyboard_no_parent_activation`.trim(),`${viewport.width}:original_image_fullscreen_contain`,`${viewport.width}:permissions_disabled_cancel_keyboard_anchored_confirmation`,`${viewport.width}:pending_single_request_no_close_success_refresh_failure_preserves_row`);await page.close();
 }
 const receipt={status:'PASS',phase:'A shared components only; actual React/Base UI/Tailwind with synthetic protected transport; no DB calls',checks,screenshots};await writeFile(path.join(directory,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}