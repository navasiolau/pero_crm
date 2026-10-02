import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createIndependentActionTransport, actionReferenceId } from "../src/lib/independent-action-transport";
const id="40"+"a".repeat(40);
const reference=()=>{const data=new FormData();data.set("0",'"$h1"');data.set("1",JSON.stringify({id,bound:null}));return data;};
const response=(value:unknown,f:unknown="",headers:Record<string,string>={})=>new Response(JSON.stringify({a:value,f}),{headers:{"content-type":"text/x-component",...headers}});
const codec={encodeReference:async()=>reference(),encodeArguments:async(args:readonly unknown[])=>JSON.stringify(args),decode:async(res:Response)=>res.json()};
test("registered proxy invocation stays serialized without independent transport (RED baseline)",async()=>{
 let release!:()=>void;const gate=new Promise<void>(done=>{release=done;});let invoked=0;
 let queue=Promise.resolve();const proxy=()=>{queue=queue.then(async()=>{invoked++;await gate;});return queue;};
 const first=proxy();const second=proxy();await Promise.resolve();assert.equal(invoked,1);release();await Promise.all([first,second]);assert.equal(invoked,2);
});
test("compact action calls send neighboring field while first ACK is still held",async()=>{
 let complete!:(res:Response)=>void;const slow=new Promise<Response>(done=>{complete=done;});const calls:RequestInit[]=[];let proxyCalls=0;
 const action=async(_input:{field:string})=>{void _input;proxyCalls++;throw Error("Next global proxy must not be invoked");};
 const call=createIndependentActionTransport({codec:()=>codec,url:()=>"/products/owned",fetch:async(_url,init)=>{calls.push(init!);return calls.length===1?slow:response({kind:"saved",field:"kind"});}});
 const title=call(action,[{field:"title"}]);await Promise.resolve();await Promise.resolve();await Promise.resolve();
 const neighbor=call(action,[{field:"kind"}]);const result=await neighbor;assert.equal(calls.length,2);assert.deepEqual(result,{kind:"saved",field:"kind"});assert.equal(proxyCalls,0);
 complete(response({kind:"saved",field:"title"}));await title;assert.equal(calls[0].credentials,"same-origin");assert.equal(new Headers(calls[0].headers).get("Next-Action"),id);
});
test("repeat keeps the exact mutation payload and original action reference ID",async()=>{
 const bodies:string[]=[];let attempt=0;const call=createIndependentActionTransport({codec:()=>codec,url:()=>"/products/owned",fetch:async(_url,init)=>{bodies.push(String(init?.body));if(++attempt===1)throw Error("lost response");return response({kind:"saved",repeated:true});}});
 const action=async(_input:{clientMutationId:string})=>{void _input;return {kind:"saved"};};const payload={clientMutationId:"same-uuid"};await assert.rejects(call(action,[payload]));await call(action,[payload]);assert.equal(bodies[0],bodies[1]);
});
test("full Flight tree, revalidation, redirect and unbound-reference violations reject",async()=>{
 const action=async()=>true;
 for(const res of [response(true,{children:"tree"}),response(true,"",{"x-action-revalidated":'[["/products/owned"],0,0]'}),response(true,"",{"x-action-redirect":"/login;push"})]){
  const call=createIndependentActionTransport({codec:()=>codec,url:()=>"/products/owned",fetch:async()=>res});await assert.rejects(call(action,[]));
 }
 const bound=reference();bound.set("1",JSON.stringify({id,bound:["extra"]}));assert.throws(()=>actionReferenceId(bound));
});

test("installed Next15.5.20 React Flight codec resolves genuine registered export and compact action stream",async()=>{
 const require=createRequire(import.meta.url);assert.equal(require("next/package.json").version,"15.5.20");
 const globals=globalThis as typeof globalThis & {__webpack_require__?:((id:unknown)=>never)&{u:(id:string)=>string}};
 const previous=globals.__webpack_require__;
 globals.__webpack_require__=Object.assign((moduleId:unknown)=>{void moduleId;throw Error("Unexpected module load in compact scalar action test");},{u:(chunkId:string)=>{void chunkId;return "qa-unused.js";}});
 try {
 const flight=require("next/dist/compiled/react-server-dom-webpack/client.browser") as {createServerReference:(id:string,call:(id:string,args:unknown[])=>Promise<unknown>)=>object;encodeReply:(value:unknown)=>Promise<FormData|string>;createFromFetch:(response:Promise<Response>,options:object)=>Promise<{a:Promise<unknown>;f:unknown}>};
 const registered=flight.createServerReference(id,async()=>{throw Error("Original router proxy must not run");});
 assert.equal(actionReferenceId(await flight.encodeReply(registered)),id);
 const stream='0:{"a":"$@1","f":"","b":"qa"}\n1:{"kind":"saved","value":"confirmed"}\n';
 const envelope=await flight.createFromFetch(Promise.resolve(new Response(stream,{headers:{"content-type":"text/x-component"}})),{callServer:async()=>{throw Error("Unexpected nested action");}});
 assert.equal(envelope.f,"");assert.deepEqual(await envelope.a,{kind:"saved",value:"confirmed"});
 }finally{if(previous===undefined)delete globals.__webpack_require__;else globals.__webpack_require__=previous;}
});
