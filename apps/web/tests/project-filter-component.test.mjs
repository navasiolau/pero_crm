import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import path from "node:path";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {createHash,randomUUID} from "node:crypto";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");
const { chromium } = require("@playwright/test");
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Монтируется настоящий фильтр-бар, React и Base UI. Подменяется только
// граница состояния списка: она записывает payload и обновляет входной query.
const bundleOptions = {
  stdin: {
    contents: `
      import React, {useState} from 'react';
      import {SearchableSelect} from '@/components/ui/searchable-select';
      import {MultiSelectFilter} from '@/components/ui/multi-select-filter';
      function PickerHarness(){
        const size=Number(new URLSearchParams(window.__initialQuery).get('size')||100);
        window.__reads??={map:0,filter:0,find:0};
        const [options]=useState(()=>{const wrap=rows=>new Proxy(rows,{get(target,key,receiver){if(['map','filter','find'].includes(key))return(...args)=>{window.__reads[key]++;const result=Array.prototype[key].apply(receiver,args);return key==='filter'?wrap(result):result;};return Reflect.get(target,key,receiver);}});return wrap(Array.from({length:size},(_,i)=>({value:'o'+i,label:'alpha_'+String(i).padStart(5,'0'),hint:'Телефон '+i,disabled:i===3})));});
        const [neighbor,setNeighbor]=useState(''),[single,setSingle]=useState(''),[multi,setMulti]=useState(['unknown']);window.__picker={single,multi};window.__setPicker={single:setSingle,multi:setMulti};
        return <div style={{padding:16,width:320}}><input id='picker-neighbor' value={neighbor} onChange={e=>setNeighbor(e.target.value)}/><SearchableSelect id='picker-single' options={options} value={single} onChange={setSingle} allowClear placeholder='Один' searchPlaceholder='Поиск одного'/><MultiSelectFilter label='Несколько' options={options} value={multi} onChange={setMulti} allLabel='Все' searchPlaceholder='Поиск нескольких'/></div>;
      }
      import {createRoot} from 'react-dom/client';
      import {ProjectsFilterBar} from '@/app/(app)/projects/filter-bar';
      import {ProductsFilterBar} from '@/app/(app)/products/products-filter-bar';
      function Harness() {
        const [clients, setClients] = useState(Array.from({length: 12}, (_, i) => ({id: 'c'+(i+1), name: 'Клиент '+(i+1)})));
        window.__replaceClients = setClients;
        if(window.__section==='picker')return <PickerHarness/>;
        if (window.__section === 'products') return <ProductsFilterBar actorRoles={['MANAGER']}
          projectOptions={[{value:'p1',label:'Проект 1'},{value:'p2',label:'Проект 2'},{value:'p3',label:'Проект 3'}]}
          clientOptions={clients.map(item=>({value:item.id,label:item.name}))}
          engineerOptions={[{value:'e1',label:'Инженер 1'},{value:'e2',label:'Инженер 2'},{value:'e3',label:'Инженер 3'}]}/>;
        return <ProjectsFilterBar clients={clients} managers={[{id:'m1',name:'Менеджер 1'},{id:'m2',name:'Менеджер 2'}]} engineers={[{id:'e1',name:'Инженер 1'},{id:'e2',name:'Инженер 2'},{id:'e3',name:'Инженер 3'}]}/>;
      }
      createRoot(document.getElementById('root')).render(<Harness/>);
    `,
    resolveDir: web,
    loader: "tsx",
  },
  bundle: true,
  metafile: true,
  write: false,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  tsconfig: path.join(web, "tsconfig.json"),
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{
    name: "list-state-boundary",
    setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/list-params$/ }, (args) => ({ path: args.path, namespace: "boundary" }));
      builder.onLoad({ filter: /.*/, namespace: "boundary" }, () => ({
        contents: `
          import {useState, useEffect} from 'react';
          let query = window.__initialQuery || '';
          const listeners = new Set();
          window.__payloads = [];
          window.__query = query;
          function publish() { window.__query = query; listeners.forEach(listener => listener(query)); }
          export function useListParams() {
            const [snapshot, update] = useState(query);
            useEffect(() => { listeners.add(update); return () => listeners.delete(update); }, []);
            return {
              get: key => new URLSearchParams(snapshot).get(key) || '',
              set: values => {
                window.__payloads.push(values);
                const params = new URLSearchParams(query);
                Object.entries(values).forEach(([key,value]) => value === null ? params.delete(key) : params.set(key,value));
                query = params.toString(); publish();
              },
              reset: () => { query = ''; publish(); },
              pending: false, canReset: Boolean(snapshot),
            };
          }
          export function useListSearch() {
            const state = useListParams();
            return { q: state.get('q'), setQ: value => state.set({q:value, page:null}) };
          }
        `,
        loader: "js",
        resolveDir: web,
      }));
    },
  }],
  logLevel: "silent",
};
const bundlePromise = build(bundleOptions);
const compareBefore=process.env.CRM_SELECT_BENCHMARK==='1',styleParity=process.env.CRM_SELECT_STYLE_PARITY==='1';
let pickerCss;async function actualPickerCss(){if(!pickerCss){const postcss=createRequire(require.resolve('@tailwindcss/postcss'))('postcss'),tailwind=require('@tailwindcss/postcss');pickerCss=(await postcss([tailwind({base:web})]).process(await readFile(path.join(web,'src/app/globals.css'),'utf8'),{from:path.join(web,'src/app/globals.css')})).css+'\nhtml,body{font-family:Arial,sans-serif}input{caret-color:transparent!important}';}return pickerCss;}
const beforeRevision='465a59d0709edabf4396a966bb53cd76868f7b86';
const beforeBundlePromise=(compareBefore||styleParity)?build({...bundleOptions,plugins:[...bundleOptions.plugins,{name:'local-original-picker-source',setup(builder){builder.onLoad({filter:/\.(?:tsx)$/,namespace:'file'},args=>{const relative=path.relative(web,args.path).split(path.sep).join('/');if(!['src/components/ui/searchable-select.tsx','src/components/ui/multi-select-filter.tsx'].includes(relative))return;return{contents:execFileSync('git',['-c','safe.directory='+path.resolve(web,'../..'),'show',beforeRevision+':apps/web/'+relative],{cwd:web,encoding:'utf8'}),loader:'tsx',resolveDir:path.dirname(args.path)};});}}]}):null;

