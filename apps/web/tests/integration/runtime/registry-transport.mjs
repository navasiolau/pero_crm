import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { artifactIdentity, readWebArtifact, requireCi } from './target.mjs';
import { readRendererArtifact, rendererLabels, verifyRendererSmoke } from '../../../../kp-renderer/ci/artifact.mjs';

export const HANDOFF_LIMIT = 2 * 1024 * 1024;
export const IMAGE_REPOSITORIES = Object.freeze({ web: 'ghcr.io/navasiolau/pero_crm',
  bot: 'ghcr.io/navasiolau/pero_telegram_bot', renderer: 'ghcr.io/navasiolau/pero_kp_renderer' });
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const indexTypes = ['application/vnd.oci.image.index.v1+json', 'application/vnd.docker.distribution.manifest.list.v2+json'];
const manifestTypes = ['application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json'];
export const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function registryContext(kind, env = process.env, producer = false) {
  requireCi(Object.hasOwn(IMAGE_REPOSITORIES, kind), 'registry-kind');
  const identity = artifactIdentity(env);
  requireCi(env.GITHUB_EVENT_NAME === 'push' && ['main', 'staging'].includes(env.GITHUB_REF_NAME), 'registry-push');
  const expectedJob = producer ? kind === 'renderer' ? 'kp-renderer-tests' : 'native-tests' : kind === 'bot' ? 'build-push-bot' : 'build-push';
  requireCi(env.GITHUB_JOB === expectedJob, 'registry-job');
  return { ...identity, registry: IMAGE_REPOSITORIES[kind], tag: `ci-${identity.runId}-${identity.attempt}-${identity.revision}` };
}
export function imageDirectory(kind, env = process.env) {
  const identity = artifactIdentity(env);
  requireCi(Object.hasOwn(IMAGE_REPOSITORIES, kind), 'registry-kind');
  const directory = path.join(env.RUNNER_TEMP, `pero-${kind}-${identity.runId}-${identity.attempt}-${identity.revision}`);
  const supplied = env[`PERO_CI_${kind.toUpperCase()}_ARTIFACT_DIR`];
  requireCi(supplied === directory && realpathSync(directory) === directory, 'registry-directory');
  return directory;
}
function descriptor(value) {
  requireCi(digestPattern.test(value?.digest ?? '') && Number.isSafeInteger(value.size) && value.size > 0, 'registry-descriptor');
}

/** Только OCI metadata; полные filesystem layers уже проверены прежним producer validator. */
export function metadataGraph(directory, record) {
  const layout = path.join(directory, 'oci'), root = JSON.parse(readFileSync(path.join(layout, 'index.json'), 'utf8'));
  requireCi(root.manifests?.length === 1 && root.manifests[0].digest === record.indexDigest, 'registry-root');
  const blobs = {}, visited = new Set();
  function blob(ref) {
    descriptor(ref); requireCi(ref.size <= HANDOFF_LIMIT, 'registry-metadata-size');
    const file = path.join(layout, 'blobs', 'sha256', ref.digest.slice(7)), stat = lstatSync(file);
    requireCi(realpathSync(file) === file && stat.isFile() && !stat.isSymbolicLink() && stat.size === ref.size, 'registry-metadata-file');
    const bytes = readFileSync(file); requireCi(sha256(bytes) === ref.digest, 'registry-metadata-digest');
    blobs[ref.digest] = bytes.toString('base64'); return JSON.parse(bytes);
  }
  function visit(ref, depth = 0) {
    requireCi(depth < 12 && visited.size < 128 && !visited.has(ref.digest), 'registry-graph'); visited.add(ref.digest);
    const value = blob(ref);
    if (indexTypes.includes(ref.mediaType)) {
      requireCi(Array.isArray(value.manifests) && value.manifests.length > 0, 'registry-index');
      for (const child of value.manifests) visit(child, depth + 1);
    } else {
      requireCi(manifestTypes.includes(ref.mediaType) && Array.isArray(value.layers), 'registry-manifest');
      blob(value.config);
      if (ref.annotations?.['vnd.docker.reference.type'] === 'attestation-manifest') {
        for (const layer of value.layers) { requireCi(layer.mediaType === 'application/vnd.in-toto+json', 'registry-attestation-type'); blob(layer); }
      }
    }
  }
  visit(root.manifests[0]); return { root: root.manifests[0], blobs };
}

