import assert from "node:assert/strict";
import test from "node:test";
import { createRenderWorker, type RenderContext, type RenderWorkerTimers } from "../src/server/kp/render-worker";
import type { RenderQueue } from "../src/server/kp/render-queue";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture() {
  const state = { claims: 0, renewals: 0, failures: 0, completed: false, owned: true, claimedKinds: [] as string[], timers: 0, cancelled: 0 };
  let heartbeat = () => {}, deadline = () => {};
  const queue: RenderQueue = {
    async claim(kinds, owner) { state.claims++; state.claimedKinds = [...kinds]; return { id: "job1", kind: "PDF", owner, attempt: 1 }; },
    async renew() { state.renewals++; return state.owned; },
    async fail() { state.failures++; return state.owned; },
    completed: async () => state.completed,
  };
  const timers: RenderWorkerTimers = {
    interval(callback) { state.timers++; heartbeat = callback; return () => { state.cancelled++; }; },
    timeout(callback) { state.timers++; deadline = callback; return () => { state.cancelled++; }; },
  };
  return { state, queue, timers, heartbeat: () => heartbeat(), deadline: () => deadline() };
}
const on = () => ({ PERO_KP_ENABLED: "1", PERO_KP_WORKER_ENABLED: "1" });

test("worker is inert by construction, requires both flags and only claims registered render kinds", async () => {
  const f = fixture();
  const worker = createRenderWorker({ queue: f.queue, handlers: { PDF: async () => { f.state.completed = true; } }, environment: () => ({ PERO_KP_ENABLED: "1" }), timers: f.timers });
  assert.equal(f.state.timers + f.state.claims, 0);
  worker.start(); assert.equal(await worker.runOne(), "disabled"); assert.equal(f.state.timers + f.state.claims, 0);
  const enabled = createRenderWorker({ queue: f.queue, handlers: { PDF: async () => { f.state.completed = true; } }, environment: on, timers: f.timers });
  assert.equal(await enabled.runOne(), "succeeded"); assert.deepEqual(f.state.claimedKinds, ["PDF"]); assert.equal(f.state.cancelled, 1, "default0 keeps heartbeat but creates no absolute deadline");
});

test("lost heartbeat interrupts hung I/O without failing another owner's claim", async () => {
  const f = fixture(), started = deferred<void>(), pending = deferred<void>();
  let context: RenderContext | undefined;
  const worker = createRenderWorker({ queue: f.queue, environment: on, timers: f.timers, handlers: { PDF: async (_claim, value) => { context = value; started.resolve(); await pending.promise; } } });
  const running = worker.runOne(); await started.promise;
  f.state.owned = false; f.heartbeat();
  assert.equal(await running, "failed"); assert.equal(f.state.failures, 0); assert.equal(context!.signal.aborted, true); assert.equal(context!.active(), false);
  pending.resolve(); assert.equal(await context!.ensureOwned(), false);
});

test("timeout releases only own claim and late continuation remains inactive", async () => {
  const f = fixture(), started = deferred<void>(), pending = deferred<void>();
  let context: RenderContext | undefined;
  const worker = createRenderWorker({ queue: f.queue, environment: on, timers: f.timers, timeoutMs: 1000, handlers: { PDF: async (_claim, value) => { context = value; started.resolve(); await pending.promise; } } });
  const running = worker.runOne(); await started.promise; f.deadline();
  assert.equal(await running, "failed"); assert.equal(f.state.failures, 1); assert.equal(context!.active(), false); assert.equal(context!.signal.aborted, true);
  pending.resolve(); assert.equal(await context!.ensureOwned(), false);
});

test("handler returning without durable completion is retried rather than acknowledged", async () => {
  const f = fixture();
  const worker = createRenderWorker({ queue: f.queue, environment: on, timers: f.timers, handlers: { PDF: async () => {} } });
  assert.equal(await worker.runOne(), "failed"); assert.equal(f.state.failures, 1);
});
