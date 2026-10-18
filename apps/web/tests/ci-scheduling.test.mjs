import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { CI_ARTIFACT_BUDGETS } from './integration/runtime/target.mjs';

// Используем уже установленный YAML parser ESLint, без новой зависимости.
const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('@eslint/eslintrc'))('js-yaml');
const { jobs } = yaml.load(readFileSync(new URL('../../../.github/workflows/ci-cd.yml', import.meta.url), 'utf8'));
const minute = 60_000;
const dependencies = job => Array.isArray(job.needs) ? job.needs : job.needs ? [job.needs] : [];
function cohortJob(cohort, graph = jobs) {
  const matches = Object.entries(graph).filter(([, job]) => job.strategy?.matrix?.cohort?.includes(cohort));
  assert.equal(matches.length, 1, 'каждая cohort запускается ровно в одном job');
  return matches[0][0];
}
function startAt(id, durations, graph = jobs, active = new Set()) {
  assert.ok(graph[id], 'существующая зависимость job');
  assert.ok(!active.has(id), 'нет цикла job DAG');
  active.add(id);
  const start = Math.max(0, ...dependencies(graph[id]).map(dependency => startAt(dependency, durations, graph, active) + (durations[dependency] ?? 0)));
  active.delete(id);
  return start;
}
function typesWindow(graph, rendererMinutes, buildMinutes) {
  const durations = { 'kp-renderer-tests': rendererMinutes * minute };
  const backendStart = startAt(cohortJob('backend', graph), durations, graph);
  const pollStart = backendStart + 3 * minute;
  return { backendStart, artifactAt: startAt('native-tests', durations, graph) + buildMinutes * minute,
    deadline: Math.min(pollStart + CI_ARTIFACT_BUDGETS.types.pollMs, backendStart + CI_ARTIFACT_BUDGETS.types.consumerMs) };
}

test('healthy renderer15m + native build8m stays inside the actual types consumer budget', () => {
  for (const rendererMinutes of [15, jobs['kp-renderer-tests']['timeout-minutes'] - 1]) {
    const window = typesWindow(jobs, rendererMinutes, 8);
    assert.ok(window.artifactAt < window.deadline, 'ожидание renderer не расходует20-минутный types budget backend');
    assert.equal(window.backendStart, rendererMinutes * minute);
  }
  const oldScheduling = structuredClone(jobs);
  oldScheduling[cohortJob('backend')].needs = [];
  const previous = typesWindow(oldScheduling, 15, 8);
  assert.ok(previous.artifactAt > previous.deadline, 'регрессия воспроизводит прежние23 минуты против20');
});

test('components stay parallel while backend and native start after renderer with unchanged producer identity', () => {
  const backendId = cohortJob('backend'), componentsId = cohortJob('components-0');
  assert.notEqual(backendId, componentsId);
  assert.deepEqual(jobs[backendId].strategy.matrix.cohort, ['backend']);
  assert.deepEqual(jobs[componentsId].strategy.matrix.cohort, ['components-0', 'components-1']);
  assert.equal(startAt(componentsId, { 'kp-renderer-tests': 15 * minute }), 0);
  assert.equal(startAt('native-tests', { 'kp-renderer-tests': 15 * minute }), 15 * minute);
  assert.equal(jobs[backendId].name.replace('${{ matrix.cohort }}', 'backend'), 'unit-tests (backend)');
  assert.equal(jobs[backendId].steps, jobs[componentsId].steps, 'один reviewed steps alias для обеих групп');
  assert.ok(CI_ARTIFACT_BUDGETS.types.consumerMs < jobs[backendId]['timeout-minutes'] * minute);
  assert.ok(CI_ARTIFACT_BUDGETS['bot-dist'].consumerMs < jobs['native-tests']['timeout-minutes'] * minute);
});

test('full DAG has no cycles, publication waits both unit groups and types precede the backend handoff', () => {
  for (const id of Object.keys(jobs)) startAt(id, {});
  const required = [cohortJob('backend'), cohortJob('components-0'), 'native-tests', 'kp-renderer-tests'];
  for (const id of ['build-push', 'build-push-bot']) {
    for (const dependency of required) assert.ok(dependencies(jobs[id]).includes(dependency), id + ' ждёт ' + dependency);
  }
  const nativeSteps = jobs['native-tests'].steps;
  const produced = nativeSteps.findIndex(step => step.name === 'Свежие types из проверенного OCI');
  const consumed = nativeSteps.findIndex(step => step.name === 'Дождаться проверенного backend artifact текущего запуска');
  assert.ok(produced >= 0 && consumed > produced, 'types готовы до ожидания bot-dist; нет скрытого взаимного ожидания');
});
