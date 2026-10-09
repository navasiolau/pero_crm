import assert from 'node:assert/strict';
import test from 'node:test';
import {pinPlannedUiMultipart, selectedUiReadRequest, openSelectedFinanceUploadDialog} from './plain-file-lists-selected-upload-ui.mjs';
const origin = 'https://staging-crm.peromebel.by', url = origin + '/api/finance/documents/upload';
const uiNonce = '11111111-1111-4111-8111-111111111111', plannedNonce = '22222222-2222-4222-8222-222222222222';
async function source(extra = null, nonce = uiNonce) {
 const form = new FormData();form.set('file', new File([Uint8Array.from([1, 2, 3])], 'synthetic-only.png', {type: 'image/png'}));form.set('clientMutationId', nonce);if (extra) form.append(extra, 'not-allowed');
 const request = new Request(url, {method: 'POST', body: form});return {body: new Uint8Array(await request.arrayBuffer()), contentType: request.headers.get('content-type')};
}

test('genuine browser multipart pins only a source-backed planned nonce after durable mapping, preserving original file bytes name MIME and two-field shape', async () => {
 const initial = await source(), captures = [], bridge = {beforeUpstream: async input => {captures.push(input);return {recorded: true, effectiveMutationId: plannedNonce, mappingSha256: 'a'.repeat(64)};}};
 const pinned = await pinPlannedUiMultipart({...initial, requestUrl: url, actorId: 'fresh-admin', bridge});
 assert.equal(captures.length, 1);assert.equal(captures[0].uiMutationId, uiNonce);assert.equal(captures[0].actorId, 'fresh-admin');assert.deepEqual([...captures[0].bytes], [1, 2, 3]);assert.equal(captures[0].fileName, 'synthetic-only.png');assert.equal(captures[0].mimeType, 'image/png');
 const form = await new Request(url, {method: 'POST', headers: {'content-type': pinned.contentType}, body: pinned.body}).formData();
 assert.deepEqual([...form.keys()].sort(), ['clientMutationId', 'file']);assert.equal(form.get('clientMutationId'), plannedNonce);const file = form.get('file');assert.equal(file.name, 'synthetic-only.png');assert.equal(file.type, 'image/png');assert.deepEqual([...new Uint8Array(await file.arrayBuffer())], [1, 2, 3]);
});

test('extra multipart fields or malformed actual UI UUID are rejected before bridge publication or upstream', async () => {
 let published = 0;const bridge = {beforeUpstream: async () => {published++;throw Error('MUST_NOT_BE_CALLED');}};
 for (const initial of [await source('projectId'), await source(null, 'arbitrary')]) await assert.rejects(pinPlannedUiMultipart({...initial, requestUrl: url, actorId: 'fresh-admin', bridge}), /U115_EXACT_ACTUAL_UI_MULTIPART_REQUIRED/);
 assert.equal(published, 0);
});

test('unrecorded mapping, unknown nonce or missing mapping hash never returns a forwarded request', async () => {
 for (const mapping of [{recorded: false, effectiveMutationId: plannedNonce, mappingSha256: 'a'.repeat(64)}, {recorded: true, effectiveMutationId: 'bad', mappingSha256: 'a'.repeat(64)}, {recorded: true, effectiveMutationId: plannedNonce}]) {
  await assert.rejects(pinPlannedUiMultipart({...await source(), requestUrl: url, actorId: 'fresh-admin', bridge: {beforeUpstream: async () => mapping}}), /U115_DURABLE_PLANNED_NONCE_MAPPING_REQUIRED/);
 }
});

test('source-backed bridge refusal preserves the browser request without a synthetic ACK or fallback nonce', async () => {
 const initial = await source(), before = [...initial.body];await assert.rejects(pinPlannedUiMultipart({...initial, requestUrl: url, actorId: 'fresh-admin', bridge: {beforeUpstream: async () => {throw Error('ACTUAL_PARENT_BYTES_MISMATCH');}}}), /ACTUAL_PARENT_BYTES_MISMATCH/);assert.deepEqual([...initial.body], before);
});

test('selected upload guard allows own finance GET plus exactly one upload candidate and blocks all money prefs files exports and foreign origins', () => {
 const binding = {origin, paths: {financeProject: '/finance/projects/fresh-project'}};
 for (const path of ['/finance/projects/fresh-project', '/api/auth/session', '/api/health', '/_next/static/chunks/own.js']) assert.equal(selectedUiReadRequest({url: origin + path, method: 'GET'}, binding), 'allow');
 assert.equal(selectedUiReadRequest({url, method: 'POST'}, binding), 'candidate-upload');
 for (const path of ['/api/payments', '/api/files/upload', '/finance/projects/fresh-project', '/api/preferences']) assert.equal(selectedUiReadRequest({url: origin + path, method: 'POST'}, binding), 'block-write');
 for (const path of ['/api/finance/documents/original', '/api/files/original', '/finance/accounts/export', '/finance/projects/original']) assert.equal(selectedUiReadRequest({url: origin + path, method: 'GET'}, binding), 'deny');
 assert.equal(selectedUiReadRequest({url: 'https://crm.peromebel.by/api/finance/documents/upload', method: 'POST'}, binding), 'deny');
});
test('cold first OPEN retries only local dialog and stops after three hidden attempts without any upload', async () => {
 for (const opensAfter of [2, Infinity]) {
  let clicks = 0, visible = false;const attempts = [];
  const trigger = {count: async () => 1, isEnabled: async () => true, click: async () => {visible = ++clicks >= opensAfter;}};
  const dialog = {filter() {return this;}, count: async () => visible ? 1 : 0, isVisible: async () => visible, waitFor: async options => {assert.deepEqual(options, {state: 'visible', timeout: 2500});if (!visible) {const error = Error('controlled-timeout');error.name = 'TimeoutError';throw error;}}};
  const page = {getByRole: (role, options) => {if (role === 'dialog') return dialog;assert.equal(role, 'button');assert.deepEqual(options, {name: 'Добавить расход', exact: true});return trigger;}, locator: selector => {assert.equal(selector, '#pay-document');return {setInputFiles: () => assert.fail('OPEN must never upload')};}};
  if (Number.isFinite(opensAfter)) {assert.equal(await openSelectedFinanceUploadDialog(page, attempt => attempts.push(attempt)), dialog);assert.equal(clicks, 2);assert.deepEqual(attempts, [1, 2]);}
  else {await assert.rejects(openSelectedFinanceUploadDialog(page), /U115_EXPENSE_DIALOG_NOT_VISIBLE/);assert.equal(clicks, 3);}
 }
});
