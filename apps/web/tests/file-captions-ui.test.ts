import assert from 'node:assert/strict';
import {createRequire,Module} from 'node:module';
import test from 'node:test';
import * as React from 'react';
import {createElement} from 'react';
Object.assign(globalThis,{React});
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);
function inject(name:string,exports:Record<string,unknown>){const file=require.resolve(name),stub=new Module(file);stub.filename=file;stub.loaded=true;stub.exports=exports;require.cache[file]=stub;}
inject('next/navigation',{useRouter:()=>({refresh:()=>{}})});inject('../src/components/file-viewer',{useFileViewer:()=>({open:()=>{}})});inject('../src/server/files/actions',{deleteFile:async()=>({ok:true})});
const {FileGridView,Uploader}=require('../src/app/(app)/projects/[id]/files-tab') as typeof import('../src/app/(app)/projects/[id]/files-tab');
test('sharedfile galleries/documents/projectflat usefilename evenwhenlegacycaption supplied',()=>{
 const files=[{id:'photo',fileName:'photo-original.png',caption:'OLD_PRIVATE_CAPTION',section:'PRODUCTION',mimeType:'image/png',size:50,hasThumb:true,createdAt:'2026-10-02T00:00:00Z',uploaderName:'QA'},{id:'document',fileName:'document-original.pdf',caption:'OLD_PRIVATE_CAPTION',section:'PRODUCTION',mimeType:'application/pdf',size:50,hasThumb:false,createdAt:'2026-10-02T00:00:00Z',uploaderName:'QA'}];const original=structuredClone(files);
 for(const flat of [false,true]){const html=renderToStaticMarkup(createElement(FileGridView,{files:files as never,canEdit:false,flat}));assert.ok(html.includes('photo-original.png'));assert.ok(html.includes('document-original.pdf'));assert.ok(!html.includes('OLD_PRIVATE_CAPTION'));}
 assert.deepEqual(files,original);
});
test('sharedUploader hasnocaptioninput without category/caption controls',()=>{const html=renderToStaticMarkup(createElement(Uploader,{projectId:'p',canEdit:true}));assert.ok(html.includes('type="file"'));assert.ok(!html.includes('Пояснение'));assert.ok(!html.includes('не обязательно'));assert.ok(!html.includes('Категория'));});
