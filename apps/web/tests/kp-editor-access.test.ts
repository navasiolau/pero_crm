import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Role } from '@prisma/client';
import { canUseKpEditor } from '../src/lib/kp-editor-access';
import { navItemsForRole } from '../src/lib/nav';
import { buildKpEditorFrame } from '../src/server/kp/editor-frame';
import { guardedModuleCache } from './helpers/guarded-module-cache';

test('KP editor and navigation require enabled feature plus current active management role', () => {
  for (const role of ['ADMIN', 'DIRECTOR', 'MANAGER', 'ENGINEER', 'PROCUREMENT', 'ACCOUNTANT', 'WORKER', 'MOUNTER'] as Role[]) {
    const allowed = ['ADMIN', 'DIRECTOR', 'MANAGER'].includes(role);
    assert.equal(canUseKpEditor({ active: true, roles: [role] }, true), allowed);
    assert.equal(canUseKpEditor({ active: false, roles: [role] }, true), false);
    assert.equal(canUseKpEditor({ active: true, roles: [role] }, false), false);
    const items = navItemsForRole([role], false, true);
    assert.equal(items.some(item => item.href === '/kp'), allowed);
    if (allowed) assert.equal(items[items.findIndex(item => item.href === '/products') + 1]?.href, '/kp');
    assert.equal(navItemsForRole([role]).some(item => item.href === '/kp'), false);
  }
  assert.equal(canUseKpEditor({ active: true, roles: ['ENGINEER', 'MANAGER'] }, true), true);
  assert.equal(canUseKpEditor(null, true), false);
});

test('frame escapes bootstrap, keeps private same-origin assets and removes legacy PWA/network links', async () => {
  const html = await buildKpEditorFrame({ actorId: 'actor</script><script>bad()', documentId: 'proposal', apiBase: '/api/kp' });
  assert.ok(html.includes('actor\\u003c/script>'));
  assert.ok(html.includes('/kp/assets/js/crm-transport.js'));
  assert.ok(html.indexOf('/kp/assets/js/kp-local-state.js') < html.indexOf('/kp/assets/js/crm-transport.js'));
  assert.ok(html.includes('/kp/assets/css/app.css'));
  assert.ok(!html.includes('fonts.googleapis.com') && !html.includes('fonts.gstatic.com'));
  assert.ok(!html.includes('rel="manifest"'));
  await assert.rejects(buildKpEditorFrame({ actorId: 'actor', documentId: '../.env', apiBase: '/api/kp' }), /BOOTSTRAP/);
});

test('session KP responses expose server milliseconds without changing the document body', async () => {
  const calls: unknown[] = [];
  const target = '../src/app/api/kp/[[...path]]/route';
  const scope = guardedModuleCache(import.meta.url, { targets: [target], allowedOverrides: ['../src/server/kp/api-runtime'],
    overrides: { '../src/server/kp/api-runtime': { handleKpApi: async (...args: unknown[]) => { calls.push(args.slice(1)); return Response.json({ revision: 31 }); } } }, prisma: {} });
  try {
    const route = scope.load(target) as typeof import('../src/app/api/kp/[[...path]]/route');
    const started = Date.now();
    const response = await route.GET(new Request('http://crm.invalid/api/kp/documents/primary'), { params: Promise.resolve({ path: ['documents', 'primary'] }) });
    assert.ok(Number(response.headers.get('X-KP-Server-Time')) >= started);
    assert.deepEqual(await response.json(), { revision: 31 });
    assert.deepEqual(calls, [[['documents', 'primary'], 'session']]);
  } finally { scope.restore(); }
});

test('actual frame and asset routes recheck revoked role, inactive actor and feature flag before bytes', async () => {
  const prior = process.env.PERO_KP_ENABLED;
  let roles: Role[] = ['MANAGER'], active = true, reads = 0;
  const target = '../src/server/kp/editor-session';
  const scope = guardedModuleCache(import.meta.url, { targets: [target, '../src/app/kp/frame/route', '../src/app/kp/assets/[...path]/route'],
    allowedOverrides: ['../src/auth'], overrides: { '../src/auth': { auth: async () => ({ user: { id: 'actor', roles: ['ADMIN'] } }) } },
    prisma: { user: { findUnique: async () => { reads++; return { id: 'actor', roles, active }; } } } });
  try {
    const session = scope.load(target) as typeof import('../src/server/kp/editor-session');
    const frame = scope.load('../src/app/kp/frame/route') as typeof import('../src/app/kp/frame/route');
    const asset = scope.load('../src/app/kp/assets/[...path]/route') as typeof import('../src/app/kp/assets/[...path]/route');
    const request = new Request('http://crm.invalid/kp/frame?documentId=proposal');
    process.env.PERO_KP_ENABLED = '0'; assert.equal(await session.kpEditorSession(), null); assert.equal(reads, 0);
    assert.equal((await frame.GET(request)).status, 404);
    process.env.PERO_KP_ENABLED = '1'; assert.equal((await frame.GET(request)).status, 200);
    const resource = await asset.GET(request, { params: Promise.resolve({ path: ['js', 'sheet-render.js'] }) });
    assert.equal(resource.status, 200); assert.match(resource.headers.get('cache-control')!, /no-store/);
    roles = ['ENGINEER']; assert.equal((await frame.GET(request)).status, 404);
    assert.equal((await asset.GET(request, { params: Promise.resolve({ path: ['js', 'sheet-render.js'] }) })).status, 404);
    roles = ['MANAGER']; active = false; assert.equal((await frame.GET(request)).status, 404);
    active = true; assert.equal((await asset.GET(request, { params: Promise.resolve({ path: ['..', 'templates', 'contracts', 'contractors.json'] }) })).status, 404);
  } finally { if (prior === undefined) delete process.env.PERO_KP_ENABLED; else process.env.PERO_KP_ENABLED = prior; scope.restore(); }
});
