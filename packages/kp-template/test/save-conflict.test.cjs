const assert = require('node:assert/strict');
const { test } = require('node:test');
const createTransport = require('../assets/public/js/crm-transport.js');
const copy = value => JSON.parse(JSON.stringify(value));
const response = (value, status = 200) => new Response(JSON.stringify(value), { status });
const failure = (code, status = 409) => response({ error: { code, message: code } }, status);
const tick = () => new Promise(resolve => setImmediate(resolve));
const initial = () => ({ id: 'primary', revision: 2, canEdit: true, project: { id: 'project', stage: 'LEAD' },
  client: { id: 'client', label: 'Клиент' }, fx: { currency: 'BYN', rate: '1', date: '2026-10-27', source: 'MANUAL' },
  state: { currency: 'BYN', items: [{ id: 'item', name: 'Шкаф' }], order: { project: 'Исходный' }, footer: 'Подпись', client: {} } });
function fixture() {
  const values = new Map(), calls = [], receipts = new Map();
  let remote = initial(), local = copy(remote.state), loseAck = false, lookupStatus = null, failBackup = false, beforePut, beforeRead;
  const api = createTransport({ actorId: 'actor', documentId: 'primary', apiBase: '/api/kp' }, {
    storage: { getItem: key => values.get(key) ?? null, removeItem: key => values.delete(key),
      setItem: (key, value) => { if (failBackup && key.includes('save-recovery:')) throw Error('QUOTA'); values.set(key, value); } },
    fetch: async (url, options) => {
      const body = options.body && JSON.parse(options.body); calls.push({ url, body, method: options.method });
      if (url.includes('/operations/')) {
        if (lookupStatus) return failure('LOOKUP_UNAVAILABLE', lookupStatus);
        const operationId = url.split('/').at(-1), result = receipts.get(operationId);
        return result ? response({ operationId, kind: 'document.save', result }) : failure('KP_OPERATION_NOT_FOUND', 404);
      }
      if (url.endsWith('/pdf')) return response({ id: 'job', state: 'SUCCEEDED', result: { downloadUrl: '/api/kp/artifacts/pdf/download', revision: body.expectedRevision } });
      if (options.method !== 'PUT') { if (beforeRead) await beforeRead(); return response(remote); }
      if (receipts.has(body.operationId)) return response(receipts.get(body.operationId));
      if (beforePut) await beforePut(body);
      if (body.expectedRevision !== remote.revision || !remote.canEdit) return failure('KP_REVISION_CHANGED');
      remote = { ...remote, revision: remote.revision + 1, state: copy(body.state), fx: copy(body.fx), client: body.clientId ? { id: body.clientId } : null };
      receipts.set(body.operationId, copy(remote));
      if (loseAck) { loseAck = false; throw new TypeError('ACK_LOST'); }
      return response(remote);
    } });
  api.focusDocument(copy(remote));
  api.attachEditor({ getState: () => copy(local), applyState: state => { local = copy(state); },
    applyDocument: doc => { local = copy(doc.state); api.focusDocument(doc); }, ensureSaved: () => api.save(local) });
  return { api, calls, values, receipts,
    get local() { return local; }, set local(value) { local = copy(value); },
    get remote() { return remote; }, set remote(value) { remote = copy(value); },
    set loseAck(value) { loseAck = value; }, set lookupStatus(value) { lookupStatus = value; }, set failBackup(value) { failBackup = value; },
    set beforePut(value) { beforePut = value; },
    set beforeRead(value) { beforeRead = value; },
    get puts() { return calls.filter(call => call.method === 'PUT'); },
    get backups() { return [...values].filter(([key]) => key.includes('save-recovery:')); }
  };
}
const pendingKey = 'pero-crm-kp:actor:primary:operation:save';
function stale(f) {
  const body = { operationId: 'old-operation', proposalId: 'primary', expectedRevision: 1, state: initial().state, fx: initial().fx, clientId: 'client' };
  f.values.set(pendingKey, JSON.stringify({ fingerprint: 'historical', body })); return body;
}

test('stale persisted save retries exact UUID then saves newer edits without backup copies', async () => {
  const f = fixture(), old = stale(f); f.local.footer = 'Новая подпись';
  const result = await f.api.save(f.local);
  assert.equal(result.revision, 3); assert.equal(result.state.footer, 'Новая подпись');
  assert.deepEqual(f.puts[0].body, old); assert.equal(f.puts.length, 2);
  assert.notEqual(f.puts[1].body.operationId, old.operationId); assert.equal(f.puts[1].body.expectedRevision, 2);
  assert.equal(f.values.has(pendingKey), false); assert.equal(f.backups.length, 0);
});

