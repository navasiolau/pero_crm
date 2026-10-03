import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Prisma} from '@prisma/client';
import {authorizeProjectCoverUpload,persistProjectCoverUpload,deleteProjectCoverCore} from '../src/server/projects/cover-core';
const input={projectId:'j',expectedCoverFileId:null,clientMutationId:'12222222-2222-4222-8222-222222222222'} as const;
test('only manager union may upload own project cover; engineer is readonly',async()=>{
 const tx={project:{findFirst:async()=>({id:'j',number:'1',coverFileId:null})},changeLog:{findUnique:async()=>null}} as unknown as Prisma.TransactionClient;
 assert.equal((await authorizeProjectCoverUpload(tx,{id:'m',roles:['MANAGER']},input)).ok,true);
 assert.equal((await authorizeProjectCoverUpload(tx,{id:'e',roles:['ENGINEER']},input)).ok,false);
 assert.equal((await authorizeProjectCoverUpload(tx,{id:'me',roles:['MANAGER','ENGINEER']},input)).ok,true);
});
const actor={id:'m',roles:['MANAGER'] as ['MANAGER']};
const upload={fileName:'original.png',storedName:'owned.png',mimeType:'image/png',size:5,hasThumb:true,contentHash:'exact-original-hash'};
function fixture(){
 const project={id:'j',number:'1',coverFileId:null as string|null},files=new Map<string,Record<string,unknown>>(),logs=new Map<string,Record<string,unknown>>();let failAudit=false;
 const tx={
  $queryRaw:async()=>[],project:{findFirst:async()=>project,updateMany:async({where,data}:{where:{coverFileId:string|null};data:{coverFileId:string|null}})=>{if(project.coverFileId!==where.coverFileId)return{count:0};project.coverFileId=data.coverFileId;return{count:1}}},
  file:{create:async({data}:{data:Record<string,unknown>})=>{const row={...data,id:'file-'+files.size};files.set(row.id,row);return row},findUnique:async({where}:{where:{id:string}})=>files.get(where.id)??null,delete:async({where}:{where:{id:string}})=>files.delete(where.id)},
  changeLog:{findUnique:async({where}:{where:{id:string}})=>logs.get(where.id)??null,create:async({data}:{data:Record<string,unknown>})=>{if(failAudit)throw Error('AUDIT_FAILURE');logs.set((data.id as string)??'audit-'+logs.size,data);return data}},
 } as unknown as Prisma.TransactionClient;
 async function transaction<T>(fn:()=>Promise<T>){const before=project.coverFileId,f=new Map(files),l=new Map(logs);try{return await fn()}catch(e){project.coverFileId=before;files.clear();f.forEach((v,k)=>files.set(k,v));logs.clear();l.forEach((v,k)=>logs.set(k,v));throw e;}}
 return{tx,project,files,logs,transaction,failAudit:()=>{failAudit=true;}};
}
test('upload empty project stores one original metadata/pointer/audit, exact replay and reused UUID conflict',async()=>{
 const f=fixture(),first=await persistProjectCoverUpload(f.tx,actor,input,upload);assert.equal(first.ok,true);assert.equal(f.files.size,1);assert.equal(f.project.coverFileId,'file-0');
 const repeat=await persistProjectCoverUpload(f.tx,actor,input,{...upload,storedName:'different-random-key'});assert.equal(repeat.ok,true);if(repeat.ok)assert.equal(repeat.repeated,true);assert.equal(f.files.size,1);
 const changed=await persistProjectCoverUpload(f.tx,actor,input,{...upload,contentHash:'changed'});assert.equal(changed.ok,false);if(!changed.ok)assert.equal(changed.kind,'conflict');assert.equal(f.project.coverFileId,'file-0');
});
test('foreign/engineer/nonimage/occupied project requests never create a cover',async()=>{
 const f=fixture();assert.equal((await persistProjectCoverUpload(f.tx,{id:'e',roles:['ENGINEER']},input,upload)).ok,false);assert.equal((await persistProjectCoverUpload(f.tx,actor,input,{...upload,mimeType:'application/pdf'})).ok,false);f.project.coverFileId='existing';assert.equal((await persistProjectCoverUpload(f.tx,actor,input,upload)).ok,false);assert.equal(f.files.size,0);assert.equal(f.logs.size,0);
});
test('stale delete and foreign/product-bound file refuse without pointer/file/audit writes',async()=>{
 const f=fixture();f.project.coverFileId='new';f.files.set('old',{id:'old'});const request={projectId:'j',expectedCoverFileId:'old',clientMutationId:input.clientMutationId};assert.equal((await deleteProjectCoverCore(f.tx,actor,request)).ok,false);assert.equal(f.files.size,1);assert.equal(f.project.coverFileId,'new');
 for(const fields of [{projectId:'foreign',productId:null,taskId:null},{projectId:'j',productId:'p',taskId:null},{projectId:'j',productId:null,taskId:'t'}]){f.project.coverFileId='old';f.files.set('old',{id:'old',mimeType:'image/png',...fields});assert.equal((await deleteProjectCoverCore(f.tx,actor,request)).ok,false);assert.equal(f.files.size,1);assert.equal(f.logs.size,0);}
});
test('confirmed delete emits exact storage intents, replay does not delete another file',async()=>{
 const f=fixture();await persistProjectCoverUpload(f.tx,actor,input,upload);const request={projectId:'j',expectedCoverFileId:'file-0',clientMutationId:'32222222-2222-4222-8222-222222222222'};
 const result=await deleteProjectCoverCore(f.tx,actor,request);assert.equal(result.ok,true);if(result.ok)assert.deepEqual(result.storageIntent,{projectId:'j',fileId:'file-0',storedName:'owned.png',hasThumb:true});assert.equal(f.files.size,0);assert.equal(f.project.coverFileId,null);
 const repeated=await deleteProjectCoverCore(f.tx,actor,request);assert.equal(repeated.ok,true);if(repeated.ok)assert.equal(repeated.repeated,true);
});
test('audit error rolls back new file and pointer in transaction',async()=>{const f=fixture();f.failAudit();await assert.rejects(f.transaction(()=>persistProjectCoverUpload(f.tx,actor,input,upload)),/AUDIT_FAILURE/);assert.equal(f.project.coverFileId,null);assert.equal(f.files.size,0);assert.equal(f.logs.size,0);});
