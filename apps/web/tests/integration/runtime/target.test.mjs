import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCiRuntimeTarget } from './target.mjs';

const ci = {
  CI: 'true', GITHUB_ACTIONS: 'true', RUNNER_OS: 'Linux', RUNNER_ENVIRONMENT: 'github-hosted',
  GITHUB_REPOSITORY: 'navasiolau/pero_crm', GITHUB_RUN_ID: '169', GITHUB_RUN_ATTEMPT: '1',
  PERO_CI_POSTGRES_ID: 'a'.repeat(64), PERO_CI_MINIO_ID: 'b'.repeat(64),
  PERO_CI_NETWORK: 'github_network_' + 'c'.repeat(32),
  DATABASE_URL: 'postgresql://ci_runner:ci-only-169-1@127.0.0.1:55432/pero_ci?schema=public',
  CRM_FILE_STORAGE: 's3', S3_ENDPOINT: 'http://127.0.0.1:59000', S3_BUCKET: 'ci-169-1',
  S3_ACCESS_KEY: 'ci_runner', S3_SECRET_KEY: 'ci-only-169-1-s3', S3_REGION: 'us-east-1',
  AUTH_SECRET: 'ci-only-169-1-auth', AUTH_URL: 'http://127.0.0.1:3100', AUTH_TRUST_HOST: 'true',
};

test('CI guard accepts only the explicit ephemeral run', () => {
  const target = assertCiRuntimeTarget(ci);
  assert.equal(target.runId, '169');
  assert.equal(target.s3.bucket, 'ci-169-1');
});

test('CI guard refuses working/local targets and incomplete identity before connecting', () => {
  for (const override of [
    { CI: '' }, { RUNNER_ENVIRONMENT: 'self-hosted' }, { RUNNER_OS: 'Windows' },
    { GITHUB_REPOSITORY: 'other/repo' }, { GITHUB_RUN_ID: '170' }, { PERO_CI_MINIO_ID: '' },
    { PERO_CI_POSTGRES_ID: 'staging' }, { PERO_CI_NETWORK: 'crm_backend' },
    { DATABASE_URL: ci.DATABASE_URL.replace(':55432', ':5433') },
    { DATABASE_URL: ci.DATABASE_URL.replace('127.0.0.1', '192.168.0.20') },
    { DATABASE_URL: ci.DATABASE_URL.replace('pero_ci', 'pero_crm') },
    { S3_ENDPOINT: 'http://192.168.0.33:9000' }, { S3_BUCKET: 'pero-crm-staging' },
    { CRM_FILE_STORAGE: 'local' }, { AUTH_SECRET: 'production' }, { AUTH_URL: 'https://crm.peromebel.by' },
  ]) assert.throws(() => assertCiRuntimeTarget({ ...ci, ...override }), /CI_TARGET_REFUSED/);
});
