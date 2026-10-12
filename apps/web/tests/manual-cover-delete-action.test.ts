import assert from "node:assert/strict";
import {test} from "node:test";
import {createRequire,Module} from "node:module";
import type {SketchResult} from "../src/server/products/sketch-contract";
import type {ProjectCoverResult} from "../src/server/projects/cover-contract";
const require=createRequire(import.meta.url),mutation="00000000-0000-4000-8000-000000000138";
let physical=0,cleanup=0,legacy=false;
const intent={projectId:"project",productId:"product",fileId:"file",storedName:"old.png",hasThumb:true};
const sketch=():SketchResult=>({ok:true,sketchFileId:null,clientMutationId:mutation,...(legacy?{storageIntent:intent}:{cleanupEventId:"file-delete:"+mutation})});
const cover=():ProjectCoverResult=>({ok:true,coverFileId:null,clientMutationId:mutation,...(legacy?{storageIntent:intent}:{cleanupEventId:"file-delete:"+mutation})});
function inject(specifier:string,exports:Record<string,unknown>){const file=require.resolve(specifier),stub=new Module(file);stub.filename=file;stub.loaded=true;stub.exports=exports;require.cache[file]=stub;}
inject("../src/auth",{auth:async()=>({user:{id:"manager",name:"QA138",roles:["MANAGER"]}})});
inject("../src/server/tasks/transaction",{withTaskTransaction:async(work:(tx:unknown)=>Promise<unknown>)=>work({})});
inject("../src/server/products/cover-core",{deleteProductSketchCore:async()=>sketch()});
inject("../src/server/projects/cover-core",{deleteProjectCoverCore:async()=>cover()});
inject("../src/server/files/delete-cleanup",{cleanupDeletedFile:async()=>{cleanup++;return false;}});
inject("../src/server/products/revalidate",{revalidateProductPaths:async()=>{}});
inject("next/cache",{revalidatePath:()=>{}});
inject("../src/lib/s3",{s3Enabled:()=>true,s3Delete:async()=>{physical++;throw Error("QA138_STORAGE_UNAVAILABLE");},fileKey:()=>"key",thumbKey:()=>"thumb"});
const {deleteProductSketchAction}=require("../src/server/products/cover-actions") as typeof import("../src/server/products/cover-actions");
const {deleteProjectCoverAction}=require("../src/server/projects/cover-actions") as typeof import("../src/server/projects/cover-actions");
test("both new manual endpoints keep confirmed metadata success and report pending durable cleanup",async()=>{
 legacy=false;physical=cleanup=0;
 for(const result of [await deleteProductSketchAction({productId:"product",expectedSketchFileId:"file",clientMutationId:mutation}),await deleteProjectCoverAction({projectId:"project",expectedCoverFileId:"file",clientMutationId:mutation})]){
  assert.equal(result.ok,true);if(!result.ok)throw Error("COMMITTED_RESULT_REQUIRED");assert.equal(result.clientMutationId,mutation);assert.equal(result.cleanupPending,true);
 }
 assert.equal(cleanup,2);assert.equal(physical,0);
});
test("compatible legacy success keeps its UUID and needs reconciliation without physical delete",async()=>{
 legacy=true;physical=cleanup=0;
 const before=structuredClone(intent);
 for(const result of [await deleteProductSketchAction({productId:"product",expectedSketchFileId:"file",clientMutationId:mutation}),await deleteProjectCoverAction({projectId:"project",expectedCoverFileId:"file",clientMutationId:mutation})]){
  assert.equal(result.ok,true);if(!result.ok)throw Error("COMMITTED_RESULT_REQUIRED");assert.equal(result.clientMutationId,mutation);assert.equal(result.cleanupPending,true);assert.equal(result.cleanupReconciliation,true);
 }
 assert.equal(cleanup,0);assert.equal(physical,0);assert.deepEqual(intent,before);
});
