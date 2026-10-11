import assert from 'node:assert/strict';
import {createRequire,Module} from 'node:module';
import {test} from 'node:test';
import sharp from 'sharp';
import {createMemoryEventQueueFixture,memoryEvent} from './helpers/event-queue-fixture';
import type {QueuedDomainEvent} from '../src/server/plugins/event-queue-contract';
const require=createRequire(import.meta.url);
function inject(name:string,exports:Record<string,unknown>){const filename=require.resolve(name),stub=new Module(filename);stub.filename=filename;stub.loaded=true;stub.exports=exports;require.cache[filename]=stub;}
const files=new Map<string,Record<string,unknown>>(),receipts=new Map<string,Record<string,unknown>>(),events=new Map<string,QueuedDomainEvent>();
let queue=createMemoryEventQueueFixture();
const erasedExactKeys=new Set<string>();let cleanupFailure=false,nextFile=0,commits=0;
let storageFailure=false,auditFailure=false,notifyFailure=false,commitAckFailure=false,failPut=0,puts=0,deletes=0,notifies=0;
const storedBytes:Buffer[]=[],deletedKeys:string[]=[];
const projectRow={id:'j',number:'1',products:[],tasks:[],coverFileId:null as string|null};
const productRow={id:'p',number:'1.1',projectId:'j',engineerId:'e',status:'DESIGN',sketchFileId:null as string|null};
let actorRoles=['MANAGER'],actorId='m',sessionMissing=false;
const tx={$queryRaw:async()=>[],project:{findFirst:async()=>projectRow,updateMany:async({where,data}:{where:{coverFileId:string|null};data:{coverFileId:string|null}})=>{if(projectRow.coverFileId!==where.coverFileId)return{count:0};projectRow.coverFileId=data.coverFileId;return{count:1}}},product:{findFirst:async()=>productRow,findUnique:async()=>productRow,updateMany:async({where,data}:{where:{sketchFileId:string|null};data:{sketchFileId:string|null}})=>{if(productRow.sketchFileId!==where.sketchFileId)return{count:0};productRow.sketchFileId=data.sketchFileId;return{count:1}}},task:{findMany:async()=>[]},file:{create:async({data}:{data:Record<string,unknown>})=>{const row={...data,id:'c'+nextFile++};files.set(row.id,row);return row},findUnique:async({where}:{where:{id:string}})=>files.get(where.id)??null,findFirst:async({where}:{where:{AND?:{id?:string}[];OR?:{id?:string;projectId?:string;storedName?:string}[]}})=>where.AND?files.get(where.AND[0].id!)??null:[...files.values()].find(row=>where.OR?.some(condition=>condition.id?row.id===condition.id:row.projectId===condition.projectId&&row.storedName===condition.storedName))??null,count:async({where}:{where:{id:{not:string};projectId:string;storedName:string}})=>[...files.values()].filter(row=>row.id!==where.id.not&&row.projectId===where.projectId&&row.storedName===where.storedName).length,delete:async({where}:{where:{id:string}})=>{const old=files.get(where.id);files.delete(where.id);return old}},changeLog:{findUnique:async({where}:{where:{id:string}})=>receipts.get(where.id)??null,create:async({data}:{data:Record<string,unknown>})=>{if(auditFailure)throw Error('PRIVATE_DB');receipts.set((data.id as string)??'audit'+receipts.size,data);return data}},domainEvent:{create:async({data}:{data:Pick<QueuedDomainEvent,"id"|"type"|"payload"|"actor">})=>{const row={...memoryEvent(0),...data,createdAt:new Date(queue.now()),nextAttemptAt:new Date(queue.now())};events.set(row.id,row);queue.rows.push(row);return row},findUnique:async({where}:{where:{id:string}})=>events.get(where.id)??null,update:async({where,data}:{where:{id:string};data:Record<string,unknown>})=>{const row=events.get(where.id)!;const count=Number(row.attempts)+1;Object.assign(row,data,{attempts:count});return row},updateMany:async({where,data}:{where:{id:string;processedAt:null};data:Record<string,unknown>})=>{const row=events.get(where.id);if(!row||row.processedAt)return{count:0};Object.assign(row,data,{attempts:Number(row.attempts)+1});return{count:1}}}};
inject('../src/auth',{auth:async()=>sessionMissing?null:({user:{id:actorId,name:'M',roles:actorRoles}})});
inject('../src/lib/prisma',{prisma:tx});
// Handler/core/executor настоящие; SQL adapter подменён общей queue fixture, native SQL проверяется отдельно.
inject('../src/server/plugins/event-queue-store',{createPostgresEventQueueStore:()=>queue.store});
inject('../src/server/tasks/transaction',{withTaskTransaction:async(fn:(t:typeof tx)=>Promise<unknown>)=>{const before=new Map(files),logs=new Map(receipts),beforeEvents=new Map(events),oldProductCover=productRow.sketchFileId,oldProjectCover=projectRow.coverFileId;let result;try{result=await fn(tx)}catch(e){files.clear();before.forEach((v,k)=>files.set(k,v));receipts.clear();logs.forEach((v,k)=>receipts.set(k,v));events.clear();beforeEvents.forEach((v,k)=>events.set(k,v));queue.rows.splice(0,queue.rows.length,...events.values());productRow.sketchFileId=oldProductCover;projectRow.coverFileId=oldProjectCover;throw e}commits++;if(commitAckFailure)throw Error('PRIVATE_COMMIT_ACK');return result}});
inject('../src/lib/s3',{UPLOADS_ROOT:'unused',s3Enabled:()=>true,fileKey:(id:string,n:string)=>id+'/'+n,thumbKey:(id:string,n:string)=>id+'/thumbs/'+n+'.jpg',s3Put:async(_key:string,bytes:Buffer)=>{puts++;storedBytes.push(bytes);if(storageFailure||puts===failPut)throw Error('PRIVATE_ENDPOINT_SECRET')},s3Delete:async(key:string)=>{deletes++;deletedKeys.push(key)},s3DeleteExact:async(key:string)=>{assert.ok(commits>0,'old storage deletion starts after COMMIT');assert.equal(files.has('old'),false);if(cleanupFailure&&key==='j/thumbs/old.png.jpg')throw Error('PRIVATE_CLEANUP_ENDPOINT');if(!erasedExactKeys.has(key)){erasedExactKeys.add(key);deletes++;deletedKeys.push(key);}}});
inject('../src/server/plugins/changelog',{writeChangeLog:async()=>{if(auditFailure)throw Error('PRIVATE_DB')}});
inject('../src/server/notifications/notify',{notifyOrg:async()=>{notifies++;if(notifyFailure)throw Error('PRIVATE_NOTIFY')}});
inject('next/cache',{revalidatePath:()=>{}});
const {POST}=require('../src/app/api/files/upload/route') as typeof import('../src/app/api/files/upload/route');
const uuid='12222222-2222-4222-8222-222222222222';
function request(bytes:string|Uint8Array<ArrayBuffer>='original',mutation=uuid,image=false,section:'GENERAL'|'MEASUREMENT'|'PRODUCTION'|'INSTALLATION'='GENERAL'){const values={file:new File([bytes],image?'qa.png':'qa.pdf',{type:image?'image/png':'application/pdf'}),projectId:'j',productId:'p',section,clientMutationId:mutation};return {formData:async()=>({get:(key:string)=>values[key as keyof typeof values]??null})} as unknown as Request}
function reset(){sessionMissing=false;files.clear();receipts.clear();events.clear();queue=createMemoryEventQueueFixture();erasedExactKeys.clear();cleanupFailure=false;nextFile=commits=0;storedBytes.length=deletedKeys.length=0;projectRow.coverFileId=productRow.sketchFileId=null;productRow.status='DESIGN';actorId='m';actorRoles=['MANAGER'];storageFailure=auditFailure=notifyFailure=commitAckFailure=false;failPut=puts=deletes=notifies=0;}
test('storage exception becomes sanitized JSON with phase; no file recorded',async()=>{reset();storageFailure=true;const r=await POST(request());assert.equal(r.status,500);const x=await r.json();assert.equal(x.details.phase,'storage-original');assert.equal(x.commitState,'notCommitted');assert.equal(typeof x.requestId,'string');assert.equal(JSON.stringify(x).includes('PRIVATE'),false);assert.equal(files.size,0)});
test('lost ACK exact replay does not store or notify twice; changed bytes conflict',async()=>{reset();const first=await(await POST(request())).json();assert.equal(first.ok,true);const second=await(await POST(request())).json();assert.equal(second.id,first.id);assert.equal(second.repeated,true);assert.equal(puts,1);assert.equal(notifies,1);const changed=await POST(request('different'));assert.equal(changed.status,409);assert.equal(files.size,1);assert.equal(puts,1)});
test('audit failure rolls back file and compensates exact storage; notify failure keeps success',async()=>{reset();auditFailure=true;const fail=await POST(request());assert.equal(fail.status,500);assert.equal(files.size,0);assert.equal(receipts.size,0);assert.equal(deletes,1);reset();notifyFailure=true;const good=await POST(request());assert.equal(good.status,200);assert.equal((await good.json()).ok,true);assert.equal(files.size,1);assert.equal(receipts.size,1)});
test('unknown commit ACK never deletes possibly committed original; exact replay resolves outcome',async()=>{reset();commitAckFailure=true;const fail=await POST(request());assert.equal(fail.status,500);assert.equal((await fail.json()).commitState,'unknown');assert.equal(files.size,1);assert.equal(deletes,0);commitAckFailure=false;const replay=await(await POST(request())).json();assert.equal(replay.ok,true);assert.equal(replay.repeated,true);assert.equal(puts,1)});
test('thumbnail failure distinguishes phase, keeps original bytes unchanged, and records no file',async()=>{reset();const original=await sharp({create:{width:2,height:2,channels:3,background:'#ff0000'}}).png().toBuffer();failPut=2;const response=await POST(request(new Uint8Array(original),uuid,true));assert.equal(response.status,500);const x=await response.json();assert.equal(x.details.phase,'storage-thumb');assert.equal(x.code,'STORAGE_WRITE_FAILED');assert.deepEqual(storedBytes[0],original);assert.equal(files.size,0);assert.equal(deletes,2)});
function projectRequest(file:File,extra:Record<string,unknown>={}){const values:Record<string,unknown>={file,projectId:'j',section:'GENERAL',assignProjectCover:'1',expectedCoverFileId:'null',clientMutationId:uuid,...extra};return{formData:async()=>({get:(key:string)=>values[key]??null})} as unknown as Request;}
test('project target rejects mixed product/task modes and engineer before bytes/storage',async()=>{reset();const file=new File(['not read'],'qa.png',{type:'image/png'});file.arrayBuffer=async()=>{throw Error('BYTES_MUST_NOT_BE_READ')};for(const extra of [{productId:'p'},{taskId:'t'},{assignCover:'1'},{stage:'PRODUCTION'}]){const r=await POST(projectRequest(file,extra));assert.equal(r.status,422);}actorRoles=['ENGINEER'];assert.equal((await POST(projectRequest(file))).status,404);assert.equal(puts,0);assert.equal(files.size,0);});
test('project cover actual POST preserves original bytes and replay has no extra storage writes',async()=>{reset();const bytes=await sharp({create:{width:2,height:2,channels:3,background:'#00ff00'}}).png().toBuffer(),file=new File([new Uint8Array(bytes)],'qa.png',{type:'image/png'});const first=await(await POST(projectRequest(file))).json();assert.equal(first.ok,true);assert.equal(first.coverFileId,first.id);assert.equal(first.cover.id,first.id);assert.deepEqual(storedBytes[0],bytes);assert.equal(projectRow.coverFileId,first.id);const again=await(await POST(projectRequest(file))).json();assert.equal(again.id,first.id);assert.equal(again.repeated,true);assert.equal(puts,2);assert.equal(files.size,1);});

