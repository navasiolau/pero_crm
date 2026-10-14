import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { CreateBucketCommand, PutBucketVersioningCommand, S3Client } from '@aws-sdk/client-s3';
import { assertCiJob, assertCiRuntimeTarget, requireCi } from './target.mjs';
import { inspectService, startMinio, startWeb } from './containers.mjs';
import { cleanup, processOwner, recordProcesses } from './cleanup.mjs';

const job = assertCiJob();
requireCi(process.platform === 'linux' && realpathSync(process.cwd()) ===
  path.join(process.env.GITHUB_WORKSPACE, 'apps/web'), 'checkout-directory');
for (const directory of [process.env.GITHUB_WORKSPACE, process.cwd(), path.join(process.cwd(), 'prisma')]) {
  requireCi(!readdirSync(directory).some(name => /^\.env(?:\.(?:local|production|production\.local))?$/.test(name)), 'env-file');
}
requireCi(existsSync('.next/BUILD_ID'), 'existing-build');
// Сборка выполнена ранее в том же job; её actual SHA/BUILD_ID выдаёт шаг build.
requireCi(Boolean(process.env.PERO_CI_BUILD_ID) && readFileSync('.next/BUILD_ID', 'utf8').trim() ===
  process.env.PERO_CI_BUILD_ID, 'current-build-id');
requireCi(process.env.PERO_CI_BUILD_REVISION === process.env.GITHUB_SHA &&
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() ===
  process.env.GITHUB_SHA, 'current-build-revision');

/** @param {string} url @param {'ok'|'unavailable'} [databaseHealth] */
async function ready(url, databaseHealth) {
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000), redirect: 'error' });
      if ((!databaseHealth && response.ok) || (databaseHealth &&
        response.status === (databaseHealth === 'ok' ? 200 : 503) && (await response.json()).database === databaseHealth)) return;
    } catch { /* Ожидаем только собственный временный сервер. */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw Error('CI_RUNTIME_HEALTH_TIMEOUT');
}

let tests, finishing;
const processes = {};
function finish() {
  return finishing ??= (async () => {
    await cleanup(job, processes);
  })();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  void finish().then(() => process.exit(130), () => process.exit(1));
});

try {
  process.env.PERO_CI_MINIO_ID = startMinio(job);
  requireCi(Boolean(process.env.GITHUB_ENV) && path.isAbsolute(process.env.GITHUB_ENV), 'github-env-file');
  appendFileSync(process.env.GITHUB_ENV, `PERO_CI_MINIO_ID=${process.env.PERO_CI_MINIO_ID}\n`);
  const target = assertCiRuntimeTarget();
  inspectService(target, target.postgresId, 'postgres');
  inspectService(target, target.minioId, 'minio');
  console.log(JSON.stringify({ ciRuntime: 'guarded', runId: target.runId, attempt: target.attempt,
    postgresId: target.postgresId, minioId: target.minioId, network: target.network, persistentDataVolumes: 0 }));
  await ready(`${target.s3.endpoint}/minio/health/ready`);
  const s3 = new S3Client({ endpoint: target.s3.endpoint, region: 'us-east-1', forcePathStyle: true,
    credentials: { accessKeyId: target.s3.accessKeyId, secretAccessKey: target.s3.secretAccessKey } });
  try {
    await s3.send(new CreateBucketCommand({ Bucket: target.s3.bucket }));
    await s3.send(new PutBucketVersioningCommand({ Bucket: target.s3.bucket, VersioningConfiguration: { Status: 'Enabled' } }));
  } finally { s3.destroy(); }
  requireCi(!finishing, 'cancelled');
  startWeb(target);
  await ready(`${target.baseUrl}/api/health`, 'ok');
  startWeb(target, true);
  await ready(`${target.faultBaseUrl}/api/health`, 'unavailable');
  const cases = readdirSync('tests/integration').filter(file => file.endsWith('.test.ts')).map(file => `tests/integration/${file}`);
  requireCi(cases.length > 0, 'contract-cases');
  requireCi(!finishing, 'cancelled');
  tests = spawn('pnpm', ['exec', 'tsx', '--test', '--test-concurrency=1', ...cases], { detached: true, stdio: 'inherit',
    env: { ...process.env, PERO_CI_OWNER: `${target.runId}-${target.attempt}`, PERO_CI_PURPOSE: 'tests' } });
  requireCi(Boolean(tests.pid), 'tests-start');
  processes.tests = processOwner(tests.pid);
  recordProcesses(target, processes);
  const code = await new Promise((resolve, reject) => { tests.once('error', reject); tests.once('exit', resolve); });
  if (code !== 0) throw Error(`CI_CONTRACTS_FAILED:${code}`);
} finally {
  await finish();
}
