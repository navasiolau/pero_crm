import assert from 'node:assert/strict';
import {createRequire,Module} from 'node:module';
import {test} from 'node:test';
const require=createRequire(import.meta.url);
function inject(name:string,exports:Record<string,unknown>){const filename=require.resolve(name),stub=new Module(filename);stub.filename=filename;stub.loaded=true;stub.exports=exports;require.cache[filename]=stub;}
let storageCalls=0,bytesReads=0,plugin=false;
inject('../src/auth',{auth:async()=>({user:{id:'m',name:'M',roles:['MANAGER']}})});
inject('../src/lib/prisma',{prisma:{changeLog:{findUnique:async()=>null},project:{findFirst:async()=>({id:'j',number:'1',products:[],tasks:[]})},product:{findFirst:async()=>({id:'p',number:'1.1',projectId:'j',engineerId:'e',status:'DESIGN'})},task:{findMany:async()=>[],findFirst:async()=>null}}});
inject('../src/lib/s3',{UPLOADS_ROOT:'unused-unit-boundary',s3Enabled:()=>true,fileKey:(id:string,name:string)=>id+'/'+name,thumbKey:(id:string,name:string)=>id+'/thumbs/'+name,s3Put:async()=>{storageCalls++;throw new Error('UNIT_STORAGE_BOUNDARY_MUST_NOT_WRITE')}});
inject('../src/server/files/stage-config',{getFileStageConfig:async()=>({enabled:plugin,extensions:null})});
inject('../src/server/plugins/changelog',{writeChangeLog:async()=>{}});inject('../src/server/notifications/notify',{notifyOrg:async()=>{}});inject('next/cache',{revalidatePath:()=>{}});
const {POST}=require('../src/app/api/files/upload/route') as typeof import('../src/app/api/files/upload/route');
function request(stage?:unknown){const file=new File(['QA PDF'], 'qa.pdf',{type:'application/pdf'});const read=file.arrayBuffer.bind(file);file.arrayBuffer=async()=>{bytesReads++;return read()};const values:Record<string,unknown>={file,projectId:'j',productId:'p',category:'OTHER',clientMutationId:'12222222-2222-4222-8222-222222222222',...(stage===undefined?{}:{stage})};return{formData:async()=>({get:(key:string)=>values[key]??null})} as unknown as Request;}
test('invalid explicit stage refuses before bytes or storage with plugin on and off',async()=>{for(plugin of [false,true]){storageCalls=0;bytesReads=0;const response=await POST(request('WRONG_STAGE'));assert.equal(response.status,422);assert.equal(storageCalls,0);assert.equal(bytesReads,0)}});
test('missing stage and every real enum value retain the existing storage boundary path with safe JSON',async()=>{for(const stage of [undefined,'PRODUCTION','ASSEMBLY','INSTALLATION']){storageCalls=0;bytesReads=0;const response=await POST(request(stage));assert.equal(response.status,500);assert.equal((await response.json()).details.phase,'storage-original');assert.equal(storageCalls,1);assert.equal(bytesReads,1)}});
