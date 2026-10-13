import { execFileSync } from 'node:child_process';
import { MINIO_COMMIT, MINIO_GO_IMAGE, MINIO_RELEASE, MINIO_SOURCE_SHA256, POSTGRES_IMAGE, REPOSITORY, requireCi } from './target.mjs';

/** @typedef {import('./target.mjs').CiJob} CiJob */
/** @param {string[]} args @param {number} [timeout] */
export function docker(args, timeout = 120_000) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout }).trim();
}

/** @param {CiJob} target @param {'postgres'|'minio'} service */
function labels(target, service) {
  return { 'pero.ci.repository': REPOSITORY, 'pero.ci.run': target.runId,
    'pero.ci.attempt': target.attempt, 'pero.ci.service': service };
}

/** @param {CiJob} target @param {'runtime'|'cleanup'} [purpose] */
function inspectMinioImage(target, purpose = 'runtime') {
  const expectedId = process.env.PERO_CI_MINIO_IMAGE_ID;
  // Buildx может загрузить образ до ошибки/отмены выдачи imageid.
  const unpublishedCleanup = purpose === 'cleanup' && !expectedId;
  requireCi(unpublishedCleanup || /^sha256:[a-f0-9]{64}$/.test(expectedId ?? ''), 'minio-loaded-image-id');
  const image = JSON.parse(docker(['image', 'inspect', target.minioImage]))[0];
  if (!unpublishedCleanup) requireCi(image.Id === expectedId, 'minio-loaded-image-id');
  for (const [key, value] of Object.entries({ ...labels(target, 'minio'), 'pero.ci.minio.commit': MINIO_COMMIT,
    'pero.ci.go.image': MINIO_GO_IMAGE, 'pero.ci.source.sha256': MINIO_SOURCE_SHA256 })) {
    requireCi(image.Config.Labels?.[key] === value, `image-${key}`);
  }
  requireCi(image.Os === 'linux' && image.Architecture === 'amd64' &&
    image.Config.Entrypoint.join(' ') === '/minio' && image.RepoTags?.length === 1 &&
    image.RepoTags[0] === target.minioImage, 'minio-image');
  return image;
}

/** Только metadata; полный inspect/env никогда не выводится в журнал.
 * @param {CiJob} target @param {string} id @param {'postgres'|'minio'} service */
export function inspectService(target, id, service) {
  requireCi(/^[a-f0-9]{64}$/.test(id), 'container-id');
  const container = JSON.parse(docker(['inspect', '--type', 'container', id]))[0];
  const postgres = service === 'postgres', port = postgres ? '5432/tcp' : '9000/tcp';
  requireCi(container.Id === id && container.Config.Image === (postgres ? POSTGRES_IMAGE : target.minioImage), 'container-image');
  if (!postgres) requireCi(container.Image === inspectMinioImage(target).Id, 'minio-image-id');
  for (const [key, value] of Object.entries(labels(target, service))) {
    requireCi(container.Config.Labels?.[key] === value, `container-${key}`);
  }
  requireCi(container.HostConfig.NetworkMode === target.network &&
    Object.keys(container.NetworkSettings.Networks).length === 1 && container.NetworkSettings.Networks[target.network], 'container-network');
  const binding = container.HostConfig.PortBindings?.[port];
  requireCi(binding?.length === 1 && binding[0].HostIp === '127.0.0.1' &&
    binding[0].HostPort === (postgres ? '55432' : '59000'), 'container-port');
  requireCi(Object.keys(container.HostConfig.PortBindings).length === 1, 'extra-port');
  const dataPath = postgres ? '/var/lib/postgresql/data' : '/data';
  requireCi(Boolean(container.HostConfig.Tmpfs?.[dataPath]) &&
    container.Mounts.every(mount => mount.Type === 'tmpfs'), 'persistent-mount');
  if (postgres) {
    for (const value of ['POSTGRES_DB=pero_ci', 'POSTGRES_USER=ci_runner',
      `POSTGRES_PASSWORD=ci-only-${target.runId}-${target.attempt}`]) {
      requireCi(container.Config.Env.includes(value), 'postgres-configuration');
    }
  } else {
    requireCi(container.Name === `/${target.minioName}` &&
      container.Config.Cmd.join(' ') === 'server /data --address :9000', 'minio-command');
  }
  return container;
}

/** @param {CiJob} target */
export function startMinio(target) {
  requireCi(process.env.GITHUB_JOB === 'native-tests', 'minio-job');
  inspectService(target, target.postgresId, 'postgres');
  requireCi(!docker(['ps', '-aq', '--filter', `name=^/${target.minioName}$`]), 'minio-already-exists');
  const image = inspectMinioImage(target);
  console.log(JSON.stringify({ ciRuntime: 'minio-image-ready', release: MINIO_RELEASE,
    commit: MINIO_COMMIT, imageId: image.Id }));
  const args = ['run', '-d', '--rm', '--name', target.minioName, '--network', target.network,
    '--publish', '127.0.0.1:59000:9000', '--tmpfs', '/data:rw,nosuid,size=512m'];
  for (const [key, value] of Object.entries(labels(target, 'minio'))) args.push('--label', `${key}=${value}`);
  args.push('--env', `MINIO_ROOT_USER=${target.s3.accessKeyId}`, '--env', `MINIO_ROOT_PASSWORD=${target.s3.secretAccessKey}`,
    target.minioImage, 'server', '/data', '--address', ':9000');
  const id = docker(args);
  inspectService(target, id, 'minio');
  const version = docker(['exec', id, '/minio', '--version']);
  requireCi(version.includes(MINIO_RELEASE) && version.includes(MINIO_COMMIT) && version.includes('go1.24.2'), 'minio-binary-version');
  console.log(JSON.stringify({ ciRuntime: 'minio-version', release: MINIO_RELEASE, commit: MINIO_COMMIT,
    go: 'go1.24.2', imageId: inspectMinioImage(target).Id }));
  return id;
}

/** Повторяемая очистка только собственной цели; PostgreSQL/network удаляет GitHub.
 * @param {CiJob} target */
export function removeMinio(target) {
  const id = docker(['ps', '-aq', '--no-trunc', '--filter', `name=^/${target.minioName}$`]);
  if (id) {
    const container = inspectService(target, id, 'minio');
    requireCi(!process.env.PERO_CI_MINIO_ID || process.env.PERO_CI_MINIO_ID === id, 'cleanup-id');
    requireCi(container.HostConfig.AutoRemove === true, 'cleanup-auto-remove');
    docker(['rm', '--force', id]);
  }
  requireCi(!docker(['ps', '-aq', '--no-trunc', '--filter', `name=^/${target.minioName}$`]), 'minio-remains');
  if (docker(['image', 'ls', '-q', target.minioImage])) {
    inspectMinioImage(target, 'cleanup');
    docker(['image', 'rm', target.minioImage]);
  }
  requireCi(!docker(['image', 'ls', '-q', target.minioImage]), 'minio-image-remains');
  requireCi(!docker(['volume', 'ls', '-q', '--filter', `label=pero.ci.run=${target.runId}`,
    '--filter', `label=pero.ci.attempt=${target.attempt}`]), 'data-volume-remains');
  console.log(JSON.stringify({ ciRuntime: 'minio-removed', runId: target.runId, attempt: target.attempt,
    containers: 0, images: 0, persistentDataVolumes: 0, postgresNetworkCleanup: 'github-post-job' }));
}
