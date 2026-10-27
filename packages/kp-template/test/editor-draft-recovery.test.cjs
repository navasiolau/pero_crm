const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const SheetRender = require('../assets/public/js/sheet-render.js');
const copy = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const prefix = 'pero-crm-kp:actor:primary:draft:';
const documentRow = () => ({ id: 'primary', revision: 15, canEdit: true, client: { id: 'client', label: 'Клиент' },
  fx: { currency: 'BYN', rate: '1', date: '2026-10-27', source: 'MANUAL' },
  state: { currency: 'BYN', order: { number: '231', project: 'SERVER' }, manager: { name: 'SERVER', role: 'Менеджер', phone: '+000' }, items: [] } });
async function fixture(initial = [], overlap = false, server = documentRow()) {
  const values = new Map(initial), nodes = new Map(), timers = new Map(), writes = [], resolutions = [], reads = [], removed = [];
  let adapter, current = copy(server), remote = copy(server), baseline, conflict = null, timerId = 0, elementId = 0;
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
  const api = {
    documentsCacheKey: 'labels', initialState: defaults => copy(defaults), getDocumentId: () => 'primary', getDocument: () => current,
    isEditable: () => true, isPaused: () => false, applyPermissions() {}, mediaUrl: () => '', previewState: copy,
    focusDocument(doc) { current = copy(doc); }, acknowledgeHydration(_doc, state) { baseline = copy(state); },
    localDraftKey: () => prefix + current.revision,
    draftContext: () => ({ prefix, revision: current.revision, baseState: copy(current.state), fx: copy(current.fx), client: copy(current.client), localFx: copy(current.fx), localClient: copy(current.client) }),
    restoreDraftContext(local) { if (local.fx) current.fx = copy(local.fx); if (local.client) current.client = copy(local.client); },
    getSaveConflict: () => conflict, hasUnsavedChanges: state => JSON.stringify(state) !== JSON.stringify(baseline),
    attachEditor(value) { adapter = value; },
    async request(path) { if (path.startsWith('/api/documents?id=')) return copy(remote); if (path === '/api/documents') return { documents: [] }; throw Error('UNEXPECTED_NETWORK'); },
    async save(state) {
      writes.push(copy(state));
      if (overlap) { conflict = { proposalId: 'primary', paths: ['state.manager.name', 'fx.rate'],
        base: { state: copy(current.state), fx: current.fx, clientId: 'client' }, local: { state: copy(state), fx: current.fx, clientId: 'client' },
        remote: { state: { ...copy(remote.state), manager: { ...remote.state.manager, name: 'REMOTE' } }, fx: { ...remote.fx, rate: '2' }, clientId: 'client' }, remoteRevision: 16 }; throw Error('SAVE_CONFLICT'); }
      remote = { ...copy(current), revision: current.revision + 1, state: copy(state) }; api.focusDocument(remote); baseline = copy(state); return copy(remote);
    },
    async resolveSaveConflict(choice) {
      resolutions.push(choice);
      const selected = choice === 'local' ? conflict.local.state : conflict.remote.state;
      remote = { ...remote, revision: 16, state: copy(selected) }; conflict = null; api.focusDocument(remote); baseline = copy(selected); return copy(remote);
    }
  };
  const window = node('window'); window.PeroCrmKp = api; window.SheetRender = SheetRender;
  runInNewContext(readFileSync(join(__dirname, '../assets/public/js/app.js'), 'utf8'), { window, document, localStorage: storage,
    crypto: globalThis.crypto, console, AbortController, requestAnimationFrame() {},
    setTimeout(callback, milliseconds) { const id = ++timerId; timers.set(id, { callback, milliseconds }); return id; }, clearTimeout(id) { timers.delete(id); }
  }, { filename: 'actual-draft-editor.js' });
  await tick();
  return { values, nodes, api, window, reads, removed, writes, resolutions, get adapter() { return adapter; },
    async type(value) { field.value = value; await document.dispatch('input', field); },
    async timer(milliseconds) { const selected = [...timers].find(([, value]) => value.milliseconds === milliseconds); if (selected) { timers.delete(selected[0]); selected[1].callback(); await tick(); } },
    save: () => node('.js-docs-save').dispatch('click') };
}

test('same-revision legacy draft survives metadata upgrade without state pollution or old-key deletion', async () => {
  const old = JSON.stringify({ ...documentRow().state, manager: { name: 'OLDER' }, __docId: 'primary' });
  const latest = JSON.stringify({ ...documentRow().state, manager: { name: 'LOCAL15' }, __docId: 'primary' });
  const f = await fixture([[prefix + '13', old], [prefix + '15', latest]]);
  assert.equal(f.adapter.getState().manager.name, 'LOCAL15'); assert.equal(f.writes.length, 0);
  await f.type('EDITED'); await f.timer(500);
  const envelope = JSON.parse(f.values.get(prefix + '15'));
  assert.equal(envelope.schema, 1); assert.equal(envelope.revision, 15); assert.ok(Number.isFinite(Date.parse(envelope.updatedAt)));
  assert.equal(envelope.base.state.manager.name, 'SERVER'); assert.equal(envelope.local.state.manager.name, 'EDITED');
  assert.equal(Object.hasOwn(envelope.local.state, '__docId'), false); assert.equal(f.values.get(prefix + '13'), old);
  assert.equal(f.values.get(prefix + 'legacy-backup:15'), latest); assert.deepEqual(f.removed, []);
  await f.type('LAST_KEY_BEFORE_F5'); await f.window.dispatch('pagehide');
  assert.equal(JSON.parse(f.values.get(prefix + '15')).local.state.manager.name, 'LAST_KEY_BEFORE_F5');
});

