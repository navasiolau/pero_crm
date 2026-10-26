const assert = require('node:assert/strict');
const { test } = require('node:test');
const createTransport = require('../assets/public/js/crm-transport.js');
const { collectProposalPages } = require('../browser.js');
const copy = value => JSON.parse(JSON.stringify(value));
function fixture(handler, actorId = 'actor', values = new Map()) {
  const calls = [], emitted = [];
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const api = createTransport({ actorId, documentId: 'primary', apiBase: '/api/kp' }, { storage, emit: message => emitted.push(message), uuid: () => crypto.randomUUID(),
    fetch: async (url, options) => { const call = { url, options, body: typeof options.body === 'string' ? JSON.parse(options.body) : options.body }; calls.push(call); return handler(call, calls); } });
  return { api, calls, emitted, values };
}
const doc = () => ({ id: 'primary', revision: 2, state: { currency: 'BYN', items: [{ id: 'position', qty: 2, name: 'Шкаф' }], client: {} },
  canEdit: true, client: { id: 'client', label: 'Клиент' }, project: { id: 'project', number: '231', stage: 'LEAD' }, fx: { currency: 'BYN', rate: '1', date: '2026-10-18', source: 'NBRB' } });
const response = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });

test('save and PDF export use session, wait for ACK and send only saved revision to jobs', async () => {
  let saved = doc();
  const testbed = fixture(async call => {
    assert.equal(call.options.credentials, 'same-origin'); assert.equal(call.options.headers?.Authorization, undefined);
    if (call.url.endsWith('/pdf')) {
      assert.equal(call.body.expectedRevision, 3); assert.equal(call.body.state, undefined);
      return response({ id: 'job', state: 'SUCCEEDED', result: { artifactId: 'artifact', versionId: 'version', fileName: 'КП.pdf', mimeType: 'application/pdf', downloadUrl: '/api/kp/artifacts/artifact/download' } });
    }
    assert.equal(call.options.method, 'PUT'); assert.equal(call.body.expectedRevision, 2); assert.ok(call.body.operationId);
    saved = { ...saved, revision: 3, state: call.body.state }; return response(saved);
  });
  testbed.api.focusDocument(saved); testbed.api.attachEditor({ ensureSaved: () => testbed.api.save(saved.state) });
  assert.equal((await testbed.api.generatePdf()).artifactId, 'artifact');
  assert.deepEqual(testbed.calls.map(call => call.url), ['/api/kp/documents/primary', '/api/kp/documents/primary/pdf']);
});

test('lost save ACK replays exact UUID and body before another state may be saved', async () => {
  let receipt;
  const testbed = fixture(async (call, calls) => {
    receipt ??= { ...doc(), revision: 3, state: call.body.state };
    if (calls.length === 1) throw new TypeError('SYNTHETIC_ACK_LOSS');
    return response(receipt);
  });
  testbed.api.focusDocument(doc()); await assert.rejects(testbed.api.save(doc().state), /SYNTHETIC_ACK_LOSS/);
  const original = copy(testbed.calls[0].body);
  assert.equal((await testbed.api.save(doc().state)).revision, 3);
  assert.deepEqual(testbed.calls[1].body, original); assert.equal(testbed.calls.length, 2);
});

