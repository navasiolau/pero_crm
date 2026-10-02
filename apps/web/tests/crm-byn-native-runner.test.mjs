// Build-only regression: never imports or executes the native DB probe bundle.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
test('real domain native bundle fits reviewed transport budget with real Zod validators retained',()=>{
 const dir=mkdtempSync(join(tmpdir(),'crm-byn-native-build-'));
 try {
  const output=join(dir,'native.mjs');
  const receipt=JSON.parse(execFileSync(process.execPath,[fileURLToPath(new URL('./crm-byn-native-runner.mjs',import.meta.url)),output],{encoding:'utf8'}));
  const bytes=readFileSync(output);
  assert.equal(receipt.dbExecuted,false);assert.equal(receipt.size,bytes.length);assert.ok(bytes.length>0&&bytes.length<=256*1024);
  assert.equal(receipt.sha256,createHash('sha256').update(bytes).digest('hex'));
  assert.ok(receipt.largestInputs.some(input=>input.path.endsWith('/server/payments/core.ts')));
  assert.ok(receipt.largestInputs.some(input=>input.path.endsWith('/server/projects/core.ts')));
  assert.ok(receipt.largestInputs.some(input=>input.path.endsWith('/zod/v4/core/schemas.js')));
  execFileSync(process.execPath,['--check',output]);
 } finally {assert.equal(dirname(resolve(dir)),resolve(tmpdir()));assert.ok(basename(dir).startsWith('crm-byn-native-build-'));rmSync(dir,{recursive:true,force:true});}
});
