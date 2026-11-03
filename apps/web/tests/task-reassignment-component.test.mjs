import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url), web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild"), { chromium } = require("@playwright/test");
const tailwind = require("@tailwindcss/postcss"), postcss = createRequire(require.resolve("@tailwindcss/postcss"))("postcss");
let css;

test("actual reassignment dialog freezes an uncertain command and retries the same UUID", async () => {
  const boundaries = {
    "next/navigation": "export function useRouter(){return{refresh(){window.__refreshes++}}}",
    sonner: "export const toast={success(){window.__successes++},error(){}}",
    "@/server/tasks/task-reassignment-actions": `export async function getTaskReassignmentOptions(taskId){window.__opens++;return{ok:true,taskId,title:'Обычная задача',assigneeId:'old',expectedRevision:7,recipients:[{value:'old',label:'Прежний сотрудник'},{value:'new',label:'Новый сотрудник'}]}};export async function reassignOrdinaryTask(input){window.__calls.push(input);if(window.__calls.length===1)throw Error('LOST_ACK');return{ok:true,taskId:input.taskId,assigneeId:input.assigneeId,revision:8,status:'NEW',repeated:true}}`,
  };
  const result = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{TaskReassignmentButton}from'@/components/task-reassignment-dialog';window.__calls=[];window.__opens=0;window.__refreshes=0;window.__successes=0;window.__done=0;createRoot(document.getElementById('root')).render(<TaskReassignmentButton taskId="task" onDone={()=>window.__done++}/>);`, resolveDir: web, loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", tsconfig: path.join(web, "tsconfig.json"), define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
    plugins: [{ name: "reassignment-transport-boundaries", setup(builder) {
      builder.onResolve({ filter: /^(?:next\/navigation|sonner|@\/server\/tasks\/task-reassignment-actions)$/ }, args => ({ path: args.path, namespace: "boundary" }));
      builder.onLoad({ filter: /.*/, namespace: "boundary" }, args => ({ contents: boundaries[args.path], loader: "js" }));
    } }] });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(5000);
    await page.route('https://reassignment.fixture/', route => route.fulfill({ contentType: 'text/html', body: '<style>.z-50{z-index:50}[data-slot=dialog-content]{position:relative;z-index:50;background:white}</style><div id="root"></div>' }));
    await page.goto('https://reassignment.fixture/');await page.addScriptTag({ content: result.outputFiles[0].text });
    await page.getByRole('button', { name: 'Переназначить', exact: true }).click();const dialog = page.getByRole('dialog');await dialog.waitFor();
    assert.equal(await page.evaluate(() => window.__opens), 1);
    await dialog.getByRole('button', { name: /Выберите исполнителя/ }).click();await page.getByRole('button', { name: 'Новый сотрудник', exact: true }).click();
    await dialog.getByRole('button', { name: 'Переназначить', exact: true }).click();await dialog.getByRole('button', { name: 'Повторить тот же запрос' }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: 'Отмена', exact: true }).isDisabled(), true);
    await page.keyboard.press('Escape');assert.equal(await dialog.count(), 1);
    await dialog.getByRole('button', { name: 'Повторить тот же запрос' }).click();await dialog.waitFor({ state: 'hidden' });
    const observed = await page.evaluate(() => ({ calls: window.__calls, same: window.__calls[0] === window.__calls[1], refreshes: window.__refreshes, done: window.__done, successes: window.__successes }));
    assert.equal(observed.calls.length, 2);assert.equal(observed.same, true);assert.deepEqual(observed.calls[0], observed.calls[1]);assert.equal(observed.calls[0].expectedRevision, 7);
    assert.equal(observed.done, 1);assert.equal(observed.refreshes, 1);assert.equal(observed.successes, 1);
  } finally { await browser.close(); }
});

for (const mode of ["full", "part"]) test(`completed task ${mode} dialog preserves completion and submits the selected recipient`, async () => {
  css ??= postcss([tailwind({ base: web })]).process(readFileSync(path.join(web, "src/app/globals.css"), "utf8"), { from: path.join(web, "src/app/globals.css") }).then(result => result.css);
  const boundaries = {
    "next/navigation": "export function useRouter(){return{refresh(){window.__refreshes++}}}",
    sonner: "export const toast={success(){},error(){}}",
    "@/server/tasks/task-reassignment-actions": `export async function getTaskReassignmentOptions(){return{ok:true,taskId:'task',title:'Шлифовка фасадов перед покраской',status:'DONE',assigneeId:'old',expectedRevision:7,recipients:[{value:'old',label:'Прежний исполнитель'},{value:'new',label:'Новый исполнитель'}]}};export async function reassignOrdinaryTask(input){window.__calls.push(input);return{ok:true,status:'DONE'}}`,
    "@/server/tasks/piecework-actions": `export async function getPieceworkOptions(){return null};export async function createPieceworkAllocation(){throw Error('UNEXPECTED_CREATE')};export async function transferPieceworkShare(input){window.__calls.push(input);return{ok:true}}`,
  };
  const element = mode === "full" ? '<TaskReassignmentButton taskId="task"/>' : `<PieceworkAllocationDialog context={{mode:'transfer',taskId:'task',productId:'product',title:'Шлифовка фасадов перед покраской'}} options={{recipients:[{id:'new',name:'Новый исполнитель'}],canCreate:true,transferable:true,works:[],source:{revision:7,shareUnits:1000000,amount:'1000.00',currency:'BYN',completed:true}}} onClose={()=>window.__root.render(null)}/>`;
  const bundled = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{TaskReassignmentButton}from'@/components/task-reassignment-dialog';import{PieceworkAllocationDialog}from'@/components/piecework-allocation-dialog';window.__calls=[];window.__refreshes=0;window.__root=createRoot(document.getElementById('root'));window.__root.render(${element});`, resolveDir: web, loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", tsconfig: path.join(web, "tsconfig.json"), define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
    plugins: [{ name: "task210-server-boundaries", setup(builder) {
      builder.onResolve({ filter: /^(?:next\/navigation|sonner|@\/server\/tasks\/(?:task-reassignment-actions|piecework-actions))$/ }, args => ({ path: args.path, namespace: "boundary" }));
      builder.onLoad({ filter: /.*/, namespace: "boundary" }, args => ({ contents: boundaries[args.path], loader: "js" }));
    } }] });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(8000);
    await page.route("https://task210.fixture/", route => route.fulfill({ contentType: "text/html", body: '<html lang="ru"><meta name="viewport" content="width=device-width, initial-scale=1"><body class="font-sans" style="--font-roboto:Arial"><div id="root"></div></body></html>' }));
    await page.goto("https://task210.fixture/"); await page.addStyleTag({ content: await css }); await page.addScriptTag({ content: bundled.outputFiles[0].text });
    if (mode === "full") await page.getByRole("button", { name: "Переназначить", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: mode === "full" ? "Переназначить задачу" : "Передать часть доли", exact: true }); await dialog.waitFor();
    assert.match(await dialog.innerText(), mode === "full" ? /Статус «Выполнена» и дата выполнения сохранятся/ : /Переданная часть останется выполненной/);
    for (const [width, height] of [[360, 800], [390, 844], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      const box = await dialog.boundingBox(); assert.ok(box && box.x >= -1 && box.x + box.width <= width + 1);
      if (process.env.CRM_TASK_210_VISUAL === "1") {
        const output = path.resolve(web, "../../.playwright-mcp/task-210"); mkdirSync(output, { recursive: true });
        await page.screenshot({ path: path.join(output, `${mode}-${width}.png`), fullPage: true });
      }
    }
    await dialog.getByRole("button", { name: mode === "full" ? /Выберите исполнителя/ : /Выберите сотрудника/ }).click();
    await page.getByRole("button", { name: "Новый исполнитель", exact: true }).click();
    if (mode === "part") { await dialog.locator("#piecework-transfer-percent").fill("40"); assert.match(await dialog.innerText(), /400/); }
    await dialog.getByRole("button", { name: mode === "full" ? "Переназначить" : "Передать", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    const observed = await page.evaluate(() => ({ calls: window.__calls, refreshes: window.__refreshes }));
    assert.equal(observed.calls.length, 1); assert.equal(observed.calls[0].expectedRevision, 7); assert.equal(observed.refreshes, 1);
    assert.equal(mode === "full" ? observed.calls[0].assigneeId : observed.calls[0].recipientId, "new");
    if (mode === "part") assert.equal(observed.calls[0].percent, "40");
  } finally { await browser.close(); }
});
