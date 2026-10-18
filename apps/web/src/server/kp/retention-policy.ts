import { RetentionError, makeRetentionManifest, retentionAnniversary, retentionHash, sameRetentionBinding,
  type RetentionBinding, type RetentionManifest, type RetentionObject, type RetentionPayload, type RetentionTarget } from "./retention-contract";

export type RetentionJobRow = { id: string; kind: string; state: string; attempts: number; maxAttempts: number;
  leaseUntil: Date | null; payload: unknown; result: unknown };
export type RetentionMedia = { id: string; uploadState: string; uploadJobId: string | null; binding: RetentionBinding;
  original: RetentionObject | null; optimized: RetentionObject | null; originalPurgedAt: Date | null;
  optimizedPurgedAt: Date | null; expiresAt: Date; retiringAt: Date | null };
export type RetentionArtifact = { id: string; proposalId: string | null; contractId: string | null; kind: string; state: string;
  binding: RetentionBinding; object: RetentionObject; quoteVersionIds: string[]; contractVersionIds: string[] };
export type RetentionFile = { id: string; projectId: string; productId: string | null; storedName: string; fileName: string;
  uploadedById: string | null; hasThumb: boolean; retiredAt: Date | null; sourceItemId: string | null; sourceMediaId: string | null;
  copyJobId: string | null; coverReferences: number; aliases: number; pendingDelete: boolean };
export type RetentionSnapshot = {
  proposal: { id: string; projectId: string | null; stage: string | null; createdAt: Date; acceptedVersionId: string | null; epoch: number };
  inWorkTriggered: boolean;
  versions: { id: string; pdfArtifactId: string | null; mediaIds: string[] }[];
  currentMediaIds: string[]; media: RetentionMedia[]; artifacts: RetentionArtifact[]; files: RetentionFile[]; jobs: RetentionJobRow[];
  pendingFileKeys: string[];
  archiveReservations: { id: string; manifestHash: string; published: boolean; createdAt: Date;
    objects: { id: string; proposalId: string; artifactId?: string; mediaId?: string; operationJobId: string; binding: RetentionBinding; key: string; sha256: string; size: number; mimeType: string }[] }[];
};
const plain = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
export function retentionOperationActive(job: RetentionJobRow | undefined, now: Date): boolean {
  return !!job && (job.state === "PENDING" && job.attempts < job.maxAttempts || job.state === "PROCESSING" && !!job.leaseUntil && job.leaseUntil > now);
}
function activeSource(snapshot: RetentionSnapshot, now: Date, mediaId?: string, artifactId?: string): boolean {
  return snapshot.jobs.some(job => {
    if (!retentionOperationActive(job, now)) return false;
    const payload = plain(job.payload);
    if (["UPLOAD_MEDIA", "COPY_PRODUCT_MEDIA"].includes(job.kind)) return !!mediaId && payload?.mediaId === mediaId;
    if (!["PDF", "CONTRACT"].includes(job.kind)) return false;
    if (!Array.isArray(payload?.frozenSources)) throw new RetentionError("KP_RETENTION_LIVE_SNAPSHOT_INVALID");
    return payload.frozenSources.some(raw => {
      const source = plain(raw);
      if (!source || source.proposalId !== snapshot.proposal.id) return false;
      if (!mediaId && !artifactId) return true;
      if (artifactId) return source.retainedPdfArtifactId === artifactId;
      if (!Array.isArray(source.media)) throw new RetentionError("KP_RETENTION_LIVE_SNAPSHOT_INVALID");
      return source.media.some(value => plain(value)?.id === mediaId);
    });
  });
}
const mediaTarget = (media: RetentionMedia, variant: "original" | "optimized"): RetentionTarget => ({
  ...media[variant]!, id: `media:${media.id}:${variant}`, binding: media.binding, entity: "MEDIA", entityId: media.id, variant,
});
const artifactTarget = (artifact: RetentionArtifact): RetentionTarget => ({ ...artifact.object,
  id: `artifact:${artifact.id}`, binding: artifact.binding, entity: "ARTIFACT", entityId: artifact.id,
  ...(artifact.contractId ? { contractId: artifact.contractId } : {}),
});
function exactObjects(expected: RetentionObject[], actual: RetentionObject[], expectedBinding: RetentionBinding, actualBinding: RetentionBinding) {
  const canonical = (items: RetentionObject[]) => retentionHash([...items].sort((a, b) => a.key.localeCompare(b.key)));
  if (!sameRetentionBinding(expectedBinding, actualBinding) || canonical(expected) !== canonical(actual)) throw new RetentionError("KP_RETENTION_OBJECT_FACTS_CHANGED");
}
const defer = (): never => { throw new RetentionError("KP_RETENTION_REFERENCED", true); };
export function shouldScheduleAcceptanceCleanup(snapshot:Pick<RetentionSnapshot,'proposal'|'inWorkTriggered'>):boolean{
  return !!snapshot.proposal.acceptedVersionId&&!!snapshot.proposal.stage&&snapshot.proposal.stage!=='LEAD'&&
    (snapshot.proposal.stage==='IN_WORK'||snapshot.inWorkTriggered);
}

