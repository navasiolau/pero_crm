import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import test from "node:test";
import {rss139ChildMessage,rss139DrainHandlers,rss139OwnChild,rss139OverrideSend,rss139Cleanup,rss139HttpOperation,rss139ReadResponse,rss139WaitDrain,rss139JoinSenders} from "./file-upload-transport-rss";

function deferred<T=void>(){
 let resolve!:(value:T|PromiseLike<T>)=>void,reject!:(reason?:unknown)=>void;
 const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});
 return {promise,resolve,reject};
}
const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));
function state(){return {jobs:new Set<Promise<void>>(),active:0,admissions:0,errors:[] as string[]};}
const read=(value:ReturnType<typeof state>)=>()=>({...value,jobs:[...value.jobs]});
class FakeChild extends EventEmitter{
 pid:number|undefined;exitCode:number|null=null;signalCode:NodeJS.Signals|null=null;
 kills=0;killAccepted=true;killThrows=false;exitOnKill=false;
 constructor(pid:number|undefined=139){super();this.pid=pid;}
 kill(){this.kills++;if(this.killThrows)throw Error("CONTROLLED_KILL_FAILURE");
  if(this.exitOnKill)setImmediate(()=>this.exit(null,"SIGTERM"));return this.killAccepted;
 }
 exit(code:number|null,signal:NodeJS.Signals|null=null){this.exitCode=code;this.signalCode=signal;this.emit("exit",code,signal);}
}
const identity={runId:"da24fd79-c99f-409a-a72b-4ce662dd19c1",token:"controlled-private-token"};

