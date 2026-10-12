import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const require = createRequire(import.meta.url), sourceRoot = path.resolve("src").replaceAll("\\", "/");
type Engine = { onResolve(options: {filter: RegExp}, handler: (args: {path: string}) => {path: string; namespace: string}|undefined): void;
  onLoad(options: {filter: RegExp; namespace: string}, handler: () => {contents: string; loader: "tsx"|"js"; resolveDir?: string}): void };
const compiler = createRequire(require.resolve("tsx/package.json"))("esbuild") as {build(options: Record<string, unknown>): Promise<{outputFiles: {contents: Uint8Array}[]}>};
const modules: Record<string, string> = {
  "next/navigation": "export const useRouter=()=>({refresh:()=>window.__refreshes++});",
  "@/server/tasks/actions": "export const createTask=data=>window.__send(data); export const changeTaskStatus=()=>{throw Error('UNEXPECTED_STATUS_RPC')};",
  "@/server/works/actions": "export const removeWork=()=>{throw Error('UNEXPECTED_WORK_RPC')};",
  "@/components/task-dialog": "export const TaskDialog=()=>null,TASK_TYPES=['Производство','Прочее'],taskStatusBadge={},taskStatusLabels={};",
  "@/components/work-dialog": "export const WorkDialog=()=>null;",
  "@/components/worker-task-allocation-dialog": "export const WorkerTaskAllocationDialog=()=>null;",
  "@/components/actual-time-dialog": "export const ActualTimeDialog=()=>null;",
  "@/components/photo-upload-button": "export const PhotoUploadButton=()=>null;",
};
async function bundle(baseline: boolean) {
  const tab = sourceRoot + "/app/(app)/projects/[id]/tasks-tab.tsx";
  const oldSource = baseline ? execFileSync("git", ["show", "c6508448:apps/web/src/app/(app)/projects/[id]/tasks-tab.tsx"], {encoding: "utf8", windowsHide: true}) : "";
  const entry = `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{Toaster}from'sonner';import{TasksTab}from${JSON.stringify(tab)};
window.__requests=[];window.__mode='LOST';window.__refreshes=0;window.__tasks=new Map();
window.__send=async data=>{window.__requests.push(JSON.parse(JSON.stringify(data)));if(window.__mode==='ATTEMPT'||window.__mode==='ABSENT')return{ok:false,outcome:'ROLLED_BACK',kind:'rejected',retrySafe:false,error:'Попытка отклонена',clientMutationId:data.clientMutationId,intentResolution:window.__mode==='ABSENT'?'verified-absent':'attempt-only'};
if(!window.__tasks.has(data.clientMutationId))window.__tasks.set(data.clientMutationId,'task-'+window.__tasks.size);if(window.__mode==='LOST')throw Error('Injected ACK loss');return{ok:true,outcome:'COMMITTED',resultId:window.__tasks.get(data.clientMutationId),clientMutationId:data.clientMutationId,replayed:true};};
function App(){const[key,setKey]=useState(0),[actor,setActor]=useState('manager');window.__remount=()=>setKey(k=>k+1);window.__actor=setActor;return <><TasksTab key={key} projectId='project' productId='product' actorUserId={actor} canManage canAddWork={false} tasks={[]} works={[{id:'work',title:'Сборка шкафа',quantity:'10',allocated:'0',priceSnapshot:'100',total:'1000',paymentKind:'LEGACY',linkedTask:null}]} priceItems={[]} products={[{id:'product',number:'165.1',title:'Шкаф'}]} workers={[{id:'recipient',name:'Получатель'}]}/><Toaster/></>};createRoot(document.getElementById('root')).render(<App/>);`;
  const result = await compiler.build({stdin:{contents:entry,loader:"jsx",resolveDir:process.cwd(),sourcefile:"qa165-dialog.jsx"},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",target:"es2022",logLevel:"silent",tsconfig:path.resolve("tsconfig.json"),define:{"process.env.NODE_ENV":'"production"'},
    plugins:[{name:"explicit-io",setup(engine:Engine){
      engine.onResolve({filter:/.*/},args=>modules[args.path]?{path:args.path,namespace:"qa-io"}:baseline&&args.path===tab?{path:args.path,namespace:"baseline"}:undefined);
      for(const name of Object.keys(modules)) engine.onLoad({filter:new RegExp("^"+name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"$"),namespace:"qa-io"},()=>({contents:modules[name],loader:"js"}));
      engine.onLoad({filter:/.*/,namespace:"baseline"},()=>({contents:oldSource,loader:"tsx",resolveDir:path.dirname(tab)}));
    }}]});
  return Buffer.from(result.outputFiles[0].contents).toString("utf8");
}