async function withPage(initialQuery, run, section = "projects", variant='after', viewport={width:1440,height:900}) {
  const bundle = await (variant==='before'?beforeBundlePromise:bundlePromise);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport, reducedMotion:"reduce" });
    page.setDefaultTimeout(5000);
    await page.setContent(`<style>
      .z-50{z-index:50}.isolate{isolation:isolate}
      [data-slot=popover-content]{background:white;width:288px;padding:10px}
      [data-slot=popover-content] label{display:flex;align-items:center;gap:8px;padding:8px}
      [data-slot=checkbox]{display:inline-flex;width:16px;height:16px;flex-shrink:0}
      [data-filter-options]{max-height:224px;overflow-y:auto}
      button,[role=checkbox]{cursor:pointer}
    </style><div style="height:900px"></div><div id="root"></div><div style="height:1200px"></div>`);
    if(section==='picker'&&styleParity)await page.addStyleTag({content:await actualPickerCss()});
    await page.evaluate(({ query, section }) => { window.__initialQuery = query; window.__section = section; }, { query: initialQuery, section });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.locator(section==='picker'?'#picker-neighbor':`#${section}-active-only`).waitFor();
    await run(page);
  } finally {
    await browser.close();
  }
}

const queryValue = (page, key) => page.evaluate((name) => new URLSearchParams(window.__query).get(name), key);

