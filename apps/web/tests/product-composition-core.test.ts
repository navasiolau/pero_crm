import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Prisma } from "@prisma/client";
import { createCompositionDraftCore, saveCompositionItemCore, confirmCompositionDraftCore,
  discardCompositionDraftCore, deleteCompositionItemCore } from "../src/server/composition/core";

type Row = Record<string, unknown> & { id: string };
const manager = { id: "manager", name: "Manager", roles: ["MANAGER" as const], source: "web" as const };
function fixture() {
  let state = { product: { id: "product", engineerId: "engineer", status: "DESIGN" }, revisions: [] as Row[],
    items: [] as Row[], logs: [] as Row[] };
  const writes: string[] = [];
  let failAt: string | null = null;
  const write = (name: string) => { writes.push(name); if (failAt === name) throw new Error("Injected transactional failure"); };
  const update = (row: Row, data: Row) => { for (const [key, value] of Object.entries(data))
    row[key] = value && typeof value === "object" && "increment" in value ? Number(row[key]) + Number(value.increment) : value; return row; };
  const tx = {
    $queryRaw: async () => [{ id: "product" }],
    task: { findMany: async () => [] },
    product: { findUnique: async () => state.product, findFirst: async () => state.product },
    productCompositionRevision: {
      findFirst: async ({ where, orderBy }: { where: Row; orderBy?: Row }) => {
        const rows = state.revisions.filter((row) => row.productId === where.productId && row.status === where.status);
        return orderBy?.revisionNo === "desc" ? rows.sort((a, b) => Number(b.revisionNo) - Number(a.revisionNo))[0] ?? null : rows[0] ?? null;
      },
      findUnique: async ({ where }: { where: Row }) => state.revisions.find((row) => row.id === where.id || row.requestId === where.requestId) ?? null,
      create: async ({ data }: { data: Row }) => { write("revision.create"); const row = { draftVersion: 0,
        revisionNo: null, requestId: null, confirmedById: null, confirmedAt: null, ...data, id: data.id ?? randomUUID() }; state.revisions.push(row); return row; },
      update: async ({ where, data }: { where: Row; data: Row }) => { write("revision.update"); return update(state.revisions.find((row) => row.id === where.id)!, data); },
      delete: async ({ where }: { where: Row }) => { write("revision.delete"); const row = state.revisions.find((r) => r.id === where.id)!;
        state.revisions = state.revisions.filter((r) => r !== row); return row; },
    },
    productCompositionItem: {
      findMany: async ({ where }: { where: Row }) => state.items.filter((row) => row.revisionId === where.revisionId),
      create: async ({ data }: { data: Row }) => { write("item.create"); const row = { ...data, id: data.id ?? randomUUID() }; state.items.push(row); return row; },
      createMany: async ({ data }: { data: Row[] }) => { write("item.createMany"); state.items.push(...data.map((row) => ({ ...row }))); return { count: data.length }; },
      update: async ({ where, data }: { where: Row; data: Row }) => { write("item.update"); return update(state.items.find((row) => row.id === where.id)!, data); },
      delete: async ({ where }: { where: Row }) => { write("item.delete"); const row = state.items.find((r) => r.id === where.id)!;
        state.items = state.items.filter((r) => r !== row); return row; },
      deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => { write("item.deleteMany"); const before = state.items.length;
        state.items = state.items.filter((row) => !where.id.in.includes(row.id)); return { count: before - state.items.length }; },
    },
    changeLog: { create: async ({ data }: { data: Row }) => { write("log.create"); const row = { ...data, id: data.id ?? randomUUID() };
      state.logs.push(row); return row; } },
  } as unknown as Prisma.TransactionClient;
  let tail = Promise.resolve();
  const transaction = async <T>(operation: (client: Prisma.TransactionClient) => Promise<T>) => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const before = structuredClone(state);
    try { return await operation(tx); } catch (error) { state = before; throw error; }
    finally { release(); }
  };
  return { tx, transaction, state: () => state, writes, failOn: (name: string | null) => { failAt = name; } };
}