test("warm response can finish before dispose; actual barrier delays baseline until handler drains",async()=>{
 const value=state(),dispose=deferred();let captured=0;const response=Promise.resolve({status:200});
 value.active=1;
 const job=dispose.promise.finally(()=>{value.active--;value.jobs.delete(job);});
 value.jobs.add(job);
 assert.equal((await response).status,200);
 const capture=rss139DrainHandlers(read(value),()=>{captured++;return "baseline";},1000);
 await turn();assert.equal(captured,0);assert.equal(value.active,1);
 dispose.resolve();assert.equal(await capture,"baseline");assert.equal(captured,1);assert.equal(value.jobs.size,0);
});
test("admitted but unstarted request prevents baseline and reaches a bounded deadline",async()=>{
 const value=state();value.admissions=1;let captured=false;
 await assert.rejects(rss139DrainHandlers(read(value),()=>{captured=true;},10),/RSS139_DRAIN_TIMEOUT/);
 assert.equal(captured,false);
});
test("drain waits for later-started admitted handler, including delayed disposal",async()=>{
 const value=state(),dispose=deferred();value.admissions=1;let captured=false;
 const capture=rss139DrainHandlers(read(value),()=>{captured=true;},1000);
 await turn();assert.equal(captured,false);
 value.admissions=0;value.active=1;
 const job=dispose.promise.finally(()=>{value.active--;value.jobs.delete(job);});value.jobs.add(job);
 await turn();assert.equal(captured,false);dispose.resolve();await capture;assert.equal(captured,true);
});
test("dispose failure forbids baseline even when the HTTP response already succeeded",async()=>{
 const value=state(),dispose=deferred();value.active=1;let captured=false;
 const job=dispose.promise.catch(()=>{value.errors.push("SPOOL_CLEANUP_UNKNOWN");}).finally(()=>{value.active--;value.jobs.delete(job);});
 value.jobs.add(job);
 const capture=rss139DrainHandlers(read(value),()=>{captured=true;},1000);dispose.reject(Error("CONTROLLED_DISPOSE_FAILURE"));
 await assert.rejects(capture,/RSS139_DRAIN_CLEANUP_UNKNOWN/);assert.equal(captured,false);
});
test("falsy handler rejection is not mistaken for a successful drain",async()=>{
 const value=state();value.jobs.add(Promise.reject(undefined));let captured=false;
 await assert.rejects(rss139DrainHandlers(read(value),()=>{captured=true;},1000),/RSS139_DRAIN_HANDLER_UNKNOWN/);
 assert.equal(captured,false);
});
test("hung handler remains uncompleted after bounded drain timeout",async()=>{
 const value=state(),hung=deferred();value.active=1;value.jobs.add(hung.promise);let captured=false;
 await assert.rejects(rss139DrainHandlers(read(value),()=>{captured=true;},10),/RSS139_DRAIN_TIMEOUT/);
 assert.equal(captured,false);assert.equal(value.active,1);hung.resolve();
});
test("success waits for actual child exit and records code without sending kill",async()=>{
 const child=new FakeChild(),owner=rss139OwnChild(child,identity);let settled=false;
 const result=owner.awaitExit(1000).then(receipt=>{settled=true;return receipt;});
 await turn();assert.equal(settled,false);child.exit(0);
 const receipt=await result;assert.equal(receipt.state,"exited");assert.equal(receipt.exited,true);assert.equal(receipt.code,0);
 assert.equal(receipt.pid,139);assert.equal(child.kills,0);assert.equal(child.listenerCount("exit"),0);assert.equal(child.listenerCount("error"),0);
});
test("IPC timeout before hello still terminates the spawn-owned child and awaits exit",async()=>{
 const child=new FakeChild(),owner=rss139OwnChild(child,identity);child.exitOnKill=true;
 await assert.rejects(rss139ChildMessage(child,"ready",undefined,10),/RSS139_IPC_TIMEOUT/);
 const receipt=await owner.terminate(1000);
 assert.equal(receipt.state,"exited");assert.equal(receipt.exited,true);assert.equal(receipt.signal,"SIGTERM");
 assert.equal(receipt.killRequested,true);assert.equal(receipt.killAccepted,true);assert.equal(child.kills,1);
 assert.equal(child.listenerCount("message"),0);assert.equal(child.listenerCount("exit"),0);assert.equal(child.listenerCount("error"),0);
});
test("kill false with no exit records retained state rather than completed cleanup",async()=>{
 const child=new FakeChild(),owner=rss139OwnChild(child,identity);child.killAccepted=false;
 const receipt=await owner.terminate(10);
 assert.equal(receipt.state,"retained");assert.equal(receipt.exited,false);assert.equal(receipt.killAccepted,false);
 assert.equal(receipt.code,null);assert.equal(child.kills,1);child.exit(0);
});
test("kill exception with no exit remains retained and does not mask STOP facts",async()=>{
 const child=new FakeChild(),owner=rss139OwnChild(child,identity);child.killThrows=true;
 const receipt=await owner.terminate(10);
 assert.equal(receipt.state,"retained");assert.equal(receipt.exited,false);assert.equal(receipt.killError,true);
 assert.equal(child.kills,1);child.exit(0);
});
test("changed PID cannot be substituted into the spawn-owned handle",async()=>{
 const child=new FakeChild(),owner=rss139OwnChild(child,identity);child.pid=999;
 const receipt=await owner.terminate(10);
 assert.equal(receipt.state,"identity-mismatch");assert.equal(receipt.exited,false);assert.equal(receipt.pid,139);assert.equal(child.kills,0);
 child.pid=139;child.exit(0);
});
test("already exited child before hello rejects immediately and never receives kill",async()=>{
 const child=new FakeChild(),owner=rss139OwnChild(child,identity);child.exit(7);
 await assert.rejects(rss139ChildMessage(child,"ready",undefined,1000),/RSS139_EARLY_CHILD_EXIT/);
 const receipt=await owner.terminate(10);
 assert.equal(receipt.state,"exited");assert.equal(receipt.code,7);assert.equal(child.kills,0);
});
test("spawn error before hello is sanitized, observed, and causes no PID-less kill",async()=>{
 const child=new FakeChild(undefined);child.pid=undefined;const owner=rss139OwnChild(child,identity);
 const hello=rss139ChildMessage(child,"ready",undefined,1000);child.emit("error",Object.assign(Error("SECRET_UNPRINTED"),{code:"ENOENT"}));
 await assert.rejects(hello,/RSS139_CHILD_ERROR/);
 const receipt=await owner.terminate(10);
 assert.equal(receipt.state,"spawn-failed");assert.equal(receipt.exited,false);assert.equal(receipt.spawnError,true);
 assert.equal(receipt.pid,null);assert.equal(child.kills,0);assert.equal(JSON.stringify(receipt).includes("SECRET_UNPRINTED"),false);
 assert.equal(child.listenerCount("error"),0);
});

