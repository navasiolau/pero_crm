import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { artifactIdentity, readWebArtifact, requireCi } from '../../web/tests/integration/runtime/target.mjs';
import { pairedRelease, readRendererArtifact, rendererLabels, verifyRendererOci, verifyRendererSmoke, verifyWebRendererBinding } from './artifact.mjs';

const docker = args => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 240_000 }).trim();
function context(env = process.env) {
  const identity = artifactIdentity(env);
  requireCi(['kp-renderer-tests', 'build-push'].includes(env.GITHUB_JOB) && execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() === identity.revision, 'kp-pipeline-job');
  const directory = path.join(env.RUNNER_TEMP, `pero-renderer-${identity.runId}-${identity.attempt}-${identity.revision}`);
  return { identity, directory, env };
}
export function verifyRuntimeProjection(image, record) {
  requireCi(image.Id === record.configDigest && JSON.stringify(image.RootFS?.Layers) === JSON.stringify(record.diffIds) &&
    image.Os === 'linux' && image.Architecture === 'amd64', 'kp-runtime-projection');
}
export function verifyOwnedSmokeContainer(container, identity, imageId) {
  requireCi(/^[a-f0-9]{64}$/.test(container.Id ?? '') && container.Name === `/pero-kp-${identity.runId}-${identity.attempt}-smoke` &&
    container.Image === imageId && container.Config?.Image === imageId, 'kp-smoke-container-image');
  for (const [key, value] of Object.entries({ 'pero.ci.repository': identity.repository, 'pero.ci.run': identity.runId,
    'pero.ci.attempt': identity.attempt, 'pero.ci.service': 'kp-renderer-smoke' })) requireCi(container.Config.Labels?.[key] === value, 'kp-smoke-container-owner');
  const host = container.HostConfig;
  requireCi(host?.NetworkMode === 'none' && host.ReadonlyRootfs === true && host.Memory === 1536 * 1024 * 1024 &&
    host.NanoCpus === 1_000_000_000 && host.PidsLimit === 128 && Object.keys(host.PortBindings ?? {}).length === 0 &&
    !!host.Tmpfs?.['/tmp'] && !host.Binds?.length && !host.Mounts?.length &&
    container.Config.User === 'node', 'kp-smoke-container-bounds');
}
async function prepare() {
  const { identity, directory, env } = context(); requireCi(env.GITHUB_JOB === 'kp-renderer-tests', 'kp-prepare-job');
  requireCi(!existsSync(directory), 'kp-build-directory-exists'); mkdirSync(directory);
  const digest = JSON.parse(docker(['buildx', 'imagetools', 'inspect', 'node:22-bookworm-slim', '--format', '{{json .Manifest}}'])).digest;
  const nodeImage = `node:22-bookworm-slim@${digest}`, labels = rendererLabels(identity, nodeImage);
  const common = { context: '.', dockerfile: 'apps/kp-renderer/Dockerfile', platforms: ['linux/amd64'],
    args: { NODE_IMAGE: nodeImage }, labels, tags: [`pero-ci-${identity.runId}-${identity.attempt}-kp-renderer:tested`],
    'cache-from': ['type=gha,scope=pero-kp-renderer'] };
  const bake = { target: {
    'renderer-oci': { ...common, attest: ['type=provenance,mode=max'], 'cache-to': ['type=gha,mode=max,scope=pero-kp-renderer'], output: [`type=oci,dest=${directory}/renderer.oci.tar`] },
    'renderer-runtime': { ...common, attest: ['type=provenance,disabled=true'], output: ['type=docker'] },
  } };
  writeFileSync(path.join(directory, 'bake.json'), JSON.stringify(bake), { flag: 'wx' });
  appendFileSync(env.GITHUB_OUTPUT, `directory=${directory}\n`);
  appendFileSync(env.GITHUB_ENV, `PERO_CI_RENDERER_ARTIFACT_DIR=${directory}\n`);
}
async function testImage() {
  const { identity, directory, env } = context(); requireCi(env.GITHUB_JOB === 'kp-renderer-tests' && env.PERO_CI_RENDERER_ARTIFACT_DIR === directory, 'kp-test-job');
  mkdirSync(path.join(directory, 'oci')); execFileSync('tar', ['-xf', path.join(directory, 'renderer.oci.tar'), '--directory', path.join(directory, 'oci'), '--no-same-owner']);
  const record = await verifyRendererOci(directory, identity), metadata = JSON.parse(env.KP_BUILD_METADATA);
  requireCi(metadata['renderer-oci']['containerimage.digest'] === record.indexDigest, 'kp-bake-digest');
  const tag = `pero-ci-${identity.runId}-${identity.attempt}-kp-renderer:tested`;
  const image = JSON.parse(docker(['image', 'inspect', tag]))[0]; verifyRuntimeProjection(image, record);
  const name = `pero-kp-${identity.runId}-${identity.attempt}-smoke`;
  requireCi(!docker(['ps', '-aq', '--filter', `name=^/${name}$`]), 'kp-smoke-already-exists');
  const args = ['create', '--name', name, '--network', 'none', '--read-only', '--tmpfs', '/tmp:rw,nosuid,size=512m,mode=1777',
    '--memory', '1536m', '--cpus', '1', '--pids-limit', '128', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--env', `PERO_KP_CI_REVISION=${identity.revision}`, '--entrypoint', 'node'];
  for (const [key, value] of Object.entries({ 'pero.ci.repository': identity.repository, 'pero.ci.run': identity.runId,
    'pero.ci.attempt': identity.attempt, 'pero.ci.service': 'kp-renderer-smoke' })) args.push('--label', `${key}=${value}`);
  args.push(record.configDigest, '--max-old-space-size=384', 'ci/smoke.cjs');
  const id = docker(args); requireCi(/^[a-f0-9]{64}$/.test(id), 'kp-created-container-id');
  const inspect = () => JSON.parse(docker(['inspect', '--type', 'container', id]))[0];
  let smoke;
  try {
    verifyOwnedSmokeContainer(inspect(), identity, record.configDigest);
    smoke = verifyRendererSmoke(JSON.parse(docker(['start', '--attach', id])), identity);
    const finished = inspect(); verifyOwnedSmokeContainer(finished, identity, record.configDigest);
    requireCi(finished.State?.Running === false && finished.State.ExitCode === 0 && finished.State.OOMKilled === false, 'kp-smoke-exit');
  } finally {
    // Удаляем только созданный этим job точный ID после повторной проверки владения.
    verifyOwnedSmokeContainer(inspect(), identity, record.configDigest); docker(['rm', '-f', id]);
  }
  writeFileSync(path.join(directory, 'smoke.json'), JSON.stringify(smoke), { flag: 'wx' });
  const complete = await readRendererArtifact(false); writeFileSync(path.join(directory, 'image.json'), JSON.stringify(complete), { flag: 'wx' });
  appendFileSync(env.GITHUB_OUTPUT, `oci-sha256=${complete.ociSha256}\nindex-digest=${complete.indexDigest}\n`);
  console.log(JSON.stringify({ ciRuntime: 'kp-renderer-oci-tested', revision: identity.revision, imageId: complete.configDigest,
    indexDigest: complete.indexDigest, pages: smoke.pages, browser: smoke.runtime.browser, smokeSha256: complete.smokeSha256 }));
}
async function release() {
  const { identity, env } = context();
  requireCi(env.GITHUB_JOB === 'build-push' && env.GITHUB_EVENT_NAME === 'push' && ['main', 'staging'].includes(env.GITHUB_REF_NAME), 'kp-release-job');
  const web = await readWebArtifact(true), renderer = await readRendererArtifact(true);
  const config = JSON.parse(readFileSync(path.join(env.PERO_CI_WEB_ARTIFACT_DIR, 'oci', 'blobs', 'sha256', web.configDigest.slice(7)), 'utf8'));
  verifyWebRendererBinding(config.config.Labels, renderer);
  const promotions = Object.fromEntries([['web', env.PERO_CI_WEB_ARTIFACT_DIR], ['renderer', env.PERO_CI_RENDERER_ARTIFACT_DIR]].map(([kind, directory]) => [kind, JSON.parse(readFileSync(path.join(directory, 'promotion.json'), 'utf8'))]));
  const packet = pairedRelease(web, renderer, promotions), directory = path.join(env.RUNNER_TEMP, `pero-kp-release-${identity.runId}-${identity.attempt}-${identity.revision}`);
  requireCi(!existsSync(directory), 'kp-release-directory-exists'); mkdirSync(directory);
  writeFileSync(path.join(directory, 'release.json'), JSON.stringify(packet, null, 2), { flag: 'wx' });
  writeFileSync(path.join(directory, 'kp-images.env'), `PERO_KP_WEB_IMAGE=${packet.images.web}\nPERO_KP_RENDERER_IMAGE=${packet.images.renderer}\nPERO_KP_RELEASE_REVISION=${packet.revision}\n`, { flag: 'wx' });
  writeFileSync(path.join(directory, 'kp-images.override.json'), JSON.stringify({ services: { web: { image: packet.images.web }, 'kp-renderer': { image: packet.images.renderer } } }, null, 2), { flag: 'wx' });
  copyFileSync('deploy/docker-compose.kp.yml', path.join(directory, 'docker-compose.kp.yml'));
  appendFileSync(env.GITHUB_OUTPUT, `directory=${directory}\n`);
  console.log(JSON.stringify({ ciRuntime: 'kp-paired-release-ready', revision: packet.revision, images: packet.images, enabled: false }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const action = { prepare, test: testImage, release }[process.argv[2]]; requireCi(!!action, 'kp-pipeline-command'); await action(); }
  catch (error) { console.error(/^CI_TARGET_REFUSED:[a-zA-Z0-9_.:-]+$/.test(error?.message) ? error.message : 'KP_PIPELINE_FAILED'); process.exitCode = 1; }
}
