// Только существующая статическая карта; измерительный V8 run выведен из эксплуатации.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateMatrix} from './coverage-baseline-core.mjs';

const here=path.dirname(fileURLToPath(import.meta.url)), web=path.resolve(here,'..'), root=path.resolve(web,'../..');
const arguments_=process.argv.slice(2);
assert.ok(arguments_.every(value=>value==='--check'),'COVERAGE_EXPLICIT_CHECK_ONLY');
const matrix=JSON.parse(await readFile(path.join(root,'docs/testing/contract-matrix.json'),'utf8'));
const targets=await validateMatrix(root,matrix);
const package_=JSON.parse(await readFile(path.join(web,'package.json'),'utf8'));
assert.equal(package_.scripts.test,matrix.ci.webEntry,'CI_WEB_ENTRY_CHANGED_REVIEW_REQUIRED');
const tests=(await readdir(here)).filter(file=>/\.test\.(ts|mjs)$/.test(file)).sort();
console.log(JSON.stringify({status:'PASS',scope:'matrix-paths/test-blocks/CI-entry',contracts:matrix.contracts.length,dispositions:matrix.dispositions.length,targets:targets.length,testFiles:tests.length}));
