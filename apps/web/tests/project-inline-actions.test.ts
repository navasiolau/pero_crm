import assert from "node:assert/strict";
import {before,test} from "node:test";
import {createRequire,Module} from "node:module";
import {randomUUID} from "node:crypto";
import type {ProjectPatch} from "../src/server/projects/patch-contract";
const require=createRequire(import.meta.url),calls:string[]=[];
let authenticated=true;let actions:typeof import("../src/server/projects/actions");
function inject(path:string,exports:Record<string,unknown>){const file=require.resolve(path),stub=new Module(file);stub.filename=file;stub.loaded=true;stub.exports=exports;require.cache[file]=stub;}
before(()=>{
 inject("../src/auth",{auth:async()=>authenticated?{user:{id:"m",name:"Manager",roles:["MANAGER"]}}:null});
 inject("next/cache",{revalidatePath:()=>calls.push("refresh"),revalidateTag:()=>calls.push("refresh")});
 inject("../src/server/projects/project-field-core",{patchProjectCore:async(actor:{id:string},input:ProjectPatch)=>{assert.equal(actor.id,"m");calls.push("field-core");return{kind:"saved",field:input.field,value:input.value,clientMutationId:input.clientMutationId};}});
 actions=require("../src/server/projects/actions");
});
test("actual project field action calls only compact core, not legacy update/invalidation",async()=>{
 calls.length=0;const result=await actions.patchProject({projectId:"j",field:"title",value:"New",expectedValue:"Old",clientMutationId:randomUUID()});
 assert.equal(result.kind,"saved");assert.deepEqual(calls,["field-core"]);
});
test("unauthenticated malformed project request does not call domain or invent field",async()=>{
 authenticated=false;calls.length=0;try{const result=await actions.patchProject(null as unknown as ProjectPatch);assert.equal(result.kind,"validation");assert.equal('field'in result,false);assert.deepEqual(calls,[]);}finally{authenticated=true;}
});
