import assert from "node:assert/strict";
import { before, test } from "node:test";
import { createRequire, Module } from "node:module";
import { randomUUID } from "node:crypto";
import type { ProductPatch } from "../src/server/products/patch-contract";
const require=createRequire(import.meta.url);
const calls:string[]=[];
let action:typeof import("../src/server/products/actions");
let authenticated=true;
let invalidationGate:Promise<void>|undefined;
function inject(path:string,exports:Record<string,unknown>){const filename=require.resolve(path);const stub=new Module(filename);stub.exports=exports;stub.filename=filename;stub.loaded=true;require.cache[filename]=stub;}
before(()=>{
 inject("../src/auth",{auth:async()=>authenticated?({user:{id:"m",name:"M",roles:["MANAGER"]}}):null});
 inject("next/cache",{revalidatePath:()=>calls.push("path"),revalidateTag:()=>calls.push("tag")});
 inject("../src/server/products/revalidate",{revalidateProductPaths:async()=>{calls.push("product-revalidate");await invalidationGate;}});
 inject("../src/server/products/core",{
  patchProductCore:async(actor:{id:string},input:ProductPatch)=>{assert.equal(actor.id,"m");calls.push("patch-core");return{kind:"saved",field:input.field,value:input.value,clientMutationId:input.clientMutationId};},
  createProductCore:async()=>({ok:true,product:{id:"product",projectId:"project"}}),
 });
 action=require("../src/server/products/actions");
});
test("profile action awaits async invalidation before Next can render its response",async()=>{
 calls.length=0;
 let release!:()=>void;
 invalidationGate=new Promise<void>(resolve=>{release=resolve;});
 let completed=false;
 const saving=action.createProduct({projectId:"project",title:"New"}).then(result=>{completed=true;return result;});
 await new Promise(resolve=>setImmediate(resolve));
 try {assert.ok(calls.includes("product-revalidate"));assert.equal(completed,false,"Action returned while async revalidation could run during render");}
 finally {release();await saving;invalidationGate=undefined;}
 assert.equal(completed,true);
 assert.ok(calls.includes("path"));
});
test("real inline Server Action calls only field core and never cache/card invalidation",async()=>{
 calls.length=0;
 const input:ProductPatch={productId:"p",field:"title",value:"New",expectedValue:"Old",clientMutationId:randomUUID()};
 const result=await action.patchProduct(input);assert.equal(result.kind,"saved");assert.deepEqual(calls,["patch-core"]);
});

test("unauthenticated malformed action returns validation without invoking the domain writer",async()=>{
 authenticated=false;calls.length=0;
 try {
  const result=await action.patchProduct(null as unknown as ProductPatch);
  assert.equal(result.kind,"validation");assert.equal('field' in result,false);assert.deepEqual(calls,[]);
 } finally {authenticated=true;}
});