test('pending save preserves exact replay and latest corrected state or explicit FX intent', async () => {
  let attempts = 0;
  const handler = async call => {
    if (++attempts === 1) throw new TypeError('SYNTHETIC_ACK_LOSS');
    if (call.body.state.items[0].price >= 10_000_000_000) return new Response(JSON.stringify({
      error: { code: 'KP_PRICING_INVALID', message: 'Сумма КП превышает допустимый предел CRM' }
    }), { status: 400, headers: { 'content-type': 'application/json' } });
    return response({ ...doc(), revision: 3, state: call.body.state });
  };
  const testbed = fixture(handler);
  const invalid = { ...doc().state, delivery: { visible: true, mode: 'items', items: [{ name: 'Доставка', price: 30 }] } };
  invalid.items[0].price = 10_000_000_000;
  testbed.api.focusDocument(doc());
  await assert.rejects(testbed.api.save(invalid), /ACK_LOSS/);
  const original = copy(testbed.calls[0].body);
  const storageKey = 'pero-crm-kp:actor:primary:operation:save';
  assert.deepEqual(JSON.parse(testbed.values.get(storageKey)).body, original);
  const reloaded = fixture(handler, 'actor', testbed.values);
  reloaded.api.focusDocument(doc());
  const corrected = copy(invalid);
  corrected.delivery.items[0].crmKind = 'DELIVERY'; corrected.items[0].price = 150.75;
  corrected.items[0].name = 'Исправленное изделие'; corrected.discount = 7;
  const saved = await reloaded.api.save(corrected);
  assert.deepEqual(reloaded.calls[0].body, original);
  assert.equal(attempts, 3); assert.equal(reloaded.calls.length, 2);
  assert.notEqual(reloaded.calls[1].body.operationId, original.operationId);
  assert.deepEqual(reloaded.calls[1].body.state, corrected);
  assert.deepEqual(saved.state, corrected);
  assert.equal(testbed.values.has(storageKey), false);

  let fxAttempts = 0;
  const fxHandler = async call => {
    if (++fxAttempts === 1) throw new TypeError('SYNTHETIC_ACK_LOSS');
    if (call.body.fx.rate !== '1') return new Response(JSON.stringify({
      error: { code: 'KP_PRICING_INVALID', message: 'Курс КП не соответствует валюте' }
    }), { status: 400, headers: { 'content-type': 'application/json' } });
    return response({ ...doc(), revision: 3, state: call.body.state, fx: call.body.fx });
  };
  const fxState = doc().state, invalidFx = { ...doc().fx, rate: '2', source: 'MANUAL' };
  const fxFirst = fixture(fxHandler); fxFirst.api.focusDocument(doc());
  fxFirst.api.attachEditor({ ensureSaved: () => fxFirst.api.save(fxState) });
  await assert.rejects(fxFirst.api.handleCommand({ type: 'fx', fx: invalidFx }), /ACK_LOSS/);
  const originalFxBody = copy(fxFirst.calls[0].body);
  const fxReloaded = fixture(fxHandler, 'actor', fxFirst.values); fxReloaded.api.focusDocument(doc());
  fxReloaded.api.attachEditor({ ensureSaved: () => fxReloaded.api.save(fxState) });
  const correctedFx = { ...invalidFx, rate: '1' };
  await fxReloaded.api.handleCommand({ type: 'fx', fx: correctedFx });
  assert.deepEqual(fxReloaded.calls[0].body, originalFxBody);
  assert.equal(fxAttempts, 3); assert.equal(fxReloaded.calls.length, 2);
  assert.notEqual(fxReloaded.calls[1].body.operationId, originalFxBody.operationId);
  assert.deepEqual(fxReloaded.calls[1].body.state, originalFxBody.state);
  assert.deepEqual(fxReloaded.api.getDocument().fx, correctedFx);
  assert.equal(fxFirst.values.has(storageKey), false);

  const successState = { ...doc().state, currency: '$' };
  const initialDoc = { ...doc(), state: successState, fx: { ...doc().fx, currency: 'USD', rate: '3.125' } };
  const oldManualFx = { ...initialDoc.fx, rate: '3.2', source: 'MANUAL' }, latestManualFx = { ...oldManualFx, rate: '3.3' };
  let committed, receipt, oldBody;
  const successful = fixture(async call => {
    if (call.url.endsWith('/pdf')) {
      assert.equal(call.body.expectedRevision, committed.revision);
      assert.deepEqual(committed.fx, latestManualFx);
      return response({ id: 'job', state: 'SUCCEEDED', result: { artifactId: 'latest-pdf', fileName: 'КП.pdf', downloadUrl: '/api/kp/artifacts/latest-pdf/download' } });
    }
    if (!oldBody) {
      oldBody = copy(call.body); committed = { ...initialDoc, revision: 3, state: call.body.state, fx: call.body.fx };
      receipt = copy(committed); throw new TypeError('SYNTHETIC_ACK_LOSS_AFTER_COMMIT');
    }
    if (call.body.operationId === oldBody.operationId) return response(receipt);
    assert.equal(call.body.expectedRevision, receipt.revision);
    committed = { ...committed, revision: 4, state: call.body.state, fx: call.body.fx };
    return response(committed);
  });
  successful.api.focusDocument(initialDoc);
  successful.api.attachEditor({ ensureSaved: () => successful.api.hasUnsavedChanges(successState)
    ? successful.api.save(successState) : Promise.resolve(successful.api.getDocument()) });
  await assert.rejects(successful.api.handleCommand({ type: 'fx', fx: oldManualFx }), /ACK_LOSS_AFTER_COMMIT/);
  await successful.api.handleCommand({ type: 'fx', fx: latestManualFx });
  assert.deepEqual(successful.calls[1].body, oldBody);
  assert.equal(successful.calls.length, 3);
  assert.notEqual(successful.calls[2].body.operationId, oldBody.operationId);
  assert.deepEqual(successful.calls[2].body.state, oldBody.state);
  assert.deepEqual(successful.calls[2].body.fx, latestManualFx);
  assert.deepEqual(successful.api.getDocument().fx, latestManualFx);
  assert.equal((await successful.api.generatePdf()).artifactId, 'latest-pdf');
  assert.equal(successful.calls.length, 4);
});

