import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { MINIO_COMMIT, MINIO_GO_IMAGE, MINIO_RELEASE, MINIO_SOURCE_SHA256, POSTGRES_IMAGE, REPOSITORY, requireCi } from './target.mjs';

/** @typedef {import('./target.mjs').CiJob} CiJob */
/** @param {string[]} args @param {number} [timeout] */
export function docker(args, timeout = 120_000) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout }).trim();
}

/** @param {CiJob} target @param {'postgres'|'minio'|'web'|'web-fault'} service */
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

/** @param {CiJob} target @param {'runtime'|'cleanup'} [purpose] */
function inspectWebImage(target, purpose = 'runtime') {
  const expected = process.env.PERO_CI_WEB_IMAGE_ID;
  const unpublished = purpose === 'cleanup' && !expected;
  requireCi(unpublished || /^sha256:[a-f0-9]{64}$/.test(expected ?? ''), 'web-loaded-image-id');
  const image = JSON.parse(docker(['image', 'inspect', target.webImage]))[0];
  requireCi((unpublished || image.Id === expected) && image.Os === 'linux' && image.Architecture === 'amd64' &&
    image.RepoTags?.length === 1 && image.RepoTags[0] === target.webImage, 'web-loaded-image');
  for (const [key, value] of Object.entries({ ...labels(target, 'web'), 'org.opencontainers.image.revision': process.env.GITHUB_SHA })) {
    requireCi(image.Config.Labels?.[key] === value, `web-image-${key}`);
  }
  return image;
}

/** Независимый от возвращённого CID cleanup покрывает отмену между create и stdout. */
function metadataContainer(target) {
  const name = `${target.webName}-metadata`, id = docker(['ps', '-aq', '--no-trunc', '--filter', `name=^/${name}$`]);
  if (id) {
    const container = JSON.parse(docker(['inspect', '--type', 'container', id]))[0];
    requireCi(container.Id === id && container.Name === `/${name}` &&
      container.Image === inspectWebImage(target, 'cleanup').Id && container.Config.Image === container.Image &&
      container.State.Status === 'created' && container.State.Running === false &&
      container.State.StartedAt === '0001-01-01T00:00:00Z' && container.HostConfig.ReadonlyRootfs === true &&
      container.HostConfig.NetworkMode === 'none' && container.Mounts.length === 0 &&
      Object.keys(container.HostConfig.PortBindings ?? {}).length === 0, 'metadata-container');
    for (const [key, value] of Object.entries(labels(target, 'web-metadata')))
      requireCi(container.Config.Labels?.[key] === value, `metadata-${key}`);
  }
  return id;
}

export function removeMetadata(target) {
  const id = metadataContainer(target), name = `${target.webName}-metadata`;
  if (id) docker(['rm', id]);
  requireCi(!docker(['ps', '-aq', '--no-trunc', '--filter', `name=^/${name}$`]), 'metadata-remains');
}

/** Никакие процессы образа не запускаются до полного OCI proof. */
export function extractWebMetadata(target, configDigest) {
  requireCi(/^sha256:[a-f0-9]{64}$/.test(configDigest ?? ''), 'runtime-bake-config');
  process.env.PERO_CI_WEB_IMAGE_ID = configDigest;
  const image = inspectWebImage(target), name = `${target.webName}-metadata`;
  requireCi(image.Id === configDigest && !docker(['ps', '-aq', '--filter', `name=^/${name}$`]), 'metadata-fresh-image');
  const directory = `${process.env.PERO_CI_WEB_ARTIFACT_DIR}/metadata`;
  mkdirSync(directory); mkdirSync(`${directory}/server`);
  const args = ['create', '--name', name, '--network', 'none', '--read-only', '--entrypoint', 'node'];
  for (const [key, value] of Object.entries(labels(target, 'web-metadata'))) args.push('--label', `${key}=${value}`);
  args.push(image.Id, '--version');
  try {
    const id = docker(args);
    requireCi(/^[a-f0-9]{64}$/.test(id) && metadataContainer(target) === id, 'metadata-id');
    for (const relative of ['types', 'BUILD_ID', 'server/server-reference-manifest.json'])
      docker(['cp', `${id}:/app/apps/web/.next/${relative}`, `${directory}/${relative}`]);
  } finally { removeMetadata(target); }
  return image;
}

