import assert from "node:assert/strict";
import test from "node:test";
import { formatDateTime } from "../src/lib/format";
import { projectStageAgeStart, projectStageDays } from "../src/lib/project-kanban-values";

test("SSR UTC and browser Moscow render the same business timestamp", () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = "UTC";
    const server = formatDateTime("2026-10-01T10:00:00.000Z");
    process.env.TZ = "Europe/Moscow";
    const browser = formatDateTime("2026-10-01T10:00:00.000Z");
    assert.equal(server, browser);
    assert.match(server, /13:00:00/);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("project age uses the current transition, initial LEAD creation and unavailable dates", () => {
  const createdAt = "2026-01-01T00:00:00Z", stageChangedAt = "2026-10-02T00:00:00Z";
  const project = { stage: "LEAD" as const, createdAt, stageChangedAt };
  assert.equal(projectStageAgeStart(project), createdAt);
  assert.equal(projectStageAgeStart({ ...project, latestTransition: { toStage: "LEAD", createdAt: stageChangedAt } }), stageChangedAt);
  assert.equal(projectStageAgeStart({ ...project, stage: "IN_WORK", latestTransition: { toStage: "ESTIMATE", createdAt } }), stageChangedAt);
  assert.equal(projectStageDays(stageChangedAt, new Date("2026-10-04T00:00:00Z").getTime()), 2);
  assert.equal(projectStageDays("invalid", Date.now()), null);
  assert.equal(projectStageDays(stageChangedAt, new Date(createdAt).getTime()), null);
});
