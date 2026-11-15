import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import template from '../../../packages/kp-template/index.cjs';
import { readWebArtifact } from './integration/runtime/target.mjs';
import { readRendererArtifact, rendererLabels } from '../../kp-renderer/ci/artifact.mjs';
import { HANDOFF_LIMIT, metadataGraph, prepareReleaseRepository, promoteImage, readHandoff, registryContext, sha256, stageImage, verifyHandoff, verifyPrivatePackage } from './integration/runtime/registry-transport.mjs';

const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const identity = { repository: 'navasiolau/pero_crm', revision, runId: '169', attempt: '1' };
const base = 'node:22-bookworm-slim@sha256:' + 'b'.repeat(64);
const requiredResults = Object.fromEntries(['unit-tests', 'unit-tests-backend', 'native-tests', 'kp-renderer-tests'].map(job => [job, { result: 'success' }]));
const privatePackage = async url => new Response(JSON.stringify({ name: url.split('/').at(-1), package_type: 'container',
  owner: { login: 'navasiolau' }, visibility: 'private' }), { status: 200 });
const mountRegistry = async (url, options) => {
  const target = new URL(url);
  if (target.pathname === '/token') return new Response(JSON.stringify({ token: 'synthetic-registry-token' }), { status: 200 });
  if (options.method === 'HEAD') return new Response(null, { status: 404 });
  if (options.method === 'POST') return new Response(null, { status: 201, headers: { 'docker-content-digest': target.searchParams.get('mount') } });
  throw new Error('Unexpected filesystem transfer');
};
async function fixture(kind, rendererRecord) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'pero-registry-')));
  const directory = path.join(root, `pero-${kind}-169-1-${revision}`), layout = path.join(directory, 'oci');
  mkdirSync(path.join(layout, 'blobs', 'sha256'), { recursive: true });
  const env = { CI: 'true', GITHUB_ACTIONS: 'true', RUNNER_OS: 'Linux', RUNNER_ENVIRONMENT: 'github-hosted',
    GITHUB_REPOSITORY: identity.repository, GITHUB_SHA: revision, GITHUB_RUN_ID: '169', GITHUB_RUN_ATTEMPT: '1',
    GITHUB_EVENT_NAME: 'push', GITHUB_REF_NAME: 'staging', GITHUB_ACTOR: 'navasiolau', GITHUB_JOB: kind === 'renderer' ? 'kp-renderer-tests' : 'native-tests',
    RUNNER_TEMP: root, GITHUB_OUTPUT: path.join(root, 'outputs'), CI_REGISTRY_TOKEN: 'synthetic-token', [`PERO_CI_${kind.toUpperCase()}_ARTIFACT_DIR`]: directory };
  const blob = (value, mediaType, annotations) => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value)), digest = sha256(bytes);
    writeFileSync(path.join(layout, 'blobs', 'sha256', digest.slice(7)), bytes);
    return { mediaType, digest, size: bytes.length, ...(annotations ? { annotations } : {}) };
  };
  let labels = { 'org.opencontainers.image.revision': revision, 'pero.ci.repository': identity.repository,
    'pero.ci.run': '169', 'pero.ci.attempt': '1', 'pero.ci.service': kind };
  if (kind === 'web' && rendererRecord) {
    labels['pero.kp.renderer-index'] = rendererRecord.indexDigest; labels['pero.kp.protocol'] = '1';
    for (const [key, value] of Object.entries({ template: rendererRecord.template.templateHash, source: rendererRecord.template.sourceManifestHash,
      fonts: rendererRecord.template.fontManifestHash, chromium: rendererRecord.template.chromium, puppeteer: rendererRecord.template.puppeteer })) labels[`pero.kp.${key}`] = value;
  }
  const metadata = path.join(directory, 'metadata'); mkdirSync(path.join(metadata, 'server'), { recursive: true });
  if (kind === 'bot') {
    const tested = { revision, runId: '169', attempt: '1', files: { 'index.js': 'c'.repeat(64) } };
    const producer = { ...identity, jobId: '40', artifactId: '41', artifactDigest: 'sha256:' + 'd'.repeat(64),
      artifactName: `bot-dist-169-1-${revision}`, name: 'unit-tests (backend)', conclusion: 'success' };
    for (const [name, value] of [['tested', tested], ['producer', producer]]) {
      const bytes = JSON.stringify(value); writeFileSync(path.join(metadata, `${name}.json`), bytes);
      labels[`pero.ci.${name === 'tested' ? 'tested-dist' : 'producer'}`] = sha256(bytes);
    }
  }
  if (kind === 'renderer') labels = rendererLabels(identity, base);
  const layerBytes = Buffer.alloc(1024 * 1024, 7), layer = blob(layerBytes, 'application/vnd.oci.image.layer.v1.tar');
  const config = blob({ os: 'linux', architecture: 'amd64', rootfs: { type: 'layers', diff_ids: [layer.digest] },
    config: { Env: ['NODE_VERSION=22.20.0'], Labels: labels, ...(kind === 'renderer' ? {
      User: 'node', WorkingDir: '/app/apps/kp-renderer', Cmd: ['node', 'server.cjs'] } : {}) } }, 'application/vnd.oci.image.config.v1+json');
  const manifest = blob({ schemaVersion: 2, config, layers: [layer] }, 'application/vnd.oci.image.manifest.v1+json');
  const attestation = blob({ schemaVersion: 2, config: blob({}, 'application/vnd.oci.image.config.v1+json'),
    layers: [blob({ synthetic: true }, 'application/vnd.in-toto+json')] }, 'application/vnd.oci.image.manifest.v1+json',
  { 'vnd.docker.reference.type': 'attestation-manifest', 'vnd.docker.reference.digest': manifest.digest });
  const index = blob({ schemaVersion: 2, manifests: [manifest, attestation] }, 'application/vnd.oci.image.index.v1+json');
  writeFileSync(path.join(layout, 'index.json'), JSON.stringify({ manifests: [index] }));
  writeFileSync(path.join(layout, 'oci-layout'), '{"imageLayoutVersion":"1.0.0"}');
  writeFileSync(path.join(directory, `${kind}.oci.tar`), 'synthetic original archive');
  writeFileSync(path.join(metadata, 'BUILD_ID'), 'tested-build'); writeFileSync(path.join(metadata, 'server', 'server-reference-manifest.json'), '{}');
  if (kind === 'renderer') {
    const smoke = { revision, template: template.getKpTemplateIdentity(), runtime: { node: '22.20.0', browser: 'HeadlessChrome/141.0.7390.0',
      chromium: '141.0.0', puppeteer: '24.43.1' }, pages: 4, allPagesIdentical: true, originalDpr2AppendicesIdentical: true,
    docxEntriesIdentical: true, privateHttp: true, limitsVerified: true, streamedPdf: true };
    writeFileSync(path.join(directory, 'smoke.json'), JSON.stringify(smoke));
  }
  const record = kind === 'renderer' ? await readRendererArtifact(false, env) : await readWebArtifact(false, env, kind);
  writeFileSync(path.join(directory, 'image.json'), JSON.stringify(record));
  env.PERO_CI_EXPECTED_INDEX_DIGEST = record.indexDigest;
  env[kind === 'web' ? 'PERO_CI_EXPECTED_OCI_SHA256' : `PERO_CI_EXPECTED_${kind.toUpperCase()}_OCI_SHA256`] = record.ociSha256;
  if (kind === 'renderer') env.PERO_CI_EXPECTED_RENDERER_INDEX_DIGEST = record.indexDigest;
  return { env, root, directory, record, layer, layerBytes, cleanup() {
    assert.equal(path.dirname(root), realpathSync(os.tmpdir())); rmSync(root, { recursive: true });
  } };
}
function consumer(f, kind, bytes) {
  const root = path.join(f.root, 'consumer'), directory = path.join(root, `pero-${kind}-169-1-${revision}`);
  mkdirSync(directory, { recursive: true }); writeFileSync(path.join(directory, 'handoff.json'), bytes);
  return { ...f.env, RUNNER_TEMP: root, [`PERO_CI_${kind.toUpperCase()}_ARTIFACT_DIR`]: directory,
    GITHUB_JOB: kind === 'bot' ? 'build-push-bot' : 'build-push', PERO_CI_EXPECTED_HANDOFF_SHA256: sha256(bytes),
    PERO_CI_REQUIRED_RESULTS: JSON.stringify(requiredResults) };
}

