const assert = require('node:assert/strict');
const { test } = require('node:test');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const { readdirSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createRendererServer, isolatedWorker } = require('../server.cjs');
const { createSpool, cleanupSpool } = require('../pdf-stream.cjs');
const { getKpTemplateIdentity } = require('@pero/kp-template');
const secret = 'SYNTHETIC_RENDERER_TEST_SECRET_ONLY_184';
const input = () => ({ kind: 'pdf', proposalId: 'proposal', revision: 2, templateHash: getKpTemplateIdentity().templateHash, state: { items: [] }, assets: [] });
async function withServer(run, check) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pero-kp-server-test-'));
  const server = createRendererServer({ secret, run, spoolRoot: root }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try { await check('http://127.0.0.1:' + server.address().port); }
  finally { await server.shutdown(); assert.equal(path.dirname(root), path.resolve(os.tmpdir())); await fs.rm(root, { recursive: true }); }
}
test('internal HTTP refuses missing/wrong secrets and malformed inputs before running work', async () => {
  let calls = 0;
  await withServer(async () => { calls++; return { kind: 'pdf', bytesBase64: 'bytes' }; }, async base => {
    for (const value of ['', 'wrong']) assert.equal((await fetch(base + '/v1/render', { method: 'POST', headers: { 'x-pero-renderer-key': value } })).status, 401);
    assert.equal((await fetch(base + '/arbitrary', { headers: { 'x-pero-renderer-key': secret } })).status, 404);
    assert.equal((await fetch(base + '/v1/render', { method: 'POST', headers: { 'x-pero-renderer-key': secret, 'content-type': 'application/json' }, body: '{}' })).status, 400);
    assert.equal(calls, 0);
    assert.equal((await fetch(base + '/v1/render', { method: 'POST', headers: { 'x-pero-renderer-key': secret, 'content-type': 'application/json' }, body: JSON.stringify(input()) })).status, 200);
    assert.equal(calls, 1);
  });
});
test('renderer permits one active job, bounds the queue and returns busy without extra work', async () => {
  const releases = []; let active = 0, max = 0, calls = 0;
  await withServer(async (_input, { signal }) => { calls++; active++; max = Math.max(max, active); await new Promise(resolve => { releases.push(resolve); signal.addEventListener('abort', resolve, { once: true }); }); active--; return { kind: 'pdf' }; }, async base => {
    const requests = Array.from({ length: 6 }, () => fetch(base + '/v1/render', { method: 'POST', headers: { 'x-pero-renderer-key': secret, 'content-type': 'application/json' }, body: JSON.stringify(input()) }));
    const first = await Promise.race(requests); assert.equal(first.status, 429);
    while (!releases[0]) await new Promise(resolve => setImmediate(resolve));
    assert.equal(active, 1); assert.equal(calls, 1);
    for (let index = 0; index < 5; index++) {
      releases[index]();
      if (index < 4) while (!releases[index + 1]) await new Promise(resolve => setImmediate(resolve));
    }
    assert.deepEqual((await Promise.all(requests)).map(response => response.status).sort(), [200, 200, 200, 200, 200, 429]);
    assert.equal(max, 1); assert.equal(calls, 5);
  });
});

test('legacy bundle owns default scratch and joins the child before cleanup; explicit scratch stays caller-owned', async () => {
  const started = Date.now();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pero-kp-direct-worker-test-')); let child, owned;
  try {
    await assert.rejects(isolatedWorker({ ...input(), kind: 'bundle' }, { deadlineMs: 1, spoolRoot: root, onChild: value => {
      child = value; const directories = readdirSync(root); assert.equal(directories.length, 1);
      owned = directories[0]; assert.match(owned, /^[a-f0-9-]{36}$/);
    } }), /KP_RENDER_TIMEOUT/);
    assert.ok(Date.now() - started < 5000);
    assert.ok(child.exitCode !== null || child.signalCode !== null); assert.ok(owned);
    assert.deepEqual(await fs.readdir(root), []);
    const caller = await createSpool(root);
    try {
      await assert.rejects(isolatedWorker({ ...input(), kind: 'bundle' }, { deadlineMs: 1, spoolRoot: root, browserSpoolDirectory: caller.directory }), /KP_RENDER_TIMEOUT/);
      assert.deepEqual(await fs.readdir(root), [path.basename(caller.directory)]);
    } finally { await cleanupSpool(caller); }
    assert.equal(require('../validation.cjs').LIMITS.deadlineMs, 0);
    await assert.rejects(isolatedWorker(input(), { deadlineMs: -1 }), /KP_RENDER_DEADLINE_INVALID/);
  } finally { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); await fs.rm(root, { recursive: true }); }
});
