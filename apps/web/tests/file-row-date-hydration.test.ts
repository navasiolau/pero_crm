import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import test from 'node:test';
const code=String.raw`
const {createRequire,Module}=require('node:module');const React=require('react');global.React=React;const{renderToStaticMarkup}=require('react-dom/server');
function inject(name,exports){const file=require.resolve(name),stub=new Module(file);stub.filename=file;stub.loaded=true;stub.exports=exports;require.cache[file]=stub;}
inject('next/navigation',{useRouter:()=>({refresh(){throw Error('FORBIDDEN')}})});inject('./src/server/files/actions',{deleteFile(){throw Error('FORBIDDEN')}});
const{FileGridView}=require('./src/app/(app)/projects/[id]/files-tab');const file={id:'image',fileName:'Image.png',mimeType:'image/png',hasThumb:false,size:10,category:'MEASUREMENT',stage:'PRODUCTION',uploaderName:'Uploader',createdAt:'2026-10-02T21:30:00.000Z'};
const output=[false,true].map(flat=>renderToStaticMarkup(React.createElement(FileGridView,{files:[file],canEdit:false,flat})).match(/\d{2}\.\d{2}\.\d{4}/)?.[0]);console.log(JSON.stringify(output));`;
function renderIn(timeZone:string){return JSON.parse(execFileSync(process.execPath,['node_modules/tsx/dist/cli.mjs','--eval',code],{cwd:process.cwd(),env:{...process.env,TZ:timeZone},encoding:'utf8'}).trim());}
test('actual FileGrid dates match UTC SSR and Moscow client across midnight, flat and product modes',()=>{
 const server=renderIn('UTC'),client=renderIn('Europe/Moscow');assert.deepEqual(server,client);assert.deepEqual(server,['03.10.2026','03.10.2026']);
});
