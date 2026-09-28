import assert from "node:assert/strict";
import { test } from "node:test";
import { requiresManualCompletionTime } from "../src/lib/task-completion-prompt";

test("an engineer's active timer completes without requesting fabricated manual time", () => {
  assert.equal(requiresManualCompletionTime({ id: "own", spentMinutes: 0 }, true, "own"), false);
});
test("missing time still prompts office roles, including when a different task has the timer", () => {
  assert.equal(requiresManualCompletionTime({ id: "own", spentMinutes: 0 }, true, null), true);
  assert.equal(requiresManualCompletionTime({ id: "own", spentMinutes: 0 }, true, "different"), true);
  assert.equal(requiresManualCompletionTime({ id: "own", spentMinutes: 5 }, true, null), false);
});
test("field roles never receive the manual-time dialog", () => {
  assert.equal(requiresManualCompletionTime({ id: "own", spentMinutes: 0 }, false, null), false);
});
