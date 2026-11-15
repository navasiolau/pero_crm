import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IMAGE_REPOSITORIES, regctl, sha256 } from '../../apps/web/tests/integration/runtime/registry-transport.mjs';

export const CANDIDATE_AGE_MS = 72 * 60 * 60_000;
const owner = 'navasiolau', repository = `${owner}/pero_crm`;
const packages = Object.values(IMAGE_REPOSITORIES).map(value => value.split('/').at(-1));
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const indexTypes = ['application/vnd.oci.image.index.v1+json', 'application/vnd.docker.distribution.manifest.list.v2+json'];
const manifestTypes = ['application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json'];
function guard(condition, code) { if (!condition) throw new Error(`CI candidate cleanup refused: ${code}`); }
export function candidateTag(tag) {
  const match = /^ci-([1-9]\d*)-([1-9]\d*)-([a-f0-9]{40})$/.exec(tag);
  return match ? { runId: match[1], attempt: match[2], revision: match[3] } : null;
}
export function versionSnapshot(value) {
  guard(Number.isSafeInteger(value?.id) && value.id > 0 && digestPattern.test(value.name ?? '') &&
    value.metadata?.package_type === 'container' && Array.isArray(value.metadata.container?.tags), 'version-schema');
  const tags = value.metadata.container.tags;
  guard(tags.every(tag => typeof tag === 'string' && /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag)) && new Set(tags).size === tags.length &&
    Number.isFinite(Date.parse(value.created_at)) && Number.isFinite(Date.parse(value.updated_at)), 'version-metadata');
  return { id: value.id, digest: value.name, tags: [...tags].sort(), created: value.created_at, updated: value.updated_at };
}
function inventory(versions) {
  guard(Array.isArray(versions) && versions.length <= 10_000, 'inventory-size');
  const entries = versions.map(versionSnapshot).sort((a, b) => a.id - b.id);
  guard(new Set(entries.map(value => value.id)).size === entries.length && new Set(entries.map(value => value.digest)).size === entries.length, 'inventory-duplicate');
  return { entries, fingerprint: sha256(JSON.stringify(entries)) };
}
function runSnapshot(value, tag) {
  guard(value && value.current && value.attempt, 'run-schema');
  const result = {};
  for (const name of ['current', 'attempt']) {
    const run = value[name];
    guard(String(run.id) === tag.runId && run.repository?.full_name === repository && run.path === '.github/workflows/ci-cd.yml' &&
      run.event === 'push' && ['main', 'staging'].includes(run.head_branch) && run.head_sha === tag.revision &&
      Number.isSafeInteger(run.run_attempt) && run.run_attempt >= Number(tag.attempt) && Number.isFinite(Date.parse(run.updated_at)), 'run-owner');
    if (name === 'attempt') guard(String(run.run_attempt) === tag.attempt, 'run-attempt');
    result[name] = { id: String(run.id), attempt: run.run_attempt, updated: run.updated_at, status: run.status, conclusion: run.conclusion };
  }
  return result;
}
const oldEnough = (version, cutoff) => Date.parse(version.created) < cutoff && Date.parse(version.updated) < cutoff;
const completeAndOld = (proof, cutoff) => Object.values(proof).every(run => run.status === 'completed' && typeof run.conclusion === 'string' && Date.parse(run.updated) < cutoff);

