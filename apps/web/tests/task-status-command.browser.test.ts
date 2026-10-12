import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { after, test } from "node:test";
import { mkdir, readFile } from "node:fs/promises";
import type { TaskStatusAck, TaskStatusContext } from "../src/server/tasks/status-receipts";
const require = createRequire(import.meta.url), originals = new Map<string, NodeJS.Module | undefined>();
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
  const first = await controller.run("actor", "task", "DONE", 20); assert.equal(first?.ok, false);
  assert.equal(first && !first.ok ? first.outcome : undefined, "UNKNOWN");
  assert.equal((await controller.run("actor", "task", "DONE", 20))?.ok, true);
  assert.deepEqual(requests[0], requests[1]); assert.equal(controller.peek("task"), undefined);
});

test("unit controller refuses changed payload while original intent remains unknown", async () => {
  let calls = 0;
  const controller = createTaskStatusCommands(async () => { calls++; return { ok: false, outcome: "UNKNOWN", error: "unknown" }; }, () => id);
  controller.observeActor("actor"); await controller.run("actor", "task", "DONE", 20);
  assert.equal((await controller.run("actor", "task", "DONE", 30))?.ok, false);
  assert.equal(calls, 1); assert.equal(controller.peek("task")?.actualMinutes, 20);
});

test("unit controller drops stale ACK after actor swap and never reuses old actor intent", async () => {
  let resolve!: (ack: TaskStatusAck) => void; const requests: TaskStatusContext[] = [];
  const controller = createTaskStatusCommands(async (_task, _status, _minutes, context) => { requests.push(context); return new Promise<TaskStatusAck>(done => { resolve = done; }); }, () => id);
  controller.observeActor("old"); const pending = controller.run("old", "task", "DONE", 20);
  controller.observeActor("new"); resolve({ ok: true, outcome: "COMMITTED", resultId: "task", clientMutationId: id });
  assert.equal(await pending, null); assert.equal(controller.peek("task"), undefined);
  assert.equal(await controller.run("old", "task", "DONE", 20), null); assert.equal(requests.length, 1);
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
  controller.observeActor("actor"); const a = controller.run("actor", "task", "DONE", 20), b = controller.run("actor", "task", "DONE", 20);
  resolve({ ok: false, kind: "actor-changed", error: "changed" });
  assert.equal((await a)?.ok, false); assert.equal((await b)?.ok, false); assert.equal(calls, 1);
  assert.equal(controller.peek("task"), undefined); assert.equal(await controller.run("actor", "task", "DONE", 20), null);
});
import { chromium } from "@playwright/test";
import path from "node:path";
const compiler = createRequire(require.resolve("tsx/package.json"))("esbuild") as { build(options: Record<string, unknown>): Promise<{ outputFiles: { contents: Uint8Array }[] }> };
type QaBuild = { onResolve(options: { filter: RegExp }, handler: (args: { path: string }) => { path: string; namespace: string } | undefined): void;
  onLoad(options: { filter: RegExp; namespace: string }, handler: (args: { path: string }) => { contents: string; loader: "js" }): void };

