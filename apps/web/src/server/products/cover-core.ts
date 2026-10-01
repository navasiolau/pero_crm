import type { FileStage, Prisma } from "@prisma/client";

import { canSetProductCover, isCoverImageMime, validateProductCoverFile } from "@/lib/product-cover";
import { MANAGER_ROLES, hasAnyRole, hasRole } from "@/lib/roles";
import { fileVisibilityWhere, productEditWhere, resolveVisibilityActor, type VisibilityActor } from "@/server/access/visibility";

type Tx = Pick<Prisma.TransactionClient, "task" | "productPercentageParticipant" | "product" | "file" | "changeLog">;
export type CoverMutationActor = VisibilityActor & { name?: string | null };
export type CoverUploadTarget = { projectId: string; productId: string };
export type CoverUploadFileInput = {
  fileName: string;
  storedName: string;
  mimeType: string;
  size: number;
  hasThumb: boolean;
  uploadedById: string;
  caption?: string | null;
  stage?: FileStage;
};

function hasCoverEditRole(actor: CoverMutationActor): boolean {
  return hasAnyRole(actor.roles, MANAGER_ROLES) || hasRole(actor.roles, "ENGINEER");
}

/** Route calls this before reading upload bytes or writing to any storage. */
export async function authorizeProductCoverUpload(
  tx: Pick<Tx, "task" | "productPercentageParticipant" | "product">,
  actor: CoverMutationActor,
  input: CoverUploadTarget,
): Promise<{ ok: true; product: { id: string; projectId: string; sketchFileId: string | null } } |
  { ok: false; error: string }> {
  if (!input.productId || !input.projectId) return { ok: false, error: "Нужны проект и изделие" };
  if (!hasCoverEditRole(actor)) return { ok: false, error: "Недостаточно прав" };
  const visibility = await resolveVisibilityActor(tx, actor);
  const product = await tx.product.findFirst({
    where: { AND: [{ id: input.productId, projectId: input.projectId }, productEditWhere(visibility)] },
    select: { id: true, projectId: true, engineerId: true, status: true, sketchFileId: true },
  });
  if (!product || product.id !== input.productId || product.projectId !== input.projectId)
    return { ok: false, error: "Изделие не найдено" };
  if (!canSetProductCover(visibility, product)) return { ok: false, error: "Недостаточно прав" };
  return { ok: true, product };
}

/** File row, cover pointer and audit are all written inside the caller's tx. */
export async function persistUploadedProductCover(
  tx: Tx,
  actor: CoverMutationActor,
  target: CoverUploadTarget,
  fileData: CoverUploadFileInput,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const permission = await authorizeProductCoverUpload(tx, actor, target);
  if (!permission.ok) return permission;
  if (!isCoverImageMime(fileData.mimeType) || !Number.isSafeInteger(fileData.size) ||
      fileData.size <= 0 || fileData.size > 25 * 1024 * 1024 ||
      fileData.uploadedById !== actor.id)
    return { ok: false, error: "Нужно изображение до 25 МБ" };
  const file = await tx.file.create({ data: {
    projectId: target.projectId, productId: target.productId, taskId: null,
    category: "PHOTO", caption: fileData.caption ?? null, stage: fileData.stage,
    fileName: fileData.fileName, storedName: fileData.storedName,
    mimeType: fileData.mimeType, size: fileData.size, hasThumb: fileData.hasThumb,
    uploadedById: actor.id,
  }, select: { id: true } });
  await tx.product.update({ where: { id: target.productId }, data: { sketchFileId: file.id } });
  await tx.changeLog.create({ data: {
    actorType: "user", actorId: actor.id, actorName: actor.name ?? undefined,
    entity: "file", entityId: file.id, action: "create",
    newValue: { projectId: target.projectId, productId: target.productId,
      fileName: fileData.fileName, category: "PHOTO" },
  } });
  await tx.changeLog.create({ data: {
    actorType: "user", actorId: actor.id, actorName: actor.name ?? undefined,
    entity: "product", entityId: target.productId, action: "cover.change", field: "sketchFileId",
    oldValue: { sketchFileId: permission.product.sketchFileId },
    newValue: { sketchFileId: file.id, uploaded: true },
  } });
  return { ok: true, id: file.id };
}

/** Caller supplies a transaction so the pointer and audit record commit together. */
export async function setProductCoverCore(
  tx: Tx,
  actor: CoverMutationActor,
  productId: string,
  fileId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!hasCoverEditRole(actor)) return { ok: false, error: "Недостаточно прав" };
  const visibility = await resolveVisibilityActor(tx, actor);
  const product = await tx.product.findFirst({
    where: { AND: [{ id: productId }, productEditWhere(visibility)] },
    select: { id: true, projectId: true, engineerId: true, status: true, sketchFileId: true },
  });
  if (!product || product.id !== productId) return { ok: false, error: "Изделие не найдено" };
  if (!canSetProductCover(visibility, product)) return { ok: false, error: "Недостаточно прав" };

  const file = await tx.file.findFirst({
    where: { AND: [{ id: fileId }, fileVisibilityWhere(visibility)] },
    select: { id: true, projectId: true, productId: true, mimeType: true },
  });
  if (!file || file.id !== fileId) return { ok: false, error: "Файл не найден" };
  const error = validateProductCoverFile(product, file);
  if (error) return { ok: false, error };
  if (product.sketchFileId === fileId) return { ok: true };

  await tx.product.update({ where: { id: productId }, data: { sketchFileId: fileId } });
  await tx.changeLog.create({ data: {
    actorType: "user", actorId: actor.id, actorName: actor.name ?? undefined,
    entity: "product", entityId: productId, action: "cover.change", field: "sketchFileId",
    oldValue: { sketchFileId: product.sketchFileId }, newValue: { sketchFileId: fileId },
  } });
  return { ok: true };
}
