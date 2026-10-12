import assert from 'node:assert/strict';
import {createRequire,Module} from 'node:module';
import {test} from 'node:test';
import {multipartRequest} from "./helpers/multipart-request";
const require=createRequire(import.meta.url);
function inject(name:string,exports:Record<string,unknown>){const filename=require.resolve(name),stub=new Module(filename);stub.filename=filename;stub.loaded=true;stub.exports=exports;require.cache[filename]=stub;}
let storageCalls=0,bytesReads=0,streamReads=0;let storedBytes=Buffer.alloc(0);
inject('../src/auth',{auth:async()=>({user:{id:'m',name:'M',roles:['MANAGER']}})});
inject('../src/lib/prisma',{prisma:{changeLog:{findUnique:async()=>null},project:{findFirst:async()=>({id:'j',number:'1',products:[],tasks:[]})},product:{findFirst:async()=>({id:'p',number:'1.1',projectId:'j',engineerId:'e',status:'DESIGN'})},task:{findMany:async()=>[],findFirst:async()=>null}}});
inject('../src/lib/s3',{UPLOADS_ROOT:'unused-unit-boundary',s3Enabled:()=>true,fileKey:(id:string,name:string)=>id+'/'+name,thumbKey:(id:string,name:string)=>id+'/thumbs/'+name,s3Put:async()=>{storageCalls++;throw new Error('UNIT_STORAGE_BOUNDARY_MUST_NOT_WRITE')},s3PutStream:async(_key:string,source:{openRead:()=>Promise<NodeJS.ReadableStream>})=>{storageCalls++;const chunks:Buffer[]=[];for await(const chunk of await source.openRead())chunks.push(Buffer.from(chunk));storedBytes=Buffer.concat(chunks);throw new Error('UNIT_STORAGE_BOUNDARY_MUST_NOT_WRITE')}});
inject('../src/server/plugins/changelog',{writeChangeLog:async()=>{}});inject('../src/server/notifications/notify',{notifyOrg:async()=>{}});inject('next/cache',{revalidatePath:()=>{}});
const {POST}=require('../src/app/api/files/upload/route') as typeof import('../src/app/api/files/upload/route');
function request(fields:Record<string,unknown>={}){const file=new File(['QA PDF'],'qa.pdf',{type:'application/pdf'});const read=file.arrayBuffer.bind(file);file.arrayBuffer=async()=>{bytesReads++;return read()};const stream=file.stream.bind(file);file.stream=()=>{streamReads++;return stream()};const values:Record<string,unknown>={file,projectId:'j',productId:'p',clientMutationId:'12222222-2222-4222-8222-222222222222',...fields};return multipartRequest(values);}

test('obsolete category/stage/caption requests fail closed with refresh instruction before bytes or storage',async()=>{
 for(const key of ['category','stage','caption'])for(const value of ['',key==='category'?'OTHER':key==='stage'?'PRODUCTION':'old',new File(['old'],'old.txt')]){
  storageCalls=bytesReads=streamReads=0;storedBytes=Buffer.alloc(0);const response=await POST(request({[key]:value}));assert.equal(response.status,422);const data=await response.json();assert.equal(data.code,'UPLOAD_FORM_OUTDATED');assert.match(data.error,/Обновите/);assert.equal(storageCalls,0);assert.equal(bytesReads,0);
 }
});
test('invalid explicit section refuses before bytes or storage',async()=>{
 for(const section of ['ASSEMBLY','WRONG_SECTION','',new File(['section'],'section.txt')]){storageCalls=bytesReads=streamReads=0;storedBytes=Buffer.alloc(0);const response=await POST(request({section}));assert.equal(response.status,422);assert.equal(storageCalls,0);assert.equal(bytesReads,0);}
});
test('default general and every real section retain storage boundary with safe structured JSON',async()=>{
 for(const section of [undefined,'GENERAL','MEASUREMENT','PRODUCTION','INSTALLATION']){storageCalls=bytesReads=streamReads=0;storedBytes=Buffer.alloc(0);const response=await POST(request(section===undefined?{}:{section}));assert.equal(response.status,500);assert.equal((await response.json()).details.phase,'storage-original');assert.equal(storageCalls,1);assert.equal(bytesReads,0);assert.equal(streamReads,1);assert.deepEqual(storedBytes,Buffer.from("QA PDF"));}
});
