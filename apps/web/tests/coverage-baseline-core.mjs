// Статическая карта контрактов; runtime PASS подтверждается отдельным фактическим evidence.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const levels = new Set(['unit','DI','SSR','source-guard','Chromium-component','native-PostgreSQL','HTTP-runtime','staging-browser','device']);

function checkedPath(root,file) {
  assert.ok(typeof file==='string' && !path.isAbsolute(file) && !file.split(/[\\/]/).includes('..'),'MATRIX_PATH_OUTSIDE_ROOT');
  assert.ok(file.startsWith('apps/web/src/') || file.startsWith('apps/web/tests/'),'MATRIX_PATH_NOT_SOURCE_OR_TEST');
  return path.join(root,file);
}

export async function validateMatrix(root, matrix) {
  assert.equal(matrix.schemaVersion, 1, 'MATRIX_VERSION_INVALID');
  const domains = new Set(), ids = new Set(), files = new Set();
  for (const row of matrix.contracts) {
    assert.ok(!ids.has(row.id) && row.requirement, 'CONTRACT_ID_REQUIREMENT_INVALID');
    ids.add(row.id); domains.add(row.domain);
    assert.ok(row.tests.length || row.gapTasks.length, 'UNEXPLAINED_TEST_GAP');
    for (const file of row.productionModules) files.add(file);
    for (const test of row.tests) {
      assert.ok(levels.has(test.evidenceLevel), 'EVIDENCE_LEVEL_INVALID');
      files.add(test.file);
      if (test.block) assert.ok((await readFile(checkedPath(root, test.file),'utf8')).includes(test.block), 'TEST_BLOCK_NOT_FOUND: '+row.id);
    }
    for (const proof of row.acceptance) {
      assert.ok(levels.has(proof.evidenceLevel), 'ACCEPTANCE_LEVEL_INVALID');
      assert.ok(['NOT_RUN','BLOCKED'].includes(proof.status), 'STATIC_MAP_CANNOT_ASSERT_RUNTIME_PASS');
      assert.equal(proof.revision,null,'UNEXECUTED_PROOF_REVISION_INVALID');
      for (const file of proof.entrypoints) files.add(file);
    }
  }
  assert.deepEqual([...domains].sort(), ['acl','file','money','queue','timer']);
  for (const item of matrix.dispositions) {
    assert.ok(['KEEP','REWRITE','CONSOLIDATE','RETIRE'].includes(item.decision) && item.block && item.reason && item.remainingProtection.length, 'TEST_DISPOSITION_INVALID');
    files.add(item.file);
  }
  for (const file of files) {
    assert.ok(!path.isAbsolute(file) && !file.split(/[\\/]/).includes('..'), 'MATRIX_PATH_OUTSIDE_ROOT');
    await readFile(checkedPath(root,file));
  }
  return [...new Set(matrix.contracts.flatMap(row=>row.productionModules))].sort();
}