for (const section of ["projects", "products"]) {
test(`${section} filters default to all and Незавершённые writes explicit 1/0 preserving other state`, async () => {
  await withPage("q=кухня&sort=title&dir=asc&view=table&size=50&page=4", async (page) => {
    assert.equal(await page.locator(`#${section}-active-only`).isChecked(), false);
    assert.equal(await page.getByText("Незавершённые", { exact: true }).count(), 1);
    for (const name of ["Статус", "Клиент", section === "projects" ? "Менеджер" : "Проект", "Инженер"]) {
      assert.equal(await page.getByRole("button", { name, exact: true }).count(), 1);
    }
    await page.getByText("Незавершённые", { exact: true }).click();
    assert.equal(await queryValue(page, "active"), "1");
    await page.getByText("Незавершённые", { exact: true }).click();
    assert.equal(await queryValue(page, "active"), "0");
    assert.equal(await queryValue(page, "page"), null);
    for (const [key, value] of Object.entries({ q: "кухня", sort: "title", dir: "asc", view: "table", size: "50" })) {
      assert.equal(await queryValue(page, key), value);
    }
    await page.getByRole("button", { name: "Статус", exact: true }).click();
    const popup = page.locator('[data-slot="popover-content"]');
    assert.deepEqual(await popup.getByRole("button").allTextContents(), ["Сброс"]);
    assert.equal(await popup.getByRole("checkbox", { checked: true }).count(), 0);
    await page.keyboard.press("Escape");
    const searchPlaceholder = section === "projects" ? "Номер, название, клиент…" : "Номер, название, проект, клиент…";
    await page.getByPlaceholder(searchPlaceholder, { exact: true }).fill("новый поиск");
    assert.equal(await queryValue(page, "q"), "новый поиск");
    assert.equal(await queryValue(page, "sort"), "title");
    await page.getByRole("button", { name: "Сброс", exact: true }).click();
    assert.equal(await page.evaluate(() => window.__query), "");
    assert.equal(await page.locator(`#${section}-active-only`).isChecked(), false);
  }, section);
});
}

test("both actual wrappers import one shared filter renderer", async () => {
  const { metafile } = await bundlePromise;
  for (const wrapper of ["projects/filter-bar.tsx", "products/products-filter-bar.tsx"]) {
    const entry = Object.entries(metafile.inputs).find(([name]) => name.replaceAll("\\", "/").endsWith(wrapper));
    assert.ok(entry, `${wrapper} bundled`);
    assert.ok(entry[1].imports.some(({ path: name }) => name.replaceAll("\\", "/").endsWith("components/entity-list-filter-bar.tsx")), `${wrapper} directly uses shared renderer`);
  }
});

test("partial stages, last unchecked, full selection and dimension reset retain popup and viewport", async () => {
  await withPage("", async (page) => {
    const trigger = page.getByRole("button", { name: "Статус", exact: true });
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
    const popup = page.locator('[data-slot="popover-content"]');
    assert.equal(await popup.getByRole("checkbox").count(), 8);
    assert.equal(await popup.getByRole("checkbox", { checked: true }).count(), 0);
    const scroll = await page.evaluate(() => window.scrollY);
    for (const name of ["Просчёт", "Договор", "В работе", "Завершён", "Рекламация", "Пауза", "Отказ"]) {
      await popup.getByRole("checkbox", { name, exact: true }).click();
    }
    assert.equal(await popup.isVisible(), true);
    assert.equal(await page.evaluate(() => window.scrollY), scroll);
    assert.deepEqual(JSON.parse(await queryValue(page, "stage")).sort(), ["ESTIMATE", "CONTRACT", "IN_WORK", "DONE", "RECLAMATION", "PAUSED", "REFUSED"].sort());
    await popup.getByRole("button", { name: "Сброс", exact: true }).click();
    assert.equal(await queryValue(page, "stage"), null);
    assert.equal(await popup.getByRole("checkbox", { checked: true }).count(), 0);
    await popup.getByRole("checkbox", { name: "Лид", exact: true }).click();
    assert.deepEqual(JSON.parse(await queryValue(page, "stage")), ["LEAD"]);
    await popup.getByRole("checkbox", { name: "Лид", exact: true }).click();
    assert.equal(await queryValue(page, "stage"), null);
    for (const name of ["Лид", "Просчёт", "Договор", "В работе", "Завершён", "Рекламация", "Пауза", "Отказ"]) {
      await popup.getByRole("checkbox", { name, exact: true }).click();
    }
    assert.equal(await queryValue(page, "stage"), null);
    assert.equal(await popup.getByRole("checkbox", { checked: true }).count(), 0);
    assert.equal(await popup.isVisible(), true);
  });
});

