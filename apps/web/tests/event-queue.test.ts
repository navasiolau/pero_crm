import assert from "node:assert/strict";
import { memorySubscriberFixture } from "./helpers/subscriber-delivery-fixture";
import { nativeFailureDiagnostic } from "./event-queue-store-native";
import { createRequire, Module } from "node:module";
import { after, before, beforeEach, test } from "node:test";
import { createEventQueueProcessor } from "../src/server/plugins/event-queue-core";
import { EventDeliveryError, eventRetryDelay, getEventQueueSettings, type QueuedDomainEvent } from "../src/server/plugins/event-queue-contract";
import { OBSOLETE_SKETCH_EVENT } from "../src/server/products/sketch-cleanup-contract";
import { createMemoryEventQueueFixture, memoryEvent } from "./helpers/event-queue-fixture";

const require = createRequire(import.meta.url), originals = new Map<string, NodeModule | undefined>();
function inject(specifier: string, exports: Record<string, unknown>) {
  const filename = require.resolve(specifier), stub = new Module(filename);
  originals.set(filename, require.cache[filename]);
  stub.filename = filename; stub.loaded = true; stub.exports = exports; require.cache[filename] = stub;
}
let f = createMemoryEventQueueFixture();
let hook: (event: Pick<QueuedDomainEvent, "id" | "type" | "payload">) => Promise<void> = async () => {};
let events: typeof import("../src/server/plugins/events");
let created = 0, internalCalls = 0;

before(() => {
  inject("../src/lib/prisma", { prisma: {
    domainEvent: { create: async ({ data }: { data: { type: string; payload: unknown; actor: string } }) => {
      const row = { ...memoryEvent(++created), ...data, id: `qa135-created-${created}`,
        createdAt: new Date(f.now()), nextAttemptAt: new Date(f.now()) };
      f.rows.push(row); return row;
    } },
    plugin: { findMany: async () => [{ id: "qa135" }] },
  } });
  inject("../src/server/plugins/event-queue-store", { createPostgresEventQueueStore: () => f.store });
  inject("../src/server/plugins/event-subscriber-store", { createPostgresSubscriberStore: () => memorySubscriberFixture(f).store });
  inject("../src/server/plugins/registry", { getManifest: () => ({ hooks: { onDomainEvent: async (row: QueuedDomainEvent) => hook(row) } }) });
  inject("../src/server/plugins/context", { buildPluginContext: async () => ({ emit: (type: string, payload: unknown) => events.emitDomainEvent(type, payload) }) });
  inject("../src/server/plugins/run-log", { logPluginRun: async () => {} });
  inject("../src/server/products/sketch-cleanup-core", { executeObsoleteSketchCleanup: async () => { internalCalls++; } });
  const filename = require.resolve("../src/server/plugins/events"); originals.set(filename, require.cache[filename]); events = require(filename);
});
beforeEach(() => { f = createMemoryEventQueueFixture(); hook = async () => {}; created = 0; internalCalls = 0; });
after(() => { for (const [filename, original] of originals) {
  if (original) require.cache[filename] = original; else delete require.cache[filename];
} });
const processor = (fixture: ReturnType<typeof createMemoryEventQueueFixture>, deliver: Parameters<typeof createEventQueueProcessor>[0]["deliver"]) =>
  createEventQueueProcessor({ store: fixture.store, settings: fixture.settings, timers: fixture.timers, deliver });

test("two cycles deliver a healthy event behind fifty consistently failing events", async () => {
  f.rows.push(...Array.from({ length: 51 }, (_, index) => memoryEvent(index)));
  const facts = f.rows.map(({ id, payload, actor, createdAt }) => ({ id, payload, actor, createdAt }));
  let healthyCalls = 0;
  hook = async row => { if ((row.payload as { index: number }).index < 50) throw Error("QA_POISON"); healthyCalls++; };
  await events.dispatchPendingEvents(50); await events.dispatchPendingEvents(50);
  assert.equal(healthyCalls, 1); assert.ok(f.rows[50].processedAt);
  assert.deepEqual(f.rows.map(({ id, payload, actor, createdAt }) => ({ id, payload, actor, createdAt })), facts);
});

