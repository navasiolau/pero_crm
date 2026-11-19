import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchCardBrowser } from "./product-card-navigation-browser.mjs";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(web, "package.json"));
const entry = `
import React from 'react';import {createRoot}from'react-dom/client';
import {ProjectTabs}from'@/components/project-tabs';
import {TabsContent,TabsList,TabsTrigger}from'@/components/ui/tabs';
import {ProductSinglePage}from'@/app/(app)/products/[id]/product-overview';
import {EntityJournal}from'@/components/journal/entity-journal';
window.__qa={lists:[],options:[]};
const params=new URLSearchParams(location.search),product=params.get('view')==='product';
function App(){return <main style={{padding:16}}>{product?
 <ProductSinglePage overview={<div style={{height:1800}}>Общее об изделии</div>} documents={null} assembly={null} installation={null} works={null} materials="Материалы изделия" journal={<EntityJournal scope={{kind:'product',id:'product-stable'}} whenVisible/>}/>:
 <ProjectTabs initialTab={params.get('tab')??'overview'}><TabsList><TabsTrigger value="overview">Общее</TabsTrigger><TabsTrigger value="demo">Модуль</TabsTrigger><TabsTrigger value="journal">Журнал</TabsTrigger></TabsList><TabsContent value="overview">Общее проекта</TabsContent><TabsContent value="demo">Вкладка модуля</TabsContent><TabsContent value="journal"><EntityJournal scope={{kind:'project',id:'project-stable'}}/></TabsContent></ProjectTabs>
 }</main>}
createRoot(document.getElementById('root')).render(<App/>);
`;
const transport = `
export async function listJournal(input){window.__qa.lists.push(input);return{entries:[],total:0,page:input.page??1,pageSize:input.pageSize??20,sort:input.sort??'time',dir:input.dir??'desc'}}
export async function listJournalFilterOptions(scope){window.__qa.options.push(scope);return{users:[{id:'__system__',label:'Система'}],entities:[{id:'file',label:'Файлы'}]}}
export async function getJournalEntry(){throw Error('UNEXPECTED_DETAIL_REQUEST')}
export async function previewJournalReversal(){throw Error('UNEXPECTED_REVERSAL_PREVIEW')}
export async function reverseJournalAction(){throw Error('UNEXPECTED_REVERSAL')}
`;

test("context journal makes no request before project tab or product viewport and retains scope on reset", { timeout: 90000 }, async () => {
  const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");
  const built = await build({ stdin: { contents: entry, loader: "tsx", resolveDir: web }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    tsconfig: path.join(web, "tsconfig.json"), define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
    plugins: [{ name: "entity-journal-transport", setup(builder) {
      builder.onResolve({ filter: /^@\/server\/changelog\/(actions|reversal-actions)$/ }, () => ({ path: "actions", namespace: "entity-transport" }));
      builder.onLoad({ filter: /.*/, namespace: "entity-transport" }, () => ({ contents: transport, loader: "tsx", resolveDir: web }));
    } }],
  });
  const postcss = createRequire(require.resolve("@tailwindcss/postcss"))("postcss");
  const css = (await postcss([require("@tailwindcss/postcss")({ base: web })]).process(await readFile(path.join(web, "src/app/globals.css"), "utf8"), { from: path.join(web, "src/app/globals.css") })).css;
  let server, browser;
  try {
    server = createServer((request, response) => {
      const url = new URL(request.url, "http://localhost");
      if (request.method !== "GET" || !["/", "/app.css", "/app.js"].includes(url.pathname)) { response.writeHead(404); response.end(); return; }
      response.setHeader("content-type", url.pathname === "/app.css" ? "text/css" : url.pathname === "/app.js" ? "text/javascript" : "text/html; charset=utf-8");
      response.end(url.pathname === "/app.css" ? css : url.pathname === "/app.js" ? built.outputFiles[0].contents : '<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    browser = await launchCardBrowser();
    const { expect: baseExpect } = await import("@playwright/test");
    const expect = baseExpect.configure({ timeout: 10000 });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin);
    await expect(page.getByRole("tabpanel")).toContainText("Общее проекта");
    assert.deepEqual(await page.evaluate(() => window.__qa), { lists: [], options: [] });
    await page.getByRole("tab", { name: "Журнал", exact: true }).click();
    await expect(page.getByText("По фильтру ничего не найдено", { exact: true }).last()).toBeVisible();
    assert.equal(await page.evaluate(() => window.__qa.lists.length), 1);
    assert.deepEqual(await page.evaluate(() => window.__qa.lists[0].scope), { kind: "project", id: "project-stable" });
    await page.getByLabel("Поиск по журналу", { exact: true }).fill("Поиск");
    await page.getByRole("button", { name: "Применить", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__qa.lists.length)).toBe(2);
    await page.getByRole("button", { name: "Сбросить", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__qa.lists.length)).toBe(3);
    assert.deepEqual(await page.evaluate(() => window.__qa.lists.at(-1).scope), { kind: "project", id: "project-stable" });
    assert.equal(new URL(page.url()).searchParams.has("q"), false, "entity filter reset must not overwrite page navigation");

    await page.goto(origin + "/?tab=journal");
    await expect.poll(() => page.evaluate(() => window.__qa.lists.length)).toBe(1);
    assert.deepEqual(await page.evaluate(() => window.__qa.options), [{ kind: "project", id: "project-stable" }]);
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => scrollTo(0, 0));
      await page.goto(origin + "/?view=product");
      await expect(page.getByText("Общее об изделии", { exact: true })).toBeVisible();
      const section = page.locator('[data-product-section="journal"]');
      await expect(section).not.toBeInViewport();
      assert.deepEqual(await page.evaluate(() => window.__qa), { lists: [], options: [] });
      assert.equal(await page.getByRole("tab").count(), 0);
      assert.equal(await page.locator("[data-product-section]").last().getAttribute("data-product-section"), "journal");
      await section.scrollIntoViewIfNeeded();
      await expect.poll(() => page.evaluate(() => window.__qa.lists.length)).toBe(1);
      assert.deepEqual(await page.evaluate(() => window.__qa.lists[0].scope), { kind: "product", id: "product-stable" });
      await page.evaluate(() => scrollTo(0, 0));
      await section.scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(() => window.__qa.lists.length), 1, "repeated intersection must not mount a second Journal");
    }
    assert.deepEqual(errors, []);
    const fallback = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await fallback.addInitScript(() => { Object.defineProperty(window, "IntersectionObserver", { value: undefined }); });
    await fallback.goto(origin + "/?view=product");
    await fallback.locator('[data-product-section="journal"]').scrollIntoViewIfNeeded();
    assert.equal(await fallback.evaluate(() => window.__qa.lists.length), 0);
    await fallback.getByRole("button", { name: "Загрузить журнал", exact: true }).click();
    await expect.poll(() => fallback.evaluate(() => window.__qa.lists.length)).toBe(1);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
});