test("two engineers and five searched clients save immediately, preserving absent selected IDs", async () => {
  const initial = new URLSearchParams({ manager: "m2", stage: "IN_WORK", client: JSON.stringify(["missing-client", "c1"]) }).toString();
  await withPage(initial, async (page) => {
    await page.getByRole("button", { name: "Менеджер", exact: true }).click();
    let popup = page.locator('[data-slot="popover-content"]');
    assert.equal(await popup.getByRole("checkbox", { name: "Менеджер 2", exact: true }).getAttribute("aria-checked"), "true");
    assert.equal(await popup.getByRole("checkbox", { name: "Менеджер 1", exact: true }).getAttribute("aria-checked"), "false");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Клиент", exact: true }).click();
    popup = page.locator('[data-slot="popover-content"]');
    const sixth = popup.getByRole("checkbox", { name: "Клиент 6", exact: true });
    await sixth.scrollIntoViewIfNeeded();
    const optionsScroll = await popup.locator("[data-filter-options]").evaluate((node) => node.scrollTop);
    assert.ok(optionsScroll > 0);
    await sixth.click();
    assert.equal(await popup.locator("[data-filter-options]").evaluate((node) => node.scrollTop), optionsScroll);
    await page.evaluate(() => window.__replaceClients([{ id: "c2", name: "Клиент 2" }]));
    await page.waitForFunction(() => document.querySelectorAll('[data-slot="popover-content"] [role="checkbox"]').length === 1);
    assert.deepEqual(JSON.parse(await queryValue(page, "client")).sort(), ["missing-client", "c1", "c6"].sort());
    await popup.getByRole("checkbox", { name: "Клиент 2", exact: true }).click();
    assert.deepEqual(JSON.parse(await queryValue(page, "client")).sort(), ["missing-client", "c1", "c2", "c6"].sort());
    await page.evaluate(() => window.__replaceClients(Array.from({ length: 12 }, (_, i) => ({ id: "c" + (i + 1), name: "Клиент " + (i + 1) }))));
    await popup.getByRole("button", { name: "Сброс", exact: true }).click();
    for (let i = 1; i <= 5; i++) {
      await popup.getByPlaceholder("Поиск клиента…").fill("Клиент " + i);
      await popup.getByRole("checkbox", { name: "Клиент " + i, exact: true }).click();
      assert.equal(await popup.isVisible(), true);
    }
    assert.deepEqual(JSON.parse(await queryValue(page, "client")).sort(), ["c1", "c2", "c3", "c4", "c5"]);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Инженер", exact: true }).click();
    popup = page.locator('[data-slot="popover-content"]');
    await popup.getByRole("button", { name: "Сброс", exact: true }).click();
    await popup.getByRole("checkbox", { name: "Инженер 1", exact: true }).click();
    await popup.getByRole("checkbox", { name: "Инженер 2", exact: true }).click();
    assert.deepEqual(JSON.parse(await queryValue(page, "engineer")), ["e1", "e2"]);
    assert.equal(await popup.isVisible(), true);
    assert.equal(await queryValue(page, "manager"), "m2");
    assert.equal(await queryValue(page, "stage"), "IN_WORK");
    await popup.getByRole("checkbox", { name: "Инженер 1", exact: true }).click();
    await popup.getByRole("checkbox", { name: "Инженер 2", exact: true }).click();
    assert.equal(await queryValue(page, "engineer"), null);
    assert.equal(await queryValue(page, "stage"), "IN_WORK");
    assert.deepEqual(JSON.parse(await queryValue(page, "client")).sort(), ["c1", "c2", "c3", "c4", "c5"]);
    await popup.getByRole("checkbox", { name: "Инженер 1", exact: true }).click();
    await popup.getByRole("button", { name: "Сброс", exact: true }).click();
    assert.equal(await queryValue(page, "engineer"), null);
    assert.equal(await queryValue(page, "stage"), "IN_WORK");
  });
});

