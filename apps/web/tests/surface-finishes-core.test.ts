import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Prisma } from "@prisma/client";
import { saveCompositionFinishCore, deleteCompositionFinishCore } from "../src/server/finishes/core";
import { createCompositionDraftCore, deleteCompositionItemCore, discardCompositionDraftCore,
  confirmCompositionDraftCore } from "../src/server/composition/core";

type Row = Record<string, unknown> & { id: string };
const manager = { id: "manager", name: "Manager", roles: ["MANAGER" as const], source: "web" as const };
const base = { productId: "product", revisionId: "draft", expectedDraftVersion: 0, itemId: "item",
  surfaceKind: "FACE" as const, surfaceLabel: "Лицевая", layerOrder: 1, finishKind: "VENEER" as const,
  name: "Дуб", code: "OAK-01", colorHex: null, sampleFileId: "sample" };

function fixture() {
  let participant = false;
  let state = { product: { id: "product", projectId: "project", engineerId: "engineer", status: "DESIGN" },
    revisions: [{ id: "draft", productId: "product", status: "DRAFT", draftVersion: 0, revisionNo: null, requestId: null,
      createdById: "manager", confirmedById: null, confirmedAt: null } as Row],
    items: [{ id: "item", revisionId: "draft", lineageId: "lineage", parentId: null, kind: "PART", designation: "D-1",
      normalizedDesignation: "D-1", title: "Деталь", quantityPerParent: 1, travelsToInstallation: false, sortOrder: 0 } as Row],
    finishes: [] as Row[], files: [{ id: "sample", productId: "product", projectId: "project", mimeType: "image/png",
      fileName: "oak.png" } as Row], logs: [] as Row[] };
  const writes: string[] = [];
  const update = (row: Row, data: Row) => { for (const [key, value] of Object.entries(data))
    row[key] = value && typeof value === "object" && "increment" in value ? Number(row[key]) + Number(value.increment) : value; return row; };
  const tx = {
    $queryRaw: async () => [{ id: "product" }],
    task: { findMany: async ({ where }: { where: { assigneeId: string } }) =>
      participant && where.assigneeId === "worker" && state.product.status === "DESIGN"
        ? [{ id: "engineering-task", productId: "product", projectId: "project",
          product: { projectId: "project" }, work: { productId: "product", projectId: "project" } }] : [] },
    product: { findUnique: async () => state.product, findFirst: async () => state.product },
    productCompositionRevision: {
      findFirst: async ({ where }: { where: Row }) => state.revisions.find((row) => row.productId === where.productId && row.status === where.status) ?? null,
      findUnique: async ({ where }: { where: Row }) => state.revisions.find((row) => row.id === where.id || (where.requestId && row.requestId === where.requestId)) ?? null,
      findMany: async ({ where }: { where: Row }) => state.revisions.filter((row) => row.productId === where.productId),
      create: async ({ data }: { data: Row }) => { writes.push("revision.create"); const row = { draftVersion: 0,
        revisionNo: null, status: "DRAFT", requestId: null, confirmedById: null, confirmedAt: null, ...data,
        id: data.id ?? randomUUID() }; state.revisions.push(row); return row; },
      update: async ({ where, data }: { where: Row; data: Row }) => { writes.push("revision.update"); return update(state.revisions.find((row) => row.id === where.id)!, data); },
      delete: async ({ where }: { where: Row }) => { writes.push("revision.delete"); const row = state.revisions.find((r) => r.id === where.id)!;
        state.revisions = state.revisions.filter((r) => r !== row); return row; },
    },
    productCompositionItem: {
      findMany: async ({ where }: { where: Row }) => state.items.filter((row) => row.revisionId === where.revisionId),
      findUnique: async ({ where }: { where: Row }) => state.items.find((row) => row.id === where.id) ?? null,
      createMany: async ({ data }: { data: Row[] }) => { writes.push("item.createMany"); state.items.push(...data); return { count: data.length }; },
      deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => { writes.push("item.deleteMany"); const before = state.items.length;
        state.items = state.items.filter((row) => !where.id.in.includes(row.id)); return { count: before - state.items.length }; },
    },
    productCompositionFinish: {
      findMany: async ({ where }: { where: Row }) => state.finishes.filter((row) => !where.revisionId || row.revisionId === where.revisionId),
      findUnique: async ({ where }: { where: Row }) => state.finishes.find((row) => row.id === where.id) ?? null,
      count: async ({ where }: { where: Row }) => state.finishes.filter((row) => row.sampleFileId === where.sampleFileId).length,
      create: async ({ data }: { data: Row }) => { writes.push("finish.create"); const row = { ...data, id: data.id ?? randomUUID() };
        state.finishes.push(row); return row; },
      createMany: async ({ data }: { data: Row[] }) => { writes.push("finish.createMany"); state.finishes.push(...data); return { count: data.length }; },
      update: async ({ where, data }: { where: Row; data: Row }) => { writes.push("finish.update"); return update(state.finishes.find((row) => row.id === where.id)!, data); },
      delete: async ({ where }: { where: Row }) => { writes.push("finish.delete"); const row = state.finishes.find((r) => r.id === where.id)!;
        state.finishes = state.finishes.filter((r) => r !== row); return row; },
      deleteMany: async ({ where }: { where: { itemId: { in: string[] } } }) => { writes.push("finish.deleteMany"); const before = state.finishes.length;
        state.finishes = state.finishes.filter((row) => !where.itemId.in.includes(String(row.itemId))); return { count: before - state.finishes.length }; },
    },
    file: { findUnique: async ({ where }: { where: Row }) => state.files.find((row) => row.id === where.id) ?? null,
      findFirst: async ({ where }: { where: { AND: Row[] } }) => {
        const id = where.AND.find((part) => typeof part.id === "string")?.id;
        return state.files.find((row) => row.id === id) ?? null;
      },
      findMany: async () => state.files },
    changeLog: { create: async ({ data }: { data: Row }) => { writes.push("log.create"); const row = { ...data, id: data.id ?? randomUUID() };
      state.logs.push(row); return row; } },
  } as unknown as Prisma.TransactionClient;
  let tail = Promise.resolve();
  const transaction = async <T>(operation: (client: Prisma.TransactionClient) => Promise<T>) => {
    const previous = tail; let release!: () => void; tail = new Promise<void>((resolve) => { release = resolve; });
    await previous; const before = structuredClone(state);
    try { return await operation(tx); } catch (error) { state = before; throw error; } finally { release(); }
  };
  return { tx, transaction, state: () => state, writes, setParticipant: (value: boolean) => { participant = value; } };
}