/** План сначала получает полный inventory и защищённую достижимость; API удаления здесь нет. */
export async function planCleanup(packageName, versions, getManifest, getRun, now = Date.now()) {
  guard(packages.includes(packageName) && Number.isFinite(now), 'package-allowlist');
  const { entries, fingerprint } = inventory(versions), cutoff = now - CANDIDATE_AGE_MS, eligible = new Map();
  for (const version of entries) {
    if (version.tags.length !== 1 || !candidateTag(version.tags[0]) || !oldEnough(version, cutoff)) continue;
    const tag = candidateTag(version.tags[0]), proof = runSnapshot(await getRun(tag), tag);
    if (completeAndOld(proof, cutoff)) eligible.set(version.id, { version, tag, proof });
  }
  if (!eligible.size) return { packageName, fingerprint, entries: [], preserved: entries, cutoff };
  const graphCache = new Map();
  async function graph(digest, active = new Set()) {
    guard(digestPattern.test(digest) && !active.has(digest) && active.size < 12, 'manifest-graph');
    if (graphCache.has(digest)) return graphCache.get(digest);
    const bytes = Buffer.from(await getManifest(packageName, digest));
    guard(bytes.length <= 4 * 1024 * 1024 && sha256(bytes) === digest, 'manifest-digest');
    const manifest = JSON.parse(bytes), result = new Set([digest]);
    if (Array.isArray(manifest.manifests)) {
      guard(manifest.manifests.length > 0 && manifest.manifests.length < 128, 'manifest-index');
      const next = new Set([...active, digest]);
      for (const child of manifest.manifests) {
        guard(digestPattern.test(child.digest ?? '') && Number.isSafeInteger(child.size) && child.size > 0, 'manifest-descriptor');
        if (indexTypes.includes(child.mediaType)) for (const value of await graph(child.digest, next)) result.add(value);
        else { guard(manifestTypes.includes(child.mediaType), 'manifest-type'); result.add(child.digest); }
      }
    } else guard(manifest.schemaVersion === 2 && manifest.config && Array.isArray(manifest.layers), 'manifest-type');
    graphCache.set(digest, result); return result;
  }
  const protectedDigests = new Set(), owned = new Map();
  for (const version of entries.filter(version => version.tags.length > 0)) {
    const reachable = await graph(version.digest);
    if (!eligible.has(version.id)) for (const digest of reachable) protectedDigests.add(digest);
    else for (const digest of reachable) {
      const roots = owned.get(digest) ?? []; roots.push(eligible.get(version.id)); owned.set(digest, roots);
    }
  }
  const deletions = entries.filter(version => owned.has(version.digest) && !protectedDigests.has(version.digest) &&
    oldEnough(version, cutoff) && (version.tags.length === 0 || eligible.has(version.id)))
    .map(version => ({ version, roots: owned.get(version.digest) }))
    .sort((a, b) => Number(!eligible.has(a.version.id)) - Number(!eligible.has(b.version.id)) || a.version.id - b.version.id);
  const deletedIds = new Set(deletions.map(entry => entry.version.id));
  return { packageName, fingerprint, entries: deletions, preserved: entries.filter(version => !deletedIds.has(version.id)), cutoff };
}

/** Повторный полный preflight и exact-ID проверки непосредственно перед каждой операцией. */
export async function executeCleanup(plan, ports) {
  guard(packages.includes(plan.packageName), 'package-allowlist');
  guard(inventory(await ports.listVersions(plan.packageName)).fingerprint === plan.fingerprint, 'inventory-drift');
  async function recheck(entry) {
    const current = versionSnapshot(await ports.getVersion(plan.packageName, entry.version.id));
    guard(JSON.stringify(current) === JSON.stringify(entry.version) && oldEnough(current, plan.cutoff), 'version-drift');
    for (const root of entry.roots) {
      const currentRun = runSnapshot(await ports.getRun(root.tag), root.tag);
      guard(JSON.stringify(currentRun) === JSON.stringify(root.proof) && completeAndOld(currentRun, plan.cutoff), 'run-drift');
    }
  }
  for (const entry of plan.entries) await recheck(entry);
  const removed = [];
  for (const entry of plan.entries) {
    await recheck(entry);
    await ports.removeVersion(plan.packageName, entry.version.id);
    removed.push(entry.version.id);
    ports.report?.({ event: 'ci-candidate-version-deleted', package: plan.packageName, id: entry.version.id, digest: entry.version.digest });
  }
  const after = inventory(await ports.listVersions(plan.packageName)).entries;
  guard(removed.every(id => !after.some(version => version.id === id)) &&
    plan.preserved.every(version => after.some(current => current.id === version.id && current.digest === version.digest)), 'cleanup-readback');
  return removed;
}

