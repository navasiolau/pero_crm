import assert from 'node:assert/strict';
import test from 'node:test';
import { assertClientReconciliationTarget } from '../src/server/kp/client-reconciliation-target';

test('сверка staging требует фактический container proof и точную ревизию даже без AUTH_URL', () => {
  const revision = '1'.repeat(40), runtime = { platform: 'linux', hostname: 'abcdef012345', docker: true };
  const proof = { hostname: 'crm-staging', web: runtime.hostname + 'a'.repeat(52), database: 'b'.repeat(64), databaseVolume: 'crm-staging_pgdata', image: 'sha256:' + 'c'.repeat(64), revision };
  const env = { S3_BUCKET: 'pero-crm-staging', CRM_KP_RECONCILIATION_REVISION: revision, CRM_MODERNIZATION_STAGE_PROOF: JSON.stringify(proof) };
  const url = new URL('postgresql://crm:SYNTHETIC@db:5432/crm');
  assert.doesNotThrow(() => assertClientReconciliationTarget('staging', url, false, env, runtime));
  for (const patch of [{ hostname: 'crm' }, { web: 'd'.repeat(64) }, { databaseVolume: 'crm_pgdata' }, { revision: '2'.repeat(40) }]) {
    assert.throws(() => assertClientReconciliationTarget('staging', url, true, { ...env, CRM_MODERNIZATION_STAGE_PROOF: JSON.stringify({ ...proof, ...patch }) }, runtime), /GUARD/);
  }
  assert.throws(() => assertClientReconciliationTarget('staging', url, true, { ...env, CRM_MODERNIZATION_STAGE_PROOF: '' }, runtime), /GUARD/);
  assert.throws(() => assertClientReconciliationTarget('staging', url, true, { ...env, S3_BUCKET: 'pero-crm' }, runtime), /GUARD/);
  assert.throws(() => assertClientReconciliationTarget('staging', url, true, env, { ...runtime, docker: false }), /GUARD/);
});

test('local5433 и production имеют отдельные guards; production apply требует явного допуска', () => {
  const local = new URL('postgresql://pero:SYNTHETIC@localhost:5433/pero_crm');
  assert.doesNotThrow(() => assertClientReconciliationTarget('local', local, false, {}, { platform: 'win32', hostname: 'qa', docker: false }));
  assert.throws(() => assertClientReconciliationTarget('local', new URL('postgresql://pero:SYNTHETIC@localhost:5432/pero_crm'), false, {}, { platform: 'win32', hostname: 'qa', docker: false }), /GUARD/);
  const production = new URL('postgresql://crm:SYNTHETIC@db:5432/crm');
  const env = { AUTH_URL: 'https://crm.peromebel.by', S3_BUCKET: 'pero-crm' };
  assert.throws(() => assertClientReconciliationTarget('production', production, true, env), /GUARD/);
  assert.throws(() => assertClientReconciliationTarget('unknown', production, false, env), /GUARD/);
});