test("SDK mock restore removes only its own override when send was inherited",()=>{
 const inherited=async()=>({kind:"original"}),mock=async()=>({kind:"mock"});
 const prototype=Object.create({send:inherited}) as {send:()=>Promise<unknown>};
 const restore=rss139OverrideSend(prototype,mock);
 assert.equal(prototype.send,mock);assert.equal(Object.hasOwn(prototype,"send"),true);
 restore();assert.equal(Object.hasOwn(prototype,"send"),false);assert.equal(prototype.send,inherited);
});
test("SDK mock restore preserves the exact prior own property descriptor",()=>{
 const original=async()=>({kind:"original"}),mock=async()=>({kind:"mock"}),prototype={};
 const descriptor={value:original,writable:true,enumerable:true,configurable:true};
 Object.defineProperty(prototype,"send",descriptor);
 const restore=rss139OverrideSend(prototype,mock);restore();
 assert.deepEqual(Object.getOwnPropertyDescriptor(prototype,"send"),descriptor);
});
test("SDK mock restore rejects and preserves a foreign replacement",()=>{
 const prototype={},mock=async()=>({kind:"mock"}),foreign=async()=>({kind:"foreign"});
 const restore=rss139OverrideSend(prototype,mock);
 Object.defineProperty(prototype,"send",{value:foreign,configurable:true});
 assert.throws(restore,/RSS139_SDK_OVERRIDE_CHANGED/);assert.equal(Reflect.get(prototype,"send"),foreign);
});
test("resource cleanup still runs later steps and retains falsy primary plus secondary failure",async()=>{
 const attempts:string[]=[];
 await assert.rejects(rss139Cleanup([
  {label:"primary",run:()=>{attempts.push("primary");throw undefined;}},
  {label:"secondary",run:()=>{attempts.push("secondary");throw Error("RSS139_SDK_OVERRIDE_CHANGED");}},
  {label:"remaining",run:async()=>{attempts.push("remaining");}},
 ]),error=>{
  assert.ok(error instanceof Error);assert.equal(error.message,"RSS139_CLEANUP_UNKNOWN");
  assert.deepEqual(Reflect.get(error,"failures"),[{label:"primary",code:"RSS139_CLEANUP_STEP_UNKNOWN"},{label:"secondary",code:"RSS139_SDK_OVERRIDE_CHANGED"}]);
  return true;
 });
 assert.deepEqual(attempts,["primary","secondary","remaining"]);
});


