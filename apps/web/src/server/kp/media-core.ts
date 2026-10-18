import { randomUUID } from "node:crypto";
import { ProposalMediaError, itemMediaReferences, mediaFingerprint, mediaIdSchema, mediaObjectKeys, mediaOperationSchema,
  mediaToken, productMediaStoredName, proposalMediaExpiry, validateMediaPlan,
  type MediaBinding, type MediaOperation, type MediaOwner, type MediaPlan, type MediaReadRequest,
  type MediaReservation, type PreparedImage, type PreparedProductMedia, type ReadableMedia } from "./media-contract";
import { prepareProposalImage } from "./media-image";
import { assertMediaStorageBinding, putVerifiedProposalMedia, verifyMediaBytes, type ProposalMediaStorage } from "./media-storage";

export type UploadImageFacts = Omit<PreparedImage, "original" | "optimized"> & { originalSize: number; optimizedSize: number };
export type MediaUploadRequest = MediaOperation & { binding: MediaBinding; image: UploadImageFacts };
export type MediaCopyRequest = MediaOperation & { binding: MediaBinding; itemId: string; mediaId: string };

/** Реализация каждой операции репозитория — короткая отдельная DB-транзакция без сетевых effects. */
export interface ProposalMediaRepository {
  reserveUpload(input: MediaUploadRequest): Promise<MediaReservation>;
  reserveCopy(input: MediaCopyRequest): Promise<MediaReservation | { existingFileId: string }>;
  assertActive(reservation: MediaReservation): Promise<void>;
  publishUpload(reservation: MediaReservation): Promise<void>;
  completeCopy(reservation: MediaReservation): Promise<void>;
  fail(reservation: MediaReservation, code: string): Promise<void>;
  authorizeRead(input: MediaReadRequest): Promise<ReadableMedia>;
}
export type ProposalMediaDependencies = { repository: ProposalMediaRepository; storage: ProposalMediaStorage;
  /** Транспорт повторно проверяет текущий API key/scopes, если операция пришла через API. */
  authorize?: () => Promise<void> };

export function createMediaUploadPlan(owner: MediaOwner, input: MediaUploadRequest, ids = {
  mediaId: randomUUID(), jobId: randomUUID(), cleanupJobId: randomUUID(),
}): MediaPlan {
  const keys = mediaObjectKeys(input.proposalId, ids.mediaId, input.image.originalMimeType, input.image.optimizedMimeType);
  const fingerprint = mediaFingerprint({ kind: "UPLOAD_MEDIA", ...input.image, actorId: input.actorId,
    proposalId: input.proposalId, expectedRevision: input.expectedRevision, binding: JSON.stringify(input.binding) });
  return validateMediaPlan({ schema: 1, kind: "UPLOAD_MEDIA", ...ids, proposalId: owner.proposalId, projectId: owner.projectId,
    actorId: input.actorId, expectedRevision: input.expectedRevision, fingerprint, binding: input.binding,
    original: { key: keys.original, sha256: input.image.originalHash, size: input.image.originalSize, mimeType: input.image.originalMimeType },
    optimized: { key: keys.optimized, sha256: input.image.optimizedHash, size: input.image.optimizedSize, mimeType: input.image.optimizedMimeType },
    fileName: input.image.fileName, width: input.image.width, height: input.image.height,
    expiresAt: proposalMediaExpiry(owner.createdAt).toISOString() });
}

export function createProductMediaCopyPlan(owner: MediaOwner, input: MediaCopyRequest, source: ReadableMedia & { width: number; height: number },
  ids = { jobId: randomUUID(), cleanupJobId: randomUUID(), fileId: randomUUID() }): MediaPlan {
  const storedName = productMediaStoredName(ids.jobId, source.object.mimeType);
  const fingerprint = mediaFingerprint({ kind: "COPY_PRODUCT_MEDIA", actorId: input.actorId, proposalId: input.proposalId,
    expectedRevision: input.expectedRevision, itemId: input.itemId, mediaId: input.mediaId, sourceHash: source.object.sha256,
    binding: JSON.stringify(input.binding) });
  return validateMediaPlan({ schema: 1, kind: "COPY_PRODUCT_MEDIA", ...ids, mediaId: input.mediaId,
    proposalId: owner.proposalId, projectId: owner.projectId, actorId: input.actorId, expectedRevision: input.expectedRevision,
    itemId: input.itemId, fingerprint, binding: input.binding, source: source.object,
    optimized: { ...source.object, key: `${owner.projectId}/${storedName}` }, fileName: source.fileName,
    width: source.width, height: source.height, storedName, expiresAt: proposalMediaExpiry(owner.createdAt).toISOString() });
}

function parseOperation(input: MediaOperation): MediaOperation {
  const parsed = mediaOperationSchema.safeParse(input);
  if (!parsed.success) throw new ProposalMediaError("KP_MEDIA_INVALID");
  return parsed.data;
}
async function failure(repository: ProposalMediaRepository, reservation: MediaReservation, error: unknown): Promise<never> {
  const safe = error instanceof ProposalMediaError ? error : new ProposalMediaError("KP_MEDIA_STORAGE_FAILED");
  // При сбое записи статуса исходный durable ledger + ожидающий cleanup уже существуют.
  await repository.fail(reservation, safe.code).catch(() => {});
  throw safe;
}

