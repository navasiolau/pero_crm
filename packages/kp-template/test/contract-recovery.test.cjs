const assert = require('node:assert/strict');
const { test } = require('node:test');
const createTransport = require('../assets/public/js/crm-transport.js');
const response = (value, status = 200) => new Response(JSON.stringify(value), { status });

for (const mode of ['rejected', 'unknown', 'failed']) test('договор: повтор после ' + mode, async () => {
  const values = new Map(), posts = [];
  const api = createTransport({ actorId: 'actor', documentId: 'primary', apiBase: '/api/kp' }, {
    storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
    fetch: async (url, options) => {
      if (url.startsWith('/api/kp/contracts?')) return response({ revision: 1, sourceRefs: [{ proposalId: 'primary', expectedRevision: 2 }], clientBaseline: '0'.repeat(64) });
      if (url.startsWith('/api/kp/operations/')) return response({ error: { code: 'KP_OPERATION_NOT_FOUND', message: 'Нет операции' } }, 404);
      assert.equal(url, '/api/kp/contract');
      posts.push(JSON.parse(options.body));
      if (posts.length === 1) {
        if (mode === 'unknown') throw new TypeError('ACK_LOST');
        if (mode === 'rejected') return response({ error: { code: 'CONTRACT_VALIDATION', message: 'Проверьте реквизиты' } }, 400);
        return response({ id: 'failed-contract', state: 'FAILED', error: 'Сбой генератора' });
      }
      return response({ id: 'ready-contract', state: 'SUCCEEDED', result: { fileName: 'Договор.docx', downloadUrl: '/api/kp/artifacts/contract/download' } });
    }
  });
  await api.request('/api/contracts?documentId=primary');
  const generate = () => api.request('/api/contract', { method: 'POST', body: JSON.stringify({ documentId: 'primary' }) });
  await assert.rejects(generate());
  assert.equal((await generate()).filename, 'Договор.docx');
  if (mode === 'unknown') assert.deepEqual(posts[1], posts[0]);
  else assert.notEqual(posts[1].operationId, posts[0].operationId);
});