test("whole HTTP operation deadline aborts a stalled response and releases its timer",async()=>{
 let aborted=false;
 await assert.rejects(rss139HttpOperation(signal=>new Promise<void>(()=>{signal.addEventListener("abort",()=>{aborted=true;},{once:true});}),10),/RSS139_HTTP_DEADLINE/);
 assert.equal(aborted,true);
});
test("no-end response refuses on deadline and removes response listeners",async()=>{
 const response=new EventEmitter();let aborted=false;
 await assert.rejects(rss139HttpOperation(signal=>{signal.addEventListener("abort",()=>{aborted=true;},{once:true});return rss139ReadResponse(response,signal);},10),/RSS139_HTTP_DEADLINE/);
 assert.equal(aborted,true);for(const name of ["data","end","error","close"])assert.equal(response.listenerCount(name),0);
});
test("write-drain stall aborts within HTTP deadline and releases every stream listener",async()=>{
 const request=new EventEmitter();
 await assert.rejects(rss139HttpOperation(signal=>rss139WaitDrain(request,signal),10),/RSS139_HTTP_DEADLINE/);
 for(const name of ["drain","error","close"])assert.equal(request.listenerCount(name),0);
});
test("response closes without end and write closes without drain are terminal failures",async()=>{
 const response=new EventEmitter(),request=new EventEmitter(),controller=new AbortController();
 const body=rss139ReadResponse(response,controller.signal);response.emit("close");
 await assert.rejects(body,/RSS139_RESPONSE_CLOSED/);
 const drain=rss139WaitDrain(request,controller.signal);request.emit("close");
 await assert.rejects(drain,/RSS139_WRITE_CLOSED/);
 assert.equal(response.listenerCount("data"),0);assert.equal(request.listenerCount("drain"),0);
});
test("normal bounded response and drain finish without abort or leaked event handlers",async()=>{
 const response=new EventEmitter(),request=new EventEmitter();let aborted=false;
 const value=await rss139HttpOperation(async signal=>{
  signal.addEventListener("abort",()=>{aborted=true;},{once:true});
  const body=rss139ReadResponse(response,signal),drain=rss139WaitDrain(request,signal);
  response.emit("data",Buffer.from('{"status":200}'));request.emit("drain");response.emit("end");
  await drain;return body;
 },1000);
 assert.equal(value.status,200);assert.equal(aborted,false);
 for(const name of ["data","end","error","close"])assert.equal(response.listenerCount(name),0);
 for(const name of ["drain","error","close"])assert.equal(request.listenerCount(name),0);
});
test("bounded response overflow rejects inside the promise rather than escaping data event",async()=>{
 const response=new EventEmitter(),controller=new AbortController(),body=rss139ReadResponse(response,controller.signal);
 assert.doesNotThrow(()=>response.emit("data",Buffer.alloc(16385)));
 await assert.rejects(body,/RSS139_RESPONSE_BOUND/);assert.equal(response.listenerCount("data"),0);
});


test("parallel HTTP peer cancellation settles both waits and removes all listeners",async()=>{
 const scope=new AbortController(),response=new EventEmitter(),request=new EventEmitter();
 const first=rss139HttpOperation(signal=>rss139ReadResponse(response,signal),1000,scope.signal);
 const second=rss139HttpOperation(signal=>rss139WaitDrain(request,signal),1000,scope.signal);
 scope.abort(Error("RSS139_HTTP_CANCELLED"));
 const joined=await rss139JoinSenders([first,second],1000);
 assert.deepEqual(joined.map(value=>value.status),["rejected","rejected"]);
 assert.equal(response.listenerCount("data"),0);assert.equal(request.listenerCount("drain"),0);
});
test("cancelled IPC admission refuses immediately and releases own child wait listeners",async()=>{
 const scope=new AbortController(),child=new FakeChild();
 const admission=rss139ChildMessage(child,"admitted","controlled-id",1000,scope.signal);
 scope.abort(Error("RSS139_HTTP_CANCELLED"));await assert.rejects(admission,/RSS139_HTTP_CANCELLED/);
 for(const name of ["message","exit","error"])assert.equal(child.listenerCount(name),0);
});
test("owned sender join waits for cancellation cleanup, rejects hung cleanup within budget",async()=>{
 const cleanup=deferred();let joined=false;
 const waiting=rss139JoinSenders([cleanup.promise],1000).then(value=>{joined=true;return value;});
 await turn();assert.equal(joined,false);cleanup.resolve();await waiting;assert.equal(joined,true);
 const hung=deferred();await assert.rejects(rss139JoinSenders([hung.promise],10),/RSS139_SENDER_JOIN_TIMEOUT/);hung.resolve();
});
test("already cancelled HTTP scope never starts a request or leaves unhandled work",async()=>{
 const scope=new AbortController();scope.abort(Error("RSS139_HTTP_CANCELLED"));let started=false;
 await assert.rejects(rss139HttpOperation(async()=>{started=true;return {};},1000,scope.signal),/RSS139_HTTP_CANCELLED/);
 assert.equal(started,false);
});

