import { randomUUID } from "node:crypto";
import type { Prisma, Role } from "@prisma/client";
import { canEditProductTechnicalBlock, resolveVisibilityActor } from "@/server/access/visibility";
import { normalizeCompositionDesignation, validateCompositionTree, type CompositionKind, type CompositionTreeRow } from "@/lib/composition-tree";

type Tx = Prisma.TransactionClient;
export type CompositionActor = { id: string; name: string; roles: Role[]; source: string };
type ItemInput = { productId: string; revisionId: string; expectedDraftVersion: number; itemId?: string;
  kind: CompositionKind; designation: string; title: string; quantityPerParent: number; parentId: string | null;
  travelsToInstallation: boolean; sortOrder: number };
type DraftInput = { productId: string; revisionId: string; expectedDraftVersion: number };

function fail(code: string): never { throw new Error(code); }
function version(actual: number, expected: number) {
  if (!Number.isSafeInteger(expected) || expected < 0 || actual !== expected) fail("DRAFT_VERSION_CHANGED");
}
async function lockProductAndCheck(tx: Tx, actor: CompositionActor, productId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${productId} FOR UPDATE`;
  const product = await tx.product.findUnique({ where: { id: productId }, select: { id: true, engineerId: true, status: true } });
  if (!product) fail("PRODUCT_NOT_FOUND");
  const visibility = await resolveVisibilityActor(tx, actor);
  if (!canEditProductTechnicalBlock(visibility, product)) fail("ACCESS_DENIED");
  return product;
}
async function lockedDraft(tx: Tx, input: DraftInput) {
  await tx.$queryRaw`SELECT "id" FROM "ProductCompositionRevision" WHERE "id" = ${input.revisionId} FOR UPDATE`;
  const draft = await tx.productCompositionRevision.findUnique({ where: { id: input.revisionId } });
  if (!draft || draft.productId !== input.productId || draft.status !== "DRAFT") fail("DRAFT_NOT_FOUND");
  version(draft.draftVersion, input.expectedDraftVersion);
  return draft;
}
async function audit(tx: Tx, actor: CompositionActor, entityId: string, action: string, oldValue?: Prisma.InputJsonValue,
  newValue?: Prisma.InputJsonValue) {
  await tx.changeLog.create({ data: { actorType: "user", actorId: actor.id, actorName: actor.name,
    source: actor.source, entity: "productComposition", entityId, action,
    ...(oldValue === undefined ? {} : { oldValue }), ...(newValue === undefined ? {} : { newValue }) } });
}
function treeRows(rows: readonly { id: string; revisionId: string; lineageId: string; parentId: string | null; kind: CompositionKind;
  designation: string; title: string; quantityPerParent: number; travelsToInstallation: boolean }[]): CompositionTreeRow[] {
  return rows.map((row) => ({ id: row.id, revisionId: row.revisionId, lineageId: row.lineageId, parentId: row.parentId,
    kind: row.kind, designation: row.designation, title: row.title, quantityPerParent: row.quantityPerParent,
    travelsToInstallation: row.travelsToInstallation }));
}

export async function createCompositionDraftCore(tx: Tx, actor: CompositionActor, productId: string) {
  await lockProductAndCheck(tx, actor, productId);
  const existing = await tx.productCompositionRevision.findFirst({ where: { productId, status: "DRAFT" } });
  if (existing) return existing;
  const latest = await tx.productCompositionRevision.findFirst({ where: { productId, status: "CONFIRMED" },
    orderBy: { revisionNo: "desc" } });
  const draft = await tx.productCompositionRevision.create({ data: { productId, status: "DRAFT", createdById: actor.id,
    baseRevisionId: latest?.id ?? null } });
  if (latest) {
    const oldItems = await tx.productCompositionItem.findMany({ where: { revisionId: latest.id } });
    const context = validateCompositionTree(treeRows(oldItems));
    const newIds = new Map(oldItems.map((row) => [row.id, randomUUID()]));
    for (let level = 1; level <= 16; level++) {
      const data = oldItems.filter((row) => context.depth.get(row.id) === level).map((row) => ({
        id: newIds.get(row.id)!, revisionId: draft.id, lineageId: row.lineageId,
        parentId: row.parentId ? newIds.get(row.parentId)! : null, kind: row.kind, designation: row.designation,
        normalizedDesignation: row.normalizedDesignation, title: row.title, quantityPerParent: row.quantityPerParent,
        travelsToInstallation: row.travelsToInstallation, sortOrder: row.sortOrder,
      }));
      if (data.length) await tx.productCompositionItem.createMany({ data });
    }
  }
  await audit(tx, actor, draft.id, "draft.create", undefined, { productId, baseRevisionId: latest?.id ?? null });
  return draft;
}

export async function saveCompositionItemCore(tx: Tx, actor: CompositionActor, input: ItemInput) {
  await lockProductAndCheck(tx, actor, input.productId);
  const draft = await lockedDraft(tx, input);
  if (!Number.isSafeInteger(input.sortOrder) || input.sortOrder < 0) fail("SORT_ORDER_INVALID");
  if (typeof input.designation !== "string") fail("DESIGNATION_REQUIRED");
  if (typeof input.title !== "string") fail("TITLE_REQUIRED");
  if (input.parentId !== null && typeof input.parentId !== "string") fail("PARENT_NOT_FOUND");
  const designation = input.designation.trim();
  const title = input.title.trim();
  const normalizedDesignation = normalizeCompositionDesignation(designation);
  const rows = await tx.productCompositionItem.findMany({ where: { revisionId: draft.id } });
  const existing = input.itemId ? rows.find((row) => row.id === input.itemId) : null;
  if (input.itemId && !existing) fail("ITEM_NOT_FOUND");
  const id = existing?.id ?? randomUUID();
  const lineageId = existing?.lineageId ?? randomUUID();
  const candidate = { id, revisionId: draft.id, lineageId, parentId: input.parentId, kind: input.kind,
    designation, title, quantityPerParent: input.quantityPerParent, travelsToInstallation: input.travelsToInstallation };
  validateCompositionTree(treeRows([...rows.filter((row) => row.id !== id), candidate]));
  const data = { parentId: candidate.parentId, kind: candidate.kind, designation, normalizedDesignation, title,
    quantityPerParent: candidate.quantityPerParent, travelsToInstallation: candidate.travelsToInstallation,
    sortOrder: input.sortOrder };
  const row = existing
    ? await tx.productCompositionItem.update({ where: { id }, data })
    : await tx.productCompositionItem.create({ data: { id, revisionId: draft.id, lineageId, ...data } });
  await tx.productCompositionRevision.update({ where: { id: draft.id }, data: { draftVersion: { increment: 1 } } });
  await audit(tx, actor, row.id, existing ? "item.update" : "item.create", undefined,
    { productId: input.productId, revisionId: draft.id, designation, draftVersion: draft.draftVersion + 1 });
  return { ...row, draftVersion: draft.draftVersion + 1 };
}

export async function deleteCompositionItemCore(tx: Tx, actor: CompositionActor, input: DraftInput & { itemId: string }) {
  await lockProductAndCheck(tx, actor, input.productId);
  const draft = await lockedDraft(tx, input);
  const rows = await tx.productCompositionItem.findMany({ where: { revisionId: draft.id } });
  if (!rows.some((row) => row.id === input.itemId)) fail("ITEM_NOT_FOUND");
  const context = validateCompositionTree(treeRows(rows));
  const ids = new Set<string>([input.itemId]);
  let changed = true;
  while (changed) { changed = false; for (const row of rows) if (row.parentId && ids.has(row.parentId) && !ids.has(row.id)) {
    ids.add(row.id); changed = true;
  } }
  for (let level = 16; level >= 1; level--) {
    const atLevel = rows.filter((row) => ids.has(row.id) && context.depth.get(row.id) === level).map((row) => row.id);
    if (atLevel.length) {
      const removed = await tx.productCompositionItem.deleteMany({ where: { id: { in: atLevel } } });
      if (removed.count !== atLevel.length) fail("ITEM_DELETE_CHANGED");
    }
  }
  await tx.productCompositionRevision.update({ where: { id: draft.id }, data: { draftVersion: { increment: 1 } } });
  await audit(tx, actor, input.itemId, "item.delete", undefined, { productId: input.productId, revisionId: draft.id, count: ids.size });
  return { deletedCount: ids.size, draftVersion: draft.draftVersion + 1 };
}

export async function discardCompositionDraftCore(tx: Tx, actor: CompositionActor, input: DraftInput) {
  await lockProductAndCheck(tx, actor, input.productId);
  const draft = await lockedDraft(tx, input);
  const rows = await tx.productCompositionItem.findMany({ where: { revisionId: draft.id } });
  const context = validateCompositionTree(treeRows(rows));
  for (let level = 16; level >= 1; level--) {
    const atLevel = rows.filter((row) => context.depth.get(row.id) === level).map((row) => row.id);
    if (atLevel.length) {
      const removed = await tx.productCompositionItem.deleteMany({ where: { id: { in: atLevel } } });
      if (removed.count !== atLevel.length) fail("ITEM_DELETE_CHANGED");
    }
  }
  await tx.productCompositionRevision.delete({ where: { id: draft.id } });
  await audit(tx, actor, draft.id, "draft.discard", undefined, { productId: input.productId, deletedItems: rows.length });
  return { discarded: true, deletedItems: rows.length };
}

export async function confirmCompositionDraftCore(tx: Tx, actor: CompositionActor,
  input: DraftInput & { requestId: string }) {
  await lockProductAndCheck(tx, actor, input.productId);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId))
    fail("REQUEST_ID_INVALID");
  const repeated = await tx.productCompositionRevision.findUnique({ where: { requestId: input.requestId } });
  if (repeated) {
    if (repeated.productId !== input.productId || repeated.id !== input.revisionId || repeated.status !== "CONFIRMED" ||
      repeated.confirmedById !== actor.id || repeated.draftVersion !== input.expectedDraftVersion)
      fail("REQUEST_ID_REUSED");
    return repeated;
  }
  const draft = await lockedDraft(tx, input);
  const rows = await tx.productCompositionItem.findMany({ where: { revisionId: draft.id } });
  if (!rows.length) fail("EMPTY_COMPOSITION");
  validateCompositionTree(treeRows(rows));
  const latest = await tx.productCompositionRevision.findFirst({ where: { productId: input.productId, status: "CONFIRMED" },
    orderBy: { revisionNo: "desc" } });
  const revisionNo = (latest?.revisionNo ?? 0) + 1;
  const confirmed = await tx.productCompositionRevision.update({ where: { id: draft.id }, data: { status: "CONFIRMED", revisionNo,
    requestId: input.requestId, confirmedById: actor.id, confirmedAt: new Date() } });
  await audit(tx, actor, draft.id, "revision.confirm", undefined, { productId: input.productId, revisionNo, itemCount: rows.length });
  return confirmed;
}
