import { createHash } from 'node:crypto';
import { createReadStream, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';

export const MINIO_RELEASE = 'RELEASE.2025-09-07T16-13-09Z';
export const MINIO_COMMIT = '07c3a429bfed433e49018cb0f78a52145d4bedeb';
export const MINIO_SOURCE_SHA256 = '8819e3e7817e46b7b3798f8f200ead208562e571563c2e040352378031abe9f2';
export const MINIO_GO_IMAGE = 'golang:1.24.2-alpine@sha256:7772cb5322baa875edd74705556d08f0eeca7b9c4b5367754ce3f2f00041ccee';
export const POSTGRES_IMAGE = 'postgres:17-alpine';
export const REPOSITORY = 'navasiolau/pero_crm';

/** @typedef {{runId:string,attempt:string,postgresId:string,network:string,minioName:string,minioImage:string,
 * databaseUrl:string,baseUrl:string,faultBaseUrl:string,faultRole:string,webName:string,faultName:string,webImage:string,authSecret:string,
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
    databaseUrl, baseUrl, faultBaseUrl: 'http://127.0.0.1:3101', faultRole: `ci_fault_${runId}_${attempt}`,
    webName: `pero-ci-${runId}-${attempt}-web`, faultName: `pero-ci-${runId}-${attempt}-web-fault`,
    webImage: `pero-ci-${runId}-${attempt}-web:tested`, authSecret: expected.AUTH_SECRET,
    s3: { endpoint: expected.S3_ENDPOINT, bucket: expected.S3_BUCKET,
      accessKeyId: expected.S3_ACCESS_KEY, secretAccessKey: expected.S3_SECRET_KEY } };
}

/** @param {NodeJS.ProcessEnv} [env] @returns {CiRuntimeTarget} */
export function assertCiRuntimeTarget(env = process.env) {
  const job = assertCiJob(env);
  requireCi(/^[a-f0-9]{64}$/.test(env.PERO_CI_MINIO_ID ?? ''), 'minio-id');
  requireCi(env.PERO_CI_MINIO_ID !== job.postgresId, 'distinct-services');
  requireCi(/^sha256:[a-f0-9]{64}$/.test(env.PERO_CI_WEB_IMAGE_ID ?? ''), 'web-image-id');
  return { ...job, minioId: env.PERO_CI_MINIO_ID };
}
/** @param {string} file */
async function fileDigest(file) {
  requireCi(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(), 'artifact-file');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return `sha256:${hash.digest('hex')}`;
}

/** Полный OCI-граф проверяется до запуска образа и повторно до публикации.
 * @param {boolean} [receipt] @param {NodeJS.ProcessEnv} [env] */
export async function readWebArtifact(receipt = true, env = process.env) {
  requireCi(env.CI === 'true' && env.GITHUB_ACTIONS === 'true' && env.RUNNER_OS === 'Linux' &&
    env.RUNNER_ENVIRONMENT === 'github-hosted' && env.GITHUB_REPOSITORY === REPOSITORY, 'artifact-owner');
  requireCi(/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') && /^[1-9]\d*$/.test(env.GITHUB_RUN_ID ?? '') &&
    /^[1-9]\d*$/.test(env.GITHUB_RUN_ATTEMPT ?? ''), 'artifact-revision');
  const runId = env.GITHUB_RUN_ID, attempt = env.GITHUB_RUN_ATTEMPT, revision = env.GITHUB_SHA;
  const directory = path.join(env.RUNNER_TEMP, `pero-web-${runId}-${attempt}-${revision}`);
  requireCi(env.PERO_CI_WEB_ARTIFACT_DIR === directory && realpathSync(directory) === directory, 'artifact-directory');
  const layout = path.join(directory, 'oci');
  requireCi(realpathSync(layout) === layout && JSON.parse(readFileSync(path.join(layout, 'oci-layout'), 'utf8')).imageLayoutVersion === '1.0.0', 'oci-layout');
  const root = JSON.parse(readFileSync(path.join(layout, 'index.json'), 'utf8'));
  requireCi(root.manifests?.length === 1, 'oci-root');
  const runtime = [], attestations = [];
  async function blob(descriptor) {
    requireCi(/^sha256:[a-f0-9]{64}$/.test(descriptor.digest ?? '') && Number.isSafeInteger(descriptor.size) && descriptor.size > 0, 'oci-descriptor');
    const file = path.join(layout, 'blobs', 'sha256', descriptor.digest.slice(7));
    requireCi(realpathSync(file) === file && lstatSync(file).size === descriptor.size && await fileDigest(file) === descriptor.digest, 'oci-blob');
    return file;
  }
  async function visit(descriptor) {
    const manifest = JSON.parse(readFileSync(await blob(descriptor), 'utf8'));
    if (manifest.manifests) {
      for (const child of manifest.manifests) await visit(child);
      return;
    }
    const config = JSON.parse(readFileSync(await blob(manifest.config), 'utf8'));
    for (const layer of manifest.layers) await blob(layer);
    if (descriptor.annotations?.['vnd.docker.reference.type'] === 'attestation-manifest') {
      requireCi(manifest.layers.some(layer => layer.mediaType === 'application/vnd.in-toto+json'), 'oci-attestation');
      attestations.push(descriptor);
    } else {
      requireCi(config.os === 'linux' && config.architecture === 'amd64' && config.rootfs?.type === 'layers', 'oci-platform');
      runtime.push({ descriptor, manifest, config });
    }
  }
  await visit(root.manifests[0]);
  requireCi(runtime.length === 1 && attestations.length > 0, 'oci-runtime-and-provenance');
  const image = runtime[0], labels = image.config.config.Labels;
  requireCi(attestations.every(descriptor => descriptor.annotations?.['vnd.docker.reference.digest'] === image.descriptor.digest), 'oci-attestation-subject');
  const runtimeNode = image.config.config.Env.find(value => value.startsWith('NODE_VERSION='))?.slice(13);
  requireCi(/^22\.\d+\.\d+$/.test(runtimeNode ?? ''), 'oci-node-version');
  for (const [key, value] of Object.entries({ 'org.opencontainers.image.revision': revision,
    'pero.ci.repository': REPOSITORY, 'pero.ci.run': runId, 'pero.ci.attempt': attempt, 'pero.ci.service': 'web' })) {
    requireCi(labels?.[key] === value, `oci-${key}`);
  }
  const buildId = readFileSync(path.join(directory, 'metadata', 'BUILD_ID'), 'utf8').trim();
  requireCi(Boolean(buildId) && !/[\r\n]/.test(buildId), 'oci-build-id');
  const record = { runId, attempt, revision, buildId, runtimeNode, indexDigest: root.manifests[0].digest,
    manifestDigest: image.descriptor.digest, configDigest: image.manifest.config.digest,
    diffIds: image.config.rootfs.diff_ids, layerDigests: image.manifest.layers.map(layer => layer.digest),
    attestations, ociSha256: await fileDigest(path.join(directory, 'web.oci.tar')),
    actionManifestSha256: await fileDigest(path.join(directory, 'metadata', 'server', 'server-reference-manifest.json')) };
  if (receipt) {
    requireCi(JSON.stringify(JSON.parse(readFileSync(path.join(directory, 'image.json'), 'utf8'))) === JSON.stringify(record), 'oci-receipt');
    requireCi(env.PERO_CI_EXPECTED_OCI_SHA256 === record.ociSha256, 'oci-job-binding');
  }
  return record;
}

/** Только plain JS без symlinks: один контракт до upload и после download.
 * @param {string} directory */
export function botDistDigest(directory) {
  const files = {};
  function visit(directory, prefix = '') {
    for (const name of readdirSync(directory).sort()) {
      const file = path.join(directory, name), relative = prefix + name, stat = lstatSync(file);
      requireCi(!stat.isSymbolicLink(), 'bot-dist-link');
      if (stat.isDirectory()) visit(file, relative + '/');
      else {
        requireCi(stat.isFile() && name.endsWith('.js'), 'bot-dist-file');
        files[relative] = createHash('sha256').update(readFileSync(file)).digest('hex');
      }
    }
  }
  visit(directory); requireCi(Boolean(files['index.js']), 'bot-dist-entry');
  return files;
}
