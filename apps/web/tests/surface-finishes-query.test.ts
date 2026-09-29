import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma } from "@prisma/client";
import { getProductCompositionFor } from "../src/server/composition/queries";
import { listFinishSampleFilesFor } from "../src/server/finishes/queries";

test("composition DTO batches only selected revision's finishes onto their own item", async () => {
  const now = new Date("2026-09-29T00:00:00Z");
  const revisions = [{ id: "old", productId: "product", status: "CONFIRMED", revisionNo: 1, draftVersion: 2,
    baseRevisionId: null, createdAt: now, createdById: "manager", confirmedAt: now, confirmedById: "manager" },
  { id: "draft", productId: "product", status: "DRAFT", revisionNo: null, draftVersion: 0,
    baseRevisionId: "old", createdAt: now, createdById: "manager", confirmedAt: null, confirmedById: null }];
  const items = [{ id: "old-item", revisionId: "old", lineageId: "same", parentId: null, kind: "PART", designation: "D-1",
    title: "Деталь", quantityPerParent: 1, travelsToInstallation: false, sortOrder: 0, createdAt: now, updatedAt: now },
  { id: "draft-item", revisionId: "draft", lineageId: "same", parentId: null, kind: "PART", designation: "D-1",
    title: "Деталь", quantityPerParent: 1, travelsToInstallation: false, sortOrder: 0, createdAt: now, updatedAt: now }];
  const finishes = [{ id: "old-finish", revisionId: "old", itemId: "old-item", surfaceKind: "FACE", surfaceLabel: "Лицевая",
    normalizedSurfaceLabel: "ЛИЦЕВАЯ", layerOrder: 1, finishKind: "VENEER", name: "Дуб", code: "OAK-01",
    colorHex: null, sampleFileId: "oak-file" },
  { id: "draft-finish", revisionId: "draft", itemId: "draft-item", surfaceKind: "FACE", surfaceLabel: "Лицевая",
    normalizedSurfaceLabel: "ЛИЦЕВАЯ", layerOrder: 1, finishKind: "ENAMEL", name: "Зелёная", code: "GREEN-02",
    colorHex: "#00FF00", sampleFileId: null }];
  const db = { task: { findMany: async () => [] }, product: { findFirst: async () => ({ id: "product", number: "P-1" }) },
    productCompositionRevision: { findMany: async () => revisions },
    productCompositionItem: { findMany: async ({ where }: { where: { revisionId: string } }) =>
      items.filter((item) => item.revisionId === where.revisionId) },
    productCompositionFinish: { findMany: async ({ where }: { where: { revisionId: string } }) =>
      finishes.filter((finish) => finish.revisionId === where.revisionId) } } as unknown as Prisma.TransactionClient;
  const actor = { id: "manager", roles: ["MANAGER" as const] };
  const old = await getProductCompositionFor(db, actor, "product");
  assert.deepEqual(old?.items[0].finishes.map((finish) => [finish.id, finish.code, finish.sampleFileId]),
    [["old-finish", "OAK-01", "oak-file"]]);
  const draft = await getProductCompositionFor(db, actor, "product", "draft");
  assert.deepEqual(draft?.items[0].finishes.map((finish) => [finish.id, finish.code, finish.colorHex]),
    [["draft-finish", "GREEN-02", "#00FF00"]]);
  assert.equal(await getProductCompositionFor(db, actor, "product", "foreign"), null);
});

test("sample selector requires technical edit grant and filters same-Product JPEG/PNG/WebP", async () => {
  const calls: unknown[] = [];
  const db = { task: { findMany: async () => [] },
    product: { findFirst: async () => ({ id: "product", projectId: "project", engineerId: "engineer", status: "DESIGN" }) },
    file: { findMany: async ({ where }: { where: { AND: Array<Record<string, unknown>> } }) => {
      calls.push(where);
      assert.deepEqual(where.AND[0], { productId: "product", projectId: "project",
        mimeType: { in: ["image/jpeg", "image/png", "image/webp"] } });
      return [{ id: "oak", fileName: "oak.webp", mimeType: "image/webp" }];
    } } } as unknown as Prisma.TransactionClient;
  assert.deepEqual(await listFinishSampleFilesFor(db, { id: "worker", roles: ["WORKER"] }, "product"), []);
  assert.equal(calls.length, 0);
  assert.deepEqual((await listFinishSampleFilesFor(db, { id: "engineer", roles: ["ENGINEER"] }, "product")).map((file) => file.id), ["oak"]);
  assert.equal(calls.length, 1);
});