test("worker phase journal refuses raw fields and keeps only safe fixed error facts",async()=>{
 const source=await import("./file-upload-transport-rss");
 const helper=Reflect.get(source,"rss139WorkerJournal");
 assert.equal(typeof helper,"function");
 const make=helper as ()=>{record:(phase:string,facts:Record<string,unknown>)=>unknown;values:()=>unknown[]};
 const journal=make(),facts={requestComplete:true,requestEnded:true,requestDestroyed:false,requestAborted:false,responseFinished:false,responseDestroyed:false,bytes:64,status:200,errorName:"TypeError",errorCode:"RSS139_RUNTIME_FAILED"};
 const event=journal.record("caught",facts);
 assert.ok(event);assert.equal(JSON.stringify(event).includes("SECRET"),false);
 assert.throws(()=>journal.record("raw-message",{...facts,message:"SECRET"}),/RSS139_PHASE_/);
 assert.throws(()=>journal.record("caught",{...facts,token:"SECRET"}),/RSS139_PHASE_/);
});
test("warmup journal is bounded and cannot retain arbitrary Error names or codes",async()=>{
 const source=await import("./file-upload-transport-rss");
 const helper=Reflect.get(source,"rss139WorkerJournal");
 assert.equal(typeof helper,"function");
 const make=helper as ()=>{record:(phase:string,facts:Record<string,unknown>)=>unknown;values:()=>unknown[]};
 const journal=make(),facts={requestComplete:false,requestEnded:false,requestDestroyed:false,requestAborted:false,responseFinished:false,responseDestroyed:false,bytes:0,status:500,errorName:"Error",errorCode:"RSS139_RUNTIME_FAILED"};
 assert.throws(()=>journal.record("caught",{...facts,errorName:"SECRET"}),/RSS139_PHASE_/);
 assert.throws(()=>journal.record("caught",{...facts,errorCode:"UPLOAD_SECRET"}),/RSS139_PHASE_/);
 for(let index=0;index<128;index++)journal.record("caught",facts);
 assert.equal(journal.values().length,128);assert.throws(()=>journal.record("caught",facts),/RSS139_PHASE_BOUND/);
});

test("warmup purpose cannot enter the full matrix and full purpose cannot enter warmup",async()=>{
 const {rss139AssertPurpose}=await import("./file-upload-transport-rss");
 assert.doesNotThrow(()=>rss139AssertPurpose("WARMUP_ONLY","warmup"));
 assert.doesNotThrow(()=>rss139AssertPurpose("RSS_MATRIX","run"));
 assert.throws(()=>rss139AssertPurpose("WARMUP_ONLY","run"),/RSS139_PURPOSE_MODE/);
 assert.throws(()=>rss139AssertPurpose("RSS_MATRIX","warmup"),/RSS139_PURPOSE_MODE/);
 assert.throws(()=>rss139AssertPurpose(undefined,"worker"),/RSS139_PURPOSE/);
});

test("keepalive request-close between native response end and its Promise continuation keeps the valid body",async()=>{
 const source=await import("./file-upload-transport-rss");
 const close=Reflect.get(source,"rss139RequestClosed") as ((response:object|undefined,reject:(error:Error)=>void)=>void)|undefined;
 assert.equal(typeof close,"function");
 const response=new EventEmitter(),controller=new AbortController();let rejection:Error|undefined,settled=false;
 const body=source.rss139ReadResponse(response,controller.signal).then(value=>{settled=true;return value;});
 response.emit("data",Buffer.from('{"size":65536,"sha256":"verified"}'));response.emit("end");
 assert.equal(settled,false);close!(response,error=>{rejection=error;});
 assert.equal(rejection,undefined);assert.deepEqual(await body,{size:65536,sha256:"verified"});
 const beforeHeaders:Error[]=[];close!(undefined,error=>beforeHeaders.push(error));assert.deepEqual(beforeHeaders.map(error=>error.message),["RSS139_HTTP_CLOSED"]);
});
test("postheader request-close defers to the real response reader; incomplete response never becomes success",async()=>{
 const source=await import("./file-upload-transport-rss");
 const close=Reflect.get(source,"rss139RequestClosed") as ((response:object|undefined,reject:(error:Error)=>void)=>void)|undefined;
 assert.equal(typeof close,"function");
 const response=new EventEmitter(),controller=new AbortController();let rejection:Error|undefined;
 const body=source.rss139ReadResponse(response,controller.signal);
 response.emit("data",Buffer.from('{"size":'));close!(response,error=>{rejection=error;});
 assert.equal(rejection,undefined);response.emit("close");await assert.rejects(body,/RSS139_RESPONSE_CLOSED/);
});