/** Чистая политика: только authoritative snapshot; никаких S3 list/prefix-предположений. */
export function planProposalRetention(snapshot: RetentionSnapshot, payload: RetentionPayload, now: Date): RetentionManifest {
  if (snapshot.proposal.id !== payload.proposalId) throw new RetentionError("KP_RETENTION_OWNER_MISMATCH");
  const targets: RetentionTarget[] = [], pruneVersionIds: string[] = [];
  if (payload.kind === "CANCELLED_PROBE") throw new RetentionError("KP_RETENTION_PROBE_REQUIRED");
  if (payload.kind === "ACCEPTED_RETENTION") {
    if (!snapshot.proposal.stage || snapshot.proposal.stage === "LEAD" || snapshot.proposal.epoch !== payload.retentionEpoch ||
      snapshot.proposal.acceptedVersionId !== payload.acceptedVersionId) throw new RetentionError("KP_RETENTION_CANCELLED");
    const accepted = snapshot.versions.find(version => version.id === payload.acceptedVersionId);
    if (!accepted?.pdfArtifactId) throw new RetentionError("KP_RETENTION_ACCEPTED_VERSION_INVALID");
    const acceptedPdf = snapshot.artifacts.find(artifact => artifact.id === accepted.pdfArtifactId);
    if (!acceptedPdf || acceptedPdf.kind !== "PDF" || acceptedPdf.proposalId !== snapshot.proposal.id || acceptedPdf.state !== "READY")
      throw new RetentionError("KP_RETENTION_ACCEPTED_VERSION_INVALID");
    if (activeSource(snapshot, now)) defer();
    pruneVersionIds.push(...snapshot.versions.filter(version => version.id !== accepted.id).map(version => version.id));
    const retained = new Set(accepted.mediaIds);
    for (const media of snapshot.media) {
      if (activeSource(snapshot, now, media.id)) defer();
      if (media.original && !media.originalPurgedAt) targets.push(mediaTarget(media, "original"));
      if (media.optimized && !media.optimizedPurgedAt && !retained.has(media.id)) targets.push(mediaTarget(media, "optimized"));
    }
    for (const artifact of snapshot.artifacts) {
      if (artifact.kind !== "PDF" || artifact.proposalId !== snapshot.proposal.id || artifact.id === accepted.pdfArtifactId ||
        artifact.state === "DELETED" || artifact.state === "PENDING") continue;
      if (artifact.contractVersionIds.length || artifact.quoteVersionIds.some(id => !pruneVersionIds.includes(id))) continue;
      if (activeSource(snapshot, now, undefined, artifact.id)) defer();
      targets.push(artifactTarget(artifact));
    }
  } else if (payload.kind === "ANNUAL_MEDIA") {
    const expiry = retentionAnniversary(snapshot.proposal.createdAt);
    if (expiry.toISOString() !== payload.expiresAt || expiry > now) throw new RetentionError("KP_RETENTION_NOT_DUE", true);
    for (const media of snapshot.media) {
      if (activeSource(snapshot, now, media.id)) defer();
      if (media.original && !media.originalPurgedAt) targets.push(mediaTarget(media, "original"));
      if (media.optimized && !media.optimizedPurgedAt) targets.push(mediaTarget(media, "optimized"));
    }
    if (targets.length && snapshot.archiveReservations.some(reservation => !reservation.published)) defer();
  } else if (payload.kind === "UNATTACHED_MEDIA") {
    const media = snapshot.media.find(value => value.id === payload.mediaId);
    const operation=snapshot.jobs.find(job=>job.id===payload.operationJobId), source=plain(operation?.payload);
    if (!media || media.uploadJobId!==payload.operationJobId || operation?.kind!=='UPLOAD_MEDIA' ||
      source?.mediaId!==media.id || source.proposalId!==payload.proposalId) throw new RetentionError("KP_RETENTION_OWNER_MISMATCH");
    exactObjects(payload.objects, [media.original, media.optimized].filter((value): value is RetentionObject => !!value), payload.binding, media.binding);
    exactObjects(payload.objects,[plain(source.original),plain(source.optimized)].filter((value):value is Record<string,unknown>=>!!value)as RetentionObject[],payload.binding,source.binding as RetentionBinding);
    if (snapshot.currentMediaIds.includes(media.id) || snapshot.versions.some(version => version.mediaIds.includes(media.id)))
      return makeRetentionManifest(payload.proposalId, [], []);
    if (retentionOperationActive(snapshot.jobs.find(job => job.id === payload.operationJobId), now) || activeSource(snapshot, now, media.id)) defer();
    if (media.original && !media.originalPurgedAt) targets.push(mediaTarget(media, "original"));
    if (media.optimized && !media.optimizedPurgedAt) targets.push(mediaTarget(media, "optimized"));
  } else if (payload.kind === "ORPHAN_ARCHIVE_ARTIFACT") {
    const artifact = snapshot.artifacts.find(value => value.id === payload.artifactId), job = snapshot.jobs.find(value => value.id === payload.operationJobId);
    const data=plain(job?.payload), archive=plain(data?.archiveImport);
    const reserve = snapshot.archiveReservations.find(value => value.id === payload.archiveReserveReceiptId && value.manifestHash === payload.archiveManifestHash);
    const object = reserve?.objects.find(value => value.artifactId === payload.artifactId && value.operationJobId === payload.operationJobId && value.proposalId === payload.proposalId);
    if (!artifact || !job || job.kind !== "UPLOAD_MEDIA" || !reserve || !object || reserve.id !== `kp.archive.reserve:${reserve.manifestHash}` ||
      data?.proposalId!==payload.proposalId||data.artifactId!==artifact.id||data.contractId!==artifact.contractId||archive?.manifestHash!==payload.archiveManifestHash)
      throw new RetentionError("KP_RETENTION_ARCHIVE_RESERVE_INVALID");
    exactObjects(payload.objects, [artifact.object], payload.binding, artifact.binding);
    exactObjects(payload.objects, [{ key: object.key, sha256: object.sha256, size: object.size, mimeType: object.mimeType }], payload.binding, object.binding);
    if (reserve.published || artifact.state === "READY" || artifact.quoteVersionIds.length || artifact.contractVersionIds.length || artifact.state === "DELETED")
      return makeRetentionManifest(payload.proposalId, [], []);
    if (retentionOperationActive(job, now) || reserve.createdAt.getTime()+24*3_600_000>now.getTime()) defer();
    targets.push(artifactTarget(artifact));
  } else if (payload.kind === "ORPHAN_ARTIFACT") {
    const artifact = snapshot.artifacts.find(value => value.id === payload.artifactId), job = snapshot.jobs.find(value => value.id === payload.operationJobId);
    if (!artifact || !job || !["PDF", "CONTRACT"].includes(job.kind)) throw new RetentionError("KP_RETENTION_OWNER_MISMATCH");
    exactObjects(payload.objects, [artifact.object], payload.binding, artifact.binding);
    if (artifact.state === "READY" || artifact.quoteVersionIds.length || artifact.contractVersionIds.length)
      return makeRetentionManifest(payload.proposalId, [], []);
    if (artifact.state === "DELETED") return makeRetentionManifest(payload.proposalId, [], []);
    if (job.attempts === payload.attempt && retentionOperationActive(job, now)) defer();
    const extension = artifact.kind === "PDF" ? "pdf" : "docx", owner = artifact.contractId ? `contracts/${artifact.contractId}` : `proposals/${payload.proposalId}`;
    if (artifact.object.key !== `kp/${owner}/exports/${job.id}-${payload.attempt}-${artifact.id}.${extension}`)
      throw new RetentionError("KP_RETENTION_ARTIFACT_CLAIM_MISMATCH");
    targets.push(artifactTarget(artifact));
  } else {
    const job = snapshot.jobs.find(value => value.id === payload.operationJobId), data = plain(job?.payload), optimized = plain(data?.optimized);
    if (!job || job.kind !== "COPY_PRODUCT_MEDIA" || !data || data.fileId !== payload.fileId || data.projectId !== payload.projectId ||
      data.proposalId !== payload.proposalId || data.storedName !== payload.storedName || !optimized || snapshot.proposal.projectId!==payload.projectId ||
      data.mediaId!==(payload.kind==='RETIRED_PRODUCT_COPY'?payload.sourceMediaId:payload.mediaId))
      throw new RetentionError("KP_RETENTION_COPY_OWNER_MISMATCH");
    exactObjects(payload.objects, [optimized as RetentionObject], payload.binding, data.binding as RetentionBinding);
    const file = snapshot.files.find(value => value.id === payload.fileId);
    if(file&&(file.projectId!==payload.projectId||file.storedName!==payload.storedName||file.copyJobId!==payload.operationJobId||
      file.sourceItemId!==data.itemId||file.sourceMediaId!==data.mediaId))throw new RetentionError('KP_RETENTION_COPY_OWNER_MISMATCH');
    if (snapshot.pendingFileKeys.includes(payload.objects[0].key)) defer();
    if (snapshot.files.some(value => value.id !== payload.fileId && value.projectId === payload.projectId && value.storedName === payload.storedName)) defer();
    if (payload.kind === "UNATTACHED_PRODUCT_COPY" && file) return makeRetentionManifest(payload.proposalId, [], []);
    if (retentionOperationActive(job, now)) defer();
    if (file && (!file.retiredAt || file.coverReferences || file.aliases || file.pendingDelete)) defer();
    if (file?.hasThumb) throw new RetentionError("KP_RETENTION_UNEXPECTED_THUMBNAIL");
    targets.push({ ...payload.objects[0], id: `copy:${payload.fileId}`, entity: "PRODUCT_COPY", entityId: payload.fileId,
      binding: payload.binding, projectId: payload.projectId, storedName: payload.storedName, operationJobId: payload.operationJobId });
  }
  return makeRetentionManifest(payload.proposalId, targets, pruneVersionIds);
}
