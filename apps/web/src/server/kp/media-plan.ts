import { randomUUID } from "node:crypto";
import { mediaFingerprint, mediaObjectKeys, productMediaStoredName, proposalMediaExpiry, validateMediaPlan,
  type MediaBinding, type MediaOperation, type MediaOwner, type MediaPlan, type PreparedImage, type ReadableMedia } from "./media-contract";

export type UploadImageFacts = Omit<PreparedImage, "original" | "optimized"> & { originalSize: number; optimizedSize: number };
export type MediaUploadRequest = MediaOperation & { binding: MediaBinding; image: UploadImageFacts };
export type MediaCopyRequest = MediaOperation & { binding: MediaBinding; itemId: string; mediaId: string };

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
