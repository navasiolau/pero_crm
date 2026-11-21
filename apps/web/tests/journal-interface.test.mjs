import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchCardBrowser } from "./product-card-navigation-browser.mjs";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(web, "package.json"));

// Настоящие компоненты журнала, DataTable, SearchableSelect и Base UI Dialog.
// Заменён только transport; БД, авторизация и существующие данные не используются.
const entry = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {Journal} from '@/components/journal/journal';
window.__qa = {lists:[],details:[],options:[],heldLists:[],heldDetails:[],holdDetail:false,failDetail:false,previews:[],reversals:[]};
const embedded = new URLSearchParams(location.search).get('scope') === 'project';
const scope = embedded ? {kind:'project',id:'project-stable'} : {kind:'global'};
createRoot(document.getElementById('root')).render(<main style={{padding:16}}><Journal scope={scope}/></main>);
`;
const transport = `
const rows = [
 {id:'event-one',createdAt:'2026-11-16T09:30:00.000Z',actorName:'Иван Петров',entityLabel:'Изделие 203.1',actionLabel:'Изменение',changeCount:4,hasChanges:true},
 {id:'event-two',createdAt:'2026-11-16T09:29:00.000Z',actorName:'Система',entityLabel:'Проект 203',actionLabel:'Изменение',changeCount:1,hasChanges:true},
];
const clone=x=>JSON.parse(JSON.stringify(x));
const data = id => ({id,reversalAvailable:id==='event-one',createdAt:'2026-11-16T09:30:00.000Z',presentation:{version:1,kind:'event',
 actor:{type:id==='event-one'?'user':'system',id:'user-one',name:id==='event-one'?'Иван Петров':'Система'},
 initiator:{id:'user-one',name:'Иван Петров'},reason:'Обновление из КП',entity:{type:'product',id:'product-stable',label:id==='event-one'?'Изделие 203.1':'Проект 203',href:'/products/product-stable'},
 contexts:[{kind:'product',id:'product-stable',label:'Изделие 203.1',href:'/products/product-stable'}],
 action:{code:'update',label:'Изменение'},source:{code:'web',label:'CRM'},
 changes:[
 {path:'description',label:'Описание',before:'Старое описание\\n'+('Строка прежнего текста '.repeat(500))+'КОНЕЦ ПРЕЖНЕГО',after:'Новое описание\\n'+('Строка нового текста '.repeat(500))+'КОНЕЦ НОВОГО',beforeKnown:true,afterKnown:true},
 {path:'status',label:'Статус',before:null,after:'Проектирование',beforeKnown:false,afterKnown:true},
 {path:'empty',label:'Комментарий',before:'',after:'<script>window.bad=true</script>',beforeKnown:true,afterKnown:true},
 {path:'items',label:'Позиции',before:[{name:'Старый фасад',quantity:1}],after:[{name:'Новый фасад',quantity:2},{name:'Полка',quantity:0}],beforeKnown:true,afterKnown:true},
 ],links:[{type:'project',id:'project-stable',label:'Проект 203',href:'/projects/project-stable'}],technical:{eventId:id,field:'description',nested:{operationId:'request-123'}}}});
