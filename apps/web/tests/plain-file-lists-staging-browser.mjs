/** Opt-in actual staging UI QA 115. Import never opens a browser or writes evidence. */
import {chromium, expect} from '@playwright/test';
import {mkdir, realpath} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {disableKanbanQaServiceWorkerApi} from './kanban-cover-staging-browser.mjs';
import {verifyPlainFileListStagingBinding, plainFileListRequestDecision, createPlainFileListDeleteGate, createPlainFileListOwnerLedger, plainFileListSafeError} from './plain-file-lists-staging-contract.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const VIEWPORTS = [{width: 1440, height: 900}, {width: 390, height: 844}, {width: 360, height: 800}];
function check(ok, code) {if (!ok) throw Error(`F115_${code}`);}
const rolesMatch = (a, b) => JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...b].sort());
const visibleRows = (scope, id) => scope.locator(`[data-file-list-row="${id}"]:visible`);
function deferred() {let resolve;const promise = new Promise(done => {resolve = done;});return {promise, resolve};}
async function waitPending(promise) {let timer;try {await Promise.race([promise, new Promise((_, reject) => {timer = setTimeout(() => reject(Error('F115_PENDING_UI_TIMEOUT')), 30000);})]);} finally {clearTimeout(timer);}}

/** Closed technical classes and a digest only. Raw messages/stacks may contain client data. */
export function plainFileListPageErrorDiagnostic(error) {
 const message = typeof error?.message === 'string' ? error.message : '', stack = typeof error?.stack === 'string' ? error.stack : '';
 const errorKind = ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'TimeoutError'].includes(error?.name) ? error.name : 'OtherError';
 const reactMatch = /Minified React error #([0-9]{1,4})(?:;|\b)/.exec(message);
 let family = 'OTHER';
 if (reactMatch) family = 'REACT_MINIFIED';
 else if (/ResizeObserver loop (?:limit exceeded|completed with undelivered notifications)/.test(message)) family = 'RESIZE_OBSERVER_LOOP';
 else if (/Cannot read properties of undefined \(reading ['"]then['"]\)/.test(message)) family = /serwist/i.test(stack) ? 'SERWIST_UNDEFINED_THEN' : 'UNDEFINED_THEN';
 else if (/An error occurred in the Server Components render\./.test(message)) family = 'SERVER_COMPONENT_OPAQUE';
 else if (/^(?:Failed to fetch|NetworkError when attempting to fetch resource\.)$/.test(message)) family = 'NETWORK_READ_FAILED';
 const sourceClass = /chrome:\/\/print\b|chrome:\/\/print-preview\b/.test(stack) ? 'NATIVE_PRINT' : /https:\/\/staging-crm\.peromebel\.by\/_next\/static\//.test(stack) ? 'CRM_STATIC' : 'OTHER';
 return {family, errorKind, reactCode: reactMatch ? Number(reactMatch[1]) : null, messageSha256: createHash('sha256').update(message).digest('hex'), sourceClass};
}

/** The heading also contains the task status badge; only its title prefix identifies the dialog.
 * Repeating setSelected(task) may open it after hydration, but never submits a server action. */
export async function openOwnedTaskFileDialog(page, taskTitle, reportAttempt = () => {}, assertClient = () => {}) {
 const escapedTitle = taskTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
 const task = page.getByText(taskTitle, {exact: true});
 const dialog = page.getByRole('dialog').filter({has: page.getByRole('heading', {name: new RegExp(`^${escapedTitle}(?:\\s|$)`)})});
 for (let attempt = 1; attempt <= 3; attempt++) {
  assertClient();check(await task.count() === 1 && await task.isVisible(), 'UNIQUE_VISIBLE_TASK_TRIGGER_REQUIRED');
  await task.click({timeout: 65000});reportAttempt(attempt);
  try {await dialog.waitFor({state: 'visible', timeout: 2500});}
  catch (error) {
   check(error?.name === 'TimeoutError' && await dialog.count() <= 1 && !await dialog.isVisible(), 'TASK_DIALOG_OPEN_FAILED');assertClient();continue;
  }
  assertClient();check(await dialog.count() === 1 && await dialog.isVisible(), 'UNIQUE_VISIBLE_TASK_DIALOG_REQUIRED');return dialog;
 }
 throw Error('F115_TASK_DIALOG_NOT_VISIBLE');
}

/** Root supplies immutable prior receipt/observation digests and verifies that snapshot locally.
 * Only the already-read desktop project/product prefix may be omitted; all remaining cases still run. */
export function fileListsDesktopPrefixAccepted(prefix, binding) {
 if (prefix === undefined) return false;
 check(prefix?.kind === 'root-verified-desktop-file-prefix' && prefix.runId === binding.runId && prefix.revision === binding.expectedRevision && ['preSha256', 'currentOwnedStateHash', 'storageManifestHash', 'financialStateHash'].every(key => prefix[key] === binding[key]) && ['priorReceiptSha256', 'priorObservationSha256'].every(key => /^[a-f0-9]{64}$/.test(prefix[key] ?? '')) && prefix.checkedDesktopRows > 0 && prefix.checkedDesktopRows <= 64, 'CURRENT_VERIFIED_DESKTOP_PREFIX_REQUIRED');
 return true;
}

/** A confirmed invalid owned Task is omitted only from a wholly read-only partial run. */
export function fileListsUnlinkedTaskOmitted(task, binding, deletePlan) {
 if (task === undefined) return false;
 check(task?.kind === 'root-confirmed-unlinked-owned-task' && task.runId === binding.runId && task.revision === binding.expectedRevision && task.taskId === binding.ids.task && task.workId === null && task.currentOwnedStateHash === binding.currentOwnedStateHash && /^[a-f0-9]{64}$/.test(task.signedObservationSha256 ?? '') && deletePlan.length === 0, 'CURRENT_UNLINKED_TASK_READONLY_REQUIRED');return true;
}

/** Read scenarios complete before explicitly planned confirmed deletions. No upload, financial mutation,
 * preference save, PDF/video viewer, trace/HAR/storageState, session file or existing-client screenshot. */
export async function runPlainFileListsStagingBrowser(input = {}) {
 const binding = await verifyPlainFileListStagingBinding(input);const desktopPrefixAccepted = fileListsDesktopPrefixAccepted(input.completedDesktopPrefix, binding);
 check(binding.finance && binding.financeDocs.some(file => file.paymentId === binding.finance.incomeId) && binding.financeDocs.some(file => file.paymentId === binding.finance.expenseId), 'ACTUAL_FINANCE_FIXTURE_REQUIRED');
 const deletePlan = input.deletePlan ?? [];
 check(Array.isArray(deletePlan) && deletePlan.length <= 4 && new Set(deletePlan.map(row => row.fileId)).size === deletePlan.length && deletePlan.every(row => binding.files.some(file => file.id === row.fileId) && ['project', 'product', 'task'].includes(row.surface) && ['manager', 'engineer'].includes(row.actor) && ['real', 'client-error'].includes(row.mode)), 'OWN_DELETE_PLAN_REQUIRED');
 const unlinkedTaskOmitted = fileListsUnlinkedTaskOmitted(input.unlinkedTask, binding, deletePlan);
 const engineerDesktopAccepted = desktopPrefixAccepted && input.completedDesktopPrefix.engineerDesktopRows === 5 && /^[a-f0-9]{64}$/.test(input.completedDesktopPrefix.engineerReceiptSha256 ?? '');
 const projectIncomePending = input.pendingProjectIncomeDocument === true;
 check(!projectIncomePending || (binding.expectedRevision === '37f882f69a2d76901b98321ff7824d0d04db4db8' && deletePlan.length === 0), 'KNOWN_PROJECT_INCOME_GAP_READONLY_REQUIRED');
 const ownerLedger = createPlainFileListOwnerLedger(binding, input.ownerCoordinator);
 const gate = createPlainFileListDeleteGate(binding, ownerLedger);
 const root = await realpath(ROOT), base = await realpath(path.join(ROOT, '.playwright-mcp', 'files115'));
 const within = (parent, child) => {const relative = path.relative(parent, child);return relative && !relative.startsWith('..') && !path.isAbsolute(relative);};
 check(within(root, base), 'EVIDENCE_BASE_MISMATCH');
 const outputDir = path.join(base, `staging-${binding.runId}-${Date.now()}`);await mkdir(outputDir, {recursive: false, mode: 0o700});check(within(base, await realpath(outputDir)), 'EVIDENCE_PATH_MISMATCH');
 const receipt = {status: 'STARTED', revision: binding.expectedRevision, runId: binding.runId, revisionProof: 'reviewed physical transport identity and owner113 current HMAC/PRE/DB/version certificate', origin: binding.origin, checks: [], screenshots: [], blockedWrites: 0, blockedPrefetches: 0, deniedReads: 0, pageErrorCount: 0, firstPageError: null, upstreamDeleteRequests: 0, upstreamOtherNonReadResponses: 0, acknowledgedDeletes: 0, clientFailureChecks: 0, taskOpenClicks: 0, acceptedDesktopPrefixReceiptSha256: desktopPrefixAccepted ? input.completedDesktopPrefix.priorReceiptSha256 : null, substep: null, skippedProjectIncomeSurfaces: [], pendingGates: unlinkedTaskOmitted ? ['TASK_WORK_LINKAGE_REQUIRED'] : [], skippedTaskViewports: [], outputDir};
 if (projectIncomePending) receipt.pendingGates.push('PROJECT_INCOME_DOCUMENT_NOT_RENDERED');
 let browser, context, phase = 'setup', fatal = null, pendingUi = null;
 const inFlightRoutes = new Set();
 const fail = error => {fatal ??= plainFileListSafeError(error);gate.stop();};
 function assertSafe() {check(!fatal, 'TRANSPORT_STOPPED');check(receipt.pageErrorCount === 0 && receipt.deniedReads === 0 && receipt.upstreamOtherNonReadResponses === 0, 'CLIENT_OR_TRANSPORT_VIOLATION');}
 async function drain() {await Promise.allSettled([...inFlightRoutes]);}
 async function close() {if (context) {await drain();await context.close();context = null;}}
 async function start(actor, viewport) {
  await close();context = await browser.newContext({viewport, locale: 'ru-RU', timezoneId: 'Europe/Moscow', serviceWorkers: 'block', acceptDownloads: true, ignoreHTTPSErrors: false, ...(input.basicAuth ? {httpCredentials: input.basicAuth} : {})});
  await context.addInitScript(disableKanbanQaServiceWorkerApi);
  await context.route('**/*', async route => {
   const job = (async () => {
    const request = route.request(), headers = request.headers();
    const descriptor = {url: request.url(), method: request.method(), actionId: headers['next-action'], body: request.postData(), prefetch: Boolean(headers['next-router-prefetch'] || headers.purpose === 'prefetch')};
    const decision = plainFileListRequestDecision(descriptor, binding);
    if (fatal) {await route.abort('blockedbyclient');return;}
    if (decision.kind === 'continue') {await route.continue();return;}
    if (decision.kind === 'abort-prefetch') {receipt.blockedPrefetches++;await route.abort('blockedbyclient');return;}
    if (decision.kind === 'abort-write') {receipt.blockedWrites++;await route.abort('blockedbyclient');return;}
    if (decision.kind === 'deny') {receipt.deniedReads++;throw Error(decision.code);}
    const intent = gate.consume(descriptor, actor);let captured;
    const result = await gate.execute(intent, async () => {
     check(pendingUi?.fileId === intent.fileId, 'PENDING_UI_GATE_MISSING');pendingUi.started.resolve();
     check(await pendingUi.release.promise, 'LOCAL_PENDING_CHECK_FAILED');
     check(!fatal, 'TRANSPORT_STOPPED_BEFORE_DELETE');
     receipt.upstreamDeleteRequests++;
     const response = await route.fetch({maxRedirects: 0, maxRetries: 0, timeout: 30000});const body = await response.body(), responseHeaders = response.headers();captured = {response, body};
     return {status: response.status(), contentType: responseHeaders['content-type'], redirected: Boolean(responseHeaders.location || responseHeaders['x-action-redirect']), body};
    });
    if (result.kind === 'abort-client-error') {receipt.clientFailureChecks++;await route.abort('failed');return;}
    check(captured && result.kind === 'acknowledged', 'CAPTURED_ACK_REQUIRED');
    if (result.ok) receipt.acknowledgedDeletes++;
    await route.fulfill(captured);
   })();inFlightRoutes.add(job);
   try {await job;} catch (error) {fail(error);await route.abort('blockedbyclient').catch(() => {});} finally {inFlightRoutes.delete(job);}
  });
  context.on('response', response => {if (!['GET', 'HEAD'].includes(response.request().method()) && response.request().headers()['next-action'] !== binding.actionId) {receipt.upstreamOtherNonReadResponses++;fail(Error('F115_UNEXPECTED_UPSTREAM_WRITE'));}});
  await context.addCookies(binding.profiles[actor].cookies);
  const health = await context.request.get(`${binding.origin}/api/health`, {maxRedirects: 0});check(health.status() === 200, 'HEALTH_HTTP_FAILED');const healthBody = await health.json();check(healthBody.status === 'ok' && healthBody.database === 'ok', 'HEALTH_DEGRADED');
  const session = await context.request.get(`${binding.origin}/api/auth/session`, {maxRedirects: 0});check(session.status() === 200, 'SESSION_HTTP_FAILED');const current = await session.json();check(current.user?.id === binding.profiles[actor].id && rolesMatch(current.user.roles, binding.profiles[actor].roles), 'CURRENT_SESSION_MISMATCH');
  const page = await context.newPage();page.on('pageerror', error => {receipt.pageErrorCount++;receipt.firstPageError ??= plainFileListPageErrorDiagnostic(error);fail(Error('F115_PAGE_ERROR'));});return page;
 }
 async function goto(page, route) {
  const response = await page.goto(binding.origin + route, {waitUntil: 'domcontentloaded'});check(response?.status() === 200 && new URL(page.url()).origin === binding.origin, 'OWN_NAVIGATION_FAILED');
  const sw = await page.evaluate(() => ({apiAbsent: !('serviceWorker' in navigator), serwistAbsent: typeof window.serwist === 'undefined'}));check(sw.apiAbsent && sw.serwistAbsent && context.serviceWorkers().length === 0, 'SW_GUARD_FAILED');assertSafe();
 }
 async function rowProof(page, scope, file, canDelete, label, viewport) {
  const row = visibleRows(scope, file.id);await expect(row).toHaveCount(1);await row.scrollIntoViewIfNeeded();
  const displayed = (await row.innerText()).trim();check(displayed === file.fileName, 'FILENAME_OR_METADATA_DISPLAY_FAILED');await expect(row.locator('img,iframe,video,time')).toHaveCount(0);
  const image = file.mimeType.startsWith('image/'), name = image ? row.getByRole('button', {name: file.fileName, exact: true}) : row.getByRole('link', {name: file.fileName, exact: true});await expect(name).toBeVisible();
  if (!image) {await expect(name).toHaveAttribute('href', `/api/${file.source === 'finance' ? 'finance/documents' : 'files'}/${file.id}`);await expect(name).toHaveAttribute('download', file.fileName);}
  const trash = row.getByRole('button', {name: `Удалить файл ${file.fileName}`, exact: true});if (canDelete) await expect(trash).toBeEnabled();else await expect(trash).toBeDisabled();
  const geometry = await row.evaluate(node => {const frame = node.getBoundingClientRect(), first = node.firstElementChild?.getBoundingClientRect();return {width: frame.width, left: frame.left, right: frame.right, nameWidth: first?.width ?? 0, overflow: node.scrollWidth > node.clientWidth + 1, viewport: innerWidth};});
  check(geometry.width > 0 && geometry.nameWidth > 0 && geometry.left >= -1 && geometry.right <= geometry.viewport + 1 && !geometry.overflow, 'OWN_FILENAME_OVERFLOW');
  const screenshot = path.join(outputDir, `${receipt.screenshots.length + 1}-${label}-${viewport.width}.png`);await row.screenshot({path: screenshot});receipt.screenshots.push(screenshot);receipt.checks.push({kind: label, viewport: viewport.width, canDelete, geometry});
  return {row, name, trash};
 }
 async function nameProof(page, row, file, keyboard = false) {
  const before = await page.locator('[role="dialog"]:visible').count(), previousUrl = page.url();
  const image = file.mimeType.startsWith('image/'), name = image ? row.getByRole('button', {name: file.fileName, exact: true}) : row.getByRole('link', {name: file.fileName, exact: true});
  if (image) {
   if (keyboard) {await name.focus();await name.press('Enter');} else await name.click();
   const viewer = page.locator('[data-file-viewer-variant="image-fullscreen"]:visible');await expect(viewer).toHaveCount(1);const img = viewer.locator('[data-fullscreen-image] img');await expect.poll(() => img.evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true);
   await expect(img).toHaveAttribute('src', `/api/${file.source === 'finance' ? 'finance/documents' : 'files'}/${file.id}`);check(await img.evaluate(node => getComputedStyle(node).objectFit) === 'contain', 'ORIGINAL_IMAGE_CROP_FORBIDDEN');
   await viewer.getByRole('button', {name: 'Закрыть полноэкранный просмотр', exact: true}).click();await expect(viewer).toHaveCount(0);
  } else {
   const downloading = page.waitForEvent('download', {timeout: 20000});if (keyboard) {await name.focus();await name.press('Enter');} else await name.click();const download = await downloading;
   check(download.url() === `${binding.origin}/api/${file.source === 'finance' ? 'finance/documents' : 'files'}/${file.id}` && download.suggestedFilename() === file.fileName, 'OWN_DOWNLOAD_SOURCE_OR_FILENAME_CHANGED');await download.cancel();
  }
  check(page.url() === previousUrl && await page.locator('[role="dialog"]:visible').count() === before, 'FILE_CLICK_ACTIVATED_PARENT');await expect(page.locator('[data-file-viewer-variant="standard"], [data-file-viewer-variant="document-fullscreen"]')).toHaveCount(0);assertSafe();
  receipt.checks.push({kind: image ? 'original-fullscreen' : 'protected-download', keyboard});
 }
 async function taskDialog(page) {
  await goto(page, `${binding.paths.project}?tab=tasks`);await expect(page.getByText(binding.taskTitle, {exact: true})).toHaveCount(1);
  return openOwnedTaskFileDialog(page, binding.taskTitle, () => {receipt.taskOpenClicks++;}, assertSafe);
 }
 async function ownFinanceRow(page, file, label, viewport, scope = page) {
  const proof = await rowProof(page, scope, {...file, source: 'finance'}, false, label, viewport);await nameProof(page, proof.row, {...file, source: 'finance'}, true);return proof;
 }
 async function financeProof(page, viewport) {
  const expenseDoc = binding.financeDocs.find(file => file.paymentId === binding.finance.expenseId), incomeDoc = binding.financeDocs.find(file => file.paymentId === binding.finance.incomeId);
  for (const surface of [{route: binding.paths.financeProject, label: 'finance-project'}, {route: `${binding.paths.project}?tab=finance`, label: 'project-tab'}]) {
   receipt.substep = `${surface.label}-navigation`;await goto(page, surface.route);
   receipt.substep = `${surface.label}-income-document`;
   if (projectIncomePending) receipt.skippedProjectIncomeSurfaces.push({surface: surface.label, viewport: viewport.width});else await ownFinanceRow(page, incomeDoc, `${surface.label}-income-document`, viewport);
   receipt.substep = `${surface.label}-expense-open`;const expenses = page.getByRole('heading', {name: 'Расходы', exact: true}).locator('../..');
   if (viewport.width < 768) {const card = expenses.locator('article[data-slot="mobile-list-card"]:visible').filter({has: page.getByText(binding.finance.accountName, {exact: true})});await expect(card).toHaveCount(1);await card.click();}
   receipt.substep = `${surface.label}-expense-document`;await ownFinanceRow(page, expenseDoc, `${surface.label}-expense-document`, viewport);
  }
  receipt.substep = 'organization-expense-navigation';await goto(page, '/finance/expenses');await page.getByPlaceholder('Поиск по расходам…', {exact: true}).fill(binding.finance.expenseComment);
  receipt.substep = 'organization-expense-document';await ownFinanceRow(page, expenseDoc, 'organization-expense-document', viewport);
  receipt.substep = 'organization-income-navigation';await goto(page, '/finance/income');await page.getByPlaceholder('Поиск по приходам…', {exact: true}).fill(binding.finance.incomeComment);
  receipt.substep = 'organization-income-open';const ownIncome = page.locator('tr:visible,article[data-slot="mobile-list-card"]:visible').filter({has: page.getByText(binding.finance.accountName, {exact: true})});await expect(ownIncome).toHaveCount(1);await ownIncome.click();await ownFinanceRow(page, incomeDoc, 'organization-income-detail-document', viewport);
  receipt.substep = "cash-report-navigation";await goto(page, `/finance/accounts/report?from=${binding.finance.date}&to=${binding.finance.date}&mode=BYN`);await page.getByPlaceholder('Поиск по кассам…', {exact: true}).fill(binding.finance.accountName);
  receipt.substep = 'cash-report-open';const ownAccount = page.locator('tr:visible,article[data-slot="mobile-list-card"]:visible').filter({has: page.getByText(binding.finance.accountName, {exact: true})});await expect(ownAccount).toHaveCount(1);await ownAccount.click();const report = page.getByRole('dialog').filter({has: page.getByRole('heading', {name: binding.finance.accountName, exact: true})});await expect(report).toBeVisible();
  receipt.substep = 'cash-report-documents';await ownFinanceRow(page, expenseDoc, 'cash-expense-document', viewport, report);await ownFinanceRow(page, incomeDoc, 'cash-income-document', viewport, report);
 }
 try {
  browser = await chromium.launch({headless: true, channel: 'chromium'});
  for (const viewport of VIEWPORTS) {
   let page = await start('manager', viewport);
   if (!(desktopPrefixAccepted && viewport.width === 1440)) {
   phase = 'manager-owned-project-files';await goto(page, `${binding.paths.project}?tab=files`);
   const projectFiles = page.locator('[data-project-files="flat"]');for (const file of binding.files.filter(file => !file.isCurrentProjectCover)) {const proof = await rowProof(page, projectFiles, file, true, 'project-file', viewport);if (!file.isCurrentSketch) await nameProof(page, proof.row, file);}
   phase = 'manager-owned-product-sections';await goto(page, binding.paths.product);
   for (const file of binding.files.filter(file => file.productId === binding.ids.product && !file.isCurrentSketch)) {const container = page.locator(file.section === 'MEASUREMENT' ? '[data-product-measurement]' : `[data-product-documents-column="${file.section === 'INSTALLATION' ? 'installation' : 'production'}"]`);const proof = await rowProof(page, container, file, true, 'product-section-file', viewport);await nameProof(page, proof.row, file, true);}
   }
   if (unlinkedTaskOmitted) receipt.skippedTaskViewports.push(viewport.width);else {
   phase = 'manager-owned-task-files';const dialog = await taskDialog(page);for (const file of binding.files.filter(file => file.taskId === binding.ids.task)) {const proof = await rowProof(page, dialog, file, true, 'task-file', viewport);await nameProof(page, proof.row, file, true);}
   }
   if (!(engineerDesktopAccepted && viewport.width === 1440)) {
   phase = 'engineer-per-file-permission';page = await start('engineer', viewport);await goto(page, binding.paths.product);
   for (const file of binding.files.filter(file => file.productId === binding.ids.product && !file.isCurrentSketch)) await rowProof(page, page, file, file.uploadedById === binding.profiles.engineer.id, 'engineer-own-or-foreign-file', viewport);
   }
   phase = 'owned-financial-file-contexts';page = await start('admin', viewport);await financeProof(page, viewport);assertSafe();
  }
  for (const item of deletePlan) {
   phase = 'explicit-owned-delete';const page = await start(item.actor, VIEWPORTS[0]), file = binding.files.find(row => row.id === item.fileId);
   let scope = page, route = binding.paths.product;
   if (item.surface === 'task') {scope = await taskDialog(page);route = binding.paths.project;check(file.taskId === binding.ids.task, 'TASK_DELETE_FILE_CONTEXT_MISMATCH');}
   else {route = item.surface === 'project' ? binding.paths.project : binding.paths.product;await goto(page, route + (item.surface === 'project' ? '?tab=files' : ''));}
   const {row, trash} = await rowProof(page, scope, file, true, 'before-confirmed-delete', VIEWPORTS[0]);const popup = page.locator('[data-slot="popover-content"]:visible');
   const beforeRequests = receipt.upstreamDeleteRequests;await trash.click();await expect(popup).toBeVisible();const warningBox = await popup.boundingBox(), buttonBox = await trash.boundingBox();check(warningBox && buttonBox && warningBox.width <= 320 && warningBox.width < VIEWPORTS[0].width && Math.min(Math.abs(warningBox.y - buttonBox.y - buttonBox.height), Math.abs(buttonBox.y - warningBox.y - warningBox.height)) <= 12, 'COMPACT_ANCHORED_WARNING_FAILED');receipt.checks.push({kind: 'compact-anchored-warning', width: warningBox.width});await expect(popup.getByRole('button', {name: 'Отмена', exact: true})).toBeFocused();await popup.getByRole('button', {name: 'Отмена', exact: true}).click();await expect(popup).toHaveCount(0);await expect(row).toBeVisible();check(receipt.upstreamDeleteRequests === beforeRequests, 'CANCEL_SENT_DELETE');receipt.checks.push({kind: 'cancel-preserves-file'});
   await trash.click();await expect(popup).toBeVisible();pendingUi = {fileId: file.id, started: deferred(), release: deferred()};gate.arm({fileId: file.id, actor: item.actor, path: route, mode: item.mode});
   await popup.getByRole('button', {name: 'Удалить', exact: true}).click();
   if (item.mode === 'client-error') {await expect(popup.getByRole('alert')).toBeVisible();await expect(row).toBeVisible();check(receipt.upstreamDeleteRequests === beforeRequests, 'CLIENT_FAILURE_SENT_UPSTREAM');await popup.getByRole('button', {name: 'Отмена', exact: true}).click();receipt.checks.push({kind: 'client-error-preserves-file'});}
   else {
    await waitPending(pendingUi.started.promise);
    await expect(popup.getByRole('button', {name: 'Удаление…', exact: true})).toBeDisabled();await expect(popup.getByRole('button', {name: 'Отмена', exact: true})).toBeDisabled();await expect(trash).toBeDisabled();await page.keyboard.press('Escape');await expect(popup).toBeVisible();
    if (item.surface === 'task') await expect(scope).toBeVisible();pendingUi.release.resolve(true);await expect(row).toHaveCount(0, {timeout: 30000});await drain();check(receipt.upstreamDeleteRequests === beforeRequests + 1, 'DELETE_REQUEST_NOT_SINGLE');receipt.checks.push({kind: 'real-confirmed-delete-and-pending-close-guard'});
   }
   pendingUi = null;assertSafe();gate.assertUnarmed();
  }
  await close();gate.assertUnarmed();assertSafe();
  check(receipt.upstreamDeleteRequests === receipt.acknowledgedDeletes, 'DELETE_ACK_COUNT_MISMATCH');
  const final = await ownerLedger.verifyFinalState({runId: binding.runId, revision: binding.expectedRevision, preSha256: binding.preSha256, checkpointHash: binding.checkpointHash, expectedOwnedStateHash: gate.currentStateHash(), acknowledgedDeletes: receipt.acknowledgedDeletes});
  check(final?.kind === 'current-owned-final-verification' && final.runId === binding.runId && final.revision === binding.expectedRevision && final.preSha256 === binding.preSha256 && final.checkpointHash === binding.checkpointHash && final.currentOwnedStateHash === gate.currentStateHash() && final.financialStateHash === binding.financialStateHash && final.untouchedRelationsMatch === true && final.preferencesUntouched === true && final.storageVersionsAccounted === true && final.tokenClockValid === true, 'OWNER_FINAL_STATE_MISMATCH');
  receipt.status = projectIncomePending ? 'READ_ONLY_PENDING_PROJECT_INCOME_AND_TASK' : unlinkedTaskOmitted ? 'READ_ONLY_PENDING_TASK' : deletePlan.some(item => item.mode === 'real') ? 'PASS' : 'READ_ONLY_PASS';
  receipt.pendingGates.push('warehouse-report-document uses the reviewed common adapter; creating a stock-linked payment is outside the owned two-payment fixture', 'selected-upload result uses local intercepted component proof; this run intentionally does not upload', 'unlinked CAD financial original may be natively read/downloaded by owner113; it has no independent catalogue UI');
 } catch (error) {receipt.status = 'STOP';receipt.phase = phase;receipt.code = fatal ?? plainFileListSafeError(error);gate.stop();}
 finally {pendingUi?.release.resolve(false);await close();if (browser) await browser.close();}
 return receipt;
}