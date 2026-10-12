// SOURCE_PREPARE139. Только отдельный ROOT_GO разрешает localhost HTTP/large IO.
// SAFETY D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md: mismatch/UNKNOWN STOP, без replay.
import {createHash,randomBytes} from "node:crypto";
import {spawn,type ChildProcess} from "node:child_process";
import {createServer,request as httpRequest,type IncomingMessage} from "node:http";
import {readFile,lstat,realpath,open,mkdir,readdir,rmdir,statfs} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {Readable} from "node:stream";
import {finished} from "node:stream/promises";
import {fileURLToPath} from "node:url";
import type {UploadSpoolFile,MultipartBufferQueues} from "../src/server/files/multipart-upload";

const MiB=1024*1024,HWM=64*1024,web=fileURLToPath(new URL("../",import.meta.url)),repo=path.resolve(web,"../..");
const filename=fileURLToPath(import.meta.url),digest=(data:string|Buffer)=>createHash("sha256").update(data).digest("hex");
function check(value:unknown,code:string):asserts value {if(!value)throw Error("RSS139_"+code);}
type Memory={rss:number;external:number;arrayBuffers:number};
type Case={id:string;size:number;parallel?:number;image?:boolean;maxFileBytes?:number;invalid?:boolean;expectedStatus:number;level:"transport-http"|"control-injected-limit"};
const cases:Case[]=[
 {id:"doc25",size:25*MiB,expectedStatus:200,level:"transport-http"},
 {id:"doc100",size:100*MiB,expectedStatus:200,level:"transport-http"},
 {id:"doc1024",size:1024*MiB,expectedStatus:200,level:"transport-http"},
 {id:"parallel100",size:100*MiB,parallel:2,expectedStatus:200,level:"transport-http"},
 {id:"image25-plus1",size:25*MiB+1,image:true,expectedStatus:413,level:"transport-http"},
 {id:"control-limit-plus1",size:HWM+1,maxFileBytes:HWM,expectedStatus:413,level:"control-injected-limit"},
 {id:"malformed-end",size:8,invalid:true,expectedStatus:400,level:"transport-http"},
];

type MemoryObservation={id:string;size:number;parallel:number;statuses:number[];sourceHash:string;baseline:Memory;peak:Memory;delta:Memory;limit:number};
// Только scalar facts; сохранение в родительском процессе не изменяет measured worker или baseline.
export async function rss139CaptureMemory(id:string,sourceHash:string,base:unknown,peak:unknown,statuses:readonly number[],
 persist:(part:string,facts:MemoryObservation)=>Promise<{file:string;sha256:string}>){
 const scenario=cases.find(value=>value.id===id);check(scenario,"MEMORY_SCENARIO");
 check(/^[a-f0-9]{64}$/.test(sourceHash),"MEMORY_FACTS");
 const read=(value:unknown):Memory=>{
  check(value&&typeof value==="object","MEMORY_FACTS");
  const number=(field:keyof Memory)=>{const observed:unknown=Reflect.get(value,field);
   check(typeof observed==="number"&&Number.isSafeInteger(observed)&&observed>=0,"MEMORY_FACTS");return observed;};
  return {rss:number("rss"),external:number("external"),arrayBuffers:number("arrayBuffers")};
 };
 const baseline=read(base),sampled=read(peak),parallel=scenario.parallel??1;
 check(statuses.length===parallel&&statuses.every(status=>status===scenario.expectedStatus),"MEMORY_STATUS");
 const facts:MemoryObservation={id,size:scenario.size,parallel,statuses:[...statuses],sourceHash,baseline,peak:sampled,
  delta:{rss:sampled.rss-baseline.rss,external:sampled.external-baseline.external,arrayBuffers:sampled.arrayBuffers-baseline.arrayBuffers},
  limit:scenario.parallel?64*MiB:32*MiB};
 const receipt=await persist("case-"+id+".json",facts);return {facts,receipt};
}

const memory=():Memory=>{const m=process.memoryUsage();return {rss:m.rss,external:m.external,arrayBuffers:m.arrayBuffers};};
const memoryMax=(a:Memory,b:Memory):Memory=>({rss:Math.max(a.rss,b.rss),external:Math.max(a.external,b.external),arrayBuffers:Math.max(a.arrayBuffers,b.arrayBuffers)});
const INPUT_MAX=1024*1024;
// HWM допускает один overshoot входным chunk. Shared chunks считаем повторно: это верхняя оценка.
const queueBounds={pending:INPUT_MAX+3,parser:HWM+INPUT_MAX,part:HWM+INPUT_MAX,
 transformRead:HWM+INPUT_MAX,transformWrite:HWM+INPUT_MAX,fileWrite:HWM+INPUT_MAX,
 spoolReaders:2*HWM,networkRead:HWM+INPUT_MAX,storageRead:2*HWM};
type Queues=Record<keyof typeof queueBounds,number>;
// Не видимые через public queue lengths живые слоты. Все резервы постоянны на один upload.
const bufferReserves={nodeWebBodyAndActiveInput:3*INPUT_MAX,pendingConcat:INPUT_MAX+3,
 parserHeadersAndFields:4*64*1024+4*16*1024,nativeMetadataSidecar:4*18*1024,
 base64TextAndDecodedChunk:3*INPUT_MAX+32*1024,fileWriteInFlight:INPUT_MAX+HWM,
 originalReadHashAndS3BodyInFlight:4*HWM};
const sum=(value:Record<string,number>)=>Object.values(value).reduce((total,bytes)=>total+bytes,0);
export function rss139TransportBudget(observed:unknown,parallel:number,maxInputChunk:number){
 check(parallel===1||parallel===2,"TRANSPORT_PARALLEL");
 check(Number.isSafeInteger(maxInputChunk)&&maxInputChunk>=0&&maxInputChunk<=INPUT_MAX,"TRANSPORT_INPUT");
 check(observed&&typeof observed==="object"&&Object.keys(observed).sort().join(",")===Object.keys(queueBounds).sort().join(","),"TRANSPORT_QUEUES");
 const peak={} as Queues;
 for(const key of Object.keys(queueBounds)as(keyof Queues)[]){
  const bytes:unknown=Reflect.get(observed,key);
  check(typeof bytes==="number"&&Number.isSafeInteger(bytes)&&bytes>=0&&bytes<=parallel*queueBounds[key],"TRANSPORT_QUEUE_BOUND");peak[key]=bytes;
 }
 const reservedBytes=parallel*sum(bufferReserves),upperBound=sum(peak)+reservedBytes,
  theoreticalUpperBound=parallel*(sum(queueBounds)+sum(bufferReserves)),limit=parallel*32*MiB;
 check(upperBound<=theoreticalUpperBound&&theoreticalUpperBound<=limit,"TRANSPORT_BOUND");
 return {peak,maxInputChunk,reserves:bufferReserves,queueBounds,reservedBytes,upperBound,theoreticalUpperBound,limit,
  scope:"node-next-adapter-spool-original-stream-mock-sdk",sdkWire:"NOT_RUN"};
}
type DrainState={jobs:Promise<void>[];active:number;admissions:number;errors:string[]};
async function withinDeadline<T>(operation:Promise<T>,deadline:number,code:string){
 const remaining=deadline-performance.now();check(remaining>0,code);
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  const value=await Promise.race([operation,new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(Error("RSS139_"+code)),remaining);})]);
  check(performance.now()<=deadline,code);return value;
 }finally{if(timer)clearTimeout(timer);}
}
function deadlineAfter(timeoutMs:number){
 check(Number.isFinite(timeoutMs)&&timeoutMs>0&&timeoutMs<=60000,"CONTROL_DEADLINE");return performance.now()+timeoutMs;
}
// Capture выполняется только после dispose, без новых admissions в worker.
export async function rss139DrainHandlers<T>(read:()=>DrainState,capture:()=>T,timeoutMs=30000):Promise<T>{
 const deadline=deadlineAfter(timeoutMs);
 for(;;){
  const state=read();check(!state.errors.length,"DRAIN_CLEANUP_UNKNOWN");
  check(performance.now()<deadline,"DRAIN_TIMEOUT");
  if(!state.jobs.length&&state.active===0&&state.admissions===0)return capture();
  if(state.jobs.length){
   const settled=await withinDeadline(Promise.allSettled(state.jobs),deadline,"DRAIN_TIMEOUT");
   check(settled.every(result=>result.status==="fulfilled"),"DRAIN_HANDLER_UNKNOWN");
  }else await new Promise<void>(resolve=>setTimeout(resolve,Math.min(5,Math.max(1,deadline-performance.now()))));
 }
}
type ChildHandle=Pick<ChildProcess,"pid"|"exitCode"|"signalCode"|"kill">&Pick<import("node:events").EventEmitter,"on"|"once"|"off">;
type ChildExitReceipt={runId:string;ownerTokenHash:string;pid:number|null;state:"exited"|"spawn-failed"|"retained"|"identity-mismatch";
 exited:boolean;code:number|null;signal:NodeJS.Signals|null;spawnError:boolean;killRequested:boolean;killAccepted:boolean|null;killError:boolean};
