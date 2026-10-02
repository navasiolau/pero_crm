import sharp from "sharp";
import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { before, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { engineerFixture } from "./helpers/visibility-fixture";
const require=createRequire(import.meta.url);
function inject(name:string,value:Record<string,unknown>){const file=require.resolve(name);const stub=new Module(file);stub.filename=file;stub.loaded=true;stub.exports=value;require.cache[file]=stub;}
let sourceBytes:Uint8Array=new TextEncoder().encode("%PDF-1.4");
const fixture=engineerFixture();let loggedIn=true;let storageReads=0;let route:typeof import("../src/app/api/files/[id]/route");
before(()=>{
 for(const file of fixture.files){file.mimeType="application/pdf";file.fileName="qa18.pdf";file.storedName="qa18.pdf";file.hasThumb=false;file.size=9;}
 (globalThis as {prisma?:PrismaClient}).prisma=fixture.db as unknown as PrismaClient;
 inject("../src/auth",{auth:async()=>loggedIn?{user:{id:"engineer",roles:["ENGINEER"]}}:null});
 inject("../src/lib/s3",{UPLOADS_ROOT:"never-used",s3Enabled:()=>true,fileKey:(p:string,n:string)=>`${p}/${n}`,thumbKey:(p:string,n:string)=>`${p}/thumb/${n}`,s3Get:async()=>{storageReads++;return new ReadableStream({start(controller){controller.enqueue(sourceBytes);controller.close();}});}});
 route=require("../src/app/api/files/[id]/route");
});
const get=(id:string,suffix="")=>route.GET(new Request(`https://example.invalid/api/files/${id}${suffix}`),{params:Promise.resolve({id})});
test("explicit permitted PDF view serves original inline while download remains attachment",async()=>{const visible=fixture.files.find(file=>file.productId==="own")!;const preview=await get(String(visible.id),"?view=1");assert.equal(preview.status,200);assert.match(preview.headers.get("content-disposition")??"",/^inline/);assert.equal(preview.headers.get("content-type"),"application/pdf");assert.equal(preview.headers.get("x-content-type-options"),"nosniff");assert.equal(await preview.text(),"%PDF-1.4");const original=await get(String(visible.id));assert.match(original.headers.get("content-disposition")??"",/^attachment/);});
test("view mode does not inline HTML and does not bypass actor visibility before storage",async()=>{const visible=fixture.files.find(file=>file.productId==="own")!;visible.mimeType="text/html";assert.match((await get(String(visible.id),"?view=1")).headers.get("content-disposition")??"",/^attachment/);visible.mimeType="application/pdf";const reads=storageReads;assert.equal((await get("file-foreign","?view=1")).status,404);assert.equal(storageReads,reads);loggedIn=false;assert.equal((await get(String(visible.id),"?view=1")).status,401);assert.equal(storageReads,reads);loggedIn=true;});

 test("thumbnail GET uses authenticated bounded service and retains byte-exact original download",async()=>{
 const visible=fixture.files.find(file=>file.productId==="own")!;visible.mimeType="image/png";sourceBytes=await sharp({create:{width:600,height:400,channels:3,background:'#4488aa'}}).png().toBuffer();visible.size=sourceBytes.length;
 const thumbnail=await get(String(visible.id),"?preview=thumbnail");assert.equal(thumbnail.status,200);assert.equal(thumbnail.headers.get('content-type'),'image/webp');
 const meta=await sharp(Buffer.from(await thumbnail.arrayBuffer())).metadata();assert.ok(meta.width!<=160&&meta.height!<=160);
 const reads=storageReads;assert.equal((await get('file-foreign','?preview=thumbnail')).status,404);assert.equal(storageReads,reads);
 const original=await get(String(visible.id));assert.deepEqual(Buffer.from(await original.arrayBuffer()),Buffer.from(sourceBytes));assert.match(original.headers.get('content-disposition')??'',/^attachment/);
 });