/** Независимый consumer proof: outputs успешного producer закрепляют весь пакет байт-в-байт. */
export function verifyHandoff(bytes, kind, env = process.env) {
  requireCi(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= HANDOFF_LIMIT, 'registry-handoff-size');
  requireCi(digestPattern.test(env.PERO_CI_EXPECTED_HANDOFF_SHA256 ?? '') && sha256(bytes) === env.PERO_CI_EXPECTED_HANDOFF_SHA256, 'registry-handoff-hash');
  const context = registryContext(kind, env), packet = JSON.parse(bytes), record = packet.record;
  requireCi(packet.version === 1 && packet.kind === kind && packet.registry === context.registry && packet.tag === context.tag, 'registry-handoff-owner');
  for (const key of ['runId', 'attempt', 'revision']) requireCi(record?.[key] === context[key], 'registry-record-owner');
  requireCi(digestPattern.test(record.indexDigest ?? '') && record.indexDigest === env.PERO_CI_EXPECTED_INDEX_DIGEST &&
    digestPattern.test(record.ociSha256 ?? ''), 'registry-record-binding');
  const graph = packet.graph; requireCi(graph?.root?.digest === record.indexDigest && graph.blobs &&
    typeof graph.blobs === 'object' && !Array.isArray(graph.blobs) && Object.keys(graph.blobs).length <= 128, 'registry-root');
  const used = new Set(), visited = new Set(), runtime = [], attestations = [];
  function blob(ref) {
    descriptor(ref); requireCi(ref.size <= HANDOFF_LIMIT && typeof graph.blobs[ref.digest] === 'string', 'registry-metadata-missing');
    const bytes = Buffer.from(graph.blobs[ref.digest], 'base64');
    requireCi(bytes.toString('base64') === graph.blobs[ref.digest] && bytes.length === ref.size && sha256(bytes) === ref.digest, 'registry-metadata-digest');
    used.add(ref.digest); return JSON.parse(bytes);
  }
  function visit(ref, depth = 0) {
    requireCi(depth < 12 && visited.size < 128 && !visited.has(ref.digest), 'registry-graph'); visited.add(ref.digest);
    const value = blob(ref);
    if (indexTypes.includes(ref.mediaType)) {
      requireCi(Array.isArray(value.manifests) && value.manifests.length > 0, 'registry-index');
      for (const child of value.manifests) visit(child, depth + 1);
    } else {
      requireCi(manifestTypes.includes(ref.mediaType) && Array.isArray(value.layers), 'registry-manifest');
      const config = blob(value.config);
      for (const layer of value.layers) descriptor(layer);
      if (ref.annotations?.['vnd.docker.reference.type'] === 'attestation-manifest') {
        requireCi(value.layers.length > 0, 'registry-attestation');
        for (const layer of value.layers) { requireCi(layer.mediaType === 'application/vnd.in-toto+json', 'registry-attestation-type'); blob(layer); }
        attestations.push(ref);
      } else runtime.push({ ref, manifest: value, config });
    }
  }
  visit(graph.root);
  requireCi(Object.keys(graph.blobs).every(key => used.has(key)), 'registry-extra-blob');
  requireCi(runtime.length === 1 && attestations.length > 0 && equal(attestations, record.attestations), 'registry-provenance');
  const image = runtime[0], config = image.config, labels = config.config?.Labels;
  requireCi(config.os === 'linux' && config.architecture === 'amd64' && config.rootfs?.type === 'layers' &&
    image.ref.digest === record.manifestDigest && image.manifest.config.digest === record.configDigest &&
    equal(config.rootfs.diff_ids, record.diffIds) && equal(image.manifest.layers.map(layer => layer.digest), record.layerDigests), 'registry-runtime');
  requireCi(record.diffIds?.length === record.layerDigests?.length && record.diffIds.length > 0 &&
    record.diffIds.every(value => digestPattern.test(value)) &&
    image.manifest.layers.every(layer => !Object.hasOwn(graph.blobs, layer.digest)), 'registry-no-filesystem-layers');
  requireCi(attestations.every(ref => ref.annotations?.['vnd.docker.reference.digest'] === record.manifestDigest), 'registry-attestation-subject');
  const nodeVersion = config.config.Env?.find(value => value.startsWith('NODE_VERSION='))?.slice(13);
  requireCi(/^22\.\d+\.\d+$/.test(nodeVersion ?? '') && nodeVersion === record.runtimeNode, 'registry-node');
  const expectedLabels = { 'org.opencontainers.image.revision': context.revision, 'pero.ci.repository': context.repository,
    'pero.ci.run': context.runId, 'pero.ci.attempt': context.attempt, 'pero.ci.service': kind === 'renderer' ? 'kp-renderer' : kind };
  for (const [key, value] of Object.entries(expectedLabels)) requireCi(labels?.[key] === value, 'registry-label');
  if (kind === 'renderer') {
    for (const [key, value] of Object.entries(rendererLabels(context, record.nodeImage))) requireCi(labels[key] === value, 'registry-renderer-label');
    verifyRendererSmoke(record.smoke, context);
    requireCi(sha256(JSON.stringify(record.smoke)) === record.smokeSha256 && equal(record.template, record.smoke.template), 'registry-smoke');
    requireCi(config.config.User === 'node' && config.config.WorkingDir === '/app/apps/kp-renderer' &&
      config.config.Cmd?.join(' ') === 'node server.cjs', 'registry-renderer-entrypoint');
  } else if (kind === 'web') {
    requireCi(typeof record.buildId === 'string' && record.buildId.length > 0 && !/[\r\n]/.test(record.buildId) &&
      digestPattern.test(record.actionManifestSha256 ?? ''), 'registry-web-metadata');
  } else {
    const producer = record.producer;
    requireCi(labels['pero.ci.tested-dist'] === record.testedDistManifestSha256 && labels['pero.ci.producer'] === record.producerManifestSha256 &&
      digestPattern.test(record.testedDistManifestSha256 ?? '') && digestPattern.test(record.producerManifestSha256 ?? '') &&
      producer?.repository === context.repository && producer.revision === context.revision && producer.runId === context.runId &&
      producer.attempt === context.attempt && producer.name === 'unit-tests (backend)' && producer.conclusion === 'success' &&
      /^[1-9]\d*$/.test(producer.jobId ?? ''), 'registry-bot-producer');
  }
  return { record, config, rootBytes: Buffer.from(graph.blobs[graph.root.digest], 'base64'), rootType: graph.root.mediaType,
    repository: context.registry, tag: context.tag, source: `${context.registry}@${record.indexDigest}` };
}

