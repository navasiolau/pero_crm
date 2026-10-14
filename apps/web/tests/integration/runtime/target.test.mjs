import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { artifactIdentity, assertCiRuntimeTarget, receiveCiArtifact, typesDigest, verifyTypesArtifact } from './target.mjs';

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
};

test('CI guard accepts only the explicit ephemeral run', () => {
  const target = assertCiRuntimeTarget(ci);
  assert.equal(target.runId, '169');
  assert.equal(target.s3.bucket, 'ci-169-1');
  assert.equal(target.minioImage, 'pero-ci-169-1-minio:source');
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
