import assert from "node:assert/strict";
import {test} from "node:test";
import {mkdtemp,mkdir,writeFile,readFile,symlink,unlink,rmdir,realpath} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {createRequire,Module} from "node:module";
import type {PrismaClient,Prisma} from "@prisma/client";
import {persistOrdinaryUpload} from "../src/server/files/upload-core";
import {memoryEvent} from "./helpers/event-queue-fixture";
import {FILE_STORAGE_DELETE_EVENT,fileDeleteEventId,fileDeleteKeys,fileDeleteIntentSchema,fileDeleteIntentHash,type FileDeleteStorageIdentity} from "../src/server/files/delete-contract";
import {EventDeliveryError} from "../src/server/plugins/event-queue-contract";
const require=createRequire(import.meta.url),s3File=require.resolve("../src/lib/s3"),stub=new Module(s3File);stub.filename=s3File;stub.loaded=true;
let calls:string[]=[];const identity:FileDeleteStorageIdentity={mode:"s3",endpoint:"https://qa137.invalid/",bucket:"qa137-fixture"};
stub.exports={storageConfiguration:()=>identity,s3Delete:async(key:string)=>{calls.push(key);},s3DeleteExact:async()=>{throw Error("VERSION_PURGE_FORBIDDEN");}};require.cache[s3File]=stub;
const {executeFileDeleteCleanup,removeFileDeleteKey,removeLocalFileDeleteKey}=require("../src/server/files/delete-storage") as typeof import("../src/server/files/delete-storage");
const mutation="00000000-0000-4000-8000-000000000137",intent={fileId:"file",projectId:"project",storedName:"original.pdf",hasThumb:true,actorId:"manager",clientMutationId:mutation,storage:identity,keys:fileDeleteKeys({projectId:"project",storedName:"original.pdf",hasThumb:true})};
const event={...memoryEvent(1),id:fileDeleteEventId(mutation),type:FILE_STORAGE_DELETE_EVENT,actor:"user:manager",payload:intent};
const db=(referenced=false)=>({file:{findFirst:async()=>referenced?{id:"new-binding"}:null},changeLog:{findUnique:async()=>({actorId:"manager",entity:"file",entityId:"file",action:"delete",newValue:{intentHash:fileDeleteIntentHash(intent)}})}}) as unknown as Pick<PrismaClient,"file"|"changeLog">;
const owned={isActive:()=>true,ensureOwned:async()=>true};
const failed=(error:unknown)=>error instanceof EventDeliveryError&&error.code==="EVENT_DELIVERY_FAILED";

test("ordinary S3 deletes exact original/thumbnail through DeleteObject without version purge",async()=>{
 calls=[];await executeFileDeleteCleanup(event,db(),owned);assert.deepEqual(calls,intent.keys);
});
test("identity/reference/ownership/forged intent guards refuse effects",async()=>{
 for(const blocked of ["identity","reference","ownership","forged"]){calls=[];
  const input=blocked==="forged"?{...event,payload:{...intent,keys:["neighbor/secret.pdf"]}}:event;
  await assert.rejects(executeFileDeleteCleanup(input,db(blocked==="reference"),blocked==="ownership"?{isActive:()=>false,ensureOwned:async()=>false}:owned,removeFileDeleteKey,
   ()=>blocked==="identity"?{...identity,bucket:"other"}:identity),blocked==="ownership"?(error:unknown)=>error instanceof EventDeliveryError&&error.code==="EVENT_CLAIM_LOST":failed);
  assert.deepEqual(calls,[]);
 }
 assert.equal(fileDeleteIntentSchema.safeParse({...intent,storedName:"../outside"}).success,false);
 assert.equal(fileDeleteIntentSchema.safeParse({...intent,storedName:"..\\outside"}).success,false);
});
test("reference appearing between original and thumbnail blocks the second key",async()=>{
 calls=[];let linked=false;const guarded={file:{findFirst:async()=>linked?{id:"new-binding"}:null},changeLog:{findUnique:async()=>({actorId:"manager",entity:"file",entityId:"file",action:"delete",newValue:{intentHash:fileDeleteIntentHash(intent)}})}};
 await assert.rejects(executeFileDeleteCleanup(event,guarded as unknown as Pick<PrismaClient,"file"|"changeLog">,owned,async(_storage,key)=>{calls.push(key);linked=true;},()=>identity),failed);
 assert.deepEqual(calls,[intent.keys[0]]);
});
test("real upload creator in the same-key check/remove interval refuses a retired binding",async()=>{
 calls=[];let created=0;
 const tx={$queryRaw:async(query:{strings:readonly string[]})=>query.strings.join("").includes('FROM "DomainEvent"')?[event]:[{locked:1}],
  file:{findFirst:async()=>null,create:async()=>{created++;return{id:"new-binding"};}},
  changeLog:{findUnique:async({where}:{where:{id:string}})=>where.id===event.id?{actorId:"manager",entity:"file",entityId:"file",action:"delete",newValue:{intentHash:fileDeleteIntentHash(intent)}}:null,create:async()=>({})}};
 let failure:unknown;try{await executeFileDeleteCleanup(event,db(),owned,async(_storage,key)=>{
  if(key===intent.keys[0])await assert.rejects(persistOrdinaryUpload(tx as unknown as Prisma.TransactionClient,{id:"manager"},{clientMutationId:"00000000-0000-4000-8000-000000000138",fingerprint:"a".repeat(64),projectNumber:"137",data:{projectId:"project",fileName:"original.pdf",storedName:"original.pdf",mimeType:"application/pdf",size:11,uploadedById:"manager"}}),error=>(error as {code?:string}).code==="FILE_STORAGE_KEY_RETIRED");
  calls.push(key);
 },()=>identity);}catch(error){failure=error;}
 assert.equal(created,0,'retired key must refuse before actual File.create');if(failure)throw failure;assert.deepEqual(calls,intent.keys);
});
test("local exact deletion/ENOENT preserves neighbor and refuses traversal or junction",async()=>{
 const base=await mkdtemp(path.join(tmpdir(),"pero137-storage-")),outside=await mkdtemp(path.join(tmpdir(),"pero137-outside-"));
 const project=path.join(base,"project"),link=path.join(base,"link"),victim=path.join(outside,"keep.txt");
 assert.equal(await realpath(base),base);assert.equal(await realpath(outside),outside);
 try{
  await mkdir(project);await writeFile(path.join(project,"original.pdf"),"owned");await writeFile(path.join(project,"neighbor.pdf"),"neighbor");await writeFile(victim,"outside");
  await removeLocalFileDeleteKey(base,"project/original.pdf");await removeLocalFileDeleteKey(base,"project/original.pdf");assert.equal(await readFile(path.join(project,"neighbor.pdf"),"utf8"),"neighbor");
  await assert.rejects(removeLocalFileDeleteKey(base,"../outside.txt"),/FILE_DELETE_STORAGE_PATH_INVALID/);
  await symlink(outside,link,process.platform==="win32"?"junction":"dir");await assert.rejects(removeLocalFileDeleteKey(base,"link/keep.txt"),/FILE_DELETE_STORAGE_PATH_INVALID/);assert.equal(await readFile(victim,"utf8"),"outside");
 }finally{
  // Exact собственный allowlist: junction удаляется отдельно, рекурсивных удалений нет.
  try{await unlink(link);}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
  for(const file of [path.join(project,"original.pdf"),path.join(project,"neighbor.pdf"),victim])try{await unlink(file);}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
  await rmdir(project);await rmdir(base);await rmdir(outside);
 }
});