test("parallel dispatchers do not invoke one active claimed event twice", async () => {
  f.rows.push(memoryEvent(1));
  let calls = 0, release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  hook = async () => { calls++; await gate; };
  const first = events.dispatchEvent(f.rows[0].id); await f.flush();
  const second = events.dispatchEvent(f.rows[0].id); await f.flush();
  try { assert.equal(calls, 1); }
  finally { release(); await Promise.allSettled([first, second]); }
});

test("completed payload and attempt history are preserved without reopening", async () => {
  f.rows.push({ ...memoryEvent(1), processedAt: new Date(1234), attempts: 999 });
  const previous = structuredClone(f.rows[0]); let calls = 0; hook = async () => { calls++; };
  await events.dispatchEvent(f.rows[0].id); await events.dispatchPendingEvents(50);
  assert.equal(calls, 0); assert.deepEqual(f.rows[0], previous);
});

test("new queue budget does not exhaust old pending attempt history", async () => {
  f.rows.push({ ...memoryEvent(1), attempts: 999 });
  await events.dispatchEvent(f.rows[0].id);
  assert.ok(f.rows[0].processedAt); assert.equal(f.rows[0].attempts, 1000); assert.equal(f.rows[0].queueAttempts, 1);
});

test("stale callback after expired lease cannot ACK the replacement owner", async () => {
  const fixture = createMemoryEventQueueFixture({ rows: [memoryEvent(1)] });
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const first = processor(fixture, async () => gate).dispatchOne(fixture.rows[0].id); await fixture.flush();
  const firstToken = fixture.rows[0].claimToken;
  await fixture.jump(fixture.settings.leaseMs + 1);
  const second = processor(fixture, async () => {}).dispatchOne(fixture.rows[0].id);
  assert.equal(await second, true); const completed = structuredClone(fixture.rows[0]);
  release(); assert.equal(await first, false);
  assert.notEqual(completed.claimToken, firstToken); assert.deepEqual(fixture.rows[0], completed);
});

test("heartbeat extends only current ownership and nested dispatch does not steal it", async () => {
  const fixture = createMemoryEventQueueFixture({ rows: [memoryEvent(1)] });
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const pending = processor(fixture, async () => gate).dispatchOne(fixture.rows[0].id); await fixture.flush();
  const initialLease = fixture.rows[0].leaseUntil!.getTime();
  await fixture.advance(fixture.settings.heartbeatMs);
  assert.ok(fixture.rows[0].leaseUntil!.getTime() > initialLease);
  const snapshot = structuredClone(fixture.rows[0]);
  assert.equal(await processor(fixture, async () => { throw Error("unexpected nested hook"); }).dispatchOne(fixture.rows[0].id), false);
  assert.deepEqual(fixture.rows[0], snapshot);
  release(); assert.equal(await pending, true); assert.equal(fixture.pendingTimers(), 0);
});

test("timeouts permit a late external effect but never a late queue ACK or additional owned work", async () => {
  const fixture = createMemoryEventQueueFixture({ rows: [memoryEvent(1)] });
  let release: () => void = () => {}, effect = false, active: (() => boolean) | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const pending = processor(fixture, async (_event, context) => { active = context.isActive; await gate; effect = true; })
    .dispatchOne(fixture.rows[0].id);
  await fixture.flush(); await fixture.advance(fixture.settings.deliveryTimeoutMs);
  assert.equal(await pending, false); assert.equal(active!(), false); assert.equal(fixture.rows[0].processedAt, null);
  assert.equal(fixture.rows[0].lastError, "EVENT_DELIVERY_TIMEOUT"); assert.equal(fixture.pendingTimers(), 0);
  const snapshot = structuredClone(fixture.rows[0]); release(); await fixture.flush();
  assert.equal(effect, true, "timeout is not fictional cancellation of a performed external effect");
  assert.deepEqual(fixture.rows[0], snapshot);
});

