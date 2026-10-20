'use strict';
// Исполняется только внутри испытанного OCI: никаких DB/S3, внешней сети или override браузера.
const assert = require('node:assert/strict');
const { readFileSync, statSync, accessSync, constants } = require('node:fs');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const path = require('node:path');
const { once } = require('node:events');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWM4tKTxPwgzwBgAZ0ILmdrs+PUAAAAASUVORK5CYII=', 'base64');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function chromiumMountFacts(mountinfo, fileMode) {
  const row = mountinfo.split('\n').map(line => line.split(' ')).find(fields => fields[4] === '/tmp');
  const flags = new Set(row?.[5]?.split(',') ?? []), separator = row?.indexOf('-') ?? -1;
  return { filesystem: !row ? 'missing' : separator >= 0 && row[separator + 1] === 'tmpfs' ? 'tmpfs' : 'other',
    flags: [flags.has('rw') ? 'rw' : 'ro', flags.has('nosuid') ? 'nosuid' : 'suid', flags.has('nodev') ? 'nodev' : 'dev', flags.has('noexec') ? 'noexec' : 'exec'],
    fileMode: '0' + (fileMode & 0o777).toString(8).padStart(3, '0') };
}

// Не сериализуем Error/message/stack: AssertionError может содержать весь PDF/PNG.
function failureDetails(error) {
  const text = typeof error?.message === 'string' ? error.message.slice(0, 16_384) : '';
  const result = { name: ['Error', 'AssertionError', 'TypeError', 'RangeError', 'SyntaxError', 'TimeoutError'].includes(error?.name) ? error.name : 'Error' };
  const code = /^(?:ERR_[A-Z_]+|E[A-Z0-9_]{1,32}|KP_[A-Z_]{1,64})$/.test(error?.code ?? '') ? error.code : /^CI_TARGET_REFUSED:[a-zA-Z0-9_.:-]+$/.test(text) ? text : undefined;
  if (code) result.code = code;
  if (/^SIG[A-Z0-9]{1,16}$/.test(error?.signal ?? '')) result.signal = error.signal;
  if (Number.isInteger(error?.status)) result.exitStatus = error.status;
  if (Number.isInteger(error?.httpStatus) && error.httpStatus >= 100 && error.httpStatus <= 599) result.httpStatus = error.httpStatus;
  if (/^KP_RENDER_[A-Z_]{1,64}$/.test(error?.rendererCode ?? '')) result.rendererCode = error.rendererCode;
  const native = [];
  for (const [pattern, hint] of [
    [/Failed to launch the browser/i, 'BROWSER_LAUNCH_FAILED'],
    [/No usable sandbox|Running as root without --no-sandbox/i, 'SANDBOX_UNAVAILABLE'],
    [/pthread_create.*(?:Resource temporarily unavailable|\b11\b)/i, 'THREAD_RESOURCE_UNAVAILABLE'],
    [/No space left on device|\bENOSPC\b/i, 'NO_SPACE_LEFT'],
    [/Permission denied|\bEACCES\b/i, 'PERMISSION_DENIED'],
    [/out of memory|cannot allocate memory|\bENOMEM\b/i, 'OUT_OF_MEMORY'],
    [/Received signal|Trace\/breakpoint trap/i, 'BROWSER_SIGNAL'],
  ]) if (pattern.test(text)) native.push(hint);
  const library = /\b([A-Za-z0-9_.+-]{1,80}\.so(?:\.\d+)*)[: ]+cannot open shared object file/.exec(text)?.[1];
  if (library) { native.push('SHARED_LIBRARY_MISSING'); result.library = library; }
  for (const hint of Array.isArray(error?.native) ? error.native : []) if (['BROWSER_LAUNCH_FAILED', 'SANDBOX_UNAVAILABLE', 'THREAD_RESOURCE_UNAVAILABLE', 'NO_SPACE_LEFT', 'PERMISSION_DENIED', 'OUT_OF_MEMORY', 'BROWSER_SIGNAL', 'SHARED_LIBRARY_MISSING'].includes(hint) && !native.includes(hint)) native.push(hint);
  if (native.length) result.native = native;
  if (!result.library && /^[A-Za-z0-9_.+-]{1,80}\.so(?:\.\d+)*$/.test(error?.library ?? '')) result.library = error.library;
  const missing = /Cannot find module '([^']+)'/.exec(text)?.[1];
  if (/^(?:@pero\/kp-template|@sparticuz\/chromium|puppeteer-core|docx|jszip)(?:\/[A-Za-z0-9_./-]+)?$/.test(missing ?? '')) result.missingModule = missing;
  else if (/^(?:@pero\/kp-template|@sparticuz\/chromium|puppeteer-core|docx|jszip)(?:\/[A-Za-z0-9_./-]+)?$/.test(error?.missingModule ?? '')) result.missingModule = error.missingModule;
  return result;
}
function logSummary(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : '');
  const text = bytes.subarray(Math.max(0, bytes.length - 65_536)).toString('utf8'), events = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.length > 2048) continue;
    try {
      const entry = JSON.parse(line);
      if (!/^[a-z][a-z0-9:-]{0,63}$/.test(entry.phase ?? '')) continue;
      if (entry.event === 'KP_CI_PHASE') events.push({ event: entry.event, phase: entry.phase });
      if (entry.event === 'KP_CI_FAILURE') events.push({ event: entry.event, phase: entry.phase, error: failureDetails(entry.error) });
    } catch { /* Непроверенный текст не попадает в CI artifact. */ }
  }
  return { bytes: bytes.length, sha256: hash(bytes), truncated: bytes.length > 65_536, events: events.slice(-64), native: failureDetails({ message: text }) };
}
function createDiagnostics(write = value => console.error(JSON.stringify(value))) {
  let current = 'startup';
  return {
    phase(value) { assert.match(value, /^[a-z][a-z0-9:-]{0,63}$/); current = value; write({ event: 'KP_CI_PHASE', phase: current }); },
    failure(error) { const value = { event: 'KP_CI_FAILURE', phase: current, error: failureDetails(error) }; write(value); return value; },
  };
}
async function rendererHttpError(response) {
  const reader = response.body?.getReader(); let text = '', bytes = 0;
  try {
    while (reader && bytes <= 4096) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength; if (bytes <= 4096) text += Buffer.from(chunk.value).toString('utf8');
    }
  } finally { await reader?.cancel(); }
  let rendererCode;
  if (bytes <= 4096) { try { const value = JSON.parse(text)?.error; if (/^KP_RENDER_[A-Z_]{1,64}$/.test(value)) rendererCode = value; } catch { /* Только код из ограниченного JSON. */ } }
  return Object.assign(new Error('KP_CI_HTTP_FAILURE'), { code: 'KP_CI_HTTP_FAILURE', httpStatus: response.status, rendererCode });
}
async function main(diagnostics) {
  diagnostics.phase('runtime-guards');
  assert.equal(process.platform, 'linux'); assert.match(process.versions.node, /^22\./);
  assert.match(process.env.PERO_KP_CI_REVISION || '', /^[a-f0-9]{40}$/); assert.ok(!process.env.PERO_KP_CHROMIUM_PATH);
  diagnostics.phase('modules:template'); const template = require('@pero/kp-template');
  diagnostics.phase('modules:server'); const { createRendererServer } = require('../server.cjs'), { validateRenderInput } = require('../validation.cjs');
  diagnostics.phase('modules:original');
  const originalRoot = path.join(path.dirname(require.resolve('@pero/kp-template')), 'test/original');
  const originalSheet = require(path.join(originalRoot, 'sheet-render.js'));
  const JSZip = createRequire(createRequire(require.resolve('@pero/kp-template')).resolve('docx'))('jszip');
  diagnostics.phase('runtime-pins');
  assert.equal(hash(readFileSync(path.join(originalRoot, 'sheet-render.js'))), template.sourceManifest.files['public/js/sheet-render.js'].sha256);
  const identity = template.getKpTemplateIdentity();
  const chromium = require('@sparticuz/chromium'), puppeteer = require('puppeteer-core');
  const chromiumVersion = JSON.parse(readFileSync(path.resolve(path.dirname(require.resolve('@sparticuz/chromium')), '../../package.json'), 'utf8')).version;
  assert.equal(chromiumVersion, identity.chromium); assert.equal(require('puppeteer-core/package.json').version, identity.puppeteer);
  diagnostics.phase('chromium-executable'); const executablePath = await chromium.executablePath();
  const executable = statSync(executablePath), mount = chromiumMountFacts(readFileSync('/proc/self/mountinfo', 'utf8'), executable.mode);
  diagnostics.phase(['chromium', mount.filesystem, ...mount.flags, 'mode', mount.fileMode].join('-'));
  assert.equal(mount.filesystem, 'tmpfs'); assert.ok(!mount.flags.includes('noexec')); assert.ok(executable.isFile());
  diagnostics.phase('chromium-access'); accessSync(executablePath, constants.X_OK);
  diagnostics.phase('chromium-launch');
  const preflight = await puppeteer.launch({ executablePath, args: chromium.args, headless: true });
  let browserVersion;
  try { diagnostics.phase('chromium-version'); browserVersion = await preflight.version(); assert.match(browserVersion, /^(?:HeadlessChrome|Chrome|Chromium)\/141\./); }
  finally { diagnostics.phase('chromium-close'); await preflight.close(); }
  const state = { order: { number: '231', date: '18.10.2026', project: 'Контрольная меблировка' }, client: { name: 'Синтетический клиент' },
    currency: 'BYN', discount: 10, discountMode: 'percent', delivery: { visible: true, mode: 'items', items: [{ name: 'Доставка', price: 30, crmKind: 'DELIVERY' }] },
    items: Array.from({ length: 4 }, (_, index) => ({ id: 'item-' + index, name: 'Шкаф ' + index, price: 100.75 + 100 * index, qty: index + 1,
      description: 'Длинное описание изделия и материалов. '.repeat(index === 2 ? 15 : 4), size: '2400 × 2200 × 600', image: 'kp-media:photo', image2: index === 2 ? 'kp-media:photo' : '', dbl: index === 2,
      note: 'Примечание', products: [{ title: 'Каркас и фасад', outer: 'ЛДСП', inner: 'Белый', hinges: 'Петли', drawers: 'Ящики' }] })) };
  const request = { kind: 'bundle', proposalId: 'primary', revision: 1, state, templateHash: identity.templateHash,
    assets: [{ mediaId: 'photo', mimeType: 'image/png', bytesBase64: png.toString('base64') }] };
  const secret = 'SYNTHETIC_ISOLATED_CI_RENDERER_ONLY_184', server = createRendererServer({ secret });
  diagnostics.phase('http-listen');
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = 'http://127.0.0.1:' + server.address().port + '/v1/render';
  const post = async input => {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-pero-renderer-key': secret, 'x-pero-renderer-kind': input.kind }, body: JSON.stringify(input) });
    if (response.status !== 200) throw await rendererHttpError(response);
    return response.json();
  };
  try {
    diagnostics.phase('http-auth'); assert.equal((await fetch(url, { method: 'POST' })).status, 401);
    diagnostics.phase('http-bundle');
    const actual = await post(request); assert.ok(actual.pageCount >= 4); assert.equal(actual.templateHash, identity.templateHash);
    diagnostics.phase('baseline-launch');
    const browser = await puppeteer.launch({ executablePath, args: chromium.args, headless: true });
    let baselinePdf; const baselinePngs = [];
    try {
      browserVersion = await browser.version(); assert.match(browserVersion, /^(?:HeadlessChrome|Chrome|Chromium)\/141\./);
      const old = structuredClone(state);
      for (const item of old.items) for (const field of ['image', 'image2']) if (item[field]) item[field] = 'data:image/png;base64,' + png.toString('base64');
      const html = originalSheet.buildFullHTML(originalSheet.normalizeState(old)).replace(/<link[^>]+href="https:\/\/fonts\.(?:googleapis|gstatic)\.com[^>]*>/g, '').replace('<style>', '<style>' + template.fontCss('data'));
      for (const dpr of [1, 2]) {
        diagnostics.phase('baseline-render-dpr-' + dpr);
        const page = await browser.newPage(); await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: dpr }); await page.emulateMediaType('print');
        await page.setContent(html, { waitUntil: 'networkidle0' }); await page.evaluate(() => document.fonts.ready);
        await page.evaluate(() => Promise.all(Array.from(document.images).map(image => image.decode())));
        if (dpr === 1) baselinePdf = Buffer.from(await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } }));
        else for (const element of await page.$$('.page')) baselinePngs.push(Buffer.from(await element.screenshot({ type: 'png' })));
        await page.close();
      }
    } finally { await browser.close(); }
    diagnostics.phase('http-raster-actual'); const actualRaster = await post({ kind: 'rasterize', pdfBase64: actual.bytesBase64 });
    diagnostics.phase('http-raster-original');
    const baselineRaster = await post({ kind: 'rasterize', pdfBase64: baselinePdf.toString('base64') });
    diagnostics.phase('compare-all-pages');
    assert.equal(actualRaster.pageCount, actual.pageCount);
    assert.equal(actualRaster.pagesBase64.length, baselineRaster.pagesBase64.length);
    // Не передаём PNG/base64 в AssertionError: подробный diff сам требует много памяти.
    for (let index = 0; index < actualRaster.pagesBase64.length; index++)
      assert.equal(actualRaster.pagesBase64[index] === baselineRaster.pagesBase64[index], true, 'KP_CI_RASTER_PAGE_' + index);
    assert.equal(baselinePngs.length, actual.pageCount);
    for (let index = 0; index < baselinePngs.length; index++)
      assert.equal(Buffer.from(actual.pagesBase64[index], 'base64').equals(baselinePngs[index]), true, 'KP_CI_PNG_PAGE_' + index);
    const settings = template.ContractModel.defaults(state, 'primary', new Date('2026-10-18T09:00:00Z')); settings.deliveryAddress = 'Контрольный адрес'; settings.proposalIds.push('secondary');
    const sources = [{ id: 'primary', state }, { id: 'secondary', state: { ...state, order: { ...state.order, number: '232' } } }];
    const profile = { id: 'pero-by', name: 'Контрольный исполнитель', positionGenitive: 'директора', directorGenitive: 'Проверки', authority: 'Устава', country: 'BY',
      address: 'Контрольный адрес', taxId: '000', bankDetails: 'Контрольные реквизиты', email: 'fixture@example.invalid', phones: ['+000'], site: 'example.invalid', signature: 'Проверка' };
    const checked = template.ContractModel.validate(settings, sources, [profile]); assert.deepEqual(checked.errors, []);
    const docxInput = { kind: 'docx', settings, summary: checked.summary, profile, templateHash: identity.templateHash,
      rendered: sources.map(source => ({ id: source.id, imagesBase64: actual.pagesBase64 })) };
    diagnostics.phase('original-docx'); const originalDocx = await template.generateDocx(settings, checked.summary, profile, docxInput.rendered.map(source => ({ id: source.id, images: source.imagesBase64.map(page => Buffer.from(page, 'base64')) })));
    diagnostics.phase('http-docx'); const docx = await post(docxInput); assert.equal(docx.pageCount, actual.pageCount * 2);
    diagnostics.phase('compare-docx-entries');
    const [zip, originalZip] = await Promise.all([JSZip.loadAsync(Buffer.from(docx.bytesBase64, 'base64')), JSZip.loadAsync(originalDocx)]);
    assert.deepEqual(Object.keys(zip.files).sort(), Object.keys(originalZip.files).sort());
    for (const name of Object.keys(originalZip.files)) if (!originalZip.files[name].dir) assert.deepEqual(await zip.files[name].async('nodebuffer'), await originalZip.files[name].async('nodebuffer'));
    diagnostics.phase('limits'); const generous = { ...docxInput, rendered: [{ id: 'primary', imagesBase64: Array(999).fill(png.toString('base64')) }, { id: 'secondary', imagesBase64: [png.toString('base64')] }] };
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
module.exports = { chromiumMountFacts, createDiagnostics, failureDetails, logSummary, rendererHttpError };
if (require.main === module) {
  const diagnostics = createDiagnostics();
  const timer = setTimeout(() => { diagnostics.failure(Object.assign(new Error(), { code: 'KP_CI_SMOKE_TIMEOUT' })); process.exit(1); }, 150_000);
  main(diagnostics).then(result => { clearTimeout(timer); console.log(JSON.stringify(result)); }, error => { clearTimeout(timer); diagnostics.failure(error); process.exitCode = 1; });
}