test("products multi status/project/engineer and dimension reset preserve other axes", async () => {
  const initial = new URLSearchParams({ status: "DESIGN", client: "c1", project: JSON.stringify(["missing-project", "p1"]) }).toString();
  await withPage(initial, async (page) => {
    assert.equal(await page.getByRole("button", { name: "Менеджер", exact: true }).count(), 0);
    await page.getByRole("button", { name: "Проект", exact: true }).click();
    let popup = page.locator('[data-slot="popover-content"]');
    await popup.getByRole("checkbox", { name: "Проект 2", exact: true }).click();
    assert.deepEqual(JSON.parse(await queryValue(page, "project")).sort(), ["missing-project", "p1", "p2"].sort());
    await popup.getByRole("button", { name: "Сброс", exact: true }).click();
    for (const name of ["Проект 1", "Проект 2"]) await popup.getByRole("checkbox", { name, exact: true }).click();
    assert.deepEqual(JSON.parse(await queryValue(page, "project")), ["p1", "p2"]);
    assert.equal(await popup.isVisible(), true);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Статус", exact: true }).click();
    popup = page.locator('[data-slot="popover-content"]');
    assert.equal(await popup.getByRole("checkbox").count(), 7);
    assert.equal(await popup.getByRole("checkbox", { name: "Черновик", exact: true }).count(), 0);
    assert.equal(await popup.getByRole("checkbox", { name: "Проектирование", exact: true }).getAttribute("aria-checked"), "true");
    const scroll = await page.evaluate(() => window.scrollY);
    await popup.getByRole("checkbox", { name: "В производстве", exact: true }).click();
    assert.deepEqual(JSON.parse(await queryValue(page, "status")), ["DESIGN", "PRODUCTION"]);
    assert.equal(await page.evaluate(() => window.scrollY), scroll);
    await popup.getByRole("button", { name: "Сброс", exact: true }).click();
    for (const name of ["Подготовка", "Проектирование", "В производстве", "На складе ГП", "Установка", "Готово", "Рекламация"]) await popup.getByRole("checkbox", { name, exact: true }).click();
    assert.equal(await queryValue(page, "status"), null);
    assert.equal(await popup.getByRole("checkbox", { checked: true }).count(), 0);
    await popup.getByRole("checkbox", { name: "Проектирование", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Инженер", exact: true }).click();
    popup = page.locator('[data-slot="popover-content"]');
    for (const name of ["Инженер 1", "Инженер 2"]) await popup.getByRole("checkbox", { name, exact: true }).click();
    assert.deepEqual(JSON.parse(await queryValue(page, "engineer")), ["e1", "e2"]);
    await popup.getByRole("button", { name: "Сброс", exact: true }).click();
    assert.equal(await queryValue(page, "engineer"), null);
    assert.deepEqual(JSON.parse(await queryValue(page, "status")), ["DESIGN"]);
    assert.deepEqual(JSON.parse(await queryValue(page, "project")), ["p1", "p2"]);
    assert.equal(await queryValue(page, "client"), "c1");
    await popup.getByRole("checkbox", { name: "Инженер 1", exact: true }).click();
    await popup.getByRole("checkbox", { name: "Инженер 1", exact: true }).click();
    assert.equal(await queryValue(page, "engineer"), null);
    assert.equal(await popup.isVisible(), true);
  }, "products");
});


test('actual pickers preserve hint/disabled/clear and closed neighbor does no option walks',async()=>{
 await withPage('size=100',async page=>{
  await page.evaluate(()=>{window.__reads={map:0,filter:0,find:0};});await page.locator('#picker-neighbor').pressSequentially('neighbor',{delay:5});assert.deepEqual(await page.evaluate(()=>window.__reads),{map:0,filter:0,find:0});
  await page.locator('#picker-single').click();const popup=page.locator('[data-slot=popover-content]'),search=popup.getByPlaceholder('Поиск одного');await search.fill('телефон 3');assert.ok(await popup.getByRole('button',{name:/alpha_00003/}).isDisabled());await search.fill('Телефон 2');await popup.getByRole('button',{name:/^alpha_00002/}).click();assert.equal(await page.evaluate(()=>window.__picker.single),'o2');
  await page.locator('#picker-single').click();await search.fill('missing');assert.ok(await page.locator('#picker-single').innerText().then(text=>text.includes('alpha_00002')));await popup.getByRole('button',{name:'— сбросить',exact:true}).click();assert.equal(await page.evaluate(()=>window.__picker.single),'');
 },'picker');
});

test('large multi keeps logical Tab/focus/selection while rendering only its viewport',async()=>{
 await withPage('size=5000',async page=>{
  await page.getByRole('button',{name:'Несколько',exact:true}).click();const popup=page.locator('[data-slot=popover-content]'),group=popup.locator('[data-filter-options]');await group.getByRole('checkbox',{name:'alpha_00000',exact:true}).waitFor();assert.ok(await group.getByRole('checkbox').count()<60);
  await group.getByRole('checkbox',{name:'alpha_00000',exact:true}).focus();await group.evaluate(node=>node.scrollTop=node.scrollHeight);await page.waitForTimeout(100);assert.equal(await group.locator('[data-window-index]').first().getAttribute('data-window-index'),'0');assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'alpha_00000');await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Сброс');await group.evaluate(node=>node.scrollTop=0);await page.waitForTimeout(100);
  await group.getByRole('checkbox',{name:'alpha_00000',exact:true}).focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'alpha_00001');await page.keyboard.press('Space');assert.ok((await page.evaluate(()=>window.__picker.multi)).includes('unknown'));assert.ok((await page.evaluate(()=>window.__picker.multi)).includes('o1'));
  const edgeName=await group.getByRole('checkbox').last().getAttribute('aria-label');await group.getByRole('checkbox',{name:edgeName,exact:true}).focus();await page.keyboard.press('Tab');const next=Number(edgeName.slice(-5))+1,nextName='alpha_'+String(next).padStart(5,'0');assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),nextName);
  await group.evaluate(n=>n.scrollTop=n.scrollHeight);await page.waitForTimeout(100);assert.equal(await group.getByRole('checkbox',{name:nextName,exact:true}).count(),1);assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),nextName);await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),edgeName);
  await popup.getByPlaceholder('Поиск нескольких').fill('alpha_04999');await group.getByRole('checkbox',{name:'alpha_04999',exact:true}).check();assert.ok((await page.evaluate(()=>window.__picker.multi)).includes('o4999'));assert.ok((await page.evaluate(()=>window.__picker.multi)).includes('unknown'));
 },'picker');
});

