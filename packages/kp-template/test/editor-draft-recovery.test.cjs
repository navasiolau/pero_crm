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
async function fixture(initial = [], overlap = false, server = documentRow(), confirmState = copy, rejectWrite) {
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
        const error = rejectWrite?.(body);
        if (error) return new Response(JSON.stringify({ error }), { status: 409 });
        if (heldWrite) { const pending = heldWrite; heldWrite = null; await pending; }
        remote = { ...remote, revision: remote.revision + 1, updatedAt: new Date(now + 1).toISOString(), state: confirmState(body.state), fx: body.fx };
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
    async typeSpecification(id, value) {
      const markup = node('itemsList').innerHTML;
      const row = markup.split('data-spec-id="' + id + '"')[1];
      const path = /<textarea[^>]+data-path="([^"]+)"/.exec(row)?.[1];
      assert.ok(path, 'раздел есть в форме');
      const target = node('spec:' + id); target.dataset.path = path; target.value = value;
      await node('itemsList').dispatch('input', target);
    },
    async timer(milliseconds) { const selected = [...timers].find(([, value]) => value.milliseconds === milliseconds); if (selected) { timers.delete(selected[0]); selected[1].callback(); await tick(); } },
    save: () => api.handleCommand({ type: 'flush' }), set remote(value) { remote = copy(value); }, set now(value) { now = value; },
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

test('canonical ACK rebinds section paths, and a late ACK retains the newer values by section ID', async () => {
  const body = { id: 'body', type: 'body', group: 'construction', label: 'Корпус', value: 'Корпус 1' };
  const custom = { id: 'extra', type: 'custom', group: 'filling', label: 'Вентиляция', value: 'Решётка 1' };
  const server = documentRow();
  server.state.items = [{ id: 'item', name: 'Шкаф', specifications: [custom, body] }];
  const f = await fixture([], false, server, state => ({
    ...copy(state), items: state.items.map(item => ({ ...item, specifications: SheetRender.FurnitureSpecifications.orderedSections(item.specifications) }))
  }));
  await f.typeSpecification('extra', 'Решётка 2');
  const release = f.holdWrite(), saving = f.save();
  await tick();
  f.now = 2100;
  await f.typeSpecification('body', 'Корпус 2');
  const rows = () => copy(f.adapter.getState().items[0].specifications);
  assert.deepEqual(rows().map(row => row.id), ['extra', 'body']);
  f.now = 5000; release(); await saving;
  assert.deepEqual(rows().map(row => [row.id, row.value]), [['extra', 'Решётка 2'], ['body', 'Корпус 2']]);
  await f.save();
  assert.deepEqual(rows().map(row => row.id), ['body', 'extra']);
  await f.typeSpecification('extra', 'Решётка 3');
  assert.deepEqual(rows().map(row => [row.id, row.value]), [['body', 'Корпус 2'], ['extra', 'Решётка 3']]);
});

test('reverting a section to its previous value during a save remains a newer draft', async () => {
  const server = documentRow();
  server.state.items = [{ id: 'item', name: 'Шкаф', specifications: [
    { id: 'body', type: 'body', group: 'construction', label: 'Корпус', value: 'Старый материал' }
  ] }];
  const f = await fixture([], false, server);
  await f.typeSpecification('body', 'Новый материал');
  const release = f.holdWrite(), saving = f.save();
  await tick();
  f.now = 2100;
  await f.typeSpecification('body', 'Старый материал');
  release(); await saving;
  assert.equal(f.api.getDocument().state.items[0].specifications[0].value, 'Новый материал');
  assert.equal(f.adapter.getState().items[0].specifications[0].value, 'Старый материал');
  assert.equal(JSON.parse(f.values.get(prefix + 'draft')).local.state.items[0].specifications[0].value, 'Старый материал');
  await f.save();
  assert.equal(f.writes.at(-1).items[0].specifications[0].value, 'Старый материал');
  assert.equal(f.values.has(prefix + 'draft'), false);
});