test("Chromium actual dialog repeats UNKNOWN UUID and closes on historical confirmation without applying old state", async () => {
  const sourceRoot = path.resolve(process.cwd(), "src").replaceAll("\\", "/");
  const modules: Record<string, string> = {
    "next/navigation": "export const useRouter=()=>({refresh:()=>{window.__refreshes++}});",
    "@/server/tasks/actions": "export const changeTaskStatus=(...args)=>window.__respond(...args);",
  };
  const entry = `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{Toaster}from'sonner';
import{ActualTimeDialog}from${JSON.stringify(sourceRoot + "/components/actual-time-dialog.tsx")};
window.__requests=[];window.__mode='UNKNOWN';window.__refreshes=0;window.__applied=0;
window.__respond=async(taskId,toStatus,minutes,context)=>{window.__requests.push({taskId,toStatus,minutes,context});return window.__mode==='UNKNOWN'?{ok:false,outcome:'UNKNOWN',retrySafe:true,error:'Ответ неизвестен'}:{ok:true,outcome:'COMMITTED',resultId:taskId,clientMutationId:context.clientMutationId,replayed:true};};
function App(){const[open,setOpen]=useState(true);const[key,setKey]=useState(0);window.__remount=()=>setKey(value=>value+1);return <><ActualTimeDialog key={key} task={{id:'task',title:'QA task'}} actorUserId='actor' open={open} onOpenChange={setOpen} onDone={()=>window.__applied++}/><Toaster/></>};createRoot(document.getElementById('root')).render(<App/>);`;
  const bundled = await compiler.build({ stdin: { contents: entry, loader: "jsx", resolveDir: process.cwd(), sourcefile: "qa133-dialog-entry.jsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", target: "es2022", logLevel: "silent",
    tsconfig: path.resolve("tsconfig.json"), define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "declared-qa-io", setup(engine: QaBuild) {
      engine.onResolve({ filter: /.*/ }, args => modules[args.path] ? { path: args.path, namespace: "qa-io" } : undefined);
      engine.onLoad({ filter: /.*/, namespace: "qa-io" }, args => ({ contents: modules[args.path], loader: "js" }));
    } }] });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route("**/*", route => route.abort()); // Физический network запрещён; RPC только declared QA IO.
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: Buffer.from(bundled.outputFiles[0].contents).toString("utf8") });
    await page.locator("#actual-min").fill("20");
    await page.getByRole("button", { name: "Выполнено", exact: true }).focus();
    await page.getByRole("button", { name: "Выполнено", exact: true }).press("Enter");
    await page.waitForFunction(() => (window as unknown as { __requests: unknown[] }).__requests.length === 1);
    assert.equal(await page.locator("#actual-min").isDisabled(), true);
    await page.evaluate(() => { (window as unknown as { __remount: () => void }).__remount(); });
    assert.equal(await page.locator("#actual-min").inputValue(), "20");
    assert.equal(await page.locator("#actual-min").isDisabled(), true);
    await page.evaluate(() => { (window as unknown as { __mode: string }).__mode = "REPLAY"; });
    await page.getByRole("button", { name: "Выполнено", exact: true }).focus();
    await page.getByRole("button", { name: "Выполнено", exact: true }).press("Enter");
    await page.waitForFunction(() => (window as unknown as { __requests: unknown[] }).__requests.length === 2);
    const observed = await page.evaluate(() => { const state = window as unknown as { __requests: object[]; __refreshes: number; __applied: number }; return { requests: state.__requests, refreshes: state.__refreshes, applied: state.__applied }; });
    assert.deepEqual(observed.requests[0], observed.requests[1]); assert.ok(observed.refreshes >= 2); assert.equal(observed.applied, 0);
    await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 3000 });
  } finally { await browser.close(); }
});

test("Chromium actual PaymentDialog preserves UUID/manual FX through UNKNOWN, reopen and reload", async () => {
  const sourceRoot = path.resolve(process.cwd(), "src").replaceAll("\\", "/");
  const modules: Record<string, string> = {
    "next/navigation": "export const useRouter=()=>({refresh:()=>{window.__refreshes++}});",
    "@/server/payments/actions": "export const getPaymentActorId=async()=>({ok:true,actorId:'actor'});export const addPayment=(data,actor)=>window.__pay(data,actor);",
    "@/server/warehouse/stock-purchase-actions": "export const addPaidStockReceipt=()=>{throw Error('unexpected stock RPC')};",
    "@/server/finance/actions": "export const fetchNbrbRate=async()=>{window.__fxCalls++;sessionStorage.setItem('qa134:fx',String(window.__fxCalls));return{ok:true,rate:2.5,date:'2026-10-10'}};",
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
  const postcss = createRequire(require.resolve("@tailwindcss/postcss"))("postcss") as {(plugins: unknown[]): {process(css: string, options: {from: string}): Promise<{css: string}>}};
  const tailwind = require("@tailwindcss/postcss") as (options: {base: string}) => unknown;
  const css = (await postcss([tailwind({base: process.cwd()})]).process(await readFile("src/app/globals.css", "utf8"), {from: path.resolve("src/app/globals.css")})).css;
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
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
  } finally { await browser.close(); }
});

test("confirmed rejection finishes one intent and a valid new command gets a fresh UUID", async () => {
  const requests: { status: string; context: TaskStatusContext }[] = []; let serial = 0;
  const controller = createTaskStatusCommands(async (taskId, status, _minutes, context) => {
    requests.push({ status, context });
    return requests.length === 1 ? { ok: false, outcome: "ROLLED_BACK", error: "Нет времени" }
      : { ok: true, outcome: "COMMITTED", resultId: taskId, clientMutationId: context.clientMutationId };
  }, () => `00000133-0000-4000-8000-${String(++serial).padStart(12, "0")}`);
  controller.observeActor("actor");
  const rejected = await controller.run("actor", "task", "DONE", 20);
  assert.equal(rejected && !rejected.ok ? rejected.outcome : undefined, "ROLLED_BACK");
  assert.equal(controller.peek("task"), undefined);
  assert.equal((await controller.run("actor", "task", "IN_PROGRESS"))?.ok, true);
  assert.equal((await controller.run("actor", "task", "DONE", 20))?.ok, true);
  assert.equal(new Set(requests.map(request => request.context.clientMutationId)).size, 3);
  assert.deepEqual(requests.map(request => request.status), ["DONE", "IN_PROGRESS", "DONE"]);
});