const migrationDatabase = 'pero_ci_image_migration';
const migrationCommand = ['prisma', 'migrate', 'deploy', '--schema', 'apps/web/prisma/schema.prisma'];
function imageMigrationUrl(target) {
  const url = new URL(target.databaseUrl);
  url.hostname = 'postgres'; url.port = '5432'; url.pathname = `/${migrationDatabase}`;
  return url.toString();
}
function migrationContainer(target) {
  const name = `${target.webName}-migration`, id = docker(['ps', '-aq', '--no-trunc', '--filter', `name=^/${name}$`]);
  if (!id) return null;
  const container = JSON.parse(docker(['inspect', '--type', 'container', id]))[0];
  requireCi(container.Id === id && container.Name === `/${name}` && container.Config.Image === container.Image &&
    container.Image === inspectWebImage(target, 'cleanup').Id && container.HostConfig.NetworkMode === target.network &&
    Object.keys(container.NetworkSettings.Networks).length === 1 && container.NetworkSettings.Networks[target.network] &&
    !container.HostConfig.AutoRemove && container.Mounts.length === 0 && Object.keys(container.HostConfig.PortBindings ?? {}).length === 0 &&
    JSON.stringify(container.Config.Cmd) === JSON.stringify(migrationCommand) &&
    container.Config.Env.filter(value => value.startsWith('DATABASE_URL=')).join() === `DATABASE_URL=${imageMigrationUrl(target)}`, 'image-migration-container');
  for (const [key, value] of Object.entries(labels(target, 'web-migration')))
    requireCi(container.Config.Labels?.[key] === value, `migration-${key}`);
  return container;
}
export function removeImageMigration(target) {
  const container = migrationContainer(target);
  if (container) docker(['rm', '--force', container.Id]);
  requireCi(!migrationContainer(target), 'image-migration-remains');
}

/** Host migration не заменяет fresh proof тем же испытанным immutable image. */
export function proveImageMigrations(target) {
  const started = Date.now(), pg = inspectService(target, target.postgresId, 'postgres');
  requireCi(pg.NetworkSettings.Networks[target.network].Aliases.includes('postgres') && !migrationContainer(target), 'image-migration-fresh');
  const query = (database, sql) => JSON.parse(docker(['exec', target.postgresId, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'ci_runner', '-d', database, '-At', '-c', sql]));
  const identity = query('pero_ci', `SELECT json_build_object('database',current_database(),'role',current_user,'primary',NOT pg_is_in_recovery(),'exists',EXISTS(SELECT 1 FROM pg_database WHERE datname='${migrationDatabase}'))`);
  requireCi(identity.database === 'pero_ci' && identity.role === 'ci_runner' && identity.primary && !identity.exists, 'image-migration-database-owner');
  docker(['exec', target.postgresId, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'ci_runner', '-d', 'pero_ci', '-c',
    `CREATE DATABASE ${migrationDatabase} WITH TEMPLATE template0 OWNER ci_runner`]);
  const fresh = query(migrationDatabase, "SELECT json_build_object('database',current_database(),'role',current_user,'tables',(SELECT count(*) FROM pg_tables WHERE schemaname='public'))");
  requireCi(fresh.database === migrationDatabase && fresh.role === 'ci_runner' && fresh.tables === 0, 'image-migration-empty');
  const record = JSON.parse(readFileSync(`${process.env.PERO_CI_WEB_ARTIFACT_DIR}/image.json`, 'utf8')), image = inspectWebImage(target);
  requireCi(image.Id === record.configDigest && JSON.stringify(image.RootFS.Layers) === JSON.stringify(record.diffIds), 'migration-oci-projection');
  const args = ['create', '--name', `${target.webName}-migration`, '--network', target.network, '--env', `DATABASE_URL=${imageMigrationUrl(target)}`];
  for (const [key, value] of Object.entries(labels(target, 'web-migration'))) args.push('--label', `${key}=${value}`);
  args.push(image.Id, ...migrationCommand);
  try {
    const id = docker(args), container = migrationContainer(target);
    requireCi(container?.Id === id && container.State.Status === 'created' && !container.State.Running &&
      container.State.StartedAt === '0001-01-01T00:00:00Z', 'image-migration-not-started');
    const directory = `${process.env.PERO_CI_WEB_ARTIFACT_DIR}/migration-proof`; mkdirSync(directory);
    docker(['cp', `${id}:/app/apps/web/prisma/migrations`, `${directory}/migrations`]);
    const folders = directory => readdirSync(directory).filter(name => lstatSync(`${directory}/${name}`).isDirectory()).sort();
    const host = folders('prisma/migrations'), actual = folders(`${directory}/migrations`);
    requireCi(host.length > 0 && JSON.stringify(host) === JSON.stringify(actual), 'image-migration-folders');
    const checksum = file => createHash('sha256').update(readFileSync(file)).digest('hex');
    const expected = host.map(name => ({ name, checksum: checksum(`prisma/migrations/${name}/migration.sql`), finished: true }));
    requireCi(expected.every(row => row.checksum === checksum(`${directory}/migrations/${row.name}/migration.sql`)), 'image-migration-source');
    docker(['start', id]); requireCi(docker(['wait', id]) === '0', 'image-migration-exit');
    const exited = migrationContainer(target); requireCi(exited.State.Status === 'exited' && exited.State.ExitCode === 0, 'image-migration-complete');
    const records = query(migrationDatabase, `SELECT coalesce(json_agg(json_build_object('name',migration_name,'checksum',checksum,'finished',finished_at IS NOT NULL AND rolled_back_at IS NULL) ORDER BY migration_name COLLATE "C"),'[]') FROM public._prisma_migrations`);
    requireCi(JSON.stringify(records) === JSON.stringify(expected), 'image-migration-records');
    console.log(JSON.stringify({ ciRuntime: 'fresh-image-migrations', database: migrationDatabase, imageId: image.Id,
      indexDigest: record.indexDigest, migrations: expected.length, completedMigrations: records.length, allChecksumsFinished: true, elapsedMs: Date.now() - started }));
  } finally { removeImageMigration(target); }
}