test("delayed timer delivery cannot hide an exceeded monotonic deadline", async () => {
  const fixture = createMemoryEventQueueFixture({ rows: [memoryEvent(1)] });
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const pending = processor(fixture, async () => gate).dispatchOne(fixture.rows[0].id); await fixture.flush();
  await fixture.jump(fixture.settings.deliveryTimeoutMs + 1); release();
  assert.equal(await pending, false); assert.equal(fixture.rows[0].lastError, "EVENT_DELIVERY_TIMEOUT");
});

test("backoff gates retry and exhausted failure does not consume healthy work", async () => {
  const fixture = createMemoryEventQueueFixture({ settings: { maxAttempts: 2 }, rows: [memoryEvent(1)] });
  const p = processor(fixture, async () => { throw new EventDeliveryError("EVENT_DELIVERY_FAILED"); });
  assert.equal(await p.dispatchOne(fixture.rows[0].id), false);
  assert.equal(fixture.rows[0].nextAttemptAt.getTime(), fixture.now() + fixture.settings.backoffBaseMs);
  assert.equal(await p.dispatchOne(fixture.rows[0].id), false); assert.equal(fixture.rows[0].attempts, 1);
  await fixture.advance(fixture.settings.backoffBaseMs); assert.equal(await p.dispatchOne(fixture.rows[0].id), false);
  assert.ok(fixture.rows[0].exhaustedAt); assert.equal((await fixture.store.stats()).exhausted, 1);
  assert.equal(await fixture.store.claim(), null);
});

test("crash of the final attempt is parked after lease expiry and retains original facts", async () => {
  const fixture = createMemoryEventQueueFixture({ settings: { maxAttempts: 1 }, rows: [memoryEvent(1)] });
  const claim = await fixture.store.claim(); assert.equal(claim?.kind, "claimed");
  await fixture.jump(fixture.settings.leaseMs + 1);
  assert.equal((await fixture.store.stats()).exhausted, 1);
  assert.equal((await fixture.store.claim())?.kind, "exhausted");
  assert.equal(fixture.rows[0].processedAt, null); assert.equal(fixture.rows[0].lastError, "EVENT_RETRY_EXHAUSTED");
  assert.equal(fixture.rows[0].queueAttempts, 1); assert.equal(fixture.rows[0].attempts, 1);
  assert.deepEqual(fixture.rows[0].payload, { index: 1 }); assert.equal(await fixture.store.claim(), null);
});

test("internal explicit retry resets only exhausted budget without stealing active or reopening completed", async () => {
  const row = { ...memoryEvent(1), type: OBSOLETE_SKETCH_EVENT };
  const fixture = createMemoryEventQueueFixture({ settings: { maxAttempts: 1 }, rows: [row] });
  const claim = await fixture.store.claim(); assert.equal(claim?.kind, "claimed");
  const active = structuredClone(row);
  assert.equal(await fixture.store.claim({ eventId: row.id, internalRetry: true }), null); assert.deepEqual(row, active);
  if (claim?.kind !== "claimed") throw Error("missing claim");
  await fixture.store.fail(claim.event, "SKETCH_CLEANUP_PENDING"); assert.ok(row.exhaustedAt);
  assert.equal(await processor(fixture, async () => {}).dispatchOne(row.id, true), true);
  assert.equal(row.attempts, 2); assert.equal(row.queueAttempts, 1);
  const completed = structuredClone(row);
  assert.equal(await fixture.store.claim({ eventId: row.id, internalRetry: true }), null); assert.deepEqual(row, completed);
});

test("internal events stay out of hooks and ordinary publishing keeps stable nested outbox delivery", async () => {
  f.rows.push({ ...memoryEvent(1), type: OBSOLETE_SKETCH_EVENT });
  let hooks = 0; hook = async () => { hooks++; };
  await events.dispatchEvent(f.rows[0].id); assert.equal(hooks, 0); assert.equal(internalCalls, 1);
  await events.emitDomainEvent("qa135.published", { index: 99 }); assert.equal(hooks, 1);
  assert.ok(f.rows[1].processedAt); assert.equal(f.rows[1].type, "qa135.published"); assert.deepEqual(f.rows[1].payload, { index: 99 });
});

