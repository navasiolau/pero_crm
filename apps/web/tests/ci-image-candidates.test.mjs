import assert from 'node:assert/strict';
import { test } from 'node:test';
import { candidateTag, cleanupContext, executeCleanup, githubPorts, main, planCleanup } from '../../../.github/scripts/cleanup-ci-images.mjs';
import { sha256 } from './integration/runtime/registry-transport.mjs';

const now = Date.parse('2026-11-15T15:00:00Z'), old = '2026-11-01T00:00:00Z', recent = '2026-11-14T00:00:00Z', revision = 'a'.repeat(40);
const digest = value => 'sha256:' + value.repeat(64), mediaType = 'application/vnd.oci.image.manifest.v1+json';
const tag = `ci-169-1-${revision}`;
function graphFixture() {
  const manifests = new Map();
  const index = children => {
    const bytes = JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json',
      manifests: children.map(digest => ({ mediaType, digest, size: 123 })) });
    const hash = sha256(bytes); manifests.set(hash, bytes); return hash;
  };
  const version = (id, name, tags = [], updated = old) => ({ id, name, created_at: old, updated_at: updated,
    metadata: { package_type: 'container', container: { tags } } });
  const candidate = index([digest('1'), digest('2')]), release = index([digest('1'), digest('3')]);
  const versions = [version(1, candidate, [tag]), version(2, digest('1')), version(3, digest('2')),
    version(4, release, ['staging', 'sha-' + revision]), version(5, digest('3')), version(6, digest('4'))];
  const run = { id: 169, run_attempt: 1, repository: { full_name: 'navasiolau/pero_crm' }, path: '.github/workflows/ci-cd.yml',
    event: 'push', head_branch: 'staging', head_sha: revision, status: 'completed', conclusion: 'failure', updated_at: old };
  const getRun = async () => ({ current: structuredClone(run), attempt: structuredClone(run) });
  const getManifest = async (_, hash) => { assert.ok(manifests.has(hash), 'только известный OCI graph'); return manifests.get(hash); };
  return { versions, version, index, run, getRun, getManifest, manifests, candidate };
}
function portsFor(f) {
  const versions = structuredClone(f.versions), removed = [], reports = [];
  return { removed, reports, versions,
    listVersions: async () => structuredClone(versions),
    getVersion: async (_, id) => structuredClone(versions.find(value => value.id === id)),
    removeVersion: async (_, id) => { assert.ok(versions.some(value => value.id === id)); removed.push(id); versions.splice(versions.findIndex(value => value.id === id), 1); },
    getRun: f.getRun, getManifest: f.getManifest, report: value => reports.push(value) };
}
const env = { CI: 'true', GITHUB_ACTIONS: 'true', RUNNER_OS: 'Linux', RUNNER_ENVIRONMENT: 'github-hosted',
  GITHUB_REPOSITORY: 'navasiolau/pero_crm', GITHUB_REF_NAME: 'main', GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_WORKFLOW_REF: 'navasiolau/pero_crm/.github/workflows/ci-image-candidates.yml@refs/heads/main', CI_REGISTRY_TOKEN: 'synthetic-token' };

