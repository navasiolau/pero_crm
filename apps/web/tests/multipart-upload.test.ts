import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,readdir,rmdir} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";
import {spoolMultipartUpload} from "../src/server/files/multipart-upload";
import {multipartRequest} from "./helpers/multipart-request";
async function withRoot(fn:(root:string)=>Promise<void>){const root=await mkdtemp(path.join(tmpdir(),"pero-upload-139-unit-"));try{await fn(root);assert.deepEqual(await readdir(root),[]);}finally{await rmdir(root);}}
const hasCode=(pattern:RegExp)=>(value:unknown)=>Boolean(value&&typeof value==="object"&&"code" in value&&typeof value.code==="string"&&pattern.test(value.code));
const hash=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
async function bytes(input:NodeJS.ReadableStream){const parts:Buffer[]=[];for await(const value of input)parts.push(Buffer.from(value));return Buffer.concat(parts);}
test("real parser accepts file-first and split boundaries without full request/file buffering",async()=>{
 await withRoot(async tempRoot=>{
  const original=Buffer.from("original-doc-139"),file=new File([original],"чертёж.b3d",{type:"application/octet-stream"});
  const request=multipartRequest({file,projectId:"project",clientMutationId:"nonce"},{chunkBytes:1});
  request.formData=async()=>{throw Error("FULL_FORM_DATA_FORBIDDEN");};request.arrayBuffer=async()=>{throw Error("FULL_REQUEST_BUFFER_FORBIDDEN");};
  const upload=await spoolMultipartUpload(request,{tempRoot,maxFileBytes:100});
  try{assert.equal(upload.file.name,file.name);assert.equal(upload.file.type,file.type);assert.equal(upload.file.size,original.length);assert.equal(upload.file.contentHash,hash(original));assert.equal(upload.fields.projectId,"project");
   assert.deepEqual(await bytes(await upload.file.openRead()),original);assert.deepEqual(await bytes(await upload.file.openRead()),original);
   await assert.rejects(upload.file.imageBuffer(),hasCode(/UPLOAD_IMAGE_BUFFER_ONLY/));
  }finally{await upload.dispose();}
 });
});
test("inclusive file and metadata limits accept the exact limit and reject one byte/part more",async()=>{
 await withRoot(async tempRoot=>{
  for(const size of [8,9]){
   const request=multipartRequest({file:new File([Buffer.alloc(size)],"qa.dat")},{chunkBytes:1});
   if(size===8){const upload=await spoolMultipartUpload(request,{tempRoot,maxFileBytes:8});assert.equal(upload.file.size,8);await upload.dispose();}
   else await assert.rejects(spoolMultipartUpload(request,{tempRoot,maxFileBytes:8}),hasCode(/UPLOAD_FILE_TOO_LARGE/));
  }
  const exact=Object.fromEntries(Array.from({length:16},(_,i)=>["field"+i,i===0?"x".repeat(4096):"value"]));
  const upload=await spoolMultipartUpload(multipartRequest({...exact,file:new File(["x"],"qa.dat")}),{tempRoot});assert.equal(Object.keys(upload.fields).length,16);await upload.dispose();
  for(const fields of [{field:"x".repeat(4097)},{...exact,extra:"value"},{["x".repeat(101)]:"value"}]){
   await assert.rejects(spoolMultipartUpload(multipartRequest({...fields,file:new File(["x"],"qa.dat")}),{tempRoot}),hasCode(/UPLOAD_MULTIPART_LIMIT/));
  }
 });
});
test("extra files and duplicate target fields are refused and only owned spool is removed",async()=>{
 await withRoot(async tempRoot=>{
  for(const entries of [
   [["file",new File(["x"],"one.dat")],["file",new File(["y"],"two.dat")]],
   [["file",new File(["x"],"one.dat")],["projectId","one"],["projectId","two"]]
  ] as [string,FormDataEntryValue][][]){
   await assert.rejects(spoolMultipartUpload(multipartRequest(entries),{tempRoot}),hasCode(/UPLOAD_MULTIPART_LIMIT|UPLOAD_DUPLICATE_FIELD/));assert.deepEqual(await readdir(tempRoot),[]);
  }
 });
});
test("abort cancels source and closes/removes the fresh private spool",async()=>{
 await withRoot(async tempRoot=>{
  const controller=new AbortController();let cancelled=0,sourceClosed=false;
  const file=new File(["0123456789"],"qa.dat");file.stream=()=>new ReadableStream<Uint8Array<ArrayBuffer>>({pull(c){c.enqueue(new Uint8Array([1]));controller.abort();},cancel(){sourceClosed=true;}},{highWaterMark:0});
  await assert.rejects(spoolMultipartUpload(multipartRequest({file},{signal:controller.signal,onCancel:()=>{cancelled++;}}),{tempRoot}),hasCode(/UPLOAD_ABORTED/));
  assert.equal(sourceClosed,true);assert.equal(cancelled,1);
 });
});

