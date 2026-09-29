import { randomUUID } from "node:crypto";
import type { Prisma, Role } from "@prisma/client";
import { normalizeFinishAssignment, validateFinishAssignments, type FinishAssignment } from "@/lib/surface-finishes";
import { canEditProductTechnicalBlock, fileVisibilityWhere, resolveVisibilityActor } from "@/server/access/visibility";

type Tx = Prisma.TransactionClient;
export type FinishActor = { id: string; name: string; roles: Role[]; source: string };
export type SaveFinishInput = { productId: string; revisionId: string; expectedDraftVersion: number; finishId?: string;
  itemId: string; surfaceKind: FinishAssignment["surfaceKind"]; surfaceLabel: string; layerOrder: number;
  finishKind: FinishAssignment["finishKind"]; name: string; code: string; colorHex?: string | null; sampleFileId?: string | null };
export type DeleteFinishInput = { productId: string; revisionId: string; expectedDraftVersion: number; finishId: string };
const RASTER_MIME = ["image/jpeg", "image/png", "image/webp"] as const;

function fail(code: string): never { throw new Error(code); }
function mappedValidation(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("duplicate finish layer")) fail("FINISH_DUPLICATE_LAYER");
  if (message.includes("too many")) fail("FINISH_LIMIT_EXCEEDED");
  if (message.includes("colorHex")) fail("FINISH_HEX_INVALID");
  if (message.includes("sampleFileId")) fail("FINISH_SAMPLE_ID_INVALID");
  if (message.includes("layerOrder")) fail("FINISH_ORDER_INVALID");
  if (message.includes("surface")) fail("FINISH_SURFACE_INVALID");
  if (message.includes("name")) fail("FINISH_NAME_INVALID");
  if (message.includes("code")) fail("FINISH_CODE_INVALID");
  fail("FINISH_INVALID");
}
function normalize(input: unknown): FinishAssignment {
  try { return normalizeFinishAssignment(input); } catch (error) { mappedValidation(error); }
}
function validate(rows: unknown[]): FinishAssignment[] {
  try { return validateFinishAssignments(rows); } catch (error) { mappedValidation(error); }
}
function draftVersion(actual: number, expected: number) {
  if (!Number.isSafeInteger(expected) || expected < 0 || expected !== actual) fail("DRAFT_VERSION_CHANGED");
}

