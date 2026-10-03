import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import type {Prisma} from '@prisma/client';
const require=createRequire(import.meta.url);
const core=(process.env.SKETCH_BASELINE==='1'?require('../../../.playwright-mcp/modernization/cover-core-baseline.ts'):require('../src/server/products/cover-core')) as typeof import('../src/server/products/cover-core');
const actor={id:'m',name:'Manager',roles:['MANAGER' as const]};
function fixture(pointer:string|null=null){const product={id:'p',projectId:'j',engineerId:'e',status:'DESIGN',sketchFileId:pointer};const files=new Map<string,Record<string,unknown>>();files.set('old',{id:'old',projectId:'j',productId:'p',taskId:null,mimeType:'image/png',fileName:'old.png',storedName:'old.png',hasThumb:true,uploadedById:'m'});const logs:Record<string,unknown>[]=[];const tx={$queryRaw:async()=>[],task:{findMany:async()=>[]},productPercentageParticipant:{findMany:async()=>[]},product:{findFirst:async()=>product,findUnique:async()=>product,update:async({data}:{data:Record<string,unknown>})=>Object.assign(product,data),updateMany:async({where,data}:{where:Record<string,unknown>;data:Record<string,unknown>})=>{if(where.sketchFileId!==product.sketchFileId)return{count:0};Object.assign(product,data);return{count:1}}},file:{findFirst:async({where}:{where:{AND:{id?:string}[]}})=>files.get(where.AND[0].id!)??null,create:async({data}:{data:Record<string,unknown>})=>{const row={id:files.has('new')?'new-'+files.size:'new',...data};files.set(row.id,row);return row},delete:async({where}:{where:{id:string}})=>{const row=files.get(where.id);files.delete(where.id);return row}},changeLog:{findUnique:async({where}:{where:{id:string}})=>logs.find(row=>row.id===where.id)??null,create:async({data}:{data:Record<string,unknown>})=>{logs.push(data);return data}}} as unknown as Prisma.TransactionClient;return{tx,product,files,logs};}
const target=()=>({projectId:'j',productId:'p',expectedSketchFileId:null,clientMutationId:randomUUID()});
const image={fileName:'qa.png',storedName:'new.png',mimeType:'image/png',size:42,hasThumb:true,uploadedById:'m',contentHash:'a'.repeat(64)};
test('nonempty upload CAS refuses without replacing old pointer or creating file/audit',async()=>{const f=fixture('old');const result=await core.persistUploadedProductCover(f.tx,actor,target(),image);assert.equal(result.ok,false);assert.equal(f.product.sketchFileId,'old');assert.equal(f.files.size,1);assert.equal(f.logs.length,0)});
test('empty upload creates only one exact file/pointer and replay/reused payload is controlled',async()=>{const f=fixture();const input=target();const result=await core.persistUploadedProductCover(f.tx,actor,input,image);assert.equal(result.ok,true);assert.equal(f.product.sketchFileId,'new');const n=f.logs.length;const replay=await core.persistUploadedProductCover(f.tx,actor,input,image);assert.equal(replay.ok,true);if(replay.ok)assert.equal(replay.repeated,true);assert.equal(f.logs.length,n);assert.equal((await core.persistUploadedProductCover(f.tx,actor,input,{...image,contentHash:'b'.repeat(64)})).ok,false)});
test('stale current-cover delete refuses both old-file deletion and new-pointer clearing',async()=>{const f=fixture('new-current');const result=await core.deleteProductSketchCore(f.tx,actor,{productId:'p',expectedSketchFileId:'old',clientMutationId:randomUUID()});assert.equal(result.ok,false);assert.equal(f.product.sketchFileId,'new-current');assert.ok(f.files.has('old'));assert.equal(f.logs.length,0)});
test('exact deletion returns old physical intents and clears only confirmed file with replay',async()=>{const f=fixture('old'),input={productId:'p',expectedSketchFileId:'old',clientMutationId:randomUUID()};const result=await core.deleteProductSketchCore(f.tx,actor,input);assert.equal(result.ok,true);if(result.ok){assert.equal(result.sketchFileId,null);assert.equal(result.storageIntent?.storedName,'old.png')}assert.equal(f.product.sketchFileId,null);assert.equal(f.files.has('old'),false);const n=f.logs.length;assert.equal((await core.deleteProductSketchCore(f.tx,actor,input)).ok,true);assert.equal(f.logs.length,n)});
test('old gallery writer without true baseline/UUID cannot overwrite current cover',async()=>{const f=fixture('old');assert.equal((await core.setProductCoverCore(f.tx,actor,'p','old')).ok,false);assert.equal(f.logs.length,0)});
test('technical cover edit does not widen engineer file-delete ownership and stale DESIGN stays denied',async()=>{
 const f=fixture('old');const engineer={id:'e',roles:['ENGINEER' as const]};const denied=await core.deleteProductSketchCore(f.tx,engineer,{productId:'p',expectedSketchFileId:'old',clientMutationId:randomUUID()});assert.equal(denied.ok,false);if(!denied.ok)assert.equal(denied.kind,'forbidden');assert.ok(f.files.has('old'));assert.equal(f.product.sketchFileId,'old');f.product.status='PRODUCTION';const stale=await core.authorizeProductCoverUpload(f.tx,engineer,target());assert.equal(stale.ok,false);assert.equal(f.logs.length,0);
 const union=await core.deleteProductSketchCore(f.tx,{id:'other',roles:['MANAGER','ENGINEER']},{productId:'p',expectedSketchFileId:'old',clientMutationId:randomUUID()});assert.equal(union.ok,true);
});
test('empty bind rejects foreign/nonimage files and audit failure propagates for transaction rollback',async()=>{
 for(const patch of [{projectId:'foreign'},{productId:'foreign'},{mimeType:'application/pdf'}]){const f=fixture();Object.assign(f.files.get('old')!,patch);const result=await core.bindProductSketchCore(f.tx,actor,{productId:'p',fileId:'old',expectedSketchFileId:null,clientMutationId:randomUUID()});assert.equal(result.ok,false);assert.equal(f.product.sketchFileId,null);assert.equal(f.logs.length,0);}
 const f=fixture();const failing=new Proxy(f.tx,{get(target,key){if(key==='changeLog')return{findUnique:target.changeLog.findUnique,create:async()=>{throw new Error('AUDIT_FAILURE')}};return Reflect.get(target,key)}});await assert.rejects(core.persistUploadedProductCover(failing,actor,target(),image),/AUDIT_FAILURE/);
});

