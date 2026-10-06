import assert from 'node:assert/strict';
import {before,test} from 'node:test';
import {createRequire,Module} from 'node:module';
import type {PrismaClient,Role} from '@prisma/client';
import {engineerFixture,matches} from './helpers/visibility-fixture';
import {productVisibilityWhere,productEditWhere,projectVisibilityWhere,taskExecutionWhere,fileVisibilityWhere} from '../src/server/access/visibility';
import {resolveUploadContext} from '../src/server/files/upload-context';
import {navItemsForRole} from '../src/lib/nav';
const fixture=engineerFixture();const worker={id:'unassigned',roles:['WORKER'] as Role[]};let query:typeof import('../src/server/products/queries');
for(const row of fixture.products)row.description='PRIVATE_TECH';
const require=createRequire(import.meta.url);let route:typeof import('../src/app/api/files/[id]/route');let storageReads=0;
function inject(name:string,exports:Record<string,unknown>){const file=require.resolve(name),stub=new Module(file);stub.filename=file;stub.loaded=true;stub.exports=exports;require.cache[file]=stub;}
before(async()=>{(globalThis as {prisma?:PrismaClient}).prisma=fixture.db as unknown as PrismaClient;query=await import('../src/server/products/queries');inject('../src/auth',{auth:async()=>({user:worker})});inject('../src/lib/s3',{UPLOADS_ROOT:'never-used',s3Enabled:()=>true,fileKey:()=>'',thumbKey:()=>'',s3Get:async()=>{storageReads++;throw Error('STORAGE_READ_FORBIDDEN');}});route=require('../src/app/api/files/[id]/route');});
test('real list/direct URL allow production without Task and filters never add other stages',async()=>{
 const list=await query.listProducts(worker.id,worker.roles,{activeOnly:false});assert.deepEqual(list.rows.map(row=>row.id).sort(),['field-product','production']);
 for(const key of ['production','field-product'])assert.ok(await query.getProductFor(worker.id,worker.roles,key));
 assert.equal(await query.getProductFor(worker.id,worker.roles,'foreign'),null);assert.equal((await query.listProducts(worker.id,worker.roles,{activeOnly:false,status:'DESIGN'})).total,0);
 const row=fixture.products.find(row=>row.id==='field-product')!;row.status='STORAGE';try{assert.equal(await query.getProductFor(worker.id,worker.roles,'field-product'),null);}finally{row.status='PRODUCTION';}
});
test('pure mounter has no global production grant; field reads non-DESIGN files without edit/task/upload',async()=>{
 assert.equal(fixture.products.filter(row=>matches(row,productVisibilityWhere({id:'unassigned',roles:['MOUNTER']}))).length,0);
 assert.equal(fixture.products.filter(row=>matches(row,productEditWhere(worker))).length,0);assert.equal(fixture.tasks.filter(row=>matches(row,taskExecutionWhere(worker))).length,0);
 assert.deepEqual(fixture.files.filter(row=>matches(row,fileVisibilityWhere(worker))).map(row=>row.id),['file-production']);
 assert.deepEqual(fixture.files.filter(row=>matches(row,fileVisibilityWhere({id:'unassigned',roles:['MOUNTER']}))).map(row=>row.id),['file-production']);
 assert.equal(await resolveUploadContext(fixture.db as unknown as PrismaClient,worker,{projectId:'mixed',productId:'production',taskId:null}),null);
 assert.ok(matches(fixture.projects[0],projectVisibilityWhere(worker)));assert.ok(matches(fixture.products[2],productVisibilityWhere({id:'unassigned',roles:['ENGINEER','WORKER']})));assert.equal(matches(fixture.products[2],productEditWhere({id:'unassigned',roles:['ENGINEER','WORKER']})),false);
});
test('genuine new readonly DTO masks unassigned technical description and money but shows non-DESIGN files, sidebar grants only Products',async()=>{
 const product=await query.getProductFor(worker.id,worker.roles,'production');assert.ok(product);assert.equal(product.description,null);assert.deepEqual((product.files as {id:string}[]).map(row=>row.id),['file-production']);assert.deepEqual(product.tasks,[]);assert.equal(product.expectedPrice,null);assert.equal((await query.listProducts(worker.id,worker.roles,{activeOnly:false})).rows.every(row=>row.description===null),true);
 assert.ok(navItemsForRole(['WORKER']).some(row=>row.href==='/products'));assert.equal(navItemsForRole(['MOUNTER']).some(row=>row.href==='/products'),false);assert.equal(navItemsForRole(['WORKER']).some(row=>row.href==='/finance'),false);
});

test('field original passes visibility into storage; previews attempt storage; parent DTO shows files but masks money',async()=>{
 const row=fixture.files.find(row=>row.id==='file-production')!;const backup={mimeType:row.mimeType,size:row.size,storedName:row.storedName};Object.assign(row,{mimeType:'image/jpeg',size:1000,storedName:'stored.jpg'});
 try{
  for(const suffix of ['?preview=thumbnail','?preview=card','?preview=cover'])assert.equal((await route.GET(new Request('https://qa.invalid/api/files/file-production'+suffix),{params:Promise.resolve({id:'file-production'})})).status,422);
  assert.equal(storageReads,3);
  await assert.rejects(route.GET(new Request('https://qa.invalid/api/files/file-production'),{params:Promise.resolve({id:'file-production'})}),/STORAGE_READ_FORBIDDEN/);
  assert.equal(storageReads,4);}finally{Object.assign(row,backup);}
 const projects=await import('../src/server/projects/queries');const parent=await projects.getProjectFor(worker.id,worker.roles,'mixed');assert.ok(parent);assert.deepEqual(parent.products.map(row=>row.id),['production']);assert.equal(parent.products[0].description,null);assert.equal(parent.products[0].expectedPrice,null);assert.deepEqual((parent.files as {id:string}[]).map(row=>row.id),['file-production']);assert.deepEqual(parent.payments,[]);
});
import {assignedProductVisibilityWhere,assignedProjectVisibilityWhere} from '../src/server/access/visibility';
test('merged live wrappers enclose new global production and old assignment grants for every role',async()=>{
 const row=fixture.products.find(row=>row.id==='production')!,parent=fixture.projects.find(row=>row.id==='mixed')!;
 for(const deleted of ['product','parent']){
  const entity=deleted==='product'?row:parent;entity.deletedAt=new Date();
  try{
   for(const roles of [['WORKER'],['WORKER','ENGINEER'],['WORKER','MANAGER'],['MANAGER'],['MOUNTER'],['PROCUREMENT']] as Role[][]){const actor={id:'engineer',roles};for(const predicate of [productVisibilityWhere(actor),assignedProductVisibilityWhere(actor),productEditWhere(actor)])assert.equal(matches(row,predicate),false);if(deleted==='parent')for(const predicate of [projectVisibilityWhere(actor),assignedProjectVisibilityWhere(actor)])assert.equal(matches(parent,predicate),false);}
   assert.equal(await query.getProductFor(worker.id,worker.roles,'production'),null);assert.equal((await query.listProducts(worker.id,worker.roles,{activeOnly:false})).rows.some(item=>item.id==='production'),false);
  }finally{entity.deletedAt=null;}
 }
 assert.ok(await query.getProductFor(worker.id,worker.roles,'production'));
});