test('additional contract source never replaces focused proposal and contracts omit browser states', async () => {
  const baseline = 'original-client-baseline';
  const testbed = fixture(async call => {
    if (call.url === '/api/kp/documents/other') return response({ ...doc(), id: 'other', revision: 8 });
    if (call.options.method === undefined) return response({ contractId: 'contract', revision: 5, clientBaseline: baseline, settings: {}, profiles: [], sourceRefs: [{ proposalId: 'primary', expectedRevision: 2 }] });
    if (call.url === '/api/kp/contracts') {
      assert.equal(call.body.primaryState, undefined); assert.equal(call.body.clientBaseline, baseline);
      assert.deepEqual(call.body.sourceRefs, [{ proposalId: 'primary', expectedRevision: 2 }, { proposalId: 'other', expectedRevision: 8 }]);
      return response({ revision: 6, clientBaseline: 'acknowledged-client-baseline' });
    }
    assert.equal(call.url, '/api/kp/contract'); assert.equal(call.body.clientBaseline, 'acknowledged-client-baseline'); assert.equal(call.body.expectedRevision, 6);
    assert.equal(call.body.settings, undefined); assert.equal(call.body.primaryState, undefined); assert.equal(call.body.sourceVersions, undefined);
    return response({ id: 'job', state: 'SUCCEEDED', result: { artifactId: 'docx', versionId: 'contract-version', fileName: 'Договор.docx', downloadUrl: '/api/kp/artifacts/docx/download' } });
  });
  testbed.api.focusDocument(doc());
  await testbed.api.request('/api/documents?id=other'); assert.equal(testbed.api.getDocumentId(), 'primary');
  await testbed.api.request('/api/contracts?documentId=primary');
  await testbed.api.request('/api/contracts', { method: 'PUT', body: JSON.stringify({ documentId: 'primary', settings: { proposalIds: ['primary', 'other'] }, primaryState: { FORGED: true } }) });
  await testbed.api.request('/api/contract', { method: 'POST', body: JSON.stringify({ documentId: 'primary', primaryState: { FORGED: true } }) });
});

test('structured client selection refreshes full sidecar without interpreting printed name as fields', async () => {
  let state = doc().state;
  const testbed = fixture(async call => response({ ...doc(), revision: 3, state: call.body.state, client: { id: call.body.clientId, label: 'Юридический клиент' } }));
  testbed.api.focusDocument(doc()); testbed.api.attachEditor({ getState: () => copy(state), applyState: next => { state = next; }, ensureSaved: () => testbed.api.save(state) });
  const client = { id: 'real-client', label: 'ООО Клиент', isTemporary: false, snapshot: { id: 'real-client', name: 'ООО Клиент', lastName: null, middleName: null,
    phone: '+000', email: 'fixture@example.invalid', address: 'Адрес', comment: null, passportNumber: 'fixture', passportIssuedBy: 'fixture' } };
  await testbed.api.handleCommand({ type: 'client', client });
  assert.deepEqual(testbed.calls[0].body.state.client.crmSnapshot, client.snapshot);
  assert.equal(testbed.calls[0].body.state.client.crmId, 'real-client'); assert.equal(testbed.calls[0].body.clientId, 'real-client');
  assert.equal(testbed.calls[0].body.state.client.name, 'ООО Клиент'); assert.equal(testbed.calls[0].body.state.client.contact, '+000');
});

