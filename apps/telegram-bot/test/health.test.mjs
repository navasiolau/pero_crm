import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { BotHealthReporter } from "../dist/health.js";

test("health evidence requires fresh polling and CRM successes", async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "pero-bot-health-"));
  const file = join(temp, "health.json");
  t.after(() => rm(temp, { recursive: true, force: true }));
  const reporter = new BotHealthReporter(file, 1_000, 1_000);
  const start = new Date("2026-09-14T10:00:00.000Z");

  assert.equal(reporter.snapshot(start).status, "starting");
  reporter.pollingSuccess(start);
  assert.equal(reporter.snapshot(start).status, "degraded");
  reporter.crmSuccess(start);
  assert.equal(reporter.snapshot(start).status, "healthy");
  assert.equal(reporter.snapshot(new Date(start.getTime() + 1_001)).status, "degraded");

  const saved = JSON.parse(await readFile(file, "utf8"));
  assert.equal(saved.service, "telegram-bot");
  assert.equal(saved.polling.lastSuccessAt, start.toISOString());
  assert.equal(saved.crm.lastSuccessAt, start.toISOString());
  assert.equal(JSON.stringify(saved).includes("token"), false);
});

test("a later failure degrades evidence and stores only a bounded reason", async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "pero-bot-health-"));
  const file = join(temp, "health.json");
  t.after(() => rm(temp, { recursive: true, force: true }));
  const reporter = new BotHealthReporter(file);
  const now = new Date("2026-09-14T10:00:00.000Z");
  reporter.pollingSuccess(now);
  reporter.crmSuccess(now);
  reporter.pollingFailure("telegram-conflict", new Date(now.getTime() + 1));

  const saved = JSON.parse(await readFile(file, "utf8"));
  assert.equal(saved.status, "degraded");
  assert.equal(saved.polling.failureReason, "telegram-conflict");
  assert.deepEqual(Object.keys(saved).sort(), ["crm", "generatedAt", "polling", "schemaVersion", "service", "status"]);
});
