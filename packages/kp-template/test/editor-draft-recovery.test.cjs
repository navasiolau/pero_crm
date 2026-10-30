const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const SheetRender = require('../assets/public/js/sheet-render.js');
const copy = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const createTransport = require('../assets/public/js/crm-transport.js');
const prefix = 'pero-crm-kp:actor:primary:';
const documentRow = () => ({ id: 'primary', revision: 15, canEdit: true, client: { id: 'client', label: 'Клиент' },
  fx: { currency: 'BYN', rate: '1', date: '2026-10-27', source: 'MANUAL' },
  updatedAt: new Date(1000).toISOString(), state: { currency: 'BYN', order: { number: '231', project: 'SERVER' }, manager: { name: 'SERVER', role: 'Менеджер', phone: '+000' }, items: [] } });
async function fixture(initial = [], overlap = false, server = documentRow()) {
  const values = new Map(initial), nodes = new Map(), timers = new Map(), writes = [], resolutions = [], reads = [], removed = [];
  let adapter, current = copy(server), remote = copy(server), timerId = 0, elementId = 0, now = 2000, heldWrite;
  const node = key => {
    if (!nodes.has(key)) {
      const handlers = new Map();
      nodes.set(key, { dataset: {}, style: {}, hidden: true, value: '', innerHTML: '', textContent: '', classList: { add() {}, remove() {}, toggle() {} },
        parentNode: { insertBefore(child) { nodes.set('serverChoice', child); } },
        addEventListener(type, callback) { handlers.set(type, [...(handlers.get(type) || []), callback]); },
        dispatch(type, target = this) { return Promise.all((handlers.get(type) || []).map(callback => callback({ target, preventDefault() {}, stopPropagation() {} }))); },
        closest() { return null; }, querySelectorAll() { return []; }, querySelector() { return null; }, matches() { return false; }, setAttribute() {} });
    }
    return nodes.get(key);
  };
  const field = node('name'); field.dataset.path = 'manager.name'; field.type = 'text';
  const document = node('document'); document.body = node('body'); document.fonts = { ready: Promise.resolve() };
  document.getElementById = id => node(id); document.querySelector = selector => node(selector);
  document.querySelectorAll = selector => selector === '[data-path]' ? [field] : [];
  document.createElement = () => node('created:' + ++elementId);
  const storage = { get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
    getItem(key) { reads.push(key); return values.get(key) ?? null; }, setItem(key, value) { values.set(key, value); },
    removeItem(key) { removed.push(key); values.delete(key); } };
  const api = createTransport({ actorId: 'actor', documentId: 'primary', apiBase: '/api/kp' }, { storage,
    clock: { now: () => now, read: () => now, sample() {} },
    fetch: async (url, options) => {
      if (url === '/api/kp/documents') return new Response(JSON.stringify({ documents: [] }));
      if (options.method === 'PUT') {
        const body = JSON.parse(options.body); writes.push(copy(body.state));
        if (heldWrite) { const pending = heldWrite; heldWrite = null; await pending; }
        remote = { ...remote, revision: remote.revision + 1, updatedAt: new Date(now + 1).toISOString(), state: copy(body.state), fx: body.fx };
      }
      return new Response(JSON.stringify(remote));
    }
  });
  const attach = api.attachEditor; api.attachEditor = value => { adapter = value; attach(value); };
  const window = node('window'); window.PeroCrmKp = api; window.SheetRender = SheetRender;
  runInNewContext(readFileSync(join(__dirname, '../assets/public/js/app.js'), 'utf8'), { window, document, localStorage: storage,
    crypto: globalThis.crypto, console, AbortController, requestAnimationFrame() {},
    setTimeout(callback, milliseconds) { const id = ++timerId; timers.set(id, { callback, milliseconds }); return id; }, clearTimeout(id) { timers.delete(id); }
  }, { filename: 'actual-draft-editor.js' });
  await tick();
  return { values, nodes, api, window, reads, removed, writes, resolutions, get adapter() { return adapter; },
    async type(value) { field.value = value; await document.dispatch('input', field); },
    async timer(milliseconds) { const selected = [...timers].find(([, value]) => value.milliseconds === milliseconds); if (selected) { timers.delete(selected[0]); selected[1].callback(); await tick(); } },
    save: () => node('.js-docs-save').dispatch('click'), set remote(value) { remote = copy(value); }, set now(value) { now = value; },
    holdWrite() { let release; heldWrite = new Promise(resolve => { release = resolve; }); return release; } };
}

