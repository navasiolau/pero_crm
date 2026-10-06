import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium,expect} from '@playwright/test';
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve('tsx/package.json'))('esbuild');
const web=process.cwd(),directory=path.resolve(web,'../../.playwright-mcp/percentage90');
await mkdir(directory,{recursive:true});
const stub={
 'next/navigation':'export const useRouter=()=>({refresh(){}});',
 '@/components/product-inline-provider':'export const useOptionalProductInline=()=>null;',
 '@/server/product-percentage-pay/actions':'export const retryProductPercentageAction=async()=>({ok:true});',
 '@/lib/independent-product-percentage-action':`
  window.qa={pending:[],calls:[],reply(kind="saved"){const item=this.pending.shift();if(!item)throw Error("NO_PENDING");const input=item.input;if(kind==="lost"){item.reject(Error("NETWORK"));return;}item.resolve(kind==="conflict"?{ok:false,kind:"conflict",currentValue:"5",currentRevision:20,error:"QA_CONFLICT"}:{ok:true,kind:"saved",field:input.field,value:input.value,revision:input.expectedRevision+1,clientMutationId:input.clientMutationId,noOp:false,repeated:false});}};
  export function invokeProductPercentagePatch(input){window.qa.calls.push(input);return new Promise((resolve,reject)=>window.qa.pending.push({input,resolve,reject}));}
 `
};
const entry=`
 import React from 'react';import {createRoot} from 'react-dom/client';
 import {SinglePercentageRow} from './src/app/(app)/products/[id]/product-percentage-panel';
 const people={ENGINEERING:{id:"e",name:"Инженер",roles:["ENGINEER"]},ASSEMBLY:{id:"w",name:"Сборщик",roles:["WORKER"]},INSTALLATION:{id:"i",name:"Монтажник",roles:["MOUNTER"]}};
 function App(){return <main className="p-4 space-y-4">{Object.keys(people).map(kind=>{const p=people[kind],section={kind,state:"DRAFT",hasConfiguration:true,currentRatePercent:"5",ratePercent:"5",unitPrice:"1000",price:"1000",quantity:3,productTotal:"3000",calculationVersion:4,productCurrency:"BYN",payrollCurrency:null,total:kind==="ENGINEERING"?"50":"150",members:[],ownMember:null,revision:1,canManage:true,canTransfer:false,legacyPaidSummary:null,skippedSnapshot:null,transferCandidates:[],assignee:{userId:p.id,name:p.name,active:true,eligible:true},recipientCandidates:[{userId:p.id,name:p.name}]};return <SinglePercentageRow key={kind} productId="p" kind={kind} section={section} assignedEngineerId="e" canManage canViewAll candidates={[{...p,active:true}]} />;})}</main>;}
 createRoot(document.getElementById('root')).render(<App/>);
 `;
const bundle=await build({stdin:{contents:entry,loader:'tsx',resolveDir:web},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'qa-transport-only',setup(builder){builder.onResolve({filter:/.*/},args=>Object.hasOwn(stub,args.path)?{path:args.path,namespace:'qa'}:undefined);builder.onLoad({filter:/.*/,namespace:'qa'},args=>({contents:stub[args.path],loader:'js'}));}}]});
const postcss=createRequire(require.resolve('@tailwindcss/postcss'))('postcss'),tailwind=require('@tailwindcss/postcss');
const css=(await postcss([tailwind({base:web})]).process(await readFile(path.join(web,'src/app/globals.css'),'utf8'),{from:path.join(web,'src/app/globals.css')})).css;
const server=createServer((request,response)=>{response.setHeader('content-type',request.url==='/app.js'?'text/javascript':request.url==='/app.css'?'text/css':'text/html');response.end(request.url==='/app.js'?bundle.outputFiles[0].text:request.url==='/app.css'?css:'<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,channel:'chromium'});
const checks=[],screenshots=[],errors=[];
try{
 for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:360,height:800}]){
  const page=await browser.newPage({viewport});page.on('pageerror',error=>errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  for(const [kind,multiplier] of [['ENGINEERING',10],['ASSEMBLY',30],['INSTALLATION',30]]){
   const row=page.locator(`[data-single-percentage-kind="${kind}"]`),input=row.locator('input').first(),amount=row.locator('[data-percentage-amount]');
   await input.fill('6');await expect(amount).toContainText(String(6*multiplier));assert.equal(await page.evaluate(()=>window.qa.pending.length),0);
   await input.press('Enter');await expect.poll(()=>page.evaluate(()=>window.qa.pending.length)).toBe(1);
   await input.fill('7');await input.press('Enter');await expect(amount).toContainText(String(7*multiplier));
   await page.evaluate(()=>window.qa.reply());await expect(input).toHaveValue('7');await expect(amount).toContainText(String(7*multiplier));
   await expect.poll(()=>page.evaluate(()=>window.qa.pending.length)).toBe(1);await page.evaluate(()=>window.qa.reply());
   await input.press('ArrowUp');await expect(input).toHaveValue('7.5');await expect(amount).toContainText(String(7.5*multiplier));
   await expect.poll(()=>page.evaluate(()=>window.qa.pending.length)).toBe(1);await page.evaluate(()=>window.qa.reply());
   await row.getByRole('button',{name:'Процент, %: уменьшить на 0.5'}).click();await expect(input).toHaveValue('7');await expect(amount).toContainText(String(7*multiplier));
   await expect.poll(()=>page.evaluate(()=>window.qa.pending.length)).toBe(1);await page.evaluate(()=>window.qa.reply());
   await input.fill('8');await input.press('Enter');await expect.poll(()=>page.evaluate(()=>window.qa.pending.length)).toBe(1);
   const envelope=await page.evaluate(()=>window.qa.pending[0].input);
   await page.evaluate(()=>window.qa.reply('lost'));await row.getByRole('button',{name:'Повторить сохранение'}).click();
   await expect.poll(()=>page.evaluate(()=>window.qa.pending.length)).toBe(1);assert.deepEqual(await page.evaluate(()=>window.qa.pending[0].input),envelope);await page.evaluate(()=>window.qa.reply());
   await input.fill('9');await input.press('Enter');await expect.poll(()=>page.evaluate(()=>window.qa.pending.length)).toBe(1);await page.evaluate(()=>window.qa.reply('conflict'));
   await expect(input).toHaveValue('9');await expect(row.getByRole('alert')).toContainText('QA_CONFLICT');
   await row.getByRole('button',{name:'Принять сохранённое'}).click();await expect(input).toHaveValue('5');
   checks.push(`${kind}:${viewport.width}:draft_arrows_old_ack_retry_uuid_conflict`);
  }
  const file=path.join(directory,`percentages-${viewport.width}.png`);await page.screenshot({path:file,fullPage:true});screenshots.push(file);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.close();
 }
 assert.deepEqual(errors,[]);
 const receipt={status:'PASS',mode:'real React components; mocked action transport; native database verified separately',checks,screenshots,pageErrors:errors};
 await writeFile(path.join(directory,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
