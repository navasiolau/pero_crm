import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, mkdir } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('tsx/package.json'))('esbuild');
const { chromium } = require('@playwright/test');
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = path.join(web, 'test-results', 'client-passport-details');
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); await mkdir(evidence, { recursive: true }); });
after(async () => { await browser?.close(); });
const bundle = build({
  stdin: { contents: `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {ClientDialog} from '@/components/client-dialog'; import {ClientsView} from '@/app/(app)/clients/clients-view';
function Editor(){const[open,setOpen]=React.useState(true);return <ClientDialog open={open} onOpenChange={value=>{window.__open=value;setOpen(value);}} editing={window.__editing?window.__client:null} onCreated={id=>{window.__created=id;}}/>;}
createRoot(document.getElementById('root')).render(window.__directory?<ClientsView clients={[window.__client]} focusClientId="client" canManage={window.__canManage}/>:<Editor/>);
`, resolveDir: web, loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  tsconfig: path.join(web, 'tsconfig.json'), define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'external-boundaries', setup(b) {
    b.onResolve({ filter: /^(next\/link|@\/server\/clients\/actions)$/ }, args => ({ path: args.path, namespace: 'boundary' }));
    b.onLoad({ filter: /.*/, namespace: 'boundary' }, args => ({ contents: args.path === 'next/link'
      ? `import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children);}`
      : 'export const createClient=input=>window.__save({kind:"create",input});export const updateClient=(id,input,baseline)=>window.__save({kind:"update",id,input,baseline});', loader: 'js', resolveDir: web }));
  } }], logLevel: 'silent',
});
const css = (async () => {
  const postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss'), tailwind = require('@tailwindcss/postcss');
  return (await postcss([tailwind({ base: web })]).process(await readFile(path.join(web, 'src/app/globals.css'), 'utf8'), { from: path.join(web, 'src/app/globals.css') })).css;
})();
const client = { id: 'client', name: 'Иван', lastName: 'Тестовый', middleName: null, phone: '100', email: 'qa@example.invalid', address: 'Адрес клиента', comment: 'Комментарий', passportNumber: 'QA 000171', passportIssuedBy: 'Тестовый орган выдачи', projects: [], projectsCount: 0 };
async function withClient(options, run) {
  const context = await browser.newContext({ viewport: options.viewport ?? { width: 1440, height: 1000 }, colorScheme: options.dark ? 'dark' : 'light' });
  try {
    const page = await context.newPage(); page.setDefaultTimeout(5000);
    await page.route('http://127.0.0.1/client-component', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
    await page.goto('http://127.0.0.1/client-component');
    await page.evaluate(({ options, client }) => {
      window.__directory = options.directory ?? false; window.__canManage = options.canManage ?? true;
      window.__editing = options.editing ?? false; window.__client = client; window.__open = true; window.__calls = [];
      window.__save = async input => { window.__calls.push(input); return options.fail ? { ok: false, error: 'Клиент изменён другим пользователем — обновите форму' } : { ok: true, id: 'created-client' }; };
      if (options.dark) document.documentElement.classList.add('dark');
    }, { options, client });
    await page.addStyleTag({ content: await css }); await page.addScriptTag({ content: (await bundle).outputFiles[0].text });
    await page.getByRole('dialog').waitFor(); await run(page);
  } finally { await context.close(); }
}

test('real shared client dialog creates optional passport fields and reports created client', async () => {
  await withClient({}, async page => {
    await page.getByLabel('Имя *', { exact: true }).fill(' Новый клиент '); await page.getByLabel('Телефон *', { exact: true }).fill('200');
    await page.getByLabel('Номер паспорта', { exact: true }).fill(' QA 000172 '); await page.getByLabel('Кем выдан', { exact: true }).fill(' Тестовая выдача ');
    await page.getByRole('button', { name: 'Создать', exact: true }).click(); await page.waitForFunction(() => window.__created === 'created-client');
    const [call] = await page.evaluate(() => window.__calls);
    assert.equal(call.kind, 'create'); assert.equal(call.input.passportNumber, 'QA 000172'); assert.equal(call.input.passportIssuedBy, 'Тестовая выдача');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('dialog').count(), 0);
  });
});

