import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileFunction } from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { artifactIdentity, assertCiPostgresTarget, assertCiRuntimeTarget, integrationFiles, readWebArtifact, receiveCiArtifact, typesDigest, verifyTypesArtifact } from './target.mjs';
import { verifyRuntimeImageProjection } from './image-projection.mjs';
import { groupMembers, groupMembersWithRetry } from './cleanup.mjs';
import { removeWebTemplateSmoke, verifyTemplateContainer, verifyWebTemplatePackage } from './kp-template-image.mjs';
import templateSmoke from './kp-template-smoke.mjs';

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

test('web package smoke actually reads every permitted source asset, limits and contract model', () => {
  const expected = templateSmoke.expectedPackage(), load = createRequire(new URL('../../../package.json', import.meta.url));
  const result = templateSmoke.verifyPackage(expected, load);
  assert.equal(result.assetsChecked, expected.assets.length); assert.ok(result.assetsChecked > 10);
  assert.equal(result.limitsChecked, true); assert.equal(result.contractModelChecked, true); assert.equal(result.privateAssetsDenied, true);
  const logs = [], processState = {}, ownRequire = createRequire(import.meta.url);
  const runtimeRequire = name => name === 'node:module' ? { createRequire(file) { assert.equal(file, '/app/apps/web/package.json'); return load; } } : ownRequire(name);
  compileFunction(templateSmoke.program(expected).toString(), ['require', 'console', 'process', 'Buffer'])(runtimeRequire, { log(value) { logs.push(JSON.parse(value)); } }, processState, Buffer);
  assert.equal(processState.exitCode, undefined); assert.deepEqual(logs, [result]);
});

test('missing package entry and missing limits fail through genuine Node package resolution', () => {
  const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'pero-kp-package-'))), load = createRequire(path.join(directory, 'caller.cjs'));
  try {
    const source = path.dirname(createRequire(import.meta.url).resolve('@pero/kp-template'));
    const target = path.join(directory, 'node_modules/@pero/kp-template'); mkdirSync(path.join(target, 'assets/public/js'), { recursive: true });
    copyFileSync(path.join(source, 'package.json'), path.join(target, 'package.json'));
    assert.throws(() => templateSmoke.verifyPackage(templateSmoke.expectedPackage(), load), error => error.code === 'MODULE_NOT_FOUND' && error.kpPhase === 'require' && error.message.includes('index.cjs'));
    for (const file of ['package.json', 'index.cjs', 'source-manifest.json', 'fonts-manifest.json', 'assets/public/js/sheet-render.js', 'assets/public/js/contract-model.js'])
      copyFileSync(path.join(source, file), path.join(target, file));
    assert.throws(() => templateSmoke.verifyPackage(templateSmoke.expectedPackage(), load), error => error.code === 'MODULE_NOT_FOUND' && error.kpPhase === 'require' && error.message.includes('limits.cjs'));
  } finally {
    assert.equal(path.dirname(directory), realpathSync(os.tmpdir())); assert.ok(path.basename(directory).startsWith('pero-kp-package-'));
    assert.equal(lstatSync(directory).isSymbolicLink(), false); rmSync(directory, { recursive: true });
  }
});

test('web image smoke rejects missing font, same-size asset drift and access to private package files', () => {
  const expected = templateSmoke.expectedPackage(), original = createRequire(import.meta.url)('@pero/kp-template');
  const font = expected.assets.find(row => row.name.endsWith('.woff2')).name;
  for (const kind of ['missing', 'changed', 'private']) {
    const modified = Object.create(original);
    modified.browserAsset = name => {
      if (name === font && kind === 'missing') throw Object.assign(new Error('synthetic missing font'), { code: 'ENOENT' });
      if (name === font && kind === 'changed') { const bytes = Buffer.from(original.browserAsset(name)); bytes[0] ^= 1; return bytes; }
      if (name === '../.env' && kind === 'private') return Buffer.from('synthetic forbidden file');
      return original.browserAsset(name);
    };
    assert.throws(() => templateSmoke.verifyPackage(expected, () => modified), error =>
      kind === 'private' ? error.kpPhase === 'private_asset' : error.kpPhase === 'browser_asset' && error.kpAsset === font);
  }
});

