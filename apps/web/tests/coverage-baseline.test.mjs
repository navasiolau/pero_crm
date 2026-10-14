import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';

test('a modified matrix cannot read an owner document before checking the path',async()=>{
  const {validateMatrix}=await import('./coverage-baseline-core.mjs');
  const matrix={schemaVersion:1,contracts:[{id:'bad-path',domain:'acl',requirement:'guard',productionModules:[],tests:[{file:'../../owner.txt',block:'private',evidenceLevel:'DI'}],acceptance:[],gapTasks:[]}],dispositions:[]};
  await assert.rejects(validateMatrix(path.resolve('.'),matrix),/MATRIX_PATH_OUTSIDE_ROOT/);
});
