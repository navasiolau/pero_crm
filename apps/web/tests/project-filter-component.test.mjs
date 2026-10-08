import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");
const { chromium } = require("@playwright/test");
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Монтируется настоящий фильтр-бар, React и Base UI. Подменяется только
// граница состояния списка: она записывает payload и обновляет входной query.
const bundlePromise = build({
  stdin: {
    contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {ProjectsFilterBar} from '@/app/(app)/projects/filter-bar';
      import {ProductsFilterBar} from '@/app/(app)/products/products-filter-bar';
      function Harness() {
        const [clients, setClients] = useState(Array.from({length: 12}, (_, i) => ({id: 'c'+(i+1), name: 'Клиент '+(i+1)})));
        window.__replaceClients = setClients;
        if (window.__section === 'products') return <ProductsFilterBar
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
});

async function withPage(initialQuery, run, section = "projects") {
  const bundle = await bundlePromise;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(5000);
    await page.setContent(`<style>
      .z-50{z-index:50}.isolate{isolation:isolate}
      [data-slot=popover-content]{background:white;width:288px;padding:10px}
      [data-slot=popover-content] label{display:flex;align-items:center;gap:8px;padding:8px}
      [data-slot=checkbox]{display:inline-flex;width:16px;height:16px;flex-shrink:0}
      [data-filter-options]{max-height:224px;overflow-y:auto}
      button,[role=checkbox]{cursor:pointer}
    </style><div style="height:900px"></div><div id="root"></div><div style="height:1200px"></div>`);
    await page.evaluate(({ query, section }) => { window.__initialQuery = query; window.__section = section; }, { query: initialQuery, section });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.locator(`#${section}-active-only`).waitFor();
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
    assert.equal(await popup.getByRole("checkbox").count(), 8);
    assert.equal(await popup.getByRole("checkbox", { name: "Проектирование", exact: true }).getAttribute("aria-checked"), "true");
    const scroll = await page.evaluate(() => window.scrollY);
    await popup.getByRole("checkbox", { name: "В производстве", exact: true }).click();
    assert.deepEqual(JSON.parse(await queryValue(page, "status")), ["DESIGN", "PRODUCTION"]);
    assert.equal(await page.evaluate(() => window.scrollY), scroll);
    await popup.getByRole("button", { name: "Сброс", exact: true }).click();
    for (const name of ["Черновик", "Подготовка", "Проектирование", "В производстве", "На складе ГП", "Установка", "Готово", "Рекламация"]) await popup.getByRole("checkbox", { name, exact: true }).click();
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