function sketchRequest(file:File,baseline:unknown='old',mutation=uuid){const values:Record<string,unknown>={file,projectId:'j',productId:'p',section:'PRODUCTION',assignCover:'1',expectedSketchFileId:baseline,clientMutationId:mutation};return{formData:async()=>({get:(key:string)=>values[key]??null})} as unknown as Request;}
function oldSketch(){const old={id:'old',projectId:'j',productId:'p',taskId:null,mimeType:'image/png',fileName:'old.png',storedName:'old.png',hasThumb:true,uploadedById:'m'};files.set('old',old);productRow.sketchFileId='old';actorId='e';actorRoles=['ENGINEER'];return old;}

test('sketch replacement actual POST keeps new bytes, removes old manager file and replays exact cleanup',async()=>{
 reset();oldSketch();const bytes=await sharp({create:{width:2,height:2,channels:3,background:'#0000ff'}}).png().toBuffer(),file=new File([new Uint8Array(bytes)],'replacement.png',{type:'image/png'});
 const response=await POST(sketchRequest(file));assert.equal(response.status,200);const first=await response.json();
 assert.equal(first.ok,true);assert.equal(productRow.sketchFileId,first.id);assert.equal(first.sketch.id,first.id);assert.equal(files.has('old'),false);assert.equal(files.size,1);assert.equal(deletes,2);assert.equal(events.size,1);assert.deepEqual(storedBytes[0],bytes);
 const replay=await(await POST(sketchRequest(file))).json();assert.equal(replay.repeated,true);assert.equal(replay.id,first.id);assert.equal(puts,2);assert.equal(files.size,1);
});