test("fixed multipart header overflow and invalid parser constructor retain no owned temporary directory",async()=>{
 await withRoot(async tempRoot=>{
  const overflow=Buffer.from('--x\r\nContent-Disposition: form-data; name="file"; filename="qa.dat"\r\nX-QA: '+ "x".repeat(16*1024)+'\r\n\r\nx\r\n--x--\r\n');
  await assert.rejects(spoolMultipartUpload(new Request("https://upload.test/api/files/upload",{method:"POST",headers:{"content-type":"multipart/form-data; boundary=x"},body:overflow}),{tempRoot}),hasCode(/UPLOAD_MULTIPART_INVALID/));
  const invalid=multipartRequest({file:new File(["x"],"qa.dat")});invalid.headers.set("content-type","multipart/form-data; boundary=x; broken");
  await assert.rejects(spoolMultipartUpload(invalid,{tempRoot}),hasCode(/UPLOAD_MULTIPART_INVALID/));
 });
});
test("empty document and exact100-byte field name preserve bytes and original name",async()=>{
 await withRoot(async tempRoot=>{
  const upload=await spoolMultipartUpload(multipartRequest({file:new File([],"пустой.dat"),["x".repeat(100)]:"value"}),{tempRoot});
  try{assert.equal(upload.file.size,0);assert.equal(upload.file.contentHash,hash(Buffer.alloc(0)));assert.equal(upload.file.name,"пустой.dat");assert.equal(upload.fields["x".repeat(100)],"value");assert.deepEqual(await bytes(await upload.file.openRead()),Buffer.alloc(0));}
  finally{await upload.dispose();}
 });
});

