const assert = require('node:assert/strict');
const { test } = require('node:test');
const createTransport = require('../assets/public/js/crm-transport.js');
const copy = value => JSON.parse(JSON.stringify(value));
const response = value => new Response(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const initial = () => ({ id: 'primary', revision: 2, canEdit: true, canChangeClient: true, project: { id: 'project' },
  client: { id: 'A', label: 'Клиент A' }, fx: { currency: 'BYN', rate: '1', date: '2026-10-27', source: 'MANUAL' },
  state: { currency: 'BYN', items: [], client: { crmId: 'A', name: 'Клиент A', contact: '' } } });
function selected(id, revision = 3) { const value = initial(); value.client = { id, label: id }; value.revision = revision; value.state.client = { crmId: id, name: id, contact: '' }; return value; }
function fixture(handler, document = initial()) {
  let state = copy(document.state), remote = copy(document);
  const calls = [], values = new Map();
  const api = createTransport({ actorId: 'actor', documentId: 'primary', apiBase: '/api/kp' }, {
    storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
    fetch: async (url, options) => {
      if (!options.method) return response(remote);
      const call = { url, method: options.method, body: JSON.parse(options.body) }; calls.push(call);
      const result = await handler(call, calls); if (result.ok) { const value = await result.clone().json(); if (value.revision >= remote.revision) remote = value; } return result;
    }
  });
  api.focusDocument(document);
  api.attachEditor({ getState: () => copy(state), applyState: value => { state = value; }, ensureSaved: () => api.save(state) });
  return { api, calls, values, set remote(value) { remote = copy(value); }, get state() { return state; } };
}
const select = (api, id = 'B') => api.handleCommand({ type: 'client', client: { id, label: id, snapshot: { id, phone: '' } } });

test('смена клиента ждёт сохранение и использует новую ревизию без полного PUT клиента', async () => {
  let release;
  const f = fixture(async call => {
    if (call.method === 'PUT') { await new Promise(resolve => { release = resolve; }); return response({ ...initial(), revision: 3, state: call.body.state }); }
    assert.equal(call.method, 'PATCH'); assert.equal(call.body.expectedRevision, 3);
    return response(selected(call.body.clientId, 4));
  });
  const first = f.api.save(initial().state); await tick();
  const change = select(f.api); release(); await Promise.all([first, change]);
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].body.state, undefined);
  assert.equal(f.calls[1].body.expectedClientId, 'A'); assert.equal(f.api.getDocument().client.id, 'B');
});

test('потерянный ACK сохранения повторяет исходный UUID до смены клиента', async () => {
  let original;
  const f = fixture(async (call, calls) => {
    if (calls.length === 1) { original = copy(call.body); throw new TypeError('ACK_LOST'); }
    if (calls.length === 2) return response({ ...initial(), revision: 3, state: original.state });
    return response(selected(call.body.clientId, 4));
  });
  await assert.rejects(f.api.save(initial().state), /ACK_LOST/);
  await select(f.api);
  assert.deepEqual(f.calls[1].body, original); assert.equal(f.calls[2].method, 'PATCH');
  assert.equal(f.calls[2].body.expectedRevision, 3); assert.equal(f.api.getDocument().client.id, 'B');
});

test('после Лида смена клиента доступна без сохранения состава КП', async () => {
  const f = fixture(async call => { assert.equal(call.method, 'PATCH'); return response({ ...selected('B'), canEdit: false }); }, { ...initial(), canEdit: false });
  await select(f.api); assert.equal(f.calls.length, 1); assert.equal(f.api.getDocument().client.id, 'B');
});

test('неизвестный результат смены клиента повторяет тот же PATCH и UUID', async () => {
  const f = fixture(async (_call, calls) => { if (calls.length === 1) throw new TypeError('ACK_LOST'); return response(selected('B')); });
  await assert.rejects(select(f.api), /ACK_LOST/); await select(f.api);
  assert.deepEqual(f.calls[1].body, f.calls[0].body); assert.equal(f.api.getDocument().client.id, 'B');
});

test('поздний ACK не отменяет более новый выбор проекта; поля заблокированы до свежего чтения', async () => {
  let release;
  const f = fixture(async () => { await new Promise(resolve => { release = resolve; }); return response(selected('B', 3)); });
  const changing = select(f.api); await tick();
  assert.equal(f.api.isEditable(), false);
  f.remote = selected('C', 4); release();
  await assert.rejects(changing, /Клиент уже изменён/);
  assert.equal(f.api.getDocument().client.id, 'C'); assert.equal(f.state.client.crmId, 'C'); assert.equal(f.api.isEditable(), true);
});