test('read-only and omitted DELETE fail without transport; private media and draft keys stay scoped', async () => {
  const testbed = fixture(() => { throw Error('UNEXPECTED_NETWORK'); });
  testbed.api.focusDocument({ ...doc(), canEdit: false });
  await assert.rejects(testbed.api.save(doc().state), /просмотра/);
  await assert.rejects(testbed.api.request('/api/documents?id=primary', { method: 'DELETE' }), /проект/);
  assert.equal(testbed.calls.length, 0);
  assert.equal(testbed.api.mediaUrl('https://example.invalid/private'), '');
  assert.equal(testbed.api.mediaUrl('kp-media:photo'), '/api/kp/documents/primary/media/photo?variant=optimized&scope=current');
  const original = testbed.api.localDraftKey(); testbed.api.focusDocument({ ...doc(), revision: 3 }); assert.notEqual(testbed.api.localDraftKey(), original);
  const other = fixture(() => {}, 'other-actor'); other.api.focusDocument(doc()); assert.notEqual(other.api.localDraftKey(), original);
});

test('known failed job permits a fresh Generate, while a lost export ACK retains its exact UUID', async () => {
  for (const mode of ['terminal', 'unknown']) {
    const testbed = fixture(async (call, calls) => {
      if (calls.length === 1) {
        if (mode === 'unknown') throw new TypeError('SYNTHETIC_EXPORT_ACK_LOSS');
        return response({ id: 'failed-job', state: 'FAILED', error: 'Сбой рендера' });
      }
      return response({ id: 'ready-job', state: 'SUCCEEDED', result: { fileName: 'КП.pdf', downloadUrl: '/api/kp/artifacts/pdf/download' } });
    });
    testbed.api.focusDocument(doc()); testbed.api.attachEditor({ ensureSaved: async () => doc() });
    await assert.rejects(testbed.api.generatePdf(), mode === 'terminal' ? /Сбой/ : /ACK_LOSS/);
    await testbed.api.generatePdf();
    if (mode === 'terminal') assert.notEqual(testbed.calls[0].body.operationId, testbed.calls[1].body.operationId);
    else assert.deepEqual(testbed.calls[0].body, testbed.calls[1].body);
  }

  const failure = (code, status) => new Response(JSON.stringify({ error: { code, message: 'Обновите данные КП и повторите действие' } }),
    { status, headers: { 'content-type': 'application/json' } });
  const ready = id => ({ id: 'job-' + id, state: 'SUCCEEDED', result: { artifactId: id, fileName: 'КП.pdf', downloadUrl: '/api/kp/artifacts/' + id + '/download' } });
  const storageKey = 'pero-crm-kp:actor:primary:operation:pdf';
  let authoritative = doc(), freshPosts = 0;
  const stale = fixture(async call => {
    if (call.options.method === 'PUT') { authoritative = { ...authoritative, revision: 3, state: call.body.state }; return response(authoritative); }
    if (call.url.startsWith('/api/kp/operations/')) return failure('KP_OPERATION_NOT_FOUND', 404);
    if (call.url === '/api/kp/documents/primary') return response(authoritative);
    if (call.body.expectedRevision !== authoritative.revision) return failure('KP_REVISION_CHANGED', 409);
    freshPosts++; return response(ready('current'));
  });
  const oldBody = { operationId: crypto.randomUUID(), proposalId: 'primary', expectedRevision: 1 };
  stale.values.set(storageKey, JSON.stringify({ fingerprint: JSON.stringify({ proposalId: 'primary', expectedRevision: 1 }), body: oldBody }));
  stale.api.focusDocument(doc());
  const edited = copy(doc().state); edited.items[0].name = 'После ручного сохранения';
  await stale.api.save(edited);
  stale.api.attachEditor({ ensureSaved: async () => stale.api.getDocument() });
  assert.equal((await stale.api.generatePdf()).artifactId, 'current');
  assert.deepEqual(stale.calls[1].body, oldBody);
  assert.deepEqual(stale.calls.slice(1).map(call => call.url), ['/api/kp/documents/primary/pdf', '/api/kp/operations/' + oldBody.operationId,
    '/api/kp/documents/primary', '/api/kp/documents/primary/pdf']);
  assert.equal(stale.calls.at(-1).body.expectedRevision, 3);
  assert.notEqual(stale.calls.at(-1).body.operationId, oldBody.operationId);
  assert.equal(freshPosts, 1);
  authoritative = { ...authoritative, revision: 4 };
  await assert.rejects(stale.api.generatePdf(), error => error.status === 409);
  assert.equal(freshPosts, 1);
  assert.equal(stale.api.getDocument().revision, 3);
  assert.deepEqual(stale.api.getDocument().state, edited);
  assert.equal(JSON.parse(stale.values.get(storageKey)).body.expectedRevision, 3);
  assert.equal(stale.calls.filter(call => call.options.method === 'POST').some(call => call.body.expectedRevision === 4), false);

  const releases = new Map(); let committed = doc(), oldRequest;
  const unknown = fixture(async call => {
    if (call.options.method === 'PUT') { committed = { ...committed, revision: 3, state: call.body.state }; return response(committed); }
    if (call.url === '/api/kp/documents/primary') return response(committed);
    if (call.url === '/api/kp/jobs/job-old') return response(ready('old'));
    if (releases.has(call.body.operationId)) return response({ id: 'job-old', state: 'PENDING' });
    const id = releases.size ? 'latest' : 'old'; releases.set(call.body.operationId, ready(id));
    if (id === 'old') { oldRequest = copy(call.body); throw new TypeError('SYNTHETIC_EXPORT_ACK_LOSS'); }
    assert.equal(call.body.expectedRevision, committed.revision); return response(ready(id));
  });
  unknown.api.focusDocument(doc()); unknown.api.attachEditor({ ensureSaved: async () => unknown.api.getDocument() });
  await assert.rejects(unknown.api.generatePdf(), /ACK_LOSS/);
  await unknown.api.save(edited);
  assert.equal((await unknown.api.generatePdf()).artifactId, 'latest');
  const posts = unknown.calls.filter(call => call.options.method === 'POST');
  assert.deepEqual(posts[1].body, oldRequest);
  assert.notEqual(posts[2].body.operationId, oldRequest.operationId);
  assert.equal(posts[2].body.expectedRevision, 3);
  assert.ok(unknown.calls.findIndex(call => call.url === '/api/kp/jobs/job-old') < unknown.calls.indexOf(posts[2]));
  assert.equal(releases.size, 2);
});

