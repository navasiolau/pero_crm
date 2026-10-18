import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { artifactIdentity, assertCiPostgresTarget, assertCiRuntimeTarget, integrationFiles, receiveCiArtifact, typesDigest, verifyTypesArtifact } from './target.mjs';
import { groupMembers } from './cleanup.mjs';

const ci = {
  CI: 'true', GITHUB_ACTIONS: 'true', RUNNER_OS: 'Linux', RUNNER_ENVIRONMENT: 'github-hosted',
  GITHUB_REPOSITORY: 'navasiolau/pero_crm', GITHUB_RUN_ID: '169', GITHUB_RUN_ATTEMPT: '1',
  PERO_CI_POSTGRES_ID: 'a'.repeat(64), PERO_CI_MINIO_ID: 'b'.repeat(64),
  PERO_CI_WEB_IMAGE_ID: 'sha256:' + 'd'.repeat(64),
  PERO_CI_NETWORK: 'github_network_' + 'c'.repeat(32),
  DATABASE_URL: 'postgresql://ci_runner:ci-only-169-1@127.0.0.1:55432/pero_ci?schema=public',
  CRM_FILE_STORAGE: 's3', S3_ENDPOINT: 'http://127.0.0.1:59000', S3_BUCKET: 'ci-169-1',
  S3_ACCESS_KEY: 'ci_runner', S3_SECRET_KEY: 'ci-only-169-1-s3', S3_REGION: 'us-east-1',
  AUTH_SECRET: 'ci-only-169-1-auth', AUTH_URL: 'http://127.0.0.1:3100', AUTH_TRUST_HOST: 'true',
  GITHUB_SHA: 'e'.repeat(40), GITHUB_EVENT_NAME: 'push', GITHUB_REF_NAME: 'staging',
  GITHUB_JOB: 'native-tests',
};
const postgres = { ...ci, PERO_CI_CONTRACT_PHASE: 'postgres', PERO_CI_MINIO_ID: undefined, PERO_CI_WEB_IMAGE_ID: undefined };

function procStat(pid, { state = 'S', pgid = 100, startedAt = '2000' } = {}) {
  const fields = Array(20).fill('0'); fields[0] = state; fields[2] = String(pgid); fields[19] = startedAt;
  return `${pid} (synthetic (node) child) ${fields.join(' ')}`;
}
function procRace(after, { childEnv, initial = procStat(200), environmentError = 'EACCES', leaderStart = '1000' } = {}) {
  const calls = [], denied = Object.assign(new Error('synthetic environ read'), { code: environmentError });
  let childStatReads = 0;
  const ownEnv = 'PERO_CI_OWNER=169-1\0PERO_CI_PURPOSE=deps\0';
  return { calls, denied, io: {
    readdirSync(directory) { assert.equal(directory, '/proc'); return ['100', '200', 'self']; },
    readFileSync(file, encoding) {
      calls.push(file); assert.equal(encoding, 'utf8');
      if (file === '/proc/100/stat') return procStat(100, { startedAt: leaderStart });
      if (file === '/proc/100/environ') return ownEnv;
      if (file === '/proc/200/stat') {
        if (childStatReads++ === 0) return initial;
        if (after instanceof Error) throw after;
        return after;
      }
      assert.equal(file, '/proc/200/environ');
      if (childEnv !== undefined) return childEnv;
      throw denied;
    },
  } };
}

test('cleanup rechecks EACCES and skips only the same zombie or a confirmed vanished process', () => {
  for (const after of [procStat(200, { state: 'Z' }), ...['ENOENT', 'ESRCH'].map(code => Object.assign(new Error('gone'), { code }))]) {
    const fixture = procRace(after);
    assert.deepEqual(groupMembers({ runId: '169', attempt: '1' }, 'deps', { pid: 100, startedAt: '1000' }, fixture.io), [100]);
    assert.deepEqual(fixture.calls.slice(-2), ['/proc/200/environ', '/proc/200/stat']);
  }
});

test('cleanup refuses live unreadable, reused, regrouped, malformed and unprovable process identity', () => {
  const owner = { pid: 100, startedAt: '1000' }, target = { runId: '169', attempt: '1' };
  const live = procRace(procStat(200));
  assert.throws(() => groupMembers(target, 'deps', owner, live.io), error => error === live.denied);
  for (const after of [procStat(200, { state: 'Z', startedAt: '3000' }), procStat(200, { state: 'Z', pgid: 999 }),
    procStat(200, { state: 'Z', startedAt: '' }), 'malformed']) {
    assert.throws(() => groupMembers(target, 'deps', owner, procRace(after).io), /CI_TARGET_REFUSED:process-recheck-identity/);
  }
  assert.throws(() => groupMembers(target, 'deps', owner, procRace(procStat(200, { state: 'Z', startedAt: 'invalid' }),
    { initial: procStat(200, { startedAt: 'invalid' }) }).io), /CI_TARGET_REFUSED:process-recheck-identity/);
  const unreadable = Object.assign(new Error('cannot prove stat'), { code: 'EACCES' });
  assert.throws(() => groupMembers(target, 'deps', owner, procRace(unreadable).io), error => error === unreadable);
  const failed = procRace(procStat(200, { state: 'Z' }), { environmentError: 'EIO' });
  assert.throws(() => groupMembers(target, 'deps', owner, failed.io), error => error === failed.denied);
  assert.equal(failed.calls.filter(file => file === '/proc/200/stat').length, 1);
});

