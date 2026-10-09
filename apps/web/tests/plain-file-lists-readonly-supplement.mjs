/** Read-only supplemental QA115. Import creates no browser/files/network connection. */
import {chromium} from '@playwright/test';
import {verifyPlainFileListStagingBinding} from './plain-file-lists-staging-contract.mjs';
import {disableKanbanQaServiceWorkerApi} from './kanban-cover-staging-browser.mjs';
const VIEWPORTS = [{width: 1440, height: 900}, {width: 390, height: 844}];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function check(ok, code) {if (!ok) throw Error(`W115_${code}`);}

export function warehouseReadonlyRequest({url, method, prefetch = false}, origin) {
 let parsed;try {parsed = new URL(url);} catch {return 'deny';}
 if (parsed.origin !== origin || parsed.username || parsed.password || parsed.hash) return 'deny';
 if (!['GET', 'HEAD'].includes(method)) return 'block-write';
 if (prefetch) return 'block-prefetch';
 if (['/api/health', '/api/auth/session', '/warehouse/movements', '/favicon.ico', '/icon.svg', '/apple-icon.png', '/manifest.webmanifest'].includes(parsed.pathname) && [...parsed.searchParams.keys()].every(key => parsed.pathname === '/warehouse/movements' && key === '_rsc')) return 'allow';
 if (/^\/(?:_next\/static|icons)\/[A-Za-z0-9_./@-]+$/.test(parsed.pathname) && !parsed.pathname.includes('..')) return 'allow';
 return 'deny'; // No original file GET, proxy, exports, detail navigation, POST or printer invocation.
}

