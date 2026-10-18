import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { REPOSITORY, requireCi } from './target.mjs';
import smoke from './kp-template-smoke.mjs';

const command = (args, input) => execFileSync('docker', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30_000, maxBuffer: 64 * 1024 }).trim();
const nameOf = target => `${target.webName}-kp-template-smoke`;
const labels = target => ({ 'pero.ci.repository': REPOSITORY, 'pero.ci.run': target.runId,
  'pero.ci.attempt': target.attempt, 'pero.ci.service': 'web-template-smoke' });
const nodeCommand = ['-s', 'KILL', '15', 'node', '--max-old-space-size=64', '--input-type=commonjs', '-'];

export function verifyTemplateContainer(container, target, imageId) {
  requireCi(/^[a-f0-9]{64}$/.test(container.Id ?? '') && container.Name === '/' + nameOf(target) &&
    container.Image === imageId && container.Config?.Image === imageId, 'kp-template-container-image');
  for (const [key, value] of Object.entries(labels(target))) requireCi(container.Config.Labels?.[key] === value, 'kp-template-container-owner');
  const host = container.HostConfig;
  requireCi(host?.NetworkMode === 'none' && host.ReadonlyRootfs === true && host.Memory === 256 * 1024 * 1024 &&
    host.NanoCpus === 1_000_000_000 && host.PidsLimit === 32 && !host.Privileged && host.CapDrop?.includes('ALL') &&
    host.SecurityOpt?.some(value => value === 'no-new-privileges' || value === 'no-new-privileges:true') &&
    !host.Binds?.length && !host.Mounts?.length && Object.keys(host.Tmpfs ?? {}).length === 0 &&
    container.Mounts?.length === 0 && Object.keys(host.PortBindings ?? {}).length === 0 &&
    container.Config.User === 'node' && container.Config.WorkingDir === '/app/apps/web' && container.Config.OpenStdin === true &&
    JSON.stringify(container.Config.Entrypoint) === '["timeout"]' && JSON.stringify(container.Config.Cmd) === JSON.stringify(nodeCommand), 'kp-template-container-bounds');
}

export function removeWebTemplateSmoke(target, imageId, run = command) {
  const id = run(['ps', '-aq', '--no-trunc', '--filter', `name=^/${nameOf(target)}$`]);
  if (id) {
    const container = JSON.parse(run(['inspect', '--type', 'container', id]))[0];
    verifyTemplateContainer(container, target, imageId); requireCi(container.Id === id, 'kp-template-container-id');
    run(['rm', '--force', id]);
  }
  requireCi(!run(['ps', '-aq', '--no-trunc', '--filter', `name=^/${nameOf(target)}$`]), 'kp-template-container-remains');
}

export function verifyWebTemplatePackage(target, imageId, run = command) {
  requireCi(/^sha256:[a-f0-9]{64}$/.test(imageId), 'kp-template-image-id');
  const expected = smoke.expectedPackage(), source = smoke.program(expected), name = nameOf(target);
  requireCi(!run(['ps', '-aq', '--filter', `name=^/${name}$`]), 'kp-template-container-exists');
  const args = ['create', '--interactive', '--name', name, '--network', 'none', '--read-only', '--user', 'node', '--workdir', '/app/apps/web',
    '--memory', '256m', '--cpus', '1', '--pids-limit', '32', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--entrypoint', 'timeout'];
  for (const [key, value] of Object.entries(labels(target))) args.push('--label', `${key}=${value}`);
  args.push(imageId, ...nodeCommand);
  let failed = false;
  try {
    const id = run(args); requireCi(/^[a-f0-9]{64}$/.test(id), 'kp-template-created-id');
    const inspect = () => { const value = JSON.parse(run(['inspect', '--type', 'container', id]))[0];
      verifyTemplateContainer(value, target, imageId); requireCi(value.Id === id, 'kp-template-container-id'); return value; };
    inspect(); const result = JSON.parse(run(['start', '--attach', '--interactive', id], source));
    const finished = inspect(); requireCi(finished.State?.Running === false && finished.State.ExitCode === 0 && finished.State.OOMKilled === false, 'kp-template-smoke-exit');
    requireCi(result.status === 'PASSED' && JSON.stringify(result.template) === JSON.stringify(expected.template) &&
      result.assetsChecked === expected.assets.length && result.assetManifestSha256 === createHash('sha256').update(JSON.stringify(expected.assets)).digest('hex') &&
      result.limitsChecked === true && result.contractModelChecked === true && result.privateAssetsDenied === true, 'kp-template-smoke-result');
    return { ciRuntime: 'web-kp-template-tested', imageId, ...result };
  } catch (error) { failed = true; throw error; }
  finally {
    try { removeWebTemplateSmoke(target, imageId, run); }
    catch (error) { if (!failed) throw error; console.error('CI_TARGET_REFUSED:kp-template-cleanup-failed'); }
  }
}