for (const kind of ['web', 'bot', 'renderer']) {
  test(`${kind}: exact tested OCI is staged once and handoff contains no filesystem layer`, async () => {
    const f = await fixture(kind), calls = [];
    try {
      const staged = await stageImage(kind, f.env, args => { calls.push(args); return args[0] === 'image' && args[1] === 'digest' ? f.record.indexDigest : ''; }, privatePackage);
      const bytes = readFileSync(path.join(f.directory, 'handoff.json')), packet = JSON.parse(bytes), env = consumer(f, kind, bytes);
      assert.ok(bytes.length < 20_000 && staged.bytes === bytes.length && bytes.length < HANDOFF_LIMIT);
      assert.ok(!Object.hasOwn(packet.graph.blobs, f.layer.digest));
      assert.deepEqual(readHandoff(kind, env).record, f.record);
      assert.match(readFileSync(f.env.GITHUB_OUTPUT, 'utf8'), new RegExp(staged.digest));
      assert.equal(calls.filter(args => args[1] === 'copy').length, 1);
      assert.match(calls[0].at(-1), new RegExp(`:ci-169-1-${revision}$`));
      assert.ok(calls[0].includes(`ocidir://${f.directory}/oci@${f.record.indexDigest}`));
      assert.ok(calls.every(args => !args.some(value => /:(?:main|staging|sha-)/.test(value))));
      const promoted = [];
      const requests = [];
      assert.deepEqual(await promoteImage(kind, env, (args, input) => {
        promoted.push({ args, input }); return args[1] === 'digest' ? f.record.indexDigest : '';
      }, async (url, options) => { requests.push({ url, method: options.method }); return mountRegistry(url, options); }), f.record);
      assert.equal(promoted.filter(call => call.args[0] === 'manifest' && call.args[1] === 'put' && !call.args.includes('--by-digest')).length, 2);
      const proof = readHandoff(kind, env), metadataDigests = new Set(proof.manifests.map(value => value.descriptor.digest));
      assert.ok(promoted.every(call => (call.args[0] === 'image' && call.args[1] === 'digest') ||
        (call.args[0] === 'manifest' && call.args[1] === 'put' && metadataDigests.has(sha256(call.input)))));
      assert.ok(requests.every(value => new URL(value.url).pathname === '/token' || ['HEAD', 'POST'].includes(value.method)), 'нет GET filesystem layers');
      if (kind === 'renderer') assert.ok(requests.some(value => value.method === 'POST' && value.url.includes('mount=')), 'проверен межпакетный mount renderer');
      assert.equal(JSON.parse(readFileSync(path.join(env[`PERO_CI_${kind.toUpperCase()}_ARTIFACT_DIR`], 'promotion.json'))).indexDigest, f.record.indexDigest);
    } finally { f.cleanup(); }
  });
}

