import {createReadStream} from 'node:fs';
import {mkdir,realpath,open,rename,stat,unlink} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import {Readable} from 'node:stream';
import {finished} from 'node:stream/promises';

/** Нейтральное содержимое: домен отдельно проверяет key, MIME, права и lifecycle. */
export type FileContentSource={readonly size:number;readonly contentHash:string;openRead:()=>Promise<Readable>};
const within=(root:string,target:string)=>{const relative=path.relative(root,target);return relative!==''&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};

export async function documentLocalPath(rootDirectory:string,storageKey:string,write:boolean,pathFailure:()=>Error){
 const root=path.resolve(rootDirectory),target=path.resolve(root,...storageKey.split('/'));
 if(!within(root,target))throw pathFailure();
 if(write)await mkdir(root,{recursive:true});
 const rootReal=await realpath(root);let directory=rootReal;
 for(const part of storageKey.split('/').slice(0,-1)){
  const next=path.join(directory,part);
  if(write)await mkdir(next).catch((error:NodeJS.ErrnoException)=>{if(error.code!=='EEXIST')throw error;});
  directory=await realpath(next);if(!within(rootReal,directory))throw pathFailure();
 }
 const existing=await realpath(target).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return null;throw error;});
 if(existing&&!within(rootReal,existing))throw pathFailure();return target;
}

/** Собственный wx-pending закрывается до rename; отказ не обнуляет старый оригинал. */
export async function atomicLocalWrite(target:string,content:Uint8Array|FileContentSource){
 const temporary=target+'.'+randomUUID()+'.pending',handle=await open(temporary,'wx');
 let closed=false;
 try{
  if(content instanceof Uint8Array)await handle.writeFile(content);
  else{
   const{size,contentHash}=content;
   if(!Number.isSafeInteger(size)||size<0||!/^([a-f0-9]{64})$/.test(contentHash))throw Error('DOCUMENT_STORAGE_SOURCE_INVALID');
   const source=await content.openRead(),digest=createHash('sha256');let count=0,complete=false;
   try{
    for await(const chunk of source){
     if(!(chunk instanceof Uint8Array))throw Error('DOCUMENT_STORAGE_SOURCE_INVALID');
     count+=chunk.byteLength;if(count>size)throw Error('DOCUMENT_STORAGE_SOURCE_MISMATCH');digest.update(chunk);
     for(let offset=0;offset<chunk.byteLength;){const written=await handle.write(chunk,offset,chunk.byteLength-offset,null);if(written.bytesWritten<=0)throw Error('DOCUMENT_STORAGE_WRITE_FAILED');offset+=written.bytesWritten;}
    }
    if(count!==size||digest.digest('hex')!==contentHash)throw Error('DOCUMENT_STORAGE_SOURCE_MISMATCH');complete=true;
   }finally{source.destroy();if(complete)await finished(source,{cleanup:true});else await finished(source,{cleanup:true}).catch(()=>{});}
  }
  await handle.close();closed=true;await rename(temporary,target);
 }finally{if(!closed)await handle.close();await unlink(temporary).catch((error:NodeJS.ErrnoException)=>{if(error.code!=='ENOENT')throw error;});}
}

export function asWebFileStream(stream:Readable|ReadableStream<Uint8Array>|null){return stream instanceof Readable?Readable.toWeb(stream) as ReadableStream<Uint8Array>:stream;}
export async function openLocalDocument(target:string,expectedSize:number){const info=await stat(target);if(!info.isFile()||info.size!==expectedSize)return null;return asWebFileStream(createReadStream(target));}