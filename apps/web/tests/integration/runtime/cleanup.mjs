import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertCiJob, requireCi } from './target.mjs';
import { removeMinio, removeWeb } from './containers.mjs';

/** @typedef {import('./target.mjs').CiJob} CiJob */
/** @typedef {{pid:number,startedAt:string}} OwnedProcess */
/** @typedef {{web?:OwnedProcess,tests?:OwnedProcess}} OwnedProcesses */

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
  writeFileSync(statePath(target), JSON.stringify({ runId: target.runId, attempt: target.attempt, processes }), { mode: 0o600 });
}

/** Все живые члены принадлежащей запуску группы проверяются до сигнала.
 * @param {CiJob} target @param {'web'|'tests'} purpose @param {OwnedProcess} owner */
async function stopGroup(target, purpose, owner) {
  requireCi(Number.isInteger(owner.pid) && owner.pid > 1 && /^\d+$/.test(owner.startedAt), 'recorded-process');
  const members = () => {
    const leader = processStat(owner.pid);
    requireCi(!leader || leader[19] === owner.startedAt, 'process-start-identity');
    const live = [];
    for (const name of readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
      const pid = Number(name), stat = processStat(pid);
      if (!stat || Number(stat[2]) !== owner.pid || stat[0] === 'Z') continue;
      try {
        const env = readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
        requireCi(env.includes(`PERO_CI_OWNER=${target.runId}-${target.attempt}`) &&
          env.includes(`PERO_CI_PURPOSE=${purpose}`), 'process-owner');
        live.push(pid);
      } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error; }
    }
    return live;
  };
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
  let processes = current;
  const file = statePath(target);
  if (existsSync(file)) {
    const state = JSON.parse(readFileSync(file, 'utf8'));
    requireCi(state.runId === target.runId && state.attempt === target.attempt && state.processes, 'process-record');
    for (const purpose of ['tests', 'web']) {
      if (state.processes[purpose] && current[purpose]) {
        requireCi(JSON.stringify(state.processes[purpose]) === JSON.stringify(current[purpose]), 'process-record-changed');
      }
    }
    processes = { ...state.processes, ...current };
  }
  for (const purpose of ['tests', 'web']) if (processes[purpose]) await stopGroup(target, purpose, processes[purpose]);
  removeWeb(target);
  removeMinio(target);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await cleanup(assertCiJob());
}
