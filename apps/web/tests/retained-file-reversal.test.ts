import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma } from "@prisma/client";
import { applyRetainedFileReversal, checkRetainedFileReversal,
  retainedFileReversalState, type RetainedFileReversal } from "../src/server/files/retained-file-reversal";

function fixture() {
  const timestamp = new Date("2026-11-20T10:11:12.000Z");
  const previous = { id: "previous", projectId: "office", productId: "desk", taskId: null,
    storedName: "previous.png", deletedAt: timestamp, deletedById: "author" };
  const replacement = { ...previous, id: "replacement", storedName: "replacement.png", deletedAt: null, deletedById: null };
  const rows = new Map<string, { deletedAt: Date | null; deletedById: string | null; storedName: string }>(
    [[previous.id, previous], [replacement.id, replacement]]);
  const product = { sketchFileId: replacement.id as string | null };
  const tx = {
    $queryRaw: async () => [],
    product: { findFirst: async () => product,
      update: async ({ data }: { data: typeof product }) => Object.assign(product, data) },
    file: {
      findFirst: async ({ where }: { where: { id: string; storedName: string; deletedAt: Date | null } }) => {
        const row = rows.get(where.id);
        if (!row || row.storedName !== where.storedName || row.deletedAt?.getTime() !== where.deletedAt?.getTime()) return null;
        return { id: where.id, coverForProject: null, sketchForProduct: product.sketchFileId === where.id ? { id: "desk" } : null };
      },
      update: async ({ where, data }: { where: { id: string }; data: { deletedAt: Date | null; deletedById: string | null } }) =>
        Object.assign(rows.get(where.id)!, data),
    },
  } as unknown as Prisma.TransactionClient;
  const data: RetainedFileReversal = { files: [
    retainedFileReversalState(previous, timestamp, false),
    retainedFileReversalState(replacement, null, true),
  ], pointer: { kind: "product", id: "desk", expectedFileId: "replacement", fileId: "previous" } };
  return { tx, data, product, rows };
}

test("sketch reversal restores the same file and binding, and provides a reversible inverse", async () => {
  const { tx, data, product, rows } = fixture();
  assert.equal(await checkRetainedFileReversal(tx, data), null);
  const inverse = await applyRetainedFileReversal(tx, "administrator", data);
  assert.equal(product.sketchFileId, "previous");
  assert.equal(rows.get("previous")?.deletedAt, null);
  assert.equal(rows.get("previous")?.storedName, "previous.png");
  assert.equal(rows.get("replacement")?.deletedById, "administrator");
  await applyRetainedFileReversal(tx, "director", inverse);
  assert.equal(product.sketchFileId, "replacement");
  assert.ok(rows.get("previous")?.deletedAt);
  assert.equal(rows.get("replacement")?.deletedAt, null);
});

test("sketch reversal detects a newer binding before changing any row", async () => {
  const { tx, data, product, rows } = fixture();
  product.sketchFileId = "third";
  const before = structuredClone(rows);
  await assert.rejects(applyRetainedFileReversal(tx, "administrator", data), /уже изменены/);
  assert.deepEqual(rows, before);
  assert.equal(product.sketchFileId, "third");
});