// Capability привязана к одному spawn handle/PID с самого начала, hello не даёт право убивать чужой PID.
export function rss139OwnChild(child:ChildHandle,identity:{runId:string;token:string}){
 const pid=child.pid,runId=identity.runId,ownerTokenHash=digest(identity.token);
 let exited=false,code:number|null=null,signal:NodeJS.Signals|null=null,spawnError=false;
 let killRequested=false,killAccepted:boolean|null=null,killError=false,finished=false;
 let notify!:()=>void;const done=new Promise<void>(resolve=>{notify=resolve;});
 const matches=()=>child.pid===pid;
 const detach=()=>{child.off("exit",exit);child.off("error",error);};
 const finish=()=>{finished=true;detach();notify();};
 const exit=(exitCode:number|null,exitSignal:NodeJS.Signals|null)=>{
  if(!matches())return;exited=true;code=exitCode;signal=exitSignal;finish();
 };
 const error=()=>{spawnError=true;if(pid===undefined&&matches())finish();};
 child.once("exit",exit);child.on("error",error);
 if(matches()&&(child.exitCode!==null||child.signalCode!==null))exit(child.exitCode,child.signalCode);
 const receipt=():ChildExitReceipt=>({runId,ownerTokenHash,pid:pid??null,
  state:!matches()?"identity-mismatch":exited?"exited":spawnError&&pid===undefined?"spawn-failed":"retained",
  exited:matches()&&exited,code,signal,spawnError,killRequested,killAccepted,killError});
 const awaitExit=async(timeoutMs=10000)=>{
  const deadline=deadlineAfter(timeoutMs);
  if(!finished&&matches()){
   try{await withinDeadline(done,deadline,"CHILD_EXIT_TIMEOUT");}catch{ /* Не выдаём timeout за exit; факт retained ниже. */ }
  }
  return receipt();
 };
 return {awaitExit,terminate:async(timeoutMs=10000)=>{
  if(!matches()||finished)return receipt();
  if(pid!==undefined&&Number.isInteger(pid)&&pid>0){
   killRequested=true;
   try{killAccepted=child.kill("SIGTERM");}catch{killError=true;killAccepted=false;}
  }
  return awaitExit(timeoutMs);
 }};
}

type Pin={path:string;sha256:string};
type Approval={version:1;kind:"rss139-local-http";purpose:"WARMUP_ONLY"|"RSS_MATRIX";runId:string;sourceHash:string;entryHash:string;caseMatrixHash:string;nodeVersion:string;
 closure:Pin[];spoolRoot:string;evidenceRoot:string;singleLimit:33554432;parallelLimit:67108864;minFreeBytes:3221225472;focusedDoc100?:true;diagnosticTail?:true;verifyTail?:true;diagnosticControl?:true};
async function guardedDirectory(directory:string){
 const resolved=path.resolve(directory);check(await realpath(resolved)===resolved,"PATH_REDIRECT");
 for(let current=resolved;path.dirname(current)!==current;current=path.dirname(current))check(!(await lstat(current)).isSymbolicLink(),"PATH_REPARSE");
 return resolved;
}

type SourceHashReader=AsyncIterable<unknown>&{destroy:()=>unknown};
type SourceHashHandle={createReadStream:(options:{highWaterMark:number;autoClose:false})=>SourceHashReader;close:()=>Promise<void>};
// Только собственный reader/handle; close не ждёт события stream-close от ещё открытого fd.
export async function rss139HashOpenedFile(handle:SourceHashHandle){
 let reader:SourceHashReader|undefined,result="",hasPrimary=false,primary:unknown;
 try{
  reader=handle.createReadStream({highWaterMark:HWM,autoClose:false});const hash=createHash("sha256");
  for await(const chunk of reader){check(chunk instanceof Uint8Array,"SOURCE_HASH_CHUNK");hash.update(chunk);}
  result=hash.digest("hex");
 }catch(error){hasPrimary=true;primary=error;}
 let hasCleanupFailure=false,cleanupFailure:unknown;
 try{await rss139Cleanup([
  {label:"source-reader-stop",run:()=>{reader?.destroy();}},
  {label:"source-handle-close",run:()=>handle.close()},
 ]);}catch(error){hasCleanupFailure=true;cleanupFailure=error;}
 if(hasPrimary&&hasCleanupFailure)throw new AggregateError([primary,cleanupFailure],"RSS139_SOURCE_HASH_AND_CLOSE");
 if(hasPrimary)throw primary;if(hasCleanupFailure)throw cleanupFailure;return result;
}
export async function rss139SourceDigest(file:string){return rss139HashOpenedFile(await open(file,"r"));}

async function verify(approval:Approval,checkpoint?:(phase:string)=>void){
 check(approval.version===1&&approval.kind==="rss139-local-http"&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(approval.runId),"APPROVAL");
 rss139AssertPurpose(approval.purpose,"worker");
 check(approval.nodeVersion===process.version&&approval.singleLimit===32*MiB&&approval.parallelLimit===64*MiB&&approval.minFreeBytes===3*1024*MiB,"FROZEN_LIMITS");
 check(approval.focusedDoc100===undefined||approval.focusedDoc100===true,"DIAGNOSTIC_BINDING");
 check((approval.diagnosticTail===undefined||approval.diagnosticTail===true)&&!(approval.diagnosticTail&&approval.focusedDoc100),"DIAGNOSTIC_TAIL_BINDING");
 check((approval.verifyTail===undefined||approval.verifyTail===true)&&!(approval.verifyTail&&(approval.diagnosticTail||approval.focusedDoc100)),"VERIFY_TAIL_BINDING");
 check((approval.diagnosticControl===undefined||approval.diagnosticControl===true)&&!(approval.diagnosticControl&&(approval.verifyTail||approval.diagnosticTail||approval.focusedDoc100)),"DIAGNOSTIC_CONTROL_BINDING");
 check(approval.caseMatrixHash===digest(JSON.stringify(cases)),"CASE_MATRIX");
 check(approval.entryHash===await rss139SourceDigest(filename),"ENTRY_PIN");
 check(Array.isArray(approval.closure)&&approval.closure.length>=8,"FULL_CLOSURE_REQUIRED");
 check(approval.sourceHash===digest(JSON.stringify(approval.closure)),"CLOSURE_HASH");
 for(const pin of approval.closure){
  check(/^[a-f0-9]{64}$/.test(pin.sha256)&&typeof pin.path==="string","PIN");
  const file=path.resolve(repo,pin.path);check(file.startsWith(repo+path.sep)&&!(await lstat(file)).isSymbolicLink(),"PIN_PATH");
  const largest=pin.path==="node_modules/.pnpm/@next+swc-win32-x64-msvc@15.5.20/node_modules/@next/swc-win32-x64-msvc/next-swc.win32-x64-msvc.node";
  if(largest)checkpoint?.("memory-verify-largest-before");
  check(await rss139SourceDigest(file)===pin.sha256,"SOURCE_CHANGED");
  if(largest)checkpoint?.("memory-verify-largest-after");
 }
 for(const required of ["apps/web/tests/file-upload-transport-rss.ts","apps/web/src/server/files/multipart-upload.ts","apps/web/src/server/files/upload-storage.ts","apps/web/src/lib/s3.ts","pnpm-lock.yaml","apps/web/prisma/schema.prisma","apps/web/next.config.ts","apps/web/Dockerfile"]){
  check(approval.closure.some(pin=>pin.path===required),"CLOSURE_MEMBER");
 }
 check(path.resolve(approval.spoolRoot)===path.join(await guardedDirectory(tmpdir()),"pero-rss139-"+approval.runId),"OWN_SPOOL");
 const expectedEvidence=path.join(web,"test-results","upload-rss139-"+approval.runId);
 check(path.resolve(approval.evidenceRoot)===expectedEvidence,"OWN_EVIDENCE");
}
async function publish(directory:string,name:string,value:unknown){
 await guardedDirectory(directory);check(/^[a-z0-9-]+\.json$/.test(name),"PART_NAME");
 const bytes=Buffer.from(JSON.stringify(value,null,2)),file=path.join(directory,name),fd=await open(file,"wx",0o600);
 try{await fd.writeFile(bytes);await fd.sync();}finally{await fd.close();}
 check(digest(await readFile(file))===digest(bytes),"PART_READBACK");return {file,sha256:digest(bytes)};
}

