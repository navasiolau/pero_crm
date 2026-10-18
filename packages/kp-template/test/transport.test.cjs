const assert = require('node:assert/strict');
const { test } = require('node:test');
const createTransport = require('../assets/public/js/crm-transport.js');
const { collectProposalPages } = require('../browser.js');
const copy = value => JSON.parse(JSON.stringify(value));
function fixture(handler, actorId = 'actor') {
  const values = new Map(), calls = [], emitted = [];
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
