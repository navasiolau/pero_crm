import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url), { chromium } = require('@playwright/test');
const { build } = createRequire(require.resolve('tsx/package.json'))('esbuild');
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), evidence = path.join(web, 'test-results', 'counterparty-directory');
let browser, bundle, css;
before(async () => {
  browser = await chromium.launch({ headless: true }); await mkdir(evidence, { recursive: true });
  bundle = await build({ stdin: { contents: `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {CounterpartiesView} from '@/app/(app)/counterparties/counterparties-view';
function Harness(){const[rows,setRows]=React.useState(window.__rows);React.useEffect(()=>{window.__setRows=setRows;},[]);return <CounterpartiesView rows={rows}/>;}
createRoot(document.getElementById('root')).render(<Harness/>);
`, loader: 'tsx', resolveDir: web }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', tsconfig: path.join(web, 'tsconfig.json'),
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent', plugins: [{ name: 'boundaries', setup(b) {
      b.onResolve({ filter: /^(next\/navigation|@\/server\/counterparties\/actions)$/ }, args => ({ path: args.path, namespace: 'boundary' }));
      b.onLoad({ filter: /.*/, namespace: 'boundary' }, args => ({ contents: args.path === 'next/navigation'
        ? 'export const useRouter=()=>({refresh(){window.__refreshes++;}});'
        : 'export const createCounterparty=input=>window.__save({kind:"create",input});export const updateCounterparty=(id,input,expectedRevision)=>window.__save({kind:"update",id,input,expectedRevision});', loader: 'js', resolveDir: web }));
    } }] });
  const postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss'), tailwind = require('@tailwindcss/postcss');
  css = (await postcss([tailwind({ base: web })]).process(await readFile(path.join(web, 'src/app/globals.css'), 'utf8'), { from: path.join(web, 'src/app/globals.css') })).css;
});
after(async () => { await browser?.close(); });
const rows = Array.from({ length: 15 }, (_, index) => ({ id: `party-${index}`, company: `Компания ${String(index).padStart(2, '0')}`, type: index % 2 ? 'CARRIER' : 'SUPPLIER', phone: `+375 00 200 ${index}`, comment: index === 2 || index === 11 ? 'Shared поиск по комментарию' : 'Обычный контакт', revision: 4 }));
async function withDirectory(options, run) {
  const viewport = options.viewport ?? { width: 1440, height: 1000 }, context = await browser.newContext({ viewport });
  try {
    const page = await context.newPage(); page.setDefaultTimeout(5000);
    await page.route('http://127.0.0.1/counterparties-component', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
    await page.goto('http://127.0.0.1/counterparties-component');
    await page.evaluate(({ options, rows }) => {
      window.__rows = rows; window.__calls = []; window.__refreshes = 0; window.__mode = options.mode;
      window.__save = async call => {
        window.__calls.push(call);
        if (window.__mode === 'conflict') return { ok: false, kind: 'conflict', error: 'Контрагент изменён другим пользователем — обновите карточку' };
        const item = { id: call.id ?? 'new-party', ...call.input, phone: call.input.phone ?? null, comment: call.input.comment ?? null, revision: call.kind === 'update' ? call.expectedRevision + 1 : 0 };
        return { ok: true, item };
      };
      if (options.dark) document.documentElement.classList.add('dark');
    }, { options, rows });
    await page.addStyleTag({ content: css + '\n:root{--font-onest:system-ui;}' }); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByRole('heading', { name: 'Контрагенты', exact: true }).waitFor(); await run(page, viewport);
  } finally { await context.close(); }
}
async function select(page, label, option) { await page.getByRole('combobox', { name: label, exact: true }).click(); await page.getByRole('option', { name: option, exact: true }).click(); }
async function openRow(page, company, viewport) {
  const item = viewport.width < 768 ? page.locator('[data-slot="mobile-list-card"]').filter({ hasText: company }) : page.getByRole('row').filter({ hasText: company });
  await item.click(); await page.getByText('Карточка контрагента', { exact: true }).waitFor();
}
async function stableDialog(page) { await page.locator('[data-slot="dialog-content"][data-closed]').waitFor({ state: 'detached' }); return page.getByRole('dialog'); }

test('directory search, type filter and pagination work together on desktop and mobile', async () => {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) await withDirectory({ viewport }, async page => {
    await page.getByRole('button', { name: 'Вперёд', exact: true }).click(); assert.ok((await page.locator('body').innerText()).includes('Стр. 2 из 2'));
    await select(page, 'Фильтр типа', 'Перевозчики'); assert.ok((await page.locator('body').innerText()).includes('Стр. 1 из 1'));
    await page.getByLabel('Поиск', { exact: true }).fill('Shared');
    assert.equal(await page.getByLabel('Поиск', { exact: true }).inputValue(), 'Shared');
    const visible = viewport.width < 768 ? page.locator('[data-slot="mobile-list-card"]') : page.getByRole('row').filter({ hasText: 'Компания' }).filter({ hasNotText: 'Комментарий' });
    assert.equal(await visible.count(), 1); assert.ok((await visible.first().innerText()).includes('Компания 11'));
    await select(page, 'Фильтр типа', 'Все'); assert.equal(await visible.count(), 2); assert.equal(await page.getByLabel('Поиск', { exact: true }).inputValue(), 'Shared');
    await page.getByLabel('Поиск', { exact: true }).fill('200 11'); assert.equal(await visible.count(), 1);
    await page.getByLabel('Поиск', { exact: true }).fill('не существует'); assert.equal(await page.getByText('Контрагенты не найдены', { exact: true }).filter({ visible: true }).count(), 1);
    assert.equal(await page.getByRole('button', { name: /Удалить/ }).count(), 0);
  });
});