/** Self-contained DOM callback. Original names/IDs/hrefs stay inside this callback; outputs are booleans/counts. */
export function inspectWarehouseFilenameRow(row, expectPrinter) {
 const name = row.firstElementChild, text = name?.textContent?.trim() ?? '';
 const buttons = [...row.querySelectorAll('button')], trash = buttons.filter(node => node.getAttribute('aria-label') === `Удалить файл ${text}`), prints = buttons.filter(node => node.getAttribute('aria-label') === `Распечатать ${text}`);
 const imageName = name?.tagName === 'BUTTON', linkName = name?.tagName === 'A', href = name?.getAttribute('href') ?? '';
 const expectedPrintableHint = /\.(?:pdf|png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i.test(text);
 const styles = name ? getComputedStyle(name) : null;
 return {nameOnly: Boolean(text) && (row.textContent?.trim() ?? '') === text, extensionPresent: /\.[A-Za-z0-9]{1,12}$/.test(text), nameAction: imageName || linkName,
  protectedLink: imageName || (linkName && /^\/api\/(?:finance\/documents|files)\/[A-Za-z0-9_-]{1,128}$/.test(href) && name.getAttribute('download') === text),
  noMediaOrMetadata: row.querySelectorAll('img,iframe,video,time').length === 0, trashDisabled: trash.length === 1 && trash[0].disabled,
  noExtraButtons: buttons.length === Number(imageName) + 1 + prints.length, printerIfPresentValid: prints.length <= 1 && prints.every(node => !node.disabled),
  printerHintValid: !expectPrinter || !expectedPrintableHint || prints.length === 1, printableHint: expectedPrintableHint,
  fullNameGeometry: Boolean(name) && name.scrollWidth <= name.clientWidth + 1 && styles?.textOverflow !== 'ellipsis'};
}
export function warehouseRowMetricsValid(row) {return ['nameOnly', 'extensionPresent', 'nameAction', 'protectedLink', 'noMediaOrMetadata', 'trashDisabled', 'noExtraButtons', 'printerIfPresentValid', 'printerHintValid', 'fullNameGeometry'].every(key => row?.[key] === true);}

/** Root supplies the SAME fresh13 ADMIN/current HMAC certificate; never creates fixture/actors/stock/money/S3.
 * Existing warehouse rows are measured without clicking files, reading/exporting names or taking screenshots. */
export async function runWarehouseFileListReadonlySupplement(input = {}) {
 const binding = await verifyPlainFileListStagingBinding(input);
 check(typeof input.ownerCoordinator?.verifyFinalState === 'function', 'CURRENT_OWNER_FINAL_PROOF_REQUIRED');
 const receipt = {kind: 'warehouse-file-list-readonly', status: 'STARTED', revision: binding.expectedRevision, runId: binding.runId, viewports: [], blockedWrites: 0, blockedPrefetches: 0, deniedReads: 0, pageErrors: 0, upstreamNonReadResponses: 0, blockedFileRequests: 0,
  printerProof: 'actual visible control and filename-extension hint; original MIME/content is not exported or fetched', selectedUpload: 'NOT_REACHABLE_WITH_ZERO_POST: upload result is local state set only after a genuine upload ACK'};
 let browser, context, fatal = false;
 try {
  browser = await chromium.launch({headless: true, channel: 'chromium'});
  for (const viewport of VIEWPORTS) {
   context = await browser.newContext({viewport, locale: 'ru-RU', timezoneId: 'Europe/Moscow', serviceWorkers: 'block', ignoreHTTPSErrors: false, ...(input.basicAuth ? {httpCredentials: input.basicAuth} : {})});
   await context.addInitScript(disableKanbanQaServiceWorkerApi);
   await context.route('**/*', async route => {
    const request = route.request(), headers = request.headers();
    const decision = warehouseReadonlyRequest({url: request.url(), method: request.method(), prefetch: Boolean(headers['next-router-prefetch'] || headers.purpose === 'prefetch')}, binding.origin);
    if (decision === 'allow' && !fatal) {await route.continue();return;}
    if (/^\/api\/(?:files|finance\/documents)\//.test(new URL(request.url()).pathname)) receipt.blockedFileRequests++;
    if (decision === 'block-write') receipt.blockedWrites++;else if (decision === 'block-prefetch') receipt.blockedPrefetches++;else {receipt.deniedReads++;fatal = true;}
    await route.abort('blockedbyclient');
   });
   context.on('response', response => {if (!['GET', 'HEAD'].includes(response.request().method())) {receipt.upstreamNonReadResponses++;fatal = true;}});
   await context.addCookies(binding.profiles.admin.cookies);
   const health = await context.request.get(`${binding.origin}/api/health`, {maxRedirects: 0});check(health.status() === 200 && (await health.json()).database === 'ok', 'HEALTH_FAILED');
   const session = await context.request.get(`${binding.origin}/api/auth/session`, {maxRedirects: 0});check(session.status() === 200, 'SESSION_FAILED');const user = (await session.json()).user;check(user?.id === binding.profiles.admin.id && same(user.roles, ['ADMIN']), 'CURRENT_ADMIN_MISMATCH');
   const page = await context.newPage();page.on('pageerror', () => {receipt.pageErrors++;fatal = true;});
   const response = await page.goto(`${binding.origin}/warehouse/movements`, {waitUntil: 'domcontentloaded'});check(response?.status() === 200 && new URL(page.url()).origin === binding.origin, 'WAREHOUSE_NAVIGATION_FAILED');
   const measurements = [], rows = page.locator('[data-file-list-row]:visible');let pages = 0;
   // At most the existing last500 rows/default20 pages; only client pagination is activated.
   while (pages++ < 25) {
    const count = await rows.count();
    for (let index = 0; index < count; index++) {const row = rows.nth(index);await row.scrollIntoViewIfNeeded();const metrics = await row.evaluate(inspectWarehouseFilenameRow, input.expectPrinter === true);check(warehouseRowMetricsValid(metrics), 'WAREHOUSE_FILENAME_ROW_FAILED');measurements.push(metrics);}
    if (measurements.length) break;
    const next = page.getByRole('button', {name: 'Вперёд', exact: true});if (await next.count() !== 1 || await next.isDisabled()) break;await next.click();
   }
   const swAbsent = await page.evaluate(() => !('serviceWorker' in navigator));check(swAbsent && context.serviceWorkers().length === 0, 'SW_GUARD_FAILED');
   receipt.viewports.push({width: viewport.width, pages, fileRows: measurements.length, printableHints: measurements.filter(row => row.printableHint).length, allRowsValid: measurements.every(warehouseRowMetricsValid)});
   check(!fatal && receipt.pageErrors === 0 && receipt.deniedReads === 0 && receipt.upstreamNonReadResponses === 0, 'READONLY_TRANSPORT_VIOLATION');
   await context.close();context = null;
  }
  const final = await input.ownerCoordinator.verifyFinalState();
  check(final?.kind === 'current-owned-final-verification' && final.runId === binding.runId && final.revision === binding.expectedRevision && final.preSha256 === binding.preSha256 && final.currentOwnedStateHash === binding.currentOwnedStateHash && final.financialStateHash === binding.financialStateHash && final.storageManifestHash === binding.storageManifestHash && final.untouchedRelationsMatch === true && final.preferencesUntouched === true && final.storageVersionsAccounted === true && final.tokenClockValid === true, 'CURRENT_ORIGINAL_OWN_FINAL_PROOF_FAILED');
  receipt.status = warehouseCoverageStatus(receipt.viewports);
 } catch (error) {receipt.status = 'STOP';receipt.code = /^W115_[A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : 'W115_READONLY_CHECK_FAILED';}
 finally {if (context) await context.close();if (browser) await browser.close();}
 return receipt;
}
export function warehouseCoverageStatus(views) {
 if (!Array.isArray(views) || !views.length || views.some(view => view.fileRows === 0)) return 'NOT_EXERCISED_NO_EXISTING_REPORT_ROWS';
 return views.every(view => view.fileRows > 0 && view.allRowsValid === true) ? 'PASS' : 'STOP';
}