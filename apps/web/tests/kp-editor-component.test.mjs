// Синтетический session/backend transport; реальные перенесённые HTML/CSS/JS и Chromium.
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { isDeepStrictEqual } from 'node:util';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildKpEditorFrame } from '../src/server/kp/editor-frame.ts';
import { projectProposalPricing } from '../src/server/kp/pricing.ts';

const require = createRequire(import.meta.url), { chromium, expect } = require('@playwright/test'), sharp = require('sharp');
const { build } = createRequire(require.resolve('tsx/package.json'))('esbuild');
const template = require('@pero/kp-template'), renderer = require('../../kp-renderer/render.cjs');
const { isolatedWorker } = require('../../kp-renderer/server.cjs');
const originalRoot = path.resolve(path.dirname(require.resolve('@pero/kp-template')), 'test/original');
const originalSheet = require(path.join(originalRoot, 'sheet-render.js'));
const puppeteer = require('../../kp-renderer/node_modules/puppeteer-core');
const output = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test-results/kp-editor/' + randomUUID());
const copy = value => JSON.parse(JSON.stringify(value));
const state = {
  header: { company: 'Перо Лайв', tagline: 'Мебель по индивидуальным заказам. Легкость во всём', phone: '+000', phone2: '', email: 'fixture@example.invalid', site: 'example.invalid', instagram: '' },
  order: { number: '231', date: '18.10.2026', validUntil: '01.11.2026', project: 'Контрольная меблировка' }, client: { name: 'Контрольный заказчик', contact: '+000' },
  currency: 'BYN', discountMode: 'percent', discount: 10, warrantyMonths: 12, intro: 'Контрольный снимок без рабочих данных',
  payment: 'Оплата: предоплата 70 %, остаток — после монтажа', totalNote: 'включая доставку и монтаж',
  items: Array.from({ length: 4 }, (_, index) => ({ id: 'item-' + index, name: index === 2 ? 'Шкаф с двумя изображениями' : 'Шкаф ' + (index + 1),
    description: 'Описание изделия и материалов. '.repeat(index === 2 ? 15 : 4), size: '2400 × 2200 × 600', price: 100.75 + index * 100, qty: index + 1,
    image: 'kp-media:photo', image2: index === 2 ? 'kp-media:photo' : '', dbl: index === 2, note: 'Примечание к позиции',
    products: [{ title: 'Каркас и фасады', outer: 'ЛДСП', inner: 'Белый', hinges: 'Петли', drawers: 'Ящики', lighting: '' }] })),
  delivery: { mode: 'items', visible: true, items: [{ name: 'Доставка до объекта', price: 30, crmKind: 'DELIVERY' }, { name: 'Монтаж', price: 50, crmKind: 'INSTALLATION' }] },
  manager: { name: 'Контрольный менеджер', role: 'Менеджер', phone: '+000' }, footer: 'Контрольная организация · Гарантия — 12 месяцев.'
};
const baseDoc = () => ({ id: 'primary', revision: 2, state: copy(state), createdAt: '2026-10-18T09:00:00.000Z', updatedAt: '2026-10-18T10:00:00.000Z',
  project: { id: 'project', number: '231', stage: 'LEAD' }, client: { id: 'client', label: state.client.name }, canEdit: true,
  fx: { currency: 'BYN', rate: '1', date: '2026-10-18', source: 'NBRB' } });