test('reload converts a newer old-editor draft for review and save with archived products and stable section IDs', async () => {
  const archivedProducts = [{ title: 'Корпус', outer: 'Старый материал' }];
  const body = { id: 'existing-row', type: 'body', group: 'construction', label: 'Корпус', value: 'Старый материал' };
  const worktop = { id: 'agent-row', type: 'worktop', group: 'construction', label: 'Столешница', value: 'Кварц' };
  for (const carriesCanonicalArray of [false, true]) {
    const server = documentRow();
    server.state.items = [{ id: 'item', name: 'Шкаф', products: archivedProducts, specifications: [body, worktop] }];
    const old = draft(2000, 'LOCAL MANAGER');
    old.local.state.items = [{ id: 'item', name: 'Шкаф с правкой', products: [{ title: 'Корпус', outer: 'Ручная правка из старой вкладки' }],
      ...(carriesCanonicalArray ? { specifications: [body] } : {}) }];
    const initial = [[prefix + 'draft', JSON.stringify(old)]];
    const operationId = 'old-operation';
    if (carriesCanonicalArray) {
      const body = { operationId, proposalId: 'primary', expectedRevision: 15, state: old.local.state, fx: old.local.fx };
      initial.push([prefix + 'operation:save', JSON.stringify({ body, editId: old.editId })]);
    }
    const f = await fixture(initial, false, server, copy, body => body.operationId === operationId
      ? { code: 'KP_EDITOR_OUTDATED', message: 'Обновите редактор' } : null);
    const shown = copy(f.adapter.getState());
    assert.equal(shown.manager.name, 'LOCAL MANAGER');
    assert.equal(shown.items[0].name, 'Шкаф с правкой');
    assert.deepEqual(shown.items[0].products, archivedProducts);
    assert.deepEqual(shown.items[0].specifications, [{ ...body, value: 'Ручная правка из старой вкладки' }, worktop]);
    assert.equal(f.writes.length, 0);
    assert.match(f.nodes.get('toast').textContent, /Проверьте разделы/);
    assert.equal(JSON.parse(f.values.get(prefix + 'draft')).editId, old.editId);
    await f.save();
    assert.equal(f.writes.length, carriesCanonicalArray ? 2 : 1);
    assert.deepEqual(f.writes.at(-1).items[0], shown.items[0]);
    assert.deepEqual(copy(f.adapter.getState()).items[0], f.api.getDocument().state.items[0]);
    assert.equal(f.values.has(prefix + 'draft'), false);
  }
});

test('deleting a leading legacy block does not rename or duplicate the independently edited next section', async () => {
  for (const sameLabel of [false, true]) {
    const archivedProducts = [{ title: sameLabel ? 'Блок' : 'A', outer: 'Первый' }, { title: sameLabel ? 'Блок' : 'B', outer: 'Второй' }];
    const legacyRows = SheetRender.FurnitureSpecifications.fromLegacy({ products: archivedProducts }).sections;
    const editedB = { ...legacyRows[1], value: 'Поздняя каноническая правка B' };
    const server = documentRow();
    server.state.items = [{ id: 'item', name: 'Шкаф', products: archivedProducts, specifications: [legacyRows[0], editedB] }];
    const old = draft(2000);
    old.local.state.items = [{ id: 'item', name: 'Шкаф', products: [archivedProducts[1]] }];
    const f = await fixture([[prefix + 'draft', JSON.stringify(old)]], false, server);
    assert.equal(f.nodes.get('legacySpecificationsDraft').hidden, true);
    assert.deepEqual(copy(f.adapter.getState()).items[0].specifications, [editedB]);
    await f.save();
    assert.deepEqual(f.writes[0].items[0].specifications, [editedB]);
    assert.deepEqual(f.writes[0].items[0].products, archivedProducts);
  }
});

test('identical duplicate legacy blocks retain the original draft until the explicit format transfer', async () => {
  const duplicate = { title: 'Полка', outer: 'ЛДСП' };
  const archivedProducts = [duplicate, copy(duplicate)];
  const legacyRows = SheetRender.FurnitureSpecifications.fromLegacy({ products: archivedProducts }).sections;
  const server = documentRow();
  server.state.items = [{ id: 'item', name: 'Шкаф', products: archivedProducts, specifications: legacyRows }];
  const old = draft(2000);
  old.local.state.items = [{ id: 'item', name: 'Шкаф', products: [duplicate] },
    { id: 'new-item', name: 'Новая позиция из старого черновика', products: [{ title: 'Фасад', outer: 'МДФ' }] }];
  const f = await fixture([[prefix + 'draft', JSON.stringify(old)]], false, server);
  assert.equal(f.nodes.get('legacySpecificationsDraft').hidden, false);
  assert.deepEqual(JSON.parse(f.values.get(prefix + 'draft')), old);
  await assert.rejects(f.save(), /Подтвердите перенос черновика/);
  assert.equal(f.writes.length, 0);
  assert.deepEqual(JSON.parse(f.values.get(prefix + 'draft')), old);
  await f.nodes.get('transferLegacySpecifications').dispatch('click');
  assert.equal(f.nodes.get('legacySpecificationsDraft').hidden, true);
  assert.equal(f.writes.length, 0);
  const transferred = JSON.parse(f.values.get(prefix + 'draft')).local.state.items[0];
  assert.equal(transferred.specifications.length, 1);
  assert.equal(transferred.specifications[0].value, legacyRows[0].value);
  assert.ok(legacyRows.every(row => row.id !== transferred.specifications[0].id));
  assert.deepEqual(transferred.products, archivedProducts);
  const reloaded = await fixture([...f.values], false, server);
  assert.equal(reloaded.nodes.get('legacySpecificationsDraft').hidden, true);
  assert.deepEqual(copy(reloaded.adapter.getState()).items[0], transferred);
  assert.equal(reloaded.adapter.getState().items[1].specifications[0].value, 'МДФ');
  await f.save();
  assert.deepEqual(f.writes[0].items[0], transferred);
  assert.equal(f.values.has(prefix + 'draft'), false);
});
