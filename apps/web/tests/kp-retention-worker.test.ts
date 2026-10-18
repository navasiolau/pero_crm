import { test } from "node:test";
import assert from "node:assert/strict";
import { createRetentionWorker, retentionWorkerEnabled } from "../src/server/kp/retention-worker";
import { RetentionError } from "../src/server/kp/retention-contract";
import { retentionFixture, retentionTime } from "./helpers/kp-retention-fixture";

test("retention default-off starts neither timers nor DB/S3 work", async () => {
  const f = retentionFixture(); let intervals = 0;
  const worker = createRetentionWorker(f.dependencies, { environment: () => ({}), timers: { interval: () => { intervals++; return () => {}; } } });
  assert.equal(retentionWorkerEnabled({ PERO_KP_ENABLED: "1" }), false);
  assert.equal(worker.start(), false); assert.equal(await worker.runOne(), "disabled");
  assert.equal(intervals, 0); assert.deepEqual(f.events, []);
});

test("hourly annual planning and every-tick canceled probes do not overlap", async () => {
  const f = retentionFixture(); f.setProgress({ manifest: f.emptyManifest(), objects: {} });
  const environment = () => ({ PERO_KP_ENABLED: "1", PERO_KP_RETENTION_WORKER_ENABLED: "1" });
  let unblock: (() => void) | undefined;
  const pending = new Promise<void>(resolve => { unblock = resolve; });
  const claim = f.repository.claim;
  f.repository.claim = async (...args) => { await pending; return claim(...args); };
  const worker = createRetentionWorker(f.dependencies, { environment });
  const first = worker.runOne();
  assert.equal(await worker.runOne(), "idle"); unblock!();
  assert.equal(await first, "succeeded");
  assert.equal(await worker.runOne(), "idle");
  assert.deepEqual(f.events.filter(event => event.startsWith("schedule-")), ["schedule-annual", "schedule-probe"]);
  f.setTime(new Date(retentionTime.getTime()+3_600_000));
  assert.equal(await worker.runOne(), "idle");
  assert.equal(f.events.filter(event => event === "schedule-annual").length, 2);
});

test("reference blocks are retryable; storage identity mismatch halts subsequent jobs", async () => {
  const f = retentionFixture(); f.repository.prepare = async () => { throw new RetentionError("KP_RETENTION_REFERENCED", true); };
  const environment = () => ({ PERO_KP_ENABLED: "1", PERO_KP_RETENTION_WORKER_ENABLED: "1" });
  const worker = createRetentionWorker(f.dependencies, { environment });
  assert.equal(await worker.runOne(), "failed"); assert.equal(worker.status().haltReason, null); assert.equal(f.state, "PENDING");
  f.repository.prepare = async () => { throw new RetentionError("KP_RETENTION_STORAGE_CHANGED"); };
  assert.equal(await worker.runOne(), "failed"); assert.equal(worker.status().haltReason, "KP_RETENTION_STORAGE_CHANGED");
  const before = f.events.length;
  assert.equal(await worker.runOne(), "halted"); assert.equal(f.events.length, before);
});
