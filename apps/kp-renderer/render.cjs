'use strict';
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { pathToFileURL } = require('node:url');
const { SheetRender, offlinePrintHTML, getKpTemplateIdentity, generateDocx } = require('@pero/kp-template');
const { validateRenderInput, prepareRenderState, boundedBase64, LIMITS } = require('./validation.cjs');
const { readSpoolManifest, writePdfStream, workingDirectory } = require('./pdf-stream.cjs');
const execute = promisify(execFile);

async function renderPdf(input, launch) {
  const request = validateRenderInput(input), state = SheetRender.normalizeState(prepareRenderState(request));
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1 });
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    let blocked = false;
    page.on('request', request => {
      if (request.url().startsWith('data:') || request.url() === 'about:blank') void request.continue();
      else { blocked = true; void request.abort('blockedbyclient'); }
    });
    await page.emulateMediaType('print');
    await page.setContent(offlinePrintHTML(state), { waitUntil: 'networkidle0', timeout: 0 });
    await page.evaluate(() => document.fonts.ready);
    const failed = await page.evaluate(async () => {
      await Promise.all(Array.from(document.images).map(image => image.decode().catch(() => {})));
      return Array.from(document.images).filter(image => !image.complete || image.naturalWidth === 0).length;
    });
    if (blocked) throw Error('KP_RENDER_NETWORK_BLOCKED');
    if (failed) throw Error('KP_RENDER_IMAGE_DECODE_FAILED');
    const pageCount = await page.$$eval('.page', pages => pages.length);
    if (!Number.isSafeInteger(pageCount) || pageCount < 1) throw Error('KP_RENDER_PAGE_LIMIT');
    const bytes = Buffer.from(await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 }, waitForFonts: true, timeout: 0 }));
    if (bytes.length > LIMITS.pdfBytes) throw Error('KP_RENDER_BYTES_LIMIT');
    if (request.kind === 'bundle') {
      // Прежний PDF использовал DPR1; приложения договора — screenshot DPR2.
      // Снимок и context общие, повторной загрузки/рендера HTML нет.
      await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });
      await page.evaluate(() => document.fonts.ready);
      const elements = await page.$$('.page'), pagesBase64 = []; let total = bytes.length;
      for (const element of elements) {
        const image = Buffer.from(await element.screenshot({ type: 'png' })); total += image.length;
        if (image.length > LIMITS.assetBytes || total > LIMITS.totalAssetBytes) throw Error('KP_RENDER_BYTES_LIMIT');
        pagesBase64.push(image.toString('base64'));
      }
      if (pagesBase64.length !== pageCount) throw Error('KP_RENDER_PAGE_LIMIT');
      return { kind: 'bundle', bytesBase64: bytes.toString('base64'), pagesBase64, pageCount, templateHash: getKpTemplateIdentity().templateHash };
    }
    return { kind: 'pdf', bytesBase64: bytes.toString('base64'), pageCount, templateHash: getKpTemplateIdentity().templateHash };
  } finally { await browser.close(); }
}

/** Основной PDF-путь читает assets из закрытого spool и не переносит PDF через base64/IPC. */
async function renderPdfFile(input, launch, { spoolRoot } = {}) {
  const { manifest, state: source, files, spool } = await readSpoolManifest(input.spoolDirectory, spoolRoot);
  const state = SheetRender.normalizeState(source), htmlFile = path.join(spool.directory, 'document.html');
  await fs.writeFile(htmlFile, offlinePrintHTML(state), { flag: 'wx', mode: 0o600 });
  const htmlUrl = pathToFileURL(htmlFile).href, allowed = new Set([htmlUrl, ...files.map(file => pathToFileURL(file).href)]);
  const browser = await launch({ spoolDirectory: spool.directory });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1 });
    await page.setJavaScriptEnabled(false); await page.setRequestInterception(true);
    let blocked = false;
    page.on('request', request => {
      if (allowed.has(request.url()) || request.url().startsWith('data:') || request.url() === 'about:blank') void request.continue();
      else { blocked = true; void request.abort('blockedbyclient'); }
    });
    await page.emulateMediaType('print');
    await page.goto(htmlUrl, { waitUntil: 'networkidle0', timeout: 0 });
    await page.evaluate(() => document.fonts.ready);
    const failed = await page.evaluate(async () => {
      await Promise.all(Array.from(document.images).map(image => image.decode().catch(() => {})));
      return Array.from(document.images).filter(image => !image.complete || image.naturalWidth === 0).length;
    });
    if (blocked) throw Error('KP_RENDER_NETWORK_BLOCKED');
    if (failed) throw Error('KP_RENDER_IMAGE_DECODE_FAILED');
    const pageCount = await page.$$eval('.page', pages => pages.length);
    if (!Number.isSafeInteger(pageCount) || pageCount < 1) throw Error('KP_RENDER_PAGE_LIMIT');
    const stream = await page.createPDFStream({ format: 'A4', printBackground: true, preferCSSPageSize: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 }, waitForFonts: true, timeout: 0 });
    return { ...await writePdfStream(spool, stream), pageCount, templateHash: manifest.templateHash };
  } finally { await browser.close(); }
}