export function cleanupContext(env = process.env) {
  guard(env.CI === 'true' && env.GITHUB_ACTIONS === 'true' && env.RUNNER_OS === 'Linux' && env.RUNNER_ENVIRONMENT === 'github-hosted' &&
    env.GITHUB_REPOSITORY === repository && env.GITHUB_REF_NAME === 'main' &&
    env.GITHUB_WORKFLOW_REF === `${repository}/.github/workflows/ci-image-candidates.yml@refs/heads/main` &&
    ['schedule', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME), 'target');
  guard(['true', 'false'].includes(env.CI_CANDIDATE_DRY_RUN ?? 'true') && typeof env.CI_REGISTRY_TOKEN === 'string' &&
    env.CI_REGISTRY_TOKEN.length > 0, 'credentials-or-mode');
  return { dryRun: env.CI_CANDIDATE_DRY_RUN !== 'false' };
}
export function githubPorts(env = process.env, request = fetch, cli = regctl(env)) {
  const base = `https://api.github.com/users/${owner}/packages/container/`;
  const resource = packageName => { guard(packages.includes(packageName), 'package-allowlist'); return `${base}${packageName}/versions`; };
  async function api(url, method = 'GET') {
    const parsed = new URL(url);
    guard(parsed.origin === 'https://api.github.com' && (parsed.pathname.startsWith(`/users/${owner}/packages/container/`) ||
      /^\/repos\/navasiolau\/pero_crm\/actions\/runs\/[1-9]\d*(?:\/attempts\/[1-9]\d*)?$/.test(parsed.pathname)), 'api-target');
    const response = await request(url, { method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${env.CI_REGISTRY_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
    guard(response.status === (method === 'DELETE' ? 204 : 200), `http-${response.status}`);
    if (method === 'DELETE') return {};
    const text = await response.text(); guard(text.length <= 4 * 1024 * 1024, 'api-size');
    return { data: JSON.parse(text), link: response.headers.get('link') ?? '' };
  }
  return {
    async listVersions(packageName) {
      const output = [], root = resource(packageName);
      for (let page = 1; page <= 100; page++) {
        const { data, link } = await api(`${root}?per_page=100&page=${page}`);
        guard(Array.isArray(data) && data.length <= 100, 'versions-page'); output.push(...data);
        const next = /<([^>]+)>;\s*rel="next"/.exec(link);
        if (!next) return output;
        const nextUrl = new URL(next[1]);
        guard(nextUrl.origin + nextUrl.pathname === root && nextUrl.searchParams.get('per_page') === '100' &&
          nextUrl.searchParams.get('page') === String(page + 1) && page < 100, 'pagination');
      }
      throw new Error('CI candidate cleanup refused: incomplete-pagination');
    },
    async getVersion(packageName, id) { guard(Number.isSafeInteger(id) && id > 0, 'version-id'); return (await api(`${resource(packageName)}/${id}`)).data; },
    async removeVersion(packageName, id) { guard(Number.isSafeInteger(id) && id > 0, 'version-id'); await api(`${resource(packageName)}/${id}`, 'DELETE'); },
    async getRun(tag) {
      guard(candidateTag(`ci-${tag.runId}-${tag.attempt}-${tag.revision}`), 'run-tag');
      const root = `https://api.github.com/repos/${repository}/actions/runs/${tag.runId}`;
      return { current: (await api(root)).data, attempt: (await api(`${root}/attempts/${tag.attempt}`)).data };
    },
    async getManifest(packageName, digest) {
      resource(packageName); guard(digestPattern.test(digest), 'manifest-digest');
      return cli(['manifest', 'get', '--format', 'raw-body', `ghcr.io/${owner}/${packageName}@${digest}`], undefined, true);
    },
    report: value => console.log(JSON.stringify(value)),
  };
}
export async function main(env = process.env, ports = githubPorts(env), now = Date.now()) {
  const { dryRun } = cleanupContext(env), plans = [];
  const runCache = new Map(), getRun = tag => {
    const key = `${tag.runId}/${tag.attempt}`;
    if (!runCache.has(key)) runCache.set(key, ports.getRun(tag)); return runCache.get(key);
  };
  for (const packageName of packages) {
    const plan = await planCleanup(packageName, await ports.listVersions(packageName), ports.getManifest, getRun, now);
    plans.push(plan);
    ports.report({ event: 'ci-candidate-cleanup-plan', package: packageName, dryRun,
      versions: plan.entries.map(entry => ({ id: entry.version.id, digest: entry.version.digest, tags: entry.version.tags })) });
  }
  if (!dryRun) for (const plan of plans) await executeCleanup(plan, ports);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch (error) { console.error(error.message.startsWith('CI candidate cleanup refused:') ? error.message : 'CI candidate cleanup failed'); process.exitCode = 1; }
}