test("memory observation preserves signed deltas separately from the complete hard transport budget",async()=>{
 const source=await import("./file-upload-transport-rss");
 const helper=Reflect.get(source,"rss139CaptureMemory");
 assert.equal(typeof helper,"function");
 type Facts={id:string;size:number;parallel:number;statuses:number[];limit:number;baseline:{rss:number;external:number;arrayBuffers:number};peak:{rss:number;external:number;arrayBuffers:number};delta:{rss:number;external:number;arrayBuffers:number}};
 const capture=helper as (id:string,sha:string,base:unknown,peak:unknown,statuses:readonly number[],publish:(part:string,facts:Facts)=>Promise<{file:string;sha256:string}>)=>Promise<{facts:Facts;receipt:{file:string;sha256:string}}>;
 const base={rss:100*1024*1024,external:5*1024*1024,arrayBuffers:3*1024*1024,secret:"never serialize"};
 const peak={rss:140*1024*1024,external:4*1024*1024,arrayBuffers:2*1024*1024};
 const writes:{part:string;facts:Facts}[]=[];
 const observed=await capture("doc25","a".repeat(64),base,peak,[200],async(part,facts)=>{writes.push({part,facts});return {file:"case-doc25.json",sha256:"b".repeat(64)};});
 assert.equal(writes.length,1);assert.equal(writes[0].part,"case-doc25.json");
 assert.equal(observed.facts.delta.rss,40*1024*1024);assert.equal(observed.facts.delta.external,-1024*1024);
 assert.equal(observed.facts.delta.arrayBuffers,-1024*1024);assert.equal(observed.facts.limit,32*1024*1024);
 assert.equal(observed.facts.id,"doc25");assert.equal(observed.facts.size,25*1024*1024);assert.equal(observed.facts.parallel,1);
 assert.deepEqual(observed.facts.statuses,[200]);assert.equal(JSON.stringify(observed).includes("secret"),false);
 assert.equal(observed.facts.delta.rss>observed.facts.limit,true);assert.equal(observed.receipt.sha256,"b".repeat(64));
 const parallel=await capture("parallel100","a".repeat(64),base,peak,[200,200],async()=>({file:"case-parallel100.json",sha256:"b".repeat(64)}));
 assert.equal(parallel.facts.limit,64*1024*1024);assert.equal(parallel.facts.parallel,2);
 const queues={pending:0,parser:14495,part:65536,transformRead:65536,transformWrite:79455,
  fileWrite:65536,spoolReaders:0,networkRead:65072,storageRead:0};
 const transport=source.rss139TransportBudget(queues,1,65536);
 assert.equal(transport.limit,32*1024*1024);
 assert.equal(transport.upperBound,Object.values(queues).reduce((total,bytes)=>total+bytes,0)+transport.reservedBytes);
 assert.equal(transport.reservedBytes,Object.values(transport.reserves).reduce((total,bytes)=>total+bytes,0));
 assert.equal(transport.theoreticalUpperBound<=transport.limit,true);
 const paired=source.rss139TransportBudget(queues,2,65536);
 assert.equal(paired.limit,64*1024*1024);assert.equal(paired.theoreticalUpperBound,2*transport.theoreticalUpperBound);
 assert.throws(()=>source.rss139TransportBudget({...queues,pending:32*1024*1024+1},1,65536),/RSS139_TRANSPORT_QUEUE_BOUND/);
});
test("memory diagnostic refuses unknown or non-finite data and never treats failed durable write as receipt",async()=>{
 const source=await import("./file-upload-transport-rss");
 const helper=Reflect.get(source,"rss139CaptureMemory");
 assert.equal(typeof helper,"function");
 const capture=helper as (id:string,sha:string,base:unknown,peak:unknown,statuses:readonly number[],publish:()=>Promise<{file:string;sha256:string}>)=>Promise<unknown>;
 const memory={rss:0,external:0,arrayBuffers:0};let writes=0;
 const publish=async()=>{writes++;return {file:"case-doc25.json",sha256:"b".repeat(64)};};
 await assert.rejects(capture("foreign","a".repeat(64),memory,memory,[200],publish),/RSS139_MEMORY_SCENARIO/);
 await assert.rejects(capture("doc25","a".repeat(64),memory,{...memory,rss:Infinity},[200],publish),/RSS139_MEMORY_FACTS/);
 await assert.rejects(capture("doc25","a".repeat(64),memory,memory,[500],publish),/RSS139_MEMORY_STATUS/);
 assert.equal(writes,0);
 const queues={pending:0,parser:0,part:0,transformRead:0,transformWrite:0,fileWrite:0,spoolReaders:0,networkRead:0,storageRead:0};
 assert.throws(()=>source.rss139TransportBudget({...queues,storageRead:Infinity},1,65536),/RSS139_TRANSPORT_QUEUE_BOUND/);
 assert.throws(()=>source.rss139TransportBudget({...queues,unknown:1},1,65536),/RSS139_TRANSPORT_QUEUES/);
 assert.throws(()=>source.rss139TransportBudget(queues,1,1024*1024+1),/RSS139_TRANSPORT_INPUT/);
 assert.throws(()=>source.rss139TransportBudget(queues,3,65536),/RSS139_TRANSPORT_PARALLEL/);
 const rejection=0;await assert.rejects(capture("doc25","a".repeat(64),memory,memory,[200],async()=>{throw rejection;}),error=>error===rejection);
});

