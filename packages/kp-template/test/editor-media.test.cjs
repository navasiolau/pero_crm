const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const createTransport = require('../assets/public/js/crm-transport.js');
const SheetRender = require('../assets/public/js/sheet-render.js');
const copy = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const response = (value, status = 200) => new Response(JSON.stringify(value), { status });
const doc = (id = 'primary') => ({ id, revision: 2, canEdit: true, client: null, project: { id: 'project-' + id },
  fx: { currency: 'BYN', rate: '1', date: '2026-10-27', source: 'MANUAL' },
  state: { currency: 'BYN', order: { number: '231' }, items: [
    { id: 'first', name: 'Первая', image: '', image2: '', dbl: true, products: [] },
    { id: 'second', name: 'Вторая', image: '', image2: '', products: [] }
  ] } });

async function fixture(manualCompression = false) {
  const nodes = new Map(), uploads = [], writes = [], images = [], revoked = [], values = new Map();
  let adapter, saved = doc(), urlNumber = 0, heldWrite = null, loseNextAck = false;
  const receipts = new Map();
  const node = key => {
    if (!nodes.has(key)) {
      const events = new Map();
      nodes.set(key, { dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {} }, value: '', innerHTML: '',
        addEventListener(type, handler) { events.set(type, [...(events.get(type) || []), handler]); },
        dispatch(type, target = this) { return Promise.all((events.get(type) || []).map(handler => handler({ target, preventDefault() {}, stopPropagation() {} }))); },
        querySelectorAll() { return []; }, querySelector(selector) { return node(key + selector); }, setAttribute() {}, matches() { return false; }, closest() { return null; } });
    }
    return nodes.get(key);
  };
  const document = node('document'); document.body = node('body'); document.fonts = { ready: Promise.resolve() };
  document.getElementById = id => node(id);
  document.querySelector = selector => node(selector);
  document.querySelectorAll = () => [];
  document.createElement = () => ({ getContext: () => ({ drawImage() {} }), toBlob: callback => callback(new Blob(['optimized'])) });
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const api = createTransport({ actorId: 'media', documentId: 'primary', apiBase: '/api/kp' }, { storage,
    fetch: async (url, options) => {
      if (url.endsWith('/media')) return new Promise((resolve, reject) => { uploads.push({ url, options, resolve, reject }); });
      if (options.method === 'PUT') {
        const body = JSON.parse(options.body); writes.push(copy(body));
        if (receipts.has(body.operationId)) {
          const receipt = receipts.get(body.operationId); assert.deepEqual(body, receipt.body); return response(receipt.document);
        }
        assert.equal(body.expectedRevision, saved.revision);
        const loseAck = loseNextAck; loseNextAck = false;
        if (heldWrite) { const waiting = heldWrite; heldWrite = null; await waiting; }
        saved = { ...saved, revision: saved.revision + 1, state: body.state };
        receipts.set(body.operationId, { body: copy(body), document: copy(saved) });
        if (loseAck) throw new TypeError('SAVE_ACK_LOST');
        return response(saved);
      }
      if (url === '/api/kp/documents/primary') return response(saved);
      if (url === '/api/kp/documents/other') return response(doc('other'));
      if (url === '/api/kp/documents') return response({ documents: [] });
      throw Error('UNEXPECTED_NETWORK');
    } });
  const attach = api.attachEditor; api.attachEditor = value => { adapter = value; attach(value); };
  const window = node('window'); window.PeroCrmKp = api; window.SheetRender = SheetRender;
  class Image {
    width = 20; height = 20;
    set src(value) { this.url = value; images.push(this); if (!manualCompression) queueMicrotask(() => this.onload?.()); }
  }
  runInNewContext(readFileSync(join(__dirname, '../assets/public/js/app.js'), 'utf8'), {
    window, document, localStorage: storage, crypto: globalThis.crypto, File, Blob, Image, AbortController,
    URL: { createObjectURL() { return 'blob:fixture-' + ++urlNumber; }, revokeObjectURL(url) { revoked.push(url); } },
    console: { error() {} }, requestAnimationFrame() {}, setTimeout() { return 0; }, clearTimeout() {}
  }, { filename: 'actual-media-editor.js' });
  await tick();
  return { api, nodes, uploads, writes, images, revoked, get adapter() { return adapter; },
    holdSave(loseAck = false) { let release; loseNextAck = loseAck; heldWrite = new Promise(resolve => { release = resolve; }); return release; },
    async photo(index = 0, slot = 'image', name = 'image.jpg') {
      const card = node('card:' + index); card.querySelectorAll = () => [node('url:' + index), node('url2:' + index)];
      const target = { type: 'file', dataset: { [slot === 'image' ? 'fileIdx' : 'fileIdx2']: String(index) }, value: name,
        files: [new File([name], name, { type: 'image/jpeg' })], closest: () => card };
      await node('itemsList').dispatch('change', target); await tick(); return target;
    },
    async action(selector, dataset) {
      const target = { dataset, closest: value => value === selector ? target : null };
      await node('itemsList').dispatch('click', target);
    },
    complete(index, id = 'photo-' + index) { uploads[index].resolve(response({ mediaId: id, reference: 'kp-media:' + id })); },
    get saved() { return saved; }
  };
}