/** @param {CiJob} target @param {boolean} [fault] */
function webEnvironment(target, fault = false) {
  const db = new URL(target.databaseUrl);
  db.hostname = 'postgres'; db.port = '5432';
  if (fault) db.username = target.faultRole;
  return { DATABASE_URL: db.toString(), CRM_FILE_STORAGE: 's3', S3_ENDPOINT: `http://${target.minioName}:9000`,
    S3_BUCKET: target.s3.bucket, S3_ACCESS_KEY: target.s3.accessKeyId, S3_SECRET_KEY: target.s3.secretAccessKey,
    S3_REGION: 'us-east-1', AUTH_SECRET: target.authSecret, AUTH_URL: fault ? target.faultBaseUrl : target.baseUrl, AUTH_TRUST_HOST: 'true' };
}

/** @param {CiJob} target @param {string} id @param {boolean} [fault] */
export function inspectWeb(target, id, fault = false) {
  requireCi(/^[a-f0-9]{64}$/.test(id), 'web-container-id');
  const container = JSON.parse(docker(['inspect', '--type', 'container', id]))[0];
  requireCi(container.Id === id && container.Image === inspectWebImage(target).Id &&
    container.Config.Image === target.webImage && container.Name === `/${fault ? target.faultName : target.webName}`, 'web-container-image');
  for (const [key, value] of Object.entries(labels(target, fault ? 'web-fault' : 'web'))) {
    requireCi(container.Config.Labels?.[key] === value, `web-container-${key}`);
  }
  const ports = container.HostConfig.PortBindings;
  requireCi(container.HostConfig.NetworkMode === target.network && Object.keys(container.NetworkSettings.Networks).length === 1 &&
    container.NetworkSettings.Networks[target.network] && Object.keys(ports).length === 1 &&
    ports['3000/tcp']?.length === 1 && ports['3000/tcp'][0].HostIp === '127.0.0.1' &&
    ports['3000/tcp'][0].HostPort === (fault ? '3101' : '3100'), 'web-network-port');
  requireCi(container.HostConfig.AutoRemove === true && container.Mounts.every(mount => mount.Type === 'tmpfs'), 'web-mounts');
  requireCi(container.Config.Cmd.join(' ') === (fault ? 'node apps/web/server.js' :
    'sh -c prisma migrate deploy --schema apps/web/prisma/schema.prisma && node apps/web/server.js'), 'web-command');
  for (const [key, value] of Object.entries(webEnvironment(target, fault))) {
    requireCi(container.Config.Env.includes(`${key}=${value}`), `web-env-${key}`);
  }
  return container;
}