function rawMultipart(header:string,payload:Buffer,before=""){
 const boundary="compat-139";
 const prefix=before?"--"+boundary+'\r\nContent-Disposition: form-data; name="note"\r\n\r\n'+before+"\r\n":"";
 return {boundary,body:Buffer.concat([Buffer.from(prefix+"--"+boundary+"\r\n"+header+"\r\n\r\n"),payload,Buffer.from("\r\n--"+boundary+"--\r\n")])};
}
function rawRequest(value:{body:Buffer;boundary:string},chunkBytes=1024,split?:number){
 let offset=0;
 const source=new ReadableStream<Uint8Array>({pull(controller){
  if(offset===value.body.length){controller.close();return;}
  const end=split!==undefined&&offset<split?split:Math.min(value.body.length,offset+chunkBytes);
  controller.enqueue(value.body.subarray(offset,end));offset=end;
 }},{highWaterMark:0});
 return new Request("https://upload.test/api/files/upload",{method:"POST",headers:{"content-type":"multipart/form-data; boundary="+value.boundary},body:source,duplex:"half"} as RequestInit&{duplex:"half"});
}
async function nativeFile(value:{body:Buffer;boundary:string}){
 const data=await new Request("https://upload.test/api/files/upload",{method:"POST",headers:{"content-type":"multipart/form-data; boundary="+value.boundary},body:new Uint8Array(value.body)}).formData();
 const file=data.get("file");assert.ok(file instanceof File);return file;
}
test("native MIME parameters, last duplicate header and original folder filename survive every small header split",async()=>{
 await withRoot(async tempRoot=>{
  const headers=[
   'Content-Disposition: form-data; name="file"; filename="folder/чертёж.pdf"\r\nContent-Type: Application/PDF; x-test=abc',
   'Content-Disposition: form-data; name="file"; filename="folder/file.txt"\r\nContent-Type: application/octet-stream\r\nContent-Type: Text/Plain; charset=windows-1251',
   'Content-Disposition: form-data; name="file"; filename="empty-type.dat"\r\nContent-Type:',
   'Content-Disposition: form-data; name="file"; filename="default-type.dat"',
   'Content-Disposition: form-data; name="file"; filename="folder/quote%22name.pdf"\r\nContent-Type: application/pdf',
  ];
  for(const header of headers){
   const value=rawMultipart(header,Buffer.from("\r\n\r\nbody\r\n\r\n--compat-13X\r\n\r\n"),"text\r\n\r\nContent-Type: fake/type\r\n\r\n--compat-13X");
   const reference=await nativeFile(value),original=Buffer.from(await reference.arrayBuffer());
   for(const chunkBytes of [1,2,3,7,64,1024]){
    const request=rawRequest(value,chunkBytes);request.formData=async()=>{throw Error("ORIGINAL_FORM_DATA_FORBIDDEN");};
    const upload=await spoolMultipartUpload(request,{tempRoot});
    try{assert.equal(upload.file.name,reference.name);assert.equal(upload.file.type,reference.type);assert.equal(upload.file.contentHash,hash(original));assert.deepEqual(await bytes(await upload.file.openRead()),original);}
    finally{await upload.dispose();}
   }
  }
 });
});
test("near-16KiB native header and delayed boundary-like payload keep their exact header identity",async()=>{
 await withRoot(async tempRoot=>{
  const header='Content-Disposition: form-data; name="file"; filename="folder/max.pdf"\r\nContent-Type: application/pdf; x-test=last\r\nX-Meta: '+"x".repeat(16200);
  assert.ok(Buffer.byteLength(header)>16000&&Buffer.byteLength(header)<16384);
  const payload=Buffer.from("--compat-13X\r\n\r\nContent-Type: payload/fake\r\n\r\nbody"),value=rawMultipart(header,payload),reference=await nativeFile(value);
  const start=value.body.indexOf(Buffer.from(header)),end=start+Buffer.byteLength(header)+4;
  for(const split of [start-1,start,start+1,end-4,end-3,end-2,end-1,end,end+1,end+2,end+3,end+4]){
   const upload=await spoolMultipartUpload(rawRequest(value,2048,split),{tempRoot});
   try{assert.equal(upload.file.type,reference.type);assert.equal(upload.file.name,reference.name);assert.equal(upload.file.contentHash,hash(payload));assert.deepEqual(await bytes(await upload.file.openRead()),payload);}
   finally{await upload.dispose();}
  }
 });
});
test("base64 hash/size/decoded-byte limits match native whitespace/padding/Unicode/final-quantum semantics",async()=>{
 await withRoot(async tempRoot=>{
  const header='Content-Disposition: form-data; name="file"; filename="folder/encoded.dat"\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64';
  const samples=["SGVsbG8=","SGVs \r\n\tbG8=","SGVsbG8","SGVsbG8===ignored","-_8=","TQŁ=","QUJD😀REVG","A","AA","AAA"];
  for(const sample of samples){
   const value=rawMultipart(header,Buffer.from(sample)),reference=await nativeFile(value),original=Buffer.from(await reference.arrayBuffer());
   for(const chunkBytes of [1,2,3,7]){
    const upload=await spoolMultipartUpload(rawRequest(value,chunkBytes),{tempRoot,maxFileBytes:original.length});
    try{assert.equal(upload.file.name,reference.name);assert.equal(upload.file.type,reference.type);assert.equal(upload.file.size,original.length);assert.equal(upload.file.contentHash,hash(original));assert.deepEqual(await bytes(await upload.file.openRead()),original);}
    finally{await upload.dispose();}
   }
  }
  const original=Buffer.alloc(32*1024,42),encoded=original.toString("base64").match(/.{1,76}/g)!.join("\r\n"),value=rawMultipart(header,Buffer.from(encoded));
  const upload=await spoolMultipartUpload(rawRequest(value,2048),{tempRoot,maxFileBytes:original.length});
  try{assert.equal(upload.file.size,original.length);assert.equal(upload.file.contentHash,hash(original));assert.deepEqual(await bytes(await upload.file.openRead()),original);}
  finally{await upload.dispose();}
  await assert.rejects(spoolMultipartUpload(rawRequest(value,2048),{tempRoot,maxFileBytes:original.length-1}),hasCode(/UPLOAD_FILE_TOO_LARGE/));
 });
});
test("native metadata sidecar contains an empty file and never reads the original request with formData",async()=>{
 await withRoot(async tempRoot=>{
  const value=rawMultipart('Content-Disposition: form-data; name="file"; filename="folder/qa.dat"\r\nContent-Type: text/plain; charset=utf-8',Buffer.from("private-original-payload"));
  const request=rawRequest(value,1024);request.formData=async()=>{throw Error("ORIGINAL_FORM_DATA_FORBIDDEN");};
  const original=Request.prototype.formData;let calls=0;
  Request.prototype.formData=async function(){const fields=await original.call(this),file=fields.get("file");assert.ok(file instanceof File);assert.equal(file.size,0);calls++;return fields;};
  try{const upload=await spoolMultipartUpload(request,{tempRoot});await upload.dispose();assert.equal(calls,1);}
  finally{Request.prototype.formData=original;}
 });
});