export async function listJournal(input){window.__qa.lists.push(clone(input));const result={entries:input.q==='новый ответ'?[rows[1]]:rows,total:45,page:input.page??1,pageSize:input.pageSize??20,sort:input.sort??'time',dir:input.dir??'desc'};if(input.q==='медленный ответ')return new Promise(resolve=>window.__qa.heldLists.push(()=>resolve({...result,entries:[rows[0]],total:1})));return clone(result);}
export async function getJournalEntry(id,scope){window.__qa.details.push({id,scope:clone(scope)});if(window.__qa.failDetail){window.__qa.failDetail=false;throw Error('PRIVATE_BACKEND_ERROR');}if(window.__qa.holdDetail){window.__qa.holdDetail=false;return new Promise(resolve=>window.__qa.heldDetails.push(()=>resolve(data(id))));}return data(id);}
export async function previewJournalReversal(input){window.__qa.previews.push(clone(input));return{ok:true,entryId:input.entryId,entityLabel:'Изделие 203.1',actionLabel:'Изменение'};}
export async function reverseJournalAction(input){window.__qa.reversals.push(clone(input));return window.__qa.reversals.length===1?{ok:false,message:'Не удалось подтвердить откат'}:{ok:true,reversalId:'undo-1'};}
export async function listJournalFilterOptions(scope){window.__qa.options.push(clone(scope));return{users:[{id:'user-one',label:'Иван Петров'},{id:'old-user',label:'Архивный сотрудник'},{id:'__system__',label:'Система'}],entities:[{id:'project',label:'Проекты'},{id:'product',label:'Изделия'}]};}
`;

async function bundle() {
  const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");
  const built = await build({
    stdin: { contents: entry, loader: "tsx", resolveDir: web }, bundle: true, write: false,
    platform: "browser", format: "iife", jsx: "automatic", tsconfig: path.join(web, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
    plugins: [{ name: "journal-memory-transport", setup(builder) {
      builder.onResolve({ filter: /^@\/server\/changelog\/(actions|reversal-actions)$/ }, () => ({ path: "actions", namespace: "journal-memory" }));
      builder.onLoad({ filter: /.*/, namespace: "journal-memory" }, () => ({ contents: transport, loader: "tsx", resolveDir: web }));
    } }],
  });
  const postcss = createRequire(require.resolve("@tailwindcss/postcss"))("postcss");
  const css = (await postcss([require("@tailwindcss/postcss")({ base: web })]).process(
    await readFile(path.join(web, "src/app/globals.css"), "utf8"), { from: path.join(web, "src/app/globals.css") },
  )).css + "\nhtml,body{font-family:Arial,sans-serif}";
  return { js: built.outputFiles[0].contents, css };
}

async function selectorGeometry(trigger, mobile) {
  return trigger.evaluate(async (node, mobile) => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const journal = node.closest("[data-journal]");
    const form = node.closest("form");
    await Promise.allSettled(form.getAnimations({ subtree: true }).map(animation => animation.finished));
    const rect = element => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    const firstEntry = journal.querySelector(mobile ? '[data-slot="mobile-list-card"]' : "tbody tr");
    return {
      form: rect(form),
      trigger: rect(node),
      firstEntry: rect(firstEntry),
      scroll: { x: scrollX, y: scrollY },
    };
  }, mobile);
}

async function checkSelectorLayout(page, expect) {
  const cases = [
    { label: "Пользователь", search: "Поиск пользователя…", query: "Архивный", option: "Архивный сотрудник", other: "Иван Петров" },
    { label: "Сущность", search: "Поиск сущности…", query: "Издел", option: "Изделия", other: "Проекты" },
  ];
  // Playwright может прокрутить страницу к цели locator.click() во время анимации списка.
  async function clickInViewport(locator) {
    await expect(locator).toBeInViewport({ ratio: 1 });
    const { x, y, width, height } = await locator.boundingBox();
    await page.mouse.click(x + width / 2, y + height / 2);
  }
  const origin = new URL(page.url()).origin;
  for (const [scope, width] of [["global", 1440], ["project", 390]]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${origin}/?scope=${scope}`);
    const mobile = width < 640;
    await expect(page.locator(mobile ? '[data-slot="mobile-list-card"]' : "tbody tr").first()).toBeVisible();
    await page.locator("main").evaluate(node => {
      node.style.marginTop = "240px";
      node.style.minHeight = "150vh";
    });
    const outside = page.getByLabel("Поиск по журналу", { exact: true });
    for (const { label, search, query, option, other } of cases) {
      const trigger = page.getByLabel(label, { exact: true });
      const input = page.getByPlaceholder(search, { exact: true });
      const item = page.getByRole("button", { name: option, exact: true });
      const otherItem = page.getByRole("button", { name: other, exact: true });
      await expect(trigger).toBeEnabled();
      await page.evaluate(() => window.scrollTo(0, 160));
      await expect(trigger).toBeInViewport({ ratio: 1 });
      const closed = await selectorGeometry(trigger, mobile);
      assert.ok(closed.scroll.y > 0, "journal fixture must start scrolled");
      async function checkGeometry(phase) {
        assert.deepEqual(await selectorGeometry(trigger, mobile), closed, `${scope}/${width} ${label} ${phase}`);
      }

      await trigger.click();
      await expect(input).toBeFocused();
      await expect(input).toBeInViewport({ ratio: 1 });
      await expect(item).toBeInViewport({ ratio: 1 });
      await checkGeometry("открытие");

      await input.fill(query);
      await expect(item).toBeInViewport({ ratio: 1 });
      await expect(otherItem).toHaveCount(0);
      await checkGeometry("поиск");
      await page.keyboard.press("Escape");
      await expect(input).toBeHidden();
      await expect(trigger).toBeFocused();
      await checkGeometry("Escape");

      await trigger.click();
      await expect(input).toHaveValue("");
      await clickInViewport(outside);
      await expect(input).toBeHidden();
      await checkGeometry("клик снаружи");

      await trigger.click();
      await clickInViewport(item);
      await expect(input).toBeHidden();
      await expect(trigger).toHaveText(option);
      await checkGeometry("выбор");
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/`);
}

test("journal opens one complete event, preserves focus, filters on server and rejects late responses", { timeout: 120000 }, async () => {
  const { js, css } = await bundle();
  let server, browser;
  const screenshots = path.join(web, "test-results/journal-interface", randomUUID());
  await mkdir(screenshots, { recursive: true });
  try {
    server = createServer((request, response) => {
      const url = new URL(request.url, "http://localhost");
      if (request.method !== "GET" || !["/", "/app.js", "/app.css"].includes(url.pathname)) { response.writeHead(404); response.end(); return; }
      response.setHeader("content-type", url.pathname === "/app.js" ? "text/javascript" : url.pathname === "/app.css" ? "text/css" : "text/html; charset=utf-8");
      response.end(url.pathname === "/app.js" ? js : url.pathname === "/app.css" ? css : '<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    browser = await launchCardBrowser();
    const { expect: baseExpect } = await import("@playwright/test");
    const expect = baseExpect.configure({ timeout: 10000 });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const row = page.getByRole("row", { name: /Открыть событие.*Изделие 203.1/ });
    try { await expect(row).toBeVisible(); } catch (error) {
      console.log({ errors, initialFixture: await page.evaluate(() => ({ body: document.body.innerText.slice(0, 2000), lists: window.__qa?.lists })) });
      throw error;
    }
    await checkSelectorLayout(page, expect);
    await expect(row).toBeVisible();
    for (const { width, sidebar } of [
      { width: 1440, sidebar: 256 }, { width: 1440, sidebar: 48 },
      { width: 1280, sidebar: 256 }, { width: 1280, sidebar: 48 },
    ]) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator("main").evaluate((node, sidebar) => {
        node.style.marginLeft = `${sidebar}px`; node.style.width = `calc(100% - ${sidebar}px)`; node.style.padding = "24px";
      }, sidebar);
      const controls = await Promise.all([
        page.getByLabel("Поиск по журналу", { exact: true }), page.getByLabel("Пользователь", { exact: true }),
        page.getByLabel("Сущность", { exact: true }), page.getByLabel("С", { exact: true }), page.getByLabel("По", { exact: true }),
        page.getByRole("button", { name: "Применить", exact: true }), page.getByRole("button", { name: "Сбросить", exact: true }),
      ].map(control => control.boundingBox()));
      assert.ok(controls.every(Boolean), "all journal filter controls must be visible");
      assert.ok(controls.every(rect => Math.abs(rect.y + rect.height - controls[0].y - controls[0].height) <= 1),
        `all journal filters and actions must share one row at ${width}px with ${sidebar}px sidebar: ${JSON.stringify(controls)}`);
      assert.ok(controls[0].width <= Math.max(controls[1].width, controls[2].width) + 1,
        "search must have a comparable width to the adjacent selectors");
      assert.ok(controls[3].width >= 140 && controls[4].width >= 140, "desktop date controls must stay readable");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "filter bar must not overflow the viewport");
      await page.screenshot({ path: path.join(screenshots, `filters-${width}-${sidebar}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator("main").evaluate(node => { node.style.marginLeft = "0"; node.style.width = "100%"; node.style.padding = "16px"; });
    assert.deepEqual(await page.locator("thead th").allTextContents(), ["Время", "Пользователь", "Сущность", "Действие", "Было → стало"]);
    assert.equal(await page.evaluate(() => window.__qa.details.length), 0);
    await expect(page.getByText("Источник", { exact: true })).toHaveCount(0);
    await expect(page.getByText("КОНЕЦ НОВОГО", { exact: false })).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.__qa.lists.at(-1).pageSize), 20);

    await row.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toHaveCount(1);
    await expect(dialog.getByText("Источник", { exact: true })).toBeVisible();
    await expect(dialog.getByText("КОНЕЦ НОВОГО", { exact: false })).toHaveCount(1);
    await expect(dialog.getByText("Прежнее значение не сохранено", { exact: true })).toHaveCount(1);
    await expect(dialog.locator("[data-journal-after]").filter({ hasText: "Новый фасад" }).getByText("Количество", { exact: true })).toHaveCount(2);
    await expect(dialog.getByText("Полка", { exact: true })).toHaveCount(1);
    assert.equal(await page.evaluate(() => window.bad), undefined);
    assert.equal(await page.evaluate(() => window.__qa.details.length), 1);
    await expect.poll(async () => {
      const rect = await dialog.boundingBox(); return rect.width >= 1360 && rect.height >= 800;
    }).toBe(true);
    await page.screenshot({ path: path.join(screenshots, "desktop-event.png") });
    await dialog.getByRole("button", { name: "Закрыть", exact: true }).click();
    await expect(row).toBeFocused();

    for (const key of ["Enter", "Space"]) {
      const count = await page.evaluate(() => window.__qa.details.length);
      await row.press(key);
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText("CRM", { exact: true })).toBeVisible();
      assert.equal(await page.evaluate(() => window.__qa.details.length), count + 1);
      await page.keyboard.press("Escape");
      await expect(row).toBeFocused();
    }

    const compare = row.getByRole("button", { name: "Показать изменения", exact: true });
    const beforeCompare = await page.evaluate(() => window.__qa.details.length);
    await compare.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("[data-journal-diff]")).toBeInViewport();
    assert.equal(await page.evaluate(() => window.__qa.details.length), beforeCompare + 1);
    await page.keyboard.press("Escape");
    await expect(compare).toBeFocused();

    await page.evaluate(() => { window.__qa.failDetail = true; });
    await row.click();
    await expect(dialog.getByText("Не удалось загрузить событие", { exact: true })).toBeVisible();
    await expect(dialog.getByText("PRIVATE_BACKEND_ERROR")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Повторить", exact: true }).click();
    await expect(dialog.getByText("CRM", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.evaluate(() => { window.__qa.holdDetail = true; });
    await row.click();
    await expect(dialog.getByText("Загрузка события…", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    const secondRow = page.getByRole("row", { name: /Открыть событие.*Проект 203/ });
    await secondRow.click();
    await expect(dialog.getByRole("heading", { name: "Проект 203", exact: true })).toBeVisible();
    await page.evaluate(() => window.__qa.heldDetails.shift()());
    await expect(dialog.getByRole("heading", { name: "Проект 203", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByLabel("Пользователь", { exact: true }).click();
    await page.getByRole("button", { name: "Архивный сотрудник", exact: true }).click();
    await page.getByLabel("Сущность", { exact: true }).click();
    await page.getByRole("button", { name: "Изделия", exact: true }).click();
    await page.getByLabel("Поиск по журналу", { exact: true }).fill("значение после 60 символов");
    await page.getByLabel("С", { exact: true }).fill("2026-11-01");
    await page.getByLabel("По", { exact: true }).fill("2026-11-16");
    await page.getByRole("button", { name: "Применить", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__qa.lists.at(-1).q)).toBe("значение после 60 символов");
    assert.deepEqual(await page.evaluate(() => {
      const { actorId, entity, from, to, scope } = window.__qa.lists.at(-1); return { actorId, entity, from, to, scope };
    }), { actorId: "old-user", entity: "product", from: "2026-11-01", to: "2026-11-16", scope: { kind: "global" } });
    await page.getByRole("button", { name: "Вперёд", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__qa.lists.at(-1).page)).toBe(2);
    await page.getByRole("button", { name: "Сбросить", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__qa.lists.at(-1).page)).toBe(1);
    await expect(page.getByLabel("Поиск по журналу", { exact: true })).toHaveValue("");

    await page.getByLabel("Поиск по журналу", { exact: true }).fill("медленный ответ");
    await page.getByRole("button", { name: "Применить", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__qa.heldLists.length)).toBe(1);
    await page.getByLabel("Поиск по журналу", { exact: true }).fill("новый ответ");
    await page.getByRole("button", { name: "Применить", exact: true }).click();
    await expect(row).toHaveCount(0);
    await page.evaluate(() => window.__qa.heldLists.shift()());
    await expect(row).toHaveCount(0);
    await expect(secondRow).toBeVisible();

    await page.getByRole("button", { name: "Сбросить", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileRow = page.locator('[data-slot="mobile-list-card"]').filter({ hasText: "Изделие 203.1" });
    await expect(mobileRow).toBeVisible();
    await mobileRow.click();
    await expect(dialog.getByText("CRM", { exact: true })).toBeVisible();
    await expect.poll(async () => {
      const rect = await dialog.boundingBox(); return rect.width >= 388 && rect.width <= 391 && rect.height >= 840;
    }).toBe(true);
    assert.ok(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(screenshots, "mobile-event.png") });
    const listCalls = await page.evaluate(() => window.__qa.lists.length);
    await dialog.getByRole("button", { name: "Откат действия", exact: true }).click();
    await expect(dialog.getByText("Отменить действие «Изменение» для «Изделие 203.1»?")).toBeVisible();
    assert.deepEqual(await page.evaluate(() => window.__qa.previews), [{ entryId: "event-one", scope: { kind: "global" } }]);
    assert.equal(await page.evaluate(() => window.__qa.reversals.length), 0);
    const confirm = dialog.getByRole("button", { name: "Подтвердить откат", exact: true });
    await confirm.click();
    await expect(dialog.getByRole("alert")).toHaveText("Не удалось подтвердить откат");
    await confirm.click();
    await expect(dialog.getByText("Действие отменено")).toBeVisible();
    const reversals = await page.evaluate(() => window.__qa.reversals);
    assert.equal(reversals.length, 2);
    assert.deepEqual(reversals[0], reversals[1]);
    assert.match(reversals[0].requestId, /^[a-f0-9-]{36}$/);
    await expect.poll(() => page.evaluate(() => window.__qa.lists.length)).toBe(listCalls + 1);
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-slot="dialog-content"]')).toHaveCount(0);
    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      await page.getByLabel("С", { exact: true }).fill("2026-11-01");
      await page.getByLabel("По", { exact: true }).fill("2026-11-16");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `journal filters must fit ${width}px without page overflow`);
      const dateWidths = await page.locator('input[type="date"]').evaluateAll(inputs => inputs.map(input => input.getBoundingClientRect().width));
      assert.ok(dateWidths.every(value => value >= 140), `mobile dates must remain readable: ${dateWidths}`);
      await page.screenshot({ path: path.join(screenshots, `filters-mobile-${width}.png`) });
    }
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.locator("main").evaluate(node => { node.style.marginLeft = "256px"; node.style.width = "calc(100% - 256px)"; });
    await page.getByLabel("С", { exact: true }).fill("2026-11-01");
    await page.getByLabel("По", { exact: true }).fill("2026-11-16");
    const dateWidths = await page.locator('input[type="date"]').evaluateAll(inputs => inputs.map(input => input.getBoundingClientRect().width));
    assert.ok(dateWidths.every(width => width >= 140), `date controls must remain readable beside the sidebar: ${dateWidths}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "journal must fit a narrow desktop workspace beside its sidebar");
    await page.screenshot({ path: path.join(screenshots, "narrow-workspace.png") });
    assert.deepEqual(errors, []);
    console.log(`Journal UI screenshots: ${screenshots}`);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
});