test("Chromium actual TasksTab keeps UUID/payload through loss, reopen/remount/actor change; normal desktop/mobile view matches", {timeout:180000}, async () => {
  const output = path.resolve("../../.playwright-mcp/task-create-165"); await mkdir(output,{recursive:true});
  const postcss = createRequire(require.resolve("@tailwindcss/postcss"))("postcss") as {default?:unknown;(plugins:unknown[]):{process(css:string,options:{from:string}):Promise<{css:string}>}};
  const tailwind = require("@tailwindcss/postcss") as (options:{base:string})=>unknown;
  const css = (await postcss([tailwind({base:process.cwd()})]).process(await readFile("src/app/globals.css","utf8"),{from:path.resolve("src/app/globals.css")})).css;
  // Shallow CI сохраняет поведенческий Chromium gate; настоящая baseline visual пара получена локально.
  const compareBaseline = process.env.CI !== "true";
  const old = compareBaseline ? await bundle(true) : null, current = await bundle(false), browser = await chromium.launch({channel:process.platform==="win32"?"chrome":undefined,headless:true});
  try {
    const comparisons: object[] = [];
    for (const viewport of [{width:1440,height:900},{width:390,height:844},{width:360,height:800}]) {
      const images: Buffer[]=[];
      for (const [index, script] of [old,current].entries()) {
        if (script === null) continue;
        const context=await browser.newContext({viewport}),page=await context.newPage();
        try {
          await page.route("**/*",route=>route.abort());
          await page.setContent('<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'*{animation:none!important;transition:none!important;caret-color:transparent}</style><body style="font-family:Arial,sans-serif"><main id="root" class="p-5"></main></body></html>');
          await page.addScriptTag({content:script}); await page.getByRole("button",{name:"Назначить задачу",exact:true}).click();
          await page.getByRole("button",{name:"Выберите исполнителя",exact:true}).click(); await page.getByRole("button",{name:"Получатель",exact:true}).click();
          await page.locator("#est").fill("10"); await page.getByRole("dialog").locator('input[type="number"]').last().fill("1"); await page.locator("#task-title").focus();
          await page.getByRole("combobox").click(); await page.getByRole("option",{name:"Прочее",exact:true}).click(); await page.locator("#due").fill("2026-11-01");
          await page.getByRole("button",{name:"Отмена",exact:true}).click(); await page.getByRole("button",{name:"Назначить задачу",exact:true}).click();
          assert.equal(await page.locator("#est").inputValue(),"10"); assert.equal(await page.locator("#due").inputValue(),"2026-11-01"); assert.equal(await page.getByRole("combobox").innerText(),"Прочее");
          await page.getByRole("button",{name:"Выберите исполнителя",exact:true}).click(); await page.getByRole("button",{name:"Получатель",exact:true}).click();
          await page.getByRole("dialog").locator('input[type="number"]').last().fill("1"); await page.locator("#task-title").focus();
          images.push(await page.screenshot({path:path.join(output,`${viewport.width}-${index?'after':'before'}.png`)}));
          if (index===0) continue;
          await page.getByRole("button",{name:"Создать",exact:true}).click(); await page.getByRole("button",{name:"Проверить",exact:true}).waitFor(); assert.equal(await page.locator("#est").isDisabled(),true);
          await page.screenshot({path:path.join(output,`${viewport.width}-unknown.png`)});
          await page.getByRole("button",{name:"Отмена",exact:true}).click(); await page.getByRole("button",{name:"Назначить задачу",exact:true}).click(); assert.equal(await page.locator("#est").inputValue(),"10");
          for(const mode of ["ATTEMPT","ABSENT"]){await page.evaluate(value=>{(window as unknown as {__mode:string}).__mode=value},mode);await page.getByRole("button",{name:"Проверить",exact:true}).click();await page.waitForFunction(()=>!document.querySelector<HTMLButtonElement>('[data-slot="dialog-footer"] button:last-child')?.disabled);assert.equal(await page.locator("#est").isDisabled(),true);}
          await page.getByRole("button",{name:"Отмена",exact:true}).click(); await page.evaluate(()=>{(window as unknown as {__remount:()=>void}).__remount()});
          await page.getByRole("button",{name:"Назначить задачу",exact:true}).click(); assert.equal(await page.locator("#est").inputValue(),"10");
          await page.evaluate(()=>{(window as unknown as {__mode:string}).__mode="ACK"}); await page.getByRole("button",{name:"Проверить",exact:true}).click(); await page.getByRole("dialog").waitFor({state:"hidden"});
          const requests=await page.evaluate(()=>(window as unknown as {__requests:object[]}).__requests); assert.equal(requests.length,4); for(const request of requests)assert.deepEqual(request,requests[0]);
          await page.getByRole("button",{name:"Назначить задачу",exact:true}).click(); await page.getByRole("button",{name:"Выберите исполнителя",exact:true}).click(); await page.getByRole("button",{name:"Получатель",exact:true}).click(); await page.locator("#est").fill("10");
          await page.evaluate(()=>{(window as unknown as {__mode:string}).__mode="LOST"}); await page.getByRole("button",{name:"Создать",exact:true}).click(); await page.getByRole("button",{name:"Проверить",exact:true}).waitFor();
          await page.evaluate(()=>{(window as unknown as {__actor:(id:string)=>void}).__actor("admin")}); await page.getByRole("button",{name:"Создать",exact:true}).waitFor(); await page.waitForFunction(()=>document.querySelector<HTMLInputElement>("#est")?.matches(":disabled") === false); assert.equal(await page.locator("#est").isDisabled(),false);
          await page.evaluate(()=>{const w=window as unknown as {__actor:(id:string)=>void;__mode:string};w.__actor("manager");w.__mode="ACK"}); await page.getByRole("button",{name:"Проверить",exact:true}).click(); await page.getByRole("dialog").waitFor({state:"hidden"});
          const final=await page.evaluate(()=>{const w=window as unknown as {__requests:{clientMutationId:string}[];__tasks:Map<string,string>};return{requests:w.__requests,tasks:w.__tasks.size}}); assert.equal(final.tasks,2); assert.notEqual(final.requests[4].clientMutationId,final.requests[0].clientMutationId); assert.deepEqual(final.requests[4],final.requests[5]);
        } finally {await context.close();}
      }
      if(compareBaseline)assert.deepEqual(images[1],images[0],"NORMAL_DIALOG_VISUAL_CHANGED");
      comparisons.push({viewport,pngSha256:createHash("sha256").update(images.at(-1)!).digest("hex"),visualComparison:compareBaseline?"BASELINE_EQUAL":"NOT_RUN_SHALLOW_CI"});
    }
    await writeFile(path.join(output,"receipt.json"),JSON.stringify({status:"COMPONENT_RUNTIME_PASS",comparisons,ioSeams:["auth props","server RPC","unrelated closed sibling dialogs"],native:"NOT_RUN",staging:"NOT_RUN"})+"\n");
    console.log(JSON.stringify({status:"COMPONENT_RUNTIME_PASS",comparisons:comparisons.length,output}));
  } finally {await browser.close();}
});
