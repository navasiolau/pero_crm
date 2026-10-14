import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {canonical,sha} from './helpers/qa-private-primitives.mjs';
import {canonical as warehouseCanonical,sha as warehouseSha} from './warehouse-units-stage-wire.mjs';

test('canonical and SHA exports share one implementation and retain former values',()=>{
 assert.equal(warehouseCanonical,canonical);assert.equal(warehouseSha,sha);
 const value={z:[null,true,0,'Пример'],a:{beta:2,alpha:'01.00'}};
 assert.equal(canonical(value),'\x7b"a":{"alpha":"01.00","beta":2},"z":[null,true,0,"Пример"]}');
 assert.equal(sha(canonical(value)),'0fffa52d18d0fa9989f5a9b5f17eba1f7205d9c747aef99279d41514fb001be6');
 for(const item of [null,false,0,'',undefined])assert.equal(canonical(item),JSON.stringify(item));
 assert.equal(canonical([undefined,,1]),'[, ,1]'.replace(' ',''));
});

test('cold shared-helper import has no file writes, process spawn or network',()=>{
 const helper=new URL('./helpers/qa-private-primitives.mjs',import.meta.url).href;
 const program=`import fs from 'node:fs';import cp from 'node:child_process';import net from 'node:net';import http from 'node:http';import path from 'node:path';import {fileURLToPath} from 'node:url';import {syncBuiltinESMExports} from 'node:module';const fail=()=>{throw Error('COLD_EFFECT_FORBIDDEN');};const originalOpen=fs.openSync;fs.openSync=(file,flags,...rest)=>{if(flags!=='r'||path.resolve(file instanceof URL?fileURLToPath(file):file)!==${JSON.stringify(fileURLToPath(helper))})fail();return originalOpen(file,flags,...rest);};for(const key of ['mkdirSync','writeFileSync','fsyncSync','unlinkSync'])fs[key]=fail;for(const key of ['spawn','spawnSync','execFile','execFileSync'])cp[key]=fail;net.connect=fail;http.request=fail;syncBuiltinESMExports();const m=await import(${JSON.stringify(helper)});if(Object.keys(m).sort().join(',')!=='canonical,declarationHash,evidenceHash,sha')throw Error('EXACT_HELPER_EXPORTS_REQUIRED');console.log('COLD_IMPORT_PASS');`;
 const output=execFileSync(process.execPath,['--input-type=module','-e',program],{encoding:'utf8',timeout:10000,windowsHide:true});
 assert.equal(output,'COLD_IMPORT_PASS\n');
});
