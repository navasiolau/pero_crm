import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire,Module} from 'node:module';
const require=createRequire(import.meta.url),authFile=require.resolve('@/auth'),stub=new Module(authFile);stub.filename=authFile;stub.loaded=true;stub.exports={auth:()=>{}};require.cache[authFile]=stub;
const {config}=require('@/middleware') as {config:{matcher:string[]}};
const matches=(path:string)=>config.matcher.some(pattern=>new RegExp('^'+pattern+'$').test(path));
test('only exact upload endpoint bypasses middleware body cloning',()=>{
  assert.equal(matches('/api/files/upload'),false);
  for(const path of ['/api/files/cabcdefghijk012345678901234','/api/files/upload-extra','/api/files/upload/child','/projects','/products','/finance','/api/search'])assert.equal(matches(path),true,path);
});
