import { execFileSync, spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertCiJob, requireCi } from './target.mjs';
import { removeMinio, removeWeb } from './containers.mjs';

/** @typedef {import('./target.mjs').CiJob} CiJob */
/** @typedef {{pid:number,startedAt:string,launchedAt?:number}} OwnedProcess */
/** @typedef {{web?:OwnedProcess,tests?:OwnedProcess,deps?:OwnedProcess}} OwnedProcesses */
const purposes = ['tests', 'web', 'deps'];

/** @param {number} pid */
function processStat(pid) {
  try { return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').at(-1).split(' '); }
  catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') return null; throw error; }
}

/** @param {number} pid @returns {OwnedProcess} */
export function processOwner(pid) {
  const stat = processStat(pid);
  requireCi(Number.isInteger(pid) && pid > 1 && stat && Number(stat[2]) === pid, 'process-group');
  return { pid, startedAt: stat[19] };
}

/** @param {CiJob} target */
export function statePath(target) {
  const directory = process.env.RUNNER_TEMP;
  requireCi(Boolean(directory) && path.isAbsolute(directory) && realpathSync(directory) === directory, 'state-directory');
  return path.join(directory, `pero-ci-${target.runId}-${target.attempt}.json`);
}

/** @param {CiJob} target @param {OwnedProcesses} processes */
export function recordProcesses(target, processes) {
  const previous = readProcesses(target);
  for (const [purpose, owner] of Object.entries(processes)) {
    requireCi(purposes.includes(purpose) && Number.isInteger(owner.pid) && owner.pid > 1 && /^\d+$/.test(owner.startedAt), 'recorded-process');
    requireCi(!previous[purpose] || JSON.stringify(previous[purpose]) === JSON.stringify(owner), 'process-record-changed');
  }
  const file = statePath(target), temporary = `${file}.tmp`;
  writeFileSync(temporary, JSON.stringify({ runId: target.runId, attempt: target.attempt, processes: { ...previous, ...processes } }), { mode: 0o600 });
  renameSync(temporary, file);
}

function readProcesses(target) {
  const file = statePath(target);
  if (!existsSync(file)) return {};
  const state = JSON.parse(readFileSync(file, 'utf8'));
  requireCi(state.runId === target.runId && state.attempt === target.attempt && state.processes &&
    Object.keys(state.processes).every(purpose => purposes.includes(purpose)), 'process-record');
  return state.processes;
}

/** Каждая живая группа подтверждается до сигналов и перед использованием deps. */
function groupMembers(target, purpose, owner) {
  requireCi(Number.isInteger(owner.pid) && owner.pid > 1 && /^\d+$/.test(owner.startedAt), 'recorded-process');
  const leader = processStat(owner.pid);
  requireCi(!leader || leader[19] === owner.startedAt, 'process-start-identity');
  const live = [];
  for (const name of readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
    const pid = Number(name), stat = processStat(pid);
    if (!stat || Number(stat[2]) !== owner.pid || stat[0] === 'Z') continue;
    try {
      const env = readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
      requireCi(env.includes(`PERO_CI_OWNER=${target.runId}-${target.attempt}`) && env.includes(`PERO_CI_PURPOSE=${purpose}`), 'process-owner');
      live.push(pid);
    } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error; }
  }
  return live;
}

export function startDependencies(target) {
  requireCi(process.env.GITHUB_JOB === 'native-tests', 'deps-job');
  requireCi(!readProcesses(target).deps && !existsSync(`${statePath(target)}.deps-go`) &&
    !existsSync(`${statePath(target)}.deps-status`), 'deps-fresh');
  const log = openSync(`${statePath(target)}.deps-log`, 'wx', 0o600);
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'deps-child'], { detached: true, stdio: ['ignore', log, log],
    env: { ...process.env, PERO_CI_OWNER: `${target.runId}-${target.attempt}`, PERO_CI_PURPOSE: 'deps' } });
  closeSync(log);
  requireCi(Boolean(child.pid), 'deps-spawn');
  const owner = { ...processOwner(child.pid), launchedAt: Date.now() };
  recordProcesses(target, { deps: owner });
  const go = `${statePath(target)}.deps-go`;
  writeFileSync(`${go}.tmp`, JSON.stringify(owner), { mode: 0o600 });
  renameSync(`${go}.tmp`, go);
  child.unref();
}

