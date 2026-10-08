import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire,Module} from 'node:module';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {FileImageThumbnail} from '../src/components/file-image-thumbnail';
const require=createRequire(import.meta.url);
function inject(path:string,exports:Record<string,unknown>){const file=require.resolve(path),stub=new Module(file);stub.filename=file;stub.loaded=true;stub.exports=exports;require.cache[file]=stub;}
inject('next/navigation',{useRouter:()=>({refresh(){throw Error('SSR_REFRESH_FORBIDDEN')}})});
inject('../src/server/files/actions',{deleteFile(){throw Error('SSR_WRITE_FORBIDDEN')}});
(globalThis as unknown as {React:typeof React}).React=React;
const {FileGridView}=require('../src/app/(app)/projects/[id]/files-tab') as typeof import('../src/app/(app)/projects/[id]/files-tab');
const file:import('../src/app/(app)/projects/[id]/files-tab').FileRow={id:'image',fileName:'Длинное имя.png',mimeType:'image/png',hasThumb:false,size:40,section:'MEASUREMENT',uploaderName:'Uploader',createdAt:new Date(0).toISOString()};
test('all shared file lists render thumbnail right of filename even without legacy thumb',()=>{
 for(const flat of [false,true]){const html=renderToStaticMarkup(React.createElement(FileGridView,{files:[file],canEdit:false,flat}));assert.match(html,/preview=thumbnail/);assert.ok(html.indexOf('Длинное имя.png')<html.indexOf('data-file-thumbnail'));assert.ok(html.indexOf('Замер')<html.indexOf('data-file-thumbnail'));assert.doesNotMatch(html,/thumb=1/);assert.doesNotMatch(html,/<img[^>]+src="\/api\/files\/image"/);}
});
test('nonimage thumbnail adds no image fetch and filename download/view is unaffected',()=>{const html=renderToStaticMarkup(React.createElement(FileImageThumbnail,{file:{...file,mimeType:'application/pdf'},onOpen(){throw Error('SSR_OPEN_FORBIDDEN')}}));assert.equal(html,'');});