test('real full editor restores passport baseline, submits clearing and retains unsaved input after conflict', async () => {
  await withClient({ editing: true }, async page => {
    assert.equal(await page.getByLabel('Номер паспорта', { exact: true }).inputValue(), client.passportNumber);
    assert.equal(await page.getByLabel('Кем выдан', { exact: true }).inputValue(), client.passportIssuedBy);
    await page.getByLabel('Номер паспорта', { exact: true }).fill(''); await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await page.waitForFunction(() => !window.__open);
    const [call] = await page.evaluate(() => window.__calls);
    assert.equal(call.kind, 'update'); assert.equal(call.id, client.id); assert.equal(call.input.passportNumber, undefined);
    assert.equal(call.input.passportIssuedBy, client.passportIssuedBy); assert.equal(call.input.phone, client.phone);
    assert.deepEqual(call.baseline, Object.fromEntries(Object.entries(client).filter(([key]) => !['id', 'projects', 'projectsCount'].includes(key))));
  });
  await withClient({ editing: true, fail: true }, async page => {
    await page.getByLabel('Номер паспорта', { exact: true }).fill('QA 000173'); await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'изменён другим пользователем' }).waitFor();
    assert.equal(await page.getByLabel('Номер паспорта', { exact: true }).inputValue(), 'QA 000173');
  });
});

test('client viewer and editor show passport on desktop/mobile in both themes without horizontal overflow', async () => {
  for (const [label, viewport, dark] of [['desktop-light', { width: 1440, height: 1000 }, false], ['mobile-dark', { width: 360, height: 800 }, true]]) {
    await withClient({ directory: true, viewport, dark }, async page => {
      const dialog = page.getByRole('dialog'); assert.ok((await dialog.innerText()).includes(client.passportNumber)); assert.ok((await dialog.innerText()).includes(client.passportIssuedBy));
      await page.screenshot({ path: path.join(evidence, `${label}-viewer.png`), fullPage: true, animations: 'disabled' });
      await dialog.getByRole('button', { name: 'Редактировать', exact: true }).click(); await page.getByLabel('Номер паспорта', { exact: true }).waitFor();
      await page.locator('[data-slot="dialog-content"][data-closed]').waitFor({ state: 'detached' });
      assert.equal(await page.getByLabel('Адрес', { exact: true }).inputValue(), client.address);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.getByLabel('Кем выдан', { exact: true }).fill('Тестовый орган выдачи с длинным наименованием для узкого экрана');
      await page.getByRole('dialog').evaluate(node => { node.scrollTop = 0; });
      await page.screenshot({ path: path.join(evidence, `${label}-editor.png`), fullPage: true, animations: 'disabled' });
      const save = page.getByRole('button', { name: 'Сохранить', exact: true }); await save.scrollIntoViewIfNeeded();
      const bounds = await save.boundingBox(); assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= viewport.height);
      if (label.startsWith('mobile')) await page.screenshot({ path: path.join(evidence, `${label}-editor-footer.png`), fullPage: true, animations: 'disabled' });
    });
  }
});

test('readonly client viewer has contacts and no passport controls or fields', async () => {
  await withClient({ directory: true, canManage: false, viewport: { width: 360, height: 800 } }, async page => {
    const dialog = page.getByRole('dialog'), text = await dialog.innerText();
    assert.ok(text.includes(client.phone)); assert.ok(text.includes(client.address)); assert.doesNotMatch(text, /Номер паспорта|Кем выдан|QA 000171|Тестовый орган выдачи/);
    assert.equal(await dialog.getByRole('button', { name: 'Редактировать', exact: true }).count(), 0);
    assert.deepEqual(await page.evaluate(() => window.__calls), []);
  });
});
