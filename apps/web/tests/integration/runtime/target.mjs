export const MINIO_RELEASE = 'RELEASE.2025-09-07T16-13-09Z';
export const MINIO_COMMIT = '07c3a429bfed433e49018cb0f78a52145d4bedeb';
export const MINIO_SOURCE_SHA256 = '8819e3e7817e46b7b3798f8f200ead208562e571563c2e040352378031abe9f2';
export const MINIO_GO_IMAGE = 'golang:1.24.2-alpine@sha256:7772cb5322baa875edd74705556d08f0eeca7b9c4b5367754ce3f2f00041ccee';
export const POSTGRES_IMAGE = 'postgres:17-alpine';
export const REPOSITORY = 'navasiolau/pero_crm';

/** @typedef {{runId:string,attempt:string,postgresId:string,network:string,minioName:string,minioImage:string,
 * databaseUrl:string,baseUrl:string,authSecret:string,
 * s3:{endpoint:string,bucket:string,accessKeyId:string,secretAccessKey:string}}} CiJob */
/** @typedef {CiJob & {minioId:string}} CiRuntimeTarget */

/** @param {boolean} valid @param {string} field */
export function requireCi(valid, field) {
  if (!valid) throw Error(`CI_TARGET_REFUSED:${field}`);
}

/** Только явный CI context; функция не читает env-файлы и не соединяется с целью.
 * @param {NodeJS.ProcessEnv} [env] @returns {CiJob} */
export function assertCiJob(env = process.env) {
  requireCi(env.CI === 'true' && env.GITHUB_ACTIONS === 'true' && env.RUNNER_OS === 'Linux' &&
    env.RUNNER_ENVIRONMENT === 'github-hosted', 'hosted-linux');
  requireCi(env.GITHUB_REPOSITORY === REPOSITORY, 'repository');
  requireCi(/^[1-9]\d*$/.test(env.GITHUB_RUN_ID ?? '') && /^[1-9]\d*$/.test(env.GITHUB_RUN_ATTEMPT ?? ''), 'run');
  requireCi(/^[a-f0-9]{64}$/.test(env.PERO_CI_POSTGRES_ID ?? ''), 'postgres-id');
  requireCi(/^github_network_[a-f0-9]{32}$/.test(env.PERO_CI_NETWORK ?? ''), 'job-network');
  const runId = env.GITHUB_RUN_ID, attempt = env.GITHUB_RUN_ATTEMPT;
  const credential = `ci-only-${runId}-${attempt}`;
  const databaseUrl = `postgresql://ci_runner:${credential}@127.0.0.1:55432/pero_ci?schema=public`;
  const baseUrl = 'http://127.0.0.1:3100';
  const expected = { DATABASE_URL: databaseUrl, CRM_FILE_STORAGE: 's3', S3_ENDPOINT: 'http://127.0.0.1:59000',
    S3_BUCKET: `ci-${runId}-${attempt}`, S3_ACCESS_KEY: 'ci_runner', S3_SECRET_KEY: `${credential}-s3`,
    S3_REGION: 'us-east-1', AUTH_SECRET: `${credential}-auth`, AUTH_URL: baseUrl, AUTH_TRUST_HOST: 'true' };
  for (const [field, value] of Object.entries(expected)) requireCi(env[field] === value, field);
  requireCi(!env.DIRECT_URL && !env.SHADOW_DATABASE_URL && !env.NEXTAUTH_URL && !env.NEXTAUTH_SECRET, 'env-fallback');
  return { runId, attempt, postgresId: env.PERO_CI_POSTGRES_ID, network: env.PERO_CI_NETWORK,
    minioName: `pero-ci-${runId}-${attempt}-minio`, minioImage: `pero-ci-${runId}-${attempt}-minio:source`,
    databaseUrl, baseUrl, authSecret: expected.AUTH_SECRET,
    s3: { endpoint: expected.S3_ENDPOINT, bucket: expected.S3_BUCKET,
      accessKeyId: expected.S3_ACCESS_KEY, secretAccessKey: expected.S3_SECRET_KEY } };
}

/** @param {NodeJS.ProcessEnv} [env] @returns {CiRuntimeTarget} */
export function assertCiRuntimeTarget(env = process.env) {
  const job = assertCiJob(env);
  requireCi(/^[a-f0-9]{64}$/.test(env.PERO_CI_MINIO_ID ?? ''), 'minio-id');
  requireCi(env.PERO_CI_MINIO_ID !== job.postgresId, 'distinct-services');
  return { ...job, minioId: env.PERO_CI_MINIO_ID };
}
