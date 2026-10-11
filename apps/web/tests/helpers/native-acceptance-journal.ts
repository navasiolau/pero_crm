import assert from 'node:assert/strict';
import {mkdir,realpath,lstat,open} from 'node:fs/promises';
import path from 'node:path';
import type {NativeDeclaration} from './native-acceptance-target';
export async function nativeJournal(input:NativeDeclaration) {
 const root=input.target==='staging'?'/tmp/pero-crm-native163':path.resolve(process.cwd(),'../..','.playwright-mcp','revision-acceptance');
 const directory=path.join(root,input.runId);
 await mkdir(directory,{recursive:true,mode:0o700});
 for(let checked=directory;checked!==path.parse(directory).root;checked=path.dirname(checked))assert.ok(!(await lstat(checked)).isSymbolicLink(),'NATIVE_JOURNAL_REPARSE');
 assert.equal(await realpath(directory),directory,'NATIVE_JOURNAL_PHYSICAL_PATH');
 return async(name:string,value:unknown)=>{
  assert.match(name,/^[a-z0-9.-]+$/,'NATIVE_JOURNAL_FILE_REQUIRED');
  const file=await open(path.join(directory,name+'.json'),'wx',0o600);
  try {await file.writeFile(JSON.stringify(value)+'\n','utf8');await file.sync();}finally{await file.close();}
 };
}
