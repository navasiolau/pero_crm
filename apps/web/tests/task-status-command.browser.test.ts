import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { after, test } from "node:test";
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

test("Chromium actual PaymentDialog preserves exact UUID/payload through UNKNOWN and transport loss", async () => {
  const sourceRoot = path.resolve(process.cwd(), "src").replaceAll("\\", "/");
  const modules: Record<string, string> = {
    "next/navigation": "export const useRouter=()=>({refresh:()=>{window.__refreshes++}});",
    "@/server/payments/actions": "export const addPayment=(data)=>window.__pay(data);",
    "@/server/warehouse/stock-purchase-actions": "export const addPaidStockReceipt=()=>{throw Error('unexpected stock RPC')};",
    "@/server/finance/actions": "export const fetchNbrbRate=()=>{throw Error('unexpected FX RPC')};",
    "@/components/finance-document-upload": "export const FinanceDocumentUpload=()=>null;",
    "@/components/stock-material-fields": "export const StockMaterialFields=()=>null;",
  };
  const entry = `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{Toaster}from'sonner';
import{PaymentDialog}from${JSON.stringify(sourceRoot + "/components/payment-dialog.tsx")};
window.__requests=[];window.__mode='UNKNOWN';window.__refreshes=0;
window.__pay=async(data)=>{window.__requests.push(data);if(window.__mode==='THROW')throw Error('lost response');return window.__mode==='UNKNOWN'?{ok:false,outcome:'UNKNOWN',retrySafe:true,error:'Подтверждение неизвестно'}:{ok:true,outcome:'COMMITTED',resultId:'own-payment',paymentId:'own-payment'};};
function App(){const[open,setOpen]=useState(true);return <><PaymentDialog direction='INCOME' open={open} onOpenChange={setOpen} projectCurrency='BYN' cashAccounts={[{id:'cash',name:'QA cash',currency:'BYN'}]} expenseArticles={[]}/><Toaster/></>};createRoot(document.getElementById('root')).render(<App/>);`;
  const bundled = await compiler.build({ stdin: { contents: entry, loader: "jsx", resolveDir: process.cwd(), sourcefile: "qa133-payment-dialog-entry.jsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", target: "es2022", logLevel: "silent",
    tsconfig: path.resolve("tsconfig.json"), define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "declared-qa-io", setup(engine: QaBuild) {
      engine.onResolve({ filter: /.*/ }, args => modules[args.path] ? { path: args.path, namespace: "qa-io" } : undefined);
      engine.onLoad({ filter: /.*/, namespace: "qa-io" }, args => ({ contents: modules[args.path], loader: "js" }));
    } }] });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route("**/*", route => route.abort());
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: Buffer.from(bundled.outputFiles[0].contents).toString("utf8") });
    await page.locator("#pay-amount").fill("100.25");
    await page.locator("#pay-comment").fill("QA exact intent");
    const submit = page.getByRole("button", { name: "Внести приход", exact: true });
    for (const [index, mode] of ["UNKNOWN", "THROW", "ACK"].entries()) {
      await page.evaluate(next => { (window as unknown as { __mode: string }).__mode = next; }, mode);
      await submit.focus(); await submit.press("Enter");
      await page.waitForFunction(expected => (window as unknown as { __requests: unknown[] }).__requests.length === expected, index + 1);
      if (index < 2) {
        await submit.waitFor({ state: "visible" });
        await page.waitForFunction(() => !document.querySelector<HTMLFieldSetElement>("fieldset")?.disabled);
        assert.equal(await page.locator("#pay-amount").inputValue(), "100.25");
        assert.equal(await page.getByRole("dialog").isVisible(), true);
      }
    }
    await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 3000 });
    const observed = await page.evaluate(() => { const state = window as unknown as { __requests: Record<string, unknown>[]; __refreshes: number }; return { requests: state.__requests, refreshes: state.__refreshes }; });
    assert.equal(observed.requests.length, 3);
    assert.match(String(observed.requests[0].clientMutationId), /^[a-f0-9-]{36}$/);
    assert.deepEqual(observed.requests[0], observed.requests[1]); assert.deepEqual(observed.requests[0], observed.requests[2]);
    assert.equal(observed.requests[0].amount, 100.25); assert.equal(observed.refreshes, 1);
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