async function rasterizePdf(input, executables = {}) {
  const request = validateRenderInput(input);
  const owned = process.env.PERO_KP_BROWSER_SPOOL_DIR;
  const root = owned ? await workingDirectory(owned, 'raster') : await fs.mkdtemp(path.join(os.tmpdir(), 'pero-kp-render-'));
  const absolute = path.resolve(root), expectedParent = path.resolve(owned ?? os.tmpdir());
  if (path.dirname(absolute) !== expectedParent || (owned ? path.basename(absolute) !== 'raster' : !path.basename(absolute).startsWith('pero-kp-render-'))) throw Error('KP_RENDER_TEMP_GUARD');
  try {
    const file = path.join(absolute, 'proposal.pdf');
    await fs.writeFile(file, boundedBase64(request.pdfBase64, LIMITS.pdfBytes), { flag: 'wx' });
    const { stdout } = await execute(executables.pdfinfo ?? process.env.PERO_KP_PDFINFO_PATH ?? 'pdfinfo', [file], { timeout: 0, maxBuffer: LIMITS.requestBytes, windowsHide: true });
    const count = Number(/^Pages:\s+(\d+)\s*$/m.exec(stdout)?.[1]);
    if (!Number.isSafeInteger(count) || count < 1) throw Error('KP_RENDER_PAGE_LIMIT');
    await execute(executables.pdftoppm ?? process.env.PERO_KP_PDFTOPPM_PATH ?? 'pdftoppm', ['-r', '192', '-scale-to-x', '1588', '-scale-to-y', '2246', '-png', file, path.join(absolute, 'page')],
      { timeout: 0, maxBuffer: LIMITS.requestBytes, windowsHide: true });
    const names = (await fs.readdir(absolute)).filter(name => /^page-\d+\.png$/.test(name)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
    if (names.length !== count) throw Error('KP_RENDER_PDF_PAGES_MISSING');
    const pagesBase64 = []; let total = 0;
    for (const name of names) {
      const bytes = await fs.readFile(path.join(absolute, name)); total += bytes.length;
      if (bytes.length > LIMITS.rasterPageBytes || total > LIMITS.totalAssetBytes) throw Error('KP_RENDER_BYTES_LIMIT');
      pagesBase64.push(bytes.toString('base64'));
    }
    return { kind: 'rasterize', pagesBase64, pageCount: count, templateHash: getKpTemplateIdentity().templateHash };
  } finally { if (!owned) await fs.rm(absolute, { force: true, recursive: true }); }
}
async function renderDocx(input) {
  const request = validateRenderInput(input);
  if (request.kind !== 'docx') throw Error('KP_RENDER_INPUT_INVALID');
  const rendered = request.rendered.map(source => ({ id: source.id, images: source.imagesBase64.map(page => boundedBase64(page, LIMITS.docxPngBytes)) }));
  const bytes = Buffer.from(await generateDocx(request.settings, request.summary, request.profile, rendered));
  if (bytes.length > LIMITS.docxBytes || bytes.subarray(0, 2).toString() !== 'PK') throw Error('KP_RENDER_BYTES_LIMIT');
  return { kind: 'docx', bytesBase64: bytes.toString('base64'), pageCount: rendered.reduce((sum, source) => sum + source.images.length, 0), templateHash: getKpTemplateIdentity().templateHash };
}
module.exports = { renderPdf, renderPdfFile, rasterizePdf, renderDocx };
