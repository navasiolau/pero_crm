import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire,Module} from 'node:module';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);
function inject(name:string,exports:Record<string,unknown>){const file=require.resolve(name),stub=new Module(file);stub.filename=file;stub.loaded=true;stub.exports=exports;require.cache[file]=stub;}
let refreshes=0;inject('next/navigation',{useRouter:()=>({refresh(){refreshes++}})});
inject('../src/components/product-inline-provider',{useProductInline:()=>({registerGuard:()=>()=>{}})});
inject('../src/server/files/actions',{deleteFile(){throw Error('DELETE_FORBIDDEN')}});
Object.assign(globalThis,{React});
const{ProductMeasurement}=require('../src/components/product-attachments') as typeof import('../src/components/product-attachments');
const{Uploader}=require('../src/app/(app)/projects/[id]/files-tab') as typeof import('../src/app/(app)/projects/[id]/files-tab');
test('actual measurement header contains title and single file trigger without duplicated photo control',()=>{
 const html=renderToStaticMarkup(React.createElement(ProductMeasurement,{projectId:'project',productId:'product',files:[],canEdit:true}));const header=html.match(/<header[^>]*>([\s\S]*?)<\/header>/)?.[1];assert.ok(header);assert.match(header,/<h2[^>]*>Замер/);assert.match(header,/Загрузить файл/);assert.equal((html.match(/Загрузить файл/g)??[]).length,1);assert.doesNotMatch(html,/Снять фото|Фото \(/);assert.ok(header.indexOf('Замер')<header.indexOf('Загрузить файл'));
});
test('readonly measurement keeps heading and no upload control',()=>{
 const html=renderToStaticMarkup(React.createElement(ProductMeasurement,{projectId:'project',productId:'product',files:[],canEdit:false}));assert.match(html,/Замер/);assert.doesNotMatch(html,/Загрузить файл|type="file"|Снять фото/);
});
test('actual file input sends fixed measurement with exact product project section CID and originalbytes',async()=>{
 const react=require('react') as typeof React,original={useState:react.useState,useRef:react.useRef,useTransition:react.useTransition},oldFetch=globalThis.fetch;let posted:FormData|undefined;let pending:Promise<unknown>|undefined;const busy:boolean[]=[];
 react.useState=((value:unknown)=>[value,()=>{}]) as never;react.useRef=((value:unknown)=>({current:value})) as never;react.useTransition=(()=>[false,(callback:()=>unknown)=>{pending=Promise.resolve(callback());}]) as never;
 globalThis.fetch=(async(_url:unknown,request?:RequestInit)=>{posted=request!.body as FormData;return new Response(JSON.stringify({ok:true,id:'cmu49ownedfile',clientMutationId:posted.get('clientMutationId')}),{status:200,headers:{'Content-Type':'application/json','X-Request-Id':'request49'}});}) as typeof fetch;
 try{
 const tree=Uploader({projectId:'project',productId:'product',section:'MEASUREMENT',canEdit:true,onBusyChange:value=>busy.push(value)});
 function find(node:unknown):React.ReactElement<Record<string,unknown>>|undefined {if(!React.isValidElement(node))return;const e=node as React.ReactElement<Record<string,unknown>>;if(e.type==='input'&&e.props.type==='file')return e;for(const child of React.Children.toArray(e.props.children as React.ReactNode)){const result=find(child);if(result)return result;}}
 const input=find(tree);assert.ok(input);const file=new File([new Uint8Array([1,2,3,4])],'measurement.png',{type:'image/png'});(input.props.onChange as (event:unknown)=>void)({target:{files:[file],value:'selected'}});await pending;
 assert.ok(posted);assert.equal(posted.get('section'),'MEASUREMENT');assert.equal(posted.get('projectId'),'project');assert.equal(posted.get('productId'),'product');assert.equal(posted.get('stage'),null);assert.equal(posted.get('category'),null);assert.match(String(posted.get('clientMutationId')),/^[a-f0-9-]{36}$/);assert.deepEqual(new Uint8Array(await (posted.get('file') as File).arrayBuffer()),new Uint8Array(await file.arrayBuffer()));assert.deepEqual(busy,[true,false]);assert.equal(refreshes,1);
 }finally{Object.assign(react,original);globalThis.fetch=oldFetch;}
});
