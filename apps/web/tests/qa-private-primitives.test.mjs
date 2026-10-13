import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {gzipSync,gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {canonical,sha,checkAncestors,durableWrite} from './helpers/qa-private-primitives.mjs';
import {canonical as warehouseCanonical,sha as warehouseSha,encodeStageWire,checkedDirectory} from './warehouse-units-stage-wire.mjs';
import {technicalCanonical,encodeFunctionalWire} from './product-draft-stage-wire.mjs';
import {makeTechnicalStore as draftStore} from './product-draft-stage-runner.mjs';

// Только собственные локальные технические файлы. БД, HTTP и браузер не вызываются.
const here=path.dirname(fileURLToPath(import.meta.url)),results=path.resolve(here,'../test-results');
function withFs(overrides,work){
 const originals=Object.fromEntries(Object.keys(overrides).map(key=>[key,fs[key]]));
 try{Object.assign(fs,overrides);syncBuiltinESMExports();return work();}
 finally{Object.assign(fs,originals);syncBuiltinESMExports();}
}
function ownedFiles(work){
 const directory=path.join(checkedDirectory(results),'qa162-'+randomUUID());
 fs.mkdirSync(directory,{recursive:false});
 try{return work(directory);}
 finally{
  assert.equal(fs.lstatSync(directory).isSymbolicLink(),false);
  for(const name of fs.readdirSync(directory)){
   const file=path.join(directory,name);assert.equal(path.dirname(file),directory);
   const info=fs.lstatSync(file);assert.ok(info.isFile()||info.isSymbolicLink());if(info.isSymbolicLink()&&process.platform==='win32')fs.rmdirSync(file);else fs.unlinkSync(file);
  }
  fs.rmdirSync(directory);
 }
}

test('canonical and SHA exports share one implementation and retain former values',()=>{
 assert.equal(warehouseCanonical,canonical);assert.equal(technicalCanonical,canonical);assert.equal(warehouseSha,sha);
 const value={z:[null,true,0,'Пример'],a:{beta:2,alpha:'01.00'}};
 assert.equal(canonical(value),'\x7b"a":{"alpha":"01.00","beta":2},"z":[null,true,0,"Пример"]}');
 assert.equal(sha(canonical(value)),'0fffa52d18d0fa9989f5a9b5f17eba1f7205d9c747aef99279d41514fb001be6');
 for(const item of [null,false,0,'',undefined])assert.equal(canonical(item),JSON.stringify(item));
 assert.equal(canonical([undefined,,1]),'[, ,1]'.replace(' ',''));
});

// В frozen Windows fixtures служебный gzip OS byte9=10; Unix Node/zlib использует3.
// Только этот байт адаптируется к той же платформе; header/payload/CRC/ISIZE остаются точными.
const stageFrozen='H4sIAAAAAAAACqtWSlSyqlZKzCnISFSyUjIw1DMwUNJRSkotSVSyMqrVUapSsorOK83J0SkpKk3VMdBRujD/YsOFHRf2XNh6sUEpthYAJv8vZUEAAAA=';
const draftFrozen='H4sIAAAAAAACCqtWSlSyqlZKzCnISFSyUjIw1DMwUNJRSkotSVSyMqrVUapSsorOK83J0SkpKk3VMdBRujD/YsOFHRf2XNh6sUEpthYAJv8vZUEAAAA=';
function assertFrozenGzip(actual,frozen,os=process.platform==='win32'?10:3){
 assert.ok(os===3||os===10,'KNOWN_GZIP_OS_REQUIRED');assert.equal(actual[9],os,'SAME_PLATFORM_GZIP_OS');
 const expected=Buffer.from(frozen,'base64');assert.equal(expected[9],10);expected[9]=os;
 assert.deepEqual(actual,expected,'EXACT_GZIP_BYTES_EXCEPT_DECLARED_OS');
}
test('both former wire descriptors retain same-platform exact bytes including different gzip levels',()=>{
 const value={z:[null,true,0,'Пример'],a:{beta:2,alpha:'01.00'}},hash='0fffa52d18d0fa9989f5a9b5f17eba1f7205d9c747aef99279d41514fb001be6';
 const formerBytes=Buffer.from('{"a":{"alpha":"01.00","beta":2},"z":[null,true,0,"Пример"]}');
 assert.equal(formerBytes.length,65);assert.equal(sha(formerBytes),hash);
 const formerStage=gzipSync(formerBytes),formerDraft=gzipSync(formerBytes,{level:9});
 const stage=encodeStageWire(value),draft=encodeFunctionalWire(value);
 assert.deepEqual(stage,{kind:'warehouse-unit-stage-wire',version:1,encoding:'gzip-base64',bytes:65,sha256:hash,data:formerStage.toString('base64')});
 assert.deepEqual(draft,{kind:'product-draft-stage-wire',version:1,encoding:'gzip-base64',decodedBytes:65,decodedSha256:hash,data:formerDraft.toString('base64')});
 const stageBytes=Buffer.from(stage.data,'base64'),draftBytes=Buffer.from(draft.data,'base64');
 assertFrozenGzip(stageBytes,stageFrozen);assertFrozenGzip(draftBytes,draftFrozen);
 assert.equal(stageBytes[8],0);assert.equal(draftBytes[8],2); // default и level9 сохраняют различие XFL.
 for(const bytes of [stageBytes,draftBytes]){const decoded=gunzipSync(bytes);assert.deepEqual(decoded,formerBytes);assert.equal(decoded.length,65);assert.equal(sha(decoded),hash);}
});
test('gzip fixture accepts only declared OS adaptation and rejects changed header/payload/trailer bytes',()=>{
 for(const frozen of [stageFrozen,draftFrozen])for(const os of [3,10]){
  const expected=Buffer.from(frozen,'base64');expected[9]=os;assertFrozenGzip(expected,frozen,os);
  for(const offset of [0,3,4,8,10,expected.length-8,expected.length-1]){const changed=Buffer.from(expected);changed[offset]^=1;assert.throws(()=>assertFrozenGzip(changed,frozen,os));}
  const otherOs=Buffer.from(expected);otherOs[9]=os===3?10:3;assert.throws(()=>assertFrozenGzip(otherOs,frozen,os),/SAME_PLATFORM_GZIP_OS/);
  const unknownOs=Buffer.from(expected);unknownOs[9]=255;assert.throws(()=>assertFrozenGzip(unknownOs,frozen,os),/SAME_PLATFORM_GZIP_OS/);
 }
});

test('ancestor policies retain inclusive, exclusive, case-fold and filesystem-root boundaries',()=>{
 const root=path.parse(results).root,target=path.join(results,'own','missing'),seen=[];
 withFs({existsSync:p=>{seen.push(p);return true;},lstatSync:()=>({isSymbolicLink:()=>false})},()=>{
  checkAncestors(target,results,true,'REPARSE','ROOT');assert.deepEqual(seen,[target,path.dirname(target),results]);
  seen.length=0;checkAncestors(target,results,false,'REPARSE','ROOT');assert.deepEqual(seen,[target,path.dirname(target)]);
  seen.length=0;checkAncestors(target,results.toUpperCase(),false,'REPARSE','ROOT',value=>value.toLowerCase());assert.deepEqual(seen,[target,path.dirname(target)]);
  seen.length=0;checkAncestors(target,null,true,'REPARSE');assert.equal(seen.at(-1),root);
 });
});

test('ancestor rejection stops at exact family error before creating anything',()=>{
 let mkdirCalls=0;
 withFs({existsSync:()=>true,lstatSync:()=>({isSymbolicLink:()=>true}),mkdirSync:()=>{mkdirCalls++;}},()=>{
  assert.throws(()=>checkedDirectory(path.join(results,'blocked')),/^Error: TECHNICAL_REPARSE_FORBIDDEN$/);
  assert.throws(()=>checkAncestors(results,null,true,'FAMILY_REPARSE'),/^Error: FAMILY_REPARSE$/);
 });
 assert.equal(mkdirCalls,0);
 withFs({existsSync:()=>false},()=>assert.throws(()=>checkAncestors(results,path.join(results,'missing-stop'),true,'LINK','FAMILY_ROOT'),/^Error: FAMILY_ROOT$/));
});

test('durable write preserves flags, mode0600 and write/fsync/close order',()=>{
 for(const flags of ['wx','a']){
  const calls=[];
  withFs({openSync:(file,actualFlags,mode)=>{calls.push(['open',file,actualFlags,mode]);return 17;},writeFileSync:(fd,bytes)=>calls.push(['write',fd,bytes]),fsyncSync:fd=>calls.push(['fsync',fd]),closeSync:fd=>calls.push(['close',fd])},()=>durableWrite('own',Buffer.from('own\n'),flags));
  assert.deepEqual(calls,[['open','own',flags,0o600],['write',17,Buffer.from('own\n')],['fsync',17],['close',17]]);
 }
});

test('write and fsync faults always close the opened descriptor; open fault never closes',()=>{
 for(const failure of ['open','write','fsync']){
  const calls=[],error=Error('OWN_'+failure);
  const operation=name=>(...args)=>{calls.push([name,...args]);if(name===failure)throw error;return 17;};
  withFs({openSync:operation('open'),writeFileSync:operation('write'),fsyncSync:operation('fsync'),closeSync:operation('close')},()=>assert.throws(()=>durableWrite('own',Buffer.from('x')),value=>value===error));
  assert.equal(calls.some(([name])=>name==='close'),failure!=='open');
  if(failure!=='open')assert.equal(calls.at(-1)[0],'close');
 }
});

test('draft private root and foreign paths fail before file creation; artifact stays after ledger fault',()=>ownedFiles(directory=>{
 assert.throws(()=>draftStore(results),/^Error: DRAFT111_PRIVATE_RESULTS_PATH$/);
 assert.throws(()=>draftStore(path.dirname(results)),/^Error: DRAFT111_PRIVATE_RESULTS_PATH$/);
 const store=draftStore(directory),originalOpen=fs.openSync;
 withFs({openSync:(file,...rest)=>{if(file===path.join(directory,'ledger.jsonl'))throw Error('OWN_LEDGER_OPEN_FAILED');return originalOpen(file,...rest);}},()=>assert.throws(()=>store.put('pre',{kind:'pre',value:'own'}),/OWN_LEDGER_OPEN_FAILED/));
 assert.deepEqual(fs.readdirSync(directory),['0000-pre.json']);
 assert.equal(draftStore(directory).has('pre'),false);
 assert.throws(()=>draftStore(directory).put('pre',{kind:'pre',value:'different'}),{code:'EEXIST'});
 assert.equal(fs.readFileSync(path.join(directory,'0000-pre.json'),'utf8'),'{"kind":"pre","value":"own"}\n');
}));

test('draft symlink artifact refuses changed path before ledger append',()=>ownedFiles(directory=>{
 const store=draftStore(directory),artifact=path.join(directory,'0000-pre.json');
 fs.symlinkSync(results,artifact,process.platform==='win32'?'junction':'dir');
 assert.throws(()=>store.put('pre',{kind:'pre'}),/^Error: DRAFT111_PRIVATE_REPARSE_POINT$/);
 assert.equal(fs.lstatSync(artifact).isSymbolicLink(),true);assert.equal(fs.existsSync(path.join(directory,'ledger.jsonl')),false);
}));

test('new shared dependency remains explicitly pinned by the retained draft runner',()=>{
 const draft=fs.readFileSync(path.join(here,'product-draft-stage-runner.mjs'),'utf8');
 assert.match(draft,/SOURCE_FILES=\[[^\]]*'helpers\/qa-private-primitives\.mjs'/);
 assert.equal(draft.includes('SOURCE_FILES.map(name=>[name,sha(readFileSync(path.join(here,name)))])'),true);
});

test('cold shared-helper import has no file writes, process spawn or network',()=>{
 const helper=new URL('./helpers/qa-private-primitives.mjs',import.meta.url).href;
 const program=`import fs from 'node:fs';import cp from 'node:child_process';import net from 'node:net';import http from 'node:http';import path from 'node:path';import {fileURLToPath} from 'node:url';import {syncBuiltinESMExports} from 'node:module';const fail=()=>{throw Error('COLD_EFFECT_FORBIDDEN');};const originalOpen=fs.openSync;fs.openSync=(file,flags,...rest)=>{if(flags!=='r'||path.resolve(file instanceof URL?fileURLToPath(file):file)!==${JSON.stringify(fileURLToPath(helper))})fail();return originalOpen(file,flags,...rest);};for(const key of ['mkdirSync','writeFileSync','fsyncSync','unlinkSync'])fs[key]=fail;for(const key of ['spawn','spawnSync','execFile','execFileSync'])cp[key]=fail;net.connect=fail;http.request=fail;syncBuiltinESMExports();const m=await import(${JSON.stringify(helper)});if(Object.keys(m).sort().join(',')!=='canonical,checkAncestors,declarationHash,durableWrite,evidenceHash,sha')throw Error('EXACT_HELPER_EXPORTS_REQUIRED');console.log('COLD_IMPORT_PASS');`;
 const output=execFileSync(process.execPath,['--input-type=module','-e',program],{encoding:'utf8',timeout:10000,windowsHide:true});
 assert.equal(output,'COLD_IMPORT_PASS\n');
});