test('manual available-PC picker budget before/after10010005000',{skip:!compareBefore,timeout:300000},async()=>{
 const sourceFiles=['src/components/ui/searchable-select.tsx','src/components/ui/multi-select-filter.tsx','src/hooks/use-options-filter.ts'];const sourceHashes=await Promise.all(sourceFiles.map(async file=>({file,sha256:createHash('sha256').update(await readFile(path.join(web,file))).digest('hex')})));
 const records=[],expected='alpha_00000zzzzzzzzz';assert.equal(expected.length,20);
 const onlyLargeMulti=process.env.CRM_SELECT_LARGE_MULTI_ONLY==='1';
 for(const variant of onlyLargeMulti?['after']:['before','after'])for(const size of onlyLargeMulti?[5000]:[100,1000,5000])for(const kind of onlyLargeMulti?['multi']:['single','multi']){
  await withPage('size='+size,async page=>{
   const trigger=kind==='single'?page.locator('#picker-single'):page.getByRole('button',{name:'Несколько',exact:true});await trigger.click();const input=page.getByPlaceholder(kind==='single'?'Поиск одного':'Поиск нескольких');
   await page.evaluate(()=>{window.__long=[];new PerformanceObserver(list=>window.__long.push(...list.getEntries().map(e=>({startTime:e.startTime,duration:e.duration})))).observe({entryTypes:['longtask']});window.__series=null;document.addEventListener('keydown',event=>{const series=window.__series;if(!series||event.target!==series.target||event.key.length!==1)return;const sample={key:event.key,trusted:event.isTrusted,start:performance.now()};series.samples.push(sample);requestAnimationFrame(()=>requestAnimationFrame(()=>sample.ready=performance.now()));},true);});
   const runs=[];for(let rep=0;rep<5;rep++){
    await input.fill('');await page.waitForTimeout(150);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await input.evaluate(target=>{window.__series={target,start:performance.now(),samples:[]};});await input.pressSequentially(expected,{delay:80});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const result=await page.evaluate(()=>{const series=window.__series,end=performance.now();window.__series=null;return{samples:series.samples,longtasks:window.__long.filter(e=>e.startTime>=series.start&&e.startTime<end)};});assert.equal(result.samples.length,20);assert.equal(result.samples.map(x=>x.key).join(''),expected);assert.ok(result.samples.every(x=>x.trusted&&Number.isFinite(x.ready)&&x.ready>=x.start));assert.equal(await input.inputValue(),expected);runs.push(result);
   }
   const latency=runs.flatMap(r=>r.samples.map(s=>s.ready-s.start)).sort((a,b)=>a-b),longtasks=runs.flatMap(r=>r.longtasks);records.push({variant,size,kind,samples:latency.length,p95KeydownToTwoRaf:latency[Math.ceil(latency.length*.95)-1],max:latency.at(-1),longtasks});
  },'picker',variant);
 }
 const dir=path.join(web,'test-results/select-work-reduction',randomUUID());await mkdir(dir,{recursive:true});for(const pin of sourceHashes)assert.equal(createHash('sha256').update(await readFile(path.join(web,pin.file))).digest('hex'),pin.sha256,'SOURCE_CHANGED_DURING_PICKER_MEASURE');const receipt={status:'MEASURED',sourceHashes,definition:'trusted native keydown to second real RAF (conservative UI-ready, not EventTiming/INP)',beforeRevision,scope:onlyLargeMulti?'AFTER_LARGE_MULTI_ONLY':'FULL_BEFORE_AFTER',records};await writeFile(path.join(dir,'metrics.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify({status:'PICKER_BUDGET_MEASURED',dir,records:records.map(({longtasks,...r})=>({...r,longtasks:longtasks.length,maxLongTask:Math.max(0,...longtasks.map(x=>x.duration))}))}));
 for(const row of records.filter(r=>r.variant==='after')){assert.ok(row.p95KeydownToTwoRaf<=100,'PICKER_P95_BUDGET:'+JSON.stringify(row));assert.equal(row.longtasks.length,0,'PICKER_LONGTASK_BUDGET:'+JSON.stringify(row));}
});


test('manual actual CSS large picker viewport parity',{skip:!styleParity,timeout:120000},async()=>{
 const pwRequire=createRequire(require.resolve('@playwright/test/package.json')),coreRequire=createRequire(pwRequire.resolve('playwright/package.json')),{PNG}=coreRequire(path.join(path.dirname(coreRequire.resolve('playwright-core/package.json')),'lib/utilsBundle.js'));const dir=path.join(web,'test-results/select-work-reduction',randomUUID());await mkdir(dir,{recursive:true});const pairs=[];
 for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:360,height:800}]){const captures={};for(const variant of ['before','after'])await withPage('size=5000',async page=>{
  await page.getByRole('button',{name:'Несколько',exact:true}).click();const popup=page.locator('[data-slot=popover-content]');await popup.getByRole('checkbox',{name:'alpha_00000',exact:true}).waitFor();await page.waitForTimeout(250);await page.evaluate(()=>document.fonts.ready);const bytes=await page.screenshot({animations:'disabled',path:path.join(dir,variant+'-'+viewport.width+'.png')}),png=PNG.sync.read(bytes);const shape=await popup.evaluate(n=>{const rect=n.getBoundingClientRect();return{rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},controls:[...n.querySelectorAll('input,button,[role=checkbox],label')].filter(x=>{const r=x.getBoundingClientRect();return r.top>=rect.top&&r.bottom<=rect.bottom;}).map(x=>{const r=x.getBoundingClientRect(),css=getComputedStyle(x);return{tag:x.tagName,text:x.innerText??'',label:x.getAttribute('aria-label'),className:x.className,rect:{x:r.x,y:r.y,width:r.width,height:r.height},font:css.font,color:css.color,background:css.backgroundColor};})};});const region=await popup.evaluate(n=>{const r=n.getBoundingClientRect(),css=getComputedStyle(n);return{x:Math.ceil(r.x+parseFloat(css.paddingLeft)),y:Math.ceil(r.y+parseFloat(css.paddingTop)),right:Math.floor(r.right-parseFloat(css.paddingRight)),bottom:Math.floor(r.bottom-parseFloat(css.paddingBottom))};});const rows=[];for(let y=region.y;y<region.bottom;y++)rows.push(png.data.subarray((y*png.width+region.x)*4,(y*png.width+region.right)*4));const trigger=await page.getByRole('button',{name:'Несколько',exact:true}).evaluate(n=>{const r=n.getBoundingClientRect(),css=getComputedStyle(n);return{text:n.innerText,className:n.className,rect:{x:r.x,y:r.y,width:r.width,height:r.height},font:css.font,color:css.color,background:css.backgroundColor};});captures[variant]={png:createHash('sha256').update(bytes).digest('hex'),rgba:createHash('sha256').update(png.data).digest('hex'),contentPixels:createHash('sha256').update(Buffer.concat(rows)).digest('hex'),region,shape,trigger};
 },'picker',variant,viewport);assert.deepEqual(captures.after.shape,captures.before.shape);assert.deepEqual(captures.after.trigger,captures.before.trigger);assert.deepEqual(captures.after.region,captures.before.region);assert.equal(captures.after.contentPixels,captures.before.contentPixels);captures.wholePixelsEqual=captures.after.rgba===captures.before.rgba;pairs.push({viewport,before:captures.before,after:captures.after,wholePixelsEqual:captures.wholePixelsEqual});}
 await writeFile(path.join(dir,'appearance.json'),JSON.stringify({status:'PASS',cleanup:'AWAITED',pairs},null,2));console.log(JSON.stringify({status:'LARGE_PICKER_STYLE_PARITY_PASS',dir,pairs:pairs.length}));
});
