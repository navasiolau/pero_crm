/** Controlled boundaries around the REAL action/ACL code. No DB/storage/network is opened. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire, Module} from 'node:module';
import {createMemoryEventQueueFixture,memoryEvent} from './helpers/event-queue-fixture';
const require = createRequire(import.meta.url);
function inject(name: string, exports: Record<string, unknown>) {
 const file = require.resolve(name), stub = new Module(file);stub.filename = file;stub.loaded = true;stub.exports = exports;require.cache[file] = stub;
}
type Stored = {id: string; uploadedById: string; projectId: string; productId: string | null; taskId: string | null; storedName: string; hasThumb: boolean; fileName: string};
const rows = new Map<string, Stored>(), receipts=new Map<string,Record<string,unknown>>(), events: {kind: string; value?: unknown}[] = [];
let q=createMemoryEventQueueFixture(),transaction=false;
let userId = 'manager', roles = ['MANAGER'], authenticated = true, visible = true, status = 'DESIGN', engineerId = 'engineer', storageFailure = false, deleteFailure = false, auditFailure = false, intentFailure=false;
const db = {
 $transaction:async(work:(tx:unknown)=>Promise<unknown>)=>{const saved=structuredClone({rows:[...rows],receipts:[...receipts],queue:q.rows});transaction=true;try{return await work(db);}catch(error){rows.clear();saved.rows.forEach(([id,row])=>rows.set(id,row));receipts.clear();saved.receipts.forEach(([id,row])=>receipts.set(id,row));q.rows.splice(0,q.rows.length,...saved.queue);throw error;}finally{transaction=false;}},
 $queryRaw:async()=>[{id:'file',locked:1}],
 user:{findUnique:async()=>{assert.equal(transaction,true,'current actor must be read inside the transaction');return{id:userId,name:'QA137',roles,active:true};}},
 changeLog:{findUnique:async({where}:{where:{id:string}})=>receipts.get(where.id)??null,create:async({data}:{data:Record<string,unknown>})=>{assert.equal(transaction,true);events.push({kind:'audit',value:data});if(auditFailure)throw Error('CONTROLLED_AUDIT_FAILURE');receipts.set(String(data.id),data);return data;}},
 domainEvent:{create:async({data}:{data:{id:string;type:string;actor:string;payload:unknown}})=>{assert.equal(transaction,true);events.push({kind:'intent',value:data});if(intentFailure)throw Error('CONTROLLED_INTENT_FAILURE');const row={...memoryEvent(1),...data,createdAt:new Date(q.now()),nextAttemptAt:new Date(q.now())};q.rows.push(row);return row;}},
 file: {findFirst: async (input: {where?:{OR?:unknown[]}}) => {if(input.where?.OR)return rows.get('file')??null;events.push({kind: 'visible-read', value: input});return visible ? rows.get('file') ?? null : null;}, delete: async (input: {where: {id: string}}) => {assert.equal(transaction,true);events.push({kind: 'metadata-delete', value: input});if (deleteFailure) throw Error('CONTROLLED_DATABASE_FAILURE');const row = rows.get(input.where.id);rows.delete(input.where.id);return row;}},
 project: {findFirst: async () => {events.push({kind: 'current-project-read'});return {id: 'project', number: 'QA115', products: [{id: 'product'}], tasks: []};}},
 product: {findFirst: async () => {events.push({kind: 'current-product-read'});return {id: 'product', number: 'QA115.1', status, engineerId};}},
 task: {findMany: async () => [], findFirst: async () => ({productId: 'product', assigneeId: 'engineer'})},
 payment: {delete: async () => {throw Error('FINANCIAL_MUTATION_FORBIDDEN');}},
 financeDocument: {delete: async () => {throw Error('FINANCIAL_MUTATION_FORBIDDEN');}},
 userPreference: {upsert: async () => {throw Error('PREFERENCE_MUTATION_FORBIDDEN');}},
};
inject('../src/auth', {auth: async () => authenticated ? {user: {id: userId, roles, name: 'QA115'}} : null});
inject('../src/lib/prisma', {prisma: db});
inject('../src/lib/s3', {UPLOADS_ROOT: 'LOCAL_FILESYSTEM_FORBIDDEN', storageConfiguration:()=>({mode:'s3',endpoint:'https://qa137.invalid/',bucket:'qa137-fixture'}),s3Enabled: () => true, fileKey: (id: string, name: string) => `${id}/${name}`, thumbKey: (id: string, name: string) => `${id}/thumbs/${name}.jpg`, s3Delete: async (key: string) => {assert.equal(transaction,false,'storage may only run after metadata/audit/intent commit');events.push({kind: 'storage-delete', value: key});if (storageFailure) throw Error('CONTROLLED_STORAGE_FAILURE');}});
inject('../src/server/plugins/event-queue-store',{createPostgresEventQueueStore:()=>q.store});
inject('../src/server/plugins/changelog', {writeChangeLog: async (value: unknown) => {events.push({kind: 'audit', value});if (auditFailure) throw Error('CONTROLLED_AUDIT_FAILURE');}});
inject('next/cache', {revalidatePath: (value: string) => events.push({kind: 'project-revalidate', value})});
inject('../src/server/products/revalidate', {revalidateProductPaths: async (value: string | null) => events.push({kind: 'product-revalidate', value})});
const {deleteFile:deleteAction} = require('../src/server/files/actions') as typeof import('../src/server/files/actions');
const deleteFile=(fileId:string,clientMutationId='00000000-0000-4000-8000-000000000137')=>deleteAction(fileId,clientMutationId);
const {fileVisibilityWhere} = require('../src/server/access/visibility') as typeof import('../src/server/access/visibility');
function reset() {
 rows.clear();receipts.clear();q=createMemoryEventQueueFixture();rows.set('file', {id: 'file', uploadedById: 'engineer', projectId: 'project', productId: 'product', taskId: null, storedName: 'owned-original.png', hasThumb: true, fileName: 'QA115-original.png'});events.length = 0;
 userId = 'manager';roles = ['MANAGER'];authenticated = visible = true;status = 'DESIGN';engineerId = 'engineer';storageFailure = deleteFailure = auditFailure = intentFailure = false;
}
const writes = () => events.filter(event => ['metadata-delete', 'storage-delete', 'audit', 'project-revalidate', 'product-revalidate'].includes(event.kind));

test('missing auth and an invisible/missing file cannot reach storage DB deletion or financial writes', async () => {
 reset();authenticated = false;await assert.rejects(deleteFile('file'), /Не авторизован/);assert.equal(events.length, 0);
 reset();visible = false;assert.deepEqual(await deleteFile('file'), {ok: false, error: 'Файл не найден'});assert.deepEqual(writes(), []);assert.equal(rows.size, 1);
 const read = events[0].value as {where: {AND: unknown[]}};
 assert.deepEqual(read.where, {AND: [{id: 'file'}, fileVisibilityWhere({id: 'manager', roles: ['MANAGER'], engineeringParticipantProductIds: [], engineeringParticipantTaskIds: [], fieldParticipantProductIds: []})]});
});

test('manager deletes only the selected ordinary ID, preserving the exact original and legacy thumbnail key scope', async () => {
 reset();const result=await deleteFile('file');assert.equal(result.ok,true);if(!result.ok)throw Error('DELETE_REQUIRED');assert.equal(result.clientMutationId,'00000000-0000-4000-8000-000000000137');assert.equal(result.fileId,'file');assert.equal(result.cleanupPending,false);assert.equal(rows.size, 0);
 assert.deepEqual(writes().map(event => event.kind), ['metadata-delete', 'audit', 'storage-delete', 'storage-delete', 'project-revalidate', 'product-revalidate']);
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

test('metadata failure stops before storage and storage outage leaves the committed intent pending', async () => {
 reset();deleteFailure = true;await assert.rejects(deleteFile('file'), /CONTROLLED_DATABASE_FAILURE/);assert.equal(rows.size, 1);assert.deepEqual(events.filter(event => event.kind === 'storage-delete'), []);
 reset();storageFailure = true;const result=await deleteFile('file');assert.equal(result.ok, true);if(!result.ok)throw Error('DELETE_REQUIRED');assert.equal(result.cleanupPending,true);assert.equal(rows.size, 0);assert.equal(events.filter(event => event.kind === 'storage-delete').length, 1);assert.equal(q.rows.length,1);assert.equal(q.rows[0].processedAt,null);
});

test('audit failure rolls back metadata before any storage effect', async () => {
 reset();auditFailure = true;await assert.rejects(deleteFile('file'), /CONTROLLED_AUDIT_FAILURE/);assert.equal(rows.size, 1);assert.equal(events.filter(event => event.kind === 'storage-delete').length, 0);assert.equal(events.filter(event => event.kind.includes('revalidate')).length, 0);
});


test('same client UUID returns its original deletion result without another audit', async () => {
 reset();const id='00000000-0000-4000-8000-000000000137';
 assert.equal((await deleteFile('file',id)).ok,true);assert.equal((await deleteFile('file',id)).ok,true);
 assert.equal(events.filter(event=>event.kind==='audit').length,1);
});

test('intent failure rolls back file and its audit before storage', async()=>{
 reset();intentFailure=true;await assert.rejects(deleteFile('file'),/CONTROLLED_INTENT_FAILURE/);assert.equal(rows.size,1);assert.equal(receipts.size,0);assert.equal(q.rows.length,0);assert.equal(events.filter(event=>event.kind==='storage-delete').length,0);
});

test('foreign actor/file UUID replay does not acquire another file deletion',async()=>{
 reset();await deleteFile('file');rows.set('file',{id:'other',uploadedById:'manager',projectId:'project',productId:'product',taskId:null,storedName:'neighbor.png',hasThumb:false,fileName:'neighbor.png'});
 const writesBefore=writes().length;assert.equal((await deleteFile('other')).ok,false);assert.equal(writes().length,writesBefore);assert.equal(rows.size,1);
 userId='other-manager';assert.equal((await deleteFile('file')).ok,false);assert.equal(writes().length,writesBefore);
});

test('a new processor completes a persisted pending storage intent without another audit',async()=>{
 reset();storageFailure=true;const result=await deleteFile('file');assert.equal(result.ok,true);assert.equal(q.rows[0].processedAt,null);
 storageFailure=false;await q.advance(q.settings.backoffBaseMs);
 const {cleanupDeletedFile}=require('../src/server/files/delete-cleanup') as typeof import('../src/server/files/delete-cleanup');
 assert.equal(await cleanupDeletedFile(q.rows[0].id),true);assert.ok(q.rows[0].processedAt);assert.equal(receipts.size,1);assert.equal(events.filter(event=>event.kind==='audit').length,1);
});
