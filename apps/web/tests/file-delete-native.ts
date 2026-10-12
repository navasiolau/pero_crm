// Thin native137: только exact собственные rows/bytes; import не подключается к БД.
// SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP при guard mismatch.
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {readFile,writeFile,mkdir,lstat,realpath,rmdir} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {PrismaClient,Prisma} from "@prisma/client";
import {deleteOrdinaryFileCore} from "../src/server/files/delete-core";
import {persistOrdinaryUpload} from "../src/server/files/upload-core";
import {executeFileDeleteCleanup,removeLocalFileDeleteKey} from "../src/server/files/delete-storage";
import {fileDeleteEventId,type FileDeleteStorageIdentity} from "../src/server/files/delete-contract";
import {createPostgresEventQueueStore} from "../src/server/plugins/event-queue-store";
import {createEventQueueProcessor} from "../src/server/plugins/event-queue-core";
import {getEventQueueSettings} from "../src/server/plugins/event-queue-contract";
import {nativeAcceptanceBinding,nativeDatabaseIdentity,type NativeDeclaration} from "./helpers/native-acceptance-target";
import {nativeSnapshot,assertNoForeignReferences,type OwnedRowKeys} from "./helpers/native-acceptance-snapshot";
import {nativeJournal} from "./helpers/native-acceptance-journal";
const sourcePins={
 "src/server/files/actions.ts":"1183305c068f821409b563f274ea9d1fa529d6be505381cf5e9536e472eb1e46",
 "src/server/files/delete-contract.ts":"b8affd075524f09fbc67537b681625501b172288019cbff2957dbc959f91dbca",
 "src/server/files/delete-core.ts":"79d1967c163f98cb2666b19241ba6b229feb9b5650e7a51c47f96b64f42c7015",
 "src/server/files/storage-binding-fence.ts":"daf151d95fda2a00b9650f1d23efe98cc9e18b3db4a299f2fd5a56b8883061fd",
 "src/server/files/upload-core.ts":"8bbd047cba64070181f989c03cd6056170492ac9def90f5cc318e7bd57a1dbde",
 "src/server/products/cover-core.ts":"2fcfdb7f67a332e059d4b3c17ff74af5a805ff78de4f0e9e05f7b05382adfed0",
 "src/server/projects/cover-core.ts":"3c0b628117f563c7cefd512d670c31f7398b56d6b1d15afec9d750cc564d9f0d",
 "src/server/files/delete-storage.ts":"78c48f67af1e0221e1a70927c20fc0112cdf2aae0810ef269c816ea4d2bae1a2",
 "src/server/files/delete-cleanup.ts":"4d0ba864fad3245c8df163ed38c9a2050c59a8d665538575e3683f09098ed8a3",
 "src/server/plugins/events.ts":"b319967b9d6eb8c24206989d12565f4c111c2232df8230732d2ff6f78efdc34c",
 "src/server/plugins/event-queue-store.ts":"0bd6031a844ee138254c55b8b002091c0bf7c0f1a05bdbb7eb8abb797be0ee2b",
 "src/components/file-list.tsx":"46fdc5c0fca367f38da3329d3a83fa8444176d7954d21481842127c6aba7b1fc",
 "src/components/task-dialog.tsx":"e7ae93ab2dc226c70ed6d36a723a36c845206eabc055b90f16b9482badbf6bff",
 "src/app/(app)/projects/[id]/files-tab.tsx":"216e371a94ac3742d9cc27854757f97429be0bf9c90ab624e499283b5755ad9f",
};
const baseline="b373ec8ec1ab293abc175e1e2e89b9f99f84e4a331dfd22be2b39e0d62fee6d4";
export function fileDeleteNativePlan(input:NativeDeclaration){
 assert.equal(input.target,"local","LOCAL_NATIVE_ONLY");assert.equal(input.scenarioId,"file-delete137");assert.match(input.revision,/^[a-f0-9]{40}$/);assert.match(input.runId,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
 const prefix="qa137-"+input.runId,user=prefix+"-user",client=prefix+"-client",project=prefix+"-project",numberInt=1500000000+parseInt(input.runId.slice(0,8),16)%500000000;
 const names=["audit","intent","pending","neighbor","rebound"],files=Object.fromEntries(names.map(name=>[name,prefix+"-"+name]));
 const mutations=Object.fromEntries(["audit","intent","pending"].map(name=>[name,randomUUID()])),events=Object.values(mutations).map(fileDeleteEventId);
 const keys=[...names.filter(name=>name!=="rebound").map(name=>project+"/"+name+".txt"),project+"/thumbs/pending.txt.jpg"];
 return{prefix,user,client,project,numberInt,files,mutations,events,keys,reattachMutation:randomUUID(),email:prefix+"@example.invalid",phone:prefix,actor:"user:"+user};
}
export async function runFileDeleteNative(input:NativeDeclaration){
 const plan=fileDeleteNativePlan(input);for(const key of ["NODE_OPTIONS","NODE_PATH","TSX_TSCONFIG_PATH","TSX_DISABLE_CACHE","ESBUILD_BINARY_PATH"])assert.ok(!process.env[key],"UNEXPECTED_NODE_LOADER");
 assert.equal(process.env.CRM_LOCAL_CONTAINER_ID,"bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5");assert.equal(getEventQueueSettings().enabled,false,"GLOBAL_WORKER_MUST_REMAIN_DISABLED");
 const binding=nativeAcceptanceBinding(input),web=fileURLToPath(new URL("../",import.meta.url));
 const sourceMatch=async()=>{for(const [file,pin] of Object.entries(sourcePins))assert.equal(createHash("sha256").update(await readFile(path.join(web,file))).digest("hex"),pin,"REVIEWED_SOURCE_CHANGED");};await sourceMatch();
 const folder=path.resolve(web,"../..",".playwright-mcp","revision-acceptance",input.runId,"storage"),identity:FileDeleteStorageIdentity={mode:"local",root:folder};
 const receiptIds=[...plan.events,"file-upload:"+plan.reattachMutation];
 const own:OwnedRowKeys={User:{column:"id",ids:[plan.user]},Client:{column:"id",ids:[plan.client]},Project:{column:"id",ids:[plan.project]},File:{column:"id",ids:Object.values(plan.files)},ChangeLog:{column:"id",ids:receiptIds},DomainEvent:{column:"id",ids:plan.events}};
 const url=new URL(binding.url);url.searchParams.set("connection_limit","1");const db=new PrismaClient({datasourceUrl:url.toString(),log:[],errorFormat:"minimal"}),peer=new PrismaClient({datasourceUrl:url.toString(),log:[],errorFormat:"minimal"}),publish=await nativeJournal(input);
 let phase="baseline",prepared=false,filesPrepared=false,original:Awaited<ReturnType<typeof nativeSnapshot>>|undefined,failure:unknown,cleanupFailure:unknown;const cases:string[]=[];
 const inFlight=new Set<Promise<unknown>>(),tracked=<T>(promise:Promise<T>)=>{inFlight.add(promise);void promise.finally(()=>inFlight.delete(promise)).catch(()=>{});return promise;};
 const actor={id:plan.user,roles:["MANAGER" as const]},settings=getEventQueueSettings(),queue=createPostgresEventQueueStore(db,settings,plan.events),peerQueue=createPostgresEventQueueStore(peer,settings,plan.events);
 const current=async(tx:PrismaClient|Prisma.TransactionClient)=>({users:await tx.user.findMany({where:{id:plan.user}}),clients:await tx.client.findMany({where:{id:plan.client}}),projects:await tx.project.findMany({where:{id:plan.project}}),files:await tx.file.findMany({where:{id:{in:Object.values(plan.files)}}}),receipts:await tx.changeLog.findMany({where:{id:{in:receiptIds}},orderBy:{id:"asc"}}),events:await tx.domainEvent.findMany({where:{id:{in:plan.events}},orderBy:{id:"asc"}})});
 const staticGuard=(rows:Awaited<ReturnType<typeof current>>)=>{
  assert.ok(rows.users.every(row=>row.id===plan.user&&row.email===plan.email));assert.ok(rows.clients.every(row=>row.id===plan.client&&row.phone===plan.phone));assert.ok(rows.projects.every(row=>row.id===plan.project&&row.clientId===plan.client&&row.managerId===plan.user&&row.numberInt===plan.numberInt));
  assert.ok(rows.files.every(row=>row.projectId===plan.project&&row.uploadedById===plan.user&&Object.values(plan.files).includes(row.id)));assert.ok(rows.receipts.every(row=>row.actorId===plan.user&&receiptIds.includes(row.id)));assert.ok(rows.events.every(row=>row.actor===plan.actor&&plan.events.includes(row.id)));
 };
 const fileData=(name:string)=>({id:plan.files[name],projectId:plan.project,fileName:name+".txt",storedName:name==="rebound"?"pending.txt":name+".txt",mimeType:"text/plain",size:11,hasThumb:name==="pending"||name==="rebound",uploadedById:plan.user});
 try{
  await nativeDatabaseIdentity(db,input);await nativeDatabaseIdentity(peer,input);const [{pid:firstPid}]=await db.$queryRaw<{pid:number}[]>`SELECT pg_backend_pid() AS pid`,[{pid:secondPid}]=await peer.$queryRaw<{pid:number}[]>`SELECT pg_backend_pid() AS pid`;assert.notEqual(firstPid,secondPid);
  original=await db.$transaction(async tx=>{await tx.$executeRaw`SET TRANSACTION READ ONLY`;return nativeSnapshot(tx);},{isolationLevel:"RepeatableRead",timeout:120000});assert.equal(original.digest,baseline,"POST_DDL_BASELINE_MISMATCH");
  const collision=await current(db);assert.ok(Object.values(collision).every(rows=>rows.length===0),"OWNED_ID_COLLISION");assert.equal(await db.project.count({where:{number:String(plan.numberInt)}}),0,"OWNED_NUMBER_COLLISION");
  await publish("pre",{input,identity:binding.identity,sourcePins,plan,folder,original,backendPids:[firstPid,secondPid],outboundProviders:0,globalWorker:false});prepared=true;
  await db.$transaction(async tx=>{await tx.user.create({data:{id:plan.user,email:plan.email,name:plan.prefix,passwordHash:"QA137_UNUSABLE",roles:["MANAGER"],active:true}});await tx.client.create({data:{id:plan.client,name:plan.prefix,phone:plan.phone}});await tx.project.create({data:{id:plan.project,number:String(plan.numberInt),numberInt:plan.numberInt,title:plan.prefix,clientId:plan.client,managerId:plan.user}});await tx.file.createMany({data:["audit","intent","pending","neighbor"].map(fileData)});});
  filesPrepared=true;await mkdir(path.join(folder,plan.project,"thumbs"),{recursive:true});assert.equal(await realpath(folder),folder);for(const key of plan.keys)await writeFile(path.join(folder,key),"qa137-owned");
  assert.deepEqual(await nativeSnapshot(db,own),original,"PREPARE_ORIGINALS_CHANGED");
  for(const fail of ["audit","intent"]){phase=fail+"-rollback";const before=await current(db);await assert.rejects(db.$transaction(tx=>{
   const proxy=new Proxy(tx,{get(target,key){if(key===(fail==="audit"?"changeLog":"domainEvent"))return new Proxy(Reflect.get(target,key),{get(delegate,method){if(method==="create")return async()=>{throw Error("QA137_INJECTED_FAILURE");};return Reflect.get(delegate,method);}});return Reflect.get(target,key);}});
   return deleteOrdinaryFileCore(proxy,actor,{fileId:plan.files[fail],clientMutationId:plan.mutations[fail]},identity);}),/QA137_INJECTED_FAILURE/);assert.deepEqual(await current(db),before);assert.equal(await readFile(path.join(folder,plan.project,fail+".txt"),"utf8"),"qa137-owned");cases.push(fail+"-native-rollback");}
  phase="concurrent-replay";
  const inputDelete={fileId:plan.files.pending,clientMutationId:plan.mutations.pending};
  const results=await Promise.all([db.$transaction(tx=>deleteOrdinaryFileCore(tx,actor,inputDelete,identity)),peer.$transaction(tx=>deleteOrdinaryFileCore(tx,actor,inputDelete,identity))]);assert.ok(results.every(row=>row.ok));assert.equal(results.filter(row=>row.ok&&row.repeated).length,1);assert.equal(await db.changeLog.count({where:{id:plan.events[2]}}),1);assert.equal(await db.domainEvent.count({where:{id:plan.events[2]}}),1);cases.push("two-session-concurrent-uuid-replay");
  phase="pending-storage";let unavailable=true;
  const refused=(error:unknown)=>(error as {code?:string}).code==="FILE_STORAGE_KEY_RETIRED";
  const tryRetired=(client:PrismaClient)=>assert.rejects(client.$transaction(tx=>persistOrdinaryUpload(tx,actor,{clientMutationId:plan.reattachMutation,fingerprint:"b".repeat(64),projectNumber:String(plan.numberInt),data:fileData("rebound")})),refused);
  let criticalCreatorProof=false;
  const processor=(client:PrismaClient,store:typeof queue)=>createEventQueueProcessor({store,settings,deliver:(event,ownership)=>tracked(executeFileDeleteCleanup(event,client,ownership,async(_storage,key)=>{
   assert.ok(plan.keys.includes(key));if(unavailable)throw Error("QA137_STORAGE_UNAVAILABLE");
   if(key===plan.project+"/pending.txt"&&!criticalCreatorProof){await tryRetired(client===db?peer:db);assert.equal(await db.file.count({where:{id:plan.files.rebound}}),0);criticalCreatorProof=true;}
   await removeLocalFileDeleteKey(folder,key);
  },()=>identity))});
  assert.equal(await processor(db,queue).dispatchOne(plan.events[2]),false);assert.equal((await db.domainEvent.findUniqueOrThrow({where:{id:plan.events[2]}})).processedAt,null);assert.equal(await readFile(path.join(folder,plan.project,"pending.txt"),"utf8"),"qa137-owned");cases.push("storage-fault-durable-pending");
  phase="new-binding";unavailable=false;await db.file.create({data:fileData("rebound")});assert.equal(await processor(db,queue).dispatchOne(plan.events[2],true),false);assert.equal(await readFile(path.join(folder,plan.project,"pending.txt"),"utf8"),"qa137-owned");await db.file.delete({where:{id:plan.files.rebound}});cases.push("new-live-binding-preserved");
  phase="restarted-processor";assert.equal(await processor(peer,peerQueue).dispatchOne(plan.events[2],true),true);assert.equal(await db.changeLog.count({where:{id:plan.events[2]}}),1);assert.equal(await readFile(path.join(folder,plan.project,"neighbor.txt"),"utf8"),"qa137-owned");assert.ok((await db.domainEvent.findUniqueOrThrow({where:{id:plan.events[2]}})).processedAt);cases.push("new-processor-completes-without-second-audit");
  assert.equal(criticalCreatorProof,true);await tryRetired(db);assert.equal(await db.file.count({where:{id:plan.files.rebound}}),0);cases.push("real-creator-same-key-window-and-completed-retirement-refused");
  for(const key of [plan.project+"/pending.txt",plan.project+"/thumbs/pending.txt.jpg"])await assert.rejects(lstat(path.join(folder,key)),error=>(error as NodeJS.ErrnoException).code==="ENOENT");
  await publish("verified",{input,cases,backendPids:[firstPid,secondPid],owned:await current(db),outboundProviders:0,globalWorker:false});
 }catch(error){failure=error;}
 finally{
  await Promise.allSettled([...inFlight]);
  if(prepared&&original)try{
   await db.domainEvent.updateMany({where:{id:{in:plan.events},actor:plan.actor},data:{claimToken:null,leaseUntil:null}});const observation=await current(db);staticGuard(observation);assert.deepEqual(await nativeSnapshot(db,own),original,"PRE_CLEANUP_ORIGINALS_CHANGED");await publish("cleanup-intent",{input,observation,originalDigest:original.digest});
   await db.$transaction(async tx=>{for(const [table,keys] of Object.entries(own))await tx.$queryRawUnsafe('SELECT "'+keys.column+'" FROM "'+table+'" WHERE "'+keys.column+'"=ANY($1::text[]) ORDER BY "'+keys.column+'" FOR UPDATE',keys.ids);
    assert.deepEqual(await current(tx),observation,"CLEANUP_CURRENT_ROWS_REQUIRED");await assertNoForeignReferences(tx,own);assert.deepEqual(await nativeSnapshot(tx,own),original,"CLEANUP_ORIGINALS_CHANGED");
    assert.equal((await tx.domainEvent.deleteMany({where:{id:{in:plan.events},actor:plan.actor}})).count,observation.events.length);assert.equal((await tx.changeLog.deleteMany({where:{id:{in:receiptIds},actorId:plan.user}})).count,observation.receipts.length);assert.equal((await tx.file.deleteMany({where:{id:{in:Object.values(plan.files)},projectId:plan.project}})).count,observation.files.length);assert.equal((await tx.project.deleteMany({where:{id:plan.project,clientId:plan.client}})).count,observation.projects.length);assert.equal((await tx.client.deleteMany({where:{id:plan.client,phone:plan.phone}})).count,observation.clients.length);assert.equal((await tx.user.deleteMany({where:{id:plan.user,email:plan.email}})).count,observation.users.length);assert.deepEqual(await nativeSnapshot(tx),original,"CLEANUP_TRANSACTION_PRESERVATION");
   },{isolationLevel:"RepeatableRead",timeout:120000});
   assert.ok(Object.values(await current(db)).every(rows=>rows.length===0),"OWNED_REMAINS");assert.deepEqual(await nativeSnapshot(db),original,"TERMINAL_ORIGINALS_CHANGED");
   if(filesPrepared){assert.equal(await realpath(folder),folder);for(const key of plan.keys)await removeLocalFileDeleteKey(folder,key);await rmdir(path.join(folder,plan.project,"thumbs"));await rmdir(path.join(folder,plan.project));await rmdir(folder);}
   await publish("cleanup-ack",{input,remainingOwned:0,ownedStorageRemaining:0,rowsAndCatalogMatch:true,originalDigest:original.digest});
  }catch(error){cleanupFailure=error;}
  const disconnected=await Promise.allSettled([db.$disconnect(),peer.$disconnect()]);if(disconnected.some(row=>row.status==="rejected"))cleanupFailure=Error("NATIVE_DISCONNECT_HOLD");
 }
 await sourceMatch();
 if(failure||cleanupFailure){const error=cleanupFailure??failure,code=error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:"QA137_HOLD_INSPECT",prismaCode=error instanceof Prisma.PrismaClientKnownRequestError?error.code:null;const result={status:"HOLD",runId:input.runId,phase,code,prismaCode,cases,cleanupComplete:prepared&&!cleanupFailure,repeatForbidden:true};await publish("hold",result);return result;}
 const result={status:"QA137_SCOPED_CLOSED",runId:input.runId,revision:input.revision,cases,remainingOwned:0,ownedStorageRemaining:0,rowsAndCatalogMatch:true,originalDigest:original!.digest,clientsClosed:true,globalWorker:false,outboundProviders:0};await publish("closed",result);return result;
}
const direct=path.resolve(process.argv[1]??"").toLowerCase()===fileURLToPath(import.meta.url).toLowerCase();
if(direct){const [mode,revision,runId]=process.argv.slice(2),input={target:"local" as const,revision,runId,scenarioId:"file-delete137"};if(mode==="inert"){fileDeleteNativePlan(input);console.log(JSON.stringify({status:"QA137_INERT",dbConnections:0,storageEffects:0}));}else if(mode==="run")void runFileDeleteNative(input).then(result=>{console.log(JSON.stringify(result));if(result.status==="HOLD")process.exitCode=1;}).catch(()=>{console.log(JSON.stringify({status:"HOLD",code:"QA137_PREPARE_GUARD",repeatForbidden:true}));process.exitCode=1;});else process.exitCode=1;}