/** @param {CiJob} target @param {boolean} [fault] */
export function startWeb(target, fault = false) {
  requireCi(process.env.GITHUB_JOB === 'native-tests', 'web-job');
  const postgres = inspectService(target, target.postgresId, 'postgres');
  requireCi(postgres.NetworkSettings.Networks[target.network].Aliases.includes('postgres'), 'postgres-alias');
  const name = fault ? target.faultName : target.webName;
  requireCi(!docker(['ps', '-aq', '--filter', `name=^/${name}$`]), 'web-already-exists');
  if (fault) {
    requireCi(/^[1-9]\d*$/.test(target.runId) && /^[1-9]\d*$/.test(target.attempt) &&
      target.faultRole === `ci_fault_${target.runId}_${target.attempt}` && target.faultRole.length < 63, 'fault-role-owned');
    const identity = JSON.parse(docker(['exec', target.postgresId, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'ci_runner', '-d', 'pero_ci', '-At', '-c',
      `SELECT json_build_object('database',current_database(),'user',current_user,'primary',NOT pg_is_in_recovery(),'existingRole',EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${target.faultRole}'))`]));
    requireCi(identity.database === 'pero_ci' && identity.user === 'ci_runner' && identity.primary && identity.existingRole === false, 'fault-role-fresh-database');
    const password = `ci-only-${target.runId}-${target.attempt}`;
    requireCi(new URL(target.databaseUrl).password === password, 'fault-role-synthetic-password');
    docker(['exec', target.postgresId, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'ci_runner', '-d', 'pero_ci', '-c',
      `CREATE ROLE "${target.faultRole}" LOGIN NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 5 PASSWORD '${password}';
       GRANT CONNECT ON DATABASE pero_ci TO "${target.faultRole}"; GRANT USAGE ON SCHEMA public TO "${target.faultRole}";
       GRANT SELECT,INSERT,UPDATE ON public."Plugin" TO "${target.faultRole}"; GRANT SELECT ON public."User" TO "${target.faultRole}"`]);
  }
  const receipt = JSON.parse(readFileSync(`${process.env.PERO_CI_WEB_ARTIFACT_DIR}/image.json`, 'utf8'));
  const image = inspectWebImage(target);
  requireCi(image.Id === receipt.configDigest && JSON.stringify(image.RootFS.Layers) === JSON.stringify(receipt.diffIds), 'web-oci-projection');
  const args = ['run', '-d', '--rm', '--name', name, '--network', target.network,
    '--publish', `127.0.0.1:${fault ? '3101' : '3100'}:3000`, '--tmpfs', '/tmp:rw,nosuid,size=128m'];
  for (const [key, value] of Object.entries(labels(target, fault ? 'web-fault' : 'web'))) args.push('--label', `${key}=${value}`);
  for (const [key, value] of Object.entries(webEnvironment(target, fault))) args.push('--env', `${key}=${value}`);
  args.push(target.webImage);
  if (fault) args.push('node', 'apps/web/server.js');
  const id = docker(args); inspectWeb(target, id, fault);
  requireCi(docker(['exec', id, 'node', '--version']) === `v${receipt.runtimeNode}`, 'web-node-version');
  requireCi(docker(['exec', id, 'cat', 'apps/web/.next/BUILD_ID']) === receipt.buildId, 'web-build-id');
  const manifest = docker(['exec', id, 'sha256sum', 'apps/web/.next/server/server-reference-manifest.json']).split(/\s+/)[0];
  requireCi(`sha256:${manifest}` === receipt.actionManifestSha256, 'web-action-manifest');
  console.log(JSON.stringify({ ciRuntime: 'web-image-started', runId: target.runId, attempt: target.attempt,
    containerId: id, fault, imageId: image.Id, buildId: receipt.buildId, indexDigest: receipt.indexDigest }));
  return id;
}

/** @param {CiJob} target */
export function removeWeb(target) {
  removeImageMigration(target);
  removeMetadata(target);
  for (const fault of [true, false]) {
    const name = fault ? target.faultName : target.webName;
    const id = docker(['ps', '-aq', '--no-trunc', '--filter', `name=^/${name}$`]);
    if (id) { inspectWeb(target, id, fault); docker(['rm', '--force', id]); }
    requireCi(!docker(['ps', '-aq', '--no-trunc', '--filter', `name=^/${name}$`]), 'web-remains');
  }
  if (docker(['image', 'ls', '-q', target.webImage])) {
    inspectWebImage(target, 'cleanup'); docker(['image', 'rm', target.webImage]);
  }
  requireCi(!docker(['image', 'ls', '-q', target.webImage]), 'web-image-remains');
  console.log(JSON.stringify({ ciRuntime: 'web-removed', runId: target.runId, attempt: target.attempt, containers: 0, images: 0 }));
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
