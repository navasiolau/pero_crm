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
    HostConfig: { NetworkMode: 'none', ReadonlyRootfs: true, Memory: 1536 * 1024 * 1024, NanoCpus: 1_000_000_000, PidsLimit: 128, PortBindings: {}, Tmpfs: { '/tmp': 'rw,nosuid,exec,size=512m,mode=1777' } } };
  verifyOwnedSmokeContainer(container, identity, imageId);
  assert.throws(() => verifyOwnedSmokeContainer(container, { ...identity, runId: '185' }, imageId), /container-image|container-owner/);
  assert.throws(() => verifyOwnedSmokeContainer({ ...container, HostConfig: { ...container.HostConfig, NetworkMode: 'bridge' } }, identity, imageId), /bounds/);
  for (const options of ['rw,nosuid,size=512m,mode=1777', 'rw,nosuid,noexec,size=512m,mode=1777',
    'rw,nosuid,exec,noexec,size=512m,mode=1777', 'rw,nosuid,exec,size=1g,mode=1777', 'rw,nosuid,exec,size=512m,mode=0777']) {
    assert.throws(() => verifyOwnedSmokeContainer({ ...container, HostConfig: { ...container.HostConfig, Tmpfs: { '/tmp': options } } }, identity, imageId), /kp-smoke-tmpfs/);
  }
  verifyOwnedSmokeContainer({ ...container, HostConfig: { ...container.HostConfig, Tmpfs: { '/tmp': 'mode=1777,exec,size=512m,rw,nosuid' } } }, identity, imageId);
});

test('Chromium preflight projects actual mount noexec and executable file mode without raw mount paths', () => {
  const { chromiumMountFacts } = require('../ci/smoke.cjs');
  const line = flags => `99 88 0:77 / /tmp ${flags} - tmpfs tmpfs rw,size=524288k\n`;
  assert.deepEqual(chromiumMountFacts(line('rw,nosuid,nodev,noexec,relatime'), 0o100700),
    { filesystem: 'tmpfs', flags: ['rw', 'nosuid', 'nodev', 'noexec'], fileMode: '0700' });
  assert.deepEqual(chromiumMountFacts(line('rw,nosuid,nodev,relatime'), 0o100755),
    { filesystem: 'tmpfs', flags: ['rw', 'nosuid', 'nodev', 'exec'], fileMode: '0755' });
  assert.equal(chromiumMountFacts('99 88 0:77 / /var/tmp rw - tmpfs tmpfs rw', 0o100700).filesystem, 'missing');
});

test('smoke diagnostics retain phase and actionable codes while excluding assertion payloads and untrusted bodies', async () => {
  const { createDiagnostics, failureDetails, logSummary, rendererHttpError } = require('../ci/smoke.cjs');
  const entries = [], diagnostics = createDiagnostics(entry => entries.push(entry)), privatePayload = 'PRIVATE_PNG_DOCX_SECRET';
  diagnostics.phase('chromium-launch');
  diagnostics.failure(Object.assign(new Error('Failed to launch the browser process: libnss3.so: cannot open shared object file ' + privatePayload), { code: 'ENOENT' }));
  assert.equal(entries[1].phase, 'chromium-launch'); assert.equal(entries[1].error.code, 'ENOENT');
  assert.equal(entries[1].error.library, 'libnss3.so'); assert.ok(entries[1].error.native.includes('BROWSER_LAUNCH_FAILED'));
  const assertion = new assert.AssertionError({ message: privatePayload, actual: Buffer.alloc(100_000, 'p'), expected: privatePayload, operator: 'deepEqual' });
  const safe = failureDetails(assertion); assert.equal(safe.code, 'ERR_ASSERTION'); assert.ok(JSON.stringify(safe).length < 150);
  const http = failureDetails(await rendererHttpError(new Response(JSON.stringify({ error: 'KP_RENDER_WORKER_FAILED', details: privatePayload }), { status: 400 })));
  assert.deepEqual(http, { name: 'Error', code: 'KP_CI_HTTP_FAILURE', httpStatus: 400, rendererCode: 'KP_RENDER_WORKER_FAILED' });
  let cancelled = false;
  const oversized = new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(8192)); }, cancel() { cancelled = true; } }), { status: 502 });
  const bounded = await rendererHttpError(oversized); assert.equal(bounded.httpStatus, 502); assert.equal(bounded.rendererCode, undefined); assert.equal(cancelled, true);
  const logs = logSummary(privatePayload + '\n' + JSON.stringify(entries[0]) + '\n' + JSON.stringify(entries[1]) + '\n' + 'x'.repeat(70_000));
  assert.equal(logs.truncated, true); assert.ok(JSON.stringify({ safe, http, logs, entries }).length < 2000);
  assert.ok(!JSON.stringify({ safe, http, logs, entries }).includes(privatePayload));
  assert.deepEqual(logSummary(entries.map(entry => JSON.stringify(entry)).join('\n')).events, entries);
});

function ownedContainer(imageId) {
  return { Id: '4'.repeat(64), Name: '/pero-kp-184-1-smoke', Image: imageId,
    Config: { Image: imageId, User: 'node', Env: ['AUTH_SECRET=PRIVATE_ENV'], Labels: { 'pero.ci.repository': identity.repository,
      'pero.ci.run': '184', 'pero.ci.attempt': '1', 'pero.ci.service': 'kp-renderer-smoke' } },
    HostConfig: { NetworkMode: 'none', ReadonlyRootfs: true, Memory: 1536 * 1024 * 1024, NanoCpus: 1_000_000_000, PidsLimit: 128, PortBindings: {}, Tmpfs: { '/tmp': 'rw,nosuid,exec,size=512m,mode=1777' } },
    State: { Status: 'exited', Running: false, OOMKilled: true, ExitCode: 137, Error: 'PRIVATE_STATE_ERROR' } };
}

