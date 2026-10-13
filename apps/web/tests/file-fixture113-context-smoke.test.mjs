// Source-only проверки: синтетические снимки, cold import со stub, build без DB/HTTP/S3.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {FROZEN_SOURCES,FROZEN_EXTRA,ADAPTER_AUTORUN,ADAPTER_EXPORTS,derivedFrozenLibrary,bytesHash} from './file-fixture113-context-smoke.mjs';
import {frozenLibraryPlugin} from './file-fixture113-context-smoke-runner.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),require=createRequire(import.meta.url),{build}=createRequire(require.resolve('tsx/package.json'))('esbuild');
// Historical accepted bytes are a synthetic fixture; the current caller legitimately evolved.
const HISTORICAL_PINS={'file-fixture113-entry.mjs':'def45eb010e03daaa6526ac8862c1c752e91c135b022cabcb2fd8bc54f1501fb','file-fixture113-protocol.mjs':'7b1001d102408facba349ce3db4279421dc29d87ade4fb1e6c795751d706fe92','crm-acceptance-token-clock.mjs':'13407f3f719ef7962e2ffb21abb52089e7132b4ec402db87340d9c2fe3b7fc51','file-fixture113-runner.mjs':'b6dd281a1985b841843e4483241fb07dbd33f88cfdf5cdf0996d827823d875fe','file-fixture113-lifecycle-native.mjs':'60105e21a10a856343562aa1e4e12bf4ef33ce6e1872c6573064d9b2252862f0'};
function historicalRead(name){
 assert.ok(Object.hasOwn(HISTORICAL_PINS,name));let text=readFileSync(path.join(here,name),'utf8').replace(/\r?\n/g,'\n');
 if(name==='file-fixture113-runner.mjs'){const line="  if(mode==='delete-ack')delete input.priorObservation;\n";assert.equal(text.split(line).length,2,'exact documented caller evolution only');text=text.replace(line,'');}
 if(['file-fixture113-entry.mjs','crm-acceptance-token-clock.mjs'].includes(name))text=text.replace(/\n/g,'\r\n');
 const bytes=Buffer.from(text);assert.equal(bytesHash(bytes),HISTORICAL_PINS[name],'strict accepted historical byte fixture');return bytes;
}
test('historical producer bytes stay pinned and evolved caller is not silently accepted',()=>{
 assert.deepEqual({...FROZEN_SOURCES,...FROZEN_EXTRA},HISTORICAL_PINS);
 for(const [name,hash]of Object.entries(HISTORICAL_PINS))assert.equal(bytesHash(historicalRead(name)),hash);
 assert.notEqual(bytesHash(readFileSync(path.join(here,'file-fixture113-runner.mjs'))),HISTORICAL_PINS['file-fixture113-runner.mjs']);
});
test('adapter removes exactly the final autorun and adds a private export allowlist',()=>{
 const bytes=historicalRead('file-fixture113-entry.mjs'),text=bytes.toString('utf8'),library=derivedFrozenLibrary(bytes);
 assert.equal(text.split(ADAPTER_AUTORUN).length,2);assert.ok(!library.includes(ADAPTER_AUTORUN));
 assert.equal(library,text.slice(0,text.indexOf(ADAPTER_AUTORUN))+'\nexport {'+ADAPTER_EXPORTS.join(',')+'};\n');
 assert.equal(bytesHash(historicalRead('file-fixture113-entry.mjs')),FROZEN_SOURCES['file-fixture113-entry.mjs']);
});
test('adapter refuses changed source even when its autorun still matches',()=>{
 const bytes=historicalRead('file-fixture113-entry.mjs');assert.throws(()=>derivedFrozenLibrary(Buffer.concat([bytes,Buffer.from(' ')])),/FROZEN_ENTRY_BYTES_CHANGED/);
});
test('cold library import under stdin/staging input has no autorun/client/fetch',async()=>{
 const stubs={name:'cold-only-stubs',setup(builder){
  builder.onResolve({filter:/^(@prisma\/client|@aws-sdk\/client-s3|@auth\/core\/jwt|sharp)$/},args=>({path:args.path,namespace:'cold-only'}));
  builder.onLoad({filter:/.*/,namespace:'cold-only'},args=>{
   const stop="throw Error('COLD_IMPORT_RUNTIME_CONSTRUCTION');";
   const contents=args.path==='@prisma/client'?'export class PrismaClient{constructor(){'+stop+'}}':
    args.path==='@auth/core/jwt'?'export function encode(){'+stop+'}':
    args.path==='sharp'?'export default function sharp(){'+stop+'}':
    ['S3Client','ListObjectVersionsCommand','GetObjectCommand','DeleteObjectCommand'].map(name=>'export class '+name+'{constructor(){'+stop+'}}').join('\n');
   return {contents,loader:'js'};
  });
 }};
 const result=await build({stdin:{contents:"import * as library from 'task113:frozen-library'; if(typeof library.original!=='function'||typeof library.cookies!=='function')throw Error('MISSING_LIBRARY');console.log('COLD_IMPORT_INERT');",resolveDir:here,sourcefile:'context-cold-unit.mjs'},bundle:true,write:false,platform:'node',format:'esm',target:'node22',treeShaking:false,plugins:[frozenLibraryPlugin(historicalRead),stubs],define:{__FIXTURE_SOURCE_HASHES__:JSON.stringify(FROZEN_SOURCES)},banner:{js:"process.argv[1]=undefined;globalThis.fetch=()=>{throw Error('COLD_IMPORT_FETCH');};"},logLevel:'silent'});
 const cold=spawnSync(process.execPath,['--input-type=module'],{input:result.outputFiles[0].contents,encoding:'utf8',timeout:20000,windowsHide:true,env:{...process.env,CRM_MODERNIZATION_TARGET:'staging',CRM_STAGING_BROWSER_INPUT:Buffer.from('{"authorized":true}').toString('base64')}});
 assert.equal(cold.status,0,cold.stderr);assert.equal(cold.stdout.trim(),'COLD_IMPORT_INERT');assert.equal(cold.stderr,'');
});