test('long PDF polling reconnects to the same job after transient failures without a new operation', async t => {
  let now = 0, reads = 0; const delays = [];
  t.mock.method(Date, 'now', () => now);
  t.mock.method(global, 'setTimeout', (callback, delay) => { delays.push(delay); queueMicrotask(callback); return 0; });
  const testbed = fixture(async call => {
    if (call.options.method === 'POST') return response({ id: 'long-job', state: 'PROCESSING' });
    assert.equal(call.url, '/api/kp/jobs/long-job'); now += 121_000; reads++;
    if (reads === 1) throw new TypeError('SYNTHETIC_NETWORK_LOSS');
    if (reads < 4) return new Response(JSON.stringify({ error: { message: 'Повторите чтение задания' } }), { status: reads === 2 ? 429 : 503 });
    assert.equal(testbed.values.has('pero-crm-kp:actor:primary:operation:pdf'), true);
    return response(reads === 4 ? { id: 'long-job', state: 'PENDING' } : { id: 'long-job', state: 'SUCCEEDED',
      result: { artifactId: 'long-pdf', fileName: 'КП.pdf', downloadUrl: '/api/kp/artifacts/long-pdf/download' } });
  });
  testbed.api.focusDocument(doc()); testbed.api.attachEditor({ ensureSaved: async () => doc() });
  assert.equal((await testbed.api.generatePdf()).artifactId, 'long-pdf');
  assert.equal(reads, 5); assert.ok(now > 180_000);
  assert.equal(testbed.calls.filter(call => call.options.method === 'POST').length, 1);
  assert.equal(testbed.values.has('pero-crm-kp:actor:primary:operation:pdf'), false);
  assert.deepEqual(delays, [750, 1500, 3000, 5000, 750]);
});

test('private upload scope survives reload and becomes current only after the saved snapshot ACK', async () => {
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const make = () => createTransport({ actorId: 'actor', documentId: 'primary', apiBase: '/api/kp' }, { storage,
    fetch: async (_url, options) => options.method === 'POST' ? response({ mediaId: 'photo', reference: 'kp-media:photo' }) : response({ ...doc(), revision: 3, state: JSON.parse(options.body).state }) });
  const first = make(); first.focusDocument(doc());
  await first.upload(new File(['fixture'], 'source.png', { type: 'image/png' }), new File(['optimized'], 'source.jpg', { type: 'image/jpeg' }));
  assert.ok(first.mediaUrl('kp-media:photo').endsWith('scope=uploaded'));
  const reloaded = make(); reloaded.focusDocument(doc()); assert.ok(reloaded.mediaUrl('kp-media:photo').endsWith('scope=uploaded'));
  const state = doc().state; state.items[0].image = 'kp-media:photo';
  await reloaded.save(state); assert.ok(reloaded.mediaUrl('kp-media:photo').endsWith('scope=current'));
});

