import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Prisma } from "@prisma/client";
import { DEFAULT_EVENT_QUEUE_SETTINGS } from "../../src/server/plugins/event-queue-contract";
import { createPostgresEventQueueStore } from "../../src/server/plugins/event-queue-store";
import { OBSOLETE_SKETCH_EVENT } from "../../src/server/products/sketch-cleanup-contract";
import { verifyNative135Cases } from "../event-queue-native-cases";
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