test('missing or stale sketch baseline is refused before reading bytes/storage',async()=>{
 const file=new File(['not read'],'qa.png',{type:'image/png'});file.arrayBuffer=async()=>{throw Error('BYTES_MUST_NOT_BE_READ')};
 reset();oldSketch();assert.equal((await POST(sketchRequest(file,null))).status,422);assert.equal(puts,0);assert.equal(productRow.sketchFileId,'old');
 productRow.sketchFileId='other-current';assert.equal((await POST(sketchRequest(file))).status,409);assert.equal(puts,0);assert.equal(files.size,1);
});

test('failed replacement transaction restores old pointer and compensates only new keys',async()=>{
 reset();const old=oldSketch(),bytes=await sharp({create:{width:2,height:2,channels:3,background:'#0000ff'}}).png().toBuffer(),file=new File([new Uint8Array(bytes)],'replacement.png',{type:'image/png'});auditFailure=true;
 const response=await POST(sketchRequest(file));assert.equal(response.status,500);assert.equal(productRow.sketchFileId,'old');assert.equal(files.get('old'),old);assert.equal(files.size,1);assert.equal(receipts.size,0);assert.equal(deletes,2);assert.ok(deletedKeys.every(key=>!key.endsWith('/old.png')));
});

test('handler itself denies missing session and financial-only/read-only roles before body access',async()=>{
 for(const roles of [null,['ACCOUNTANT'],['PROCUREMENT'],[]]){reset();sessionMissing=roles===null;actorRoles=roles??[];let reads=0;const req={formData:async()=>{reads++;throw Error('BODY_MUST_NOT_BE_READ')}} as unknown as Request;const response=await POST(req);assert.equal(response.status,roles===null?401:403);const body=await response.json();assert.equal(body.ok,false);assert.equal(body.commitState,'notCommitted');assert.equal(reads,0);assert.equal(puts,0);assert.equal(files.size,0);}
});
test('legitimate combined manager grant still uploads after early operational guard',async()=>{reset();actorRoles=['ACCOUNTANT','MANAGER'];const response=await POST(request());assert.equal(response.status,200);assert.equal((await response.json()).ok,true);assert.equal(files.size,1);});