test('handoff rejects tampering, another run/attempt/kind, extra layers and oversized metadata', async () => {
  const f = await fixture('web');
  try {
    const context = registryContext('web', f.env, true), packet = { version: 1, kind: 'web', registry: context.registry, tag: context.tag,
      record: f.record, graph: metadataGraph(f.directory, f.record) }, bytes = Buffer.from(JSON.stringify(packet)), env = consumer(f, 'web', bytes);
    const changed = update => { const next = structuredClone(packet); update(next); const bytes = Buffer.from(JSON.stringify(next));
      return () => verifyHandoff(bytes, 'web', { ...env, PERO_CI_EXPECTED_HANDOFF_SHA256: sha256(bytes) }); };
    assert.throws(() => verifyHandoff(Buffer.concat([bytes, Buffer.from(' ')]), 'web', env), /handoff-hash/);
    for (const update of [p => { p.kind = 'bot'; }, p => { p.registry = 'ghcr.io/unrelated/image'; }, p => { p.tag = 'staging'; },
      p => { p.record.attempt = '2'; }, p => { p.record.runId = '170'; }, p => { p.record.revision = 'e'.repeat(40); },
      p => { p.record.configDigest = 'sha256:' + 'f'.repeat(64); }, p => { p.record.layerDigests = []; },
      p => { p.record.attestations = []; }, p => { p.graph.blobs[f.layer.digest] = f.layerBytes.toString('base64'); }]) {
      assert.throws(changed(update), /registry-/);
    }
    assert.throws(changed(p => { p.graph.blobs[p.graph.root.digest] = Buffer.from('{}').toString('base64'); }), /metadata-digest/);
    assert.throws(() => verifyHandoff(Buffer.alloc(HANDOFF_LIMIT + 1), 'web', env), /handoff-size/);
    assert.throws(() => registryContext('web', { ...f.env, GITHUB_EVENT_NAME: 'pull_request' }, true), /registry-push/);
    assert.throws(() => registryContext('web', { ...f.env, GITHUB_REF_NAME: 'bugfix/219' }, true), /registry-push/);
    for (const state of ['failure', 'cancelled', 'skipped', 'pending']) {
      let calls = 0;
      await assert.rejects(promoteImage('web', { ...env, PERO_CI_REQUIRED_RESULTS: JSON.stringify({ ...requiredResults,
        'unit-tests': { result: state } }) }, () => { calls++; return f.record.indexDigest; }), /required-gates/);
      assert.equal(calls, 0);
    }
    let puts = 0;
    await assert.rejects(promoteImage('web', env, args => { if (args[1] === 'put') puts++; return 'sha256:' + 'f'.repeat(64); }), /source-digest/);
    assert.equal(puts, 0);
  } finally { f.cleanup(); }
});

