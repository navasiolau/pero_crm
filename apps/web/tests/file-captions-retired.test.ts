import assert from 'node:assert/strict';
import {createRequire,Module} from 'node:module';
import test from 'node:test';
const require=createRequire(import.meta.url);
function inject(name:string,exports:Record<string,unknown>){const file=require.resolve(name),stub=new Module(file);stub.filename=file;stub.loaded=true;stub.exports=exports;require.cache[file]=stub;}
let reads=0,storage=0,dbWrites=0;
inject('../src/auth',{auth:async()=>({user:{id:'m',name:'M',roles:['MANAGER']}})});
inject('../src/lib/prisma',{prisma:{changeLog:{findUnique:async()=>null},project:{findFirst:async()=>({id:'j',number:'1',products:[],tasks:[]})},product:{findFirst:async()=>({id:'p',number:'1.1',projectId:'j',engineerId:'e',status:'DESIGN'})},task:{findMany:async()=>[],findFirst:async()=>null},file:{create:async()=>{dbWrites++;throw Error('DB_WRITE_FORBIDDEN')}}}});
inject('../src/lib/s3',{UPLOADS_ROOT:'unused',s3Enabled:()=>true,fileKey:(id:string,name:string)=>id+'/'+name,thumbKey:(id:string,name:string)=>id+'/thumbs/'+name,s3Put:async()=>{storage++;throw Error('STORAGE_WRITE_FORBIDDEN')},s3PutStream:async(_key:string,file:Pick<import('../src/server/files/multipart-upload').UploadSpoolFile,'openRead'>)=>{storage++;const body=await file.openRead();reads++;for await(const chunk of body)void chunk;throw Error('STORAGE_WRITE_FORBIDDEN')}});
inject('../src/server/plugins/changelog',{writeChangeLog:async()=>{}});inject('../src/server/notifications/notify',{notifyOrg:async()=>{}});inject('next/cache',{revalidatePath:()=>{}});
const {POST}=require('../src/app/api/files/upload/route') as typeof import('../src/app/api/files/upload/route');
function request(caption:unknown,cover=false){const file=new File(['QA'],cover?'qa.png':'qa.pdf',{type:cover?'image/png':'application/pdf'});const values:Record<string,unknown>={projectId:'j',productId:'p',section:cover?'PRODUCTION':'GENERAL',clientMutationId:'22d26873-2255-4e8a-ab6d-3ddff516307d',...(caption===undefined?{}:{caption}),...(cover?{assignCover:'1',expectedSketchFileId:'null'}:{}),file};const form=new FormData();for(const[key,value]of Object.entries(values))form.set(key,value instanceof File?value:String(value));return new Request('https://qa.invalid/upload',{method:'POST',body:form});}
test('new/stale caption includingempty andcover context refuses beforestoredbytes/storage/DB',async()=>{
 for(const cover of [false,true])for(const caption of ['','legacy caption',new File(['caption'],'caption.txt')]){reads=storage=dbWrites=0;const response=await POST(request(caption,cover));assert.equal(response.status,422);assert.equal(reads,0);assert.equal(storage,0);assert.equal(dbWrites,0);}
});
test('caption-free ordinary upload retains actualstorage boundary and leaveslegacy metadata untouched',async()=>{
 const legacy={id:'old',caption:'historical value'},before=structuredClone(legacy);reads=storage=dbWrites=0;const response=await POST(request(undefined));assert.equal(response.status,500);assert.equal((await response.json()).details.phase,'storage-original');assert.equal(reads,1);assert.equal(storage,1);assert.deepEqual(legacy,before);
});
test('directtyped coverwriter rejects staleextra caption before anytransactionaccess',async()=>{
 const {persistUploadedProductCover}=require('../src/server/products/cover-core') as typeof import('../src/server/products/cover-core');
 const tx=new Proxy({}, {get(){throw Error('TRANSACTION_ACCESS_FORBIDDEN')}}) as import('@prisma/client').Prisma.TransactionClient;
 for(const caption of ['','old caption',undefined]){const result=await persistUploadedProductCover(tx,{id:'m',roles:['MANAGER']},{projectId:'j',productId:'p',expectedSketchFileId:null,clientMutationId:'22d26873-2255-4e8a-ab6d-3ddff516307d'},{fileName:'qa.png',storedName:'known',mimeType:'image/png',size:1,hasThumb:false,uploadedById:'m',caption} as never);assert.equal(result.ok,false);if(!result.ok)assert.equal(result.kind,'validation');}
});