test('older legacy draft review blocks autosave, excludes foreign/version keys and preserves cancel and restore snapshots', async () => {
  const old = JSON.stringify({ ...documentRow().state, manager: { name: 'LOCAL13' }, __docId: 'primary' });
  const foreign = 'pero-crm-kp:other:primary:draft:20', version = prefix + '18:version:old';
  const f = await fixture([[prefix + '13', old], [foreign, old], [version, old], ['pero-crm-kp:actor:other:draft:21', old]]);
  assert.equal(f.adapter.getState().manager.name, 'SERVER'); assert.equal(f.nodes.get('confirmModal').hidden, false); assert.equal(f.writes.length, 0);
  await f.window.dispatch('pagehide'); assert.equal(f.values.has(prefix + '15'), false, 'unreviewed old draft is not hidden by a clean current snapshot');
  assert.equal(f.reads.includes(foreign), false); assert.equal(f.reads.includes(version), false);
  await f.nodes.get('confirmCancel').dispatch('click'); await tick(); assert.equal(f.adapter.getState().manager.name, 'SERVER');
  await f.type('UNSAVED_CURRENT'); await f.timer(500); await f.timer(1200); assert.equal(f.writes.length, 0);
  const saving = f.save(); await tick(); await f.nodes.get('confirmOk').dispatch('click'); await saving;
  assert.equal(f.adapter.getState().manager.name, 'LOCAL13'); assert.equal(f.writes.length, 0, 'restoration itself never writes CRM');
  assert.equal(f.values.get(prefix + '13'), old); assert.ok([...f.values.keys()].some(key => key.startsWith(prefix + 'backup:')));
  await f.save(); assert.equal(f.writes.length, 1); assert.equal(f.writes[0].manager.name, 'LOCAL13'); assert.deepEqual(f.removed, []);
  const server = documentRow(); server.state.manager.role = 'SERVER_ROLE'; server.state.footer = 'SERVER_FOOTER';
  const base = copy(documentRow().state); base.manager.name = 'BASE'; base.manager.role = 'BASE_ROLE'; base.footer = 'BASE_FOOTER';
  const local = copy(base); local.manager.name = 'META_LOCAL';
  const envelope = JSON.stringify({ schema: 1, documentId: 'primary', revision: 13, updatedAt: '2026-10-27T00:00:00Z',
    base: { state: base, fx: server.fx, client: server.client }, local: { state: local, fx: server.fx, client: server.client } });
  const merged = await fixture([[prefix + '13', envelope]], false, server);
  await merged.nodes.get('confirmOk').dispatch('click'); await tick();
  assert.equal(merged.adapter.getState().manager.name, 'META_LOCAL'); assert.equal(merged.adapter.getState().manager.role, 'SERVER_ROLE');
  assert.equal(merged.adapter.getState().footer, 'SERVER_FOOTER'); assert.equal(merged.writes.length, 0); assert.equal(merged.values.get(prefix + '13'), envelope);
});

test('overlap review uses field labels only on manual action, keeps cancellation and requires explicit resolution', async () => {
  const f = await fixture([], true); await f.type('MY_LOCAL'); await f.timer(500); await f.timer(1200);
  assert.equal(f.nodes.get('confirmModal').hidden, true); assert.equal(f.resolutions.length, 0);
  let saving = f.save(); await tick();
  assert.ok(f.nodes.get('confirmText').textContent.includes('Имя менеджера')); assert.ok(f.nodes.get('confirmText').textContent.includes('Курс КП'));
  assert.ok(f.nodes.get('confirmText').textContent.includes('MY_LOCAL')); assert.ok(f.nodes.get('confirmText').textContent.includes('REMOTE'));
  await f.nodes.get('confirmCancel').dispatch('click'); await saving;
  assert.equal(f.adapter.getState().manager.name, 'MY_LOCAL'); assert.deepEqual(f.resolutions, []);
  saving = f.save(); await tick(); await f.nodes.get('confirmOk').dispatch('click'); await saving;
  assert.deepEqual(f.resolutions, ['local']); assert.equal(f.adapter.getState().manager.name, 'MY_LOCAL');
  assert.ok([...f.values.values()].some(value => value.includes('save-conflict-review'))); assert.deepEqual(f.removed, []);
  saving = f.save(); await tick(); await f.nodes.get('serverChoice').dispatch('click'); await saving;
  assert.deepEqual(f.resolutions, ['local', 'remote']); assert.equal(f.adapter.getState().manager.name, 'REMOTE');
});
