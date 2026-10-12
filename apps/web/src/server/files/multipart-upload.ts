import busboy from "busboy";
import {createHash} from "node:crypto";
import {createWriteStream,fstatSync,type Stats,type WriteStream} from "node:fs";
import {mkdtemp,lstat,realpath,unlink,rmdir,open} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {Readable,Transform} from "node:stream";
import {StringDecoder} from "node:string_decoder";
import {finished,pipeline} from "node:stream/promises";
import {MIMEType} from "node:util";
import {DOCUMENT_UPLOAD_MAX_BYTES,IMAGE_UPLOAD_MAX_BYTES,uploadSizeLimitFor,uploadSizeLimitError} from "./upload-limits";
import {UploadError} from "./upload-result";
import type {UploadRequestFields} from "@/lib/upload-request-context";
const HWM=64*1024,MAX_INPUT_CHUNK=1024*1024,OVERHEAD=128*1024,HEADER_MAX=16*1024;
const SEPARATOR=Buffer.from("\r\n\r\n");
const error=(code:string,status:number,message:string)=>new UploadError(code,status,"request",message,"validation");
const limit=()=>error("UPLOAD_MULTIPART_LIMIT",413,"Форма загрузки превышает допустимые ограничения");
const invalid=()=>error("UPLOAD_MULTIPART_INVALID",400,"Не удалось прочитать форму загрузки");
const aborted=()=>error("UPLOAD_ABORTED",400,"Загрузка прервана");
const changed=()=>error("UPLOAD_SPOOL_CHANGED",500,"Не удалось подтвердить временный файл загрузки");
const samePath=(a:string,b:string)=>process.platform==="win32"?path.normalize(a).toLowerCase()===path.normalize(b).toLowerCase():a===b;
const sameInode=(a:Stats,b:Stats)=>a.dev===b.dev&&a.ino===b.ino;
export type UploadSpoolFile={
 name:string;type:string;size:number;contentHash:string;
 openRead:()=>Promise<Readable>;imageBuffer:()=>Promise<Buffer>;
};
export type MultipartUpload={fields:UploadRequestFields;file:UploadSpoolFile;dispose:()=>Promise<void>};
export type MultipartBufferQueues={pending:number;parser:number;part:number;transformRead:number;transformWrite:number;fileWrite:number;spoolReaders:number};
type Options={tempRoot?:string;maxFileBytes?:number;onFileField?:(name:string)=>never;observeQueues?:(read:()=>MultipartBufferQueues)=>void};

/** Native parser получает только ограниченный заголовок и ПУСТОЕ тело, никогда исходный файл. */
async function nativeFileMetadata(header:Buffer,boundary:string,contentType:string,event:{name:string}){
 if(header.length>HEADER_MAX||header.includes(SEPARATOR))throw invalid();
 const lines=header.toString("latin1").split("\r\n");
 if(lines.filter(line=>line.slice(0,line.indexOf(":")).toLowerCase()==="content-disposition").length!==1)throw invalid();
 const body=Buffer.concat([Buffer.from("--"+boundary+"\r\n"),header,Buffer.from("\r\n\r\n\r\n--"+boundary+"--\r\n")]);
 if(body.length>17*1024+2*Buffer.byteLength(boundary))throw invalid();
 let form:FormData;
 try{form=await new Request("https://upload-metadata.invalid",{method:"POST",headers:{"content-type":contentType},body}).formData();}
 catch{throw invalid();}
 const entries=[...form],entry=entries[0];
 if(entries.length!==1||!entry||entry[0]!==event.name||!(entry[1] instanceof File)||entry[1].size!==0)throw invalid();
 let encoding="";
 for(const line of lines){
  const colon=line.indexOf(":");
  if(colon>=0&&line.slice(0,colon).toLowerCase()==="content-transfer-encoding")encoding=line.slice(colon+1).replace(/^[ \t]+|[ \t]+$/g,"");
 }
 return {name:entry[1].name,type:entry[1].type,base64:encoding==="base64"};
}

