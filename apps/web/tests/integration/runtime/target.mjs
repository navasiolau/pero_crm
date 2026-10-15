import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
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
  requireCi(!env.PERO_CI_CONTRACT_PHASE || ['all', 'http'].includes(env.PERO_CI_CONTRACT_PHASE), 'runtime-phase');
  requireCi(/^[a-f0-9]{64}$/.test(env.PERO_CI_MINIO_ID ?? ''), 'minio-id');
  requireCi(env.PERO_CI_MINIO_ID !== job.postgresId, 'distinct-services');
  requireCi(/^sha256:[a-f0-9]{64}$/.test(env.PERO_CI_WEB_IMAGE_ID ?? ''), 'web-image-id');
  return { ...job, minioId: env.PERO_CI_MINIO_ID };
}

/** Ранний PG context не принимает подставные runtime IDs; live PG проверяет runner. */
export function assertCiPostgresTarget(env = process.env) {
  const job = assertCiJob(env);
  requireCi(env.GITHUB_JOB === 'native-tests' && env.PERO_CI_CONTRACT_PHASE === 'postgres' &&
    /^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') && !env.PERO_CI_MINIO_ID && !env.PERO_CI_WEB_IMAGE_ID, 'postgres-phase');
  return job;
}

export function integrationFiles(phase) {
  requireCi(['all', 'postgres', 'http'].includes(phase), 'contract-phase');
  const postgres = ['domain-postgres', 'finance-postgres', 'payroll-cash-postgres', 'percentage-postgres', 'queue-postgres'];
  const http = ['file-responses', 'files-crud', 'sketch-replacement'];
  return (phase === 'all' ? [...postgres, ...http] : phase === 'postgres' ? postgres : http).map(name => `tests/integration/${name}.test.ts`);
}
/** @param {string} file */
async function fileDigest(file) {
  requireCi(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(), 'artifact-file');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return `sha256:${hash.digest('hex')}`;
}

/** Полный OCI-граф проверяется до запуска/публикации; web остаётся прежним default.
 * @param {boolean} [receipt] @param {NodeJS.ProcessEnv} [env] @param {'web'|'bot'} [kind] */
export async function readWebArtifact(receipt = true, env = process.env, kind = 'web') {
  requireCi(kind === 'web' || kind === 'bot', 'artifact-kind');
  requireCi(env.CI === 'true' && env.GITHUB_ACTIONS === 'true' && env.RUNNER_OS === 'Linux' &&
    env.RUNNER_ENVIRONMENT === 'github-hosted' && env.GITHUB_REPOSITORY === REPOSITORY, 'artifact-owner');
  requireCi(/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') && /^[1-9]\d*$/.test(env.GITHUB_RUN_ID ?? '') &&
    /^[1-9]\d*$/.test(env.GITHUB_RUN_ATTEMPT ?? ''), 'artifact-revision');
  const runId = env.GITHUB_RUN_ID, attempt = env.GITHUB_RUN_ATTEMPT, revision = env.GITHUB_SHA;
  const directory = path.join(env.RUNNER_TEMP, `pero-${kind}-${runId}-${attempt}-${revision}`);
  const suppliedDirectory = kind === 'web' ? env.PERO_CI_WEB_ARTIFACT_DIR : env.PERO_CI_BOT_ARTIFACT_DIR;
  requireCi(suppliedDirectory === directory && realpathSync(directory) === directory, 'artifact-directory');
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
    'pero.ci.repository': REPOSITORY, 'pero.ci.run': runId, 'pero.ci.attempt': attempt, 'pero.ci.service': kind })) {
    requireCi(labels?.[key] === value, `oci-${key}`);
  }
  const imageRecord = { runtimeNode, indexDigest: root.manifests[0].digest,
    manifestDigest: image.descriptor.digest, configDigest: image.manifest.config.digest,
    diffIds: image.config.rootfs.diff_ids, layerDigests: image.manifest.layers.map(layer => layer.digest),
    attestations, ociSha256: await fileDigest(path.join(directory, `${kind}.oci.tar`)) };
  let record;
  if (kind === 'web') {
    const buildId = readFileSync(path.join(directory, 'metadata', 'BUILD_ID'), 'utf8').trim();
    requireCi(Boolean(buildId) && !/[\r\n]/.test(buildId), 'oci-build-id');
    record = { runId, attempt, revision, buildId, ...imageRecord,
      actionManifestSha256: await fileDigest(path.join(directory, 'metadata', 'server', 'server-reference-manifest.json')) };
  } else {
    const testedFile = path.join(directory, 'metadata', 'tested.json'), producerFile = path.join(directory, 'metadata', 'producer.json');
    requireCi(realpathSync(testedFile) === testedFile && realpathSync(producerFile) === producerFile, 'bot-manifest-path');
    const tested = JSON.parse(readFileSync(testedFile, 'utf8')), producer = JSON.parse(readFileSync(producerFile, 'utf8'));
    requireCi(tested.revision === revision && tested.runId === runId && tested.attempt === attempt, 'bot-tested-owner');
    requireCi(tested.files && !Array.isArray(tested.files) && typeof tested.files === 'object' &&
      Object.hasOwn(tested.files, 'index.js') && Object.entries(tested.files).every(([name, digest]) =>
        name.endsWith('.js') && !path.posix.isAbsolute(name) && !name.includes('\\') &&
        name.split('/').every(part => part && part !== '.' && part !== '..') && /^[a-f0-9]{64}$/.test(digest)), 'bot-tested-files');
    requireCi(producer.repository === REPOSITORY && producer.runId === runId && producer.attempt === attempt &&
      producer.revision === revision && producer.name === 'unit-tests (backend)' && producer.conclusion === 'success' &&
      /^[1-9]\d*$/.test(producer.jobId) && /^[1-9]\d*$/.test(producer.artifactId) &&
      producer.artifactName === `bot-dist-${runId}-${attempt}-${revision}` &&
      /^sha256:[a-f0-9]{64}$/.test(producer.artifactDigest), 'bot-producer');
    const testedDistManifestSha256 = await fileDigest(testedFile), producerManifestSha256 = await fileDigest(producerFile);
    requireCi(labels['pero.ci.tested-dist'] === testedDistManifestSha256 && labels['pero.ci.producer'] === producerManifestSha256, 'bot-manifest-binding');
    record = { runId, attempt, revision, ...imageRecord, testedDistManifestSha256, producerManifestSha256,
      testedDistFiles: tested.files, producer };
  }
  if (receipt) {
    requireCi(JSON.stringify(JSON.parse(readFileSync(path.join(directory, 'image.json'), 'utf8'))) === JSON.stringify(record), 'oci-receipt');
    requireCi((kind === 'web' ? env.PERO_CI_EXPECTED_OCI_SHA256 : env.PERO_CI_EXPECTED_BOT_OCI_SHA256) === record.ociSha256, 'oci-job-binding');
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

/** Artifact consumer не получает DB credentials и не ослабляет native target guard. */
export function artifactIdentity(env = process.env) {
  requireCi(env.CI === 'true' && env.GITHUB_ACTIONS === 'true' && env.RUNNER_OS === 'Linux' &&
    env.RUNNER_ENVIRONMENT === 'github-hosted' && env.GITHUB_REPOSITORY === REPOSITORY, 'artifact-consumer');
  requireCi(/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') && /^[1-9]\d*$/.test(env.GITHUB_RUN_ID ?? '') &&
    /^[1-9]\d*$/.test(env.GITHUB_RUN_ATTEMPT ?? '') && ['push', 'pull_request'].includes(env.GITHUB_EVENT_NAME), 'artifact-consumer-run');
  return { repository: REPOSITORY, runId: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT, revision: env.GITHUB_SHA };
}

/** Полный inventory: не только *.ts, без symlinks и неявных дополнительных файлов. */
export function typesDigest(directory) {
  const files = {};
  function visit(current, prefix = '') {
    requireCi(realpathSync(current) === current, 'types-directory-link');
    for (const name of readdirSync(current).sort()) {
      requireCi(name && !/[\\\r\n]/.test(name) && name !== '.' && name !== '..', 'types-path');
      const file = path.join(current, name), relative = prefix + name, stat = lstatSync(file);
      requireCi(!stat.isSymbolicLink(), 'types-link');
      if (stat.isDirectory()) visit(file, relative + '/');
      else { requireCi(stat.isFile(), 'types-file'); files[relative] = createHash('sha256').update(readFileSync(file)).digest('hex'); }
    }
  }
  visit(directory);
  requireCi(Boolean(files.BUILD_ID) && Boolean(files['server/server-reference-manifest.json']) &&
    Object.keys(files).some(name => name.startsWith('types/') && name.endsWith('.ts')) &&
    Object.keys(files).every(name => name === 'BUILD_ID' || name === 'server/server-reference-manifest.json' || name.startsWith('types/')), 'types-inventory');
  return files;
}

/** Проверка payload выполняется отдельно от API/archive proof, до полного tsc. */
export function verifyTypesArtifact(directory, env = process.env) {
  const identity = artifactIdentity(env), manifest = JSON.parse(readFileSync(path.join(directory, 'types.json'), 'utf8'));
  for (const [key, value] of Object.entries(identity)) requireCi(manifest[key] === value, `types-${key}`);
  requireCi(readdirSync(directory).sort().join(',') === 'metadata,types.json' &&
    lstatSync(path.join(directory, 'types.json')).isFile() && !lstatSync(path.join(directory, 'types.json')).isSymbolicLink(), 'types-root');
  const metadata = path.join(directory, 'metadata'), files = typesDigest(metadata);
  requireCi(JSON.stringify(files) === JSON.stringify(manifest.files) &&
    manifest.buildId === readFileSync(path.join(metadata, 'BUILD_ID'), 'utf8').trim() &&
    Boolean(manifest.buildId) && !/[\r\n]/.test(manifest.buildId) &&
    /^sha256:[a-f0-9]{64}$/.test(manifest.indexDigest) && /^sha256:[a-f0-9]{64}$/.test(manifest.configDigest), 'types-binding');
  return manifest;
}

/** Два закрытых назначения используют один bounded poller и один строгий download. */
export async function receiveCiArtifact(purpose, env = process.env) {
  requireCi(purpose === 'types' || purpose === 'bot-dist', 'producer-purpose');
  const identity = artifactIdentity(env), types = purpose === 'types';
  const apiHead = env.GITHUB_EVENT_NAME === 'pull_request' ? env.CI_WORKFLOW_HEAD_SHA : identity.revision;
  requireCi(/^[a-f0-9]{40}$/.test(apiHead ?? ''), 'producer-api-head');
  requireCi(types || (env.GITHUB_EVENT_NAME === 'push' && ['main', 'staging'].includes(env.GITHUB_REF_NAME)), 'producer-event');
  const artifactName = `${purpose}-${identity.runId}-${identity.attempt}-${identity.revision}`;
  let deadline = Date.now() + (types ? 1080000 : 180000), producer;
  async function api(resource, raw = false) {
    const remaining = deadline - Date.now(); requireCi(remaining > 0, 'producer-timeout');
    const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/${resource}`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${env.CI_ARTIFACT_TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28' }, redirect: 'manual', signal: AbortSignal.timeout(Math.min(10000, remaining)) });
    if (raw) { requireCi(response.status === 302, 'artifact-download-redirect'); return response.headers.get('location'); }
    requireCi(response.ok, `producer-http-${response.status}`);
    const body = await response.text(); requireCi(body.length <= 8 * 1024 * 1024, 'producer-response-size'); return JSON.parse(body);
  }
  const run = await api(`actions/runs/${identity.runId}/attempts/${identity.attempt}`);
  requireCi(run.id === Number(identity.runId) && run.run_attempt === Number(identity.attempt) && run.head_sha === apiHead &&
    run.repository?.full_name === REPOSITORY && run.event === env.GITHUB_EVENT_NAME &&
    run.path?.split('@')[0] === '.github/workflows/ci-cd.yml' &&
    (env.GITHUB_EVENT_NAME !== 'push' || run.head_branch === env.GITHUB_REF_NAME), 'producer-run');
  while (Date.now() < deadline) {
    const listed = await api(`actions/runs/${identity.runId}/attempts/${identity.attempt}/jobs?per_page=100`);
    requireCi(Array.isArray(listed.jobs) && listed.total_count === listed.jobs.length && listed.total_count <= 100, 'producer-jobs');
    const consumerName = types ? 'unit-tests (backend)' : 'native-tests';
    const consumer = listed.jobs.filter(item => item.name === consumerName);
    requireCi(consumer.length === 1 && Number.isFinite(Date.parse(consumer[0].started_at)) &&
      consumer[0].run_id === Number(identity.runId) && consumer[0].run_attempt === Number(identity.attempt) &&
      consumer[0].head_sha === apiHead, 'consumer-start');
    deadline = Math.min(deadline, Date.parse(consumer[0].started_at) + (types ? 1200000 : 1380000));
    const matches = listed.jobs.filter(item => item.name === (types ? 'native-tests' : 'unit-tests (backend)'));
    requireCi(matches.length <= 1, 'producer-unique');
    const job = matches[0];
    if (job) {
      requireCi(job.run_id === Number(identity.runId) && job.run_attempt === Number(identity.attempt) && job.head_sha === apiHead, 'producer-job-owner');
      if (job.status === 'completed') requireCi(job.conclusion === 'success', 'producer-success');
      const steps = job.steps?.filter(step => step.name === 'Свежие types из проверенного OCI') ?? [];
      requireCi(steps.length <= 1, 'types-step-unique');
      if (types && steps[0]?.status === 'completed') requireCi(steps[0].conclusion === 'success', 'types-step-success');
      if (types ? steps[0]?.conclusion === 'success' : job.status === 'completed') {
        const result = await api(`actions/runs/${identity.runId}/artifacts?per_page=100`);
        requireCi(Array.isArray(result.artifacts) && result.total_count === result.artifacts.length && result.total_count <= 100, 'producer-artifacts');
        const artifacts = result.artifacts.filter(item => item.name === artifactName && !item.expired);
        requireCi(artifacts.length <= 1, 'producer-artifact-unique');
        if (artifacts[0]) {
          const artifact = artifacts[0];
          requireCi(Number.isSafeInteger(job.id) && job.id > 0 && Number.isSafeInteger(artifact.id) && artifact.id > 0 &&
            artifact.workflow_run?.id === Number(identity.runId) && artifact.workflow_run?.head_sha === apiHead &&
            /^sha256:[a-f0-9]{64}$/.test(artifact.digest), 'producer-artifact-owner');
          producer = { ...identity, name: job.name, jobId: String(job.id), conclusion: types ? 'upload-success' : job.conclusion,
            artifactId: String(artifact.id), artifactName, artifactDigest: artifact.digest }; break;
        }
      }
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(5000, Math.max(0, deadline - Date.now()))));
  }
  requireCi(Boolean(producer), 'producer-timeout');
  const location = new URL(await api(`actions/artifacts/${producer.artifactId}/zip`, true));
  requireCi(location.protocol === 'https:' && location.hostname.endsWith('.blob.core.windows.net') && !location.username && !location.password, 'artifact-storage');
  const response = await fetch(location, { redirect: 'error', signal: AbortSignal.timeout(Math.min(10000, Math.max(1, deadline - Date.now()))) });
  requireCi(response.ok, 'artifact-download');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength; requireCi(size <= 16 * 1024 * 1024, 'artifact-archive-size'); chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  requireCi(`sha256:${createHash('sha256').update(bytes).digest('hex')}` === producer.artifactDigest, 'artifact-archive-digest');
  const directory = path.join(env.RUNNER_TEMP, `pero-${purpose}-${identity.runId}-${identity.attempt}-${identity.revision}`);
  mkdirSync(directory); writeFileSync(`${directory}.zip`, bytes);
  // Python stdlib проверяет все ZIP paths/типы до извлечения; токен не передаётся redirect endpoint.
  execFileSync('python', ['-c', `import pathlib,stat,sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
 names=set(); total=0
 for f in z.infolist():
  p=pathlib.PurePosixPath(f.filename); mode=f.external_attr>>16; total+=f.file_size
  assert f.filename and not p.is_absolute() and not any(v in ('','.', '..') for v in f.filename.rstrip('/').split('/')) and '\\\\' not in f.filename and not p.drive
  assert f.filename not in names and not stat.S_ISLNK(mode) and (stat.S_IFMT(mode) in (0,stat.S_IFREG,stat.S_IFDIR))
  names.add(f.filename)
 assert total<=32*1024*1024
 z.extractall(sys.argv[2])`, `${directory}.zip`, directory], { stdio: ['ignore', 'pipe', 'pipe'] });
  console.log(JSON.stringify({ ciRuntime: 'producer-ready', purpose, ...producer }));
  return { directory, producer };
}
