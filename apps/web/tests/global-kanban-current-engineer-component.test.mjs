import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");
const { chromium } = require("@playwright/test");
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = build({
  stdin: { contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {ProductsKanban} from '@/app/(app)/products/products-kanban';
    import {ProductsTab} from '@/app/(app)/projects/[id]/products-tab';
    const product={id:'p',number:'128.1',title:'Контрольное изделие',kind:null,status:'PRODUCTION',statusChangedAt:new Date(0).toISOString(),expectedPrice:null,quantity:1,currency:'BYN',projectId:'project',projectStage:'CONTRACT',projectNumber:'128',projectTitle:'Контрольный проект',clientId:'client',clientName:'Контрольный клиент',engineerId:'current',engineerName:'Инженер',isEngineeringParticipant:window.__participant,hasB3d:false,noModel:false,sketchFile:null};
    const props={initialProducts:[product],actorUserId:window.__actor,actorRoles:window.__roles,canManage:window.__roles.includes('MANAGER'),showAmount:false,projectId:'project',projectStage:'CONTRACT',currency:'BYN',engineerOptions:[]};
    const Component=window.__board==='global'?ProductsKanban:ProductsTab;
    createRoot(document.getElementById('root')).render(<Component {...props}/>);
  `, resolveDir: web, loader: "tsx" },
  bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", tsconfig: path.join(web, "tsconfig.json"),
  define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
  plugins: [{ name: "controlled-boundaries", setup(builder) {
    builder.onResolve({ filter: /^(next\/navigation|@\/lib\/list-params|@\/server\/products\/actions|sonner)$/ }, args => ({ path: args.path, namespace: "boundary" }));
    builder.onLoad({ filter: /.*/, namespace: "boundary" }, args => ({ loader: "js", contents:
      args.path === "next/navigation" ? "export const useRouter=()=>({push:href=>window.__nav.push(href),refresh:()=>window.__refreshes++});" :
      args.path === "@/lib/list-params" ? "export const useListParams=()=>({query:'view=kanban',get:()=>'',set(){}});" :
      args.path === "sonner" ? "export const toast={error:value=>window.__errors.push(value),success:value=>window.__success.push(value)};" :
      "export const createProduct=async()=>{throw Error('CREATE_FORBIDDEN')};export const changeProductStatus=async(id,status)=>{window.__writes.push({id,status});return window.__deny?{ok:false,error:'Контрольный отказ'}:{ok:true};};"
    }));
  } }],
});
async function withBoard(board, options, run) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); page.setDefaultTimeout(8000);
    await page.setContent(`<style>
      body{margin:0;font-family:Arial}.relative{position:relative}[data-slot=product-kanban-card]{min-height:120px}[data-slot=kanban-column]{display:flex;flex-direction:column;flex-shrink:0;width:256px;min-height:300px;padding:8px;border:1px solid #aaa}
      [data-slot=kanban-track]{display:flex;gap:16px;overflow-x:auto}
      [data-kanban-card-id]{position:relative;min-height:120px;padding:12px;border:1px solid #ccc;margin-top:12px}
      button[aria-label^="Перетащить"]{position:absolute;left:0;top:0;width:32px;height:32px;z-index:10}
    </style><div id="root"></div>`);
    await page.evaluate(({ board, options }) => { window.__board=board;window.__actor=options.actor??'current';window.__participant=options.participant??false;window.__roles=options.roles??['ENGINEER'];window.__deny=options.deny??false;window.__writes=[];window.__nav=[];window.__refreshes=0;window.__errors=[];window.__success=[]; }, { board, options });
    await page.addScriptTag({ content: (await bundle).outputFiles[0].text });
    await page.getByText("Контрольное изделие",{exact:true}).waitFor();
    await run(page);
  } finally { await browser.close(); }
}
async function dragToDesign(page, cancel = false) {
  const handle = page.getByRole("button", { name: /^Перетащить / });
  const target = page.locator('[data-slot="kanban-column"]').filter({ has: page.getByText("Проектирование", { exact: true }) });
  const from = await handle.boundingBox(), to = await target.boundingBox(); assert.ok(from && to);
  await page.mouse.move(from.x+from.width/2, from.y+from.height/2);
  await page.mouse.down(); await page.mouse.move(from.x+from.width/2+12,from.y+from.height/2,{steps:3});
  await page.mouse.move(to.x+to.width/2,to.y+Math.min(to.height/2,100),{steps:10});
  if(cancel)await page.keyboard.press("Escape");
  await page.mouse.up();
}
for (const board of ["global", "project"]) {
  test(`${board}: настоящий pointer drag возвращает текущего инженера без participant`, async () => {
    await withBoard(board, {}, async page => {
      await dragToDesign(page);
      await page.waitForFunction(() => window.__writes.length === 1);
      assert.deepEqual(await page.evaluate(() => window.__writes), [{ id: "p", status: "DESIGN" }]);
      await page.waitForFunction(() => window.__refreshes === 1);
      const design = page.locator('[data-slot="kanban-column"]').filter({ has: page.getByText("Проектирование", { exact: true }) });
      assert.equal(await design.getByText("Контрольное изделие",{exact:true}).count(), 1);
    });
  });
  test(`${board}: бывший участник не получает drag по роли ENGINEER+WORKER`, async () => {
    await withBoard(board, { actor: "former", participant: true, roles: ["ENGINEER", "WORKER"] }, async page => {
      assert.equal(await page.getByRole("button", { name: /^Перетащить / }).count(), 0);
      assert.deepEqual(await page.evaluate(() => window.__writes), []);
    });
  });
  test(`${board}: отказ сервера откатывает оптимистичную карточку`, async () => {
    await withBoard(board, { deny: true }, async page => {
      await dragToDesign(page); await page.waitForFunction(() => window.__errors.includes("Контрольный отказ"));
      const production = page.locator('[data-slot="kanban-column"]').filter({ has: page.getByText("В производстве", { exact: true }) });
      assert.equal(await production.getByText("Контрольное изделие",{exact:true}).count(), 1);
      assert.equal(await page.evaluate(() => window.__refreshes), 0);
    });
  });
  test(`${board}: Escape отменяет drag без записи и навигации`, async () => {
    await withBoard(board, {}, async page => {
      await dragToDesign(page, true);
      assert.deepEqual(await page.evaluate(() => window.__writes), []);
      assert.deepEqual(await page.evaluate(() => window.__nav), []);
    });
  });
}