test('unknown ACK and unknown operation lookup retain exact UUID/body', async () => {
  const f = fixture(); f.local.footer = 'Правка'; f.loseAck = true;
  await assert.rejects(f.api.save(f.local), /ACK_LOST/); const old = copy(f.puts[0].body);
  await f.api.save(f.local); assert.deepEqual(f.puts[1].body, old); assert.equal(f.backups.length, 0);
  const unknown = fixture(); stale(unknown); unknown.lookupStatus = 503;
  await assert.rejects(unknown.api.save(unknown.local));
  assert.equal(JSON.parse(unknown.values.get(pendingKey)).body.operationId, 'old-operation');
  assert.equal(unknown.puts.length, 1); assert.equal(unknown.backups.length, 0);
});

test('old confirmed receipt cannot regress a newer loaded revision', async () => {
  const f = fixture(), old = stale(f);
  f.receipts.set(old.operationId, { ...initial(), revision: 1 }); f.local.footer = 'Новая подпись';
  assert.equal((await f.api.save(f.local)).revision, 3);
  assert.equal(f.puts[1].body.expectedRevision, 2); assert.equal(f.api.getDocument().revision, 3);
});

test('newer server snapshot wins as a whole without a PUT or conflict dialog', async () => {
  const f = fixture(); f.local.footer = 'Локальная'; f.api.noteEdit(f.local);
  f.remote = { ...f.remote, revision: 3, updatedAt: '2099-01-01T00:00:00.000Z', state: { ...f.remote.state, footer: 'Серверная', order: { project: 'Агент' } } };
  const result = await f.api.save(f.local);
  assert.equal(result.state.footer, 'Серверная'); assert.equal(f.local.order.project, 'Агент'); assert.equal(f.puts.length, 0);
  assert.equal(f.backups.length, 0); assert.equal(f.values.has(f.api.localDraftKey()), false);
});

test('newer local snapshot replaces the whole older server snapshot', async () => {
  const f = fixture(); f.local.footer = 'Локальная'; f.api.noteEdit(f.local);
  f.remote = { ...f.remote, revision: 3, state: { ...f.remote.state, order: { project: 'Более старый сервер' } } };
  const result = await f.api.save(f.local);
  assert.equal(result.state.footer, 'Локальная'); assert.equal(result.state.order.project, 'Исходный');
  assert.equal(f.puts.length, 1); assert.equal(f.puts[0].body.expectedRevision, 3);
});

test('locked server stage is refreshed without a force write', async () => {
  const f = fixture(); f.local.footer = 'Локальная';
  f.remote = { ...f.remote, revision: 3, canEdit: false, project: { id: 'project', stage: 'DONE' } };
  const result = await f.api.save(f.local); assert.equal(result.canEdit, false); assert.equal(f.puts.length, 0);
});

test('only one automatic retry is allowed and PDF receives the final saved revision', async () => {
  const repeated = fixture(); let attempt = 0;
  repeated.beforePut = () => { repeated.remote = { ...repeated.remote, revision: repeated.remote.revision + 1 }; attempt++; };
  repeated.local.footer = 'Правка'; await assert.rejects(repeated.api.save(repeated.local)); assert.equal(attempt, 2);
  const f = fixture(); stale(f); f.local.footer = 'Для PDF';
  const first = f.api.save(f.local), pdf = f.api.generatePdf(); await first;
  const result = await pdf;
  assert.equal(result.revision, f.remote.revision); assert.equal(f.remote.state.footer, 'Для PDF');
});

test('clean restored client including authoritative null stays clean and flush sends no PUT', async () => {
  for (const client of [initial().client, null]) {
    const f = fixture();
    f.remote = { ...f.remote, client, state: { ...f.remote.state, client: { crmId: 'technical-client-id' } } };
    f.local = f.remote.state; f.api.focusDocument(copy(f.remote));
    f.api.attachEditor({ getState: () => copy(f.local), ensureSaved: () => f.api.hasUnsavedChanges(f.local) ? f.api.save(f.local) : f.api.getDocument() });
    f.api.restoreDraftContext({ state: f.local, fx: f.remote.fx, client });
    assert.equal(f.api.hasUnsavedChanges(f.local), false);
    assert.deepEqual(f.api.getDocument().client, client);
    await f.api.handleCommand({ type: 'flush' }); assert.equal(f.puts.length, 0);
  }
  const dirty = fixture();
  dirty.remote = { ...dirty.remote, fx: { ...dirty.remote.fx, currency: 'USD', rate: '3' }, state: { ...dirty.remote.state, currency: 'USD' } };
  dirty.local = dirty.remote.state; dirty.api.focusDocument(copy(dirty.remote));
  const fx = { ...dirty.remote.fx, rate: '3.25' };
  dirty.api.restoreDraftContext({ fx, client: { id: 'new-client', label: 'Выбранный клиент' } });
  assert.equal(dirty.api.hasUnsavedChanges(dirty.local), true);
  await dirty.api.save(dirty.local);
  assert.deepEqual(dirty.puts[0].body.fx, fx); assert.equal(dirty.puts[0].body.clientId, 'new-client');
});
