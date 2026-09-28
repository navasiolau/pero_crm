import assert from "node:assert/strict";
import { test } from "node:test";

import { validateWorkSharesCompletionIds, workSharesTimerSeconds } from "./work-shares-browser.mjs";

for (const [label, expected] of [
  ["Стоп 00:01", 1],
  ["Стоп 00:19", 19],
  ["Стоп 01:00", 60],
  ["Стоп 00:00", 0],
  ["Стоп 59:59", 3599],
  ["Стоп 1:00:00", 3600],
  ["Стоп 01:02:03", 3723],
  ["Стоп 00:00:01", 1],
  ["Стоп 00:00:00", 0],
] as const) {
  test(`timer parses the actual padded label ${label} into seconds`, () => {
    const seconds = workSharesTimerSeconds(label);
    assert.equal(seconds, expected);
    assert.equal((seconds ?? -1) >= 1, expected >= 1);
  });
}

test("invalid or missing timer text cannot prove elapsed time", () => {
  for (const label of ["", "Стоп", "Стоп 00:60", "Стоп 1:60:00", "Стоп -1:00", "Стоп 00:19 ошибка", "Выполнено 00:19"]) {
    assert.equal(workSharesTimerSeconds(label), null, label);
  }
});

const completionPlan = {
  source: { id: "11111111-1111-4111-8111-111111111111" },
  dependent: { id: "22222222-2222-4222-8222-222222222222" },
  project: { id: "33333333-3333-4333-8333-333333333333" },
  work: { id: "44444444-4444-4444-8444-444444444444" },
  users: [{ id: "55555555-5555-4555-8555-555555555555" }, { id: "66666666-6666-4666-8666-666666666666" }],
};
const capturedIds = {
  source: completionPlan.source.id,
  dependent: completionPlan.dependent.id,
  fractional: "qa_observed_fractional_task",
  child: "qa_observed_split_task",
  splitRequestId: "77777777-7777-4777-8777-777777777777",
};

test("readonly completion binds the observed IDs to the owned plan", () => {
  const result = validateWorkSharesCompletionIds(completionPlan, capturedIds);
  assert.deepEqual(result, capturedIds);
  assert.notEqual(result, capturedIds);
});

test("readonly completion rejects missing, extra or mismatched receipt identifiers", () => {
  for (const ids of [undefined, {}, { ...capturedIds, token: "forbidden" }, { ...capturedIds, source: capturedIds.child }, { ...capturedIds, dependent: capturedIds.child }, { ...capturedIds, splitRequestId: "missing-real-request" }]) {
    assert.throws(() => validateWorkSharesCompletionIds(completionPlan, ids), /COMPLETION_CAPTURED_IDS_/);
  }
});

test("readonly completion rejects aliased tasks, path-shaped IDs and non-task owned IDs", () => {
  for (const ids of [{ ...capturedIds, child: capturedIds.fractional }, { ...capturedIds, fractional: null }, { ...capturedIds, child: "../foreign-task" }, { ...capturedIds, child: completionPlan.project.id }, { ...capturedIds, fractional: completionPlan.work.id }, { ...capturedIds, child: completionPlan.users[0].id }]) {
    assert.throws(() => validateWorkSharesCompletionIds(completionPlan, ids), /COMPLETION_TASK_IDS_INVALID/);
  }
});