export function rss139OverrideSend(prototype:object,replacement:(command:unknown)=>Promise<unknown>){
 const previous=Object.getOwnPropertyDescriptor(prototype,"send");
 Object.defineProperty(prototype,"send",{configurable:true,value:replacement});
 const installed=Object.getOwnPropertyDescriptor(prototype,"send")!;
 return ()=>{
  const current=Object.getOwnPropertyDescriptor(prototype,"send");
  check(current?.value===replacement&&current.configurable===installed.configurable&&current.enumerable===installed.enumerable&&current.writable===installed.writable,"SDK_OVERRIDE_CHANGED");
  if(previous)Object.defineProperty(prototype,"send",previous);
  else check(Reflect.deleteProperty(prototype,"send"),"SDK_OVERRIDE_DELETE");
 };
}
type CleanupFailure={label:string;code:string};
class Rss139CleanupError extends Error{
 constructor(readonly failures:CleanupFailure[]){super("RSS139_CLEANUP_UNKNOWN");}
}
function safeFailureCode(error:unknown,fallback:string){
 return error instanceof Error&&/^RSS139_[A-Z_]+$/.test(error.message)?error.message:fallback;
}
export async function rss139Cleanup(steps:readonly {label:string;run:()=>void|Promise<void>}[]){
 const failures:CleanupFailure[]=[];
 for(const step of steps){try{await step.run();}catch(error){failures.push({label:step.label,code:safeFailureCode(error,"RSS139_CLEANUP_STEP_UNKNOWN")});}}
 if(failures.length)throw new Rss139CleanupError(failures);
}


type PhaseFacts={requestComplete:boolean;requestEnded:boolean;requestDestroyed:boolean;requestAborted:boolean;responseFinished:boolean;responseDestroyed:boolean;bytes:number;readableLength?:number;status:number|null;errorName:string;errorCode:string};
type MemoryPhaseFacts={ordinal:number;rss:number;external:number;arrayBuffers:number;heapUsed:number;heapTotal:number};
const memoryPhases=new Set(["memory-worker-start","memory-verify-largest-before","memory-verify-largest-after","memory-source-verified","memory-sdk-imported","memory-transport-imported","memory-next-imported","memory-file-spooled","memory-file-published","memory-file-disposed","memory-fixed-baseline","memory-case-start","memory-case-snapshot"]);
export function rss139AssertPhaseIntegrity(failure:string|null){check(failure===null,"PHASE_INVALID");}
const workerPhases=new Set(["accepted","request-end","request-close","request-aborted","body-adapted","request-created","spool-start","spool-done","publish-start","publish-done","sdk-start","sdk-done","caught","response-start","response-finish","response-close","dispose-start","dispose-done","dispose-failed","control-response-finish","control-input-finish","control-drain-failed"]);
const workerErrorNames=new Set(["None","Error","TypeError","RangeError","SyntaxError","AbortError","UploadError","Unknown"]);
const workerErrorCodes=new Set(["NONE","RSS139_RUNTIME_FAILED","RSS139_CLEANUP_UNKNOWN","ERR_STREAM_PREMATURE_CLOSE","ECONNRESET","RSS139_CONTROL_DRAIN_BOUND","RSS139_CONTROL_RESPONSE_FINISH","RSS139_CONTROL_INPUT_FINISH","UPLOAD_MULTIPART_LIMIT","UPLOAD_MULTIPART_INVALID","UPLOAD_ABORTED","UPLOAD_SPOOL_CHANGED","UPLOAD_DUPLICATE_FIELD","UPLOAD_FILE_TOO_LARGE","UPLOAD_IMAGE_BUFFER_ONLY","UPLOAD_STORAGE_CHANGED","UPLOAD_FAILED"]);
export function rss139WorkerJournal(){
 const entries:{sequence:number;phase:string;facts:PhaseFacts|MemoryPhaseFacts}[]=[];
 return {record:(phase:string,facts:Record<string,unknown>)=>{
  check(workerPhases.has(phase)||memoryPhases.has(phase),"PHASE_KIND");check(entries.length<128,"PHASE_BOUND");
  if(memoryPhases.has(phase)){
   const keys=["ordinal","rss","external","arrayBuffers","heapUsed","heapTotal"];
   check(Object.keys(facts).sort().join(",")===keys.sort().join(","),"PHASE_MEMORY_KEYS");
   check(keys.every(key=>Number.isSafeInteger(facts[key])&&Number(facts[key])>=0),"PHASE_MEMORY_NUMBER");
   check(Number(facts.ordinal)<=10,"PHASE_MEMORY_ORDINAL");
   const event={sequence:entries.length,phase,facts:{...facts} as MemoryPhaseFacts};entries.push(event);return event;
  }
  const bools=["requestComplete","requestEnded","requestDestroyed","requestAborted","responseFinished","responseDestroyed"];
  const extra=Object.hasOwn(facts,"readableLength")?["readableLength"]:[];
  check(Object.keys(facts).sort().join(",")===[...bools,"bytes","status","errorName","errorCode",...extra].sort().join(","),"PHASE_KEYS");
  if(extra.length)check(Number.isSafeInteger(facts.readableLength)&&Number(facts.readableLength)>=0&&Number(facts.readableLength)<=INPUT_MAX+HWM,"PHASE_READABLE_LENGTH");
  for(const key of bools)check(typeof facts[key]==="boolean","PHASE_BOOLEAN");
  check(Number.isSafeInteger(facts.bytes)&&Number(facts.bytes)>=0&&Number(facts.bytes)<=256*1024,"PHASE_BYTES");
  check(facts.status===null||Number.isInteger(facts.status)&&Number(facts.status)>=100&&Number(facts.status)<=599,"PHASE_STATUS");
  check(typeof facts.errorName==="string"&&workerErrorNames.has(facts.errorName),"PHASE_ERROR_NAME");
  check(typeof facts.errorCode==="string"&&workerErrorCodes.has(facts.errorCode),"PHASE_ERROR_CODE");
  const event={sequence:entries.length,phase,facts:{...facts} as PhaseFacts};entries.push(event);return event;
 },values:()=>entries.map(entry=>({...entry,facts:{...entry.facts}}))};
}
export function rss139AssertPurpose(purpose:unknown,mode:string){
 check(purpose==="WARMUP_ONLY"||purpose==="RSS_MATRIX","PURPOSE");
 check(mode==="worker"||mode==="warmup"&&purpose==="WARMUP_ONLY"||mode==="run"&&purpose==="RSS_MATRIX","PURPOSE_MODE");
}
function workerError(value:unknown){
 const errorName=value instanceof Error&&workerErrorNames.has(value.name)?value.name:"Unknown";
 const rawCode=value&&typeof value==="object"&&"code" in value?value.code:undefined;
 const knownMessage=value instanceof Error&&workerErrorCodes.has(value.message)?value.message:undefined;
 return {errorName,errorCode:typeof rawCode==="string"&&workerErrorCodes.has(rawCode)?rawCode:knownMessage??"RSS139_RUNTIME_FAILED"};
}