test('assigned DESIGN engineer atomically replaces manager sketch and preserves old attachment',async()=>{
 const f=fixture('old'),engineer={id:'e',roles:['ENGINEER' as const]};
 const input={...target(),expectedSketchFileId:'old'},old=f.files.get('old');
 assert.equal((await core.authorizeProductCoverUpload(f.tx,engineer,input)).ok,true);
 const result=await core.persistUploadedProductCover(f.tx,engineer,input,{...image,uploadedById:'e'});
 assert.equal(result.ok,true);assert.equal(f.product.sketchFileId,'new');assert.equal(f.files.get('old'),old);
 assert.equal(f.files.size,2);assert.ok(!f.logs.some(row=>row.entity==='file'&&row.action==='delete'));
 const audit=f.logs.find(row=>row.entity==='product'&&row.action==='cover.change');
 assert.deepEqual(audit?.oldValue,{sketchFileId:'old'});
 const count=f.logs.length;
 assert.equal((await core.authorizeProductCoverUpload(f.tx,engineer,input)).ok,true);
 const replay=await core.persistUploadedProductCover(f.tx,engineer,input,{...image,uploadedById:'e'});
 assert.equal(replay.ok,true);if(replay.ok)assert.equal(replay.repeated,true);
 assert.equal(f.files.size,2);assert.equal(f.logs.length,count);
 assert.equal((await core.persistUploadedProductCover(f.tx,engineer,input,{...image,uploadedById:'e',contentHash:'b'.repeat(64)})).ok,false);
 assert.equal((await core.persistUploadedProductCover(f.tx,engineer,{...input,expectedSketchFileId:null},{...image,uploadedById:'e'})).ok,false);
 assert.equal(f.product.sketchFileId,'new');assert.equal(f.files.size,2);
});

test('replacement checks current baseline and exact old-file context before writing',async()=>{
 for(const patch of [{projectId:'foreign'},{productId:'foreign'},{mimeType:'application/pdf'}]){
  const f=fixture('old');Object.assign(f.files.get('old')!,patch);
  const input={...target(),expectedSketchFileId:'old'};
  assert.equal((await core.authorizeProductCoverUpload(f.tx,actor,input)).ok,false);
  assert.equal((await core.persistUploadedProductCover(f.tx,actor,input,image)).ok,false);
  assert.equal(f.product.sketchFileId,'old');assert.equal(f.files.size,1);assert.equal(f.logs.length,0);
 }
 const f=fixture('other-current'),input={...target(),expectedSketchFileId:'old'};
 const result=await core.authorizeProductCoverUpload(f.tx,actor,input);assert.equal(result.ok,false);
 if(!result.ok)assert.equal(result.kind,'conflict');
 assert.equal((await core.persistUploadedProductCover(f.tx,actor,input,image)).ok,false);
 assert.equal(f.product.sketchFileId,'other-current');assert.equal(f.files.size,1);assert.equal(f.logs.length,0);
});

