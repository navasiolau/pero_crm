import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire,Module} from 'node:module';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);
function inject(path:string,exports:Record<string,unknown>){const file=require.resolve(path),stub=new Module(file);stub.filename=file;stub.loaded=true;stub.exports=exports;require.cache[file]=stub;}
inject('next/navigation',{useRouter:()=>({refresh(){throw Error('SSR_REFRESH_FORBIDDEN')}})});
inject('../src/server/files/actions',{deleteFile(){throw Error('SSR_WRITE_FORBIDDEN')}});
(globalThis as unknown as {React:typeof React}).React=React;
const {FileGridView}=require('../src/app/(app)/projects/[id]/files-tab') as typeof import('../src/app/(app)/projects/[id]/files-tab');
const file:import('../src/app/(app)/projects/[id]/files-tab').FileRow={id:'image',fileName:'Длинное имя.png',mimeType:'image/png',section:'MEASUREMENT',canDelete:false};
test('all shared file lists show only original filename and disabled trash without image requests',()=>{
 for(const flat of [false,true]){const html=renderToStaticMarkup(React.createElement(FileGridView,{files:[file],canEdit:false,flat}));assert.match(html,/Длинное имя\.png/);assert.match(html,/aria-label="Удалить файл/);assert.match(html,/disabled=""/);assert.doesNotMatch(html,/preview=|thumb=1|data-file-thumbnail|<img/);}
});
