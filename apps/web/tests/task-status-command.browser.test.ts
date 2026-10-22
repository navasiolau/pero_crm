import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { before, after, test } from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { type TaskStatusAck, type TaskStatusContext } from "../src/server/tasks/status-receipts";
import { chromium } from "@playwright/test";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
const compiler = createRequire(require.resolve("tsx/package.json"))("esbuild") as { build(options: Record<string, unknown>): Promise<{ outputFiles: { contents: Uint8Array }[] }> };
const cssPromise = (async () => {
  const postcss = createRequire(require.resolve("@tailwindcss/postcss"))("postcss") as {(plugins: unknown[]): {process(css: string, options: {from: string}): Promise<{css: string}>}};
  const tailwind = require("@tailwindcss/postcss") as (options: {base: string}) => unknown;
  return (await postcss([tailwind({base: process.cwd()})]).process(await readFile("src/app/globals.css", "utf8"), {from: path.resolve("src/app/globals.css")})).css;
})();
let browser: import("@playwright/test").Browser;
before(async () => { browser = await chromium.launch({ channel: "chrome", headless: true }); });
after(async () => { await browser?.close(); });

{ // Источник: task-status-command.browser.test.ts
const originals = new Map<string, NodeJS.Module | undefined>();
function inject(name: string, exports: Record<string, unknown>) { const file = require.resolve(name); originals.set(file, require.cache[file]); const stubModule = new Module(file); stubModule.filename = file; stubModule.loaded = true; stubModule.exports = exports; require.cache[file] = stubModule; }
inject("next/navigation", { useRouter: () => ({ refresh() {} }) });
inject("../src/server/tasks/actions", { changeTaskStatus: async () => ({ ok: false, outcome: "UNKNOWN", error: "fixture" }) });
const { createTaskStatusCommands } = require("../src/components/use-task-status-command") as typeof import("../src/components/use-task-status-command");
after(() => { for (const [file, prior] of originals) if (prior) require.cache[file] = prior; else delete require.cache[file]; });
const id = "00000000-0000-4000-8000-000000000001";

test("unit controller retries lost response with the exact frozen UUID/actor/payload", async () => {
  const requests: object[] = []; let calls = 0;
  const controller = createTaskStatusCommands(async (taskId, toStatus, minutes, context) => {
    requests.push({ taskId, toStatus, minutes, context }); if (++calls === 1) throw Error("lost response");
    return { ok: true, outcome: "COMMITTED", resultId: taskId, clientMutationId: context.clientMutationId };
  }, () => id);
  controller.observeActor("actor");
  const first = await controller.run("actor", "task", "DONE"); assert.equal(first?.ok, false);
  assert.equal(first && !first.ok ? first.outcome : undefined, "UNKNOWN");
  assert.equal((await controller.run("actor", "task", "DONE"))?.ok, true);
  assert.deepEqual(requests[0], requests[1]); assert.equal(controller.peek("task"), undefined);
});

test("unit controller refuses changed payload while original intent remains unknown", async () => {
  let calls = 0;
  const controller = createTaskStatusCommands(async () => { calls++; return { ok: false, outcome: "UNKNOWN", error: "unknown" }; }, () => id);
  controller.observeActor("actor"); await controller.run("actor", "task", "DONE");
  assert.equal((await controller.run("actor", "task", "IN_PROGRESS"))?.ok, false);
  assert.equal(calls, 1); assert.equal(controller.peek("task")?.toStatus, "DONE");
});

test("unit controller drops stale ACK after actor swap and never reuses old actor intent", async () => {
  let resolve!: (ack: TaskStatusAck) => void; const requests: TaskStatusContext[] = [];
  const controller = createTaskStatusCommands(async (_task, _status, _minutes, context) => { requests.push(context); return new Promise<TaskStatusAck>(done => { resolve = done; }); }, () => id);
  controller.observeActor("old"); const pending = controller.run("old", "task", "DONE");
  controller.observeActor("new"); resolve({ ok: true, outcome: "COMMITTED", resultId: "task", clientMutationId: id });
  assert.equal(await pending, null); assert.equal(controller.peek("task"), undefined);
  assert.equal(await controller.run("old", "task", "DONE"), null); assert.equal(requests.length, 1);
});

test("unit controller checks result identity and preserves historical replay as metadata only", async () => {
  let wrong = true;
  const controller = createTaskStatusCommands(async (taskId, _status, _minutes, context) => ({ ok: true, outcome: "COMMITTED", resultId: wrong ? "other" : taskId, clientMutationId: context.clientMutationId, replayed: true }), () => id);
  controller.observeActor("actor"); const uncertain = await controller.run("actor", "task", "IN_PROGRESS");
  assert.equal(uncertain && !uncertain.ok ? uncertain.outcome : undefined, "UNKNOWN"); assert.ok(controller.peek("task"));
  wrong = false; const replay = await controller.run("actor", "task", "IN_PROGRESS");
  assert.equal(replay?.ok, true); assert.equal(replay && replay.ok ? replay.replayed : undefined, true);
  assert.ok(replay && !("status" in replay)); assert.equal(controller.peek("task"), undefined);
});

test("unit controller coalesces an in-flight click and actor-changed clears unresolved intent", async () => {
  let calls = 0, resolve!: (ack: TaskStatusAck) => void;
  const controller = createTaskStatusCommands(async () => { calls++; return new Promise<TaskStatusAck>(done => { resolve = done; }); }, () => id);
  controller.observeActor("actor"); const a = controller.run("actor", "task", "DONE"), b = controller.run("actor", "task", "DONE");
  resolve({ ok: false, kind: "actor-changed", error: "changed" });
  assert.equal((await a)?.ok, false); assert.equal((await b)?.ok, false); assert.equal(calls, 1);
  assert.equal(controller.peek("task"), undefined); assert.equal(await controller.run("actor", "task", "DONE"), null);
});


type QaBuild = { onResolve(options: { filter: RegExp }, handler: (args: { path: string }) => { path: string; namespace: string } | undefined): void;
  onLoad(options: { filter: RegExp; namespace: string }, handler: (args: { path: string }) => { contents: string; loader: "js" }): void };

test("Chromium task buttons complete without time forms and preserve UNKNOWN UUID through historical confirmation", async () => {
  const sourceRoot = path.resolve(process.cwd(), "src").replaceAll("\\", "/");
  const modules: Record<string, string> = {
    "next/navigation": "export const useRouter=()=>({refresh:()=>{window.__refreshes++}});",
    "@/server/tasks/actions": "export const changeTaskStatus=(...args)=>window.__respond(...args);export const deleteTask=async()=>{throw Error('UNEXPECTED_DELETE')};export const updateTask=async()=>{throw Error('UNEXPECTED_EDIT')};",
    "@/server/preferences-actions": "export const saveViewPreference=async()=>{};",
    "@/server/tasks/worker-allocation-actions": "export const createWorkerWorkTask=async()=>{throw Error('UNEXPECTED_ALLOCATION')};export const takeOwnWorkTask=createWorkerWorkTask;",
    "@/server/files/actions": "export const deleteFile=async()=>{throw Error('UNEXPECTED_DELETE')};",
    "@/components/photo-upload-button": "export const PhotoUploadButton=()=>null;",
    "@/components/file-list": "export const FileList=()=>null;",
    "next/link": "export default function Link({children}){return children};",
  };
  const entry = `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{Toaster}from'sonner';
import{MyTasksView}from${JSON.stringify(sourceRoot + "/app/(app)/my/my-tasks-view.tsx")};
import{WorkerTaskAllocationDialog}from${JSON.stringify(sourceRoot + "/components/worker-task-allocation-dialog.tsx")};
import{TaskDialog}from${JSON.stringify(sourceRoot + "/components/task-dialog.tsx")};
window.__requests=[];window.__mode='UNKNOWN';window.__refreshes=0;
window.__respond=async(taskId,toStatus,minutes,context)=>{window.__requests.push({taskId,toStatus,minutes,context});return window.__mode==='UNKNOWN'?{ok:false,outcome:'UNKNOWN',retrySafe:true,error:'Ответ неизвестен'}:{ok:true,outcome:'COMMITTED',resultId:taskId,clientMutationId:context.clientMutationId,replayed:window.__mode==='REPLAY'};};
const task={id:'task',title:'Раскрой деталей',type:'Производство',status:'NEW',dueAt:'2026-10-23',assigneeId:'actor',assigneeName:'Исполнитель',requiresPhoto:false,workId:'work',workTitle:'Раскрой деталей',workTotal:'100',workPriceSnapshot:'100',quantity:'1',rewardAmount:'100.00',rewardCurrency:'BYN',rewardSource:'WORK_SNAPSHOT',dependencies:[],projectId:'project',projectNumber:'П-190',projectTitle:'Тестовая кухня',productId:'product',productNumber:'П-190.1',productTitle:'Шкаф',files:[],createdAt:'2026-10-22',doneAt:null,doneByName:null,createdByName:'Менеджер'};
function App(){const[view,setView]=useState('my');return <><nav><button onClick={()=>setView('my')}>Список задач</button><button onClick={()=>setView('allocation')}>Назначение</button><button onClick={()=>setView('details')}>Карточка задачи</button></nav>{view==='my'?<MyTasksView active={[task]} done={[]} actorUserId='actor' userName='Исполнитель' initialView='list'/>:view==='allocation'?<WorkerTaskAllocationDialog projectId='project' productId='product' actorUserId='actor' work={{id:'work',title:task.title,remaining:'1',unit:'шт'}} data={{workerOptions:[{id:'actor',name:'Исполнитель'}],dependencyOptions:[],createdAssignments:[],eligibleWorkIds:['work']}} onClose={()=>setView('my')}/>:<TaskDialog task={task} workers={[{id:'actor',name:'Исполнитель'}]} canEdit open onOpenChange={()=>setView('my')}/>}<Toaster/></>};createRoot(document.getElementById('root')).render(<App/>);`;
  const bundled = await compiler.build({ stdin: { contents: entry, loader: "jsx", resolveDir: process.cwd(), sourcefile: "qa190-task-entry.jsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", target: "es2022", logLevel: "silent",
    tsconfig: path.resolve("tsconfig.json"), define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "declared-qa-io", setup(engine: QaBuild) {
      engine.onResolve({ filter: /.*/ }, args => modules[args.path] ? { path: args.path, namespace: "qa-io" } : undefined);
      engine.onLoad({ filter: /.*/, namespace: "qa-io" }, args => ({ contents: modules[args.path], loader: "js" }));
    } }] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await page.route("**/*", route => route.abort());
    await page.setContent('<html lang="ru"><body><div id="root"></div></body></html>');
    await page.addStyleTag({ content: (await cssPromise) + "\nbody{--font-roboto:Arial;font-family:Arial,sans-serif}" });
    await page.addScriptTag({ content: Buffer.from(bundled.outputFiles[0].contents).toString("utf8") });
    const artifactDir = path.resolve("test-results/task190-ui"); await mkdir(artifactDir, { recursive: true });
    await page.getByRole("button", { name: "Взять в работу", exact: true }).waitFor();
    assert.doesNotMatch(await page.locator("body").innerText(), /Таймер|таймер|Оценка|оценка \/ факт|Внести время|Старт|Стоп/);
    assert.equal(await page.locator('input[type="number"]').count(), 0);
    await page.screenshot({ path: path.join(artifactDir, "my-mobile.png"), fullPage: true, animations: "disabled" });
    await page.getByRole("button", { name: "Взять в работу", exact: true }).click();
    await page.waitForFunction(() => (window as unknown as { __requests: unknown[] }).__requests.length === 1);
    await page.evaluate(() => { (window as unknown as { __mode: string }).__mode = "REPLAY"; });
    await page.getByRole("button", { name: "Проверить", exact: true }).click();
    await page.waitForFunction(() => (window as unknown as { __requests: unknown[] }).__requests.length === 2);
    const observed = await page.evaluate(() => (window as unknown as { __requests: { minutes?: number }[] }).__requests);
    assert.deepEqual(observed[0], observed[1]); assert.equal(observed[0].minutes, undefined);
    await page.evaluate(() => { (window as unknown as { __mode: string }).__mode = "COMMITTED"; });
    await page.getByRole("button", { name: "Завершить", exact: true }).click();
    await page.waitForFunction(() => (window as unknown as { __requests: unknown[] }).__requests.length === 3);
    assert.equal(await page.getByRole("dialog").count(), 0);
    const completion = await page.evaluate(() => (window as unknown as { __requests: { toStatus: string; minutes?: number }[] }).__requests[2]);
    assert.equal(completion.toStatus, "DONE"); assert.equal(completion.minutes, undefined);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: path.join(artifactDir, "my-desktop.png"), fullPage: true, animations: "disabled" });
    await page.getByRole("button", { name: "Назначение", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    assert.doesNotMatch(await page.getByRole("dialog").innerText(), /Оценка|истори[ия].*врем|минут/);
    assert.equal(await page.locator('#worker-task-estimate').count(), 0);
    await page.screenshot({ path: path.join(artifactDir, "allocation-desktop.png"), fullPage: true, animations: "disabled" });
    await page.getByRole("button", { name: "Отмена", exact: true }).click();
    await page.getByRole("button", { name: "Карточка задачи", exact: true }).click();
    assert.doesNotMatch(await page.getByRole("dialog").innerText(), /Время|Оценка|факт/);
    await page.getByRole("button", { name: "Редактировать", exact: true }).click();
    assert.equal(await page.locator('#td-est').count(), 0);
    await page.screenshot({ path: path.join(artifactDir, "edit-desktop.png"), fullPage: true, animations: "disabled" });
  } finally { await context.close(); }
});

test("Chromium actual PaymentDialog preserves UUID/manual FX through UNKNOWN, reopen and reload", async () => {
  const sourceRoot = path.resolve(process.cwd(), "src").replaceAll("\\", "/");
  const modules: Record<string, string> = {
    "next/navigation": "export const useRouter=()=>({refresh:()=>{window.__refreshes++}});",
    "@/server/payments/actions": "export const getPaymentActorId=async()=>({ok:true,actorId:'actor'});export const addPayment=(data,actor)=>window.__pay(data,actor);",
    "@/server/warehouse/actions": "export const addMaterial=async()=>{throw Error('UNEXPECTED_INLINE_MATERIAL')};export const updateMaterial=async()=>{throw Error('UNEXPECTED_INLINE_MATERIAL')};",
    "@/server/warehouse/stock-purchase-actions": "export const addPaidStockReceipt=()=>{throw Error('unexpected stock RPC')};",
    "@/server/finance/actions": "export const addExpenseArticle=async()=>({ok:true,article:{id:'fixture-article',name:'Статья'}});export const fetchNbrbRate=async()=>{window.__fxCalls++;sessionStorage.setItem('qa134:fx',String(window.__fxCalls));return{ok:true,rate:2.5,date:'2026-10-10'}};",
    "@/components/finance-document-upload": "export const FinanceDocumentUpload=()=>null;",
    "@/components/stock-material-fields": "export const StockMaterialFields=()=>null;",
  };
  const entry = `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{Toaster}from'sonner';
import{PaymentDialog}from${JSON.stringify(sourceRoot + "/components/payment-dialog.tsx")};
window.__requests=JSON.parse(sessionStorage.getItem('qa134:requests')||'[]');window.__mode='UNKNOWN';window.__refreshes=0;window.__fxCalls=Number(sessionStorage.getItem('qa134:fx')||'0');
window.__pay=async(data,actor)=>{if(actor!=='actor')throw Error('wrong actor');window.__requests.push(data);sessionStorage.setItem('qa134:requests',JSON.stringify(window.__requests));if(window.__mode==='THROW')throw Error('lost response');return window.__mode==='UNKNOWN'?{ok:false,outcome:'UNKNOWN',retrySafe:true,clientMutationId:data.clientMutationId,error:'Подтверждение неизвестно'}:{ok:true,outcome:'COMMITTED',resultId:'own-payment',paymentId:'own-payment',clientMutationId:data.clientMutationId};};
function App(){const[open,setOpen]=useState(true);return <><button onClick={()=>setOpen(true)}>Открыть повторно</button><PaymentDialog direction='INCOME' open={open} onOpenChange={setOpen} projectCurrency='USD' cashAccounts={[{id:'cash',name:'QA cash',currency:'USD'}]} expenseArticles={[]}/><Toaster/></>};createRoot(document.getElementById('root')).render(<App/>);`;
  const bundled = await compiler.build({ stdin: { contents: entry, loader: "jsx", resolveDir: process.cwd(), sourcefile: "qa134-payment-dialog-entry.jsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", target: "es2022", logLevel: "silent",
    tsconfig: path.resolve("tsconfig.json"), define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "declared-qa-io", setup(engine: QaBuild) {
      engine.onResolve({ filter: /.*/ }, args => modules[args.path] ? { path: args.path, namespace: "qa-io" } : undefined);
      engine.onLoad({ filter: /.*/, namespace: "qa-io" }, args => ({ contents: modules[args.path], loader: "js" }));
    } }] });
  const output = path.resolve("../../.playwright-mcp/payment-command-134"); await mkdir(output, {recursive: true});
  const css = await cssPromise;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    const qaUrl = "http://localhost/qa134-payment-dialog";
    const html = '<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '*{animation:none!important;transition:none!important;caret-color:transparent}</style><body style="font-family:Arial,sans-serif"><div id="root"></div><script>' + Buffer.from(bundled.outputFiles[0].contents).toString("utf8").replaceAll("</script", "<\\/script") + "</script></body></html>";
    await page.route("**/*", route => route.request().url() === qaUrl ? route.fulfill({status: 200, contentType: "text/html", body: html}) : route.abort());
    await page.goto(qaUrl);
    await page.waitForFunction(() => !document.querySelector<HTMLInputElement>("#pay-rate")?.matches(":disabled") && document.querySelector<HTMLInputElement>("#pay-rate")?.value === "2.5");
    await page.locator("#pay-amount").fill("100.25");
    await page.locator("#pay-rate").fill("3.5");
    await page.locator("#pay-comment").fill("QA exact intent");
    await page.screenshot({path: path.join(output, "390-normal.png")});
    for (const [index, mode] of ["UNKNOWN", "THROW", "ACK"].entries()) {
      await page.evaluate(next => { (window as unknown as { __mode: string }).__mode = next; }, mode);
      const submit = page.getByRole("button", { name: index === 0 ? "Внести приход" : "Проверить", exact: true });
      await submit.focus(); await submit.press("Enter");
      await page.waitForFunction(expected => (window as unknown as { __requests: unknown[] }).__requests.length === expected, index + 1);
      if (index < 2) {
        const verify = page.getByRole("button", { name: "Проверить", exact: true });
        await verify.waitFor({ state: "visible" });
        assert.equal(await page.locator("#pay-amount").isDisabled(), true);
        assert.equal(await page.locator("#pay-amount").inputValue(), "100.25");
        assert.equal(await page.locator("#pay-rate").inputValue(), "3.5");
        if (index === 0) {
          const cancel = page.getByRole("button", { name: "Отмена", exact: true }); await cancel.focus(); await cancel.press("Enter");
          await page.getByRole("dialog").waitFor({ state: "hidden" });
          const reopen = page.getByRole("button", { name: "Открыть повторно", exact: true }); await reopen.focus(); await reopen.press("Enter");
        } else await page.reload();
        await page.getByRole("button", { name: "Проверить", exact: true }).waitFor({ state: "visible" });
        await page.waitForFunction(() => document.querySelector<HTMLInputElement>("#pay-rate")?.value === "3.5");
        assert.equal(await page.locator("#pay-amount").isDisabled(), true);
        assert.equal(await page.locator("#pay-amount").inputValue(), "100.25");
        assert.equal(await page.getByRole("dialog").isVisible(), true);
        if (index === 1) await page.screenshot({path: path.join(output, "390-unknown-reloaded.png")});
        assert.equal(await page.evaluate(() => (window as unknown as {__requests: unknown[]}).__requests.length), index + 1);
        assert.equal(await page.evaluate(() => (window as unknown as {__fxCalls: number}).__fxCalls), 1, "Pinned intent must not refetch FX");
      }
    }
    await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 3000 });
    const observed = await page.evaluate(() => { const state = window as unknown as { __requests: Record<string, unknown>[]; __refreshes: number; __fxCalls: number }; return { requests: state.__requests, refreshes: state.__refreshes, fxCalls: state.__fxCalls }; });
    assert.equal(observed.requests.length, 3);
    assert.match(String(observed.requests[0].clientMutationId), /^[a-f0-9-]{36}$/);
    assert.deepEqual(observed.requests[0], observed.requests[1]); assert.deepEqual(observed.requests[0], observed.requests[2]);
    assert.equal(observed.requests[0].amount, 100.25); assert.equal(observed.requests[0].rate, 3.5);
    assert.equal(observed.requests[0].rateDate, "2026-10-10"); assert.equal(observed.refreshes, 1);
  } finally { await context.close(); }
});

