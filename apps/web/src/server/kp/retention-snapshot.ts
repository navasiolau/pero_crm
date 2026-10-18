import type { Prisma } from "@prisma/client";
import { RetentionError, normalizeRetentionBinding, type RetentionBinding, type RetentionObject } from "./retention-contract";
import type { RetentionArtifact, RetentionFile, RetentionJobRow, RetentionMedia, RetentionSnapshot } from "./retention-policy";

type MediaSql = { id: string; uploadState: string; uploadJobId: string | null; storageBinding: RetentionBinding;
  originalKey: string | null; originalHash: string | null; originalSize: number | null; mimeType: string;
  optimizedKey: string | null; optimizedHash: string | null; optimizedSize: number | null; optimizedMimeType: string;
  originalPurgedAt: Date | null; optimizedPurgedAt: Date | null; expiresAt: Date; retiringAt: Date | null };
type ArtifactSql = Omit<RetentionArtifact, "binding" | "object"> & RetentionObject & { storageBinding: RetentionBinding };
function checkedBinding(value: RetentionBinding) { normalizeRetentionBinding(value); return value; }

export async function proposalRetentionSnapshot(tx: Prisma.TransactionClient, proposalId: string): Promise<RetentionSnapshot> {
  const [proposal] = await tx.$queryRaw<RetentionSnapshot["proposal"][]>`SELECT cp.id, cp."projectId", p.stage::text AS stage,
    cp."createdAt", cp."acceptedVersionId", cp."retentionEpoch" AS epoch FROM "CommercialProposal" cp
    LEFT JOIN "Project" p ON p.id = cp."projectId" WHERE cp.id = ${proposalId}`;
  if (!proposal) throw new RetentionError("KP_RETENTION_OWNER_MISSING");
  const [trigger]=await tx.$queryRaw<{present:boolean}[]>`SELECT EXISTS(SELECT 1 FROM "ProjectStageHistory" h JOIN "CommercialProposal" cp ON cp."projectId"=h."projectId"
    WHERE cp.id=${proposalId} AND h."toStage"='IN_WORK' AND h."createdAt">=cp."acceptedAt") OR EXISTS(SELECT 1 FROM "ProposalJob" j JOIN "CommercialProposal" cp ON cp.id=j."proposalId"
    WHERE cp.id=${proposalId} AND j.kind='PRUNE_VERSIONS' AND j."retentionEpoch"=cp."retentionEpoch" AND j.payload->>'acceptedVersionId'=cp."acceptedVersionId") AS present`;
  const versions = await tx.$queryRaw<RetentionSnapshot["versions"]>`SELECT v.id, v."pdfArtifactId",
    ARRAY(SELECT vm."mediaId" FROM "ProposalVersionMedia" vm WHERE vm."versionId" = v.id ORDER BY vm."mediaId") AS "mediaIds"
    FROM "ProposalVersion" v WHERE v."proposalId" = ${proposalId}`;
  const current = await tx.$queryRaw<{ mediaId: string }[]>`SELECT "mediaId" FROM "ProposalCurrentMedia" WHERE "proposalId" = ${proposalId}`;
  const rawMedia = await tx.$queryRaw<MediaSql[]>`SELECT * FROM "ProposalMedia" WHERE "proposalId" = ${proposalId}`;
  const media: RetentionMedia[] = rawMedia.map(row => ({ id: row.id, uploadState: row.uploadState, uploadJobId: row.uploadJobId,
    binding: checkedBinding(row.storageBinding), original: row.originalKey && row.originalHash && row.originalSize
      ? { key: row.originalKey, sha256: row.originalHash, size: row.originalSize, mimeType: row.mimeType } : null,
    optimized: row.optimizedKey && row.optimizedHash && row.optimizedSize
      ? { key: row.optimizedKey, sha256: row.optimizedHash, size: row.optimizedSize, mimeType: row.optimizedMimeType } : null,
    originalPurgedAt: row.originalPurgedAt, optimizedPurgedAt: row.optimizedPurgedAt, expiresAt: row.expiresAt, retiringAt: row.retiringAt }));
  const rawArtifacts = await tx.$queryRaw<ArtifactSql[]>`SELECT a.*, ARRAY(SELECT v.id FROM "ProposalVersion" v WHERE v."pdfArtifactId" = a.id) AS "quoteVersionIds",
    ARRAY(SELECT cv.id FROM "ProposalContractVersion" cv WHERE cv."docxArtifactId" = a.id) AS "contractVersionIds"
    FROM "ProposalArtifact" a WHERE a."proposalId" = ${proposalId} OR a."contractId" IN (SELECT c.id FROM "ProposalContract" c WHERE c."primaryProposalId" = ${proposalId})`;
  const artifacts: RetentionArtifact[] = rawArtifacts.map(row => ({ id: row.id, proposalId: row.proposalId, contractId: row.contractId,
    kind: row.kind, state: row.state, binding: checkedBinding(row.storageBinding), object: { key: row.key, sha256: row.sha256, size: row.size, mimeType: row.mimeType },
    quoteVersionIds: row.quoteVersionIds, contractVersionIds: row.contractVersionIds }));
  const files = proposal.projectId ? await tx.$queryRaw<RetentionFile[]>`SELECT f.id, f."projectId", f."productId", f."storedName", f."fileName", f."uploadedById", f."hasThumb",
    f."proposalMediaRetiredAt" AS "retiredAt", f."proposalSourceItemId" AS "sourceItemId", f."proposalSourceMediaId" AS "sourceMediaId", f."proposalMediaCopyJobId" AS "copyJobId",
    ((SELECT count(*) FROM "Product" p WHERE p."sketchFileId" = f.id) + (SELECT count(*) FROM "Project" p WHERE p."coverFileId" = f.id))::int AS "coverReferences",
    (SELECT count(*) FROM "File" other WHERE other."projectId" = f."projectId" AND other."storedName" = f."storedName" AND other.id <> f.id)::int AS aliases,
    EXISTS(SELECT 1 FROM "DomainEvent" e WHERE e.type = 'file.storage-delete' AND e."processedAt" IS NULL AND e.payload->>'projectId' = f."projectId" AND e.payload->>'storedName' = f."storedName") AS "pendingDelete"
    FROM "File" f WHERE f."projectId" = ${proposal.projectId}` : [];
  const pending = proposal.projectId ? await tx.$queryRaw<{ key: string }[]>`SELECT (payload->>'projectId') || '/' || (payload->>'storedName') AS key FROM "DomainEvent"
    WHERE type = 'file.storage-delete' AND "processedAt" IS NULL AND payload->>'projectId' = ${proposal.projectId}` : [];
  const jobs = await tx.$queryRaw<RetentionJobRow[]>`SELECT id, kind::text, state::text, attempts, "maxAttempts", "leaseUntil", payload, result FROM "ProposalJob"
    WHERE kind::text IN ('UPLOAD_MEDIA','COPY_PRODUCT_MEDIA','PDF','CONTRACT') AND ("proposalId" = ${proposalId}
      OR payload->'frozenSources' @> ${JSON.stringify([{ proposalId }])}::jsonb)`;
  const reserves = await tx.$queryRaw<{ id: string; entityId: string; newValue: { schema: number; manifestHash: string; objects: RetentionSnapshot["archiveReservations"][number]["objects"] }; createdAt: Date; published: boolean }[]>`
    SELECT r.id,r."entityId",r."newValue",r."createdAt",EXISTS(SELECT 1 FROM "ChangeLog" p WHERE p.id='kp.archive.publish:'||r."entityId"
      AND p.entity='kpArchiveImport' AND p."entityId"=r."entityId" AND p.action='archive.publish' AND p."newValue"->>'manifestHash'=r."entityId") AS published
    FROM "ChangeLog" r WHERE r.entity='kpArchiveImport' AND r.action='archive.reserve' AND r."newValue"->'proposalIds' @> ${JSON.stringify([proposalId])}::jsonb`;
  const archiveReservations = reserves.map(row => {
    if (row.id !== `kp.archive.reserve:${row.entityId}` || row.newValue.schema !== 1 || row.newValue.manifestHash !== row.entityId || !Array.isArray(row.newValue.objects))
      throw new RetentionError("KP_RETENTION_ARCHIVE_RESERVE_INVALID");
    return { id: row.id, manifestHash: row.entityId, objects: row.newValue.objects, createdAt: row.createdAt, published: row.published };
  });
  return { proposal,inWorkTriggered:proposal.stage==='IN_WORK'||trigger.present, versions, currentMediaIds: current.map(row => row.mediaId), media, artifacts, files, jobs, pendingFileKeys: pending.map(row => row.key), archiveReservations };
}
