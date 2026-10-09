/** Opt-in UI transport replacement for ONE ALREADYplanned Root13 finance-image upload. No automatic runtime. */
import {chromium, expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {verifyPlainFileListStagingBinding, isPlainFileListStaticReadPath} from './plain-file-lists-staging-contract.mjs';
import {disableKanbanQaServiceWorkerApi} from './kanban-cover-staging-browser.mjs';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[0-9a-f]{12}$/i;
const SHA = /^[a-f0-9]{64}$/;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function check(ok, code) {if (!ok) throw Error(`U115_${code}`);}

/** Decode a genuine browser multipart request and pin ONLY its captured UUID to a durable planned nonce. */
export async function pinPlannedUiMultipart({body, contentType, requestUrl, actorId, bridge}) {
 const request = new Request(requestUrl, {method: 'POST', headers: {'content-type': contentType}, body});
 const form = await request.formData(), fields = [...form.keys()], file = form.get('file'), uiMutationId = form.get('clientMutationId');
 check(fields.length === 2 && [...fields].sort().join('|') === 'clientMutationId|file' && file instanceof File && typeof uiMutationId === 'string' && UUID.test(uiMutationId), 'EXACT_ACTUAL_UI_MULTIPART_REQUIRED');
 const bytes = new Uint8Array(await file.arrayBuffer());
 const mapping = await bridge.beforeUpstream({method: 'POST', url: requestUrl, actorId, fieldNames: fields, uiMutationId, fileName: file.name, mimeType: file.type, bytes});
 check(mapping?.recorded === true && UUID.test(mapping.effectiveMutationId ?? '') && SHA.test(mapping.mappingSha256 ?? ''), 'DURABLE_PLANNED_NONCE_MAPPING_REQUIRED');
 form.set('clientMutationId', mapping.effectiveMutationId);
 const pinned = new Request(requestUrl, {method: 'POST', body: form});
 return {body: new Uint8Array(await pinned.arrayBuffer()), contentType: pinned.headers.get('content-type')};
}
export function selectedUiReadRequest({url, method, prefetch = false}, binding) {
 let parsed;try {parsed = new URL(url);} catch {return 'deny';}
 if (parsed.origin !== binding.origin || parsed.username || parsed.password || parsed.hash) return 'deny';
 if (method === 'POST' && parsed.pathname === '/api/finance/documents/upload' && !parsed.search) return 'candidate-upload';
 if (!['GET', 'HEAD'].includes(method)) return 'block-write';
 if (prefetch) return 'block-prefetch';
 if (['/api/health', '/api/auth/session'].includes(parsed.pathname) && !parsed.search) return 'allow';
 if (parsed.pathname === binding.paths.financeProject && [...parsed.searchParams.keys()].every(key => key === '_rsc')) return 'allow';
 if ((['/favicon.ico', '/icon.svg', '/apple-icon.png', '/manifest.webmanifest'].includes(parsed.pathname) && !parsed.search) || isPlainFileListStaticReadPath(parsed.pathname)) return 'allow';
 return 'deny'; // No file opens, print/download, exports, money/save/preference endpoints.
}

/** Root must omit coordinator.upload('finance-image'): this is that same planned upload, not an extra object.
 * Bridge is the concrete reviewed113 inspector/durable publisher, with no backend upload method. */
export async function runSelectedFinanceUploadUi(input = {}) {
 const binding = await verifyPlainFileListStagingBinding(input);
 check(input.bytes instanceof Uint8Array && ['beginUpload', 'beforeUpstream', 'afterActualUpload', 'unknown', 'state'].every(key => typeof input.bridge?.[key] === 'function'), 'CONCRETE_PLANNED_BRIDGE_REQUIRED');
 const prepared = await input.bridge.beginUpload(), intent = prepared.intent;
 check(intent?.kind === 'upload-intent' && intent.namespace === 'PERO_FILE_ACCEPTANCE_113_V2' && intent.runId === binding.runId && intent.revision === binding.expectedRevision && intent.mediaKey === 'finance-image' && SHA.test(intent.signature ?? '') && prepared.actorId === binding.profiles.admin.id && intent.fileName.includes(binding.runId) && intent.mimeType === 'image/png' && intent.size === input.bytes.byteLength && intent.contentHash === digest(input.bytes), 'ACTUAL_SIGNED_PLANNED_IMAGE_REQUIRED');
 const receipt = {kind: 'actual-selected-finance-upload-ui', status: 'STARTED', runId: binding.runId, revision: binding.expectedRevision, requests: 0, genuineAcknowledgements: 0, blockedWrites: 0, blockedPrefetches: 0, deniedReads: 0, pageErrors: 0, otherNonReadResponses: 0, selectedFilenameOnly: false, selectedTrashDisabled: false, cancelledWithoutPayment: false};
 let browser, context, sent = false, consumed = false, fatal = null, selected = null;
 const pending = new Set();
 const safe = error => /^U115_[A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : 'U115_UI_CHECK_FAILED';
 try {
  browser = await chromium.launch({headless: true, channel: 'chromium'});
  context = await browser.newContext({viewport: {width: 390, height: 844}, locale: 'ru-RU', timezoneId: 'Europe/Moscow', serviceWorkers: 'block', ignoreHTTPSErrors: false, ...(input.basicAuth ? {httpCredentials: input.basicAuth} : {})});
  await context.addInitScript(disableKanbanQaServiceWorkerApi);
  await context.route('**/*', async route => {
   const job = (async () => {
    const request = route.request(), headers = request.headers(), decision = selectedUiReadRequest({url: request.url(), method: request.method(), prefetch: Boolean(headers['next-router-prefetch'] || headers.purpose === 'prefetch')}, binding);
    if (fatal) {await route.abort('blockedbyclient');return;}
    if (decision === 'allow') {await route.continue();return;}
    if (decision === 'block-write') {receipt.blockedWrites++;await route.abort('blockedbyclient');return;}
    if (decision === 'block-prefetch') {receipt.blockedPrefetches++;await route.abort('blockedbyclient');return;}
    if (decision === 'deny') {receipt.deniedReads++;throw Error('U115_READ_NOT_ALLOWLISTED');}
    check(!consumed && request.url() === `${binding.origin}/api/finance/documents/upload`, 'ONE_PLANNED_UPLOAD_ONLY');consumed = true;
    const pinned = await pinPlannedUiMultipart({body: request.postDataBuffer(), contentType: headers['content-type'], requestUrl: request.url(), actorId: binding.profiles.admin.id, bridge: input.bridge});
    check(!fatal, 'STOP_BEFORE_UPLOAD');const forwardedHeaders = {...headers, 'content-type': pinned.contentType};delete forwardedHeaders['content-length'];
    sent = true;receipt.requests++;
    const response = await route.fetch({headers: forwardedHeaders, postData: Buffer.from(pinned.body), maxRedirects: 0, maxRetries: 0, timeout: 30000}), body = await response.body(), responseHeaders = response.headers();
    const decoded = JSON.parse(body.toString('utf8'));
    const proof = await input.bridge.afterActualUpload({status: response.status(), redirected: Boolean(responseHeaders.location), body: decoded});
    check(proof?.recorded === true && proof.kind === 'verified-actual-finance-ui-upload' && proof.fileId === decoded.document?.id && proof.originalRelationsMatch === true && proof.ownMoneyUnchanged === true && proof.preferencesUntouched === true && proof.priorOwnAuditPreserved === true && proof.storageVersionsAccounted === true && proof.tokenClockValid === true, 'ACTUAL_SOURCE_BACKED_UPLOAD_ACK_REQUIRED');
    selected = {id: decoded.document.id, fileName: decoded.document.fileName, mimeType: decoded.document.mimeType};check(selected.fileName === intent.fileName && selected.mimeType === intent.mimeType, 'ACTUAL_UPLOAD_VIEW_CHANGED');receipt.genuineAcknowledgements++;
    await route.fulfill({response, body});
   })();pending.add(job);
   try {await job;} catch (error) {fatal ??= safe(error);await route.abort('blockedbyclient').catch(() => {});} finally {pending.delete(job);}
  });
  context.on('response', response => {if (!['GET', 'HEAD'].includes(response.request().method()) && new URL(response.request().url()).pathname !== '/api/finance/documents/upload') {receipt.otherNonReadResponses++;fatal ??= 'U115_OTHER_UPSTREAM_WRITE';}});
  await context.addCookies(binding.profiles.admin.cookies);
  const health = await context.request.get(binding.origin + '/api/health', {maxRedirects: 0});check(health.status() === 200 && (await health.json()).database === 'ok', 'HEALTH_FAILED');
  const session = await context.request.get(`${binding.origin}/api/auth/session`, {maxRedirects: 0});check(session.status() === 200, 'SESSION_FAILED');const user = (await session.json()).user;check(user?.id === binding.profiles.admin.id && JSON.stringify(user.roles) === '["ADMIN"]', 'CURRENT_OWN_ADMIN_REQUIRED');
  const page = await context.newPage();page.on('pageerror', () => {receipt.pageErrors++;fatal ??= 'U115_PAGE_ERROR';});
  const response = await page.goto(binding.origin + binding.paths.financeProject, {waitUntil: 'domcontentloaded'});check(response?.status() === 200, 'OWN_FINANCE_PAGE_FAILED');
  await page.getByRole('button', {name: 'Добавить расход', exact: true}).click();const dialog = page.getByRole('dialog').filter({has: page.locator('#pay-document')});await expect(dialog).toBeVisible();
  await dialog.locator('#pay-document').setInputFiles({name: intent.fileName, mimeType: intent.mimeType, buffer: Buffer.from(input.bytes)});
  await expect.poll(() => Boolean(selected || fatal), {timeout: 60000}).toBe(true);check(!fatal && selected, 'PLANNED_UPLOAD_NOT_ACKNOWLEDGED');await Promise.allSettled([...pending]);
  const row = dialog.locator(`[data-file-list-row="${selected.id}"]:visible`);await expect(row).toHaveCount(1);check((await row.innerText()).trim() === intent.fileName, 'ACTUAL_SELECTED_NAME_OR_METADATA_FAILED');await expect(row.locator('img,iframe,video,time')).toHaveCount(0);await expect(row.getByRole('button', {name: `Удалить файл ${intent.fileName}`, exact: true})).toBeDisabled();
  const fits = await row.evaluate(node => node.scrollWidth <= node.clientWidth + 1);check(fits, 'SELECTED_NAME_OVERFLOW');receipt.selectedFilenameOnly = true;receipt.selectedTrashDisabled = true;
  // This is the only form action after upload: cancel without ever submitting addPayment.
  await dialog.getByRole('button', {name: 'Отмена', exact: true}).click();await expect(dialog).toHaveCount(0);receipt.cancelledWithoutPayment = true;
  check(receipt.requests === 1 && receipt.genuineAcknowledgements === 1 && receipt.otherNonReadResponses === 0 && receipt.pageErrors === 0 && receipt.deniedReads === 0 && !fatal, 'EXACT_ONE_REAL_UPLOAD_CANCELLED_FORM_REQUIRED');
  receipt.status = 'PASS';
 } catch (error) {receipt.status = 'STOP';receipt.code = fatal ?? safe(error);}
 finally {
  await Promise.allSettled([...pending]);if (context) await context.close();if (browser) await browser.close();
  if (receipt.status !== 'PASS' && sent) {try {await input.bridge.unknown();} catch { /* Root preserves the durable intent and reconciles; no retry. */ }}
 }
 return receipt;
}