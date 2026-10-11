import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { after, beforeEach, test } from "node:test";

const require = createRequire(import.meta.url), eventsFile = require.resolve("../src/server/plugins/events");
const previousEvents = require.cache[eventsFile], stub = new Module(eventsFile);
let calls = 0, release: () => void = () => {}, scheduled: (() => void) | undefined, interval = 0, unrefs = 0;
stub.filename = eventsFile; stub.loaded = true; stub.exports = { dispatchPendingEvents: async (limit: number) => {
  assert.equal(limit, 50); calls++; await new Promise<void>(resolve => { release = resolve; }); return 2;
} }; require.cache[eventsFile] = stub;
const { startDomainEventWorker, domainEventWorkerStatus } = require("../src/server/plugins/event-worker") as typeof import("../src/server/plugins/event-worker");
const timer = globalThis.setInterval;
const keys = ["NEXT_RUNTIME", "NEXT_PHASE", "DOMAIN_EVENT_WORKER_ENABLED"] as const;
const beforeEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]));
const registry = globalThis as typeof globalThis & { peroDomainEventWorker?: unknown };
const previousWorker = registry.peroDomainEventWorker;
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

beforeEach(() => {
  calls = 0; scheduled = undefined; interval = 0; unrefs = 0; delete registry.peroDomainEventWorker;
  process.env.NEXT_RUNTIME = "nodejs"; delete process.env.NEXT_PHASE; delete process.env.DOMAIN_EVENT_WORKER_ENABLED;
  globalThis.setInterval = ((callback: () => void, milliseconds: number) => {
    scheduled = callback; interval = milliseconds; return { unref: () => { unrefs++; } };
  }) as unknown as typeof setInterval;
});
after(() => {
  release(); globalThis.setInterval = timer;
  if (previousWorker === undefined) delete registry.peroDomainEventWorker; else registry.peroDomainEventWorker = previousWorker;
  if (previousEvents) require.cache[eventsFile] = previousEvents; else delete require.cache[eventsFile];
  for (const key of keys) { if (beforeEnv[key] === undefined) delete process.env[key]; else process.env[key] = beforeEnv[key]; }
});

test("import/disabled/build/edge paths never start background delivery", () => {
  assert.equal(calls, 0); startDomainEventWorker(); assert.equal(calls, 0); assert.equal(scheduled, undefined);
  process.env.DOMAIN_EVENT_WORKER_ENABLED = "true";
  process.env.NEXT_PHASE = "phase-production-build"; startDomainEventWorker(); assert.equal(calls, 0);
  delete process.env.NEXT_PHASE; process.env.NEXT_RUNTIME = "edge"; startDomainEventWorker(); assert.equal(calls, 0);
});

test("opt-in register creates one unref loop with non-overlap, visible tick and live disable", async () => {
  process.env.DOMAIN_EVENT_WORKER_ENABLED = "true";
  startDomainEventWorker(); startDomainEventWorker();
  assert.equal(interval, 15_000); assert.equal(unrefs, 1); assert.equal(calls, 1);
  scheduled!(); scheduled!(); assert.equal(calls, 1); assert.equal(domainEventWorkerStatus().running, true);
  release(); await flush();
  assert.equal(domainEventWorkerStatus().running, false); assert.equal(domainEventWorkerStatus().lastCount, 2);
  assert.ok(domainEventWorkerStatus().lastTickAt);
  process.env.DOMAIN_EVENT_WORKER_ENABLED = "false"; scheduled!(); await flush(); assert.equal(calls, 1);
});