function templateContainer(target, imageId) {
  return { Id: 'f'.repeat(64), Name: '/' + target.webName + '-kp-template-smoke', Image: imageId, Mounts: [],
    Config: { Image: imageId, User: 'node', WorkingDir: '/app/apps/web', OpenStdin: true, Entrypoint: ['timeout'],
      Cmd: ['-s', 'KILL', '15', 'node', '--max-old-space-size=64', '--input-type=commonjs', '-'],
      Labels: { 'pero.ci.repository': ci.GITHUB_REPOSITORY, 'pero.ci.run': target.runId, 'pero.ci.attempt': target.attempt, 'pero.ci.service': 'web-template-smoke' } },
    HostConfig: { NetworkMode: 'none', ReadonlyRootfs: true, Memory: 256 * 1024 * 1024, NanoCpus: 1_000_000_000, PidsLimit: 32,
      CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'], PortBindings: {} }, State: { Running: false, ExitCode: 0, OOMKilled: false } };
}

test('web package smoke uses the exact owned bounded image and cleans it after failure without replacing that failure', () => {
  const target = { runId: '169', attempt: '1', webName: 'pero-ci-169-1-web' }, imageId = 'sha256:' + 'd'.repeat(64);
  const container = templateContainer(target, imageId), calls = [], failed = Object.assign(new Error('synthetic child failure'), { status: 1 }); let present = false;
  const command = (args, input) => {
    calls.push(args);
    if (args[0] === 'ps') return present ? container.Id : '';
    if (args[0] === 'create') { present = true; return container.Id; }
    if (args[0] === 'inspect') return JSON.stringify([container]);
    if (args[0] === 'start') { assert.ok(Buffer.isBuffer(input)); throw failed; }
    assert.deepEqual(args, ['rm', '--force', container.Id]); present = false; return '';
  };
  assert.throws(() => verifyWebTemplatePackage(target, imageId, command), error => error === failed);
  assert.equal(present, false); assert.equal(calls.filter(args => args[0] === 'start').length, 1);
  assert.ok(calls.findIndex(args => args[0] === 'inspect') < calls.findIndex(args => args[0] === 'start'));
  for (const change of [value => { value.Config.Labels['pero.ci.run'] = 'other'; }, value => { value.HostConfig.NetworkMode = 'bridge'; },
    value => { value.Config.Cmd = ['server.js']; }, value => { value.HostConfig.Memory *= 2; }]) {
    const changed = templateContainer(target, imageId); change(changed);
    assert.throws(() => verifyTemplateContainer(changed, target, imageId), /CI_TARGET_REFUSED:kp-template-container-/);
  }
});

test('image-smoke cleanup never removes a container with changed ownership', () => {
  const target = { runId: '169', attempt: '1', webName: 'pero-ci-169-1-web' }, imageId = 'sha256:' + 'd'.repeat(64);
  const container = templateContainer(target, imageId), calls = []; container.Config.Labels['pero.ci.run'] = 'other';
  assert.throws(() => removeWebTemplateSmoke(target, imageId, args => {
    calls.push(args[0]); if (args[0] === 'ps') return container.Id;
    assert.equal(args[0], 'inspect'); return JSON.stringify([container]);
  }), /CI_TARGET_REFUSED:kp-template-container-owner/);
  assert.deepEqual(calls, ['ps', 'inspect']);
});

function procStat(pid, { state = 'S', pgid = 100, startedAt = '2000' } = {}) {
  const fields = Array(20).fill('0'); fields[0] = state; fields[2] = String(pgid); fields[19] = startedAt;
  return `${pid} (synthetic (node) child) ${fields.join(' ')}`;
}
function procRace(after, { childEnv, initial = procStat(200), environmentError = 'EACCES', leaderStart = '1000' } = {}) {
  const calls = [], denied = Object.assign(new Error('synthetic environ read'), { code: environmentError, path: '/proc/200/environ' });
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
        if (typeof after === 'function') return after(childStatReads);
        return after;
      }
      assert.equal(file, '/proc/200/environ');
      if (childEnv !== undefined) return childEnv;
      throw denied;
    },
  } };
}