test("allocation checkpoints accept only fixed numeric shapes in the existing bounded journal",async()=>{
 const source=await import("./file-upload-transport-rss");
 const journal=source.rss139WorkerJournal(),facts={ordinal:0,rss:100,external:80,arrayBuffers:60,heapUsed:20,heapTotal:40};
 const event=journal.record("memory-worker-start",facts);assert.deepEqual(event.facts,facts);
 facts.rss=0;assert.equal(Reflect.get(journal.values()[0].facts,"rss"),100);
 assert.throws(()=>journal.record("memory-source-verified",{...facts,token:"SECRET"}),/RSS139_PHASE_/);
 assert.throws(()=>journal.record("memory-source-verified",{...facts,rss:Infinity}),/RSS139_PHASE_/);
 assert.throws(()=>journal.record("memory-file-spooled",{...facts,ordinal:11}),/RSS139_PHASE_/);
 assert.throws(()=>journal.record("memory-anywhere",facts),/RSS139_PHASE_/);
 for(let index=1;index<128;index++)journal.record("memory-source-verified",{...facts,ordinal:0});
 assert.equal(journal.values().length,128);assert.throws(()=>journal.record("memory-source-verified",facts),/RSS139_PHASE_BOUND/);
});
test("malformed allocation journal prevents acceptance in every runtime purpose",async()=>{
 const source=await import("./file-upload-transport-rss");
 const check=Reflect.get(source,"rss139AssertPhaseIntegrity");
 assert.equal(typeof check,"function");
 const validate=check as (failure:string|null)=>void;
 assert.doesNotThrow(()=>validate(null));
 assert.throws(()=>validate("RSS139_PHASE_INVALID"),/RSS139_PHASE_INVALID/);
});

