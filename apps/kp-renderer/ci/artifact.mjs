import { createHash } from 'node:crypto';
import { createReadStream, lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import template from '../../../packages/kp-template/index.cjs';
import { artifactIdentity, requireCi } from '../../web/tests/integration/runtime/target.mjs';

export const RENDERER_REPOSITORY = 'ghcr.io/navasiolau/pero_kp_renderer';
export const WEB_REPOSITORY = 'ghcr.io/navasiolau/pero_crm';
export const sha = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
export async function fileSha(file) {
  requireCi(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(), 'kp-artifact-file');
  const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk);
  return `sha256:${hash.digest('hex')}`;
}
export function rendererLabels(identity, nodeImage, expected = template.getKpTemplateIdentity()) {
  requireCi(/^node:22-bookworm-slim@sha256:[a-f0-9]{64}$/.test(nodeImage), 'kp-base-image');
  return { 'org.opencontainers.image.revision': identity.revision, 'pero.ci.repository': identity.repository,
    'pero.ci.run': identity.runId, 'pero.ci.attempt': identity.attempt, 'pero.ci.service': 'kp-renderer',
    'pero.kp.template': expected.templateHash, 'pero.kp.source': expected.sourceManifestHash,
    'pero.kp.fonts': expected.fontManifestHash, 'pero.kp.chromium': expected.chromium,
    'pero.kp.puppeteer': expected.puppeteer, 'pero.kp.node-image': nodeImage, 'pero.kp.protocol': '1' };
}
export function verifyRendererSmoke(smoke, identity, expected = template.getKpTemplateIdentity()) {
  requireCi(smoke.revision === identity.revision && JSON.stringify(smoke.template) === JSON.stringify(expected), 'kp-smoke-source');
  requireCi(/^22\.\d+\.\d+$/.test(smoke.runtime?.node ?? '') && /^(?:HeadlessChrome|Chrome|Chromium)\/141\./.test(smoke.runtime?.browser ?? '') &&
    smoke.runtime?.chromium === expected.chromium && smoke.runtime?.puppeteer === expected.puppeteer, 'kp-smoke-runtime');
  requireCi(Number.isSafeInteger(smoke.pages) && smoke.pages >= 4 && smoke.pages <= template.KP_RENDER_LIMITS.pages &&
    smoke.allPagesIdentical === true && smoke.originalDpr2AppendicesIdentical === true && smoke.docxEntriesIdentical === true &&
    smoke.privateHttp === true && smoke.limitsVerified === true, 'kp-smoke-results');
  return smoke;
}
/** Полный OCI-граф и runtime projection; функция сама Docker не запускает. */
export async function verifyRendererOci(directory, identity, expected = template.getKpTemplateIdentity()) {
  const layout = path.join(directory, 'oci');
  requireCi(realpathSync(directory) === directory && realpathSync(layout) === layout, 'kp-artifact-path');
  requireCi(JSON.parse(readFileSync(path.join(layout, 'oci-layout'), 'utf8')).imageLayoutVersion === '1.0.0', 'kp-oci-layout');
  const root = JSON.parse(readFileSync(path.join(layout, 'index.json'), 'utf8'));
  requireCi(root.manifests?.length === 1, 'kp-oci-root');
  const runtime = [], attestations = []; let visited = 0;
  async function blob(descriptor) {
    requireCi(/^sha256:[a-f0-9]{64}$/.test(descriptor?.digest ?? '') && Number.isSafeInteger(descriptor.size) && descriptor.size > 0, 'kp-oci-descriptor');
    const file = path.join(layout, 'blobs', 'sha256', descriptor.digest.slice(7));
    requireCi(realpathSync(file) === file && lstatSync(file).size === descriptor.size && await fileSha(file) === descriptor.digest, 'kp-oci-blob');
    return file;
  }
  async function visit(descriptor, depth = 0) {
    requireCi(++visited < 128 && depth < 12, 'kp-oci-depth');
    const file = await blob(descriptor); requireCi(descriptor.size <= 4 * 1024 * 1024, 'kp-oci-manifest-size');
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    if (manifest.manifests) { for (const child of manifest.manifests) await visit(child, depth + 1); return; }
    const config = JSON.parse(readFileSync(await blob(manifest.config), 'utf8'));
    for (const layer of manifest.layers) await blob(layer);
    if (descriptor.annotations?.['vnd.docker.reference.type'] === 'attestation-manifest') {
      requireCi(manifest.layers.some(layer => layer.mediaType === 'application/vnd.in-toto+json'), 'kp-oci-attestation'); attestations.push(descriptor);
    } else {
      requireCi(config.os === 'linux' && config.architecture === 'amd64' && config.rootfs?.type === 'layers', 'kp-oci-platform');
      runtime.push({ descriptor, manifest, config });
    }
  }
  await visit(root.manifests[0]);
  requireCi(runtime.length === 1 && attestations.length > 0, 'kp-oci-provenance');
  const image = runtime[0], labels = image.config.config.Labels;
  requireCi(attestations.every(descriptor => descriptor.annotations?.['vnd.docker.reference.digest'] === image.descriptor.digest), 'kp-oci-attestation-subject');
  const expectedLabels = rendererLabels(identity, labels?.['pero.kp.node-image'], expected);
  for (const [key, value] of Object.entries(expectedLabels)) requireCi(labels?.[key] === value, `kp-oci-label:${key}`);
  requireCi(image.config.config.User === 'node' && image.config.config.WorkingDir === '/app/apps/kp-renderer' &&
    image.config.config.Cmd?.join(' ') === 'node --max-old-space-size=384 server.cjs', 'kp-oci-entrypoint');
  const node = image.config.config.Env.find(value => value.startsWith('NODE_VERSION='))?.slice(13);
  requireCi(/^22\.\d+\.\d+$/.test(node ?? '') && !image.config.config.Env.some(value => /^PERO_KP_(?:CHROMIUM_PATH|RENDERER_SECRET)=/.test(value)), 'kp-oci-environment');
  return { ...identity, runtimeNode: node, nodeImage: labels['pero.kp.node-image'], template: expected,
    indexDigest: root.manifests[0].digest, manifestDigest: image.descriptor.digest, configDigest: image.manifest.config.digest,
    diffIds: image.config.rootfs.diff_ids, layerDigests: image.manifest.layers.map(layer => layer.digest), attestations,
    ociSha256: await fileSha(path.join(directory, 'renderer.oci.tar')) };
}
export async function readRendererArtifact(receipt = true, env = process.env) {
  const identity = artifactIdentity(env), directory = path.join(env.RUNNER_TEMP, `pero-renderer-${identity.runId}-${identity.attempt}-${identity.revision}`);
  requireCi(env.PERO_CI_RENDERER_ARTIFACT_DIR === directory, 'kp-artifact-directory');
  const image = await verifyRendererOci(directory, identity);
  const smokeFile = path.join(directory, 'smoke.json'), smoke = verifyRendererSmoke(JSON.parse(readFileSync(smokeFile, 'utf8')), identity);
  const record = { ...image, smoke, smokeSha256: await fileSha(smokeFile) };
  if (receipt) {
    requireCi(JSON.stringify(JSON.parse(readFileSync(path.join(directory, 'image.json'), 'utf8'))) === JSON.stringify(record), 'kp-artifact-receipt');
    requireCi(env.PERO_CI_EXPECTED_RENDERER_OCI_SHA256 === record.ociSha256 && env.PERO_CI_EXPECTED_RENDERER_INDEX_DIGEST === record.indexDigest, 'kp-artifact-job-binding');
  }
  return record;
}
export function verifyWebRendererBinding(labels, renderer) {
  requireCi(labels?.['pero.kp.renderer-index'] === renderer.indexDigest && labels?.['pero.kp.protocol'] === '1', 'kp-web-renderer-binding');
  for (const [key, value] of Object.entries({ template: renderer.template.templateHash, source: renderer.template.sourceManifestHash,
    fonts: renderer.template.fontManifestHash, chromium: renderer.template.chromium, puppeteer: renderer.template.puppeteer })) {
    requireCi(labels[`pero.kp.${key}`] === value, 'kp-web-template-binding');
  }
  for (const [key, value] of Object.entries({ 'org.opencontainers.image.revision': renderer.revision, 'pero.ci.repository': renderer.repository,
    'pero.ci.run': renderer.runId, 'pero.ci.attempt': renderer.attempt })) requireCi(labels[key] === value, 'kp-web-release-binding');
}
export function pairedRelease(web, renderer, promotions) {
  for (const key of ['revision', 'runId', 'attempt']) requireCi(web[key] === renderer[key], 'kp-release-owner');
  const pair = { web: `${WEB_REPOSITORY}@${web.indexDigest}`, renderer: `${RENDERER_REPOSITORY}@${renderer.indexDigest}` };
  for (const [kind, record, repository] of [['web', web, WEB_REPOSITORY], ['renderer', renderer, RENDERER_REPOSITORY]]) {
    const promotion = promotions[kind];
    requireCi(/^sha256:[a-f0-9]{64}$/.test(record.indexDigest) && promotion?.repository === repository &&
      ['indexDigest', 'revision', 'runId', 'attempt'].every(key => promotion[key] === record[key]), 'kp-release-promotion');
  }
  return { version: 1, repository: 'navasiolau/pero_crm', revision: web.revision, runId: web.runId, attempt: web.attempt,
    images: pair, webBuildId: web.buildId, template: renderer.template, rendererSmokeSha256: renderer.smokeSha256,
    profile: 'kp', enabled: false };
}
