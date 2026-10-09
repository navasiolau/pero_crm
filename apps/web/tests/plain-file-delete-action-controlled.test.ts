/** Controlled boundaries around the REAL action/ACL code. No DB/storage/network is opened. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire, Module} from 'node:module';
const require = createRequire(import.meta.url);
function inject(name: string, exports: Record<string, unknown>) {
 const file = require.resolve(name), stub = new Module(file);stub.filename = file;stub.loaded = true;stub.exports = exports;require.cache[file] = stub;
}
type Stored = {id: string; uploadedById: string; projectId: string; productId: string | null; taskId: string | null; storedName: string; hasThumb: boolean; fileName: string};
const rows = new Map<string, Stored>(), events: {kind: string; value?: unknown}[] = [];
let userId = 'manager', roles = ['MANAGER'], authenticated = true, visible = true, status = 'DESIGN', engineerId = 'engineer', storageFailure = false, deleteFailure = false, auditFailure = false;
const db = {
 file: {findFirst: async (input: unknown) => {events.push({kind: 'visible-read', value: input});return visible ? rows.get('file') ?? null : null;}, delete: async (input: {where: {id: string}}) => {events.push({kind: 'metadata-delete', value: input});if (deleteFailure) throw Error('CONTROLLED_DATABASE_FAILURE');const row = rows.get(input.where.id);rows.delete(input.where.id);return row;}},
 project: {findFirst: async () => {events.push({kind: 'current-project-read'});return {id: 'project', number: 'QA115', products: [{id: 'product'}], tasks: []};}},
 product: {findFirst: async () => {events.push({kind: 'current-product-read'});return {id: 'product', number: 'QA115.1', status, engineerId};}},
 task: {findMany: async () => [], findFirst: async () => ({productId: 'product', assigneeId: 'engineer'})},
 payment: {delete: async () => {throw Error('FINANCIAL_MUTATION_FORBIDDEN');}},
 financeDocument: {delete: async () => {throw Error('FINANCIAL_MUTATION_FORBIDDEN');}},
 userPreference: {upsert: async () => {throw Error('PREFERENCE_MUTATION_FORBIDDEN');}},
};
inject('../src/auth', {auth: async () => authenticated ? {user: {id: userId, roles, name: 'QA115'}} : null});
inject('../src/lib/prisma', {prisma: db});
inject('../src/lib/s3', {UPLOADS_ROOT: 'LOCAL_FILESYSTEM_FORBIDDEN', s3Enabled: () => true, fileKey: (id: string, name: string) => `${id}/${name}`, thumbKey: (id: string, name: string) => `${id}/thumbs/${name}.jpg`, s3Delete: async (key: string) => {events.push({kind: 'storage-delete', value: key});if (storageFailure) throw Error('CONTROLLED_STORAGE_FAILURE');}});
inject('../src/server/plugins/changelog', {writeChangeLog: async (value: unknown) => {events.push({kind: 'audit', value});if (auditFailure) throw Error('CONTROLLED_AUDIT_FAILURE');}});
inject('next/cache', {revalidatePath: (value: string) => events.push({kind: 'project-revalidate', value})});
inject('../src/server/products/revalidate', {revalidateProductPaths: async (value: string | null) => events.push({kind: 'product-revalidate', value})});
const {deleteFile} = require('../src/server/files/actions') as typeof import('../src/server/files/actions');
const {fileVisibilityWhere} = require('../src/server/access/visibility') as typeof import('../src/server/access/visibility');
function reset() {
 rows.clear();rows.set('file', {id: 'file', uploadedById: 'engineer', projectId: 'project', productId: 'product', taskId: null, storedName: 'owned-original.png', hasThumb: true, fileName: 'QA115-original.png'});events.length = 0;
 userId = 'manager';roles = ['MANAGER'];authenticated = visible = true;status = 'DESIGN';engineerId = 'engineer';storageFailure = deleteFailure = auditFailure = false;
}
const writes = () => events.filter(event => ['metadata-delete', 'storage-delete', 'audit', 'project-revalidate', 'product-revalidate'].includes(event.kind));

test('missing auth and an invisible/missing file cannot reach storage DB deletion or financial writes', async () => {
 reset();authenticated = false;await assert.rejects(deleteFile('file'), /Не авторизован/);assert.equal(events.length, 0);
 reset();visible = false;assert.deepEqual(await deleteFile('file'), {ok: false, error: 'Файл не найден'});assert.deepEqual(writes(), []);assert.equal(rows.size, 1);
 const read = events[0].value as {where: {AND: unknown[]}};
 assert.deepEqual(read.where, {AND: [{id: 'file'}, fileVisibilityWhere({id: 'manager', roles: ['MANAGER'], engineeringParticipantProductIds: [], engineeringParticipantTaskIds: [], fieldParticipantProductIds: []})]});
});

test('manager deletes only the selected ordinary ID, preserving the exact original and legacy thumbnail key scope', async () => {
 reset();assert.deepEqual(await deleteFile('file'), {ok: true});assert.equal(rows.size, 0);
 assert.deepEqual(writes().map(event => event.kind), ['metadata-delete', 'storage-delete', 'storage-delete', 'audit', 'project-revalidate', 'product-revalidate']);
 assert.deepEqual(events.find(event => event.kind === 'metadata-delete')?.value, {where: {id: 'file'}});
 assert.deepEqual(events.filter(event => event.kind === 'storage-delete').map(event => event.value), ['project/owned-original.png', 'project/thumbs/owned-original.png.jpg']);
 const audit = events.find(event => event.kind === 'audit')?.value as {entity: string; entityId: string; oldValue: unknown};assert.equal(audit.entity, 'file');assert.equal(audit.entityId, 'file');assert.deepEqual(audit.oldValue, {fileName: 'QA115-original.png'});
});

test('engineer own DESIGN file succeeds, while the same visible file from a foreign uploader has zero writes', async () => {
 reset();userId = 'engineer';roles = ['ENGINEER'];assert.equal((await deleteFile('file')).ok, true);assert.ok(events.some(event => event.kind === 'current-product-read'));
 reset();userId = 'engineer';roles = ['ENGINEER'];rows.get('file')!.uploadedById = 'admin';assert.deepEqual(await deleteFile('file'), {ok: false, error: 'Недостаточно прав'});assert.deepEqual(writes(), []);assert.equal(rows.size, 1);
});

test('current product status or assignment changes refuse an engineer despite a previously rendered canDelete flag', async () => {
 for (const stale of ['status', 'assignment']) {
  reset();userId = 'engineer';roles = ['ENGINEER'];if (stale === 'status') status = 'PRODUCTION';else engineerId = 'other';
  assert.deepEqual(await deleteFile('file'), {ok: false, error: 'Недостаточно прав'});assert.deepEqual(writes(), []);assert.equal(rows.size, 1);
 }
});

test('readonly finance roles never acquire ordinary deletion, combined manager role keeps its existing grant', async () => {
 for (const role of ['ACCOUNTANT', 'PROCUREMENT']) {reset();userId = 'engineer';roles = [role];assert.equal((await deleteFile('file')).ok, false);assert.deepEqual(writes(), []);}
 reset();roles = ['MANAGER', 'ENGINEER'];rows.get('file')!.uploadedById = 'admin';assert.equal((await deleteFile('file')).ok, true);
});

test('metadata failure stops before storage; best effort storage failure still needs the owner version ledger to close cleanup', async () => {
 reset();deleteFailure = true;await assert.rejects(deleteFile('file'), /CONTROLLED_DATABASE_FAILURE/);assert.equal(rows.size, 1);assert.deepEqual(events.filter(event => event.kind === 'storage-delete'), []);
 reset();storageFailure = true;assert.equal((await deleteFile('file')).ok, true);assert.equal(rows.size, 0);assert.equal(events.filter(event => event.kind === 'storage-delete').length, 2);
});

test('audit failure after metadata deletion is an unknown client outcome, not rollback proof or permission for automatic retry', async () => {
 reset();auditFailure = true;await assert.rejects(deleteFile('file'), /CONTROLLED_AUDIT_FAILURE/);assert.equal(rows.size, 0);assert.equal(events.filter(event => event.kind === 'storage-delete').length, 2);assert.equal(events.filter(event => event.kind.includes('revalidate')).length, 0);
});