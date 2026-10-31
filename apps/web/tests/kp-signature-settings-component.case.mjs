// Этот сценарий подключается из kp-editor-component.test.mjs в существующую browser cohort.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile } from 'node:fs/promises';
const require = createRequire(import.meta.url), { chromium } = require('@playwright/test');
const { build } = createRequire(require.resolve('tsx/package.json'))('esbuild');
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('настройки подписи: мобильная форма, потеря ответа и повтор исходного UUID', async () => {
  const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {SignatureDefaultsForm} from './src/app/(app)/settings/kp/signature-defaults-form';createRoot(document.getElementById('root')).render(<SignatureDefaultsForm initial={{revision:0,values:{managerName:'Менеджер QA',managerRole:'Директор',managerPhone:'+000',warrantyMonths:12,footer:'QA · Гарантия — 12 месяцев.'}}}/>);`, resolveDir: web, loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', tsconfig: path.join(web, 'tsconfig.json'), define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'action', setup(builder) {
    builder.onResolve({ filter: /^@\/server\/kp\/signature-settings-actions$/ }, () => ({ path: 'action', namespace: 'mock' }));
    builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `export async function saveSignatureSettingsAction(input){window.__calls.push(structuredClone(input));if(window.__calls.length===1)return{ok:false,unknownOutcome:true,error:'Сохранение не подтверждено'};return{ok:true,snapshot:{revision:1,values:input.values}};}`, loader: 'js' }));
  } }], logLevel: 'silent' });
  const postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss'), tailwind = require('@tailwindcss/postcss');
  const css = (await postcss([tailwind({ base: web })]).process(await readFile(path.join(web, 'src/app/globals.css'), 'utf8'), { from: path.join(web, 'src/app/globals.css') })).css;
  const server = createServer((_request, response) => { response.setHeader('content-type', 'text/html; charset=utf-8'); response.end('<meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style><main style="padding:16px"><div id="root"></div></main><script>window.__calls=[];</script><script>' + bundle.outputFiles[0].text.replaceAll('</script', '<\\/script') + '</script>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.getByLabel('Менеджер', { exact: true }).fill('Новый менеджер QA');
    await page.getByLabel('Гарантия, месяцев').fill('24');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await page.getByRole('button', { name: 'Повторить сохранение' }).click();
    await page.getByRole('status').filter({ hasText: 'Сохранено' }).waitFor();
    const calls = await page.evaluate(() => window.__calls); assert.equal(calls.length, 2); assert.deepEqual(calls[1], calls[0]);
    assert.equal(calls[0].values.managerName, 'Новый менеджер QA'); assert.equal(calls[0].values.warrantyMonths, 24);
    assert.match(await page.getByLabel('Подвал / реквизиты').inputValue(), /24 месяца/);
    assert.equal(await page.getByLabel('Менеджер', { exact: true }).isEnabled(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); assert.deepEqual(errors, []);
    const output = path.join(web, 'test-results/kp-signature-settings'); await mkdir(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 }); await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
