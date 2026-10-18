import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");
const { chromium } = require("@playwright/test");
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });
const bundle = build({
  stdin: { contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {ProductsKanban} from '@/app/(app)/products/products-kanban';
    import {ProductsTab} from '@/app/(app)/projects/[id]/products-tab';
    import {RecentProjects} from '@/components/recent-projects';
    function App(){
      const [options,setOptions]=React.useState(window.__options);window.__setOptions=setOptions;
      React.useEffect(()=>{window.__applied=options},[options]);
      const roles=options.roles??['ENGINEER'];
      const product={id:'p',number:'128.1',title:'Контрольное изделие',kind:null,status:options.status??'PRODUCTION',canAccessDraft:options.canAccessDraft===true,statusChangedAt:new Date(0).toISOString(),expectedPrice:null,quantity:1,currency:'BYN',projectId:'project',projectStage:options.projectStage??'CONTRACT',projectNumber:'128',projectTitle:'Контрольный проект',clientId:'client',clientName:'Контрольный клиент',engineerId:'current',engineerName:'Инженер',isEngineeringParticipant:options.participant??false,hasB3d:false,noModel:false,sketchFile:null};
      const props={initialProducts:[product],actorUserId:options.actor??'current',actorRoles:roles,canManage:roles.some(role=>['ADMIN','DIRECTOR','MANAGER'].includes(role)),showAmount:false,projectId:'project',projectStage:product.projectStage,currency:'BYN',engineerOptions:[]};
      const Component=window.__board==='global'?ProductsKanban:ProductsTab;return <><Component {...props}/><RecentProjects projects={[{id:'recent-project',number:'205',client:'Клиент',product:'Название заказа',status:'В работе',statusClass:'',sum:'10 BYN'}]}/></>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  `, resolveDir: web, loader: "tsx" },
  bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", tsconfig: path.join(web, "tsconfig.json"),
  define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
  plugins: [{ name: "controlled-boundaries", setup(builder) {
    builder.onResolve({ filter: /^(next\/navigation|next\/link|@\/lib\/list-params|@\/server\/products\/actions|sonner)$/ }, args => ({ path: args.path, namespace: "boundary" }));
    builder.onLoad({ filter: /.*/, namespace: "boundary" }, args => ({ loader: "js", resolveDir: web, contents:
      args.path === "next/navigation" ? "export const useRouter=()=>({push:href=>window.__nav.push(href),refresh:()=>window.__refreshes++});" :
      args.path === "next/link" ? "import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children);}" :
      args.path === "@/lib/list-params" ? "export const useListParams=()=>({query:'view=kanban',getQuery:()=>'view=kanban',get:()=>'',set(){}});" :
      args.path === "sonner" ? "export const toast={error:value=>window.__errors.push(value),success:value=>window.__success.push(value)};" :
      "export const createProduct=async()=>{throw Error('CREATE_FORBIDDEN')};export const changeProductStatus=async(id,status)=>{window.__writes.push({id,status});return window.__deny?{ok:false,error:'Контрольный отказ'}:{ok:true};};"
    }));
  } }],
});
async function withBoard(board, options, run) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const page = await context.newPage(); page.setDefaultTimeout(8000);
    await page.setContent(`<style>
      body{margin:0;font-family:Arial}.relative{position:relative}[data-slot=product-kanban-card]{min-height:120px}[data-slot=kanban-column]{display:flex;flex-direction:column;flex-shrink:0;width:256px;min-height:300px;padding:8px;border:1px solid #aaa}
      [data-slot=kanban-scroll]{overflow-x:auto}[data-kanban-columns]{display:flex;gap:16px;width:max-content;min-width:100%}
      [data-kanban-card-id]{position:relative;min-height:120px;padding:12px;border:1px solid #ccc;margin-top:12px}
      button[aria-label^="Перетащить"]{position:absolute;left:0;top:0;width:32px;height:32px;z-index:10}
    </style><div id="root"></div>`);
    await page.evaluate(({ board, options }) => { window.__board=board;window.__options=options;window.__deny=options.deny??false;window.__writes=[];window.__nav=[];window.__refreshes=0;window.__errors=[];window.__success=[]; }, { board, options });
    await page.addScriptTag({ content: (await bundle).outputFiles[0].text });
    await page.locator('[data-slot="kanban-scroll"]').waitFor();
    await run(page);
  } finally { await context.close(); }
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
      for(const options of [{actor:'former',participant:true,roles:['ENGINEER','WORKER']},{actor:''},...['STORAGE','INSTALLATION','DONE','RECLAMATION'].map(status=>({status}))]){
        await page.evaluate(value=>{window.__setOptions(value);return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));},options);
        await page.waitForFunction(value=>JSON.stringify(window.__applied)===JSON.stringify(value),options);
        assert.equal(await page.getByRole("button", { name: /^Перетащить / }).count(), 0);
      }
      for(const roles of [['MANAGER'],['MANAGER','ENGINEER'],['ENGINEER'],['WORKER'],['MOUNTER'],['PROCUREMENT'],['ACCOUNTANT']]){
        const options={roles,status:'DRAFT',projectStage:'ESTIMATE'};
        await page.evaluate(value=>{window.__setOptions(value);return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));},options);await page.waitForFunction(value=>JSON.stringify(window.__applied)===JSON.stringify(value),options);
        assert.equal(await page.getByText('Черновики',{exact:true}).count(),0);assert.equal(await page.getByText('Контрольное изделие',{exact:true}).count(),0);
      }
      for(const projectStage of ['ESTIMATE','CONTRACT']){
        const options={roles:['ADMIN'],status:'DRAFT',projectStage};
        await page.evaluate(value=>{window.__setOptions(value);return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));},options);await page.waitForFunction(value=>JSON.stringify(window.__applied)===JSON.stringify(value),options);
        const columns=page.locator('[data-slot="kanban-column"]');
        assert.ok((await columns.nth(0).innerText()).includes('Черновики'));assert.ok((await columns.nth(1).innerText()).includes('Подготовка'));
        assert.equal(await page.getByText('Контрольное изделие',{exact:true}).count(),1);assert.equal(await page.getByRole('button',{name:/^Перетащить /}).count(),Number(projectStage==='CONTRACT'));
      }
      await page.evaluate(()=>window.__setOptions({actor:'manager',roles:['MANAGER','ENGINEER'],status:'PRODUCTION'}));
      await page.waitForFunction(()=>document.querySelectorAll('button[aria-label^="Перетащить "]').length===1);
      const recent=page.getByRole('link',{name:'205',exact:true}),recentRow=page.getByRole('row').filter({has:recent});assert.equal(await recent.getAttribute('href'),'/projects/recent-project');assert.equal(await recentRow.getByText('Клиент',{exact:true}).count(),1);assert.equal(await recentRow.getByText('Название заказа',{exact:true}).count(),1);assert.equal(await recent.locator('[data-card-number]').count(),1);
      assert.deepEqual(await page.evaluate(() => window.__writes), []);
    });
  });
  test(`${board}: менеджер видит связанный черновик КП, но переход до договора закрыт`, async () => {
    await withBoard(board, { roles: ['MANAGER'], status: 'DRAFT', projectStage: 'LEAD', canAccessDraft: true }, async page => {
      assert.equal(await page.getByText('Черновики', {exact:true}).count(), 1);
      assert.equal(await page.getByText('Контрольное изделие', {exact:true}).count(), 1);
      assert.equal(await page.getByRole('button', {name:/^Перетащить /}).count(), 0);
      await page.getByText('Контрольное изделие', {exact:true}).click();
      assert.deepEqual(await page.evaluate(() => window.__nav), ['/products/p?returnTo='+encodeURIComponent(board === 'global' ? '/products?view=kanban' : '/projects/project?tab=products')]);
      await page.evaluate(() => window.__setOptions({roles:['MANAGER','ENGINEER'],status:'DRAFT',projectStage:'CONTRACT',canAccessDraft:true}));
      await page.waitForFunction(() => document.querySelectorAll('button[aria-label^="Перетащить "]').length === 1);
      await page.evaluate(() => window.__setOptions({roles:['MANAGER'],status:'DRAFT',projectStage:'CONTRACT',canAccessDraft:false}));
      await page.waitForFunction(() => !document.body.textContent.includes('Контрольное изделие'));
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