test('replacement never grants unassigned or stale engineer a technical edit',async()=>{
 for(const patch of [{engineerId:'other'},{status:'PRODUCTION'}]){
  const f=fixture('old');Object.assign(f.product,patch);const engineer={id:'e',roles:['ENGINEER' as const]},input={...target(),expectedSketchFileId:'old'};
  const result=await core.authorizeProductCoverUpload(f.tx,engineer,input);assert.equal(result.ok,false);
  if(!result.ok)assert.equal(result.kind,'forbidden');
  assert.equal((await core.persistUploadedProductCover(f.tx,engineer,input,{...image,uploadedById:'e'})).ok,false);
  assert.equal(f.product.sketchFileId,'old');assert.equal(f.files.size,1);assert.equal(f.logs.length,0);
 }
 const f=fixture('old');f.product.status='DONE';
 assert.equal((await core.persistUploadedProductCover(f.tx,{id:'m',roles:['MANAGER','ENGINEER']},{...target(),expectedSketchFileId:'old'},image)).ok,true);
 assert.ok(f.files.has('old'));
});

test('old upload receipt cannot acknowledge its archived file after a later replacement',async()=>{
 const f=fixture('old'),firstInput={...target(),expectedSketchFileId:'old'};
 const first=await core.persistUploadedProductCover(f.tx,actor,firstInput,image);assert.equal(first.ok,true);if(!first.ok)return;
 const second=await core.persistUploadedProductCover(f.tx,actor,{...target(),expectedSketchFileId:first.id!},{...image,storedName:'second.png',contentHash:'b'.repeat(64)});
 assert.equal(second.ok,true);if(!second.ok)return;assert.notEqual(second.id,first.id);
 const count=f.logs.length,filesBefore=[...f.files.entries()];
 const preflight=await core.authorizeProductCoverUpload(f.tx,actor,firstInput);assert.equal(preflight.ok,false);if(!preflight.ok)assert.equal(preflight.kind,'conflict');
 const oldReplay=await core.persistUploadedProductCover(f.tx,actor,firstInput,image);assert.equal(oldReplay.ok,false);if(!oldReplay.ok){assert.equal(oldReplay.kind,'conflict');assert.equal(oldReplay.currentSketchFileId,second.id);}
 assert.equal(f.product.sketchFileId,second.id);assert.deepEqual([...f.files.entries()],filesBefore);assert.equal(f.logs.length,count);
 assert.ok(f.files.has('old'));assert.ok(f.files.has(first.id!));
});

test('old bind or delete receipt cannot acknowledge an outdated pointer after replacement',async()=>{
 for(const operation of ['bind','delete'] as const){
  const f=fixture(operation==='bind'?null:'old'),mutation=randomUUID();
  const bind={productId:'p',fileId:'old',expectedSketchFileId:null,clientMutationId:mutation};
  const remove={productId:'p',expectedSketchFileId:'old',clientMutationId:mutation};
  const first=operation==='bind'?await core.bindProductSketchCore(f.tx,actor,bind):await core.deleteProductSketchCore(f.tx,actor,remove);
  assert.equal(first.ok,true);
  const uploaded=await core.persistUploadedProductCover(f.tx,actor,{...target(),expectedSketchFileId:f.product.sketchFileId},image);assert.equal(uploaded.ok,true);if(!uploaded.ok)return;
  const count=f.logs.length,files=[...f.files.entries()];
  const replay=operation==='bind'?await core.bindProductSketchCore(f.tx,actor,bind):await core.deleteProductSketchCore(f.tx,actor,remove);
  assert.equal(replay.ok,false);if(!replay.ok){assert.equal(replay.kind,'conflict');assert.equal(replay.currentSketchFileId,uploaded.id);}
  assert.equal(f.product.sketchFileId,uploaded.id);assert.deepEqual([...f.files.entries()],files);assert.equal(f.logs.length,count);
 }
});