export async function waitDependencies(target) {
  const owner = readProcesses(target).deps;
  requireCi(Boolean(owner) && Number.isSafeInteger(owner.launchedAt), 'deps-owner');
  const deadline = owner.launchedAt + 300000, status = `${statePath(target)}.deps-status`;
  try {
    while (true) {
      const live = groupMembers(target, 'deps', owner);
      if (!live.length) {
        requireCi(existsSync(status), 'deps-died-without-status');
        const result = JSON.parse(readFileSync(status, 'utf8'));
        requireCi(result.pid === owner.pid && result.startedAt === owner.startedAt &&
          Number.isInteger(result.code) && result.code >= 0 && result.code <= 255 &&
          Number.isSafeInteger(result.finishedAt) && result.finishedAt <= deadline, 'deps-status');
        requireCi(result.code === 0, 'deps-failed');
        console.log(JSON.stringify({ ciRuntime: 'dependencies-ready', elapsedMs: result.elapsedMs, exitCode: 0 })); return;
      }
      requireCi(Date.now() < deadline, 'deps-timeout');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  } catch (error) { await stopGroup(target, 'deps', owner); throw error; }
  finally { console.log(readFileSync(`${statePath(target)}.deps-log`, 'utf8')); }
}

async function dependenciesChild(target) {
  const go = `${statePath(target)}.deps-go`, deadline = Date.now() + 10000;
  while (!existsSync(go) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
  requireCi(existsSync(go), 'deps-go-timeout');
  const owner = JSON.parse(readFileSync(go, 'utf8'));
  requireCi(JSON.stringify(processOwner(process.pid)) === JSON.stringify({ pid: owner.pid, startedAt: owner.startedAt }) &&
    JSON.stringify(readProcesses(target).deps) === JSON.stringify(owner), 'deps-go-owner');
  let code = 0; const started = Date.now();
  try {
    execFileSync('pnpm', ['install', '--frozen-lockfile'], { stdio: 'inherit', timeout: Math.max(1, owner.launchedAt + 300000 - Date.now()) });
    execFileSync('pnpm', ['--filter', '@pero/web', 'exec', 'prisma', 'generate'], { stdio: 'inherit', timeout: Math.max(1, owner.launchedAt + 300000 - Date.now()) });
    execFileSync(process.execPath, ['tests/integration/runtime/run.mjs', 'postgres'], { cwd: path.join(process.env.GITHUB_WORKSPACE, 'apps/web'),
      env: { ...process.env, PERO_CI_CONTRACT_PHASE: 'postgres' }, stdio: 'inherit', timeout: Math.max(1, owner.launchedAt + 300000 - Date.now()) });
  } catch (error) { code = Number.isInteger(error.status) && error.status > 0 && error.status <= 255 ? error.status : 1; }
  const file = `${statePath(target)}.deps-status`;
  writeFileSync(`${file}.tmp`, JSON.stringify({ pid: owner.pid, startedAt: owner.startedAt, code,
    finishedAt: Date.now(), elapsedMs: Date.now() - started }), { mode: 0o600 });
  renameSync(`${file}.tmp`, file); process.exitCode = code;
}

/** Все живые члены принадлежащей запуску группы проверяются до сигнала.
 * @param {CiJob} target @param {'web'|'tests'|'deps'} purpose @param {OwnedProcess} owner */
async function stopGroup(target, purpose, owner) {
  const members = () => groupMembers(target, purpose, owner);
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    if (!members().length) break;
    try { process.kill(-owner.pid, signal); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    for (let attempt = 0; attempt < 50 && members().length; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  requireCi(!members().length, 'owned-processes-remain');
  console.log(JSON.stringify({ ciRuntime: 'process-group-stopped', runId: target.runId, purpose, liveMembers: 0 }));
}

/** @param {CiJob} target @param {OwnedProcesses} [current] */
export async function cleanup(target, current = {}) {
  const previous = readProcesses(target);
  for (const purpose of purposes) {
    if (previous[purpose] && current[purpose]) requireCi(JSON.stringify(previous[purpose]) === JSON.stringify(current[purpose]), 'process-record-changed');
  }
  const processes = { ...previous, ...current };
  for (const purpose of purposes) if (processes[purpose]) await stopGroup(target, purpose, processes[purpose]);
  removeWeb(target);
  removeMinio(target);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === 'deps-child') await dependenciesChild(assertCiJob());
  else await cleanup(assertCiJob());
}