test("configuration rejects secret-bearing invalid values without echoing them and caps exponential delay", () => {
  assert.equal(getEventQueueSettings({}).enabled, false);
  for (const env of [{ DOMAIN_EVENT_WORKER_ENABLED: "secret-value" }, { DOMAIN_EVENT_MAX_ATTEMPTS: "0" },
    { DOMAIN_EVENT_HEARTBEAT_MS: "120000" }, { DOMAIN_EVENT_DELIVERY_TIMEOUT_MS: "120000" }])
    assert.throws(() => getEventQueueSettings(env), error => error instanceof Error && error.message === "EVENT_QUEUE_CONFIG_INVALID");
  assert.equal(eventRetryDelay(100_000, f.settings), f.settings.backoffMaxMs);
});
// Проверяет diagnostic metadata без runner, env read, Docker или DB connection.
test("native initialization failures keep F135/errno/Pcode and never expose private error data", () => {
  const secret = "synthetic-private-marker", hash = "f".repeat(64);
  const denied = Object.assign(Error(`postgresql://user:${secret}@private-host/db`), { code: "EPERM", stack: secret, cause: { url: secret } });
  assert.deepEqual(nativeFailureDiagnostic(denied, "private-config", hash), { ok: false, phase: "private-config", code: "F135_NATIVE_FAILED", databaseCode: null, errno: "EPERM", hold: true, sourceHash: hash });
  assert.equal(JSON.stringify(nativeFailureDiagnostic(denied, "private-config", hash)).includes(secret), false);
  assert.equal(nativeFailureDiagnostic(Error("F135_DATABASE_URL_MISSING"), "private-config", hash).code, "F135_DATABASE_URL_MISSING");
  assert.equal(nativeFailureDiagnostic({ code: "P2010", message: secret }, "target", hash).databaseCode, "P2010");
  assert.deepEqual(nativeFailureDiagnostic({ code: secret, message: secret }, "https://private/secret", secret), { ok: false, phase: "native", code: "F135_NATIVE_FAILED", databaseCode: null, errno: null, hold: true, sourceHash: null });
});
function completionObserver(fixture: ReturnType<typeof createMemoryEventQueueFixture>, row: QueuedDomainEvent,
  options: { signal?: AbortSignal; observe?: typeof fixture.store.observe } = {}) {
  const immutable = ({ id, type, actor, payload, createdAt }: QueuedDomainEvent) => ({ id, type, actor, payload, createdAt });
  const expected = JSON.stringify(immutable(row)); let writes = 0, reads = 0;
  const unexpected = async () => { writes++; throw Error("OBSERVER_MUST_NOT_OWN_OR_DELIVER"); };
  const queue = createEventQueueProcessor({ settings: fixture.settings, timers: fixture.timers,
    store: { ...fixture.store, observe: options.observe ?? fixture.store.observe,
      claim: unexpected, renew: unexpected, complete: unexpected, fail: unexpected }, deliver: unexpected });
  const pending = queue.waitForCompletion(row.id, { claimToken: row.claimToken ?? undefined, signal: options.signal,
    verifyIntent(current) { reads++; return JSON.stringify(immutable(current)) === expected; } });
  return { pending, writes: () => writes, reads: () => reads };
}

test("manual observer accepts only durable same-intent completion despite historical lastError", async () => {
  const fixture = createMemoryEventQueueFixture(), row = memoryEvent(71); row.lastError = "OLD_FAILURE"; fixture.rows.push(row);
  const claim = await fixture.store.claim({ eventId: row.id }); assert.equal(claim?.kind, "claimed"); if (claim?.kind !== "claimed") return;
  const before = structuredClone(row), observer = completionObserver(fixture, row); let settled = false;
  void observer.pending.then(() => { settled = true; }); await fixture.flush(); assert.equal(settled, false);
  assert.equal(await fixture.store.complete(claim.event), true); await fixture.advance(100);
  assert.equal(await observer.pending, true); assert.equal(observer.writes(), 0); assert.ok(observer.reads() >= 2);
  assert.equal(row.attempts, before.attempts); assert.deepEqual(row.payload, before.payload); assert.equal(fixture.pendingTimers(), 0);
});