const draft = (time, name = 'LOCAL') => ({ schema: 2, editId: 'local-edit', baseRevision: 15, editedAt: time,
  local: { state: { ...documentRow().state, manager: { ...documentRow().state.manager, name } }, fx: documentRow().fx, client: documentRow().client } });

test('actual editor opens the newer whole snapshot with no modal and no writes', async () => {
  for (const [time, expected] of [[999, 'SERVER'], [1000, 'SERVER'], [2000, 'LOCAL']]) {
    const f = await fixture([[prefix + 'draft', JSON.stringify(draft(time))]]);
    assert.equal(f.adapter.getState().manager.name, expected); assert.equal(f.nodes.get('confirmModal').hidden, true); assert.equal(f.writes.length, 0);
  }
});

test('pagehide and repeated technical saves keep the edit timestamp and one draft key', async () => {
  const f = await fixture(); await f.type('UNSAVED');
  const before = JSON.parse(f.values.get(prefix + 'draft'));
  for (let i = 0; i < 100; i++) { f.now = 5000 + i; await f.window.dispatch('pagehide'); }
  const after = JSON.parse(f.values.get(prefix + 'draft'));
  assert.equal(after.editedAt, before.editedAt); assert.equal(after.editId, before.editId);
  assert.equal([...f.values.keys()].filter(key => key.startsWith(prefix + 'draft')).length, 1);
  await f.save(); assert.equal(f.writes.length, 1); assert.equal(f.values.has(prefix + 'draft'), false);
});

test('returning to the editor selects a later agent save without writing or prompting', async () => {
  const f = await fixture(); await f.type('LOCAL');
  f.remote = { ...documentRow(), revision: 16, updatedAt: new Date(3000).toISOString(), state: { ...documentRow().state, manager: { name: 'AGENT' } } };
  await f.window.dispatch('focus'); await tick();
  assert.equal(f.adapter.getState().manager.name, 'AGENT'); assert.equal(f.writes.length, 0); assert.equal(f.nodes.get('confirmModal').hidden, true);
  f.remote = { ...documentRow(), revision: 17, updatedAt: new Date(4000).toISOString(), state: { ...documentRow().state, manager: { name: 'AGENT_ON_RETURN' } } };
  const document = f.nodes.get('document'); document.visibilityState = 'visible'; await document.dispatch('visibilitychange'); await tick();
  assert.equal(f.adapter.getState().manager.name, 'AGENT_ON_RETURN'); assert.equal(f.writes.length, 0);
});

test('a late ACK preserves later typing and its actual edit time through refresh and the next save', async () => {
  const f = await fixture(); await f.type('FIRST');
  const release = f.holdWrite(), saving = f.save(); await tick();
  f.now = 2100; await f.type('TYPED_DURING_SAVE');
  const editedAt = JSON.parse(f.values.get(prefix + 'draft')).editedAt;
  f.now = 5000; release(); await saving;
  assert.equal(f.adapter.getState().manager.name, 'TYPED_DURING_SAVE');
  assert.equal(JSON.parse(f.values.get(prefix + 'draft')).editedAt, editedAt);
  await f.api.reconcile(); assert.equal(f.adapter.getState().manager.name, 'TYPED_DURING_SAVE');
  await f.save(); assert.equal(f.writes.at(-1).manager.name, 'TYPED_DURING_SAVE'); assert.equal(f.values.has(prefix + 'draft'), false);
});
