import { ProposalMediaError, itemMediaReferences, mediaIdFromToken, mediaIdSchema,
  type MediaReferenceScope } from "./media-contract";
import { readProposalMedia, type ProposalMediaDependencies } from "./media-core";

export const KP_RENDER_MEDIA_MAX_BYTES = 64 * 1024 * 1024;

/** Только same-origin маршрут CRM; этот URL никогда не сохраняется в state. */
export function proposalMediaPreviewUrl(proposalId: string, token: unknown, scope: MediaReferenceScope): string {
  if (!mediaIdSchema.safeParse(proposalId).success) throw new ProposalMediaError("KP_MEDIA_REFERENCE_INVALID");
  const mediaId = mediaIdFromToken(token);
  if (!mediaId) return "";
  if (scope.kind === "version" && !mediaIdSchema.safeParse(scope.versionId).success)
    throw new ProposalMediaError("KP_MEDIA_REFERENCE_INVALID");
  const query = new URLSearchParams({ variant: "optimized", scope: scope.kind });
  if (scope.kind === "version") query.set("versionId", scope.versionId);
  return `/api/kp/documents/${encodeURIComponent(proposalId)}/media/${encodeURIComponent(mediaId)}?${query}`;
}

/** Вызывающий сервер передаёт сохранённый current/version snapshot; renderer не получает URL или ключи S3. */
export async function resolveProposalMediaAssets(dependencies: ProposalMediaDependencies, input: {
  actorId: string; proposalId: string; scope: MediaReferenceScope;
  items: readonly { id: string; image?: unknown; image2?: unknown }[];
}): Promise<{ mediaId: string; mimeType: string; bytesBase64: string }[]> {
  const mediaIds = [...new Set(itemMediaReferences(input.items).flatMap(item => item.mediaIds))];
  const assets: { mediaId: string; mimeType: string; bytesBase64: string }[] = [];
  let totalBytes = 0;
  for (const mediaId of mediaIds) {
    const media = await readProposalMedia(dependencies, { actorId: input.actorId, proposalId: input.proposalId,
      mediaId, variant: "optimized", scope: input.scope });
    totalBytes += media.bytes.length;
    if (totalBytes > KP_RENDER_MEDIA_MAX_BYTES) throw new ProposalMediaError("KP_MEDIA_TOO_LARGE");
    assets.push({ mediaId, mimeType: media.mimeType, bytesBase64: media.bytes.toString("base64") });
  }
  return assets;
}