test('cleanup rechecks EACCES and skips only the same zombie or a confirmed vanished process', async () => {
  for (const after of [procStat(200, { state: 'Z' }), ...['ENOENT', 'ESRCH'].map(code => Object.assign(new Error('gone'), { code }))]) {
    const fixture = procRace(after);
    assert.deepEqual(groupMembers({ runId: '169', attempt: '1' }, 'deps', { pid: 100, startedAt: '1000' }, fixture.io), [100]);
    assert.deepEqual(fixture.calls.slice(-2), ['/proc/200/environ', '/proc/200/stat']);
  }
  const target = { runId: '169', attempt: '1' }, owner = { pid: 100, startedAt: '1000' };
  const delayed = procRace(reads => procStat(200, { state: reads < 4 ? 'S' : 'Z' }));
  assert.deepEqual(await groupMembersWithRetry(target, 'deps', owner, delayed.io), [100]);
  const recovered = procRace(procStat(200)), originalRead = recovered.io.readFileSync;
  let environmentReads = 0;
  recovered.io.readFileSync = (file, encoding) => file === '/proc/200/environ' && ++environmentReads > 1
    ? 'PERO_CI_OWNER=169-1\0PERO_CI_PURPOSE=deps\0' : originalRead(file, encoding);
  assert.deepEqual(await groupMembersWithRetry(target, 'deps', owner, recovered.io), [100, 200]);
  const live = procRace(procStat(200));
  await assert.rejects(groupMembersWithRetry(target, 'deps', owner, live.io), error => error === live.denied);
  const regrouped = procRace(reads => procStat(200, { pgid: reads < 3 ? 100 : 999 }));
  await assert.rejects(groupMembersWithRetry(target, 'deps', owner, regrouped.io), /CI_TARGET_REFUSED:process-recheck-identity/);
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

test('runtime projection requires exact config or manifest and ordered OCI layers', () => {
  const record = { configDigest: 'sha256:' + '1'.repeat(64), manifestDigest: 'sha256:' + '2'.repeat(64),
    diffIds: ['sha256:' + '3'.repeat(64), 'sha256:' + '4'.repeat(64)] };
  const loaded = { Id: record.manifestDigest, Descriptor: { digest: record.manifestDigest, mediaType: 'application/vnd.oci.image.manifest.v1+json' },
    RootFS: { Layers: record.diffIds }, Os: 'linux', Architecture: 'amd64' };
  assert.equal(verifyRuntimeImageProjection(loaded, record), loaded.Id);
  assert.equal(verifyRuntimeImageProjection({ ...loaded, Id: record.configDigest, Descriptor: undefined }, record), record.configDigest);
  for (const changed of [
    { RootFS: { Layers: [...record.diffIds].reverse() } },
    { Descriptor: { ...loaded.Descriptor, platform: { os: 'linux', architecture: 'arm64' } } },
    { Id: record.manifestDigest, Descriptor: undefined }, { Id: 'sha256:' + '5'.repeat(64) },
  ]) assert.throws(() => verifyRuntimeImageProjection({ ...loaded, ...changed }, record), /runtime-image-projection/);
});

test('graph-only web proof verifies all OCI blobs before metadata and cannot skip final receipts', async () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'pero-ci-graph-'))), revision = 'a'.repeat(40);
  const directory = path.join(root, `pero-web-169-1-${revision}`), layout = path.join(directory, 'oci');
  mkdirSync(path.join(layout, 'blobs', 'sha256'), { recursive: true });
  const env = { ...ci, GITHUB_SHA: revision, RUNNER_TEMP: root, PERO_CI_WEB_ARTIFACT_DIR: directory };
  const blob = (value, mediaType, annotations) => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
    const digest = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
    writeFileSync(path.join(layout, 'blobs', 'sha256', digest.slice(7)), bytes);
    return { digest, size: bytes.length, mediaType, ...(annotations ? { annotations } : {}) };
  };
  const layer = blob(Buffer.from('owned synthetic layer'), 'application/vnd.oci.image.layer.v1.tar');
  const config = blob({ os: 'linux', architecture: 'amd64', rootfs: { type: 'layers', diff_ids: [layer.digest] }, config: { Env: ['NODE_VERSION=22.20.0'],
    Labels: { 'org.opencontainers.image.revision': revision, 'pero.ci.repository': 'navasiolau/pero_crm', 'pero.ci.run': '169', 'pero.ci.attempt': '1', 'pero.ci.service': 'web' } } }, 'application/vnd.oci.image.config.v1+json');
  const manifest = blob({ config, layers: [layer] }, 'application/vnd.oci.image.manifest.v1+json');
  const attestation = blob({ config: blob({}, 'application/vnd.oci.image.config.v1+json'), layers: [blob({}, 'application/vnd.in-toto+json')] },
    'application/vnd.oci.image.manifest.v1+json', { 'vnd.docker.reference.type': 'attestation-manifest', 'vnd.docker.reference.digest': manifest.digest });
  const index = blob({ manifests: [manifest, attestation] }, 'application/vnd.oci.image.index.v1+json');
  writeFileSync(path.join(layout, 'index.json'), JSON.stringify({ manifests: [index] }));
  writeFileSync(path.join(layout, 'oci-layout'), '{"imageLayoutVersion":"1.0.0"}'); writeFileSync(path.join(directory, 'web.oci.tar'), 'synthetic archive');
  try {
    const graph = await readWebArtifact(false, env, 'web', true);
    assert.equal(graph.configDigest, config.digest); assert.equal(graph.manifestDigest, manifest.digest); assert.equal(graph.buildId, undefined);
    await assert.rejects(readWebArtifact(false, env), /ENOENT/);
    for (const [receipt, kind] of [[true, 'web'], [false, 'bot']]) await assert.rejects(readWebArtifact(receipt, env, kind, true), /artifact-graph-only/);
    mkdirSync(path.join(directory, 'metadata', 'server'), { recursive: true });
    writeFileSync(path.join(directory, 'metadata', 'BUILD_ID'), 'verified-build'); writeFileSync(path.join(directory, 'metadata', 'server', 'server-reference-manifest.json'), '{}');
    const full = await readWebArtifact(false, env); assert.equal(full.buildId, 'verified-build'); assert.equal(full.configDigest, graph.configDigest);
    writeFileSync(path.join(layout, 'blobs', 'sha256', layer.digest.slice(7)), Buffer.alloc(layer.size));
    await assert.rejects(readWebArtifact(false, env, 'web', true), /oci-blob/);
  } finally { assert.equal(path.dirname(root), realpathSync(os.tmpdir())); rmSync(root, { recursive: true }); }
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
        const endpoint = new URL(String(url));
        if (endpoint.pathname.endsWith('/attempts/1')) return Response.json({ ...run,
          ...(change === 'revision' ? { head_sha: 'f'.repeat(40) } : change === 'attempt' ? { run_attempt: 2 } : {}) });
        if (endpoint.pathname.endsWith('/jobs')) return Response.json({ total_count: 2, jobs: [backend,
          { ...native, ...(change === 'producer' ? { status: 'completed', conclusion: 'failure' } : {}) }] });
        if (endpoint.pathname.endsWith('/artifacts')) return Response.json({ total_count: 1, artifacts: [artifact] });
        if (endpoint.pathname.endsWith('/artifacts/3/zip')) return new Response(null, { status: 302,
          headers: { location: 'https://fixture.blob.core.windows.net/types.zip' } });
        assert.equal(endpoint.href, 'https://fixture.blob.core.windows.net/types.zip'); return new Response('corrupt archive');
      };
      await assert.rejects(receiveCiArtifact('types', ci), error);
    }
  } finally { globalThis.fetch = originalFetch; }
});