type Stats={requests:number;active:number;maxActive:number;spooledBytes:number;sdkBytes:number;sdkPuts:number;maxInputChunk:number;errors:string[]};
async function worker(approval:Approval,token:string){
 check(process.send&&process.ppid===Number(process.env.RSS139_PARENT_PID)&&token===process.env.RSS139_TOKEN,"WORKER_IDENTITY");
 const phaseJournal=rss139WorkerJournal();
 const checkpoint=(phase:string,ordinal=0,sampled?:Memory)=>{const value=process.memoryUsage();
  const record=phaseJournal.record(phase,{ordinal,rss:sampled?.rss??value.rss,external:sampled?.external??value.external,arrayBuffers:sampled?.arrayBuffers??value.arrayBuffers,heapUsed:value.heapUsed,heapTotal:value.heapTotal});
  process.send?.({kind:"receiver-phase",runId:approval.runId,sourceHash:approval.sourceHash,pid:process.pid,record});
 };
 checkpoint("memory-worker-start");await verify(approval,phase=>checkpoint(phase));checkpoint("memory-source-verified");await guardedDirectory(approval.spoolRoot);
 // Dummy SDK — доказательство Node transport, не MinIO или business storage.
 Object.assign(process.env,{CRM_FILE_STORAGE:"s3",S3_ENDPOINT:"http://no-network.invalid",S3_BUCKET:"qa-rss-139",S3_REGION:"local",S3_ACCESS_KEY:"DUMMY",S3_SECRET_KEY:"DUMMY"});
 const sdk=await import("@aws-sdk/client-s3");checkpoint("memory-sdk-imported");
 const {spoolMultipartUpload}=await import("../src/server/files/multipart-upload");
 const {publishUploadOriginal}=await import("../src/server/files/upload-storage");
 const {UploadError}=await import("../src/server/files/upload-result");
 checkpoint("memory-transport-imported");const {NodeNextRequest}=await import("next/dist/server/base-http/node");
 const {NextRequestAdapter,signalFromNodeResponse}=await import("next/dist/server/web/spec-extension/adapters/next-request");checkpoint("memory-next-imported");
 const stats:Stats={requests:0,active:0,maxActive:0,spooledBytes:0,sdkBytes:0,sdkPuts:0,maxInputChunk:0,errors:[]};
 const admissions=new Map<string,Case>(),results=new Map<string,unknown>(),inflight=new Set<Promise<void>>();
 const diagnostic=approval.purpose==="WARMUP_ONLY";
 const traceLifecycle=diagnostic||approval.diagnosticTail===true||approval.verifyTail===true||approval.diagnosticControl===true;
 let draining=false;
 async function drain<T>(capture:()=>T){
  check(!draining,"DRAIN_ALREADY_ACTIVE");draining=true;
  try{return await rss139DrainHandlers(()=>({jobs:[...inflight],active:stats.active,admissions:admissions.size,errors:stats.errors}),capture);}
  finally{draining=false;}
 }
 let peak=memory(),baseline:Memory|null=null,sampler:ReturnType<typeof setInterval>|undefined;
 const queueReaders=new Map<string,{incoming:IncomingMessage;read?:()=>MultipartBufferQueues}>(),storageReaders=new Set<Readable>();
 let queuePeak:Queues={pending:0,parser:0,part:0,transformRead:0,transformWrite:0,fileWrite:0,spoolReaders:0,networkRead:0,storageRead:0};
 let disposedQueues={...queuePeak};
 let queueFailure:string|null=null;
 const liveQueues=()=>{const total={...queuePeak};for(const key of Object.keys(total)as(keyof typeof total)[])total[key]=0;
  for(const reader of queueReaders.values()){total.networkRead+=reader.incoming.readableLength;const queues=reader.read?.();if(queues)for(const key of Object.keys(queues)as(keyof MultipartBufferQueues)[])total[key]+=queues[key];}
  for(const reader of storageReaders)total.storageRead+=reader.readableLength;return total;};
 const sampleQueues=()=>{try{
  const live=liveQueues();rss139TransportBudget(live,Math.max(1,queueReaders.size),stats.maxInputChunk);
  for(const key of Object.keys(queuePeak)as(keyof Queues)[])queuePeak[key]=Math.max(queuePeak[key],live[key]);
 }catch(error){queueFailure=safeFailureCode(error,"RSS139_TRANSPORT_UNKNOWN");}};
 const restoreSdk=rss139OverrideSend(sdk.S3Client.prototype,async(command:unknown)=>{
  check(command instanceof sdk.PutObjectCommand,"SDK_OTHER_COMMAND");const input=command.input;
  check(input.Bucket==="qa-rss-139"&&input.Key?.startsWith("rss-"+approval.runId+"/"),"SDK_NAMESPACE");
  check(input.Body instanceof Readable,"SDK_BODY_STREAM");
  const hash=createHash("sha256");let size=0;
  storageReaders.add(input.Body);try{for await(const chunk of input.Body){check(chunk instanceof Uint8Array,"SDK_BYTE_CHUNK");size+=chunk.byteLength;hash.update(chunk);sampleQueues();}}finally{storageReaders.delete(input.Body);}
  const sha=hash.digest("hex");check(size===input.ContentLength&&Buffer.from(sha,"hex").toString("base64")===input.ChecksumSHA256,"SDK_FACTS");
  stats.sdkBytes+=size;stats.sdkPuts++;return {$metadata:{httpStatusCode:200,attempts:1}};
 });
 async function accept(incoming:IncomingMessage,response:import("node:http").ServerResponse){
  let upload:{file:UploadSpoolFile;dispose:()=>Promise<void>}|undefined;
  let adaptedRequest:Request|undefined;
  const id=incoming.url?.slice(1),scenario=id?admissions.get(id):undefined;
  if(!id||!scenario||incoming.method!=="POST"||incoming.headers["x-rss139-token"]!==token){response.writeHead(403).end();return;}
  admissions.delete(id);const ordinal=++stats.requests;stats.active++;stats.maxActive=Math.max(stats.maxActive,stats.active);
  queueReaders.set(id,{incoming});
  const start=performance.now();let receivedBytes=0;
  const phase=(name:string,failure?:unknown,status=response.statusCode)=>{
   if(!traceLifecycle)return;
   const error=(name==="caught"||name==="dispose-failed"||name==="control-drain-failed")?workerError(failure):{errorName:"None",errorCode:"NONE"};
   const record=phaseJournal.record(name,{requestComplete:incoming.complete,requestEnded:incoming.readableEnded,requestDestroyed:incoming.destroyed,requestAborted:incoming.aborted,responseFinished:response.writableFinished,responseDestroyed:response.destroyed,bytes:receivedBytes,readableLength:incoming.readableLength,status,...error});
   process.send?.({kind:"receiver-phase",runId:approval.runId,sourceHash:approval.sourceHash,pid:process.pid,record});
  };
  phase("accepted");
  incoming.once("end",()=>phase("request-end"));incoming.once("close",()=>phase("request-close"));incoming.once("aborted",()=>phase("request-aborted"));
  response.once("finish",()=>phase("response-finish"));response.once("close",()=>phase("response-close"));
  try{
   // Метрика не переводит body в flowing mode до чтения установленным Node adapter.
   incoming.pause();incoming.on("data",(chunk:Buffer)=>{receivedBytes+=chunk.length;stats.maxInputChunk=Math.max(stats.maxInputChunk,chunk.length);sampleQueues();});
   phase("body-adapted");
   const request=NextRequestAdapter.fromNodeNextRequest(new NodeNextRequest(incoming),signalFromNodeResponse(response));
   adaptedRequest=request;
   phase("request-created");request.formData=async()=>{throw Error("RSS139_ORIGINAL_FORMDATA_FORBIDDEN");};
   phase("spool-start");upload=await spoolMultipartUpload(request,{tempRoot:approval.spoolRoot,...(scenario.maxFileBytes===undefined?{}:{maxFileBytes:scenario.maxFileBytes}),
    observeQueues:(read:()=>MultipartBufferQueues)=>{queueReaders.get(id)!.read=read;sampleQueues();}});
   phase("spool-done");checkpoint("memory-file-spooled",ordinal);stats.spooledBytes+=upload.file.size;
   phase("publish-start");await publishUploadOriginal(upload.file,{projectId:"rss-"+approval.runId,storedName:id+".dat",useS3:true});
   phase("publish-done");checkpoint("memory-file-published",ordinal);
   const result={status:200,size:upload.file.size,sha256:upload.file.contentHash,name:upload.file.name,type:upload.file.type,started:start,ended:performance.now()};
   results.set(id,result);phase("response-start");response.writeHead(200,{"content-type":"application/json"}).end(JSON.stringify(result));
  }catch(error){
   const status=error instanceof UploadError?error.status:500;phase("caught",error,status);const code=error instanceof UploadError?error.code:"RSS139_RUNTIME_FAILED";
   results.set(id,{status,code,started:start,ended:performance.now()});
   response.writeHead(status,{"content-type":"application/json"}).end(JSON.stringify({status,code}));
  }finally{
   phase("dispose-start");try{await upload?.dispose();phase("dispose-done");}catch(failure){phase("dispose-failed",failure,500);stats.errors.push("SPOOL_CLEANUP_UNKNOWN");}
   // Только known own 64KiB control: suffix может остаться в IncomingMessage после раннего413.
   // Сначала доставляем JSON, затем реально дочитываем ограниченный own wire, не обнуляем учёт.
   if(scenario.id==="control-limit-plus1"&&scenario.size===HWM+1&&scenario.maxFileBytes===HWM&&response.statusCode===413){
    const checkWire=()=>{if(receivedBytes>scenario.size+128*1024)incoming.destroy(Error("RSS139_CONTROL_DRAIN_BOUND"));};
    incoming.on("data",checkWire);
    try{
     await withinDeadline(finished(response,{cleanup:true}),deadlineAfter(10000),"CONTROL_RESPONSE_FINISH");
     phase("control-response-finish");
     check(receivedBytes<=scenario.size+128*1024,"CONTROL_DRAIN_BOUND");
     const body=adaptedRequest?.body;check(body,"CONTROL_REQUEST_BODY");
     // Undici уже владеет Node asyncIterator; дочитываем тот же Web stream после releaseLock.
     const reader=body.getReader(),deadline=deadlineAfter(10000);let drained=0;
     try{for(;;){
      const next=await withinDeadline(reader.read(),deadline,"CONTROL_INPUT_FINISH");
      if(next.done)break;
      check(next.value instanceof Uint8Array&&next.value.byteLength<=INPUT_MAX,"CONTROL_DRAIN_BOUND");
      drained+=next.value.byteLength;check(drained<=scenario.size+128*1024&&receivedBytes<=scenario.size+128*1024,"CONTROL_DRAIN_BOUND");
     }}finally{reader.releaseLock();}
     phase("control-input-finish");
     check(incoming.readableEnded&&incoming.readableLength===0&&receivedBytes<=scenario.size+128*1024,"CONTROL_DRAIN_BOUND");
    }catch(failure){phase("control-drain-failed",failure);throw failure;}
    finally{incoming.off("data",checkWire);}
   }
   disposedQueues=liveQueues();sampleQueues();queueReaders.delete(id);
   stats.active--;peak=memoryMax(peak,memory());checkpoint("memory-file-disposed",ordinal);
  }
 }
 const server=createServer((request,response)=>{const job=accept(request,response);inflight.add(job);void job.finally(()=>inflight.delete(job)).catch(()=>{stats.errors.push("HANDLER_UNKNOWN");});});
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
 const address=server.address();check(address&&typeof address==="object","LISTEN");
 process.send!({kind:"ready",runId:approval.runId,sourceHash:approval.sourceHash,pid:process.pid,port:address.port});
 process.on("message",message=>{void (async()=>{
  check(message&&typeof message==="object","IPC");const command=message as {kind:string;token:string;id?:string;case?:Case};
  check(command.token===token,"IPC_TOKEN");
  if(command.kind==="admit"){check(!draining&&command.id&&command.case&&!admissions.has(command.id),"ADMISSION");if(diagnostic)check(/^warm-[01]$/.test(command.id)&&command.case.id==="warm"&&command.case.size===HWM&&command.case.expectedStatus===200&&!command.case.parallel&&!command.case.image&&!command.case.invalid&&command.case.maxFileBytes===undefined,"WARMUP_CASE");admissions.set(command.id,command.case);process.send!({kind:"admitted",id:command.id});}
  else if(command.kind==="diagnostics"){process.send!({kind:"diagnostics",runId:approval.runId,sourceHash:approval.sourceHash,pid:process.pid,stats,phases:phaseJournal.values()});}
  else if(command.kind==="warmup-summary"){check(diagnostic,"WARMUP_PURPOSE");await drain(()=>{process.send!({kind:"warmup-summary",stats,phases:phaseJournal.values()});});}
  else if(command.kind==="baseline"){check(baseline===null,"BASELINE_ALREADY_CAPTURED");await drain(()=>{
   baseline=memory();peak=baseline;checkpoint("memory-fixed-baseline",0,baseline);sampler=setInterval(()=>{peak=memoryMax(peak,memory());sampleQueues();},10);process.send!({kind:"baseline",baseline});
  });}
  else if(command.kind==="begin-case"){check(baseline,"BASELINE_REQUIRED");await drain(()=>{peak=memory();queuePeak={...liveQueues()};disposedQueues={...queuePeak};checkpoint("memory-case-start",stats.requests);process.send!({kind:"case-started"});});}
  else if(command.kind==="snapshot"){await drain(()=>{check(queueFailure===null,"TRANSPORT_SAMPLER");checkpoint("memory-case-snapshot",stats.requests);process.send!({kind:"snapshot",baseline,peak,stats,results:[...results],queuePeak,disposedQueues,liveQueues:liveQueues()});});}
  else if(command.kind==="post-measure-gc"){
   check(approval.focusedDoc100===true,"DIAGNOSTIC_BINDING");await drain(async()=>{
    const {Session}=await import("node:inspector"),session=new Session();session.connect();
    try{await new Promise<void>((resolve,reject)=>session.post("HeapProfiler.collectGarbage",error=>error?reject(error):resolve()));}finally{session.disconnect();}
    process.send!({kind:"post-measure-gc",memory:memory(),liveQueues:liveQueues(),diagnosticOnly:true});
   });
  }
  else if(command.kind==="shutdown"){await drain(async()=>{
   if(sampler)clearInterval(sampler);
   // Только own receiver sockets, после завершения всех admission handlers и доставленных JSON responses.
   await rss139Cleanup([
    {label:"server-close",run:async()=>{server.closeAllConnections();await withinDeadline(new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())),deadlineAfter(10000),"SERVER_CLOSE_TIMEOUT");}},
    {label:"sdk-restore",run:restoreSdk},
    {label:"spool-empty",run:async()=>{check((await readdir(approval.spoolRoot)).length===0,"OWN_SPOOL_REMAINS");}},
    {label:"source",run:()=>verify(approval)},
   ]);
   process.send!({kind:"closed",ownCount:0,pid:process.pid});process.disconnect();
  });}else throw Error("RSS139_UNKNOWN_IPC");
 })().catch(error=>{process.send?.({kind:"STOP",code:safeFailureCode(error,"RSS139_IPC_UNKNOWN"),failures:error instanceof Rss139CleanupError?error.failures:[],pid:process.pid});});});
}
export function rss139ChildMessage(child:ChildHandle,kind:string,id?:string,timeoutMs=60000,signal?:AbortSignal){
 deadlineAfter(timeoutMs);
 return new Promise<Record<string,unknown>>((resolve,reject)=>{
  if(child.exitCode!==null||child.signalCode!==null){reject(Error("RSS139_EARLY_CHILD_EXIT"));return;}
  const timeout=setTimeout(()=>{cleanup();reject(Error("RSS139_IPC_TIMEOUT"));},timeoutMs);
  const listener=(value:unknown)=>{if(value&&typeof value==="object"){const message=value as Record<string,unknown>;if(message.kind==="STOP"){cleanup();
   const failures=Array.isArray(message.failures)?message.failures.filter((failure):failure is CleanupFailure=>Boolean(failure&&typeof failure==="object"&&"label" in failure&&"code" in failure&&typeof failure.label==="string"&&/^[a-z-]{1,40}$/.test(failure.label)&&typeof failure.code==="string"&&/^RSS139_[A-Z_]+$/.test(failure.code))):[];
   reject(Object.assign(Error("RSS139_WORKER_STOP"),{failures}));
  }else if(message.kind===kind&&(id===undefined||message.id===id)){cleanup();resolve(message);}}};
  const exit=()=>{cleanup();reject(Error("RSS139_EARLY_CHILD_EXIT"));},error=()=>{cleanup();reject(Error("RSS139_CHILD_ERROR"));};
  function cleanup(){clearTimeout(timeout);child.off("message",listener);child.off("exit",exit);child.off("error",error);signal?.removeEventListener("abort",abort);}
  const abort=()=>{cleanup();reject(signal?httpAbort(signal):Error("RSS139_HTTP_CANCELLED"));};
  child.on("message",listener);child.once("exit",exit);child.once("error",error);signal?.addEventListener("abort",abort,{once:true});if(signal?.aborted)abort();
 });
}

