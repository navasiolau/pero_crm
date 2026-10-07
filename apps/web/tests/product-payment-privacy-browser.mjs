import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium,expect} from '@playwright/test';
import {getProductPercentageView} from '../src/server/product-percentage-pay/queries.ts';
const web=process.cwd(),require=createRequire(import.meta.url),{build}=createRequire(require.resolve('tsx/package.json'))('esbuild'),directory=path.resolve(web,'../../.playwright-mcp/privacy91');
await mkdir(directory,{recursive:true});
const product={id:'p',status:'PRODUCTION',quantity:3,expectedPrice:'1000',project:{currency:'BYN'},noModel:false,files:[],stagePayPools:[],percentageCompletions:[],engineerId:'e',engineer:{name:'Инженер',active:true,roles:['ENGINEER']},assemblerId:'w',assembler:{name:'Сборщик',active:true,roles:['WORKER']},mounterId:'i',mounter:{name:'Монтажник',active:true,roles:['MOUNTER']},percentageConfigs:['ENGINEERING','ASSEMBLY','INSTALLATION'].map(kind=>({kind,ratePercent:'5',revision:1}))};
const database={task:{findMany:async()=>[]},productPercentageParticipant:{findMany:async()=>[]},product:{findFirst:async()=>product},user:{findMany:async()=>[]},payrollEntry:{findMany:async()=>[]}};
const actors={engineer:{id:'e',roles:['ENGINEER']},worker:{id:'w',roles:['WORKER']},mounter:{id:'i',roles:['MOUNTER']},stranger:{id:'other',roles:['WORKER']},manager:{id:'manager',roles:['MANAGER']}},views={};
for(const [name,actor] of Object.entries(actors))views[name]=await getProductPercentageView(actor,'p',database);
const entry=`import React from 'react';import{createRoot}from'react-dom/client';import{SinglePercentageRow}from'./src/app/(app)/products/[id]/product-percentage-panel';
 const views=${JSON.stringify(views)};const name=new URL(location.href).searchParams.get("actor"),view=views[name];createRoot(document.getElementById("root")).render(<main className="space-y-4 p-4">{Object.keys(view.sections).map(kind=><SinglePercentageRow key={kind} productId="p" kind={kind} section={view.sections[kind]} assignedEngineerId="e" canManage={name==="manager"} canViewAll={name==="manager"} candidates={[]}/>)}</main>);`;
const mocks={'next/navigation':'export const useRouter=()=>({refresh(){}});','@/components/product-inline-provider':'export const useOptionalProductInline=()=>null;','@/lib/independent-product-percentage-action':'export const invokeProductPercentagePatch=()=>{throw Error("WRITE_FORBIDDEN")};','@/server/product-percentage-pay/actions':'export const retryProductPercentageAction=()=>{throw Error("WRITE_FORBIDDEN")};'};
const bundled=await build({stdin:{contents:entry,loader:'tsx',resolveDir:web},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'readonly',setup(builder){builder.onResolve({filter:/.*/},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'qa'}:undefined);builder.onLoad({filter:/.*/,namespace:'qa'},args=>({contents:mocks[args.path],loader:'js'}));}}]});
const postcss=createRequire(require.resolve('@tailwindcss/postcss'))('postcss'),tailwind=require('@tailwindcss/postcss');
const css=(await postcss([tailwind({base:web})]).process(await readFile(path.join(web,'src/app/globals.css'),'utf8'),{from:path.join(web,'src/app/globals.css')})).css;
const server=createServer((request,response)=>{const url=new URL(request.url,'http://localhost');response.setHeader('content-type',url.pathname==='/app.js'?'text/javascript':url.pathname==='/app.css'?'text/css':'text/html');response.end(url.pathname==='/app.js'?bundled.outputFiles[0].text:url.pathname==='/app.css'?css:'<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body style="font-family:Arial,sans-serif"><div id="root"></div><script src="/app.js"></script></body></html>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true,channel:'chromium'}),checks=[],screenshots=[];
try{
 for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:360,height:800}])for(const name of Object.keys(actors)){
  const page=await browser.newPage({viewport}),errors=[];page.on('pageerror',error=>errors.push(String(error)));await page.goto(`http://127.0.0.1:${server.address().port}/?actor=${name}`);
  const main=page.locator('main');await expect(main.locator('[data-single-percentage-kind]')).toHaveCount(3);
  if(name==='manager'){await expect(main.locator('input')).toHaveCount(3);await expect(main.getByText('Сумма: 50 BYN',{exact:true})).toBeVisible();}
  else{assert.equal(await main.locator('input').count(),0);const text=await main.innerText();assert.equal(text.includes('Процент, %'),false);assert.equal(text.includes('1 000'),false);assert.equal((text.match(/Оплата:/g)??[]).length,name==='stranger'?0:1);}
  assert.deepEqual(errors,[]);const file=path.join(directory,`${name}-${viewport.width}.png`);await page.screenshot({path:file,fullPage:true});screenshots.push(file);checks.push(name+':'+viewport.width);await page.close();
 }
 const receipt={status:'PASS',mode:'actual server projection with controlled data + real React row; real PostgreSQL role queries verified separately',checks,screenshots};await writeFile(path.join(directory,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify({status:'PASS',checks,screenshots}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
