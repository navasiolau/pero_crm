import assert from "node:assert/strict";
import {createRequire,Module} from "node:module";
import test from "node:test";
import {multipartRequest} from "./helpers/multipart-request";
const require=createRequire(import.meta.url);
function inject(name:string,exports:Record<string,unknown>){
 const filename=require.resolve(name),stub=new Module(filename);stub.filename=filename;stub.loaded=true;stub.exports=exports;require.cache[filename]=stub;
}
let anonymous=false,allowTarget=false,bodyPulls=0,storageWrites=0,contextReads=0;let roles=["ENGINEER"];
let storedBytes=Buffer.alloc(0);
inject("../src/auth",{auth:async()=>anonymous?null:{user:{id:"engineer",name:"QA",roles:[...roles]}}});
inject("../src/lib/prisma",{prisma:{changeLog:{findUnique:async()=>null}}});
inject("../src/server/files/upload-context",{resolveUploadContext:async()=>{contextReads++;return allowTarget?{project:{id:"j",number:"1"},productId:"p",productNumber:"1.1"}:null;}});
inject("../src/lib/s3",{UPLOADS_ROOT:"unused",s3Enabled:()=>true,s3Put:async()=>{storageWrites++;},s3PutStream:async(_key:string,source:{openRead:()=>Promise<NodeJS.ReadableStream>})=>{storageWrites++;const chunks:Buffer[]=[];for await(const chunk of await source.openRead())chunks.push(Buffer.from(chunk));storedBytes=Buffer.concat(chunks);throw Object.assign(Error("SYNTHETIC_REJECTION"),{name:"AccessDenied",$metadata:{httpStatusCode:403,attempts:1}});},s3Delete:async()=>{},fileKey:(id:string,name:string)=>id+"/"+name,thumbKey:(id:string,name:string)=>id+"/thumbs/"+name+".jpg"});
inject("../src/server/tasks/transaction",{withTaskTransaction:async()=>{throw Error("PUBLICATION_NOT_ALLOWED");}});
inject("../src/server/notifications/notify",{notifyOrg:async()=>{throw Error("NOTIFICATION_NOT_ALLOWED");}});
inject("next/cache",{revalidatePath:()=>{}});
const {POST}=require("../src/app/api/files/upload/route") as typeof import("../src/app/api/files/upload/route");
const nonce="11111111-1111-4111-8111-111111111111";
const fields={projectId:"j",productId:"p",section:"GENERAL",clientMutationId:nonce};
function request(header:string|undefined){
 return multipartRequest({file:new File(["unread"],"qa.pdf",{type:"application/pdf"}),...fields},{contextHeader:header,onPull:()=>{bodyPulls++;}});
}
function reset(){anonymous=allowTarget=false;roles=["ENGINEER"];bodyPulls=storageWrites=contextReads=0;storedBytes=Buffer.alloc(0);}
test("actual handler refuses declared foreign entity before any body pull",async()=>{
 reset();const response=await POST(request(encodeURIComponent(JSON.stringify({version:1,fields}))));
 assert.equal(response.status,404);assert.ok(contextReads>0);assert.equal(bodyPulls,0);assert.equal(storageWrites,0);
});
test("actual handler rejects malformed present context instead of legacy fallback before body",async()=>{
 reset();const response=await POST(request("%malformed"));
 assert.equal(response.status,400);assert.equal(bodyPulls,0);assert.equal(contextReads,0);assert.equal(storageWrites,0);
});
test("anonymous upload retains zero-body refusal for both protocol lanes",async()=>{
 for(const header of [undefined,encodeURIComponent(JSON.stringify({version:1,fields}))]){
  reset();anonymous=true;assert.equal((await POST(request(header))).status,401);
  assert.equal(bodyPulls,0);assert.equal(contextReads,0);assert.equal(storageWrites,0);
 }
});
test("actual document handler uses body/spool/stream publication without formData or whole-body buffer",async()=>{
 reset();allowTarget=true;
 const request=multipartRequest({file:new File(["original-doc-139"],"чертёж.pdf",{type:"application/pdf"}),...fields},{declared:true});
 request.formData=async()=>{throw Error("FULL_FORM_DATA_FORBIDDEN");};
 request.arrayBuffer=async()=>{throw Error("FULL_BODY_BUFFER_FORBIDDEN");};
 const response=await POST(request);
 assert.equal(response.status,500);assert.equal((await response.json()).code,"STORAGE_ACCESS_DENIED");
 assert.equal(storageWrites,1);assert.deepEqual(storedBytes,Buffer.from("original-doc-139"));
});
test("late declared context mismatch refuses both destinations without storage",async()=>{
 reset();allowTarget=true;
 const header=encodeURIComponent(JSON.stringify({version:1,fields}));
 const response=await POST(multipartRequest({file:new File(["doc"],"qa.pdf",{type:"application/pdf"}),...fields,projectId:"changed"},{contextHeader:header}));
 assert.equal(response.status,422);assert.equal((await response.json()).code,"UPLOAD_CONTEXT_MISMATCH");assert.equal(storageWrites,0);
});
test("current role/session and entity ACL are refreshed after streaming before publication",async()=>{
 for(const revoke of [()=>{roles=["ACCOUNTANT"];},()=>{anonymous=true;},()=>{allowTarget=false;}]){
  reset();allowTarget=true;let changed=false;
  const request=multipartRequest({file:new File(["doc"],"qa.pdf",{type:"application/pdf"}),...fields},{declared:true,onPull:()=>{if(!changed){changed=true;revoke();}}});
  const response=await POST(request);assert.ok([404,409].includes(response.status));assert.equal(storageWrites,0);
 }
});