type HttpEvents=Pick<import("node:events").EventEmitter,"on"|"off">;
function httpAbort(signal:AbortSignal){return signal.reason instanceof Error&&/^RSS139_[A-Z_]+$/.test(signal.reason.message)?signal.reason:Error("RSS139_HTTP_CANCELLED");}
export async function rss139HttpOperation<T>(start:(signal:AbortSignal)=>Promise<T>,timeoutMs=600000,external?:AbortSignal):Promise<T>{
 check(Number.isFinite(timeoutMs)&&timeoutMs>0&&timeoutMs<=600000,"HTTP_BUDGET");
 const controller=new AbortController(),deadline=performance.now()+timeoutMs;
 const relay=()=>controller.abort(external?httpAbort(external):Error("RSS139_HTTP_CANCELLED"));
 let abort!:()=>void;const cancelled=new Promise<never>((_resolve,reject)=>{abort=()=>reject(httpAbort(controller.signal));controller.signal.addEventListener("abort",abort,{once:true});});
 void cancelled.catch(()=>{});
 const timer=setTimeout(()=>controller.abort(Error("RSS139_HTTP_DEADLINE")),timeoutMs);
 external?.addEventListener("abort",relay,{once:true});
 try{
  if(external?.aborted)relay();
  if(controller.signal.aborted)throw httpAbort(controller.signal);
  const value=await Promise.race([start(controller.signal),cancelled]);check(performance.now()<=deadline,"HTTP_DEADLINE");return value;
 }finally{clearTimeout(timer);external?.removeEventListener("abort",relay);controller.signal.removeEventListener("abort",abort);}
}
export function rss139WaitDrain(target:HttpEvents,signal:AbortSignal){
 return new Promise<void>((resolve,reject)=>{
  const cleanup=()=>{target.off("drain",drain);target.off("error",error);target.off("close",close);signal.removeEventListener("abort",abort);};
  const drain=()=>{cleanup();resolve();},error=()=>{cleanup();reject(Error("RSS139_WRITE_FAILED"));};
  const close=()=>{cleanup();reject(Error("RSS139_WRITE_CLOSED"));},abort=()=>{cleanup();reject(httpAbort(signal));};
  target.on("drain",drain);target.on("error",error);target.on("close",close);signal.addEventListener("abort",abort,{once:true});
  if(signal.aborted)abort();
 });
}
export function rss139ReadResponse(response:HttpEvents,signal:AbortSignal){
 return new Promise<Record<string,unknown>>((resolve,reject)=>{
  const chunks:Buffer[]=[];let size=0;
  const cleanup=()=>{response.off("data",data);response.off("end",end);response.off("error",error);response.off("close",close);signal.removeEventListener("abort",abort);};
  const fail=(failure:Error)=>{cleanup();reject(failure);};
  const data=(chunk:unknown)=>{
   try{check(chunk instanceof Uint8Array,"RESPONSE_CHUNK");size+=chunk.byteLength;check(size<=16*1024,"RESPONSE_BOUND");chunks.push(Buffer.from(chunk));}
   catch(failure){fail(Error(safeFailureCode(failure,"RSS139_RESPONSE_UNKNOWN")));}
  };
  const end=()=>{cleanup();try{resolve(JSON.parse(Buffer.concat(chunks).toString()) as Record<string,unknown>);}catch{reject(Error("RSS139_RESPONSE_JSON"));}};
  const error=()=>fail(Error("RSS139_RESPONSE_FAILED")),close=()=>fail(Error("RSS139_RESPONSE_CLOSED")),abort=()=>fail(httpAbort(signal));
  response.on("data",data);response.on("end",end);response.on("error",error);response.on("close",close);signal.addEventListener("abort",abort,{once:true});
  if(signal.aborted)abort();
 });
}