export async function uploadProposalImage(dependencies: ProposalMediaDependencies, input: MediaOperation & {
  original: Buffer; fileName: string; mimeType?: string; optimized?: Buffer; optimizedMimeType?: string;
}): Promise<{ mediaId: string; reference: string; repeated: boolean }> {
  const operation = parseOperation({ actorId: input.actorId, proposalId: input.proposalId,
    expectedRevision: input.expectedRevision, operationId: input.operationId });
  const image = await prepareProposalImage(input);
  const { original, optimized, ...facts } = image;
  const binding = dependencies.storage.currentBinding();
  await dependencies.authorize?.();
  const reservation = await dependencies.repository.reserveUpload({ ...operation, binding,
    image: { ...facts, originalSize: original.length, optimizedSize: optimized.length } });
  const plan = validateMediaPlan(reservation.plan);
  if (plan.kind !== "UPLOAD_MEDIA" || !plan.original) throw new ProposalMediaError("KP_MEDIA_INVALID");
  if (!reservation.ready) {
    try {
      const active = async () => { await dependencies.authorize?.(); await dependencies.repository.assertActive(reservation); };
      await putVerifiedProposalMedia(dependencies.storage, plan.binding, plan.original, original, active);
      await putVerifiedProposalMedia(dependencies.storage, plan.binding, plan.optimized, optimized, active);
      await dependencies.authorize?.(); await dependencies.repository.publishUpload(reservation);
    } catch (error) { return failure(dependencies.repository, reservation, error); }
  }
  return { mediaId: plan.mediaId, reference: mediaToken(plan.mediaId), repeated: reservation.repeated };
}

/** Подготовка по stable item.id до общей save-транзакции; File ещё не создаётся. */
export async function prepareProposalProductMedia(dependencies: ProposalMediaDependencies, input: MediaOperation & {
  items: readonly { id: string; image?: unknown; image2?: unknown }[];
}): Promise<PreparedProductMedia> {
  const operation = parseOperation({ actorId: input.actorId, proposalId: input.proposalId,
    expectedRevision: input.expectedRevision, operationId: input.operationId });
  const references = itemMediaReferences(input.items), binding = dependencies.storage.currentBinding(), jobs: string[] = [];
  for (const item of references) for (const mediaId of item.mediaIds) {
    await dependencies.authorize?.();
    const reservation = await dependencies.repository.reserveCopy({ ...operation, binding, itemId: item.itemId, mediaId });
    if ("existingFileId" in reservation) continue;
    const plan = validateMediaPlan(reservation.plan);
    if (plan.kind !== "COPY_PRODUCT_MEDIA" || !plan.source) throw new ProposalMediaError("KP_MEDIA_INVALID");
    try {
      if (!reservation.ready) {
        await dependencies.authorize?.(); await dependencies.repository.assertActive(reservation);
        assertMediaStorageBinding(dependencies.storage, plan.binding);
        const bytes = await dependencies.storage.read(plan.binding, plan.source);
        if (!bytes) throw new ProposalMediaError("KP_MEDIA_NOT_FOUND");
        verifyMediaBytes(bytes, plan.source);
        await putVerifiedProposalMedia(dependencies.storage, plan.binding, plan.optimized, bytes,
          async () => { await dependencies.authorize?.(); await dependencies.repository.assertActive(reservation); });
        await dependencies.authorize?.(); await dependencies.repository.completeCopy(reservation);
      }
    } catch (error) { return failure(dependencies.repository, reservation, error); }
    jobs.push(plan.jobId);
  }
  return { proposalId: operation.proposalId, expectedRevision: operation.expectedRevision, jobs };
}

export async function readProposalMedia(dependencies: ProposalMediaDependencies, input: MediaReadRequest): Promise<{
  bytes: Buffer; mimeType: string; fileName: string;
}> {
  if (![input.actorId, input.proposalId, input.mediaId].every(id => mediaIdSchema.safeParse(id).success) ||
    !["original", "optimized"].includes(input.variant) || !["uploaded", "current", "version"].includes(input.scope.kind) ||
    input.scope.kind === "version" && !mediaIdSchema.safeParse(input.scope.versionId).success)
    throw new ProposalMediaError("KP_MEDIA_REFERENCE_INVALID");
  await dependencies.authorize?.();
  const facts = await dependencies.repository.authorizeRead(input);
  assertMediaStorageBinding(dependencies.storage, facts.binding);
  const bytes = await dependencies.storage.read(facts.binding, facts.object);
  if (!bytes) throw new ProposalMediaError("KP_MEDIA_NOT_FOUND");
  assertMediaStorageBinding(dependencies.storage, facts.binding);
  verifyMediaBytes(bytes, facts.object);
  // Повторная проверка перед отдачей: отзыв роли/удаление проекта во время Get закрывает доступ.
  await dependencies.authorize?.();
  const current = await dependencies.repository.authorizeRead(input);
  assertMediaStorageBinding(dependencies.storage, current.binding);
  if (!sameReadable(facts, current)) throw new ProposalMediaError("KP_MEDIA_NOT_FOUND");
  return { bytes, mimeType: facts.object.mimeType, fileName: facts.fileName };
}
function sameReadable(left: ReadableMedia, right: ReadableMedia): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