test('cleanup deletes only an old candidate and unshared child; protects release, shared and unknown orphan', async () => {
  const f = graphFixture(), ports = portsFor(f), plan = await planCleanup('pero_crm', f.versions, f.getManifest, f.getRun, now);
  assert.deepEqual(plan.entries.map(entry => entry.version.id), [1, 3]);
  assert.deepEqual(plan.preserved.map(entry => entry.id), [2, 4, 5, 6]);
  assert.deepEqual(await executeCleanup(plan, ports), [1, 3]);
  assert.deepEqual(ports.removed, [1, 3]);
  assert.deepEqual(ports.versions.map(value => value.id), [2, 4, 5, 6]);
  assert.equal(ports.reports.length, 2);
});
test('a candidate with a release/unknown tag, recent update or active run is retained', async () => {
  for (const change of [
    f => f.versions[0].metadata.container.tags.push('main'), f => f.versions[0].metadata.container.tags.push('keep-for-owner'),
    f => { f.versions[0].updated_at = recent; }, f => { f.run.status = 'in_progress'; f.run.conclusion = null; },
    f => { f.run.updated_at = recent; },
  ]) {
    const f = graphFixture(); change(f);
    const plan = await planCleanup('pero_crm', f.versions, f.getManifest, f.getRun, now);
    assert.deepEqual(plan.entries, []);
  }
});
test('graph uncertainty and wrong run identity fail before any deletion plan', async () => {
  const f = graphFixture();
  await assert.rejects(planCleanup('unrelated', f.versions, f.getManifest, f.getRun, now), /allowlist/);
  await assert.rejects(planCleanup('pero_crm', [...f.versions, f.versions[0]], f.getManifest, f.getRun, now), /duplicate/);
  await assert.rejects(planCleanup('pero_crm', f.versions, async () => '{}', f.getRun, now), /manifest-digest/);
  await assert.rejects(planCleanup('pero_crm', f.versions, f.getManifest, async () => ({ current: { ...f.run,
    repository: { full_name: 'another/repo' } }, attempt: f.run }), now), /run-owner/);
  const malformed = JSON.stringify({ schemaVersion: 2, manifests: [{ digest: digest('1'), size: 10, mediaType: 'unknown/type' }] });
  const hash = sha256(malformed), altered = structuredClone(f.versions); altered[0].name = hash;
  await assert.rejects(planCleanup('pero_crm', altered, async (_, value) => value === hash ? malformed : f.getManifest(_, value), f.getRun, now), /manifest-type/);
});
test('inventory, tag and run drift abort the complete preflight with no deletion', async () => {
  for (const field of ['inventory', 'tags', 'run']) {
    const f = graphFixture(), ports = portsFor(f), plan = await planCleanup('pero_crm', f.versions, f.getManifest, f.getRun, now);
    if (field === 'inventory') ports.versions[0].metadata.container.tags.push('main');
    if (field === 'tags') ports.getVersion = async (_, id) => {
      const value = structuredClone(ports.versions.find(value => value.id === id));
      if (id === 3) value.metadata.container.tags.push('keep'); return value;
    };
    if (field === 'run') ports.getRun = async () => ({ current: { ...f.run, status: 'in_progress' }, attempt: f.run });
    await assert.rejects(executeCleanup(plan, ports), /drift/);
    assert.deepEqual(ports.removed, []);
  }
});
test('each version is rechecked again immediately before deletion', async () => {
  const f = graphFixture(), ports = portsFor(f), plan = await planCleanup('pero_crm', f.versions, f.getManifest, f.getRun, now);
  let checks = 0;
  const original = ports.getVersion;
  ports.getVersion = async (...args) => { const value = await original(...args); if (++checks === 3) value.metadata.container.tags.push('staging'); return value; };
  await assert.rejects(executeCleanup(plan, ports), /version-drift/);
  assert.deepEqual(ports.removed, []);
});
test('dry-run constructs all three plans and never calls DELETE; target guards fail closed', async () => {
  const f = graphFixture(), ports = portsFor(f);
  await main(env, ports, now);
  assert.equal(ports.reports.length, 3); assert.deepEqual(ports.removed, []);
  assert.equal(cleanupContext(env).dryRun, true);
  assert.equal(cleanupContext({ ...env, CI_CANDIDATE_DRY_RUN: 'false' }).dryRun, false);
  for (const changed of [{ GITHUB_REF_NAME: 'staging' }, { GITHUB_EVENT_NAME: 'push' }, { CI: 'false' },
    { GITHUB_REPOSITORY: 'unrelated/repository' }, { GITHUB_WORKFLOW_REF: env.GITHUB_WORKFLOW_REF.replace('main', 'staging') },
    { CI_CANDIDATE_DRY_RUN: 'yes' }]) assert.throws(() => cleanupContext({ ...env, ...changed }), /refused/);
  assert.equal(candidateTag('main'), null); assert.equal(candidateTag(`ci-0169-1-${revision}`), null);
});
test('GitHub pagination follows only the exact package endpoint and refuses partial/foreign data', async () => {
  const f = graphFixture(), requests = [], ports = githubPorts(env, async (url, options) => {
    requests.push({ url, method: options.method });
    const page = new URL(url).searchParams.get('page');
    return new Response(JSON.stringify(page === '1' ? [f.versions[0]] : [f.versions[1]]), { status: 200,
      headers: page === '1' ? { link: '<https://api.github.com/users/navasiolau/packages/container/pero_crm/versions?per_page=100&page=2>; rel="next"' } : {} });
  });
  assert.equal((await ports.listVersions('pero_crm')).length, 2);
  assert.equal(requests.length, 2); assert.ok(requests.every(value => value.method === 'GET'));
  let count = 0;
  const unsafe = githubPorts(env, async () => { count++; return new Response('[]', { status: 200,
    headers: { link: '<https://unrelated.example/versions?page=2&per_page=100>; rel="next"' } }); });
  await assert.rejects(unsafe.listVersions('pero_crm'), /pagination/); assert.equal(count, 1);
  await assert.rejects(ports.listVersions('other_package'), /allowlist/);
  const denied = githubPorts(env, async () => new Response('{}', { status: 403 }));
  await assert.rejects(denied.listVersions('pero_crm'), /http-403/);
});