/** Совпадает с native UTF8 string → Buffer.from(base64), включая low8 UTF16 и неполный quantum. */
function nativeBase64Decoder(){
 const utf8=new StringDecoder("utf8");let tail="",stopped=false;
 const valid=(byte:number)=>(byte>=65&&byte<=90)||(byte>=97&&byte<=122)||(byte>=48&&byte<=57)||byte===43||byte===47||byte===45||byte===95;
 function consume(text:string,emit:(value:Buffer)=>void){
  if(stopped)return;
  let chars="";
  const flush=()=>{
   const value=tail+chars,count=value.length-value.length%4;
   if(count)emit(Buffer.from(value.slice(0,count),"base64"));
   tail=value.slice(count);chars="";
  };
  for(let index=0;index<text.length;index++){
   const byte=text.charCodeAt(index)&255;
   if(byte===61){
    const value=tail+chars;if(value)emit(Buffer.from(value,"base64"));
    tail="";stopped=true;return;
   }
   if(valid(byte)){chars+=String.fromCharCode(byte);if(chars.length===8192)flush();}
  }
  flush();
 }
 return new Transform({highWaterMark:HWM,
  transform(chunk:Buffer,_encoding,callback){consume(utf8.write(chunk),value=>this.push(value));callback();},
  flush(callback){consume(utf8.end(),value=>this.push(value));if(!stopped&&tail)this.push(Buffer.from(tail,"base64"));callback();},
 });
}
async function rootGuard(value:string){
 const root=path.resolve(value);
 if(!samePath(await realpath(root),root)||(await lstat(root)).isSymbolicLink())throw changed();
 for(let current=root;path.dirname(current)!==current;current=path.dirname(current))if((await lstat(current)).isSymbolicLink())throw changed();
 return root;
}
/** Один owned spool; документ не превращается в полный Buffer ни при приёме, ни при чтении. */
export async function spoolMultipartUpload(request:Request,options:Options={}):Promise<MultipartUpload>{
 if(request.signal.aborted)throw aborted();
 const contentType=request.headers.get("content-type")??"";
 let boundary:string|undefined;
 try{const mime=new MIMEType(contentType);if(mime.essence!=="multipart/form-data")throw Error();boundary=mime.params.get("boundary")??undefined;}catch{throw error("UPLOAD_MULTIPART_INVALID",400,"Нужна форма multipart/form-data");}
 if(!boundary||Buffer.byteLength(boundary)>200||/[\r\n]/.test(boundary))throw error("UPLOAD_MULTIPART_INVALID",400,"Неверная граница формы загрузки");
 if(!request.body)throw error("UPLOAD_MULTIPART_INVALID",400,"Нужны file и projectId");
 if(options.maxFileBytes!==undefined&&(!Number.isSafeInteger(options.maxFileBytes)||options.maxFileBytes<0||options.maxFileBytes>DOCUMENT_UPLOAD_MAX_BYTES))throw error("UPLOAD_MULTIPART_INVALID",400,"Неверное ограничение загрузки");
 let parser:ReturnType<typeof busboy>;
 try{parser=busboy({headers:{"content-type":contentType},highWaterMark:HWM,fileHwm:HWM,defParamCharset:"utf8",preservePath:true,
  limits:{fileSize:2*DOCUMENT_UPLOAD_MAX_BYTES+OVERHEAD+1,fieldSize:4097,fields:17,files:2,parts:18}});}catch{throw invalid();}
 const root=await rootGuard(options.tempRoot??tmpdir()),directory=await mkdtemp(path.join(root,"pero-crm-upload-"));
 const directoryIdentity=await lstat(directory),filePath=path.join(directory,"upload");
 let fileIdentity:Stats|undefined,output:WriteStream|undefined,outputClosed:Promise<void>|undefined;
 let disposed=false,firstError:unknown,filePipeline:Promise<void>|undefined,fileSetup:Promise<void>|undefined,fileCount=0,fieldCount=0,parts=0,metadataBytes=0,totalBytes=0,size=0;
 let fileName="",mimeType="",fileCap=options.maxFileBytes??DOCUMENT_UPLOAD_MAX_BYTES,wireCap=2*fileCap;
 let partStream:Readable|undefined,measureStream:Transform|undefined;
 const fields:UploadRequestFields=Object.create(null),hash=createHash("sha256"),readers=new Set<Readable>();
 let bodyReader:ReadableStreamDefaultReader<Uint8Array>|undefined,rejectRead:((value:unknown)=>void)|undefined;
 function fail(value:unknown){
  firstError??=value;rejectRead?.(firstError);rejectRead=undefined;
  const failure=value instanceof Error?value:invalid();
  if(!parser.destroyed)parser.destroy(failure);if(output&&!output.destroyed)output.destroy(failure);
 }
 async function directoryGuard(){const current=await lstat(directory);if(current.isSymbolicLink()||!sameInode(current,directoryIdentity)||!samePath(await realpath(directory),directory)||path.dirname(directory)!==root)throw changed();}
 async function fileGuard(expected?:Stats){
  await directoryGuard();const current=await lstat(filePath);
  if(!fileIdentity||current.isSymbolicLink()||!current.isFile()||current.nlink!==1||!sameInode(current,fileIdentity)||!samePath(await realpath(filePath),filePath))throw changed();
  if(expected&&(current.size!==expected.size||current.mtimeMs!==expected.mtimeMs||current.ctimeMs!==expected.ctimeMs))throw changed();
  return current;
 }
 async function dispose(){
  if(disposed)return;
  for(const reader of readers)reader.destroy();
  await Promise.all([...readers].map(reader=>reader.closed?Promise.resolve():new Promise<void>(resolve=>reader.once("close",resolve))));
  await directoryGuard();
  if(fileIdentity){await fileGuard();await unlink(filePath);}
  else{try{await lstat(filePath);throw changed();}catch(value){if(!(value&&typeof value==="object"&&"code" in value&&value.code==="ENOENT"))throw value;}}
  await rmdir(directory);disposed=true;
 }
 parser.on("error",fail);
 const parserFinished=finished(parser,{cleanup:true}).catch(fail);
 parser.on("field",(name,value,info)=>{
  try{
   parts++;fieldCount++;
   const nameBytes=typeof name==="string"?Buffer.byteLength(name):Infinity,valueBytes=Buffer.byteLength(value);
   metadataBytes+=nameBytes+valueBytes;
   if(parts>17||fieldCount>16||nameBytes>100||valueBytes>4096||metadataBytes>64*1024||info.nameTruncated||info.valueTruncated)throw limit();
   if(Object.hasOwn(fields,name))throw error("UPLOAD_DUPLICATE_FIELD",400,"Поле формы загрузки повторяется");
   fields[name]=value;
  }catch(value){fail(value);}
 });
 const ringBound=HEADER_MAX+Buffer.byteLength(boundary)+8,marker=Buffer.from("\r\n--"+boundary+"\r\n"),initialMarker=Buffer.from("--"+boundary+"\r\n");
 let ring:Buffer=Buffer.alloc(0),candidate:Buffer|undefined,offset=0,probeBudget=0;
 parser.on("file",(name,stream)=>{
  partStream=stream;
  // Пока bounded metadata await ещё не создала pipeline, abort/error уже должен иметь listener.
  stream.on("error",fail);
  try{
   parts++;fileCount++;
   if(name!=="file"&&options.onFileField)options.onFileField(name);
   if(parts>17||fileCount>1||name!=="file"||Buffer.byteLength(name)>100)throw limit();
   if(!candidate)throw invalid();
   const header=candidate;candidate=undefined;ring=Buffer.alloc(0);
   fileSetup=nativeFileMetadata(header,boundary!,contentType,{name}).then(metadata=>{
    if(firstError)throw firstError;
    fileName=metadata.name;mimeType=metadata.type;
    const allowed=uploadSizeLimitFor({mimeType});fileCap=Math.min(options.maxFileBytes??allowed.maxBytes,allowed.maxBytes);
    wireCap=fileCap*(metadata.base64?2:1);
    if(totalBytes>wireCap+OVERHEAD)throw limit();
    output=createWriteStream(filePath,{flags:"wx",mode:0o600,highWaterMark:HWM});
    outputClosed=new Promise(resolve=>output!.once("close",resolve));
    output.on("open",fd=>{try{fileIdentity=fstatSync(fd);if(!fileIdentity.isFile()||fileIdentity.nlink!==1)throw changed();}catch(value){fail(value);}});
    output.on("error",fail);
    const measure=new Transform({highWaterMark:HWM,transform(chunk:Buffer,_encoding,callback){
     size+=chunk.length;
     if(size>fileCap){callback(error("UPLOAD_FILE_TOO_LARGE",413,uploadSizeLimitError(allowed.kind)));return;}
     hash.update(chunk);callback(null,chunk);
    }});
    measureStream=measure;
    stream.on("limit",()=>fail(error("UPLOAD_FILE_TOO_LARGE",413,uploadSizeLimitError(allowed.kind))));
    filePipeline=(metadata.base64?pipeline(stream,nativeBase64Decoder(),measure,output):pipeline(stream,measure,output)).catch(fail);
   }).catch(value=>{stream.on("error",()=>{});stream.destroy(value instanceof Error?value:invalid());fail(value);});
  }catch(value){stream.on("error",()=>{});stream.destroy(value instanceof Error?value:undefined);fail(value);}
 });
 for(const name of ["filesLimit","fieldsLimit","partsLimit"] as const)parser.on(name,()=>fail(limit()));
 const abort=()=>{fail(aborted());void bodyReader?.cancel().catch(()=>{});};
 async function write(segment:Buffer){
  offset+=segment.length;
  if(fileCount===0){
   const tail=segment.subarray(-ringBound),keep=Math.max(0,ringBound-tail.length);
   ring=Buffer.concat([ring.subarray(Math.max(0,ring.length-keep)),tail]);
   if(ring.subarray(-4).equals(SEPARATOR)){
    const index=ring.lastIndexOf(marker);
    const start=index>=0?index+marker.length:offset===ring.length&&ring.subarray(0,initialMarker.length).equals(initialMarker)?initialMarker.length:-1;
    const header=start>=0?ring.subarray(start,ring.length-4):undefined;
    candidate=header&&header.length<=HEADER_MAX&&!header.includes(SEPARATOR)?Buffer.from(header):undefined;
    probeBudget=Buffer.byteLength(boundary!)+4;
   }else if(probeBudget>0)probeBudget--;
  }
  await new Promise<void>((resolve,reject)=>parser.write(segment,value=>value?reject(value):resolve()));
  // Событие может задержаться из-за bounded lookbehind. До следующего wire write metadata уже готова.
  if(fileSetup)await fileSetup;
  if(firstError)throw firstError;
 }
 let pending:Buffer=Buffer.alloc(0);
 options.observeQueues?.(()=>({pending:pending.length,parser:parser.writableLength,part:partStream?.readableLength??0,
  transformRead:measureStream?.readableLength??0,transformWrite:measureStream?.writableLength??0,fileWrite:output?.writableLength??0,
  spoolReaders:[...readers].reduce((bytes,reader)=>bytes+reader.readableLength,0)}));
 async function pump(final=false){
  while(pending.length){
   let count:number;
   if(fileCount>0)count=pending.length;
   else if(probeBudget>0)count=1;
   else{
    const cut=pending.indexOf(SEPARATOR);
    if(cut>=0)count=cut+4;
    else{if(!final&&pending.length<=3)break;count=final?pending.length:pending.length-3;}
   }
   const segment=pending.subarray(0,count);pending=pending.subarray(count);await write(segment);
  }
  // Не удерживаем исходный большой chunk ради трёх-byte delimiter tail.
  pending=Buffer.from(pending);
 }
 try{
  bodyReader=request.body.getReader();request.signal.addEventListener("abort",abort,{once:true});
  if(request.signal.aborted)abort();
  while(true){
   if(firstError)throw firstError;
   const next=await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve,reject)=>{
    rejectRead=reject;
    bodyReader!.read().then(value=>{rejectRead=undefined;resolve(value);},value=>{rejectRead=undefined;reject(value);});
   });
   if(next.done)break;
   totalBytes+=next.value.byteLength;
   if(next.value.byteLength>MAX_INPUT_CHUNK||totalBytes>wireCap+OVERHEAD)throw limit();
   const chunk=Buffer.from(next.value.buffer,next.value.byteOffset,next.value.byteLength);
   pending=pending.length?Buffer.concat([pending,chunk]):chunk;await pump();
  }
  await pump(true);parser.end();await parserFinished;await fileSetup;await filePipeline;
  if(firstError)throw firstError;
  if(fileCount!==1||!fileIdentity||!output)throw error("UPLOAD_MULTIPART_INVALID",400,"Нужны file и projectId");
  if(outputClosed)await outputClosed;
  const finalIdentity=await fileGuard();
  if(finalIdentity.size!==size)throw changed();
  const contentHash=hash.digest("hex");
  async function openRead(){
   if(disposed)throw changed();await fileGuard(finalIdentity);
   const handle=await open(filePath,"r");
   try{const actual=await handle.stat();if(!sameInode(actual,finalIdentity)||actual.size!==size||actual.mtimeMs!==finalIdentity.mtimeMs||actual.ctimeMs!==finalIdentity.ctimeMs||actual.nlink!==1)throw changed();
    const reader=handle.createReadStream({highWaterMark:HWM});readers.add(reader);reader.once("close",()=>readers.delete(reader));return reader;
   }catch(value){await handle.close();throw value;}
  }
  const file:UploadSpoolFile={name:fileName,type:mimeType,size,contentHash,openRead,
   async imageBuffer(){
    if(!mimeType.startsWith("image/")||size>IMAGE_UPLOAD_MAX_BYTES)throw error("UPLOAD_IMAGE_BUFFER_ONLY",400,"Полное чтение разрешено только для ограниченного изображения");
    const reader=await openRead(),chunks:Buffer[]=[];let bytes=0;
    for await(const chunk of reader){bytes+=chunk.length;if(bytes>IMAGE_UPLOAD_MAX_BYTES)throw changed();chunks.push(Buffer.from(chunk));}
    return Buffer.concat(chunks,bytes);
   }};
  return {fields,file,dispose};
 }catch(value){
  const failure=request.signal.aborted?aborted():firstError??value;
  fail(failure);await fileSetup;await filePipeline;await parserFinished;if(outputClosed)await outputClosed;
  await dispose();
  if(failure instanceof UploadError)throw failure;
  throw invalid();
 }finally{
  request.signal.removeEventListener("abort",abort);bodyReader?.releaseLock();
 }
}