test('same bytes and mutation cannot replay into another section or produce a second attachment',async()=>{
 reset();const first=await(await POST(request('section proof',uuid,false,'PRODUCTION'))).json();assert.equal(first.ok,true);assert.equal(files.get(first.id)?.section,'PRODUCTION');
 const original=structuredClone([...files.values()]),originalLogs=structuredClone([...receipts.values()]);const conflicting=await POST(request('section proof',uuid,false,'INSTALLATION'));assert.equal(conflicting.status,409);assert.equal((await conflicting.json()).code,'UPLOAD_REPLAY_CONFLICT');assert.equal(puts,1);assert.deepEqual([...files.values()],original);assert.deepEqual([...receipts.values()],originalLogs);
 const exact=await(await POST(request('section proof',uuid,false,'PRODUCTION'))).json();assert.equal(exact.id,first.id);assert.equal(exact.repeated,true);assert.equal(puts,1);assert.equal(notifies,1);
});
// Concurrent duplicate cover delivery must model the real Product row lock.
let serializeSketchTransactions = false;
let sketchQueue: Promise<void> = Promise.resolve();
let originalBarrier: (() => Promise<void>) | null = null;
const priorTransaction = require.cache[require.resolve('../src/server/tasks/transaction')]!.exports.withTaskTransaction;
require.cache[require.resolve('../src/server/tasks/transaction')]!.exports.withTaskTransaction = async (fn: (t: typeof tx) => Promise<unknown>) => {
 if (!serializeSketchTransactions) return priorTransaction(fn);
 const previous = sketchQueue;
 let release!: () => void;
 sketchQueue = new Promise<void>(resolve => { release = resolve; });
 await previous;
 try { return await priorTransaction(fn); } finally { release(); }
};
const priorS3Put = require.cache[require.resolve('../src/lib/s3')]!.exports.s3Put;
require.cache[require.resolve('../src/lib/s3')]!.exports.s3Put = async (key: string, bytes: Buffer) => {
 await priorS3Put(key, bytes);
 if (!key.includes('/thumbs/') && originalBarrier) await originalBarrier();
};

