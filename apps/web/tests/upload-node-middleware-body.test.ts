import assert from 'node:assert/strict';import test from 'node:test';import {PassThrough} from 'node:stream';import type {IncomingMessage} from 'node:http';import {createRequire,Module} from 'node:module';
const require=createRequire(import.meta.url),authFile=require.resolve('@/auth'),stub=new Module(authFile);stub.filename=authFile;stub.loaded=true;stub.exports={auth:()=>{}};require.cache[authFile]=stub;
const {config}=require('@/middleware') as {config:{matcher:string[]}};
const {getCloneableBody}=require('next/dist/server/body-streams');const {NodeNextRequest}=require('next/dist/server/base-http/node');const {NextRequestAdapter}=require('next/dist/server/web/spec-extension/adapters/next-request');
const matches=(path:string)=>config.matcher.some(pattern=>new RegExp('^'+pattern+'$').test(path));
function request(){return Object.assign(new PassThrough(),{method:'POST',url:'https://upload.test/api/files/upload',headers:{'content-type':'multipart/form-data; boundary=x'}});}
test('installed Next node middleware finalize race reproduces exact pre-handler TypeError',async()=>{
  const input=request(),clone=getCloneableBody(input);clone.cloneBodyStream();input.write(Buffer.alloc(21693,65));await new Promise<void>(resolve=>setImmediate(resolve));const finalize=clone.finalize();
  try{assert.throws(()=>NextRequestAdapter.fromNodeNextRequest(new NodeNextRequest(input as unknown as IncomingMessage),new AbortController().signal),{name:'TypeError',message:'Response body object should not be disturbed or locked'});}finally{input.end();await finalize;}
  const restored=NextRequestAdapter.fromNodeNextRequest(new NodeNextRequest(input as unknown as IncomingMessage),new AbortController().signal);assert.equal((await restored.arrayBuffer()).byteLength,21693);
});
test('only exact upload endpoint bypasses middleware body cloning',()=>{
  assert.equal(matches('/api/files/upload'),false);
  for(const path of ['/api/files/cabcdefghijk012345678901234','/api/files/upload-extra','/api/files/upload/child','/projects','/products','/finance','/api/search'])assert.equal(matches(path),true,path);
});
test('uncloned upload body reaches the real NextRequest adapter intact',async()=>{
  assert.equal(matches('/api/files/upload'),false);
  for(const size of [21693,12605186]){const input=request();input.end(Buffer.alloc(size,65));
    const adapted=NextRequestAdapter.fromNodeNextRequest(new NodeNextRequest(input as unknown as IncomingMessage),new AbortController().signal);assert.equal((await adapted.arrayBuffer()).byteLength,size);}
});
