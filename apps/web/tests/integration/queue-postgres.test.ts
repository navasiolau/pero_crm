import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Prisma } from "@prisma/client";
import { DEFAULT_EVENT_QUEUE_SETTINGS, EventDeliveryError, type OwnedDomainEvent } from "../../src/server/plugins/event-queue-contract";
import { createPostgresEventQueueStore } from "../../src/server/plugins/event-queue-store";
import { createPostgresSubscriberStore } from "../../src/server/plugins/event-subscriber-store";
import { OBSOLETE_SKETCH_EVENT } from "../../src/server/products/sketch-cleanup-contract";
import { verifyNative135Cases } from "../event-queue-native-cases";
import { guardedModuleCache } from "../helpers/guarded-module-cache";
import { createPostgresFixture } from "./postgres.fixture";

let fixture: Awaited<ReturnType<typeof createPostgresFixture>>;
before(async () => { fixture = await createPostgresFixture("queue"); });
after(async () => { if (fixture) try { await fixture.verifyProtected(); } finally { await fixture.dispose(); } });

test("queue/native135-overlap-fences-lock-expiry-retry-fairness", async () => {
  const actor = fixture.id("actor"), stamp = new Date("2026-10-11T00:00:00.000Z");
  const fixtures = ["completed", "pending", "internal"].map(label => ({ id: fixture.id(label) }));
  await fixture.db.domainEvent.createMany({ data: fixtures.map((row, index) => ({
    id: row.id, actor, type: index === 2 ? OBSOLETE_SKETCH_EVENT : "qa135.fixture",
    payload: { qa135Run: fixture.target.runId, kind: ["completed", "pending", "internal"][index] },
    createdAt: stamp, processedAt: index === 0 ? stamp : null, attempts: index === 1 ? 999 : 5, lastError: "QA135_HISTORY",
  })) });
  const result = await verifyNative135Cases(fixture.db, fixture.peer, {
    runId: fixture.target.runId, actor, fixtures, orderIds: Array.from({ length: 51 }, (_, index) => fixture.id(`order-${index}`)),
  }, { ...DEFAULT_EVENT_QUEUE_SETTINGS, enabled: false });
  assert.equal(result.backendPids.length, 2); assert.notEqual(result.backendPids[0], result.backendPids[1]);
  const waitWitness = result.waitWitness as { lockerPid: number; waiterPid: number } | null;
  assert.equal(result.heldOverlapWitness, true); assert.ok(waitWitness);
  assert.notEqual(waitWitness.lockerPid, waitWitness.waiterPid); assert.equal(result.cases.length, 5);
});

test("queue/db-clock-and-utc-processing-in-non-utc-session", async () => fixture.rollback(async (tx, rows) => {
  await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'Asia/Tokyo'");
  const [{ observed: before }] = await tx.$queryRaw<{ observed: Date }[]>`SELECT clock_timestamp() AS observed`;
  const id = rows.id("timezone"), settings = { ...DEFAULT_EVENT_QUEUE_SETTINGS, enabled: false };
  await tx.domainEvent.create({ data: { id, actor: rows.id("actor"), type: "ci169.timezone", payload: {}, createdAt: new Date(before.getTime() - 5000), nextAttemptAt: new Date(0) } });
  const store = createPostgresEventQueueStore(tx, settings, [id]), stats = await store.stats();
  assert.equal(stats.ready, 1); assert.equal(stats.active, 0); assert.equal(stats.exhausted, 0);
  assert.ok(stats.oldestPendingAgeMs !== null && stats.oldestPendingAgeMs >= 5000 && stats.oldestPendingAgeMs < 20_000);
  const claim = await store.claim({ eventId: id }); assert.equal(claim?.kind, "claimed");
  if (claim?.kind !== "claimed") assert.fail("REAL_QUEUE_CLAIM_REQUIRED");
  assert.equal((await store.observe(id))?.leaseActive, true); assert.equal(await store.complete(claim.event), true);
  const [{ observed: after }] = await tx.$queryRaw<{ observed: Date }[]>(Prisma.sql`SELECT clock_timestamp() AS observed`);
  const processed = (await store.read(id))!.processedAt!;
  assert.ok(processed.getTime() >= before.getTime() && processed.getTime() <= after.getTime(), "PROCESSED_AT_IS_UTC_INSTANT");
  assert.deepEqual(await store.stats(), { ready: 0, active: 0, exhausted: 0, oldestPendingAgeMs: null });
}));

