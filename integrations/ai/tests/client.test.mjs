import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { lstat, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiRoot, KpApiClient } from '../mcp/client.mjs';
import { handleMessage } from '../mcp/server.mjs';

const op = '8fca0759-fced-4823-9231-ce59ab7bd35a';
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
function client(fetchImpl) { return new KpApiClient({ baseUrl: 'https://crm.example.test', key: 'example-key-not-real', fetchImpl }); }
async function removeOwnTemp(dir) {
  assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
  assert.match(resolve(dir).split(/[\\/]/).at(-1), /^pero-kp-(?:agent|upload)-/);
  assert.equal((await lstat(dir)).isSymbolicLink(), false);
  assert.equal(await realpath(dir), await realpath(resolve(dir)));
  await rm(dir, { recursive: true, force: true });
}

test('CRM configuration accepts origin or canonical API root and refuses credential URLs and insecure remotes', () => {
  assert.equal(apiRoot('https://crm.example.test'), 'https://crm.example.test/api/v1/kp');
  assert.equal(apiRoot('https://crm.example.test/api/v1/kp/'), 'https://crm.example.test/api/v1/kp');
  assert.equal(apiRoot('http://127.0.0.1:3000'), 'http://127.0.0.1:3000/api/v1/kp');
  for (const value of ['http://crm.example.test', 'https://x:y@crm.example.test', 'https://crm.example.test/?key=secret', 'file:///tmp/x']) {
    assert.throws(() => apiRoot(value), /HTTPS|PERO_CRM/);
  }
  assert.throws(() => new KpApiClient({ baseUrl: 'https://crm.example.test', key: '' }), /PERO_CRM_API_KEY/);
});
test('Bearer is sent only inside API root; redirects are rejected and traversal does not call fetch', async () => {
  let calls = 0;
  const c = client(async (url, options) => {
    calls++; assert.equal(url.href, 'https://crm.example.test/api/v1/kp/documents');
    assert.equal(options.headers.Authorization, 'Bearer example-key-not-real'); assert.equal(options.redirect, 'error'); return reply({ documents: [] });
  });
  await c.listDocuments();
  for (const path of ['/../../admin', '//evil.example.test', '/x\\secret', '/x\r\nAuthorization: value']) await assert.rejects(c.request('GET', path), /путь|пределы/);
  assert.equal(calls, 1);
});
test('full saves preserve stable IDs and expectedRevision, and cannot silently choose an old number', async () => {
  const calls = [];
  const c = client(async (url, options) => { calls.push({ url: url.pathname, body: JSON.parse(options.body) }); return reply({ id: 'doc', revision: 8 }); });
  const state = { items: [{ id: 'item-1', qty: 2, name: 'Шкаф' }], order: { number: '230' } };
  await c.save({ id: 'doc', state, expectedRevision: 7, operationId: op });
  assert.deepEqual(calls[0].body.state, state); assert.equal(calls[0].body.expectedRevision, 7);
  await c.save({ state, operationId: op });
  assert.equal(calls[1].body.expectedNumber, undefined); assert.equal(calls[1].body.state.items[0].id, undefined);
  assert.equal(state.items[0].id, 'item-1');
  await assert.rejects(c.save({ id: 'doc', state, operationId: op }), /ревизия/);
});
test('uncertain create sends one write then returns immutable operation receipt', async () => {
  const calls = [];
  const c = client(async (url, options) => {
    calls.push([options.method, url.pathname]);
    if (options.method === 'POST') throw Error('network');
    return reply({ operationId: op, kind: 'CREATE', result: { id: 'doc-created', revision: 0 } });
  });
  const result = await c.save({ state: { items: [] }, operationId: op });
  assert.equal(result.id, 'doc-created'); assert.equal(result.recoveredAfterError, true);
  assert.deepEqual(calls.map(row => row[0]), ['POST', 'GET']); assert.ok(calls[1][1].endsWith(op));
});
test('unknown outcome exposes original UUID without another creation', async () => {
  let writes = 0;
  const c = client(async (_url, options) => { if (options.method === 'POST') writes++; throw Error('unknown'); });
  await assert.rejects(c.save({ state: { items: [] }, operationId: op }), error => error.code === 'KP_OUTCOME_UNKNOWN' && error.operationId === op);
  assert.equal(writes, 1);
});
test('stage/revision/scopes errors are not retried and key is redacted from server errors', async () => {
  const calls = [];
  const c = client(async (_url, options) => { calls.push(options.method); return reply({ error: { code: 'KP_PROJECT_NOT_LEAD', message: 'Запрещено example-key-not-real' } }, 409); });
  await assert.rejects(c.save({ id: 'doc', state: { items: [] }, expectedRevision: 1, operationId: op }), error => error.status === 409 && !error.message.includes('example-key-not-real'));
  assert.deepEqual(calls, ['PUT']);
});
test('new documents cannot inherit another proposal media owner or client from template', async () => {
  const c = client(async (_url, options) => options.method === 'GET' ? reply({ state: { client: { crmId: 'old-client' }, header: 'Образец', items: [{ id: 'old', image: 'kp-media:old' }] } }) : reply(JSON.parse(options.body)));
  const result = await c.save({ state: { items: [] }, basedOn: 'template', operationId: op });
  assert.equal(result.state.header, 'Образец'); assert.equal(result.state.client, undefined); assert.deepEqual(result.state.items, []);
  await assert.rejects(c.save({ state: { items: [{ image: 'kp-media:other' }] }, operationId: op }), /нового КП/);
});
test('contracts address primary proposal ID and bind client baseline plus all source revisions', async () => {
  const calls = [];
  const c = client(async (url, options) => { calls.push([url.pathname, JSON.parse(options.body)]); return reply({ id: 'job' }); });
  const refs = [{ proposalId: 'first', expectedRevision: 4 }, { proposalId: 'second', expectedRevision: 2 }];
  await c.generateContract('first', 3, refs, 'a'.repeat(64), op);
  assert.equal(calls[0][0], '/api/v1/kp/contracts/first/generate');
  assert.deepEqual(calls[0][1], { documentId: 'first', expectedRevision: 3, sourceRefs: refs, clientBaseline: 'a'.repeat(64), operationId: op });
});
test('private downloads never request public S3 URLs', async () => {
  const urls = [];
  const c = client(async (url, options) => { urls.push(url); assert.ok(options.headers.Authorization); return new Response(Buffer.from('pdf'), { headers: { 'content-type': 'application/pdf' } }); });
  const result = await c.downloadArtifact('artifact'); await c.downloadMedia('doc', 'media', { scope: 'version', versionId: 'version' });
  assert.equal(result.bytes.toString(), 'pdf'); assert.ok(urls[0].pathname.endsWith('/artifacts/artifact/download')); assert.equal(urls[1].searchParams.get('versionId'), 'version');
});
test('MCP rejects arbitrary state injection to export and advertises contract transition', async () => {
  const list = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, {});
  const generation = list.result.tools.find(tool => tool.name === 'kp_generate_contract');
  assert.match(generation.description, /автоматически/); assert.match(generation.description, /Подготовку/);
  assert.equal(list.result.tools.some(tool => /delete/.test(tool.name)), false);
  let invoked = false;
  const result = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'kp_generate_pdf', arguments: { documentId: 'doc', expectedRevision: 3, operationId: op, state: { items: [] } } } }, { generatePdf: () => { invoked = true; } });
  assert.equal(result.result.isError, true); assert.equal(invoked, false);
});
test('actual stdio MCP returns only JSON-RPC and does not print configured credentials', () => {
  const key = 'stdio-example-not-real-secret';
  const messages = [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }];
  const output = execFileSync(process.execPath, [fileURLToPath(new URL('../mcp/server.mjs', import.meta.url))], { input: messages.map(message => JSON.stringify(message)).join('\n') + '\n', encoding: 'utf8', timeout: 5000,
    env: { ...process.env, PERO_CRM_API_URL: 'https://crm.example.test', PERO_CRM_API_KEY: key } });
  assert.equal(output.includes(key), false);
  const replies = output.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(replies.length, 2); assert.equal(replies[0].result.serverInfo.name, 'pero-crm-kp');
  assert.ok(replies[1].result.tools.some(tool => tool.name === 'kp_restore_version'));
});
test('MCP downloads create new files only and reject paths outside configured workspace', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pero-kp-agent-'));
  try {
    const c = { downloadArtifact: async () => ({ bytes: Buffer.from('pdf'), mimeType: 'application/pdf' }) };
    const call = path => handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'kp_download_artifact', arguments: { artifactId: 'artifact', path } } }, c, { workspace: dir });
    assert.equal((await call('../escape.pdf')).result.isError, true);
    assert.equal((await call('231/proposal.pdf')).result.isError, false);
    assert.equal((await readFile(join(dir, '231/proposal.pdf'))).toString(), 'pdf');
    assert.equal((await call('231/proposal.pdf')).result.isError, true);
  } finally { await removeOwnTemp(dir); }
});
test('MCP checks a directory link before creating children outside the workspace', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pero-kp-agent-'));
  const outside = await mkdtemp(join(tmpdir(), 'pero-kp-agent-'));
  try {
    await symlink(outside, join(dir, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    const c = { downloadArtifact: async () => ({ bytes: Buffer.from('pdf'), mimeType: 'application/pdf' }) };
    const result = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'kp_download_artifact', arguments: { artifactId: 'artifact', path: 'linked/new/file.pdf' } } }, c, { workspace: dir });
    assert.equal(result.result.isError, true);
    await assert.rejects(lstat(join(outside, 'new')), error => error.code === 'ENOENT');
  } finally { await removeOwnTemp(dir); await removeOwnTemp(outside); }
});
test('image upload uses original bytes, operation/revision and private endpoint', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pero-kp-upload-'));
  try {
    const file = join(dir, 'source.png'); const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]); await writeFile(file, bytes);
    const c = client(async (url, options) => {
      if (options.method === 'GET') return reply({ id: 'doc', revision: 3, canEdit: true });
      assert.equal(url.pathname, '/api/v1/kp/uploads'); assert.equal(options.body.get('operationId'), op); assert.equal(options.body.get('expectedRevision'), '3');
      assert.deepEqual(Buffer.from(await options.body.get('file').arrayBuffer()), bytes); return reply({ mediaId: 'media', token: 'kp-media:media' });
    });
    const result = await c.upload({ documentId: 'doc', file, expectedRevision: 3, operationId: op });
    assert.equal(result.token, 'kp-media:media'); assert.equal(result.originalSha256.length, 64);
  } finally { await removeOwnTemp(dir); }
});