test("confirmed rejection finishes one intent and a valid new command gets a fresh UUID", async () => {
  const requests: { status: string; context: TaskStatusContext }[] = []; let serial = 0;
  const controller = createTaskStatusCommands(async (taskId, status, _minutes, context) => {
    requests.push({ status, context });
    return requests.length === 1 ? { ok: false, outcome: "ROLLED_BACK", error: "Нет времени" }
      : { ok: true, outcome: "COMMITTED", resultId: taskId, clientMutationId: context.clientMutationId };
  }, () => `00000133-0000-4000-8000-${String(++serial).padStart(12, "0")}`);
  controller.observeActor("actor");
  const rejected = await controller.run("actor", "task", "DONE");
  assert.equal(rejected && !rejected.ok ? rejected.outcome : undefined, "ROLLED_BACK");
  assert.equal(controller.peek("task"), undefined);
  assert.equal((await controller.run("actor", "task", "IN_PROGRESS"))?.ok, true);
  assert.equal((await controller.run("actor", "task", "DONE"))?.ok, true);
  assert.equal(new Set(requests.map(request => request.context.clientMutationId)).size, 3);
  assert.deepEqual(requests.map(request => request.status), ["DONE", "IN_PROGRESS", "DONE"]);
});
}

{ // Источник: task-creation-command.browser.test.ts
const sourceRoot = path.resolve("src").replaceAll("\\", "/");
type Engine = { onResolve(options: {filter: RegExp}, handler: (args: {path: string}) => {path: string; namespace: string}|undefined): void;
  onLoad(options: {filter: RegExp; namespace: string}, handler: () => {contents: string; loader: "tsx"|"js"; resolveDir?: string}): void };
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
  const css = await cssPromise;
  // Shallow CI сохраняет поведенческий Chromium gate; настоящая baseline visual пара получена локально.
  const compareBaseline = process.env.CI !== "true";
  const old = compareBaseline ? await bundle(true) : null, current = await bundle(false);
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
});
}