test("draft finish keeps exact veneer/code/sample and ordered coating; stale retry creates no duplicate", async () => {
  const f = fixture();
  const first = await f.transaction((tx) => saveCompositionFinishCore(tx, manager, base));
  assert.equal(first.draftVersion, 1);
  assert.deepEqual(f.state().finishes.map((row) => [row.surfaceLabel, row.finishKind, row.name, row.code, row.sampleFileId]),
    [["Лицевая", "VENEER", "Дуб", "OAK-01", "sample"]]);
  await f.transaction((tx) => saveCompositionFinishCore(tx, manager, { ...base, expectedDraftVersion: 1, layerOrder: 2,
    finishKind: "COATING", name: "Лак матовый", code: "L-10", sampleFileId: null }));
  assert.deepEqual(f.state().finishes.map((row) => row.layerOrder), [1, 2]);
  await assert.rejects(f.transaction((tx) => saveCompositionFinishCore(tx, manager, base)), /DRAFT_VERSION_CHANGED/);
  assert.equal(f.state().finishes.length, 2);
});

test("fresh ACL, same-Product raster file and normalized unique layer reject before writes", async () => {
  const f = fixture();
  await assert.rejects(f.transaction((tx) => saveCompositionFinishCore(tx,
    { id: "worker", name: "Worker", roles: ["WORKER"], source: "web" }, base)), /ACCESS_DENIED/);
  f.state().product.status = "PRODUCTION";
  await assert.rejects(f.transaction((tx) => saveCompositionFinishCore(tx,
    { id: "engineer", name: "Engineer", roles: ["ENGINEER"], source: "web" }, base)), /ACCESS_DENIED/);
  f.state().product.status = "DESIGN";
  f.state().files[0].productId = "foreign";
  await assert.rejects(f.transaction((tx) => saveCompositionFinishCore(tx, manager, base)), /FINISH_SAMPLE_INVALID/);
  f.state().files[0].productId = "product";
  f.state().files[0].mimeType = "image/svg+xml";
  await assert.rejects(f.transaction((tx) => saveCompositionFinishCore(tx, manager, base)), /FINISH_SAMPLE_INVALID/);
  f.state().files[0].mimeType = "image/png";
  await f.transaction((tx) => saveCompositionFinishCore(tx, manager, base));
  await assert.rejects(f.transaction((tx) => saveCompositionFinishCore(tx, manager,
    { ...base, expectedDraftVersion: 1, surfaceLabel: "  лицевая " })), /FINISH_|DUPLICATE/);
});