async function lockProductAndDraft(tx: Tx, actor: FinishActor, input: { productId: string; revisionId: string; expectedDraftVersion: number }) {
  await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${input.productId} FOR UPDATE`;
  const product = await tx.product.findUnique({ where: { id: input.productId },
    select: { id: true, projectId: true, engineerId: true, status: true } });
  if (!product) fail("PRODUCT_NOT_FOUND");
  const visibleActor = await resolveVisibilityActor(tx, actor);
  if (!canEditProductTechnicalBlock(visibleActor, product)) fail("ACCESS_DENIED");
  await tx.$queryRaw`SELECT "id" FROM "ProductCompositionRevision" WHERE "id" = ${input.revisionId} FOR UPDATE`;
  const draft = await tx.productCompositionRevision.findUnique({ where: { id: input.revisionId } });
  if (!draft || draft.productId !== product.id || draft.status !== "DRAFT") fail("DRAFT_NOT_FOUND");
  draftVersion(draft.draftVersion, input.expectedDraftVersion);
  return { product, draft, visibleActor };
}

async function assertSample(tx: Tx, visibleActor: Awaited<ReturnType<typeof resolveVisibilityActor>>,
  product: { id: string; projectId: string }, fileId: string | null) {
  if (!fileId) return;
  const file = await tx.file.findFirst({ where: { AND: [{ id: fileId }, fileVisibilityWhere(visibleActor)] },
    select: { id: true, productId: true, projectId: true, mimeType: true } });
  if (!file || file.productId !== product.id || file.projectId !== product.projectId ||
    !RASTER_MIME.includes(file.mimeType as (typeof RASTER_MIME)[number])) fail("FINISH_SAMPLE_INVALID");
}

async function audit(tx: Tx, actor: FinishActor, entityId: string, action: string,
  oldValue?: Prisma.InputJsonValue, newValue?: Prisma.InputJsonValue) {
  await tx.changeLog.create({ data: { actorType: "user", actorId: actor.id, actorName: actor.name,
    source: actor.source, entity: "productCompositionFinish", entityId, action,
    ...(oldValue === undefined ? {} : { oldValue }), ...(newValue === undefined ? {} : { newValue }) } });
}

export async function saveCompositionFinishCore(tx: Tx, actor: FinishActor, input: SaveFinishInput) {
  const { product, draft, visibleActor } = await lockProductAndDraft(tx, actor, input);
  const assignment = normalize(input);
  const item = await tx.productCompositionItem.findUnique({ where: { id: assignment.itemId },
    select: { id: true, revisionId: true } });
  if (!item || item.revisionId !== draft.id) fail("ITEM_NOT_FOUND");
  await assertSample(tx, visibleActor, product, assignment.sampleFileId);
  const rows = await tx.productCompositionFinish.findMany({ where: { revisionId: draft.id } });
  const existing = input.finishId ? rows.find((row) => row.id === input.finishId) : null;
  if (input.finishId && (!existing || existing.itemId !== item.id)) fail("FINISH_NOT_FOUND");
  validate([...rows.filter((row) => row.id !== existing?.id), assignment]);
  const data = { surfaceKind: assignment.surfaceKind, surfaceLabel: assignment.surfaceLabel,
    normalizedSurfaceLabel: assignment.normalizedSurfaceLabel, layerOrder: assignment.layerOrder,
    finishKind: assignment.finishKind, name: assignment.name, code: assignment.code,
    colorHex: assignment.colorHex, sampleFileId: assignment.sampleFileId };
  const saved = existing
    ? await tx.productCompositionFinish.update({ where: { id: existing.id }, data })
    : await tx.productCompositionFinish.create({ data: { revisionId: draft.id, itemId: item.id, ...data } });
  const nextVersion = draft.draftVersion + 1;
  await tx.productCompositionRevision.update({ where: { id: draft.id }, data: { draftVersion: { increment: 1 } } });
  await audit(tx, actor, saved.id, existing ? "finish.update" : "finish.create",
    existing ? { code: existing.code, colorHex: existing.colorHex, sampleFileId: existing.sampleFileId } : undefined,
    { productId: product.id, revisionId: draft.id, itemId: item.id, surfaceKind: saved.surfaceKind,
      surfaceLabel: saved.surfaceLabel, layerOrder: saved.layerOrder, finishKind: saved.finishKind,
      name: saved.name, code: saved.code, colorHex: saved.colorHex, sampleFileId: saved.sampleFileId,
      draftVersion: nextVersion });
  return { id: saved.id, draftVersion: nextVersion };
}

export async function deleteCompositionFinishCore(tx: Tx, actor: FinishActor, input: DeleteFinishInput) {
  const { draft } = await lockProductAndDraft(tx, actor, input);
  const row = await tx.productCompositionFinish.findUnique({ where: { id: input.finishId } });
  if (!row || row.revisionId !== draft.id) fail("FINISH_NOT_FOUND");
  await tx.productCompositionFinish.delete({ where: { id: row.id } });
  const nextVersion = draft.draftVersion + 1;
  await tx.productCompositionRevision.update({ where: { id: draft.id }, data: { draftVersion: { increment: 1 } } });
  await audit(tx, actor, row.id, "finish.delete",
    { productId: input.productId, revisionId: draft.id, itemId: row.itemId, code: row.code },
    { draftVersion: nextVersion });
  return { deleted: true, draftVersion: nextVersion };
}

/** Checks the entire confirmed snapshot in one batch, including existing sample-file ownership. */
export async function validateRevisionFinishes(tx: Tx, actor: FinishActor,
  product: { id: string; projectId: string }, revisionId: string, itemIds: ReadonlySet<string>) {
  const rows = await tx.productCompositionFinish.findMany({ where: { revisionId } });
  validate(rows);
  if (rows.some((row) => !itemIds.has(row.itemId))) fail("FINISH_ITEM_MISMATCH");
  const ids = [...new Set(rows.map((row) => row.sampleFileId).filter((id): id is string => !!id))];
  if (ids.length) {
    const visibleActor = await resolveVisibilityActor(tx, actor);
    const files = await tx.file.findMany({ where: { AND: [{ id: { in: ids } }, fileVisibilityWhere(visibleActor)] },
      select: { id: true, productId: true, projectId: true, mimeType: true } });
    if (files.length !== ids.length || files.some((file) => file.productId !== product.id ||
      file.projectId !== product.projectId || !RASTER_MIME.includes(file.mimeType as (typeof RASTER_MIME)[number])))
      fail("FINISH_SAMPLE_INVALID");
  }
  return rows.length;
}

export async function cloneRevisionFinishes(tx: Tx, sourceRevisionId: string, draftRevisionId: string, itemIds: ReadonlyMap<string, string>) {
  const source = await tx.productCompositionFinish.findMany({ where: { revisionId: sourceRevisionId } });
  if (!source.length) return 0;
  const data = source.map((row) => {
    const itemId = itemIds.get(row.itemId);
    if (!itemId) fail("FINISH_ITEM_MISMATCH");
    return { id: randomUUID(), revisionId: draftRevisionId, itemId,
      surfaceKind: row.surfaceKind, surfaceLabel: row.surfaceLabel, normalizedSurfaceLabel: row.normalizedSurfaceLabel,
      layerOrder: row.layerOrder, finishKind: row.finishKind, name: row.name, code: row.code,
      colorHex: row.colorHex, sampleFileId: row.sampleFileId };
  });
  const created = await tx.productCompositionFinish.createMany({ data });
  if (created.count !== data.length) fail("FINISH_CLONE_CHANGED");
  return created.count;
}

export async function deleteFinishesForItems(tx: Tx, revisionId: string, itemIds: string[]) {
  if (!itemIds.length) return 0;
  const existing = await tx.productCompositionFinish.findMany({ where: { revisionId, itemId: { in: itemIds } }, select: { id: true } });
  if (!existing.length) return 0;
  const removed = await tx.productCompositionFinish.deleteMany({ where: { revisionId, itemId: { in: itemIds } } });
  if (removed.count !== existing.length) fail("FINISH_DELETE_CHANGED");
  return removed.count;
}