export async function rss139JoinSenders(tasks:Iterable<Promise<unknown>>,timeoutMs=10000){
 check(timeoutMs>0&&timeoutMs<=10000,"SENDER_JOIN_BUDGET");
 return withinDeadline(Promise.allSettled([...tasks]),deadlineAfter(timeoutMs),"SENDER_JOIN_TIMEOUT");
}

export function rss139RequestClosed(incoming:object|undefined,reject:(error:Error)=>void){
 if(incoming===undefined)reject(Error("RSS139_HTTP_CLOSED"));
}
type Rss139SendTrace=(phase:"response"|"response-end"|"response-close"|"request-close"|"body-complete",facts:{responseReceived:boolean;promiseComplete:boolean;responseComplete:boolean;responseEnded:boolean;requestFinished:boolean;status:number|null})=>void;
async function send(port:number,token:string,id:string,scenario:Case,timeoutMs:number,external:AbortSignal,observe?:Rss139SendTrace){
 let lifecycle:Promise<{status:number;body:Record<string,unknown>}>|undefined;
 try{
  return await rss139HttpOperation(signal=>{
   lifecycle=(async()=>{
    const boundary="rss139-"+id,hash=createHash("sha256"),block=Buffer.alloc(HWM,97);
    const prefix=Buffer.from("--"+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="benchmark.dat"\r\nContent-Type: '+(scenario.image?"image/png":"application/octet-stream")+"\r\n\r\n");
    const suffix=Buffer.from(scenario.invalid?"\r\nbroken":"\r\n--"+boundary+"--\r\n");
    let stopped=false,finishedResponse=false,requestClosed=false,incoming:IncomingMessage|undefined;
    const request=httpRequest({hostname:"127.0.0.1",port,path:"/"+id,method:"POST",headers:{"content-type":"multipart/form-data; boundary="+boundary,"x-rss139-token":token}});
    let rejectReply!:(error:Error)=>void;
    const trace=(phase:Parameters<Rss139SendTrace>[0])=>{
     if(!observe)return;
     try{observe(phase,{responseReceived:incoming!==undefined,promiseComplete:finishedResponse,responseComplete:Boolean(incoming?.complete),responseEnded:Boolean(incoming?.readableEnded),requestFinished:request.writableFinished,status:incoming?.statusCode??null});}
     catch{rejectReply(Error("RSS139_TRACE_FAILED"));}
    };
    const reply=new Promise<{status:number;body:Record<string,unknown>}>((resolve,reject)=>{
     rejectReply=reject;request.on("response",response=>{
      incoming=response;trace("response");
      const tracedEnd=()=>trace("response-end");response.once("end",tracedEnd);
      response.once("close",()=>{trace("response-close");response.off("end",tracedEnd);});
      const responseError=()=>rejectReply(Error("RSS139_RESPONSE_FAILED"));
      response.on("error",responseError);response.once("close",()=>response.off("error",responseError));
      void rss139ReadResponse(response,signal).then(body=>{finishedResponse=true;trace("body-complete");resolve({status:response.statusCode??0,body});},reject);
     });
    });
    const requestError=()=>rejectReply(Error("RSS139_HTTP_FAILED"));
    const requestClose=()=>{requestClosed=true;trace("request-close");rss139RequestClosed(incoming,rejectReply);request.off("error",requestError);};
    request.on("error",requestError);request.on("close",requestClose);
    const abort=()=>{stopped=true;incoming?.destroy();request.destroy(httpAbort(signal));};
    signal.addEventListener("abort",abort,{once:true});
    const write=async(chunk:Buffer)=>{if(signal.aborted)throw httpAbort(signal);if(!request.write(chunk))await rss139WaitDrain(request,signal);};
    const writing=(async()=>{
     await write(prefix);
     for(let remaining=scenario.size;remaining>0&&!stopped;){const chunk=block.subarray(0,Math.min(remaining,block.length));hash.update(chunk);await write(chunk);remaining-=chunk.length;}
     if(!stopped){await write(suffix);request.end();}
    })();
    void writing.catch(()=>{request.destroy(Error("RSS139_SENDER_FAILED"));});
    try{
     const response=await reply;stopped=true;request.destroy();
     const written=await Promise.allSettled([writing]);
     if(response.status===200)check(written[0].status==="fulfilled","SENDER_FAILED");
     check(response.status===scenario.expectedStatus,"HTTP_STATUS");
     if(response.status===200)check(response.body.size===scenario.size&&response.body.sha256===hash.digest("hex"),"END_TO_END_BYTES");
     return response;
    }finally{
     stopped=true;request.destroy();incoming?.destroy();
     signal.removeEventListener("abort",abort);
     await Promise.allSettled([writing]);
     // Error listener держится до фактического own request close; ни одного чужого socket.
     if(requestClosed)request.off("close",requestClose);
     else request.once("close",()=>request.off("close",requestClose));
    }
   })();
   return lifecycle;
  },timeoutMs,external);
 }finally{if(lifecycle)await rss139JoinSenders([lifecycle]);}
}
export {send as rss139Send};
async function run(approval:Approval){
 await verify(approval);const free=await statfs(tmpdir());check(Number(free.bavail)*Number(free.bsize)>=approval.minFreeBytes,"DISK_BUDGET");
 // PRE публикуется до child/temp effects. Directory принадлежит exact UUID этого запуска.
 await mkdir(approval.evidenceRoot,{mode:0o700});await guardedDirectory(approval.evidenceRoot);
 const pre=await publish(approval.evidenceRoot,"pre.json",{approval,level:"transport-node-http-mock-sdk",staging:"NOT_RUN",minio:"NOT_RUN",database:"NOT_RUN"});
 await mkdir(approval.spoolRoot,{mode:0o700});await guardedDirectory(approval.spoolRoot);
 const token=randomBytes(24).toString("hex"),environment:NodeJS.ProcessEnv={NODE_ENV:"test",NEXT_TELEMETRY_DISABLED:"1"};
 const allowed=new Set(["PATH","PATHEXT","SYSTEMROOT","WINDIR","TEMP","TMP","APPDATA","LOCALAPPDATA","USERPROFILE","HOME","HOMEDRIVE","HOMEPATH","COMSPEC","NUMBER_OF_PROCESSORS","PROCESSOR_ARCHITECTURE"]);
 for(const [key,value]of Object.entries(process.env))if(allowed.has(key.toUpperCase()))environment[key]=value;
 environment.RSS139_TOKEN=token;environment.RSS139_PARENT_PID=String(process.pid);
 const warmupOnly=approval.purpose==="WARMUP_ONLY",phaseJournal=rss139WorkerJournal();let phaseFailure:string|null=null;
 let child:ChildProcess|undefined,phaseListener:((value:unknown)=>void)|undefined;
 let owner:ReturnType<typeof rss139OwnChild>|undefined,verifiedPid=false,closed=false;
 let lastMemoryObservation:Awaited<ReturnType<typeof rss139CaptureMemory>>|null=null;

  const summary=(value:Record<string,unknown>)=>{
   const source=value.stats;check(source&&typeof source==="object","DIAGNOSTIC_STATS");
   const limits={requests:2,active:2,maxActive:2,spooledBytes:2*HWM,sdkBytes:2*HWM,sdkPuts:2,maxInputChunk:128*1024};
   const stats:Record<string,number|string[]>={};
   for(const [key,maximum]of Object.entries(limits)){
    const number=Reflect.get(source,key);check(Number.isSafeInteger(number)&&number>=0&&number<=maximum,"DIAGNOSTIC_STATS");stats[key]=number;
   }
   const errors=Reflect.get(source,"errors");check(Array.isArray(errors)&&errors.every(value=>value==="SPOOL_CLEANUP_UNKNOWN"||value==="HANDLER_UNKNOWN"),"DIAGNOSTIC_ERRORS");
   stats.errors=[...errors];return {stats,phaseCount:phaseJournal.values().length};
  };

 const httpScope=new AbortController(),httpJobs=new Set<Promise<unknown>>();
 try{
  child=spawn(process.execPath,["--import","tsx",filename,"--authorized-local-transport","--mode","worker","--approval-file",process.argv[process.argv.indexOf("--approval-file")+1]],{cwd:web,env:environment,windowsHide:true,stdio:["ignore","ignore","ignore","ipc"]});
  owner=rss139OwnChild(child,{runId:approval.runId,token});
  phaseListener=(value:unknown)=>{
   if(!value||typeof value!=="object"||!("kind" in value)||value.kind!=="receiver-phase")return;
   try{const message=value as Record<string,unknown>;check(message.pid===child?.pid&&message.runId===approval.runId&&message.sourceHash===approval.sourceHash,"PHASE_IDENTITY");
    check(message.record&&typeof message.record==="object"&&"phase" in message.record&&"facts" in message.record,"PHASE_RECORD");
    const record=message.record as {phase:unknown;facts:unknown};check(typeof record.phase==="string"&&record.facts&&typeof record.facts==="object","PHASE_RECORD");phaseJournal.record(record.phase,record.facts as Record<string,unknown>);
   }catch{phaseFailure="RSS139_PHASE_INVALID";}
  };child.on("message",phaseListener);
  const ready=await rss139ChildMessage(child,"ready");check(ready.pid===child.pid&&ready.runId===approval.runId&&ready.sourceHash===approval.sourceHash&&Number.isInteger(ready.port),"CHILD_HELLO");verifiedPid=true;

  const httpDeadline=performance.now()+(warmupOnly?30000:600000);
  const remaining=()=>{rss139AssertPhaseIntegrity(phaseFailure);check(!httpScope.signal.aborted,"HTTP_CANCELLED");const budget=httpDeadline-performance.now();check(budget>0,"HTTP_MATRIX_DEADLINE");return budget;};
  const matrixMessage=(kind:string,id?:string)=>rss139ChildMessage(child!,kind,id,Math.min(60000,remaining()),httpScope.signal);
  const execute=(scenario:Case,suffix:string)=>{
   const job=(async()=>{
    const id=scenario.id+"-"+suffix,admitted=matrixMessage("admitted",id);child!.send({kind:"admit",token,id,case:scenario});await admitted;
    return send(Number(ready.port),token,id,scenario,remaining(),httpScope.signal);
   })();
   httpJobs.add(job);void job.finally(()=>httpJobs.delete(job)).catch(()=>{});return job;
  };
  if(!approval.diagnosticControl)for(let index=0;index<2;index++)await execute({id:"warm",size:HWM,expectedStatus:200,level:"transport-http"},String(index));
  let baseline:Record<string,unknown>|null=null,warmupSummary:Record<string,unknown>|null=null;const reports:unknown[]=[];
  if(warmupOnly){const receipt=matrixMessage("warmup-summary");child.send({kind:"warmup-summary",token});warmupSummary=summary(await receipt);check(phaseFailure===null,"PHASE_INVALID");}
  else{const baselineReceipt=matrixMessage("baseline");child.send({kind:"baseline",token});baseline=await baselineReceipt;
  for(const scenario of approval.diagnosticControl?cases.filter(value=>value.id==="control-limit-plus1"):approval.diagnosticTail||approval.verifyTail?cases.slice(-2):approval.focusedDoc100?cases.filter(value=>value.id==="doc100"):cases){
   const caseStart=matrixMessage("case-started");child.send({kind:"begin-case",token});await caseStart;
   const values=await Promise.all(Array.from({length:scenario.parallel??1},(_,index)=>execute(scenario,String(index))));
   const snapshotReceipt=matrixMessage("snapshot");child.send({kind:"snapshot",token});const snapshot=await snapshotReceipt;
   rss139AssertPhaseIntegrity(phaseFailure);
   const base=snapshot.baseline as Memory,peak=snapshot.peak as Memory,limit=scenario.parallel?approval.parallelLimit:approval.singleLimit;
   lastMemoryObservation=await rss139CaptureMemory(scenario.id,approval.sourceHash,base,peak,values.map(value=>value.status),(part,facts)=>publish(approval.evidenceRoot,part,facts));
   // Сохраняем точные closed/live queue facts ДО любой budget/drain проверки, включая отказной case.
   await publish(approval.evidenceRoot,"queues-"+scenario.id+".json",{queuePeak:snapshot.queuePeak,
    disposedQueues:snapshot.disposedQueues,liveQueues:snapshot.liveQueues,maxInputChunk:(snapshot.stats as Stats).maxInputChunk,
    statuses:values.map(value=>value.status),sourceHash:approval.sourceHash});
   // Node memory — отдельное наблюдение. 32/64 MiB относятся ко ВСЕМ живым transport buffers.
   const transportBudget=rss139TransportBudget(snapshot.queuePeak,scenario.parallel??1,(snapshot.stats as Stats).maxInputChunk);
   check(sum(snapshot.liveQueues as Queues)===0,"TRANSPORT_DRAIN");
   const disposedDrain=sum(snapshot.disposedQueues as Queues)===0;
   if(!approval.diagnosticTail)check(disposedDrain,"TRANSPORT_DISPOSED_DRAIN");
   await publish(approval.evidenceRoot,"transport-"+scenario.id+".json",transportBudget);
   // Историческая focused diagnostic сохраняет ошибочный process gate только как DIAGNOSTIC_ONLY.
   const memoryGate=peak.rss-base.rss<=limit&&peak.external-base.external<=limit&&peak.arrayBuffers-base.arrayBuffers<=limit;
   let postMeasureGc:Record<string,unknown>|undefined;
   if(approval.focusedDoc100){
    await publish(approval.evidenceRoot,"diagnostic-before-gc.json",{status:"DIAGNOSTIC_ONLY",memorySLO:memoryGate?"OBSERVED_WITHIN_BOUND":"FAIL",memoryObservation:lastMemoryObservation,queues:{peak:snapshot.queuePeak,disposed:snapshot.disposedQueues,live:snapshot.liveQueues}});
    if(!memoryGate){const receipt=matrixMessage("post-measure-gc");child.send({kind:"post-measure-gc",token});postMeasureGc=await receipt;}
   }
   check(!(snapshot.stats as Stats).errors.length,"CLEANUP_UNKNOWN");
   if(scenario.parallel){
    const intervals=values.map(value=>value.body);check((snapshot.stats as Stats).maxActive>=2&&Math.max(...intervals.map(value=>Number(value.started)))<Math.min(...intervals.map(value=>Number(value.ended))),"CONCURRENT_OVERLAP");
   }
   reports.push({scenario,values,snapshot,memoryObservation:lastMemoryObservation,transportBudget,
    ...(approval.diagnosticTail?{disposedDrain,assertion:disposedDrain?"PASS":"FAIL_TRANSPORT_DISPOSED_DRAIN"}:{}),
    ...(approval.focusedDoc100?{memoryGate,postMeasureGc}:{})});
   console.log(JSON.stringify({phase:"case-completed",id:scenario.id,level:scenario.level,sourceHash:approval.sourceHash}));
  }
  }
  remaining();
  const closedReceipt=rss139ChildMessage(child,"closed");child.send({kind:"shutdown",token});const closure=await closedReceipt;
  check(closure.pid===child.pid&&closure.ownCount===0,"CHILD_CLOSED");closed=true;
  const childExit=await owner.awaitExit();check(childExit.state==="exited"&&childExit.exited&&childExit.code===0,"CHILD_EXIT");
  check((await readdir(approval.spoolRoot)).length===0,"OWN_REMAINS");await guardedDirectory(approval.spoolRoot);await rmdir(approval.spoolRoot);
  const diagnosticOnly=approval.focusedDoc100||approval.diagnosticTail||approval.diagnosticControl;
  const status=diagnosticOnly?"DIAGNOSTIC_ONLY":warmupOnly?"WARMUP_ONLY_PASS":approval.verifyTail?"TAIL_PASS":"PASS";
  await verify(approval);rss139AssertPhaseIntegrity(phaseFailure);const report=await publish(approval.evidenceRoot,"result.json",{status,purpose:approval.purpose,caseScope:approval.diagnosticControl?"CONTROL_ONLY":approval.verifyTail||approval.diagnosticTail?"LAST_TWO_ONLY":"ORIGINAL_SERIES",pre,baseline,warmupSummary,phases:phaseJournal.values(),reports,childExit,memorySLO:diagnosticOnly?"NOT_ACCEPTANCE":warmupOnly?"NOT_RUN":"TRANSPORT_BUFFERS_PASS",nodeMemorySLO:"OBSERVATION_ONLY_NO_GC",sourceHash:approval.sourceHash,ownCount:0,level:"transport-node-http-mock-sdk",actualNextServer:"NOT_RUN",minio:"NOT_RUN",database:"NOT_RUN",staging:"NOT_RUN"});
  console.log(JSON.stringify({status,report}));
 }catch(error){
  // PRE/owned spool остаются. Terminate относится к exact spawn capability даже до hello.
  httpScope.abort(Error("RSS139_HTTP_CANCELLED"));
  let senderJoinFailure:string|null=null;
  try{await rss139JoinSenders(httpJobs);}catch(joinFailure){senderJoinFailure=safeFailureCode(joinFailure,"RSS139_HTTP_SCOPE_JOIN_UNKNOWN");}
  let diagnosticSnapshot:Record<string,unknown>|null=null;
  if(warmupOnly&&child&&verifiedPid){try{const waiting=rss139ChildMessage(child,"diagnostics",undefined,200);child.send({kind:"diagnostics",token});const snapshot=await waiting;check(snapshot.pid===child.pid&&snapshot.runId===approval.runId&&snapshot.sourceHash===approval.sourceHash,"DIAGNOSTIC_IDENTITY");diagnosticSnapshot=summary(snapshot);}catch{ /* Best effort read-only, не ACK и не retry. */ }}
  const childExit=owner?await owner.terminate():{state:"not-spawned",exited:false,killRequested:false};
  await publish(approval.evidenceRoot,"stop.json",{status:"STOP",pre,childVerified:verifiedPid,closed,childExit,
   retainedSpool:"UNKNOWN_RETAINED",senderJoinFailure,purpose:approval.purpose,lastMemoryObservation,phases:phaseJournal.values(),phaseFailure,diagnosticSnapshot,code:safeFailureCode(error,"RSS139_RUN_STOP"),failures:error instanceof Error&&"failures" in error?error.failures:[],hold:true,sourceHash:approval.sourceHash});
  throw Error("RSS139_RUN_STOP");
 }finally{if(child&&phaseListener)child.off("message",phaseListener);}
}
export async function rss139Main(args:string[]){
 check(args.includes("--authorized-local-transport"),"EXPLICIT_AUTHORIZATION");
 const mode=args[args.indexOf("--mode")+1],approvalFile=args[args.indexOf("--approval-file")+1];check(mode==="run"||mode==="worker"||mode==="warmup","MODE");
 check(approvalFile&&path.isAbsolute(approvalFile)&&!(await lstat(approvalFile)).isSymbolicLink(),"APPROVAL_FILE");
 const approval=JSON.parse((await readFile(approvalFile,"utf8")).replace(/^\uFEFF/,"")) as Approval;
 rss139AssertPurpose(approval.purpose,mode);
 if(mode==="worker")await worker(approval,process.env.RSS139_TOKEN??"");else await run(approval);
}
if(path.resolve(process.argv[1]??"")===filename)void rss139Main(process.argv.slice(2)).catch(()=>{console.error(JSON.stringify({status:"STOP",code:"RSS139_SOURCE_PREPARE_GUARD",hold:true}));process.exitCode=1;});