test("queue/subscriber-freeze-unique-empty-dispatch-ack-idempotency-and-expiry-rollback", async () => {
  const settings = { ...DEFAULT_EVENT_QUEUE_SETTINGS, leaseMs: 3000, heartbeatMs: 500, deliveryTimeoutMs: 2000, backoffBaseMs: 100, backoffMaxMs: 400 };
  const names = ["concurrent", "empty", "parent", "child", "idempotent", "effect", "fence", "rollback", "completed"] as const;
  const ids = Object.fromEntries(names.map(name => [name, fixture.id(`subscriber-${name}`)])) as Record<typeof names[number], string>;
  const scopeIds = Object.values(ids), actor = fixture.id("subscriber-actor");
  await fixture.db.domainEvent.createMany({ data: names.filter(name => !["child", "effect"].includes(name)).map(name => ({ id: ids[name], actor,
    type: `ci169.${name}`, payload: { owner: actor }, processedAt: name === "completed" ? new Date() : null, nextAttemptAt: new Date(0) })) });
  const queue = createPostgresEventQueueStore(fixture.db, settings, scopeIds), peerQueue = createPostgresEventQueueStore(fixture.peer, settings, scopeIds);
  const store = createPostgresSubscriberStore(fixture.db, settings, scopeIds), peerStore = createPostgresSubscriberStore(fixture.peer, settings, scopeIds);
  const claim = async (q: typeof queue, id: string): Promise<OwnedDomainEvent> => {
    const result = await q.claim({ eventId: id, internalRetry: true }); assert.equal(result?.kind, "claimed");
    if (result?.kind !== "claimed") assert.fail("REAL_SUBSCRIBER_CLAIM_REQUIRED"); return result.event;
  };
  const lost = (error: unknown) => error instanceof EventDeliveryError && error.code === "EVENT_CLAIM_LOST";
  const gate = () => { let resolve = () => {}; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; };
  const frozen = await claim(queue, ids.concurrent), locked = gate(), requested = gate(), release = gate();
  let holder: Prisma.TransactionClient | undefined, holderPid = 0, waiterPid = 0;
  const controlled = (db: typeof fixture.db, first: boolean) => new Proxy(db, { get(client, key) {
    if (key === "$transaction") return new Proxy(client.$transaction, { apply(transaction, _receiver, [operation, options]) {
      if (typeof operation !== "function") return Reflect.apply(transaction, client, [operation, options]);
      return Reflect.apply(transaction, client, [async (tx: Prisma.TransactionClient) => {
        const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        if (first) { holder = tx; holderPid = pid; } else { waiterPid = pid; requested.resolve(); }
        return operation(new Proxy(tx, { get(target, key) {
          if (first && key === "$queryRaw") return async (sql: Prisma.Sql) => {
            const result = await target.$queryRaw(sql); if (sql.strings.join("").includes("FOR UPDATE")) { locked.resolve(); await release.promise; } return result;
          };
          const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
        } }));
      }, options]);
    } });
    const value = Reflect.get(client, key); return typeof value === "function" ? value.bind(client) : value;
  } });
  const first = createPostgresSubscriberStore(controlled(fixture.db, true), settings, scopeIds).initialize(frozen, ["a", "b"]);
  void first.catch(() => {}); let second: Promise<Awaited<ReturnType<typeof store.initialize>>> | undefined;
  try {
    await Promise.race([locked.promise, first.then(() => assert.fail("ACTUAL_SUBSCRIBER_LOCK_REQUIRED"))]);
    second = createPostgresSubscriberStore(controlled(fixture.peer, false), settings, scopeIds).initialize(frozen, ["b", "c"]); void second.catch(() => {});
    await requested.promise; assert.ok(holder && holderPid !== waiterPid);
    const deadline = performance.now() + 5000; let waiting = false;
    while (!waiting && performance.now() < deadline) {
      const [row] = await holder.$queryRaw<{ waiting: boolean }[]>`SELECT ${holderPid}::int4=ANY(pg_blocking_pids(${waiterPid}::int4)) AS waiting`;
      waiting = row.waiting; if (!waiting) await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(waiting, true, "REAL_SUBSCRIBER_INITIALIZE_WAITER");
  } finally { release.resolve(); await Promise.allSettled([first, ...(second ? [second] : [])]); }
  assert.ok(second); const [a, b] = await Promise.all([first, second]); assert.deepEqual(a, b); assert.deepEqual(a.map(row => row.subscriberId), ["a", "b"]);
  for (const data of [{ subscriberId: "a", position: 2 }, { subscriberId: "c", position: 0 }])
    await assert.rejects(fixture.peer.domainEventDelivery.create({ data: { eventId: frozen.id, ...data } }), error => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002");
  const empty = await claim(queue, ids.empty); assert.deepEqual(await store.initialize(empty, []), []); assert.deepEqual(await peerStore.initialize(empty, ["c"]), []);
  assert.ok(await fixture.db.domainEventDeliveryPlan.findUnique({ where: { eventId: empty.id } }));

  let enabled = ["a", "b"], failB = true, failEffect = true, effectCalls = 0; const calls: string[] = [];
  const overrides = {
    "../src/server/plugins/event-queue-store": { createPostgresEventQueueStore: () => queue },
    "../src/server/plugins/event-subscriber-store": { createPostgresSubscriberStore: () => store },
    "../src/server/plugins/event-queue-contract": { DEFAULT_EVENT_QUEUE_SETTINGS, EventDeliveryError, getEventQueueSettings: () => settings },
    "../src/server/plugins/context": { buildPluginContext: async (id: string, emit: (type: string, payload: unknown, actor: string) => Promise<void>) => ({ emit: (type: string, payload: unknown) => emit(type, payload, `plugin:${id}`) }) },
    "../src/server/plugins/registry": { getManifest: (id: string) => ({ hooks: { onDomainEvent: async (event: { id: string; type: string }, ctx: { emit: (type: string, payload: unknown) => Promise<void> }) => {
      assert.ok(scopeIds.includes(event.id)); if (event.id === ids.parent) { calls.push(id); if (id === "a") await ctx.emit("ci169.child", { owner: actor }); if (id === "b" && failB) throw Error("CI169_SUBSCRIBER_RETRY"); }
      if (event.id === ids.idempotent && id === "a") { effectCalls++; await fixture.db.domainEvent.createMany({ data: [{ id: ids.effect, actor, type: "ci169.effect", payload: {} }], skipDuplicates: true }); if (failEffect) throw Error("CI169_EFFECT_BEFORE_ACK"); }
    } } }) },
    "../src/server/plugins/run-log": { logPluginRun: async () => {} },
  };
  const facade = { plugin: { findMany: async () => enabled.map(id => ({ id })) }, domainEvent: { create: async ({ data }: { data: { type: string; payload: Prisma.InputJsonValue; actor: string } }) => {
    assert.equal(data.type, "ci169.child"); assert.equal(data.actor, "plugin:a"); return fixture.db.domainEvent.create({ data: { ...data, id: ids.child } });
  } } };
  const scope = guardedModuleCache(new URL("../ci169-subscriber-scope.ts", import.meta.url).href, { targets: ["../src/server/plugins/events"], allowedOverrides: Object.keys(overrides), overrides, prisma: facade });
  try {
    const events = scope.load<typeof import("../../src/server/plugins/events")>("../src/server/plugins/events");
    await events.dispatchEvent(ids.completed); assert.equal(await fixture.db.domainEventDeliveryPlan.count({ where: { eventId: ids.completed } }), 0);
    await events.dispatchEvent(ids.parent);
    const ack = await fixture.db.domainEventDelivery.findUniqueOrThrow({ where: { eventId_subscriberId: { eventId: ids.parent, subscriberId: "a" } } }); assert.ok(ack.deliveredAt);
    failB = false; enabled.push("c"); await fixture.db.domainEvent.update({ where: { id: ids.parent }, data: { nextAttemptAt: new Date(0) } });
    await fixture.db.domainEventDelivery.update({ where: { eventId_subscriberId: { eventId: ids.parent, subscriberId: "b" } }, data: { nextAttemptAt: new Date(0) } });
    await events.dispatchEvent(ids.parent); assert.deepEqual(calls, ["a", "b", "b"]);
    assert.deepEqual(await fixture.db.domainEventDelivery.findUniqueOrThrow({ where: { eventId_subscriberId: { eventId: ids.parent, subscriberId: "a" } } }), ack);
    assert.ok((await fixture.db.domainEvent.findUniqueOrThrow({ where: { id: ids.parent } })).processedAt); assert.equal(await fixture.db.domainEvent.count({ where: { id: ids.child } }), 1);
    enabled = ["a"]; await events.dispatchEvent(ids.idempotent); failEffect = false;
    await fixture.db.domainEvent.update({ where: { id: ids.idempotent }, data: { nextAttemptAt: new Date(0) } });
    await fixture.db.domainEventDelivery.update({ where: { eventId_subscriberId: { eventId: ids.idempotent, subscriberId: "a" } }, data: { nextAttemptAt: new Date(0) } });
    await events.dispatchEvent(ids.idempotent); assert.equal(effectCalls, 2); assert.equal(await fixture.db.domainEvent.count({ where: { id: ids.effect } }), 1);
    assert.ok((await fixture.db.domainEvent.findUniqueOrThrow({ where: { id: ids.idempotent } })).processedAt);
  } finally { scope.restore(); }

  const old = await claim(queue, ids.fence); await store.initialize(old, ["a"]); assert.equal(await store.begin(old, "a"), "started");
  await fixture.db.domainEvent.update({ where: { id: old.id }, data: { leaseUntil: new Date(0) } });
  const replacement = await claim(peerQueue, old.id); assert.notEqual(replacement.claimToken, old.claimToken); assert.equal(await peerStore.begin(replacement, "a"), "started");
  const before = await fixture.db.domainEventDelivery.findMany({ where: { eventId: old.id } }); await assert.rejects(store.complete(old, "a"), lost);
  assert.deepEqual(await fixture.db.domainEventDelivery.findMany({ where: { eventId: old.id } }), before);
  let waitingCompletion: Promise<void> | undefined;
  await fixture.db.$transaction(async tx => {
    const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "DomainEvent" WHERE id=${old.id} FOR UPDATE`);
    waiterPid = 0; waitingCompletion = assert.rejects(createPostgresSubscriberStore(controlled(fixture.peer, false), settings, scopeIds).complete(replacement, "a"), lost);
    void waitingCompletion.catch(() => {}); const deadline = performance.now() + 5000; let waiting = false;
    while (!waiting && performance.now() < deadline) {
      if (waiterPid) waiting = (await tx.$queryRaw<{ waiting: boolean }[]>`SELECT ${pid}::int4=ANY(pg_blocking_pids(${waiterPid}::int4)) AS waiting`)[0].waiting;
      if (!waiting) await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(waiting, true, "SUBSCRIBER_COMPLETION_WAITED_FOR_ROW_LOCK");
    await tx.domainEvent.update({ where: { id: old.id }, data: { leaseUntil: new Date(0) } });
  });
  assert.ok(waitingCompletion); await waitingCompletion;
  assert.deepEqual(await fixture.db.domainEventDelivery.findMany({ where: { eventId: old.id } }), before, "POST_LOCK_EXPIRED_ACK_ZERO_WRITES");
  const rollback = await claim(queue, ids.rollback); let inserted = false;
  const delayed = new Proxy(fixture.db, { get(client, key) {
    if (key === "$transaction") return new Proxy(client.$transaction, { apply(transaction, _receiver, [operation, options]) {
      if (typeof operation !== "function") return Reflect.apply(transaction, client, [operation, options]);
      return Reflect.apply(transaction, client, [async (tx: Prisma.TransactionClient) => operation(new Proxy(tx, { get(target, key) {
        if (key === "domainEventDeliveryPlan") return new Proxy(target.domainEventDeliveryPlan, { get(model, method) {
          if (method === "create") return async (args: Prisma.DomainEventDeliveryPlanCreateArgs) => {
            const result = await model.create(args); inserted = true;
            await tx.domainEvent.update({ where: { id: rollback.id }, data: { leaseUntil: new Date(0) } }); return result;
          };
          const value = Reflect.get(model, method); return typeof value === "function" ? value.bind(model) : value;
        } });
        const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
      } })), options]);
    } });
    const value = Reflect.get(client, key); return typeof value === "function" ? value.bind(client) : value;
  } });
  await assert.rejects(createPostgresSubscriberStore(delayed, settings, scopeIds).initialize(rollback, ["a"]), lost);
  assert.equal(inserted, true); assert.equal(await fixture.db.domainEventDeliveryPlan.count({ where: { eventId: rollback.id } }), 0);
  assert.equal(await fixture.db.domainEventDelivery.count({ where: { eventId: rollback.id } }), 0);
});