test('Save waits for the selected photo and binds it to the item ID after moving the row', async () => {
  for (const loseAck of [false, true]) {
  const f = await fixture(), release = f.holdSave(loseAck), previousWrites = loseAck ? 2 : 1;
  f.adapter.applyState({ ...f.adapter.getState(), footer: 'BEFORE_UPLOAD' });
  const previousSave = f.adapter.ensureSaved().catch(error => { if (!loseAck) throw error; }); await tick();
  await f.photo();
  assert.equal(f.uploads.length, 0);
  release(); await previousSave; await tick();
  if (loseAck) assert.deepEqual(f.writes[1], f.writes[0]);
  assert.equal(f.uploads[0].options.body.get('expectedRevision'), '3');
  assert.equal(f.uploads[0].options.signal.aborted, false);
  await f.action('[data-mv]', { mv: '0', dir: '1' });
  let finished = false;
  const saving = f.adapter.ensureSaved().then(value => { finished = true; return value; });
  await tick(); assert.equal(f.writes.length, previousWrites); assert.equal(finished, false);
  f.complete(0); await saving;
  assert.equal(f.writes.length, previousWrites + 1);
  assert.equal(f.saved.state.items[1].id, 'first');
  assert.equal(f.saved.state.items[1].image, 'kp-media:photo-0');
  assert.equal(f.saved.state.items[0].image, '');
  assert.ok(f.nodes.get('sheet').innerHTML.includes('/api/kp/documents/primary/media/photo-0?variant=optimized'));
  f.adapter.applyDocument(copy(f.saved), false);
  assert.equal(f.adapter.getState().items[1].image, 'kp-media:photo-0');
  assert.ok(f.nodes.get('sheet').innerHTML.includes('/api/kp/documents/primary/media/photo-0?variant=optimized'));
  assert.equal(new Set(f.revoked).size, f.revoked.length);
  }
});

test('a newer photo wins, and deleting an uploading item releases the Save barrier', async () => {
  const f = await fixture(); await f.photo(0, 'image2', 'old.jpg'); await f.photo(0, 'image2', 'new.jpg');
  assert.equal(f.uploads[0].options.signal.aborted, true);
  f.complete(1, 'new'); await tick(); f.complete(0, 'old'); await tick();
  assert.equal(f.adapter.getState().items[0].image2, 'kp-media:new');
  assert.ok(f.nodes.get('sheet').innerHTML.includes('/api/kp/documents/primary/media/new?variant=optimized'));
  await f.adapter.ensureSaved(); f.adapter.applyDocument(copy(f.saved), false);
  assert.equal(f.adapter.getState().items[0].image2, 'kp-media:new');
  assert.ok(f.nodes.get('sheet').innerHTML.includes('/api/kp/documents/primary/media/new?variant=optimized'));
  await f.photo(0); await f.action('[data-del]', { del: '0' });
  await f.adapter.ensureSaved();
  assert.equal(f.uploads[2].options.signal.aborted, true);
  f.complete(2, 'deleted'); await tick();
  assert.equal(f.adapter.getState().items.length, 1);
  assert.equal(f.adapter.getState().items[0].image, '');
});

test('failed current photo visibly blocks Save/export until a replacement succeeds', async () => {
  const f = await fixture(); await f.photo();
  f.uploads[0].resolve(response({ error: { message: 'Не удалось загрузить фото' } }, 500)); await tick();
  await assert.rejects(f.adapter.ensureSaved(), /загрузить фото/);
  await assert.rejects(f.adapter.ensureSaved(), /загрузить фото/);
  assert.equal(f.writes.length, 0);
  assert.match(f.nodes.get('toast').textContent, /фото/);
  await f.photo(); f.complete(1, 'retry'); await tick();
  await f.adapter.ensureSaved(); assert.equal(f.saved.state.items[0].image, 'kp-media:retry');
});

test('switching documents cancels compression/upload without leaking media into the new document', async () => {
  const compressing = await fixture(true); await compressing.photo();
  compressing.adapter.applyDocument(doc('other'), false);
  compressing.images[0].onload?.(); await tick();
  assert.equal(compressing.uploads.length, 0);
  assert.equal(compressing.adapter.getState().items[0].image, '');
  const uploading = await fixture(); await uploading.photo();
  uploading.adapter.applyDocument(doc('other'), false);
  assert.equal(uploading.uploads[0].options.signal.aborted, true);
  uploading.complete(0, 'old-doc'); await tick();
  assert.equal(uploading.adapter.getState().items[0].image, '');
  assert.equal(uploading.api.mediaUrl('kp-media:old-doc'), '/api/kp/documents/other/media/old-doc?variant=optimized&scope=current');
  assert.equal((await uploading.adapter.ensureSaved()).id, 'other');
  assert.equal(uploading.writes.length, 0);
});
