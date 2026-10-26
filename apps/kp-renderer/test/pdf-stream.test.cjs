'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { once } = require('node:events');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createRendererServer } = require('../server.cjs');
const { renderPdfFile } = require('../render.cjs');
const { getKpTemplateIdentity } = require('@pero/kp-template');

const secret = 'SYNTHETIC_PDF_STREAM_SECRET_ONLY_184';
const type = 'application/vnd.pero.kp-pdf.v1';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const picture = Buffer.from('small synthetic owned asset');
const pdf = Buffer.from('%PDF-1.7\nsmall synthetic stream');
const manifest = () => ({ protocol: 1, kind: 'pdf', proposalId: 'proposal', revision: 2,
  templateHash: getKpTemplateIdentity().templateHash, state: { items: [{ id: 'item', image: 'kp-media:photo' }], extra: { preserved: true } },
  assets: [{ mediaId: 'photo', mimeType: 'image/png', size: picture.length, sha256: digest(picture) }] });
function frame(value = manifest(), tail = Buffer.alloc(0)) {
  const json = Buffer.from(JSON.stringify(value)), header = Buffer.alloc(4); header.writeUInt32BE(json.length);
  return Buffer.concat([header, json, picture, tail]);
}
async function waitFor(check) {
  const deadline = Date.now() + 5000;
  while (!await check()) { assert.ok(Date.now() < deadline, 'small fixture did not settle'); await new Promise(resolve => setTimeout(resolve, 5)); }
}
async function withServer(run, check) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pero-kp-stream-test-'));
  const server = createRendererServer({ secret, run, spoolRoot: root }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try { await check('http://127.0.0.1:' + server.address().port, root); }
  finally {
    await server.shutdown();
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); await fs.rm(root, { recursive: true });
  }
}
const options = body => ({ method: 'POST', headers: { 'content-type': type, 'x-pero-renderer-key': secret }, body });

test('framed PDF transfers verified binary assets and returns the file stream with metadata only', async () => {
  await withServer(async input => {
    assert.equal(input.kind, 'pdf-stream');
    const saved = JSON.parse(await fs.readFile(path.join(input.spoolDirectory, 'manifest.json'), 'utf8'));
    assert.deepEqual(saved, manifest());
    assert.deepEqual(await fs.readFile(path.join(input.spoolDirectory, 'asset-0.png')), picture);
    const output = path.join(input.spoolDirectory, 'output.pdf'); await fs.writeFile(output, pdf, { flag: 'wx' });
    return { kind: 'pdf-file', path: output, size: pdf.length, sha256: digest(pdf), pageCount: 1, templateHash: saved.templateHash };
  }, async (base, root) => {
    const response = await fetch(base + '/v1/render', options(frame()));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/pdf');
    assert.equal(response.headers.get('content-length'), String(pdf.length));
    assert.equal(response.headers.get('x-pero-content-sha256'), digest(pdf));
    assert.equal(response.headers.get('x-pero-render-page-count'), '1');
    assert.equal(response.headers.get('x-pero-template-hash'), getKpTemplateIdentity().templateHash);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdf);
    await waitFor(async () => (await fs.readdir(root)).length === 0);
  });
});

test('framed PDF rejects wrong hashes, paths and trailing bytes before renderer execution', async () => {
  let calls = 0;
  await withServer(async () => { calls++; throw Error('must not run'); }, async (base, root) => {
    const hash = manifest(); hash.assets[0].sha256 = 'a'.repeat(64);
    const foreign = manifest(); foreign.state.items[0].image = 'file:///etc/passwd';
    const pathField = manifest(); pathField.assets[0].path = '/etc/passwd';
    for (const body of [frame(hash), frame(foreign), frame(pathField), frame(manifest(), Buffer.from('extra'))]) {
      const response = await fetch(base + '/v1/render', options(body));
      assert.equal(response.status, 400); assert.match((await response.json()).error, /^KP_RENDER_/);
    }
    assert.equal(calls, 0); await waitFor(async () => (await fs.readdir(root)).length === 0);
  });
});

test('file renderer uses a PDF stream and only the owned asset files, with no PDF buffer API', async () => {
  let browserClosed = false, gotoUrl, streamUsed = false;
  await withServer((input, { spoolRoot }) => renderPdfFile(input, async ({ spoolDirectory }) => ({
    newPage: async () => ({ setViewport: async () => {}, setJavaScriptEnabled: async () => {}, setRequestInterception: async () => {},
      on: () => {}, emulateMediaType: async () => {}, goto: async (url, options) => {
        gotoUrl = url; assert.ok(url.startsWith('file:')); assert.equal(options.timeout, 0);
        assert.ok((await fs.readFile(path.join(spoolDirectory, 'document.html'), 'utf8')).includes('asset-0.png'));
      }, evaluate: async () => 0, $$eval: async () => 1,
      pdf: async () => { assert.fail('stream renderer cannot aggregate PDF with page.pdf'); },
      createPDFStream: async options => { assert.equal(options.timeout, 0); streamUsed = true;
        return new ReadableStream({ start(controller) { controller.enqueue(pdf.subarray(0, 7)); controller.enqueue(pdf.subarray(7)); controller.close(); } }); },
    }), close: async () => { browserClosed = true; },
  }), { spoolRoot }), async base => {
    const response = await fetch(base + '/v1/render', options(frame())); assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdf);
    assert.ok(gotoUrl); assert.equal(streamUsed, true); assert.equal(browserClosed, true);
  });
});

test('disconnect removes a queued request and holds the active slot until cancellation finishes', async () => {
  const first = new AbortController(), queued = new AbortController();
  let calls = 0, abortSeen = false, releaseExit;
  await withServer(async (_input, { signal }) => {
    calls++;
    if (calls === 1) {
      await new Promise(resolve => signal.addEventListener('abort', () => { abortSeen = true; resolve(); }, { once: true }));
      await new Promise(resolve => { releaseExit = resolve; }); throw Error('KP_RENDER_ABORTED');
    }
    return { kind: 'pdf' };
  }, async base => {
    const json = { kind: 'pdf', proposalId: 'proposal', revision: 2, templateHash: getKpTemplateIdentity().templateHash, state: { items: [] }, assets: [] };
    const send = signal => fetch(base + '/v1/render', { method: 'POST', headers: { 'content-type': 'application/json', 'x-pero-renderer-key': secret }, body: JSON.stringify(json), signal });
    const health = async () => (await fetch(base + '/health', { headers: { 'x-pero-renderer-key': secret } })).json();
    const one = send(first.signal); one.catch(() => {}); await waitFor(() => calls === 1);
    const two = send(queued.signal); two.catch(() => {}); await waitFor(async () => (await health()).queued === 1);
    queued.abort(); await assert.rejects(two); await waitFor(async () => (await health()).queued === 0);
    const three = send(); await waitFor(async () => (await health()).queued === 1);
    first.abort(); await assert.rejects(one); await waitFor(() => abortSeen && releaseExit);
    assert.equal(calls, 1); assert.equal((await health()).active, 1);
    releaseExit(); assert.equal((await three).status, 200); assert.equal(calls, 2);
  });
});