test('clean state comparison ignores key order but detects an explicitly changed fixed rate', () => {
  const testbed = fixture(() => { throw Error('UNEXPECTED_NETWORK'); }); const document = doc();
  testbed.api.focusDocument(document);
  assert.equal(testbed.api.hasUnsavedChanges({ client: {}, items: document.state.items, currency: 'BYN' }), false);
  assert.equal(testbed.api.hasUnsavedChanges({ ...document.state, discount: 1 }), true);
  document.fx = { ...document.fx, rate: '1.1', source: 'MANUAL' };
  assert.equal(testbed.api.hasUnsavedChanges(document.state), true);
});

test('proposal lists traverse every cursor and preserve archive number and printed client without a fake client relation', async () => {
  const rows = Array.from({ length: 101 }, (_, index) => ({ id: 'archive-' + index, number: String(100 + index),
    name: 'Помещение ' + index, printedClientName: 'Архивный клиент ' + index, client: null, project: null }));
  const testbed = fixture(async call => {
    const cursor = new URL(call.url, 'https://fixture.invalid').searchParams.get('cursor'), offset = Number(cursor ?? 0);
    return response({ documents: rows.slice(offset, offset + 50), nextCursor: offset < 100 ? String(offset + 50) : null });
  });
  const result = await testbed.api.request('/api/documents');
  assert.equal(result.documents.length, 101);
  assert.deepEqual(testbed.calls.map(call => call.url), ['/api/kp/documents', '/api/kp/documents?cursor=50', '/api/kp/documents?cursor=100']);
  assert.equal(result.documents[100].name, 'КП №200 — Архивный клиент 100');
  assert.equal(result.documents[100].client, null);
  assert.equal(result.documents[100].project, null);
  await assert.rejects(collectProposalPages(async () => ({ documents: [], nextCursor: 'repeated' })), /продолжить/);
});

test('lost contract-settings ACK is recovered before saving a newer form with the acknowledged revision and baseline', async () => {
  const form = { revision: 5, clientBaseline: 'baseline-five', settings: {}, sourceRefs: [{ proposalId: 'primary', expectedRevision: 2 }] };
  const testbed = fixture(async (call, calls) => {
    if (!call.options.method) return response(form);
    const writes = calls.filter(call => call.options.method === 'PUT');
    if (writes.length === 1) throw new TypeError('SYNTHETIC_CONTRACT_ACK_LOSS');
    if (writes.length === 2) {
      assert.deepEqual(writes[1].body, writes[0].body);
      return response({ revision: 6, clientBaseline: 'baseline-six', sourceRefs: form.sourceRefs });
    }
    assert.equal(call.body.expectedRevision, 6); assert.equal(call.body.clientBaseline, 'baseline-six');
    assert.equal(call.body.settings.number, 'newer');
    return response({ revision: 7, clientBaseline: 'baseline-seven', sourceRefs: form.sourceRefs });
  });
  testbed.api.focusDocument(doc()); await testbed.api.request('/api/contracts?documentId=primary');
  const saveSettings = number => testbed.api.request('/api/contracts', { method: 'PUT', body: JSON.stringify({ documentId: 'primary', settings: { proposalIds: ['primary'], number } }) });
  await assert.rejects(saveSettings('older'), /ACK_LOSS/);
  assert.equal((await saveSettings('newer')).revision, 7);
  assert.equal(testbed.calls.filter(call => call.options.method === 'PUT').length, 3);
});

test('version restore retries the same operation after a lost ACK and restores by the live revision', async () => {
  const testbed = fixture(async (call, calls) => {
    if (!call.options.method) return response({ document: { ...doc(), revision: 1, canEdit: false } });
    assert.equal(call.body.expectedRevision, 2);
    if (calls.length === 2) throw new TypeError('SYNTHETIC_RESTORE_ACK_LOSS');
    assert.deepEqual(call.body, calls[1].body);
    return response({ ...doc(), revision: 3 });
  });
  testbed.api.focusDocument(doc()); testbed.api.attachEditor({ ensureSaved: async () => doc(), applyDocument: () => {} });
  await testbed.api.handleCommand({ type: 'version', versionId: 'historical' });
  await assert.rejects(testbed.api.handleCommand({ type: 'restore' }), /ACK_LOSS/);
  await testbed.api.handleCommand({ type: 'restore' });
  assert.equal(testbed.api.getDocument().revision, 3);
});