export function readHandoff(kind, env = process.env) {
  const file = path.join(imageDirectory(kind, env), 'handoff.json'), stat = lstatSync(file);
  requireCi(stat.isFile() && !stat.isSymbolicLink() && stat.size <= HANDOFF_LIMIT && realpathSync(file) === file, 'registry-handoff-file');
  return verifyHandoff(readFileSync(file), kind, env);
}
export function regctl(env = process.env) {
  return (args, input, raw = false) => {
    try {
      const output = execFileSync(path.join(env.RUNNER_TEMP, 'regctl'), args,
        { input, encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
      return raw ? output : output.trim();
    }
    catch { throw new Error('CI registry command failed'); }
  };
}
export async function verifyPrivatePackage(kind, env = process.env, request = fetch) {
  const context = registryContext(kind, env, true), packageName = context.registry.split('/').at(-1);
  requireCi(typeof env.CI_REGISTRY_TOKEN === 'string' && env.CI_REGISTRY_TOKEN.length > 0, 'registry-token');
  const response = await request(`https://api.github.com/users/navasiolau/packages/container/${packageName}`, {
    redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15_000), headers: {
      Authorization: `Bearer ${env.CI_REGISTRY_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
  requireCi(response.status === 200, 'registry-package-http');
  const text = await response.text(); requireCi(text.length < 64 * 1024, 'registry-package-size');
  const value = JSON.parse(text);
  requireCi(value.name === packageName && value.package_type === 'container' && value.owner?.login === 'navasiolau' &&
    value.visibility === 'private', 'registry-private-package');
}
export async function stageImage(kind, env = process.env, cli = regctl(env), request = fetch) {
  const context = registryContext(kind, env, true), directory = imageDirectory(kind, env);
  const record = kind === 'renderer' ? await readRendererArtifact(true, env) : await readWebArtifact(true, env, kind);
  requireCi(record.indexDigest === env.PERO_CI_EXPECTED_INDEX_DIGEST, 'registry-stage-index');
  requireCi(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() === record.revision, 'registry-checkout');
  const bytes = Buffer.from(JSON.stringify({ version: 1, kind, registry: context.registry, tag: context.tag,
    record, graph: metadataGraph(directory, record) }));
  // Тот же consumer proof выполняется до записи в registry, с собственным SHA пакета.
  const consumer = kind === 'bot' ? 'build-push-bot' : 'build-push';
  verifyHandoff(bytes, kind, { ...env, GITHUB_JOB: consumer, PERO_CI_EXPECTED_HANDOFF_SHA256: sha256(bytes) });
  await verifyPrivatePackage(kind, env, request);
  cli(['image', 'copy', '--referrers', '--force-recursive', `ocidir://${directory}/oci@${record.indexDigest}`, `${context.registry}:${context.tag}`]);
  requireCi(cli(['image', 'digest', `${context.registry}:${context.tag}`]) === record.indexDigest, 'registry-staged-digest');
  writeFileSync(path.join(directory, 'handoff.json'), bytes, { flag: 'wx' });
  appendFileSync(env.GITHUB_OUTPUT, `handoff-sha256=${sha256(bytes)}\n`);
  console.log(JSON.stringify({ ciRuntime: 'oci-staged', kind, indexDigest: record.indexDigest, handoffBytes: bytes.length }));
  return { bytes: bytes.length, digest: sha256(bytes) };
}
export function promoteImage(kind, env = process.env, cli = regctl(env)) {
  const proof = readHandoff(kind, env), { record } = proof;
  const results = JSON.parse(env.PERO_CI_REQUIRED_RESULTS ?? '{}');
  const required = ['unit-tests', 'unit-tests-backend', 'native-tests', 'kp-renderer-tests'];
  requireCi(required.every(job => results[job]?.result === 'success'), 'registry-required-gates');
  requireCi(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() === record.revision, 'registry-checkout');
  requireCi(cli(['image', 'digest', proof.source]) === record.indexDigest, 'registry-source-digest');
  for (const tag of [`sha-${record.revision}`, env.GITHUB_REF_NAME]) {
    // В том же package все blobs уже существуют: PUT только исходного index, без GET layers.
    cli(['manifest', 'put', '--content-type', proof.rootType, `${proof.repository}:${tag}`], proof.rootBytes);
    requireCi(cli(['image', 'digest', `${proof.repository}:${tag}`]) === record.indexDigest, 'registry-promoted-digest');
  }
  writeFileSync(path.join(imageDirectory(kind, env), 'promotion.json'), JSON.stringify({ repository: proof.repository,
    indexDigest: record.indexDigest, revision: record.revision, runId: record.runId, attempt: record.attempt }), { flag: 'wx' });
  console.log(JSON.stringify({ ciRuntime: 'original-oci-promoted', kind, revision: record.revision,
    indexDigest: record.indexDigest, runId: record.runId, attempt: record.attempt }));
  return record;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [operation, kind] = process.argv.slice(2);
  try {
    requireCi(operation === 'stage' || operation === 'promote', 'registry-operation');
    if (operation === 'stage') await stageImage(kind); else promoteImage(kind);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
