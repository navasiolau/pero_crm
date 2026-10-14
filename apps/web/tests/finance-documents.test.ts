import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID,createHash } from "node:crypto";
import type { FinanceDocument } from "@prisma/client";

import {mkdtemp,mkdir,readFile,readdir,writeFile,symlink,unlink,rmdir,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';import path from 'node:path';import {Readable} from 'node:stream';
import type {LogisticsDocument} from '@prisma/client';
import {guardedModuleCache} from './helpers/guarded-module-cache';
import {atomicLocalWrite,documentLocalPath,type FileContentSource} from '../src/server/files/document-storage';
type StorageRow=Pick<FinanceDocument,'storageMode'|'storageKey'|'mimeType'|'size'>;
async function actualStorageCases(work:(context:{adapters:{kind:string;prefix:string;put:(row:StorageRow,bytes:Buffer|FileContentSource)=>Promise<void>;open:(row:StorageRow)=>Promise<ReadableStream<Uint8Array>|null>}[];base:string;root:string;directories:string[];files:string[];mode:(value:'local'|'s3')=>void;puts:{key:string;bytes:Buffer;mime:string}[];streamPuts:()=>number;get:()=>Buffer|null;set:(value:Buffer|null)=>void})=>Promise<void>){
 const base=await mkdtemp(path.join(tmpdir(),'pero151-')),root=path.join(base,'uploads'),directories=[base,root],files:string[]=[],puts:{key:string;bytes:Buffer;mime:string}[]=[];let mode:'local'|'s3'='local',body:Buffer|null=Buffer.from('s3-owned');
 let streamPuts=0;
 const scope=guardedModuleCache(import.meta.url,{targets:['../src/server/finance-documents/storage','../src/server/logistics/storage'],allowedOverrides:['../src/lib/s3'],overrides:{'../src/lib/s3':{UPLOADS_ROOT:root,storageConfiguration:()=>({mode}),s3Put:async(key:string,bytes:Buffer,mime:string)=>{puts.push({key,bytes:Buffer.from(bytes),mime});},s3PutStream:async(key:string,source:FileContentSource,mime:string)=>{streamPuts++;const parts:Buffer[]=[];for await(const part of await source.openRead())parts.push(Buffer.from(part));const bytes=Buffer.concat(parts);assert.equal(bytes.length,source.size);assert.equal(createHash('sha256').update(bytes).digest('hex'),source.contentHash);puts.push({key,bytes,mime});},s3Get:async()=>body===null?null:Readable.from([body])}},prisma:{}});
 try{await scope.run(async()=>{const finance=scope.load<typeof import('../src/server/finance-documents/storage')>('../src/server/finance-documents/storage').financeDocumentStorage,logistics=scope.load<typeof import('../src/server/logistics/storage')>('../src/server/logistics/storage').logisticsDocumentStorage;await work({adapters:[{kind:'finance-documents',prefix:'FINANCE',put:(row,bytes)=>finance.put(row as FinanceDocument,bytes),open:row=>finance.open(row as FinanceDocument)},{kind:'logistics-documents',prefix:'LOGISTICS',put:(row,bytes)=>logistics.put(row as LogisticsDocument,bytes),open:row=>logistics.open(row as LogisticsDocument)}],base,root,directories,files,mode:value=>{mode=value;},puts,streamPuts:()=>streamPuts,get:()=>body,set:value=>{body=value;}});});}
 finally{assert.equal(await realpath(base),base);for(const file of [...files].reverse()){assert.ok(path.relative(base,file)&&!path.relative(base,file).startsWith('..')&&!path.isAbsolute(path.relative(base,file)));await unlink(file).catch((error:NodeJS.ErrnoException)=>{if(error.code!=='ENOENT')throw error;});}for(const directory of [...directories].reverse())await rmdir(directory).catch((error:NodeJS.ErrnoException)=>{if(error.code!=='ENOENT')throw error;});}
}
const streamed = (bytes: Buffer): FileContentSource => ({ size: bytes.length,
  contentHash: createHash("sha256").update(bytes).digest("hex"), openRead: async () => Readable.from([bytes.subarray(0, 2), bytes.subarray(2)]) });

// Настоящие storage adapters, реальные собственные temp bytes, сетевые/Prisma effects запрещены existing guard161.
test('оба adapters сохраняют bytes/retry и свои key/mode errors, missing/partial не выдаются',async()=>actualStorageCases(async c=>{
 for(const adapter of c.adapters){const id=randomUUID(),key=adapter.kind+'/'+id+'/'+'a'.repeat(64),bytes=Buffer.from('owned151-document'),row:StorageRow={storageMode:'local',storageKey:key,mimeType:'application/pdf',size:bytes.length},target=path.join(c.root,...key.split('/'));c.directories.push(path.join(c.root,adapter.kind),path.join(c.root,adapter.kind,id));c.files.push(target);
  await adapter.put(row,bytes);assert.deepEqual(await readFile(target),bytes);await adapter.put(row,streamed(bytes));const opened=await adapter.open(row);assert.ok(opened);assert.deepEqual(Buffer.from(await new Response(opened).arrayBuffer()),bytes);assert.deepEqual(await readdir(path.dirname(target)),['a'.repeat(64)]);
  assert.equal(await adapter.open({...row,size:bytes.length+1}),null);assert.equal(await adapter.open({...row,storageKey:adapter.kind+'/'+randomUUID()+'/'+'b'.repeat(64)}),null);await assert.rejects(adapter.open({...row,storageKey:adapter.kind+'/'+id+'/'+'b'.repeat(64)}),error=>(error as NodeJS.ErrnoException).code==='ENOENT');
  for(const key of ['../../outside','foreign/'+id+'/'+'a'.repeat(64)])await assert.rejects(adapter.put({...row,storageKey:key},bytes),error=>(error as {code?:string}).code===adapter.prefix+'_STORAGE_KEY_INVALID');await assert.rejects(adapter.open({...row,storageMode:'s3'}),error=>(error as {code?:string}).code===adapter.prefix+'_STORAGE_CHANGED');
 }
}));

test('оба adapters отвергают symlink escape до чтения/записи внешних bytes',async()=>actualStorageCases(async c=>{
 const outside=path.join(c.base,'outside'),victim=path.join(outside,'a'.repeat(64));c.directories.push(outside);c.files.push(victim);await mkdir(outside);await writeFile(victim,'protected151');
 for(const adapter of c.adapters){const directory=path.join(c.root,adapter.kind),link=path.join(directory,randomUUID());c.directories.push(directory);c.files.push(link);await mkdir(directory,{recursive:true});await symlink(outside,link,process.platform==='win32'?'junction':'dir');const row:StorageRow={storageMode:'local',storageKey:adapter.kind+'/'+path.basename(link)+'/'+'a'.repeat(64),mimeType:'application/pdf',size:12};await assert.rejects(adapter.open(row),new RegExp(adapter.prefix+'_STORAGE_PATH_INVALID'));await assert.rejects(adapter.put(row,Buffer.from('replacement')),new RegExp(adapter.prefix+'_STORAGE_PATH_INVALID'));assert.equal(await readFile(victim,'utf8'),'protected151');}
}));

test('оба adapters сохраняют прежние S3 key/MIME/bytes и Node stream/null contracts',async()=>actualStorageCases(async c=>{
 c.mode('s3');for(const adapter of c.adapters){const bytes=Buffer.from('s3-owned'),row:StorageRow={storageMode:'s3',storageKey:adapter.kind+'/'+randomUUID()+'/'+'a'.repeat(64),mimeType:'application/pdf',size:bytes.length};const before=c.streamPuts();await adapter.put(row,bytes);assert.deepEqual(c.puts.at(-1),{key:row.storageKey,bytes,mime:row.mimeType});assert.equal(c.streamPuts(),before);await adapter.put(row,streamed(bytes));assert.equal(c.streamPuts(),before+1);assert.deepEqual(c.puts.at(-1),{key:row.storageKey,bytes,mime:row.mimeType});const stream=await adapter.open(row);assert.ok(stream);assert.deepEqual(Buffer.from(await new Response(stream).arrayBuffer()),bytes);c.set(null);assert.equal(await adapter.open(row),null);c.set(bytes);}
}));

test('общая FileContentSource запись проверяет declared bytes/SHA, rollback и закрытие source для обоих key namespaces',async()=>actualStorageCases(async c=>{
 await mkdir(c.root);for(const adapter of c.adapters){const key=adapter.kind+'/'+randomUUID()+'/'+'a'.repeat(64),target=await documentLocalPath(c.root,key,true,()=>Error('PATH_REFUSED'));c.directories.push(path.dirname(path.dirname(target)),path.dirname(target));c.files.push(target);const old=Buffer.from('previous151'),next=Buffer.from('streamed151-content');await atomicLocalWrite(target,old);
  for(const failure of ['partial','sha','throw'] as const){let closed=false;const stream=Readable.from((async function*(){yield next.subarray(0,3);if(failure==='throw')throw Error('SOURCE_FAILED');if(failure!=='partial')yield next.subarray(3);})());stream.once('close',()=>{closed=true;});const source:FileContentSource={size:next.length,contentHash:failure==='sha'?'b'.repeat(64):createHash('sha256').update(next).digest('hex'),openRead:async()=>stream};await assert.rejects(atomicLocalWrite(target,source),/DOCUMENT_STORAGE_SOURCE_MISMATCH|SOURCE_FAILED/);assert.equal(closed,true);assert.deepEqual(await readFile(target),old);assert.deepEqual(await readdir(path.dirname(target)),['a'.repeat(64)]);}
  let closed=false;const stream=Readable.from([next.subarray(0,2),next.subarray(2)]);stream.once('close',()=>{closed=true;});await atomicLocalWrite(target,{size:next.length,contentHash:createHash('sha256').update(next).digest('hex'),openRead:async()=>stream});assert.equal(closed,true);assert.deepEqual(await readFile(target),next);assert.deepEqual(await readdir(path.dirname(target)),['a'.repeat(64)]);
  await assert.rejects(documentLocalPath(c.root,'../../outside',false,()=>Error('PATH_REFUSED')),/PATH_REFUSED/);
 }
}));