test('112 concurrent identical engineer replacement keeps one receipt and compensates only duplicate upload keys', async () => {
 reset(); oldSketch();
 const bytes = await sharp({create:{width:2,height:2,channels:3,background:'#112233'}}).png().toBuffer();
 const image = () => new File([new Uint8Array(bytes)],'replacement.png',{type:'image/png'});
 let arrivals = 0; let release!: () => void;
 const bothStored = new Promise<void>(resolve => { release = resolve; });
 serializeSketchTransactions = true;
 originalBarrier = async () => { if (++arrivals === 2) release(); await bothStored; };
 try {
  const responses = await Promise.all([POST(sketchRequest(image())), POST(sketchRequest(image()))]);
  assert.deepEqual(responses.map(response => response.status), [200,200]);
  const results = await Promise.all(responses.map(response => response.json()));
  assert.equal(results[0].id, results[1].id);
  assert.equal(results.filter(result => result.repeated === true).length, 1);
  assert.equal(productRow.sketchFileId, results[0].id);
  assert.equal(files.has('old'), false);
  assert.equal(files.size, 1);
  assert.equal(events.size, 1);
  assert.equal(puts, 4);
  assert.equal(deletes, 4, 'remove obsolete original/thumb and discard duplicate original/thumb');
  assert.equal(notifies, 1, 'the already committed replacement must not notify twice');
  const accepted = files.get(results[0].id)!;
  assert.ok(deletedKeys.every(key => key !== `j/${accepted.storedName}` && key !== `j/thumbs/${accepted.storedName}.jpg`));
 } finally { serializeSketchTransactions = false; originalBarrier = null; }
});

test('112 engineer replacement also removes a legacy current sketch with no upload author', async () => {
 reset(); const old = oldSketch(); Object.assign(old,{uploadedById:null});
 const bytes = await sharp({create:{width:2,height:2,channels:3,background:'#223344'}}).png().toBuffer();
 const response = await POST(sketchRequest(new File([new Uint8Array(bytes)],'replacement.png',{type:'image/png'})));
 assert.equal(response.status, 200);
 assert.equal((await response.json()).ok, true);
 assert.equal(files.has('old'), false);
 assert.equal(old.uploadedById, null);
 assert.equal(files.size, 1);
 assert.equal(deletes, 2);
});

test('committed cleanup failure returns503 without success and same nonce finishes old thumb without new file',async()=>{
 reset();oldSketch();cleanupFailure=true;
 const bytes=await sharp({create:{width:2,height:2,channels:3,background:'#445566'}}).png().toBuffer(),file=new File([new Uint8Array(bytes)],'replacement.png',{type:'image/png'});
 const first=await POST(sketchRequest(file));assert.equal(first.status,503);const failure=await first.json();
 assert.equal(failure.ok,false);assert.equal(failure.code,'SKETCH_CLEANUP_PENDING');assert.equal(failure.commitState,'committed');assert.equal(JSON.stringify(failure).includes('PRIVATE'),false);
 assert.equal(files.has('old'),false);assert.equal(files.size,1);const winner=productRow.sketchFileId;
 assert.equal(events.size,1);assert.equal([...events.values()][0].processedAt,null);assert.equal(notifies,1);assert.equal(puts,2);
 cleanupFailure=false;const repeated=await POST(sketchRequest(file));assert.equal(repeated.status,200);const ack=await repeated.json();
 assert.equal(ack.repeated,true);assert.equal(ack.id,winner);assert.equal(ack.cleanupEventId,undefined);assert.ok([...events.values()][0].processedAt);
 assert.equal(puts,2);assert.equal(notifies,1);assert.equal(deletes,2);assert.equal(files.size,1);
});

