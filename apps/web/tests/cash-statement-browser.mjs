// pnpm --filter @pero/web exec tsx tests/cash-statement-browser.mjs
// Автономный loopback-стенд: настоящие расчёт, View, DataTable, Base UI и Tailwind.
// Нужен CRM_CASH_BROWSER_FONT_CSS с уже собранным Roboto layout.css; БД не используется.
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {createRequire} from "node:module";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {createServer} from "node:http";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {chromium,expect} from "@playwright/test";
import {Prisma} from "@prisma/client";
import {buildCashStatement} from "../src/server/finance/cash-statement.ts";

const web=path.resolve(path.dirname(fileURLToPath(import.meta.url)),".."),require=createRequire(import.meta.url);
const {build}=createRequire(require.resolve("tsx/package.json"))("esbuild");
const hash=value=>createHash("sha256").update(value).digest("hex");
const producerHash=hash(await readFile(fileURLToPath(import.meta.url)));
const directory=path.join(web,"test-results/cash-statement-browser",randomUUID());
await mkdir(directory,{recursive:true});
const fontCssPath=path.resolve(process.env.CRM_CASH_BROWSER_FONT_CSS??"");
assert.ok(process.env.CRM_CASH_BROWSER_FONT_CSS,"CASH_QA_EXISTING_FONT_CSS_REQUIRED");
const fontCssSource=await readFile(fontCssPath,"utf8");
const fontFaces=[...fontCssSource.matchAll(/@font-face\s*\{[^}]*\}/g)].map(match=>match[0]).filter(block=>/font-family:\s*['"]Roboto['"]/.test(block));
assert.ok(fontFaces.length>0,"CASH_QA_REAL_ROBOTO_REQUIRED");
const fonts=new Map();
for(const face of fontFaces)for(const match of face.matchAll(/url\(\/?_next\/static\/media\/([a-z0-9.-]+\.woff2)\)/g)){
 const file=path.resolve(fontCssPath,"../../../media",match[1]);
 fonts.set("/_next/static/media/"+match[1],await readFile(file));
}
assert.ok(fonts.size>0,"CASH_QA_REAL_FONT_FILES_REQUIRED");
const accounts=[
 {id:"rub",name:"Касса RUB · контроль расхождения 0,67",currency:"RUB",active:true},
 {id:"usd",name:"Касса USD · ненулевой остаток",currency:"USD",active:true},
 {id:"salary",name:"Касса BYN · зарплата и аванс",currency:"BYN",active:true},
 {id:"legacy",name:"Касса BYN · неполная история",currency:"BYN",active:false},
 {id:"outage",name:"Касса EUR · курс недоступен",currency:"EUR",active:true},
];
const make=(id,accountId,at,nativeAmount,bynAmount,direction="INCOME",source="PAYMENT")=>({id,accountId,at,nativeAmount:nativeAmount===null?null:new Prisma.Decimal(nativeAmount).toFixed(2),bynAmount:bynAmount===null?null:new Prisma.Decimal(bynAmount).toFixed(2),direction,source,
 nativeCurrency:accounts.find(account=>account.id===accountId).currency,label:direction==="INCOME"?"Приход":"Расход",comment:null,project:null,document:null});
const facts=[
 make("observed-old","rub","2026-09-19T10:00:00Z","25000","899.75","EXPENSE"),
 {...make("observed-expense","rub","2026-10-07T10:00:00Z","55000","1972.85","EXPENSE"),label:"Материалы",comment:"Контрольная запись без персональных данных",project:{id:"qa173-project",number:"173"},document:{id:"qa173-receipt",fileName:"Отчёт-QA173.pdf",mimeType:"application/pdf",source:"finance"}},
 make("observed-in-one","rub","2026-10-12T10:00:00Z","25000","897.48"),
 make("observed-in-two","rub","2026-10-12T11:00:00Z","55000","1974.45"),
 make("usd-opening","usd","2026-09-29T10:00:00Z","10","30"),make("usd-income","usd","2026-10-12T10:00:00Z","5","15.50"),
 make("salary-opening","salary","2026-09-29T10:00:00Z","200","200"),
 {...make("salary","salary","2026-10-07T10:00:00Z","20","20","EXPENSE","SALARY"),label:"Зарплата · Сотрудник QA"},
 {...make("advance","salary","2026-10-07T11:00:00Z","5","5","EXPENSE","ADVANCE"),label:"Аванс · Сотрудник QA"},
 {...make("legacy","legacy","2026-10-07T12:00:00Z",null,"7","EXPENSE","SALARY"),nativeCurrency:null,label:"Старая выплата без физической суммы"},
 make("outage","outage","2026-10-12T10:00:00Z","10","33"),
];
// Это контрольные курсы оценки, а не подтверждённые raw rate/rateDate production.
const rates=[{currency:"RUB",date:"2026-09-30",rate:"0.036",issue:null},{currency:"RUB",date:"2026-10-12",rate:"0.037",issue:null},
 {currency:"USD",date:"2026-09-30",rate:"3.1",issue:null},{currency:"USD",date:"2026-10-12",rate:"3.2",issue:null},
 {currency:"EUR",date:"2026-10-12",rate:null,issue:"Не удалось подтвердить курс НБ РБ EUR на 2026-10-12"}];
const pins=new Map();
for(const file of ["src/server/finance/cash-statement.ts","src/server/finance/cash-statement-rates.ts","src/components/cash-statement-view.tsx","src/components/ui/data-table.tsx","src/components/ui/dialog.tsx","src/app/globals.css"])
 pins.set(file,hash(await readFile(path.join(web,file))));
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {CashStatementView} from '@/components/cash-statement-view';
createRoot(document.getElementById('root')).render(<main style={{maxWidth:1200,margin:'0 auto',padding:16,minWidth:0}}><CashStatementView query={window.__fixture.query} report={window.__fixture.report}/></main>);`;
const bundle=await build({stdin:{contents:entry,loader:"tsx",resolveDir:web},bundle:true,metafile:true,write:false,platform:"browser",format:"iife",jsx:"automatic",
 tsconfig:path.join(web,"tsconfig.json"),define:{"process.env.NODE_ENV":'"production"'},logLevel:"silent",plugins:[{name:"next-link-boundary",setup(builder){
  builder.onResolve({filter:/^next\/link$/},args=>({path:args.path,namespace:"qa-boundary"}));
  builder.onLoad({filter:/.*/,namespace:"qa-boundary"},()=>({contents:"import React from 'react';export default function Link({children,...props}){return <a {...props}>{children}</a>}",loader:"tsx",resolveDir:web}));
 }}]});
const productionInputs=Object.keys(bundle.metafile.inputs).filter(file=>!file.includes("node_modules")&&!file.startsWith("qa-boundary:")&&file!=="<stdin>").map(file=>path.resolve(web,file));
for(const relative of ["src/components/cash-statement-view.tsx","src/components/ui/data-table.tsx","src/components/ui/dialog.tsx","src/components/report-document-button.tsx"])
 assert.ok(productionInputs.includes(path.join(web,relative)),"CASH_QA_REAL_PRODUCTION_CLOSURE_REQUIRED");
const postcss=createRequire(require.resolve("@tailwindcss/postcss"))("postcss"),tailwind=require("@tailwindcss/postcss");
const css=(await postcss([tailwind({base:web})]).process(await readFile(path.join(web,"src/app/globals.css"),"utf8"),{from:path.join(web,"src/app/globals.css")})).css;
const requests=[],unexpected=[],checks=[],screenshots=[];
let browser,server,currentPage;
const browserErrors=[];
const frames=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
async function inspect(page,dialog=false){
 await frames(page);
 const result=await page.evaluate(inDialog=>{
  const scope=inDialog?document.querySelector('[data-slot="dialog-content"]'):document.querySelector('main');
  const rect=scope.getBoundingClientRect();
  const visible=element=>element.getClientRects().length>0&&getComputedStyle(element).visibility!=="hidden";
  const cards=[...scope.querySelectorAll('[data-slot="mobile-list-card"]')].filter(visible).map(card=>{const r=card.getBoundingClientRect();return {x:r.x,right:r.right,width:r.width,overflow:card.scrollWidth-card.clientWidth};});
  const clipped=[...scope.querySelectorAll('dl>div,p,b,label')].filter(visible).filter(element=>!element.closest('[data-slot="table-container"]')&&element.scrollWidth>element.clientWidth+2).map(element=>({tag:element.tagName,text:element.textContent.slice(0,80),overflow:element.scrollWidth-element.clientWidth}));
  return {documentWidth:document.scrollingElement.scrollWidth,viewport:innerWidth,scopeWidth:scope.clientWidth,scopeOverflow:scope.scrollWidth-scope.clientWidth,x:rect.x,right:rect.right,cards,clipped,font:document.fonts.check('17.5px Roboto'),dark:document.documentElement.classList.contains('dark')};
 },dialog);
 assert.ok(result.documentWidth<=result.viewport+1,"CASH_QA_DOCUMENT_HORIZONTAL_OVERFLOW:"+JSON.stringify(result));
 assert.ok(result.x>=-1&&result.right<=result.viewport+1,"CASH_QA_SCOPE_OUTSIDE_VIEWPORT:"+JSON.stringify(result));
 assert.ok(result.scopeOverflow<=1,"CASH_QA_SCOPE_HORIZONTAL_CLIP:"+JSON.stringify(result));
 assert.deepEqual(result.clipped,[],"CASH_QA_TEXT_CLIPPED");
 for(const card of result.cards){assert.ok(card.x>=-1&&card.right<=result.viewport+1);assert.ok(card.overflow<=1,"CASH_QA_MOBILE_ROW_CLIPPED");}
 assert.ok(result.font,"CASH_QA_ROBOTO_NOT_LOADED");return result;
}
async function shot(page,name,fullPage=false){const file=name+".png";await page.screenshot({path:path.join(directory,file),fullPage});screenshots.push(file);}
function cashRow(page,id,width){return page.locator(width<768?'main [data-slot="mobile-list-card"]':'main tbody tr').filter({has:page.getByText(accounts.find(row=>row.id===id).name,{exact:true})});}
function metric(dialog,name){return dialog.getByText(name,{exact:true}).locator('..').locator('dd');}
async function openCash(page,id,width){await cashRow(page,id,width).click();const dialog=page.getByRole("dialog");await expect(dialog).toBeVisible();await expect(dialog.getByRole("heading",{name:accounts.find(row=>row.id===id).name,exact:true})).toBeVisible();return dialog;}
async function closeCash(page){await page.getByRole("dialog").getByRole("button",{name:"Закрыть",exact:true}).click();await expect(page.getByRole("dialog")).toHaveCount(0);}
try{
 server=createServer((request,response)=>{
  const url=new URL(request.url,"http://127.0.0.1");requests.push({method:request.method,path:url.pathname,query:url.search});
  if(request.method!=="GET"){unexpected.push("NON_GET_REQUEST");response.writeHead(405);response.end();return;}
  if(fonts.has(url.pathname)){response.setHeader("content-type","font/woff2");response.end(fonts.get(url.pathname));return;}
  if(url.pathname==="/app.css"){response.setHeader("content-type","text/css");response.end(css+"\n"+fontFaces.join("\n")+"\n:root{--font-roboto:'Roboto',sans-serif}");return;}
  if(url.pathname==="/app.js"){response.setHeader("content-type","text/javascript");response.end(bundle.outputFiles[0].text);return;}
  if(url.pathname==="/api/finance/documents/qa173-receipt"){response.setHeader("content-type","application/pdf");response.end("%PDF-1.4\n% QA173 synthetic\n");return;}
  if(url.pathname!=="/finance/accounts/report"){unexpected.push("UNEXPECTED_ROUTE:"+url.pathname);response.writeHead(404);response.end();return;}
  const query={from:url.searchParams.get("from")??"2026-10-01",to:url.searchParams.get("to")??"2026-10-12",mode:url.searchParams.get("mode")==="NATIVE"?"NATIVE":"BYN"};
  const fixture=JSON.stringify({query,report:buildCashStatement(accounts,facts,query,rates)}).replaceAll("<","\\u003c");
  const dark=(request.headers.cookie??"").includes("fixtureTheme=dark");
  response.setHeader("content-type","text/html; charset=utf-8");
  response.end(`<!doctype html><html lang="ru" class="${dark?"dark":""}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script>window.__fixture=${fixture}</script><script src="/app.js"></script></body></html>`);
 });
 await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
 const origin="http://127.0.0.1:"+server.address().port;
 browser=await chromium.launch({headless:true,channel:"chromium"});
 for(const width of [1440,390,360])for(const theme of ["light","dark"]){
  const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<768,colorScheme:theme,reducedMotion:"reduce"});
  await context.addCookies([{url:origin,name:"fixtureTheme",value:theme}]);
  await context.route("**/*",route=>{if(new URL(route.request().url()).origin!==origin){unexpected.push("EXTERNAL_REQUEST");return route.abort();}return route.continue();});
  const page=await context.newPage(),errors=[];currentPage=page;page.on("pageerror",error=>{errors.push(String(error));browserErrors.push(String(error));});page.setDefaultTimeout(8000);
  await page.goto(origin+"/finance/accounts/report?from=2026-10-01&to=2026-10-12&mode=BYN",{waitUntil:"networkidle"});
  await page.evaluate(()=>document.fonts.ready);await expect(page.getByRole("heading",{name:"Отчёт по кассам",exact:true})).toBeVisible();
  const overview=await inspect(page);assert.equal(overview.dark,theme==="dark");
  await shot(page,`${width}-${theme}-byn-overview`,true);
  let dialog=await openCash(page,"rub",width);
  await expect(metric(dialog,"Начальный остаток")).toHaveText("−900,00 BYN");await expect(metric(dialog,"Приходы")).toHaveText("2 871,93 BYN");
  await expect(metric(dialog,"Расходы")).toHaveText("−1 972,85 BYN");await expect(metric(dialog,"Курсовая разница")).toHaveText("0,92 BYN");await expect(metric(dialog,"Конечный остаток")).toHaveText("0,00 BYN");
  await expect(dialog.getByText("В валюте кассы: 0,00 ₽",{exact:true})).toBeVisible();
  await expect(dialog.getByText("Курс НБ РБ на 30.09.2026: 0,036 BYN за 1 RUB",{exact:true})).toBeVisible();
  await expect(dialog.getByText("Конечный остаток · 12.10.2026",{exact:true})).toBeVisible();
  const visibleEntries=dialog.locator(width<768?'[data-slot="mobile-list-card"]':'tbody tr').filter({visible:true});await expect(visibleEntries).toHaveCount(3);
  if(width>=768)await expect(dialog.getByRole("link",{name:"173",exact:true})).toHaveAttribute("href","/finance/projects/qa173-project");
  else await expect(dialog.getByText("07.10.2026, 13:00:00 · Проект 173",{exact:true})).toBeVisible();
  const document=dialog.getByRole("link",{name:"Отчёт-QA173.pdf",exact:true}).filter({visible:true});await expect(document).toHaveAttribute("href","/api/finance/documents/qa173-receipt");
  await expect(document).toHaveAttribute("download","Отчёт-QA173.pdf");
  await expect(dialog.getByRole("button",{name:"Удалить файл Отчёт-QA173.pdf",exact:true}).filter({visible:true})).toBeDisabled();
  const detail=await inspect(page,true);await shot(page,`${width}-${theme}-byn-detail`);
  await document.scrollIntoViewIfNeeded();await expect(document).toBeInViewport({ratio:0.99});await inspect(page,true);
  if(width>=768){
   const table=dialog.locator('[data-slot="table-container"]:visible');
   await table.evaluate(element=>{element.scrollLeft=element.scrollWidth;});
   await expect(dialog.getByRole("button",{name:"Распечатать Отчёт-QA173.pdf",exact:true}).filter({visible:true})).toBeInViewport({ratio:0.99});
   await expect(dialog.getByRole("button",{name:"Удалить файл Отчёт-QA173.pdf",exact:true}).filter({visible:true})).toBeInViewport({ratio:0.99});
   detail.table=await table.evaluate(element=>({scrollWidth:element.scrollWidth,clientWidth:element.clientWidth,scrollLeft:element.scrollLeft,overflowX:getComputedStyle(element).overflowX}));
   assert.equal(detail.table.overflowX,"auto");
  }
  await shot(page,`${width}-${theme}-byn-entries`);
  if(width===1440&&theme==="light"){
   const [download]=await Promise.all([page.waitForEvent("download"),document.click()]);
   assert.equal(download.suggestedFilename(),"Отчёт-QA173.pdf");await download.saveAs(path.join(directory,"qa173-synthetic-original.pdf"));
  }
  await closeCash(page);
  dialog=await openCash(page,"usd",width);
  await expect(dialog.getByText("Курс НБ РБ на 30.09.2026: 3,1 BYN за 1 USD",{exact:true})).toBeVisible();
  await expect(dialog.getByText("Курс НБ РБ на 12.10.2026: 3,2 BYN за 1 USD",{exact:true})).toBeVisible();
  await expect(metric(dialog,"Конечный остаток")).toHaveText("48,00 BYN");await inspect(page,true);await closeCash(page);
  dialog=await openCash(page,"legacy",width);
  await expect(metric(dialog,"Расходы")).toHaveText("−7,00 BYN");await expect(metric(dialog,"Конечный остаток")).toHaveText("Нет данных");
  await expect(dialog.getByText("Нет подтверждённого остатка в валюте кассы: неполная физическая история",{exact:true})).toBeVisible();
  await inspect(page,true);await closeCash(page);
  dialog=await openCash(page,"outage",width);
  await expect(metric(dialog,"Приходы")).toHaveText("33,00 BYN");await expect(metric(dialog,"Конечный остаток")).toHaveText("Нет данных");
  await expect(dialog.getByText("Не удалось подтвердить курс НБ РБ EUR на 2026-10-12",{exact:true})).toBeVisible();
  await dialog.getByText("Не удалось подтвердить курс НБ РБ EUR на 2026-10-12",{exact:true}).scrollIntoViewIfNeeded();
  await expect(dialog.getByText("Не удалось подтвердить курс НБ РБ EUR на 2026-10-12",{exact:true})).toBeInViewport({ratio:0.99});
  await inspect(page,true);if(width===360&&theme==="dark")await shot(page,"360-dark-outage-detail");await closeCash(page);
  dialog=await openCash(page,"salary",width);
  await expect(metric(dialog,"Расходы")).toHaveText("−25,00 BYN");await expect(metric(dialog,"Конечный остаток")).toHaveText("175,00 BYN");
  await expect(dialog.getByText("Зарплата · Сотрудник QA",{exact:true}).filter({visible:true})).toHaveCount(1);await expect(dialog.getByText("Аванс · Сотрудник QA",{exact:true}).filter({visible:true})).toHaveCount(1);
  await dialog.getByText("Аванс · Сотрудник QA",{exact:true}).filter({visible:true}).scrollIntoViewIfNeeded();
  await expect(dialog.getByText("Аванс · Сотрудник QA",{exact:true}).filter({visible:true})).toBeInViewport({ratio:0.99});
  await inspect(page,true);await closeCash(page);
  await page.selectOption("#cash-mode","NATIVE");await expect(page.locator("#cash-mode")).toHaveValue("NATIVE");
  await Promise.all([page.waitForURL(url=>url.searchParams.get("mode")==="NATIVE"),page.getByRole("button",{name:"Показать",exact:true}).click()]);
  await page.evaluate(()=>document.fonts.ready);await expect(page.getByRole("heading",{name:"Отчёт по кассам",exact:true})).toBeVisible();
  assert.equal(await page.evaluate(()=>window.__fixture.query.mode),"NATIVE");const native=await inspect(page);
  await expect(page.locator('main').getByText("Курсовая разница",{exact:true})).toHaveCount(0);await shot(page,`${width}-${theme}-native-overview`,true);
  dialog=await openCash(page,"rub",width);await expect(metric(dialog,"Начальный остаток")).toHaveText("−25 000,00 ₽");await expect(metric(dialog,"Приходы")).toHaveText("80 000,00 ₽");
  await expect(metric(dialog,"Расходы")).toHaveText("−55 000,00 ₽");await expect(metric(dialog,"Конечный остаток")).toHaveText("0,00 ₽");
  await expect(dialog.getByText("Курсовая разница",{exact:true})).toHaveCount(0);await inspect(page,true);await closeCash(page);
  await page.selectOption("#cash-mode","BYN");await Promise.all([page.waitForURL(url=>url.searchParams.get("mode")==="BYN"),page.getByRole("button",{name:"Показать",exact:true}).click()]);
  assert.equal(new URL(page.url()).searchParams.get("from"),"2026-10-01");assert.equal(new URL(page.url()).searchParams.get("to"),"2026-10-12");
  assert.deepEqual(errors,[]);checks.push({width,theme,overview,detail,native,details:true,rateDates:true,unknown:true,outage:true,payoutSourcesOnce:true,nativeGetRoundTrip:true});
  await context.close();
 }
 for(const [file,before]of pins)assert.equal(hash(await readFile(path.join(web,file))),before,"CASH_QA_SOURCE_CHANGED_DURING_RUN");
 assert.equal(hash(await readFile(fileURLToPath(import.meta.url))),producerHash,"CASH_QA_HARNESS_CHANGED_DURING_RUN");
 assert.deepEqual(unexpected,[]);
 const receipt={passed:true,observedAt:new Date().toISOString(),browserVersion:browser.version(),producerHash,scope:"actual component + Tailwind + Roboto + core calculation; isolated GET-only loopback transport, no database",directory,
  fixtures:{historicalResidual:"-0.67",testOpeningRate:"0.036",valuedOpening:"-900.00",income:"2871.93",expense:"-1972.85",revaluation:"0.92",closing:"0.00",nativeClosing:"0.00"},
  pins:Object.fromEntries(pins),bundleSha256:hash(bundle.outputFiles[0].contents),fontCssSha256:hash(fontCssSource),fonts:[...fonts].map(([file,bytes])=>({file,sha256:hash(bytes)})),checks,screenshots,requests,unexpected};
 await writeFile(path.join(directory,"receipt.json"),JSON.stringify(receipt,null,2));await writeFile(path.join(directory,"bundle-metafile.json"),JSON.stringify(bundle.metafile,null,2));
 console.log(JSON.stringify({passed:true,directory,checks:checks.length,screenshots:screenshots.length,receipt:path.join(directory,"receipt.json")}));
}catch(error){const dom=currentPage&&!currentPage.isClosed()?await currentPage.locator('body').innerText():null;if(currentPage&&!currentPage.isClosed())await currentPage.screenshot({path:path.join(directory,"failure.png"),fullPage:true});await writeFile(path.join(directory,"failure.json"),JSON.stringify({error:String(error),browserErrors,dom,checks,screenshots,requests,unexpected},null,2));console.error(JSON.stringify({passed:false,directory,error:String(error),browserErrors}));throw error;
}finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}}