let browser, server, origin, image, doc, writes, pdfRequests, pdfAttempts, pdfOperations, renderedPdfSnapshots, concurrentPdfChange, pricingProjections, renderSavedPdf, pdfBytes, refuseSave, refuseRate, requests, contractSettings, contractRevision, clientDetails;
const originalClient = () => ({ id: 'client', label: state.client.name, isTemporary: false, snapshot: { id: 'client', name: 'заказчик', lastName: 'Контрольный', middleName: null, phone: '+000', email: 'fixture@example.invalid', address: 'Контрольный адрес', comment: null, passportNumber: 'номер', passportIssuedBy: 'выдан' } });
const selectedClient = () => ({ id: 'selected-client', label: 'Новый заказчик', isTemporary: false, snapshot: { id: 'selected-client', name: 'Новый заказчик', lastName: null, middleName: null, phone: '+001', email: 'selected@example.invalid', address: 'Другой адрес', comment: null, passportNumber: 'обновлённый номер', passportIssuedBy: 'другой орган' } });
function reset() { doc = baseDoc(); writes = []; pdfRequests = []; pdfAttempts = []; pdfOperations = new Map(); renderedPdfSnapshots = []; concurrentPdfChange = false; pricingProjections = []; renderSavedPdf = false; pdfBytes = Buffer.from('%PDF-1.7\n%%EOF'); refuseSave = false; refuseRate = false; requests = []; contractSettings = null; contractRevision = 0; clientDetails = originalClient(); }
function confirmedPricing(state, fx) {
  if (!fx) throw Error('Укажите фиксированный курс КП');
  return projectProposalPricing(state, { currency: fx.currency, value: fx.rate, date: fx.date, source: fx.source });
}
const types = { js: 'text/javascript', css: 'text/css', woff2: 'font/woff2', png: 'image/png' };
function json(response, value, status = 200) { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)); }
async function body(request) { const chunks = []; for await (const chunk of request) chunks.push(chunk); return JSON.parse(Buffer.concat(chunks).toString()); }
before(async () => {
  await mkdir(output, { recursive: true });
  for (const name of ['app.js', 'sheet-render.js', 'contract-editor.js']) assert.equal(createHash('sha256').update(await readFile(path.join(originalRoot, name))).digest('hex'), template.sourceManifest.files['public/js/' + name].sha256);
  image = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#edf0f0"/><rect x="180" y="70" width="440" height="470" fill="#c2a481" stroke="#342b25" stroke-width="6"/><path d="M400 70V540M180 300H620" stroke="#342b25" stroke-width="4"/><circle cx="380" cy="280" r="5" fill="#342b25"/><circle cx="420" cy="280" r="5" fill="#342b25"/></svg>')).png().toBuffer();
  reset();
  const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss'), tailwind = require('@tailwindcss/postcss');
  const css = (await postcss([tailwind({ base: web })]).process(await readFile(path.join(web, 'src/app/globals.css'), 'utf8'), { from: path.join(web, 'src/app/globals.css') })).css;
  const parentBundle = (await build({ stdin: { contents: "import React from 'react';import {createRoot} from 'react-dom/client';import {KpEditor} from '@/app/(app)/kp/[id]/editor';createRoot(document.getElementById('root')).render(<KpEditor documentId='primary'/>);", loader: 'tsx', resolveDir: web },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', tsconfig: path.join(web, 'tsconfig.json'), define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
    plugins: [{ name: 'explicit-boundaries', setup(builder) {
      builder.onResolve({ filter: /^(next\/navigation|next\/link)$/ }, args => ({ path: args.path, namespace: 'boundary' }));
      builder.onLoad({ filter: /.*/, namespace: 'boundary' }, args => ({ loader: 'js', resolveDir: web, contents: args.path === 'next/navigation' ? 'const router=Object.freeze({push:href=>window.__navigation=href,refresh:()=>{window.__refreshes=(window.__refreshes??0)+1}});export const useRouter=()=>router;' :
        "import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}" }));
    } }] })).outputFiles[0].text;
  server = createServer((request, response) => { void (async () => {
    const url = new URL(request.url, 'http://fixture.invalid'); requests.push({ method: request.method, path: url.pathname });
    if (url.pathname === '/port' || url.pathname === '/kp/frame') { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(await buildKpEditorFrame({ actorId: 'qa-actor', documentId: 'primary', apiBase: '/api/kp' })); return; }
    if (url.pathname === '/host') { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end('<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/host.css"></head><body style="padding:16px"><div id="root"></div><script src="/host-bundle.js"></script></body></html>'); return; }
    if (url.pathname === '/host.css') { response.writeHead(200, { 'content-type': 'text/css' }); response.end(css); return; }
    if (url.pathname === '/host-bundle.js') { response.writeHead(200, { 'content-type': 'text/javascript' }); response.end(parentBundle); return; }
    if (url.pathname === '/api/kp/clients') { json(response, { clients: [clientDetails, selectedClient()] }); return; }
    if (url.pathname === '/api/kp/clients/client') { json(response, clientDetails); return; }
    if (url.pathname === '/api/kp/clients/selected-client') { json(response, selectedClient()); return; }
    if (url.pathname === '/api/kp/documents/primary/versions') { json(response, { versions: [{ id: 'old-version', revision: 1, createdAt: '2026-10-18T09:00:00Z', trigger: 'PDF', isAccepted: false, pdfArtifactId: 'old-pdf' }] }); return; }
    if (url.pathname === '/api/kp/documents/primary/versions/old-version') { json(response, { version: { id: 'old-version' }, document: { ...doc, fx: baseDoc().fx, revision: 1, canEdit: false, state: { ...copy(state), order: { ...state.order, project: 'Старая версия' } } } }); return; }
    if (url.pathname === '/api/kp/documents/primary/versions/old-version/restore') { const input = await body(request); assert.equal(input.expectedRevision, doc.revision); doc = { ...doc, fx: baseDoc().fx, revision: doc.revision + 1, state: { ...copy(state), order: { ...state.order, project: 'Старая версия' } } }; json(response, doc); return; }
    if (url.pathname === '/original') {
      let html = await readFile(template.assetPath('app/index.html'), 'utf8');
      html = html.replace(/<link[^>]+href="https:\/\/fonts\.(?:googleapis|gstatic)\.com[^>]*>/g, '').replace(/<link[^>]+rel="manifest"[^>]*>/g, '')
        .replace(/href="\/css\//g, 'href="/kp/assets/css/').replace(/src="\/js\//g, 'src="/baseline/js/')
        .replace('</head>', '<link rel="stylesheet" href="/kp/assets/fonts/fonts.css"></head>');
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(html); return;
    }
    if (url.pathname.startsWith('/kp/assets/')) { const name = url.pathname.slice('/kp/assets/'.length); const bytes = template.browserAsset('public/' + name); response.writeHead(200, { 'content-type': types[name.split('.').pop()] }); response.end(bytes); return; }
    if (url.pathname.startsWith('/baseline/js/')) { const name = url.pathname.split('/').pop(); const bytes = name === 'contract-model.js' ? await readFile(template.assetPath('public/js/contract-model.js')) : await readFile(path.join(originalRoot, name)); response.writeHead(200, { 'content-type': 'text/javascript' }); response.end(bytes); return; }
    if (url.pathname === '/fixture-image.png' || /^\/api\/kp\/documents\/primary\/media\/photo$/.test(url.pathname)) { response.writeHead(200, { 'content-type': 'image/png' }); response.end(image); return; }
    if (url.pathname.startsWith('/api/kp/operations/') && request.method === 'GET') {
      const operationId = decodeURIComponent(url.pathname.split('/').at(-1)), retained = pdfOperations.get(operationId);
      if (!retained) { json(response, { error: { code: 'KP_OPERATION_NOT_FOUND', message: 'Подтверждённый результат операции не найден' } }, 404); return; }
      json(response, { operationId, kind: 'pdf', result: retained.job }); return;
    }
    if (url.pathname === '/api/kp/documents/primary' && request.method === 'GET') { json(response, doc); return; }
    if (url.pathname === '/api/kp/documents/primary' && request.method === 'PUT') {
      const input = await body(request); writes.push(input);
      if (refuseSave || input.expectedRevision !== doc.revision) { json(response, { error: { code: 'conflict', message: 'Контрольный конфликт ревизии' } }, 409); return; }
      try { pricingProjections.push(confirmedPricing(input.state, input.fx ?? doc.fx)); }
      catch (error) { json(response, { error: { code: 'KP_PRICING_INVALID', message: error.message } }, 400); return; }
      doc = { ...doc, revision: doc.revision + 1, state: input.state, fx: input.fx ?? doc.fx, client: { id: input.clientId ?? doc.client.id, label: input.clientId === 'selected-client' ? selectedClient().label : clientDetails.label } }; json(response, doc); return;
    }
    if (url.pathname === '/api/kp/documents/primary/pdf') {
      const input = await body(request); pdfAttempts.push(copy(input));
      const retained = pdfOperations.get(input.operationId);
      if (retained) {
        if (!isDeepStrictEqual(retained.input, input)) { json(response, { error: { code: 'KP_OPERATION_CONFLICT', message: 'Операция уже использована для другого запроса' } }, 409); return; }
        json(response, retained.job); return;
      }
      if (concurrentPdfChange) { concurrentPdfChange = false; doc = { ...doc, revision: doc.revision + 1 }; }
      if (input.expectedRevision !== doc.revision) { json(response, { error: { code: 'KP_REVISION_CHANGED', message: 'КП изменено: конфликт ревизии PDF' } }, 409); return; }
      try { confirmedPricing(doc.state, doc.fx); }
      catch (error) { json(response, { error: { code: 'KP_PRICING_INVALID', message: error.message } }, 400); return; }
      pdfRequests.push(input);
      if (renderSavedPdf) {
        const prior = process.env.PERO_KP_CHROMIUM_PATH;
        try {
          process.env.PERO_KP_CHROMIUM_PATH = chromium.executablePath();
          renderedPdfSnapshots.push({ revision: doc.revision, state: copy(doc.state), fx: copy(doc.fx) });
          const rendered = await isolatedWorker({ kind: 'bundle', proposalId: doc.id, revision: doc.revision, templateHash: template.getKpTemplateIdentity().templateHash,
            state: copy(doc.state), assets: [{ mediaId: 'photo', mimeType: 'image/png', bytesBase64: image.toString('base64') }] });
          pdfBytes = Buffer.from(rendered.bytesBase64, 'base64');
        } finally { if (prior === undefined) delete process.env.PERO_KP_CHROMIUM_PATH; else process.env.PERO_KP_CHROMIUM_PATH = prior; }
      }
      const job = { id: 'job', state: 'SUCCEEDED', result: { artifactId: 'pdf', versionId: 'version', fileName: 'КП_231.pdf', mimeType: 'application/pdf', downloadUrl: '/api/kp/artifacts/pdf/download' } };
      pdfOperations.set(input.operationId, { input: copy(input), job }); json(response, job); return;
    }
    if (url.pathname === '/api/kp/artifacts/pdf/download') { response.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': "attachment; filename=KP_231.pdf; filename*=UTF-8''" + encodeURIComponent('КП_231.pdf') }); response.end(pdfBytes); return; }
    if (url.pathname === '/api/kp/documents') { json(response, { documents: [{ id: doc.id, name: 'КП №231', updatedAt: doc.updatedAt, project: doc.project }] }); return; }
    if (url.pathname === '/api/kp/contracts' && request.method === 'GET') {
      contractSettings ??= Object.assign(template.ContractModel.defaults(doc.state, doc.id), doc.client.id === 'selected-client'
        ? { deliveryAddress: 'Другой адрес', customer: { type: 'individual', name: 'Новый заказчик', phone: '+001', email: 'selected@example.invalid', passport: 'обновлённый номер, другой орган' } }
        : { deliveryAddress: 'Контрольный адрес', customer: { type: 'individual', name: 'Клиент CRM', phone: '+000', passport: 'Контрольный документ' } });
      json(response, { contractId: 'contract', revision: contractRevision, canEdit: !!doc.project, settings: contractSettings, profiles: require(template.assetPath('templates/contracts/contractors.json')),
        sourceRefs: [{ proposalId: doc.id, expectedRevision: doc.revision }], clientDefaults: {}, clientBaseline: 'baseline' }); return;
    }
    if (url.pathname === '/api/kp/contracts/history') { json(response, { versions: [{ id: 'contract-version', createdAt: '2026-10-18T09:00:00Z', docxArtifactId: 'docx', fileName: 'contract_231_Pero.docx' }] }); return; }
    if (url.pathname === '/api/kp/contracts' && request.method === 'PUT') { const input = await body(request); assert.equal(input.primaryState, undefined); contractSettings = input.settings; contractRevision++; json(response, { revision: contractRevision, clientBaseline: 'baseline' }); return; }
    if (url.pathname === '/api/kp/rates') {
      if (refuseRate) { json(response, { error: { code: 'KP_RATE_UNAVAILABLE', message: 'Курс НБРБ недоступен. Задайте ручной курс' } }, 503); return; }
      const currency = url.searchParams.get('currency'); json(response, { fx: { currency, rate: currency === 'USD' ? '3.125' : '1', date: url.searchParams.get('date'), source: 'NBRB' } }); return;
    }
    response.writeHead(404); response.end();
  })().catch(error => { response.writeHead(500); response.end(JSON.stringify({ error: error.message })); }); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });
async function portPage(viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block', acceptDownloads: true });
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  await page.goto(origin + '/port'); await page.waitForFunction(() => window.PeroCrmKp?.getDocument()?.id === 'primary');
  await page.evaluate(() => document.fonts.ready); await page.locator('#sheet .page').first().waitFor({ state: 'attached' });
  if (viewport.width < 900) await page.locator('[data-view="sheet"]').click();
  return { context, page };
}
async function hostPage(viewport = { width: 1440, height: 1000 }, pendingPdf) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block', acceptDownloads: true });
  if (pendingPdf) await context.addInitScript(entry => localStorage.setItem('pero-crm-kp:qa-actor:primary:operation:pdf', JSON.stringify(entry)), pendingPdf);
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  await page.goto(origin + '/host');
  const child = page.frameLocator('iframe');
  await child.locator('[data-path="items.0.name"]').waitFor();
  return { context, page, child };
}

test('actual editor preserves source print DOM and page sizes on desktop/mobile, with private canonical images', async () => {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    reset(); const { context, page } = await portPage(viewport);
    try {
      const legacyState = copy(state); for (const item of legacyState.items) { if (item.image) item.image = origin + '/fixture-image.png'; if (item.image2) item.image2 = origin + '/fixture-image.png'; }
      const baseline = await context.newPage();
      await baseline.addInitScript(value => localStorage.setItem('pero-live-kp-state-v3', JSON.stringify(value)), legacyState);
      await baseline.goto(origin + '/original'); await baseline.evaluate(() => document.fonts.ready); await baseline.locator('#sheet .page').first().waitFor({ state: 'attached' });
      if (viewport.width < 900) await baseline.locator('[data-view="sheet"]').click();
      for (const target of [page, baseline]) await target.evaluate(async () => {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await Promise.all(document.getElementById('scale').getAnimations().map(animation => animation.finished.catch(() => {})));
      });
      assert.equal(await page.locator('#sheet .page').count(), await baseline.locator('#sheet .page').count());
      const printedText = value => value.locator('#sheet').innerText(); assert.equal(await printedText(page), await printedText(baseline));
      const pageSizes = value => value.locator('#sheet .page').evaluateAll(pages => pages.map(page => ({ width: page.offsetWidth, height: page.offsetHeight })));
      assert.deepEqual(await pageSizes(page), await pageSizes(baseline));
      assert.equal(await page.locator('.topbar').count(), 0);
      assert.equal(await page.locator('[data-path="order.number"]').getAttribute('readonly'), '');
      assert.equal(await page.locator('[data-path="client.name"]').getAttribute('readonly'), '');
      assert.equal(await page.locator('.doc-del').count(), 0);
      assert.equal(await page.locator('#deliveryEditor select').count(), 0);
      assert.equal(await page.evaluate(() => window.PeroCrmKp.getDocument().state.delivery.items[0].crmKind), 'DELIVERY', 'stored metadata stays silent');
      if (viewport.width < 900) await page.locator('[data-view="editor"]').click();
      await page.locator('#deliveryEditor').evaluate(async element => Promise.all(element.closest('.sec').getAnimations().map(animation => animation.finished.catch(() => {}))));
      const serviceLayout = await page.locator('#deliveryEditor .del-row').first().evaluate(row => {
        const bounds = row.getBoundingClientRect(), fields = [...row.children].map(field => field.getBoundingClientRect());
        return { display: getComputedStyle(row).display, fields: fields.length, nameWidth: fields[0].width, rightGap: bounds.right - fields.at(-1).right, inViewport: bounds.left >= 0 && bounds.right <= innerWidth };
      });
      assert.equal(serviceLayout.display, 'flex'); assert.equal(serviceLayout.fields, 3); assert.ok(serviceLayout.nameWidth > 0); assert.ok(Math.abs(serviceLayout.rightGap) < 2); assert.equal(serviceLayout.inViewport, true);
      await page.locator('#deliveryEditor').screenshot({ path: path.join(output, 'service-controls-' + viewport.width + '.png'), animations: 'disabled' });
      if (viewport.width < 900) await page.locator('[data-view="sheet"]').click();
      assert.equal(await page.locator('#sheet img').first().getAttribute('src'), '/api/kp/documents/primary/media/photo?variant=optimized&scope=current');
      await page.screenshot({ path: path.join(output, 'editor-' + viewport.width + '.png'), fullPage: true });
      await baseline.screenshot({ path: path.join(output, 'original-editor-' + viewport.width + '.png'), fullPage: true });
      await baseline.close();
    } finally { await context.close(); }
  }
});

test('actual save/rate-before-export keeps unmarked services without category controls and conflict prevents PDF', async () => {
  reset(); doc.revision = 1; doc.fx = null; doc.state.currency = '$'; renderSavedPdf = true;
  doc.state.items = [{ ...doc.state.items[0], price: 100, qty: 1 }];
  doc.state.delivery.items = [{ name: 'Доставка, выгрузка', price: 135, legacyDetail: { keep: 'source' } }, { name: 'Монтаж', price: 1230 }];
  const oldBody = { operationId: '00000000-0000-4000-8000-000000000189', proposalId: 'primary', expectedRevision: 1 };
  const pendingPdf = { fingerprint: JSON.stringify({ proposalId: 'primary', expectedRevision: 1 }), body: oldBody };
  const services = copy(doc.state.delivery.items), { context, page, child } = await hostPage(undefined, pendingPdf);
  try {
    assert.equal(await child.locator('#deliveryEditor select').count(), 0);
    const printedRows = await child.locator('.sh-deliveryRows .sh-delRow').allTextContents();
    await page.getByRole('button', { name: 'Курс', exact: true }).click();
    const dialog = page.getByRole('dialog'); await dialog.getByLabel('BYN за единицу валюты').fill('3.25');
    await dialog.getByRole('button', { name: 'Сохранить курс', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
    assert.deepEqual(doc.fx, { currency: 'USD', rate: '3.25', date: '2026-10-18', source: 'MANUAL' });
    await child.locator('[data-dadd]').click();
    await child.locator('[data-path="delivery.items.2.name"]').fill('Временный пункт'); await child.locator('[data-path="delivery.items.2.price"]').fill('1');
    await child.locator('[data-ddel="2"]').click();
    assert.deepEqual(await child.locator('.sh-deliveryRows .sh-delRow').allTextContents(), printedRows);
    await child.locator('[data-path="items.0.name"]').fill('Обновлённый шкаф');
    await child.locator('[data-dup="0"]').click();
    const beforePdf = requests.length;
    const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Сгенерировать PDF', exact: true }).click();
    const generated = await download; assert.equal(generated.suggestedFilename(), 'КП_231.pdf');
    await generated.saveAs(path.join(output, 'unmarked-services.pdf')); assert.ok(pdfBytes.length > 1000); assert.equal(pdfBytes.subarray(0, 5).toString(), '%PDF-');
    await expect.poll(() => page.evaluate(() => window.__refreshes ?? 0)).toBeGreaterThan(0);
    const refreshes = await page.evaluate(() => window.__refreshes);
    assert.ok(writes.length >= 1); const saved = writes.at(-1);
    assert.equal(saved.state.items[0].id, 'item-0'); assert.notEqual(saved.state.items[1].id, 'item-0');
    assert.equal(saved.state.items[0].name, 'Обновлённый шкаф'); assert.deepEqual(saved.state.delivery.items, services); assert.equal(saved.state.items[0].image, 'kp-media:photo');
    const projection = pricingProjections.at(-1).project; assert.equal(projection.servicesTotal.toFixed(2), '3992.63');
    assert.equal(projection.delivery, null); assert.equal(projection.unloading, null); assert.equal(projection.installation, null);
    assert.equal(doc.revision, 3); assert.deepEqual(pdfAttempts[0], oldBody); assert.equal(pdfAttempts.length, 2);
    assert.notEqual(pdfAttempts[1].operationId, oldBody.operationId); assert.equal(pdfAttempts[1].expectedRevision, 3);
    assert.deepEqual(requests.slice(beforePdf).filter(request => request.path.includes('/operations/') || request.path.endsWith('/pdf') || request.path === '/api/kp/documents/primary' && request.method === 'GET').map(request => request.method + ' ' + request.path),
      ['POST /api/kp/documents/primary/pdf', 'GET /api/kp/operations/' + oldBody.operationId, 'GET /api/kp/documents/primary', 'POST /api/kp/documents/primary/pdf']);
    assert.equal(renderedPdfSnapshots.length, 1); assert.equal(renderedPdfSnapshots[0].revision, 3); assert.deepEqual(renderedPdfSnapshots[0].state, saved.state);
    assert.deepEqual(renderedPdfSnapshots[0].fx, { currency: 'USD', rate: '3.25', date: '2026-10-18', source: 'MANUAL' });
    assert.equal(await child.locator('body').evaluate(() => localStorage.getItem('pero-crm-kp:qa-actor:primary:operation:pdf')), null);
    assert.equal(pdfRequests.length, 1); assert.equal(pdfRequests[0].expectedRevision, doc.revision); assert.equal(pdfRequests[0].state, undefined);
    concurrentPdfChange = true; await child.locator('[data-path="items.0.name"]').fill('Конфликт');
    await page.getByRole('button', { name: 'Сгенерировать PDF', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(/Конфликт|конфликт/);
    assert.equal(pdfRequests.length, 1); assert.equal(pdfAttempts.length, 3); assert.equal(pdfAttempts[2].expectedRevision, 4); assert.equal(doc.revision, 5);
    assert.equal(doc.state.items[0].name, 'Конфликт'); assert.equal(doc.fx.rate, '3.25'); assert.equal(renderedPdfSnapshots.length, 1);
    const blocked = await child.locator('body').evaluate(() => JSON.parse(localStorage.getItem('pero-crm-kp:qa-actor:primary:operation:pdf')));
    assert.deepEqual(blocked.body, pdfAttempts[2]); assert.equal(requests.filter(request => request.path === '/api/kp/artifacts/pdf/download').length, 1);
    assert.equal(await page.evaluate(() => window.__refreshes), refreshes);
  } finally { await context.close(); }
});

test('locked editor disables writes while original contract form loads current structured CRM defaults', async () => {
  reset(); doc.canEdit = false; doc.project.stage = 'CONTRACT'; const { context, page, child } = await hostPage();
  try {
    assert.equal(await child.locator('[data-path="items.0.name"]').isDisabled(), true);
    assert.match(await child.locator('#crmReadOnly').innerText(), /просмотра/);
    await page.getByRole('button', { name: 'Сгенерировать договор', exact: true }).click();
    await child.locator('#contract-customer-name').waitFor(); assert.equal(await child.locator('#contract-customer-name').inputValue(), 'Клиент CRM');
    assert.equal(await child.locator('#contract-customer-name').isDisabled(), false, 'contract remains editable after proposal lock');
    assert.equal(await child.locator('[data-contract-path="customer.passport"]').inputValue(), 'Контрольный документ');
    assert.equal(writes.length, 0);
    await page.screenshot({ path: path.join(output, 'contract-form.png'), fullPage: true });
  } finally { await context.close(); }
});

test('unlinked contract form keeps immutable history reachable while draft editing is disabled', async () => {
  reset(); doc.canEdit = false; doc.project = null; const { context, page, child } = await hostPage();
  try {
    await page.getByRole('button', { name: 'Сгенерировать договор', exact: true }).click();
    await child.locator('#contract-customer-name').waitFor(); assert.equal(await child.locator('#contract-customer-name').isDisabled(), true);
    await child.getByText('Ранее выпущенные договоры · Москва', { exact: true }).click();
    const history = child.getByRole('link', { name: /contract_231_Pero\.docx/ }); await history.waitFor();
    assert.equal(await history.getAttribute('href'), '/api/kp/artifacts/docx/download');
    assert.equal(writes.length, 0);
  } finally { await context.close(); }
});

test('editable imported proposal opens without writes and missing FX is only previewed on an explicit rate action', async () => {
  reset(); doc.fx = null; doc.state.currency = '₽'; doc.client.label = 'Вручную изменённый клиент CRM';
  delete doc.state.warrantyMonths; delete doc.state.items[0].note;
  const { context, page, child } = await hostPage();
  try {
    await expect(child.locator('[data-path="items.0.name"]')).toBeEnabled();
    await expect(child.locator('[data-path="client.name"]')).toHaveValue(state.client.name);
    await page.waitForTimeout(1400);
    assert.equal(writes.length, 0); assert.equal(requests.filter(request => request.path === '/api/kp/rates').length, 0);
    await page.getByRole('button', { name: 'Сгенерировать договор', exact: true }).click();
    await child.locator('#contract-customer-name').waitFor();
    assert.equal(writes.length, 0, 'inspecting contract defaults must not save editor hydration');
    await child.getByRole('button', { name: 'Отмена', exact: true }).click();
    await child.locator('#contractModal').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Курс', exact: true }).click();
    const dialog = page.getByRole('dialog'); await expect(dialog.getByRole('heading')).toHaveText('Курс КП · RUB');
    await expect(dialog.getByLabel('BYN за единицу валюты')).toHaveValue('');
    assert.equal(writes.length, 0, 'previewing the first rate must not synchronize CRM');
    assert.equal(requests.filter(request => request.path === '/api/kp/rates').length, 0);
    await dialog.getByRole('button', { name: 'Получить НБРБ', exact: true }).click();
    await expect(dialog.getByLabel('BYN за единицу валюты')).toHaveValue('1');
    assert.equal(doc.fx, null); assert.equal(requests.filter(request => request.path === '/api/kp/rates').length, 1);
    await dialog.getByRole('button', { name: 'Сохранить курс', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
    assert.equal(writes.length, 1); assert.deepEqual(writes[0].fx, { currency: 'RUB', rate: '1', date: '2026-10-18', source: 'NBRB' });
    assert.equal(writes[0].state.client.name, state.client.name);
    await child.locator('[data-path="items.0.name"]').fill('Явная правка после фиксации курса');
    await expect.poll(() => writes.length).toBe(2);
    assert.equal(requests.filter(request => request.path === '/api/kp/rates').length, 1, 'ordinary saves retain the fixed rate');
  } finally { await context.close(); }
});

test('missing FX remains manually editable after an NBRB failure and subsequent saves keep the manual rate', async () => {
  reset(); doc.fx = null; doc.state.currency = '$'; refuseRate = true;
  const { context, page, child } = await hostPage();
  try {
    await page.getByRole('button', { name: 'Курс', exact: true }).click();
    const dialog = page.getByRole('dialog'); await expect(dialog.getByRole('heading')).toHaveText('Курс КП · USD');
    await expect(dialog.getByLabel('BYN за единицу валюты')).toHaveValue('');
    assert.equal(writes.length, 0); assert.equal(requests.filter(request => request.path === '/api/kp/rates').length, 0);
    await dialog.getByRole('button', { name: 'Получить НБРБ', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Курс НБРБ недоступен');
    assert.equal(writes.length, 0); assert.equal(doc.fx, null);
    await dialog.getByLabel('BYN за единицу валюты').fill('3.21');
    await dialog.getByRole('button', { name: 'Сохранить курс', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
    assert.equal(writes.length, 1); assert.deepEqual(writes[0].fx, { currency: 'USD', rate: '3.21', date: '2026-10-18', source: 'MANUAL' });
    await child.locator('[data-path="items.0.name"]').fill('Явная правка с ручным курсом');
    await expect.poll(() => writes.length).toBe(2);
    assert.equal(requests.filter(request => request.path === '/api/kp/rates').length, 1);
    assert.deepEqual(writes[1].fx, writes[0].fx);
  } finally { await context.close(); }
});

test('React command bridge waits beyond former PDF and save deadlines and rejects pending commands on pagehide', async () => {
  reset(); const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  try {
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    await page.clock.install({ time: new Date('2026-10-26T12:00:00Z') }); await page.goto(origin + '/host');
    await page.frameLocator('iframe').locator('[data-path="items.0.name"]').waitFor();
    await page.evaluate(() => { document.querySelector('iframe').contentWindow.postMessage = command => { window.__heldCommand = command; }; });
    const acknowledge = fx => page.evaluate(fx => {
      const frame = document.querySelector('iframe').contentWindow, command = window.__heldCommand;
      const emit = data => window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source: frame, data: { channel: 'pero-kp', ...data } }));
      if (fx) emit({ type: 'rate-preview', fx });
      emit({ type: 'command-result', requestId: command.requestId, ok: true }); window.__heldCommand = null;
    }, fx);
    const pdf = page.getByRole('button', { name: 'Сгенерировать PDF', exact: true });
    await pdf.click(); await page.clock.fastForward(181_000);
    await expect(pdf).toBeDisabled(); await expect(page.getByRole('alert')).toHaveCount(0);
    await acknowledge(); await expect(pdf).toBeEnabled();
    const contract = page.getByRole('button', { name: 'Сгенерировать договор', exact: true });
    await contract.click(); await page.clock.fastForward(46_000);
    await expect(contract).toBeDisabled(); await expect(page.getByRole('alert')).toHaveCount(0);
    await acknowledge(); await expect(contract).toBeEnabled();
    await page.getByRole('button', { name: /^Курс/ }).click(); await acknowledge(baseDoc().fx);
    const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
    await dialog.getByLabel('BYN за единицу валюты').fill('1');
    const save = dialog.getByRole('button', { name: 'Сохранить курс', exact: true });
    await save.click(); await page.clock.fastForward(46_000);
    await expect(save).toBeDisabled(); await expect(dialog.getByRole('alert')).toHaveCount(0);
    await acknowledge(); await expect(dialog).toBeHidden();
    await pdf.click(); await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await expect(page.getByRole('alert')).toContainText('Редактор закрыт'); await expect(pdf).toBeEnabled();
    assert.equal(pdfRequests.length, 0); assert.equal(writes.length, 0);
  } finally { await context.close(); }
});

test('actual React toolbar selects CRM client immediately and version bridge restores by live revision', async () => {
  reset(); const context = await browser.newContext({ viewport: { width: 1440, height: 1200 }, serviceWorkers: 'block' });
  try {
    const page = await context.newPage(); page.setDefaultTimeout(10000); await page.goto(origin + '/host');
    const child = page.frameLocator('iframe'); await child.locator('[data-path="items.0.name"]').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Изменить клиента', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Новый клиент', exact: true }).count(), 0);
    assert.equal(await child.locator('.topbar').count(), 0);
    assert.equal(await child.getByRole('button', { name: /^Сгенерировать/ }).count(), 0);
    await page.locator('#kp-client').click();
    await page.getByRole('button', { name: 'Новый заказчик', exact: true }).click();
    await expect(child.locator('[data-path="client.name"]')).toHaveValue('Новый заказчик');
    await expect(page.locator('#kp-client')).toBeEnabled();
    assert.equal(writes.at(-1).state.client.crmSnapshot.name, 'Новый заказчик');
    assert.equal(writes.at(-1).state.client.crmSnapshot.passportNumber, 'обновлённый номер');
    assert.deepEqual(writes.at(-1).state.client.crmSnapshot, selectedClient().snapshot);
    assert.deepEqual(writes.at(-1).state.delivery.items, state.delivery.items, 'saving preserves existing crmKind metadata without controls');
    assert.equal(writes.at(-1).clientId, 'selected-client');
    assert.equal(await child.locator('[data-path="client.contact"]').inputValue(), '+001');
    assert.match(await page.locator('#kp-client').innerText(), /Новый заказчик/);
    assert.equal(await child.locator('[data-path="items.0.name"]').isDisabled(), false);
    await child.locator('select[data-path="currency"]').selectOption('$');
    await page.getByRole('button', { name: /^Курс/ }).click();
    const rateDialog = page.getByRole('dialog'); await expect(rateDialog.getByRole('heading')).toHaveText('Курс КП · USD');
    await rateDialog.getByLabel('BYN за единицу валюты').fill('3.2');
    await rateDialog.getByRole('button', { name: 'Сохранить курс', exact: true }).click(); await rateDialog.waitFor({ state: 'hidden' });
    assert.deepEqual(writes.at(-1).fx, { currency: 'USD', rate: '3.2', date: '2026-10-18', source: 'MANUAL' });
    assert.equal(requests.filter(request => request.path === '/api/kp/rates').length, 0, 'manual selection and ordinary saves do not require NBRB');
    const priorWrites = writes.length;
    await page.getByRole('button', { name: 'Сгенерировать договор', exact: true }).click();
    await child.locator('#contract-customer-name').waitFor();
    assert.equal(await child.locator('#contract-customer-name').inputValue(), 'Новый заказчик');
    assert.equal(await child.locator('[data-contract-path="customer.passport"]').inputValue(), 'обновлённый номер, другой орган');
    assert.equal(await page.locator('#kp-client').isDisabled(), true);
    assert.equal(writes.length, priorWrites, 'opening a contract never re-applies a clean old proposal over fresh CRM client fields');
    await child.getByRole('button', { name: 'Отмена', exact: true }).click();
    await child.locator('#contractModal').waitFor({ state: 'hidden' });
    await page.locator('#kp-version').click(); await page.getByRole('button', { name: /18\.10\..*PDF/ }).click();
    await child.locator('[data-path="order.project"]').waitFor();
    await expect(child.locator('[data-path="order.project"]')).toHaveValue('Старая версия');
    assert.equal(await child.locator('[data-path="items.0.name"]').isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Сгенерировать договор', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Сгенерировать PDF', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Восстановить', exact: true }).click();
    await page.getByRole('button', { name: 'Восстановить', exact: true }).waitFor({ state: 'hidden' });
    assert.equal(await child.locator('[data-path="items.0.name"]').isDisabled(), false);
    assert.equal(await page.getByRole('button', { name: 'Сгенерировать договор', exact: true }).isDisabled(), false);
    assert.equal(doc.state.order.project, 'Старая версия');
    await expect(page.locator('#kp-client')).toBeEnabled();
    await page.screenshot({ path: path.join(output, 'crm-toolbar-desktop.png'), fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 390, height: 844 });
    await child.locator('[data-view="sheet"]').click();
    await child.locator('#scale').evaluate(async element => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})));
    });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: path.join(output, 'crm-toolbar-mobile.png'), fullPage: true, animations: 'disabled' });
  } finally { await context.close(); }
});

test('all PDF pages match the frozen original template and retained-PDF rasterization keeps order', async () => {
  const launch = () => puppeteer.launch({ executablePath: chromium.executablePath(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'] });
  const input = { kind: 'bundle', proposalId: 'primary', revision: 2, templateHash: template.getKpTemplateIdentity().templateHash,
    state: copy(state), assets: [{ mediaId: 'photo', mimeType: 'image/png', bytesBase64: image.toString('base64') }] };
  const priorExecutable = process.env.PERO_KP_CHROMIUM_PATH;
  let actual;
  try { process.env.PERO_KP_CHROMIUM_PATH = chromium.executablePath(); actual = await isolatedWorker(input); }
  finally { if (priorExecutable === undefined) delete process.env.PERO_KP_CHROMIUM_PATH; else process.env.PERO_KP_CHROMIUM_PATH = priorExecutable; }
  const actualBytes = Buffer.from(actual.bytesBase64, 'base64');
  await writeFile(path.join(output, 'ported.pdf'), actualBytes);
  const oldState = copy(state); for (const item of oldState.items) for (const field of ['image', 'image2']) if (item[field]) item[field] = 'data:image/png;base64,' + image.toString('base64');
  const original = await launch(); let originalBytes; const originalImages = [];
  try {
    const page = await original.newPage(); await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1 }); await page.emulateMediaType('print');
    const html = originalSheet.buildFullHTML(originalSheet.normalizeState(oldState)).replace(/<link[^>]+href="https:\/\/fonts\.(?:googleapis|gstatic)\.com[^>]*>/g, '').replace('<style>', '<style>' + template.fontCss('data'));
    await page.setContent(html, { waitUntil: 'networkidle0' }); await page.evaluate(() => document.fonts.ready); await page.evaluate(() => Promise.all(Array.from(document.images).map(image => image.decode())));
    originalBytes = Buffer.from(await page.pdf({ format: 'A4', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 }, preferCSSPageSize: true }));
    const screenshotPage = await original.newPage();
    await screenshotPage.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 }); await screenshotPage.emulateMediaType('print');
    await screenshotPage.setContent(html, { waitUntil: 'networkidle0' }); await screenshotPage.evaluate(() => document.fonts.ready);
    await screenshotPage.evaluate(() => Promise.all(Array.from(document.images).map(image => image.decode())));
    for (const element of await screenshotPage.$$('.page')) originalImages.push(Buffer.from(await element.screenshot({ type: 'png' })));
  } finally { await original.close(); }
  await writeFile(path.join(output, 'original.pdf'), originalBytes);
  const [ported, frozen] = await Promise.all([renderer.rasterizePdf({ kind: 'rasterize', pdfBase64: actualBytes.toString('base64') }), renderer.rasterizePdf({ kind: 'rasterize', pdfBase64: originalBytes.toString('base64') })]);
  assert.ok(ported.pageCount >= 4); assert.equal(ported.pageCount, frozen.pageCount); assert.equal(actual.pageCount, ported.pageCount);
  assert.equal(actual.pagesBase64.length, originalImages.length);
  for (let index = 0; index < ported.pageCount; index++) {
    const actualPng = Buffer.from(ported.pagesBase64[index], 'base64'), baselinePng = Buffer.from(frozen.pagesBase64[index], 'base64');
    const [actualPixels, expectedPixels] = await Promise.all([sharp(actualPng).raw().toBuffer(), sharp(baselinePng).raw().toBuffer()]);
    assert.deepEqual(actualPixels, expectedPixels, 'page ' + (index + 1));
    const actualScreenshot = Buffer.from(actual.pagesBase64[index], 'base64');
    const [actualShotPixels, originalShotPixels] = await Promise.all([sharp(actualScreenshot).raw().toBuffer(), sharp(originalImages[index]).raw().toBuffer()]);
    assert.deepEqual(actualShotPixels, originalShotPixels, 'original DPR2 appendix ' + (index + 1));
    await writeFile(path.join(output, 'page-' + (index + 1) + '.png'), actualPng);
    await writeFile(path.join(output, 'appendix-' + (index + 1) + '.png'), actualScreenshot);
  }
  await writeFile(path.join(output, 'receipt.json'), JSON.stringify({ browser: browser.version(), template: template.getKpTemplateIdentity(), allPagesIdentical: true, originalDpr2AppendicesIdentical: true, pages: ported.pageCount,
    sourceManifestHash: template.getKpTemplateIdentity().sourceManifestHash, staging: 'NOT_RUN', container: 'NOT_RUN' }, null, 2));
  console.log(JSON.stringify({ status: 'KP_EDITOR_COMPONENT_AND_PDF', pages: ported.pageCount, output, staging: 'NOT_RUN' }));
});