test('unknown replacement commit leaves old blobs until exact replay confirms commit and finishes cleanup',async()=>{
 reset();oldSketch();commitAckFailure=true;
 const bytes=await sharp({create:{width:2,height:2,channels:3,background:'#446677'}}).png().toBuffer(),file=new File([new Uint8Array(bytes)],'replacement.png',{type:'image/png'});
 const first=await POST(sketchRequest(file));assert.equal(first.status,500);assert.equal(deletes,0);assert.equal(files.has('old'),false);assert.equal(events.size,1);
 commitAckFailure=false;const replay=await POST(sketchRequest(file));assert.equal(replay.status,200);assert.equal((await replay.json()).repeated,true);assert.equal(deletes,2);assert.equal(puts,2);
});

test('superseded failed cleanup replay reports current winner; existing dispatcher completes only obsolete keys',async()=>{
 reset();oldSketch();cleanupFailure=true;
 const bytes=await sharp({create:{width:2,height:2,channels:3,background:'#556677'}}).png().toBuffer(),file=new File([new Uint8Array(bytes)],'first.png',{type:'image/png'});
 assert.equal((await POST(sketchRequest(file))).status,503);const firstId=productRow.sketchFileId!;
 cleanupFailure=false;
 const second=await POST(sketchRequest(new File([new Uint8Array(bytes)],'second.png',{type:'image/png'}),firstId,'32222222-2222-4222-8222-222222222222'));
 assert.equal(second.status,200);const winner=await second.json();assert.equal(files.has(firstId),false);
 const writes=puts;const stale=await POST(sketchRequest(file));assert.equal(stale.status,409);const refusal=await stale.json();assert.equal(refusal.currentSketchFileId,winner.id);assert.equal(refusal.sketch,undefined);assert.equal(puts,writes);
 const current=files.get(winner.id)!;const {dispatchEvent}=require('../src/server/plugins/events') as typeof import('../src/server/plugins/events');
 await dispatchEvent('sketch-cleanup:'+uuid);assert.equal(events.get('sketch-cleanup:'+uuid)!.processedAt,null,'backoff intent remains pending before due');
 await queue.advance(queue.settings.backoffBaseMs);
 await dispatchEvent('sketch-cleanup:'+uuid);assert.ok(events.get('sketch-cleanup:'+uuid)!.processedAt);
 assert.ok(!deletedKeys.includes('j/'+current.storedName));assert.ok(!deletedKeys.includes('j/thumbs/'+current.storedName+'.jpg'));assert.equal(productRow.sketchFileId,winner.id);
});

test('two different concurrent replacements give one winner and remove only obsolete and losing fresh keys',async()=>{
 reset();oldSketch();const bytes=await sharp({create:{width:2,height:2,channels:3,background:'#667788'}}).png().toBuffer();
 let arrivals=0;let release!:()=>void;const both=new Promise<void>(resolve=>{release=resolve});serializeSketchTransactions=true;
 originalBarrier=async()=>{if(++arrivals===2)release();await both;};
 try{
  const responses=await Promise.all([POST(sketchRequest(new File([new Uint8Array(bytes)],'a.png',{type:'image/png'}))),POST(sketchRequest(new File([new Uint8Array(bytes)],'b.png',{type:'image/png'}),'old','42222222-2222-4222-8222-222222222222'))]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);assert.equal(files.size,1);assert.equal(events.size,1);assert.equal(files.has('old'),false);assert.equal(deletes,4);
  const current=files.get(productRow.sketchFileId!)!;assert.ok(deletedKeys.every(key=>key!=='j/'+current.storedName&&key!=='j/thumbs/'+current.storedName+'.jpg'));
 }finally{serializeSketchTransactions=false;originalBarrier=null;}
});
