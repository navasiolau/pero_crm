import assert from "node:assert/strict";
import {before,beforeEach,test} from "node:test";
import {createRequire,Module} from "node:module";
import type {PrismaClient} from "@prisma/client";
const require=createRequire(import.meta.url);
let state={id:"j",title:"Old",address:"old-address" as string|null,clientId:"old-client",currency:"BYN"};
const logs:unknown[]=[];const events:unknown[]=[];
let core:typeof import("../src/server/projects/core");
let tail=Promise.resolve(); let auditFail=false;
const actor={id:"m",name:"M",roles:["MANAGER" as const],source:"web" as const};
const db={
 $queryRaw:async()=>[],project:{findUnique:async()=>({...state}),update:async({data}:{data:object})=>Object.assign(state,data),updateMany:async({data}:{data:object})=>{Object.assign(state,data);return{count:1};}},
 client:{findUnique:async()=>({id:"chosen-client"})},changeLog:{create:async({data}:{data:unknown})=>{if(auditFail)throw new Error("audit failure");logs.push(data);return data;}},
 domainEvent:{create:async({data}:{data:unknown})=>{events.push(data);return{id:"event"};}},
 $transaction:async(fn:(tx:unknown)=>Promise<unknown>)=>{const prev=tail;let release!:()=>void;tail=new Promise(r=>{release=r;});await prev;const before={...state};const n=logs.length,e=events.length;try{return await fn(db);}catch(error){state=before;logs.length=n;events.length=e;throw error;}finally{release();}}
};
function inject(path:string,exports:Record<string,unknown>){const file=require.resolve(path),stub=new Module(file);stub.filename=file;stub.loaded=true;stub.exports=exports;require.cache[file]=stub;}
before(()=>{(globalThis as {prisma?:PrismaClient}).prisma=db as unknown as PrismaClient;
 inject("next/cache",{revalidatePath:()=>{}});inject("../src/server/plugins/changelog",{writeChangeLog:async()=>{}});
 inject("../src/server/plugins/events",{emitDomainEvent:async()=>{},dispatchEvent:async()=>{}});inject("../src/server/notifications/notify",{notifyOrg:async()=>{},notifyPerson:async()=>{}});
 core=require("../src/server/projects/core");});
beforeEach(()=>{state={id:"j",title:"Old",address:"old-address",clientId:"old-client",currency:"BYN"};logs.length=0;events.length=0;tail=Promise.resolve();auditFail=false;});
test("old project title save cannot restore stale contact values unchanged in captured baseline",async()=>{
 state.address="inline-address";state.clientId="inline-client";
 const input={title:"New",address:"old-address",clientId:"old-client",baseline:{title:"Old",address:"old-address",clientId:"old-client"}};
 const result=await core.updateProjectCore(actor,"j",input);assert.equal(result.ok,true);assert.equal(state.title,"New");assert.equal(state.address,"inline-address");assert.equal(state.clientId,"inline-client");
});
test("stale changed project contact conflicts before unrelated title write or audit",async()=>{
 state.address="inline-address";
 const result=await core.updateProjectCore(actor,"j",{title:"New",address:"edited-address",baseline:{title:"Old",address:"old-address"}});
 assert.equal(result.ok,false);assert.equal(state.title,"Old");assert.equal(state.address,"inline-address");assert.equal(logs.length,0);assert.equal(events.length,0);
});
test("changed contact without a client baseline is rejected and telegram shares same CAS",async()=>{
 assert.equal((await core.updateProjectCore(actor,"j",{address:"unsafe"})).ok,false);assert.equal(state.address,"old-address");
 const result=await core.updateProjectCore({...actor,source:"telegram"},"j",{address:"bot-address",baseline:{address:"old-address"}});
 assert.equal(result.ok,true);assert.equal(state.address,"bot-address");
});

test("contact and title changes roll back together if transaction audit fails",async()=>{
 auditFail=true;
 const result=await core.updateProjectCore(actor,"j",{title:"New",address:"changed",baseline:{title:"Old",address:"old-address"}});
 assert.equal(result.ok,false);assert.equal(state.address,"old-address");assert.equal(state.title,"Old");assert.equal(logs.length,0);assert.equal(events.length,0);
});
test("two actors with one captured address baseline cannot silently overwrite one another",async()=>{
 const results=await Promise.all([core.updateProjectCore(actor,"j",{address:"first",baseline:{address:"old-address"}}),core.updateProjectCore({...actor,id:"other"},"j",{address:"second",baseline:{address:"old-address"}})]);
 assert.deepEqual(results.map(r=>r.ok),[true,false]);assert.equal(state.address,"first");assert.equal(logs.length,1);assert.equal(events.length,1);
});