test("manual observer stops when current owner fails without claiming,ACK,renew or retry", async () => {
  const fixture = createMemoryEventQueueFixture(), row = memoryEvent(72); fixture.rows.push(row);
  const claim = await fixture.store.claim({ eventId: row.id }); if (claim?.kind !== "claimed") throw Error("OWNER_REQUIRED");
  const observer = completionObserver(fixture, row); await fixture.flush(); await fixture.store.fail(claim.event, "STORAGE_UNAVAILABLE");
  await fixture.advance(100); assert.equal(await observer.pending, false); assert.equal(observer.writes(), 0);
  assert.equal(row.processedAt, null); assert.equal(row.attempts, 1); assert.equal(fixture.pendingTimers(), 0);
});

test("manual observer rejects missing,released,exhausted,expired,reclaimed and changed completed intent", async () => {
  const mutations: ((fixture: ReturnType<typeof createMemoryEventQueueFixture>, row: QueuedDomainEvent) => void)[] = [
    fixture => { fixture.rows.length = 0; },
    (_fixture, row) => { row.claimToken = null; row.leaseUntil = null; },
    (fixture, row) => { row.exhaustedAt = new Date(fixture.now()); },
    (fixture, row) => { row.leaseUntil = new Date(fixture.now()); },
    (_fixture, row) => { row.claimToken = "reclaimed-token"; },
    (fixture, row) => { row.payload = { changedIntent: true }; row.processedAt = new Date(fixture.now()); },
    (fixture, row) => { row.actor = "foreign-actor"; row.processedAt = new Date(fixture.now()); },
    (fixture, row) => { row.createdAt = new Date(0); row.processedAt = new Date(fixture.now()); },
  ];
  for (const mutate of mutations) {
    const fixture = createMemoryEventQueueFixture(), row = memoryEvent(73); fixture.rows.push(row);
    await fixture.store.claim({ eventId: row.id }); const observer = completionObserver(fixture, row);
    await fixture.flush(); mutate(fixture, row); await fixture.advance(100);
    assert.equal(await observer.pending, false); assert.equal(observer.writes(), 0); assert.equal(fixture.pendingTimers(), 0);
  }
});

test("manual observer timeout is bounded and leaves another owner and late readonly result untouched", async () => {
  const fixture = createMemoryEventQueueFixture({ settings: { deliveryTimeoutMs: 250 } }), row = memoryEvent(74); fixture.rows.push(row);
  await fixture.store.claim({ eventId: row.id }); const before = structuredClone(row);
  let resolveRead: (value: Awaited<ReturnType<typeof fixture.store.observe>>) => void = () => {};
  const blocked = new Promise<Awaited<ReturnType<typeof fixture.store.observe>>>(resolve => { resolveRead = resolve; });
  const observer = completionObserver(fixture, row, { observe: async () => blocked }); await fixture.advance(250);
  assert.equal(await observer.pending, false); assert.equal(observer.writes(), 0); assert.equal(observer.reads(), 0);
  assert.deepEqual(row, before); assert.equal(fixture.pendingTimers(), 0);
  resolveRead({ event: structuredClone(row), leaseActive: true }); await fixture.flush(); assert.equal(observer.reads(), 0); assert.deepEqual(row, before);
});

test("manual observer abort stops only waiting and immediately aborted call performs no read", async () => {
  const fixture = createMemoryEventQueueFixture(), row = memoryEvent(75); fixture.rows.push(row);
  await fixture.store.claim({ eventId: row.id }); const before = structuredClone(row), controller = new AbortController();
  const observer = completionObserver(fixture, row, { signal: controller.signal }); await fixture.flush(); controller.abort(); await fixture.flush();
  assert.equal(await observer.pending, false); assert.equal(observer.writes(), 0); assert.deepEqual(row, before); assert.equal(fixture.pendingTimers(), 0);
  const already = completionObserver(fixture, row, { signal: controller.signal }); assert.equal(await already.pending, false); assert.equal(already.reads(), 0); assert.equal(already.writes(), 0);
});