test('paired release CLI reproduces the existing packet from two metadata-only consumers', async () => {
  const renderer = await fixture('renderer'), web = await fixture('web', renderer.record);
  try {
    for (const [kind, f] of [['web', web], ['renderer', renderer]]) await stageImage(kind, f.env, args => args[1] === 'digest' ? f.record.indexDigest : '', privatePackage);
    const webBytes = readFileSync(path.join(web.directory, 'handoff.json')), rendererBytes = readFileSync(path.join(renderer.directory, 'handoff.json'));
    const webEnv = consumer(web, 'web', webBytes), rendererDirectory = path.join(webEnv.RUNNER_TEMP, `pero-renderer-169-1-${revision}`);
    mkdirSync(rendererDirectory); writeFileSync(path.join(rendererDirectory, 'handoff.json'), rendererBytes);
    const metadataOnly = { ...webEnv, PERO_CI_RENDERER_ARTIFACT_DIR: rendererDirectory };
    for (const [kind, record, bytes] of [['web', web.record, webBytes], ['renderer', renderer.record, rendererBytes]]) {
      await promoteImage(kind, { ...metadataOnly, PERO_CI_EXPECTED_INDEX_DIGEST: record.indexDigest,
        PERO_CI_EXPECTED_HANDOFF_SHA256: sha256(bytes) }, args => args[1] === 'digest' ? record.indexDigest : '', mountRegistry);
    }
    const output = path.join(webEnv.RUNNER_TEMP, 'release-outputs');
    execFileSync(process.execPath, ['apps/kp-renderer/ci/pipeline.mjs', 'release'], { cwd: fileURLToPath(new URL('../../../', import.meta.url)),
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...metadataOnly, GITHUB_OUTPUT: output,
        PERO_CI_EXPECTED_WEB_HANDOFF_SHA256: sha256(webBytes), PERO_CI_EXPECTED_WEB_INDEX_DIGEST: web.record.indexDigest,
        PERO_CI_EXPECTED_RENDERER_HANDOFF_SHA256: sha256(rendererBytes), PERO_CI_EXPECTED_RENDERER_INDEX_DIGEST: renderer.record.indexDigest },
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const directory = readFileSync(output, 'utf8').trim().slice('directory='.length);
    assert.equal(path.dirname(directory), webEnv.RUNNER_TEMP);
    const packet = JSON.parse(readFileSync(path.join(directory, 'release.json')));
    assert.equal(packet.images.web, `ghcr.io/navasiolau/pero_crm@${web.record.indexDigest}`);
    assert.equal(packet.images.renderer, `ghcr.io/navasiolau/pero_kp_renderer@${renderer.record.indexDigest}`);
    assert.equal(packet.enabled, false);
    assert.match(readFileSync(path.join(directory, 'kp-images.env'), 'utf8'), /PERO_KP_RELEASE_REVISION=/);
  } finally { web.cleanup(); renderer.cleanup(); }
});

test('candidate storage verifies the existing package is private and owned before any upload', async () => {
  const f = await fixture('web');
  try {
    await verifyPrivatePackage('web', f.env, privatePackage);
    let writes = 0;
    for (const change of [{ visibility: 'public' }, { name: 'unrelated' }, { owner: { login: 'someone-else' } }, { package_type: 'npm' }]) {
      const response = async () => new Response(JSON.stringify({ name: 'pero_crm', package_type: 'container', owner: { login: 'navasiolau' },
        visibility: 'private', ...change }), { status: 200 });
      await assert.rejects(stageImage('web', f.env, () => { writes++; }, response), /registry-private-package/);
    }
    await assert.rejects(verifyPrivatePackage('web', f.env, async () => new Response('{}', { status: 403 })), /package-http/);
    assert.equal(writes, 0);
  } finally { f.cleanup(); }
});

test('new renderer transport package starts private and is verified again before exposing handoff', async () => {
  const f = await fixture('renderer');
  try {
    let checked = 0;
    await stageImage('renderer', f.env, args => args[1] === 'digest' ? f.record.indexDigest : '', async url => {
      assert.match(url, /\/pero_kp_renderer_ci$/);
      return ++checked <= 2 ? new Response('{}', { status: 404 }) : privatePackage(url);
    });
    assert.equal(checked, 3);
    assert.equal(JSON.parse(readFileSync(path.join(f.directory, 'handoff.json'))).registry, 'ghcr.io/navasiolau/pero_kp_renderer_ci');
    await assert.rejects(verifyPrivatePackage('web', { ...f.env, GITHUB_JOB: 'native-tests' }, async () => new Response('{}', { status: 404 }), true), /package-http/);
  } finally { f.cleanup(); }
});

test('unsupported GHCR mount aborts its own empty upload and never downloads a filesystem layer', async () => {
  const f = await fixture('renderer');
  try {
    await stageImage('renderer', f.env, args => args[1] === 'digest' ? f.record.indexDigest : '', privatePackage);
    const bytes = readFileSync(path.join(f.directory, 'handoff.json')), env = consumer(f, 'renderer', bytes), proof = readHandoff('renderer', env);
    const calls = [], operations = [];
    await assert.rejects(prepareReleaseRepository(proof, env, args => { operations.push(args); }, async (url, options) => {
      calls.push({ url, method: options.method });
      if (new URL(url).pathname === '/token') return new Response('{"token":"synthetic"}', { status: 200 });
      if (options.method === 'HEAD') return new Response(null, { status: 404 });
      if (options.method === 'POST') return new Response(null, { status: 202, headers: { location: '/v2/navasiolau/pero_kp_renderer/blobs/uploads/owned-test-upload' } });
      if (options.method === 'DELETE') return new Response(null, { status: 204 });
      throw new Error('Forbidden filesystem GET');
    }), /mount-unsupported/);
    assert.equal(operations.length, 0); assert.equal(calls.at(-1).method, 'DELETE');
    assert.ok(calls.every(value => new URL(value.url).pathname === '/token' || value.method !== 'GET'));
  } finally { f.cleanup(); }
});