test("assigned engineering-fund WORKER retains DESIGN technical grant, then loses it after PRODUCTION", async () => {
  const f = fixture();
  f.setParticipant(true);
  const worker = { id: "worker", name: "Worker", roles: ["WORKER" as const], source: "web" as const };
  const saved = await f.transaction((tx) => saveCompositionFinishCore(tx, worker, base));
  assert.equal(saved.draftVersion, 1);
  f.state().product.status = "PRODUCTION";
  await assert.rejects(f.transaction((tx) => saveCompositionFinishCore(tx, worker,
    { ...base, expectedDraftVersion: 1, layerOrder: 2, sampleFileId: null })), /ACCESS_DENIED/);
  assert.equal(f.state().finishes.length, 1);
});

test("revision confirmation/clone preserve old finish and discard removes only draft rows", async () => {
  const f = fixture();
  await f.transaction((tx) => saveCompositionFinishCore(tx, manager, base));
  const confirmed = await f.transaction((tx) => confirmCompositionDraftCore(tx, manager,
    { productId: "product", revisionId: "draft", expectedDraftVersion: 1, requestId: randomUUID() }));
  assert.equal(confirmed.status, "CONFIRMED");
  const old = structuredClone(f.state().finishes[0]);
  const draft = await f.transaction((tx) => createCompositionDraftCore(tx, manager, "product"));
  const copy = f.state().finishes.find((row) => row.revisionId === draft.id)!;
  assert.notEqual(copy.id, old.id);
  assert.notEqual(copy.itemId, old.itemId);
  assert.equal(copy.code, "OAK-01");
  assert.equal(f.state().finishes.find((row) => row.id === old.id)?.code, "OAK-01");
  await f.transaction((tx) => saveCompositionFinishCore(tx, manager, { ...base, revisionId: draft.id,
    itemId: String(copy.itemId), finishId: copy.id, expectedDraftVersion: 0, code: "GREEN-02", colorHex: "#00FF00", sampleFileId: null }));
  assert.equal(f.state().finishes.find((row) => row.id === old.id)?.code, "OAK-01");
  assert.equal(f.state().finishes.find((row) => row.id === copy.id)?.code, "GREEN-02");
  await f.transaction((tx) => discardCompositionDraftCore(tx, manager,
    { productId: "product", revisionId: draft.id, expectedDraftVersion: 1 }));
  assert.deepEqual(f.state().finishes.map((row) => row.id), [old.id]);
  assert.ok(f.writes.lastIndexOf("finish.deleteMany") < f.writes.lastIndexOf("item.deleteMany"));
});

test("concurrent finish save and revision confirmation commit exactly one coherent version", async () => {
  const f = fixture();
  const results = await Promise.allSettled([
    f.transaction((tx) => saveCompositionFinishCore(tx, manager, base)),
    f.transaction((tx) => confirmCompositionDraftCore(tx, manager,
      { productId: "product", revisionId: "draft", expectedDraftVersion: 0, requestId: randomUUID() })),
  ]);
  assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
  const revision = f.state().revisions[0];
  if (revision.status === "CONFIRMED") assert.equal(f.state().finishes.length, 0);
  else { assert.equal(revision.draftVersion, 1); assert.equal(f.state().finishes.length, 1); }
});

test("deleting an item removes its finish before the item; deleting a finish bumps draft version", async () => {
  const f = fixture();
  const saved = await f.transaction((tx) => saveCompositionFinishCore(tx, manager, base));
  const removed = await f.transaction((tx) => deleteCompositionFinishCore(tx, manager,
    { productId: "product", revisionId: "draft", expectedDraftVersion: 1, finishId: saved.id }));
  assert.equal(removed.draftVersion, 2);
  assert.equal(f.state().finishes.length, 0);
  await f.transaction((tx) => saveCompositionFinishCore(tx, manager, { ...base, expectedDraftVersion: 2 }));
  await f.transaction((tx) => deleteCompositionItemCore(tx, manager,
    { productId: "product", revisionId: "draft", expectedDraftVersion: 3, itemId: "item" }));
  assert.equal(f.state().finishes.length, 0);
  assert.ok(f.writes.lastIndexOf("finish.deleteMany") < f.writes.lastIndexOf("item.deleteMany"));
});
