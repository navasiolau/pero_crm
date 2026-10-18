'use strict';
// Исполняется только внутри испытанного OCI: никаких DB/S3, внешней сети или override браузера.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const path = require('node:path');
const { once } = require('node:events');
const template = require('@pero/kp-template');
const { createRendererServer } = require('../server.cjs');
const { validateRenderInput } = require('../validation.cjs');
const originalRoot = path.join(path.dirname(require.resolve('@pero/kp-template')), 'test/original');
const originalSheet = require(path.join(originalRoot, 'sheet-render.js'));
const JSZip = createRequire(createRequire(require.resolve('@pero/kp-template')).resolve('docx'))('jszip');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWM4tKTxPwgzwBgAZ0ILmdrs+PUAAAAASUVORK5CYII=', 'base64');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function main() {
  assert.equal(process.platform, 'linux'); assert.match(process.versions.node, /^22\./);
  assert.match(process.env.PERO_KP_CI_REVISION || '', /^[a-f0-9]{40}$/); assert.ok(!process.env.PERO_KP_CHROMIUM_PATH);
  assert.equal(hash(readFileSync(path.join(originalRoot, 'sheet-render.js'))), template.sourceManifest.files['public/js/sheet-render.js'].sha256);
  const identity = template.getKpTemplateIdentity();
  const chromium = require('@sparticuz/chromium'), puppeteer = require('puppeteer-core');
  const chromiumVersion = JSON.parse(readFileSync(path.resolve(path.dirname(require.resolve('@sparticuz/chromium')), '../../package.json'), 'utf8')).version;
  assert.equal(chromiumVersion, identity.chromium); assert.equal(require('puppeteer-core/package.json').version, identity.puppeteer);
  const state = { order: { number: '231', date: '18.10.2026', project: 'Контрольная меблировка' }, client: { name: 'Синтетический клиент' },
    currency: 'BYN', discount: 10, discountMode: 'percent', delivery: { visible: true, mode: 'items', items: [{ name: 'Доставка', price: 30, crmKind: 'DELIVERY' }] },
    items: Array.from({ length: 4 }, (_, index) => ({ id: 'item-' + index, name: 'Шкаф ' + index, price: 100.75 + 100 * index, qty: index + 1,
      description: 'Длинное описание изделия и материалов. '.repeat(index === 2 ? 15 : 4), size: '2400 × 2200 × 600', image: 'kp-media:photo', image2: index === 2 ? 'kp-media:photo' : '', dbl: index === 2,
      note: 'Примечание', products: [{ title: 'Каркас и фасад', outer: 'ЛДСП', inner: 'Белый', hinges: 'Петли', drawers: 'Ящики' }] })) };
  const request = { kind: 'bundle', proposalId: 'primary', revision: 1, state, templateHash: identity.templateHash,
    assets: [{ mediaId: 'photo', mimeType: 'image/png', bytesBase64: png.toString('base64') }] };
  const secret = 'SYNTHETIC_ISOLATED_CI_RENDERER_ONLY_184', server = createRendererServer({ secret });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = 'http://127.0.0.1:' + server.address().port + '/v1/render';
  const post = async input => {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-pero-renderer-key': secret, 'x-pero-renderer-kind': input.kind }, body: JSON.stringify(input) });
    assert.equal(response.status, 200); return response.json();
  };
  try {
    assert.equal((await fetch(url, { method: 'POST' })).status, 401);
    const actual = await post(request); assert.ok(actual.pageCount >= 4); assert.equal(actual.templateHash, identity.templateHash);
    const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
    let browserVersion, baselinePdf; const baselinePngs = [];
    try {
      browserVersion = await browser.version(); assert.match(browserVersion, /^(?:HeadlessChrome|Chrome|Chromium)\/141\./);
      const old = structuredClone(state);
      for (const item of old.items) for (const field of ['image', 'image2']) if (item[field]) item[field] = 'data:image/png;base64,' + png.toString('base64');
      const html = originalSheet.buildFullHTML(originalSheet.normalizeState(old)).replace(/<link[^>]+href="https:\/\/fonts\.(?:googleapis|gstatic)\.com[^>]*>/g, '').replace('<style>', '<style>' + template.fontCss('data'));
      for (const dpr of [1, 2]) {
        const page = await browser.newPage(); await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: dpr }); await page.emulateMediaType('print');
        await page.setContent(html, { waitUntil: 'networkidle0' }); await page.evaluate(() => document.fonts.ready);
        await page.evaluate(() => Promise.all(Array.from(document.images).map(image => image.decode())));
        if (dpr === 1) baselinePdf = Buffer.from(await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } }));
        else for (const element of await page.$$('.page')) baselinePngs.push(Buffer.from(await element.screenshot({ type: 'png' })));
        await page.close();
      }
    } finally { await browser.close(); }
    const actualRaster = await post({ kind: 'rasterize', pdfBase64: actual.bytesBase64 });
    const baselineRaster = await post({ kind: 'rasterize', pdfBase64: baselinePdf.toString('base64') });
    assert.equal(actualRaster.pageCount, actual.pageCount); assert.deepEqual(actualRaster.pagesBase64, baselineRaster.pagesBase64);
    assert.equal(baselinePngs.length, actual.pageCount);
    for (let index = 0; index < baselinePngs.length; index++) assert.deepEqual(Buffer.from(actual.pagesBase64[index], 'base64'), baselinePngs[index]);
    const settings = template.ContractModel.defaults(state, 'primary', new Date('2026-10-18T09:00:00Z')); settings.deliveryAddress = 'Контрольный адрес'; settings.proposalIds.push('secondary');
    const sources = [{ id: 'primary', state }, { id: 'secondary', state: { ...state, order: { ...state.order, number: '232' } } }];
    const profile = { id: 'pero-by', name: 'Контрольный исполнитель', positionGenitive: 'директора', directorGenitive: 'Проверки', authority: 'Устава', country: 'BY',
      address: 'Контрольный адрес', taxId: '000', bankDetails: 'Контрольные реквизиты', email: 'fixture@example.invalid', phones: ['+000'], site: 'example.invalid', signature: 'Проверка' };
    const checked = template.ContractModel.validate(settings, sources, [profile]); assert.deepEqual(checked.errors, []);
    const docxInput = { kind: 'docx', settings, summary: checked.summary, profile, templateHash: identity.templateHash,
      rendered: sources.map(source => ({ id: source.id, imagesBase64: actual.pagesBase64 })) };
    const originalDocx = await template.generateDocx(settings, checked.summary, profile, docxInput.rendered.map(source => ({ id: source.id, images: source.imagesBase64.map(page => Buffer.from(page, 'base64')) })));
    const docx = await post(docxInput); assert.equal(docx.pageCount, actual.pageCount * 2);
    const [zip, originalZip] = await Promise.all([JSZip.loadAsync(Buffer.from(docx.bytesBase64, 'base64')), JSZip.loadAsync(originalDocx)]);
    assert.deepEqual(Object.keys(zip.files).sort(), Object.keys(originalZip.files).sort());
    for (const name of Object.keys(originalZip.files)) if (!originalZip.files[name].dir) assert.deepEqual(await zip.files[name].async('nodebuffer'), await originalZip.files[name].async('nodebuffer'));
    const generous = { ...docxInput, rendered: [{ id: 'primary', imagesBase64: Array(999).fill(png.toString('base64')) }, { id: 'secondary', imagesBase64: [png.toString('base64')] }] };
    assert.doesNotThrow(() => validateRenderInput(generous)); generous.rendered[0].imagesBase64.push(png.toString('base64'));
    assert.throws(() => validateRenderInput(generous), /PAGE_LIMIT/);
    assert.throws(() => validateRenderInput({ ...request, state: { ...state, items: [{ image: 'https://example.invalid/blocked.png' }] } }), /REFERENCE_INVALID/);
    return { revision: process.env.PERO_KP_CI_REVISION, template: identity,
      runtime: { node: process.versions.node, browser: browserVersion, chromium: chromiumVersion, puppeteer: require('puppeteer-core/package.json').version },
      pages: actual.pageCount, allPagesIdentical: true, originalDpr2AppendicesIdentical: true, docxEntriesIdentical: true,
      privateHttp: true, limitsVerified: true, pdfPagesSha256: actualRaster.pagesBase64.map(page => hash(Buffer.from(page, 'base64'))),
      appendixSha256: actual.pagesBase64.map(page => hash(Buffer.from(page, 'base64'))) };
  } finally { await new Promise(resolve => server.close(resolve)); }
}
const timer = setTimeout(() => { console.error('KP_CI_SMOKE_TIMEOUT'); process.exit(1); }, 150_000);
main().then(result => { clearTimeout(timer); console.log(JSON.stringify(result)); }, () => { clearTimeout(timer); console.error('KP_CI_SMOKE_FAILED'); process.exitCode = 1; });
