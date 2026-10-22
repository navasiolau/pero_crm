import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url), web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild"), { chromium } = require("@playwright/test");

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