test("draft, confirmation, clone keep old revision and row IDs immutable", async () => {
  const f = fixture();
  const first = await f.transaction((tx) => createCompositionDraftCore(tx, manager, "product"));
  assert.equal(first.draftVersion, 0);
  const item = await f.transaction((tx) => saveCompositionItemCore(tx, manager, { productId: "product", revisionId: first.id,
    expectedDraftVersion: 0, kind: "MODULE", designation: "М-1", title: "Модуль", quantityPerParent: 2,
    parentId: null, travelsToInstallation: true, sortOrder: 0 }));
  const confirmed = await f.transaction((tx) => confirmCompositionDraftCore(tx, manager, {
    productId: "product", revisionId: first.id, expectedDraftVersion: 1, requestId: randomUUID() }));
  assert.equal(confirmed.revisionNo, 1);
  const saved = structuredClone(f.state().items[0]);
  const cloned = await f.transaction((tx) => createCompositionDraftCore(tx, manager, "product"));
  const copy = f.state().items.find((row) => row.revisionId === cloned.id)!;
  assert.notEqual(copy.id, item.id);
  assert.equal(copy.lineageId, saved.lineageId);
  assert.equal(f.state().items.find((row) => row.id === item.id)?.designation, "М-1");
});

test("same confirmation UUID is idempotent and another stale request cannot create a second revision", async () => {
  const f = fixture();
  const draft = await f.transaction((tx) => createCompositionDraftCore(tx, manager, "product"));
  await f.transaction((tx) => saveCompositionItemCore(tx, manager, { productId: "product", revisionId: draft.id,
    expectedDraftVersion: 0, kind: "PART", designation: "Д-1", title: "Деталь", quantityPerParent: 1,
    parentId: null, travelsToInstallation: false, sortOrder: 0 }));
  const requestId = randomUUID();
  const first = await f.transaction((tx) => confirmCompositionDraftCore(tx, manager, { productId: "product", revisionId: draft.id,
    expectedDraftVersion: 1, requestId }));
  const repeated = await f.transaction((tx) => confirmCompositionDraftCore(tx, manager, { productId: "product", revisionId: draft.id,
    expectedDraftVersion: 1, requestId }));
  assert.equal(repeated.id, first.id);
  await assert.rejects(f.transaction((tx) => confirmCompositionDraftCore(tx, manager, { productId: "product", revisionId: draft.id,
    expectedDraftVersion: 999, requestId })), /REQUEST_ID_REUSED/);
  await assert.rejects(f.transaction((tx) => confirmCompositionDraftCore(tx, manager, { productId: "product", revisionId: draft.id,
    expectedDraftVersion: 1, requestId: randomUUID() })), /DRAFT_|REVISION_/);
  assert.equal(f.state().revisions.filter((row) => row.status === "CONFIRMED").length, 1);
});

test("field-only actor cannot mutate; engineer loses edit when Product leaves DESIGN", async () => {
  const f = fixture();
  await assert.rejects(f.transaction((tx) => createCompositionDraftCore(tx,
    { id: "worker", name: "Worker", roles: ["WORKER"], source: "web" }, "product")), /ACCESS_DENIED/);
  f.state().product.status = "PRODUCTION";
  await assert.rejects(f.transaction((tx) => createCompositionDraftCore(tx,
    { id: "engineer", name: "Engineer", roles: ["ENGINEER"], source: "web" }, "product")), /ACCESS_DENIED/);
  assert.equal(f.state().revisions.length, 0);
  const managerEngineer = { id: "manager", name: "Manager", roles: ["MANAGER", "ENGINEER"] as ("MANAGER" | "ENGINEER")[], source: "web" };
  assert.ok((await f.transaction((tx) => createCompositionDraftCore(tx, managerEngineer, "product"))).id);
});

test("discard explicitly deletes draft children before revision without touching confirmed history", async () => {
  const f = fixture();
  const draft = await f.transaction((tx) => createCompositionDraftCore(tx, manager, "product"));
  await f.transaction((tx) => saveCompositionItemCore(tx, manager, { productId: "product", revisionId: draft.id,
    expectedDraftVersion: 0, kind: "MODULE", designation: "М-1", title: "Модуль", quantityPerParent: 1,
    parentId: null, travelsToInstallation: false, sortOrder: 0 }));
  await f.transaction((tx) => discardCompositionDraftCore(tx, manager, { productId: "product", revisionId: draft.id,
    expectedDraftVersion: 1 }));
  assert.deepEqual(f.state().items, []);
  assert.deepEqual(f.state().revisions, []);
  assert.ok(f.writes.lastIndexOf("item.deleteMany") < f.writes.lastIndexOf("revision.delete"));
});