test('cleanup keeps leader start, run nonce and purpose mandatory before returning live members', () => {
  const target = { runId: '169', attempt: '1' }, owner = { pid: 100, startedAt: '1000' };
  for (const childEnv of ['PERO_CI_OWNER=other-1\0PERO_CI_PURPOSE=deps\0', 'PERO_CI_OWNER=169-1\0PERO_CI_PURPOSE=web\0']) {
    assert.throws(() => groupMembers(target, 'deps', owner, procRace(procStat(200, { state: 'Z' }), { childEnv }).io), /CI_TARGET_REFUSED:process-owner/);
  }
  const reusedLeader = procRace(procStat(200), { leaderStart: '1001' });
  assert.throws(() => groupMembers(target, 'deps', owner, reusedLeader.io), /CI_TARGET_REFUSED:process-start-identity/);
  assert.deepEqual(reusedLeader.calls, ['/proc/100/stat']);
  const existingZombie = procRace(procStat(200), { initial: procStat(200, { state: 'Z' }) });
  assert.deepEqual(groupMembers(target, 'deps', owner, existingZombie.io), [100]);
  assert.ok(!existingZombie.calls.includes('/proc/200/environ'));
});

test('CI guard accepts only the explicit ephemeral run', () => {
  const target = assertCiRuntimeTarget(ci);
  assert.equal(target.runId, '169');
  assert.equal(target.s3.bucket, 'ci-169-1');
  assert.equal(target.minioImage, 'pero-ci-169-1-minio:source');
  assert.equal(assertCiPostgresTarget(postgres).databaseUrl, target.databaseUrl);
  assert.equal(integrationFiles('postgres').length, 5); assert.equal(integrationFiles('http').length, 3);
  assert.equal(new Set([...integrationFiles('postgres'), ...integrationFiles('http')]).size, 8);
  assert.deepEqual(integrationFiles('all').map(file => path.basename(file)).sort(),
    readdirSync(new URL('../', import.meta.url)).filter(file => file.endsWith('.test.ts')).sort());
  const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'pero-ci-types-')));
  try {
    const metadata = path.join(directory, 'metadata');
    mkdirSync(metadata); mkdirSync(path.join(metadata, 'types')); mkdirSync(path.join(metadata, 'server'));
    for (const [name, text] of Object.entries({ BUILD_ID: 'build', 'types/routes.ts': 'export {};',
      'types/package.json': '{"type":"module"}', 'server/server-reference-manifest.json': '{}' }))
      writeFileSync(path.join(metadata, name), text);
    const manifest = { ...artifactIdentity(ci), buildId: 'build', indexDigest: `sha256:${'a'.repeat(64)}`,
      configDigest: `sha256:${'b'.repeat(64)}`, files: typesDigest(metadata) };
    writeFileSync(path.join(directory, 'types.json'), JSON.stringify(manifest));
    assert.deepEqual(verifyTypesArtifact(directory, ci), manifest);
    for (const override of [{ revision: 'f'.repeat(40) }, { attempt: '2' }])
      assert.throws(() => verifyTypesArtifact(directory, { ...ci, GITHUB_SHA: override.revision ?? ci.GITHUB_SHA,
        GITHUB_RUN_ATTEMPT: override.attempt ?? ci.GITHUB_RUN_ATTEMPT }), /CI_TARGET_REFUSED:types-/);
    writeFileSync(path.join(metadata, 'types/package.json'), '{}');
    assert.throws(() => verifyTypesArtifact(directory, ci), /CI_TARGET_REFUSED:types-binding/);
  } finally {
    assert.equal(path.dirname(directory), realpathSync(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('pero-ci-types-'));
    rmSync(directory, { recursive: true });
  }
});

