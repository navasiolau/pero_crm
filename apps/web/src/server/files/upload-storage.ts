import path from "node:path";
import {randomUUID,createHash} from "node:crypto";
import {createWriteStream,fstatSync,type Stats} from "node:fs";
import {mkdir,lstat,realpath,link,unlink} from "node:fs/promises";
import {Transform} from "node:stream";
import {pipeline} from "node:stream/promises";
import {UPLOADS_ROOT,s3PutStream} from "@/lib/s3";
import type {UploadSpoolFile} from "./multipart-upload";
import {UploadError} from "./upload-result";
const HWM=64*1024;
const rejected=new Set(["AccessDenied","InvalidAccessKeyId","SignatureDoesNotMatch","NoSuchBucket"]);
export function knownStorageRejection(value:unknown){
 if(!value||typeof value!=="object"||!("name" in value)||typeof value.name!=="string"||!rejected.has(value.name))return false;
 const metadata="$metadata" in value?value.$metadata:undefined;
 return Boolean(metadata&&typeof metadata==="object"&&"attempts" in metadata&&metadata.attempts===1&&"httpStatusCode" in metadata&&typeof metadata.httpStatusCode==="number"&&metadata.httpStatusCode>=400&&metadata.httpStatusCode<500);
}
const samePath=(a:string,b:string)=>process.platform==="win32"?path.normalize(a).toLowerCase()===path.normalize(b).toLowerCase():a===b;
const sameInode=(a:Stats,b:Stats)=>a.dev===b.dev&&a.ino===b.ino;
const changed=()=>new UploadError("UPLOAD_STORAGE_CHANGED",500,"storage-original","Не удалось подтвердить место хранения загрузки");
async function directoryGuard(directory:string){
 if(!samePath(await realpath(directory),directory)||(await lstat(directory)).isSymbolicLink())throw changed();
 for(let current=directory;path.dirname(current)!==current;current=path.dirname(current))if((await lstat(current)).isSymbolicLink())throw changed();
}
/** ACK только после полного потока; local destination создаётся без перезаписи чужого пути. */
export async function publishUploadOriginal(file:UploadSpoolFile,options:{projectId:string;storedName:string;useS3:boolean;signal?:AbortSignal}){
 if(options.useS3){await s3PutStream(options.projectId+"/"+options.storedName,file,file.type||"application/octet-stream",options.signal);return;}
 const root=path.resolve(UPLOADS_ROOT);
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(options.projectId)||path.basename(options.storedName)!==options.storedName||/[\\/\0]/.test(options.storedName)||[".",".."].includes(options.storedName))throw changed();
 await mkdir(root,{recursive:true});await directoryGuard(root);
 const directory=path.join(root,options.projectId);await mkdir(directory,{recursive:true});await directoryGuard(directory);
 const directoryIdentity=await lstat(directory),destination=path.join(directory,options.storedName),temporary=destination+".pending-"+randomUUID();
 let identity:Stats|undefined,published=false;
 const source=await file.openRead(),output=createWriteStream(temporary,{flags:"wx",mode:0o600,highWaterMark:HWM});
 output.on("open",fd=>{try{identity=fstatSync(fd);}catch{output.destroy(changed());}});
 let bytes=0;const hash=createHash("sha256");
 const measure=new Transform({highWaterMark:HWM,transform(chunk:Buffer,_encoding,callback){bytes+=chunk.length;if(bytes>file.size){callback(changed());return;}hash.update(chunk);callback(null,chunk);}});
 async function tempGuard(){
  await directoryGuard(directory);
  const currentDirectory=await lstat(directory),current=await lstat(temporary);
  if(!identity||!sameInode(currentDirectory,directoryIdentity)||current.isSymbolicLink()||!sameInode(current,identity)||!samePath(await realpath(temporary),temporary))throw changed();
  if(published){const target=await lstat(destination);if(target.isSymbolicLink()||!sameInode(target,identity)||current.nlink!==2||target.nlink!==2)throw changed();}
  else if(current.nlink!==1)throw changed();
 }
 try{
  await pipeline(source,measure,output,{signal:options.signal});
  if(bytes!==file.size||hash.digest("hex")!==file.contentHash)throw changed();
  await tempGuard();
  await link(temporary,destination);published=true;
  await tempGuard();await unlink(temporary);
 }finally{
  source.destroy();output.destroy();
  if(!published&&identity){await tempGuard();await unlink(temporary);}
 }
}
