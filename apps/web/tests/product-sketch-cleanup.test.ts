import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { cleanupObsoleteSketch } from "../src/server/products/sketch-cleanup";
import { OBSOLETE_SKETCH_EVENT, obsoleteSketchEventId } from "../src/server/products/sketch-cleanup-contract";

const mutation = "12222222-2222-4222-8222-222222222222";
function fixture() {
  const event = { id: obsoleteSketchEventId(mutation), type: OBSOLETE_SKETCH_EVENT, processedAt: null as Date | null,
    attempts: 0, lastError: null as string | null, payload: {
      projectId: "j", productId: "p", fileId: "old", storedName: "old.png", newFileId: "first", clientMutationId: mutation,
    } };
  const current = { id: "winner", projectId: "j", storedName: "winner.png" };
  let referenced = false;
  const db = { file: { findFirst: async () => referenced ? current : null }, domainEvent: {
    findUnique: async () => event,
    update: async ({ data }: { data: { processedAt: Date; lastError: null } }) => {
      event.processedAt = data.processedAt; event.lastError = data.lastError; event.attempts++; return event;
    },
    updateMany: async () => { if (!event.processedAt) { event.attempts++; event.lastError = "SKETCH_CLEANUP_PENDING"; } return { count: 1 }; },
  } } as unknown as Pick<PrismaClient, "file" | "domainEvent">;
  return { event, db, current, reference: () => { referenced = true; } };
}
test("partial original/thumb cleanup persists pending intent and retry removes only obsolete key pair", async () => {
  const f = fixture(), removed = new Set<string>(); let failThumb = true;
  const remove = async (key: string) => { if (failThumb && key.includes("/thumbs/")) throw Error("private storage detail"); removed.add(key); };
  assert.equal(await cleanupObsoleteSketch(f.event.id, f.db, remove), false);
  assert.equal(f.event.processedAt, null); assert.equal(f.event.lastError, "SKETCH_CLEANUP_PENDING");
  assert.deepEqual([...removed], ["j/old.png"]);
  failThumb = false; assert.equal(await cleanupObsoleteSketch(f.event.id, f.db, remove), true);
  assert.ok(f.event.processedAt); assert.deepEqual([...removed], ["j/old.png", "j/thumbs/old.png.jpg"]);
  let more = 0; assert.equal(await cleanupObsoleteSketch(f.event.id, f.db, async () => { more++; }), true); assert.equal(more, 0);
});
test("a live alias/current key blocks every physical deletion and leaves the exact intent pending", async () => {
  const f = fixture(); f.reference(); let deletes = 0;
  assert.equal(await cleanupObsoleteSketch(f.event.id, f.db, async () => { deletes++; }), false);
  assert.equal(deletes, 0); assert.equal(f.event.processedAt, null); assert.equal(f.current.storedName, "winner.png");
});
test("invalid path, mismatched mutation or same old/new ID never reach storage", async () => {
  for (const patch of [{ storedName: "../outside" }, { storedName: "folder\\\\old.png" }, { projectId: ".." },
    { newFileId: "old" }, { clientMutationId: "32222222-2222-4222-8222-222222222222" }]) {
    const f = fixture(); Object.assign(f.event.payload, patch); let deletes = 0;
    assert.equal(await cleanupObsoleteSketch(f.event.id, f.db, async () => { deletes++; }), false);
    assert.equal(deletes, 0); assert.equal(f.event.processedAt, null);
  }
});
test("superseded first-result intent still targets only its predecessor, preserving a later current winner", async () => {
  const f = fixture(), removed: string[] = [];
  assert.equal(await cleanupObsoleteSketch(f.event.id, f.db, async key => { removed.push(key); }), true);
  assert.deepEqual(removed, ["j/old.png", "j/thumbs/old.png.jpg"]);
  assert.ok(removed.every(key => !key.includes(f.current.storedName)));
});
