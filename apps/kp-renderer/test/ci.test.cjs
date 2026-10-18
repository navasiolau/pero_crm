const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const template = require('@pero/kp-template');
const identity = { repository: 'navasiolau/pero_crm', revision: 'a'.repeat(40), runId: '184', attempt: '1' };
const base = 'node:22-bookworm-slim@sha256:' + 'b'.repeat(64);

test('OCI verification binds every blob, provenance subject, source/font pins and exact Docker projection', async () => {
  const ci = await import('../ci/artifact.mjs'), { verifyRuntimeProjection } = await import('../ci/pipeline.mjs');
  const directory = mkdtempSync(path.join(os.tmpdir(), 'pero-kp-ci-')), layout = path.join(directory, 'oci');
  mkdirSync(path.join(layout, 'blobs/sha256'), { recursive: true });
  const blob = (value, mediaType, annotations) => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value)), digest = ci.sha(bytes);
    writeFileSync(path.join(layout, 'blobs/sha256', digest.slice(7)), bytes);
    return { mediaType, digest, size: bytes.length, ...(annotations ? { annotations } : {}) };
  };
  const layer = blob(Buffer.from('synthetic immutable layer'), 'application/vnd.oci.image.layer.v1.tar');
  const config = blob({ os: 'linux', architecture: 'amd64', rootfs: { type: 'layers', diff_ids: [layer.digest] },
    config: { User: 'node', WorkingDir: '/app/apps/kp-renderer', Cmd: ['node', '--max-old-space-size=384', 'server.cjs'], Env: ['NODE_VERSION=22.20.0'], Labels: ci.rendererLabels(identity, base) } }, 'application/vnd.oci.image.config.v1+json');
  const manifest = blob({ schemaVersion: 2, config, layers: [layer] }, 'application/vnd.oci.image.manifest.v1+json');
  const attestation = blob({ config: blob({}, 'application/vnd.oci.image.config.v1+json'), layers: [blob({ test: true }, 'application/vnd.in-toto+json')] },
    'application/vnd.oci.image.manifest.v1+json', { 'vnd.docker.reference.type': 'attestation-manifest', 'vnd.docker.reference.digest': manifest.digest });
  const index = blob({ schemaVersion: 2, manifests: [manifest, attestation] }, 'application/vnd.oci.image.index.v1+json');
  writeFileSync(path.join(layout, 'index.json'), JSON.stringify({ manifests: [index] })); writeFileSync(path.join(layout, 'oci-layout'), '{"imageLayoutVersion":"1.0.0"}');
  writeFileSync(path.join(directory, 'renderer.oci.tar'), 'synthetic archive checksum');
  try {
    const record = await ci.verifyRendererOci(directory, identity);
    verifyRuntimeProjection({ Id: config.digest, RootFS: { Layers: [layer.digest] }, Os: 'linux', Architecture: 'amd64' }, record);
    assert.throws(() => verifyRuntimeProjection({ Id: 'sha256:' + '0'.repeat(64) }, record), /runtime-projection/);
    await assert.rejects(ci.verifyRendererOci(directory, { ...identity, revision: 'c'.repeat(40) }), /label/);
    const file = path.join(layout, 'blobs/sha256', layer.digest.slice(7)), original = readFileSync(file); writeFileSync(file, Buffer.alloc(original.length));
    await assert.rejects(ci.verifyRendererOci(directory, identity), /oci-blob/);
  } finally { assert.equal(path.dirname(directory), path.resolve(os.tmpdir())); rmSync(directory, { recursive: true }); }
});

test('CI smoke and paired release reject a different browser, revision or unpromoted digest', async () => {
  const ci = await import('../ci/artifact.mjs');
  const smoke = { revision: identity.revision, template: template.getKpTemplateIdentity(), runtime: { node: '22.20.0', browser: 'HeadlessChrome/141.0.7390.0', chromium: '141.0.0', puppeteer: '24.43.1' },
    pages: 4, allPagesIdentical: true, originalDpr2AppendicesIdentical: true, docxEntriesIdentical: true, privateHttp: true, limitsVerified: true };
  ci.verifyRendererSmoke(smoke, identity);
  assert.throws(() => ci.verifyRendererSmoke({ ...smoke, runtime: { ...smoke.runtime, browser: 'Chrome/153.0.0.0' } }, identity), /smoke-runtime/);
  assert.throws(() => ci.verifyRendererSmoke({ ...smoke, docxEntriesIdentical: false }, identity), /smoke-results/);
  const web = { ...identity, indexDigest: 'sha256:' + '1'.repeat(64), buildId: 'build' };
  const renderer = { ...identity, indexDigest: 'sha256:' + '2'.repeat(64), template: smoke.template, smokeSha256: ci.sha('smoke') };
  const labels = { ...ci.rendererLabels(identity, base), 'pero.kp.renderer-index': renderer.indexDigest };
  ci.verifyWebRendererBinding(labels, renderer);
  assert.throws(() => ci.verifyWebRendererBinding({ ...labels, 'pero.kp.renderer-index': web.indexDigest }, renderer), /web-renderer-binding/);
  const promotions = { web: { ...web, repository: ci.WEB_REPOSITORY }, renderer: { ...renderer, repository: ci.RENDERER_REPOSITORY } };
  const packet = ci.pairedRelease(web, renderer, promotions);
  assert.equal(packet.images.web, ci.WEB_REPOSITORY + '@' + web.indexDigest); assert.equal(packet.enabled, false);
  assert.throws(() => ci.pairedRelease(web, { ...renderer, revision: 'd'.repeat(40) }, promotions), /release-owner/);
  assert.throws(() => ci.pairedRelease(web, renderer, { ...promotions, renderer: { ...promotions.renderer, indexDigest: web.indexDigest } }), /release-promotion/);
});

test('CI cleanup requires the exact owned ID, image and private bounded container', async () => {
  const { verifyOwnedSmokeContainer } = await import('../ci/pipeline.mjs');
  const imageId = 'sha256:' + '3'.repeat(64), container = { Id: '4'.repeat(64), Name: '/pero-kp-184-1-smoke', Image: imageId,
    Config: { Image: imageId, User: 'node', Labels: { 'pero.ci.repository': identity.repository, 'pero.ci.run': '184', 'pero.ci.attempt': '1', 'pero.ci.service': 'kp-renderer-smoke' } },
    HostConfig: { NetworkMode: 'none', ReadonlyRootfs: true, Memory: 1536 * 1024 * 1024, NanoCpus: 1_000_000_000, PidsLimit: 128, PortBindings: {}, Tmpfs: { '/tmp': 'rw,size=512m' } } };
  verifyOwnedSmokeContainer(container, identity, imageId);
  assert.throws(() => verifyOwnedSmokeContainer(container, { ...identity, runId: '185' }, imageId), /container-image|container-owner/);
  assert.throws(() => verifyOwnedSmokeContainer({ ...container, HostConfig: { ...container.HostConfig, NetworkMode: 'bridge' } }, identity, imageId), /bounds/);
});