test('failed owned smoke saves bounded stderr/log/state before exact cleanup and preserves the original error', async () => {
  const { runOwnedSmoke } = await import('../ci/pipeline.mjs');
  const imageId = 'sha256:' + '3'.repeat(64), container = ownedContainer(imageId), calls = [], reports = [];
  const phase = { event: 'KP_CI_PHASE', phase: 'http-bundle' }, failure = { event: 'KP_CI_FAILURE', phase: 'http-bundle', error: { name: 'Error', code: 'KP_CI_HTTP_FAILURE', httpStatus: 400, rendererCode: 'KP_RENDER_WORKER_FAILED' } };
  const original = Object.assign(new Error('PRIVATE_DOCKER_ERROR'), { status: 1, stdout: 'PRIVATE_PDF_BYTES', stderr: JSON.stringify(failure) });
  let artifact;
  assert.throws(() => runOwnedSmoke({ id: container.Id, identity, imageId,
    command(args) { calls.push(args); if (args[0] === 'inspect') return JSON.stringify([container]); if (args[0] === 'start') throw original; return ''; },
    readLogs(args) { calls.push(args); return 'PRIVATE_LOG\n' + JSON.stringify(phase) + '\n' + JSON.stringify(failure); },
    accept() { assert.fail('failed process cannot produce a receipt'); },
    saveFailure(value) { calls.push(['save']); artifact = value; }, report(value) { reports.push(value); } }), error => error === original);
  assert.ok(calls.findIndex(args => args[0] === 'logs') < calls.findIndex(args => args[0] === 'save'));
  assert.ok(calls.findIndex(args => args[0] === 'save') < calls.findIndex(args => args[0] === 'rm'));
  assert.deepEqual(calls.at(-1), ['rm', '-f', container.Id]); assert.equal(artifact.state.oomKilled, true); assert.equal(artifact.state.exitCode, 137);
  assert.equal(artifact.phase, 'container-start'); assert.deepEqual(artifact.logs.events, [phase, failure]); assert.deepEqual(artifact.stderr.events, [failure]);
  assert.equal(reports.length, 1); assert.ok(!JSON.stringify(artifact).includes('PRIVATE_')); assert.equal(artifact.Config, undefined);
});

test('diagnostics and cleanup refuse an unowned container and cannot turn a failed process into success', async () => {
  const { runOwnedSmoke } = await import('../ci/pipeline.mjs');
  const imageId = 'sha256:' + '3'.repeat(64), container = ownedContainer(imageId), calls = [], artifacts = [];
  container.Config.Labels['pero.ci.run'] = '999';
  assert.throws(() => runOwnedSmoke({ id: container.Id, identity, imageId,
    command(args) { calls.push(args[0]); return JSON.stringify([container]); },
    readLogs() { assert.fail('unowned logs must not be read'); }, accept() { assert.fail('unowned start must not run'); },
    saveFailure(value) { artifacts.push(value); }, report() {} }), /CI_TARGET_REFUSED:kp-smoke-container-owner/);
  assert.deepEqual(calls, ['inspect', 'inspect', 'inspect']); assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].state, undefined); assert.equal(artifacts[0].logs, undefined);
  const original = Object.assign(new Error('failed'), { status: 9 });
  container.Config.Labels['pero.ci.run'] = '184';
  assert.throws(() => runOwnedSmoke({ id: container.Id, identity, imageId,
    command(args) { if (args[0] === 'inspect') return JSON.stringify([container]); if (args[0] === 'start') throw original; return ''; },
    accept() {}, saveFailure() { throw Object.assign(new Error(), { code: 'ENOSPC' }); }, report() {} }), error => error === original);
});

test('successful smoke still requires the real receipt and clean exit without creating failure evidence', async () => {
  const { runOwnedSmoke } = await import('../ci/pipeline.mjs'), { verifyRendererSmoke } = await import('../ci/artifact.mjs');
  const imageId = 'sha256:' + '3'.repeat(64), container = ownedContainer(imageId), calls = [];
  container.State.OOMKilled = false; container.State.ExitCode = 0;
  const receipt = { revision: identity.revision, template: template.getKpTemplateIdentity(), runtime: { node: '22.20.0', browser: 'HeadlessChrome/141.0.7390.0', chromium: '141.0.0', puppeteer: '24.43.1' },
    pages: 4, allPagesIdentical: true, originalDpr2AppendicesIdentical: true, docxEntriesIdentical: true, privateHttp: true, limitsVerified: true };
  const result = runOwnedSmoke({ id: container.Id, identity, imageId,
    command(args) { calls.push(args); if (args[0] === 'inspect') return JSON.stringify([container]); if (args[0] === 'start') return JSON.stringify(receipt); return ''; },
    accept: value => verifyRendererSmoke(value, identity), readLogs() { assert.fail('success does not need diagnostics'); },
    saveFailure() { assert.fail('success cannot produce failure evidence'); }, report() { assert.fail('success cannot report failure'); } });
  assert.deepEqual(result, receipt); assert.deepEqual(calls.at(-1), ['rm', '-f', container.Id]);
});