test("invalid parent or duplicate designation rejects before any draft write", async () => {
  const f = fixture();
  const draft = await f.transaction((tx) => createCompositionDraftCore(tx, manager, "product"));
  const first = await f.transaction((tx) => saveCompositionItemCore(tx, manager, { productId: "product", revisionId: draft.id,
    expectedDraftVersion: 0, kind: "PART", designation: "A-1", title: "Part", quantityPerParent: 1,
    parentId: null, travelsToInstallation: false, sortOrder: 0 }));
  const before = structuredClone(f.state());
  await assert.rejects(f.transaction((tx) => saveCompositionItemCore(tx, manager, { productId: "product", revisionId: draft.id,
    expectedDraftVersion: 1, kind: "PART", designation: "Ａ-１", title: "Duplicate", quantityPerParent: 1,
    parentId: null, travelsToInstallation: false, sortOrder: 0 })), /DUPLICATE_DESIGNATION/);
  await assert.rejects(f.transaction((tx) => saveCompositionItemCore(tx, manager, { productId: "product", revisionId: draft.id,
    expectedDraftVersion: 1, kind: "PART", designation: "B-1", title: "Child", quantityPerParent: 1,
    parentId: first.id, travelsToInstallation: false, sortOrder: 0 })), /PARENT_NOT_MODULE/);
  assert.deepEqual(f.state(), before);
});

test("two competing confirmations settle once; failure after state update rolls back", async () => {
  const f = fixture();
  const draft = await f.transaction((tx) => createCompositionDraftCore(tx, manager, "product"));
  await f.transaction((tx) => saveCompositionItemCore(tx, manager, { productId: "product", revisionId: draft.id,
    expectedDraftVersion: 0, kind: "PART", designation: "D-1", title: "Detail", quantityPerParent: 1,
    parentId: null, travelsToInstallation: false, sortOrder: 0 }));
  const before = structuredClone(f.state());
  f.failOn("log.create");
  await assert.rejects(f.transaction((tx) => confirmCompositionDraftCore(tx, manager, { productId: "product", revisionId: draft.id,
    expectedDraftVersion: 1, requestId: randomUUID() })), /Injected transactional failure/);
  assert.deepEqual(f.state(), before);
  f.failOn(null);
  const [first, second] = await Promise.allSettled([
    f.transaction((tx) => confirmCompositionDraftCore(tx, manager, { productId: "product", revisionId: draft.id,
      expectedDraftVersion: 1, requestId: randomUUID() })),
    f.transaction((tx) => confirmCompositionDraftCore(tx, manager, { productId: "product", revisionId: draft.id,
      expectedDraftVersion: 1, requestId: randomUUID() })),
  ]);
  assert.equal([first, second].filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(f.state().revisions.filter((row) => row.status === "CONFIRMED").length, 1);
});

test("draft update validates all descendants and deleting a module removes children first", async () => {
  const f = fixture();
  const draft = await f.transaction((tx) => createCompositionDraftCore(tx, manager, "product"));
  const root = await f.transaction((tx) => saveCompositionItemCore(tx, manager, { productId: "product", revisionId: draft.id,
    expectedDraftVersion: 0, kind: "MODULE", designation: "M", title: "Module", quantityPerParent: 2,
    parentId: null, travelsToInstallation: true, sortOrder: 0 }));
  const child = await f.transaction((tx) => saveCompositionItemCore(tx, manager, { productId: "product", revisionId: draft.id,
    expectedDraftVersion: 1, kind: "PART", designation: "P", title: "Part", quantityPerParent: 3,
    parentId: root.id, travelsToInstallation: true, sortOrder: 0 }));
  await f.transaction((tx) => saveCompositionItemCore(tx, manager, { productId: "product", revisionId: draft.id,
    expectedDraftVersion: 2, itemId: root.id, kind: "MODULE", designation: "M", title: "Module", quantityPerParent: 4,
    parentId: null, travelsToInstallation: true, sortOrder: 0 }));
  const before = structuredClone(f.state());
  await assert.rejects(f.transaction((tx) => saveCompositionItemCore(tx, manager, { productId: "product", revisionId: draft.id,
    expectedDraftVersion: 3, itemId: root.id, kind: "MODULE", designation: "M", title: "Module", quantityPerParent: 4,
    parentId: child.id, travelsToInstallation: true, sortOrder: 0 })), /PARENT_NOT_MODULE|COMPOSITION_CYCLE/);
  assert.deepEqual(f.state(), before);
  const removed = await f.transaction((tx) => deleteCompositionItemCore(tx, manager, { productId: "product", revisionId: draft.id,
    expectedDraftVersion: 3, itemId: root.id }));
  assert.equal(removed.deletedCount, 2);
  assert.deepEqual(f.state().items, []);
  const deletions = f.writes.filter((name) => name === "item.deleteMany");
  assert.equal(deletions.length, 2);
});