test('CI guard refuses working/local targets and incomplete identity before connecting', async () => {
  for (const override of [
    { CI: '' }, { GITHUB_ACTIONS: '' }, { RUNNER_ENVIRONMENT: 'self-hosted' }, { RUNNER_OS: 'Windows' },
    { GITHUB_REPOSITORY: 'other/repo' }, { GITHUB_RUN_ID: '170' }, { PERO_CI_MINIO_ID: '' },
    { GITHUB_RUN_ATTEMPT: '0' }, { GITHUB_RUN_ATTEMPT: '2' }, { PERO_CI_WEB_IMAGE_ID: '' },
    { PERO_CI_MINIO_ID: ci.PERO_CI_POSTGRES_ID },
    { PERO_CI_POSTGRES_ID: 'staging' }, { PERO_CI_NETWORK: 'crm_backend' },
    { DATABASE_URL: ci.DATABASE_URL.replace(':55432', ':5433') },
    { DATABASE_URL: ci.DATABASE_URL.replace('127.0.0.1', '192.168.0.20') },
    { DATABASE_URL: ci.DATABASE_URL.replace('pero_ci', 'pero_crm') },
    { DATABASE_URL: ci.DATABASE_URL.replace('ci_runner:', 'foreign:') },
    { DATABASE_URL: ci.DATABASE_URL.replace('?schema=public', '?schema=private') },
    { S3_ENDPOINT: 'http://192.168.0.33:9000' }, { S3_BUCKET: 'pero-crm-staging' },
    { S3_ACCESS_KEY: 'foreign' }, { S3_SECRET_KEY: 'foreign' }, { S3_REGION: 'foreign' },
    { CRM_FILE_STORAGE: 'local' }, { AUTH_SECRET: 'production' }, { AUTH_URL: 'https://crm.peromebel.by' },
    { AUTH_TRUST_HOST: 'false' }, { DIRECT_URL: ci.DATABASE_URL }, { SHADOW_DATABASE_URL: ci.DATABASE_URL },
    { NEXTAUTH_URL: ci.AUTH_URL }, { NEXTAUTH_SECRET: ci.AUTH_SECRET },
  ]) assert.throws(() => assertCiRuntimeTarget({ ...ci, ...override }), /CI_TARGET_REFUSED/);
  for (const override of [{ GITHUB_JOB: 'other' }, { GITHUB_SHA: 'wrong' }, { PERO_CI_CONTRACT_PHASE: 'http' },
    { PERO_CI_MINIO_ID: ci.PERO_CI_MINIO_ID }, { PERO_CI_WEB_IMAGE_ID: ci.PERO_CI_WEB_IMAGE_ID },
    { DATABASE_URL: ci.DATABASE_URL.replace('pero_ci', 'pero_crm') }])
    assert.throws(() => assertCiPostgresTarget({ ...postgres, ...override }), /CI_TARGET_REFUSED/);
  assert.throws(() => assertCiRuntimeTarget(postgres), /CI_TARGET_REFUSED:runtime-phase/);
  assert.throws(() => integrationFiles('other'), /CI_TARGET_REFUSED:contract-phase/);
  const originalFetch = globalThis.fetch, revision = ci.GITHUB_SHA;
  const run = { id: 169, run_attempt: 1, head_sha: revision, head_branch: 'staging', event: 'push',
    repository: { full_name: ci.GITHUB_REPOSITORY }, path: '.github/workflows/ci-cd.yml' };
  const native = { id: 2, name: 'native-tests', run_id: 169, run_attempt: 1, head_sha: revision, status: 'in_progress',
    steps: [{ name: 'Свежие types из проверенного OCI', status: 'completed', conclusion: 'success' }] };
  const backend = { id: 1, name: 'unit-tests (backend)', run_id: 169, run_attempt: 1, head_sha: revision,
    started_at: new Date().toISOString() };
  const artifact = { id: 3, name: `types-169-1-${revision}`, expired: false, digest: `sha256:${'0'.repeat(64)}`,
    workflow_run: { id: 169, head_sha: revision } };
  try {
    for (const [change, error] of [
      ['revision', /CI_TARGET_REFUSED:producer-run/], ['attempt', /CI_TARGET_REFUSED:producer-run/],
      ['producer', /CI_TARGET_REFUSED:producer-success/], ['archive', /CI_TARGET_REFUSED:artifact-archive-digest/],
    ]) {
      globalThis.fetch = async url => {
        const endpoint = String(url);
        if (endpoint.endsWith('/attempts/1')) return Response.json({ ...run,
          ...(change === 'revision' ? { head_sha: 'f'.repeat(40) } : change === 'attempt' ? { run_attempt: 2 } : {}) });
        if (endpoint.includes('/jobs?')) return Response.json({ total_count: 2, jobs: [backend,
          { ...native, ...(change === 'producer' ? { status: 'completed', conclusion: 'failure' } : {}) }] });
        if (endpoint.includes('/artifacts?')) return Response.json({ total_count: 1, artifacts: [artifact] });
        if (endpoint.endsWith('/artifacts/3/zip')) return new Response(null, { status: 302,
          headers: { location: 'https://fixture.blob.core.windows.net/types.zip' } });
        assert.equal(endpoint, 'https://fixture.blob.core.windows.net/types.zip'); return new Response('corrupt archive');
      };
      await assert.rejects(receiveCiArtifact('types', ci), error);
    }
  } finally { globalThis.fetch = originalFetch; }
});
