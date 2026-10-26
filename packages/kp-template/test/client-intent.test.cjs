const assert = require('node:assert/strict');
const { test } = require('node:test');
const createTransport = require('../assets/public/js/crm-transport.js');
const copy = value => JSON.parse(JSON.stringify(value));
const response = value => new Response(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const initial = () => ({ id: 'primary', revision: 2, canEdit: true, project: { id: 'project' },
  client: { id: 'A', label: 'Клиент A' }, fx: { currency: 'BYN', rate: '1', date: '2026-10-27', source: 'MANUAL' },
  state: { currency: 'BYN', items: [], client: { crmId: 'A', name: 'Клиент A', contact: '' } } });
function fixture(handler) {
  let state = initial().state;
  const calls = [], values = new Map();
  const api = createTransport({ actorId: 'actor', documentId: 'primary', apiBase: '/api/kp' }, {
    storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
    fetch: async (url, options) => { const call = { url, body: JSON.parse(options.body) }; calls.push(call); return handler(call, calls); }
  });
  api.focusDocument(initial());
  api.attachEditor({ getState: () => copy(state), applyState: value => { state = value; }, ensureSaved: () => api.save(state) });
  return { api, calls, values };
}
const select = (api, id = 'B') => api.handleCommand({ type: 'client', client: {
  id, label: 'Клиент ' + id, isTemporary: id === 'temporary', snapshot: { id, phone: '' }
} });

test('new client selection survives an earlier in-flight save ACK', async () => {
  let release;
  const f = fixture(async (call, calls) => {
    if (calls.length === 1) await new Promise(resolve => { release = resolve; });
    return response({ ...initial(), revision: calls.length + 2, state: call.body.state, client: { id: call.body.clientId } });
  });
  const first = f.api.save(initial().state); await tick();
  const second = select(f.api); release(); await Promise.all([first, second]);
  assert.equal(f.calls[0].body.clientId, 'A');
  assert.equal(f.calls[1].body.clientId, 'B');
  assert.equal(f.calls[1].body.state.client.crmId, 'B');
  assert.equal(f.api.getDocument().client.id, 'B');
});

test('lost ACK replays the original client/body/UUID before saving the latest selection', async () => {
  let original;
  const f = fixture(async (call, calls) => {
    if (calls.length === 1) { original = copy(call.body); throw new TypeError('ACK_LOST'); }
    if (calls.length === 2) return response({ ...initial(), revision: 3, state: original.state });
    return response({ ...initial(), revision: 4, state: call.body.state, client: { id: call.body.clientId } });
  });
  await assert.rejects(f.api.save(initial().state), /ACK_LOST/);
  await select(f.api);
  assert.deepEqual(f.calls[1].body, original);
  assert.equal(f.calls[2].body.clientId, 'B');
  assert.equal(f.calls[2].body.expectedRevision, 3);
  assert.notEqual(f.calls[2].body.operationId, original.operationId);
  assert.equal(f.api.getDocument().client.id, 'B');
});

test('latest selection remains visible across an ACK before delayed editor snapshot, then accepts server null', async () => {
  let release;
  const f = fixture(async (call, calls) => {
    if (calls.length === 1) await new Promise(resolve => { release = resolve; });
    return response({ ...initial(), revision: calls.length + 2, state: call.body.state,
      client: call.body.clientId === 'temporary' ? null : { id: call.body.clientId } });
  });
  const first = f.api.save(initial().state); await tick();
  let selectedState, resume;
  f.api.attachEditor({ getState: () => copy(initial().state), applyState: value => { selectedState = value; },
    ensureSaved: async () => { await new Promise(resolve => { resume = resolve; }); return f.api.save(selectedState); } });
  const second = select(f.api, 'temporary'); release(); await first;
  assert.equal(f.api.getDocument().client.id, 'temporary');
  resume(); await second;
  assert.equal(f.calls[1].body.clientId, 'temporary');
  assert.equal(f.api.getDocument().client, null);
  assert.equal(f.api.hasUnsavedChanges(selectedState), false);
  await f.api.save(selectedState);
  assert.equal(f.calls[2].body.clientId, undefined);
});