test("source SHA stream matches native bytes at exact64KiB boundaries with owned handle cleanup",async()=>{
 const source=await import("./file-upload-transport-rss");
 const digestFile=Reflect.get(source,"rss139SourceDigest"),digestHandle=Reflect.get(source,"rss139HashOpenedFile");
 assert.equal(typeof digestFile,"function");assert.equal(typeof digestHandle,"function");
 const fs=await import("node:fs/promises"),path=await import("node:path"),os=await import("node:os"),crypto=await import("node:crypto");
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"pero-rss139-hash-")),files:string[]=[];
 const digest=digestFile as (file:string)=>Promise<string>;
 type Reader=AsyncIterable<unknown>&{destroy:()=>void};
 const hashOpened=digestHandle as (handle:{createReadStream:(options:{highWaterMark:number;autoClose:false})=>Reader;close:()=>Promise<void>})=>Promise<string>;
 try{
  assert.equal(await fs.realpath(root),path.resolve(root));assert.equal((await fs.lstat(root)).isSymbolicLink(),false);
  for(const size of [0,1,65535,65536,65537,196733]){
   const bytes=Buffer.alloc(size);for(let index=0;index<size;index++)bytes[index]=index%251;
   const file=path.join(root,"size-"+size+".bin");files.push(file);await fs.writeFile(file,bytes,{flag:"wx"});
   const expected=crypto.createHash("sha256").update(await fs.readFile(file)).digest("hex");
   assert.equal(await digest(file),expected);
   const handle=await fs.open(file,"r");let maxChunk=0,closed=false;
   assert.equal(await hashOpened({
    createReadStream:options=>{assert.equal(options.highWaterMark,65536);assert.equal(options.autoClose,false);
     const stream=handle.createReadStream(options);assert.equal(stream.readableHighWaterMark,65536);
     return {[Symbol.asyncIterator]:async function*(){for await(const chunk of stream){maxChunk=Math.max(maxChunk,chunk.length);yield chunk;}},destroy:()=>{stream.destroy();}};},
    close:async()=>{await handle.close();closed=true;},
   }),expected);assert.equal(closed,true);assert.equal(maxChunk<=65536,true);
   if(size===65537){await fs.appendFile(file,Buffer.from([1]));assert.notEqual(await digest(file),expected);}
  }
  await assert.rejects(digest(path.join(root,"missing.bin")),error=>Boolean(error&&typeof error==="object"&&"code" in error&&error.code==="ENOENT"));
 }finally{
  for(const file of files){assert.equal(path.dirname(path.resolve(file)),path.resolve(root));assert.equal((await fs.lstat(file)).isSymbolicLink(),false);await fs.unlink(file);}
  assert.deepEqual(await fs.readdir(root),[]);await fs.rmdir(root);
 }
});
test("source SHA stops own reader before handle close and preserves falsy read and secondary close failure",async()=>{
 const source=await import("./file-upload-transport-rss"),helper=Reflect.get(source,"rss139HashOpenedFile");
 assert.equal(typeof helper,"function");
 type Reader=AsyncIterable<unknown>&{destroy:()=>void};
 const digest=helper as (handle:{createReadStream:()=>Reader;close:()=>Promise<void>})=>Promise<string>;
 for(const closeFails of [false,true]){
  const order:string[]=[];let destroyed=false;
  const operation=digest({createReadStream:()=>({
   [Symbol.asyncIterator]:async function*(){yield Buffer.from([1]);throw 0;},
   destroy:()=>{destroyed=true;order.push("destroy");},
  }),close:async()=>{assert.equal(destroyed,true);order.push("close");if(closeFails)throw 0;}});
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{await assert.rejects(Promise.race([operation,new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(Error("UNBOUNDED_CLOSE")),250);})]),error=>{
   if(closeFails){assert.equal(error instanceof AggregateError,true);assert.equal((error as AggregateError).errors[0],0);return true;}return error===0;
  });}finally{if(timer)clearTimeout(timer);}
  assert.deepEqual(order,["destroy","close"]);
 }
 const stream:Reader={[Symbol.asyncIterator]:async function*(){yield Buffer.from([1]);},destroy:()=>{}};
 await assert.rejects(digest({createReadStream:()=>stream,close:async()=>{throw Error("CONTROLLED_CLOSE");}}),/RSS139_CLEANUP_UNKNOWN/);
});