test("deterministic native decoded-byte differential covers low8 Unicode, invalid UTF8 and duplicate transfer headers",async()=>{
 await withRoot(async tempRoot=>{
  const data:Buffer[]=Array.from({length:64},(_,index)=>Buffer.from("QUJD"+String.fromCharCode((index*251)%65536)+"REVG"+(index%3?"":"==ignored")));
  data.push(Buffer.concat([Buffer.from("QU"),Buffer.from([0xff,0xc2]),Buffer.from("JD")]));
  const variants=[
   "Content-Transfer-Encoding: binary\r\nContent-Transfer-Encoding: base64",
   "Content-Transfer-Encoding: base64\r\nContent-Transfer-Encoding: binary",
  ];
  for(const encoding of variants){
   for(let index=0;index<data.length;index++){
    const value=rawMultipart('Content-Disposition: form-data; name="file"; filename="fuzz.dat"\r\nContent-Type: application/octet-stream\r\n'+encoding,data[index]);
    const reference=await nativeFile(value),original=Buffer.from(await reference.arrayBuffer());
    const upload=await spoolMultipartUpload(rawRequest(value,index%7+1),{tempRoot,maxFileBytes:original.length});
    try{assert.equal(upload.file.size,original.length);assert.equal(upload.file.contentHash,hash(original));assert.deepEqual(await bytes(await upload.file.openRead()),original);}
    finally{await upload.dispose();}
   }
  }
 });
});
test("ambiguous duplicate disposition cannot bind a different native File identity or publish a spool",async()=>{
 await withRoot(async tempRoot=>{
  const value=rawMultipart('Content-Disposition: form-data; name="file"; filename="first.dat"\r\nContent-Disposition: form-data; name="file"; filename="last.dat"\r\nContent-Type: application/octet-stream',Buffer.from("original"));
  const reference=await nativeFile(value);assert.equal(reference.name,"last.dat");
  await assert.rejects(spoolMultipartUpload(rawRequest(value,1),{tempRoot}),hasCode(/UPLOAD_MULTIPART_INVALID/));
  assert.deepEqual(await readdir(tempRoot),[]);
 });
});

test("abort while native EMPTY metadata is pending is handled before a file pipeline exists",async()=>{
 await withRoot(async tempRoot=>{
  const controller=new AbortController(),value=rawMultipart('Content-Disposition: form-data; name="file"; filename="qa.dat"\r\nContent-Type: application/octet-stream',Buffer.from("original"));
  const request=new Request(rawRequest(value,1024),{signal:controller.signal});
  const original=Request.prototype.formData;
  Request.prototype.formData=async function(){controller.abort();return original.call(this);};
  try{await assert.rejects(spoolMultipartUpload(request,{tempRoot}),hasCode(/UPLOAD_ABORTED/));assert.deepEqual(await readdir(tempRoot),[]);}
  finally{Request.prototype.formData=original;}
 });
});

test("validated quoted multipart boundaries keep native punctuation semantics across chunk cuts",async()=>{
 await withRoot(async tempRoot=>{
  for(const boundary of ["demo,quoted","demo:quoted","demo quoted","demo(quoted)"]){
   const contentType='multipart/form-data; boundary="'+boundary+'"';
   const body=Buffer.from("--"+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="qa.dat"\r\nContent-Type: text/plain; charset=utf-8\r\n\r\noriginal\r\n--'+boundary+"--\r\n");
   const native=await new Request("https://upload.test/api/files/upload",{method:"POST",headers:{"content-type":contentType},body:new Uint8Array(body)}).formData();
   const file=native.get("file");assert.ok(file instanceof File);
   for(const chunkBytes of [1,2,3,7,64,1024]){
    const request=rawRequest({body,boundary},chunkBytes);request.headers.set("content-type",contentType);
    const upload=await spoolMultipartUpload(request,{tempRoot});
    try{assert.equal(upload.file.name,file.name);assert.equal(upload.file.type,file.type);assert.equal(upload.file.contentHash,hash(Buffer.from("original")));assert.deepEqual(await bytes(await upload.file.openRead()),Buffer.from("original"));}
    finally{await upload.dispose();}
   }
  }
 });
});
