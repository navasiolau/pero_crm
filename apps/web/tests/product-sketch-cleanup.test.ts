import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { cleanupObsoleteSketch } from "../src/server/products/sketch-cleanup";
import { OBSOLETE_SKETCH_EVENT, obsoleteSketchEventId } from "../src/server/products/sketch-cleanup-contract";
import { createMemoryEventQueueFixture, memoryEvent } from "./helpers/event-queue-fixture";

const mutation = "12222222-2222-4222-8222-222222222222";
function fixture() {
  const queue = createMemoryEventQueueFixture();
  const event = { ...memoryEvent(1), id: obsoleteSketchEventId(mutation), type: OBSOLETE_SKETCH_EVENT, payload: {
    projectId: "j", productId: "p", fileId: "old", storedName: "old.png", newFileId: "first", clientMutationId: mutation,
  } };
  queue.rows.push(event);
  const current = { id: "winner", projectId: "j", storedName: "winner.png" };
  let referenced = false;
  const db = { file: { findFirst: async () => referenced ? current : null },
    $queryRaw: async () => { throw Error("unexpected native DB in memory fixture"); },
  } as unknown as Pick<PrismaClient, "file" | "$queryRaw">;
  return { event, db, current, queue, reference: () => { referenced = true; } };
}
test("partial original/thumb cleanup persists pending intent and retry removes only obsolete key pair", async () => {
  const f = fixture(), removed = new Set<string>(); let failThumb = true;
  const remove = async (key: string) => { if (failThumb && key.includes("/thumbs/")) throw Error("private storage detail"); removed.add(key); };
  assert.equal(await cleanupObsoleteSketch(f.event.id, f.db, remove, f.queue.store), false);
  assert.equal(f.event.processedAt, null); assert.equal(f.event.lastError, "SKETCH_CLEANUP_PENDING");
  assert.deepEqual([...removed], ["j/old.png"]);
  failThumb = false; assert.equal(await cleanupObsoleteSketch(f.event.id, f.db, remove, f.queue.store), true);
  assert.ok(f.event.processedAt); assert.deepEqual([...removed], ["j/old.png", "j/thumbs/old.png.jpg"]);
  let more = 0; assert.equal(await cleanupObsoleteSketch(f.event.id, f.db, async () => { more++; }, f.queue.store), true); assert.equal(more, 0);
});
test("a live alias/current key blocks every physical deletion and leaves the exact intent pending", async () => {
  const f = fixture(); f.reference(); let deletes = 0;
  assert.equal(await cleanupObsoleteSketch(f.event.id, f.db, async () => { deletes++; }, f.queue.store), false);
  assert.equal(deletes, 0); assert.equal(f.event.processedAt, null); assert.equal(f.current.storedName, "winner.png");
});
test("invalid path, mismatched mutation or same old/new ID never reach storage", async () => {
  for (const patch of [{ storedName: "../outside" }, { storedName: "folder\\\\old.png" }, { projectId: ".." },
    { newFileId: "old" }, { clientMutationId: "32222222-2222-4222-8222-222222222222" }]) {
    const f = fixture(); Object.assign(f.event.payload, patch); let deletes = 0;
    assert.equal(await cleanupObsoleteSketch(f.event.id, f.db, async () => { deletes++; }, f.queue.store), false);
    assert.equal(deletes, 0); assert.equal(f.event.processedAt, null);
  }
});
test("superseded first-result intent still targets only its predecessor, preserving a later current winner", async () => {
  const f = fixture(), removed: string[] = [];
  assert.equal(await cleanupObsoleteSketch(f.event.id, f.db, async key => { removed.push(key); }, f.queue.store), true);
  assert.deepEqual(removed, ["j/old.png", "j/thumbs/old.png.jpg"]);
  assert.ok(removed.every(key => !key.includes(f.current.storedName)));
});

test("lease lost after original erasure stops thumbnail and cannot bypass queue ACK", async () => {
  const f = fixture(), removed: string[] = [];
  const remove = async (key: string) => { removed.push(key); await f.queue.jump(f.queue.settings.leaseMs + 1); };
  assert.equal(await cleanupObsoleteSketch(f.event.id, f.db, remove, f.queue.store), false);
  assert.deepEqual(removed, ["j/old.png"]); assert.equal(f.event.processedAt, null);
  assert.ok(f.event.claimToken); assert.equal(f.event.queueAttempts, 1);
});
test("manual cleanup rejects valid but changed intent between initial read and claim before removal", async () => {
  const f = fixture(), claim = f.queue.store.claim.bind(f.queue.store); let deletes = 0;
  f.queue.store.claim = async request => { f.event.payload.storedName = "other.png"; return claim(request); };
  assert.equal(await cleanupObsoleteSketch(f.event.id, f.db, async () => { deletes++; }, f.queue.store), false);
  assert.equal(deletes, 0); assert.equal(f.event.processedAt, null);
});

test("manual cleanup verifies changed terminal payload even if dispatch read sees completion", async () => {
  const f = fixture(), read = f.queue.store.read.bind(f.queue.store); let reads = 0, deletes = 0;
  f.queue.store.read = async id => {
    if (++reads === 2) { f.event.payload.storedName = "other.png"; f.event.processedAt = new Date(f.queue.now()); }
    return read(id);
  };
  assert.equal(await cleanupObsoleteSketch(f.event.id, f.db, async () => { deletes++; }, f.queue.store), false);
  assert.equal(deletes, 0); assert.ok(f.event.processedAt);
});