test('artifact poller refreshes a sticky full-URL cache without changing producer guards or budgets', async () => {
  const originalFetch = globalThis.fetch, originalNow = Date.now, originalTimeout = globalThis.setTimeout;
  const started = Date.parse('2026-10-19T12:00:00Z'), revision = ci.GITHUB_SHA, requests = [], cachedJobs = new Map();
  const archiveReached = new Error('synthetic archive download reached');
  let clock = started, jobViews = 0, sleeps = 0;
  const run = { id: 169, run_attempt: 1, head_sha: revision, head_branch: 'staging', event: 'push',
    repository: { full_name: ci.GITHUB_REPOSITORY }, path: '.github/workflows/ci-cd.yml' };
  const backend = { id: 1, name: 'unit-tests (backend)', run_id: 169, run_attempt: 1, head_sha: revision,
    started_at: new Date(started).toISOString() };
  const native = { id: 2, name: 'native-tests', run_id: 169, run_attempt: 1, head_sha: revision, status: 'in_progress' };
  const artifact = { id: 3, name: 'types-169-1-' + revision, expired: false, digest: 'sha256:' + '0'.repeat(64),
    workflow_run: { id: 169, head_sha: revision } };
  try {
    Date.now = () => clock;
    globalThis.setTimeout = (callback, delay) => { assert.equal(delay, 5000); clock += delay; sleeps++; callback(); return 0; };
    globalThis.fetch = async (input, options) => {
      const url = new URL(String(input));
      if (url.origin === 'https://fixture.blob.core.windows.net') {
        assert.equal(url.href, 'https://fixture.blob.core.windows.net/types.zip');
        assert.equal(options.redirect, 'error'); assert.equal(options.headers, undefined);
        throw archiveReached;
      }
      assert.equal(url.origin, 'https://api.github.com'); requests.push({ url, options });
      if (url.pathname.endsWith('/attempts/1')) return Response.json(run);
      if (url.pathname.endsWith('/jobs')) {
        if (!cachedJobs.has(url.href)) {
          const ready = jobViews++ > 0;
          cachedJobs.set(url.href, { total_count: 2, jobs: [backend, { ...native,
            steps: [{ name: 'Свежие types из проверенного OCI', status: ready ? 'completed' : 'in_progress',
              ...(ready ? { conclusion: 'success' } : {}) }] }] });
        }
        return Response.json(cachedJobs.get(url.href));
      }
      if (url.pathname.endsWith('/artifacts')) return Response.json({ total_count: 1, artifacts: [artifact] });
      assert.ok(url.pathname.endsWith('/artifacts/3/zip'));
      return new Response(null, { status: 302, headers: { location: 'https://fixture.blob.core.windows.net/types.zip' } });
    };
    await assert.rejects(receiveCiArtifact('types', { ...ci, CI_ARTIFACT_TOKEN: 'synthetic-only-token' }), error => error === archiveReached);
    assert.equal(jobViews, 2); assert.equal(sleeps, 1); assert.equal(clock - started, 5000);
    assert.equal(requests.length, 5);
    const nonces = requests.map(({ url, options }) => {
      assert.equal(options.cache, 'no-store'); assert.equal(options.headers['Cache-Control'], 'no-cache, no-store');
      assert.equal(options.headers.Accept, 'application/vnd.github+json'); assert.equal(options.headers.Authorization, 'Bearer synthetic-only-token');
      assert.equal(options.headers['X-GitHub-Api-Version'], '2022-11-28'); assert.equal(options.redirect, 'manual');
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(url.searchParams.get('per_page'), /\/(jobs|artifacts)$/.test(url.pathname) ? '100' : null);
      const nonce = url.searchParams.get('_ci_request_nonce'); assert.match(nonce ?? '', /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
      return nonce;
    });
    assert.equal(new Set(nonces).size, requests.length);
  } finally { globalThis.fetch = originalFetch; Date.now = originalNow; globalThis.setTimeout = originalTimeout; }
});