test('real directory creates, views and clears contacts at 1440/390/360 in light and dark themes', async () => {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 360, height: 800 }]) for (const dark of [false, true]) {
    const label = `${viewport.width}-${dark ? 'dark' : 'light'}`;
    await withDirectory({ viewport, dark }, async page => {
      await page.getByRole('button', { name: 'Контрагент', exact: true }).click();
      await select(page, 'Тип контрагента', 'Перевозчик');
      await page.getByLabel('Компания *', { exact: true }).fill(' Тестовый перевозчик с длинным названием компании ');
      await page.getByLabel('Телефон', { exact: true }).fill('+375 00 174'); await page.getByLabel('Комментарий', { exact: true }).fill('Условия перевозки\n' + 'Длинный комментарий для мобильной карточки. '.repeat(18));
      const save = page.getByRole('button', { name: 'Сохранить', exact: true }); await save.scrollIntoViewIfNeeded();
      const bounds = await save.boundingBox(); assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= viewport.height);
      await page.screenshot({ path: path.join(evidence, `${label}-editor.png`), animations: 'disabled' });
      await save.click(); await page.getByText('Карточка контрагента', { exact: true }).waitFor();
      let dialog = await stableDialog(page); assert.ok((await dialog.innerText()).includes('+375 00 174'));
      const title = await dialog.getByRole('heading').boundingBox(); assert.ok(title && title.y >= 0 && title.y < viewport.height);
      await page.screenshot({ path: path.join(evidence, `${label}-viewer.png`), animations: 'disabled' });
      const created = await page.evaluate(() => window.__calls[0]); assert.equal(created.input.type, 'CARRIER'); assert.equal(created.input.company, 'Тестовый перевозчик с длинным названием компании');
      await dialog.getByRole('button', { name: 'Редактировать', exact: true }).click(); await page.getByLabel('Компания *', { exact: true }).waitFor();
      await page.getByLabel('Телефон', { exact: true }).fill(''); await page.getByLabel('Комментарий', { exact: true }).fill('');
      await page.getByRole('button', { name: 'Сохранить', exact: true }).click(); await page.getByText('Карточка контрагента', { exact: true }).waitFor();
      dialog = await stableDialog(page); assert.equal((await dialog.innerText()).includes('+375 00 174'), false);
      const calls = await page.evaluate(() => window.__calls); assert.equal(calls.length, 2); assert.equal(calls[1].id, 'new-party'); assert.equal(calls[1].expectedRevision, 0); assert.equal(calls[1].input.phone, undefined); assert.equal(calls[1].input.comment, undefined);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.getByLabel('Поиск', { exact: true }).fill('Тестовый перевозчик');
      await openRow(page, 'Тестовый перевозчик', viewport); assert.ok((await page.getByRole('dialog').innerText()).includes('Перевозчик'));
    });
  }
});

test('real editor preserves input and original revision after a conflict', async () => {
  await withDirectory({ viewport: { width: 360, height: 800 }, dark: true, mode: 'conflict' }, async (page, viewport) => {
    await openRow(page, 'Компания 00', viewport); await page.getByRole('dialog').getByRole('button', { name: 'Редактировать', exact: true }).click();
    await page.getByLabel('Компания *', { exact: true }).fill('Новая компания'); await page.getByLabel('Комментарий', { exact: true }).fill('Сохранить мой текст');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click(); await page.getByRole('alert').filter({ hasText: 'изменён другим пользователем' }).waitFor();
    assert.equal(await page.getByLabel('Компания *', { exact: true }).inputValue(), 'Новая компания'); assert.equal(await page.getByLabel('Комментарий', { exact: true }).inputValue(), 'Сохранить мой текст');
    const [call] = await page.evaluate(() => window.__calls); assert.equal(call.expectedRevision, 4); assert.equal(await page.evaluate(() => window.__refreshes), 0);
    await page.getByRole('button', { name: 'Отмена', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await openRow(page, 'Компания 00', viewport); assert.equal((await page.getByRole('dialog').innerText()).includes('Новая компания'), false);
  });
});
