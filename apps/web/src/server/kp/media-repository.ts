import { writeChangeLogInTransaction } from "@/server/changelog/writer";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient, type Role } from "@prisma/client";
import { lockProjectRow } from "@/server/projects/lock";
import { assertProposalMediaAccess } from "./media-access";
import { KP_MEDIA_LEASE_MS, KP_MEDIA_ORPHAN_DELAY_MS, ProposalMediaError, parseMediaBinding, sameMediaBinding,
  validateMediaPlan, type MediaOperation, type MediaOwner, type MediaPlan,
  type MediaReservation, type ReadableMedia } from "./media-contract";
import { createMediaUploadPlan, createProductMediaCopyPlan } from "./media-plan";
import type { ProposalMediaRepository } from "./media-core";
import { proposalMediaUploadReversal } from "./media-upload-reversal";
import {projectJournalContext} from '../projects/journal';

type Tx = Prisma.TransactionClient;
type OwnerRow = MediaOwner & { deletedAt: Date | null; stage: string | null; projectDeletedAt: Date | null;projectNumber?:string;actorName?:string };
type JobRow = { id: string; proposalId: string | null; kind: string; state: string; payload: unknown; result: unknown;
  createdById: string | null; attempts: number; maxAttempts: number; leaseOwner: string | null; leaseUntil: Date | null };
export type OwnedMediaRow = { id: string; proposalId: string; storageBinding: unknown; originalKey: string | null;
  originalHash: string | null; originalSize: number | null; optimizedKey: string | null; optimizedHash: string | null;
  optimizedSize: number | null; mimeType: string; optimizedMimeType: string; fileName: string; width: number | null;
  height: number | null; uploadState: string; uploadJobId: string | null; retiringAt: Date | null; deletedAt: Date | null;
  originalPurgedAt: Date | null; optimizedPurgedAt: Date | null; expiresAt: Date };

/** Порядок lock совпадает с №181: Project → CommercialProposal → job/media. */
export async function lockProposalMediaOwner(tx: Tx, input: { actorId: string; proposalId: string; expectedRevision?: number },
  write: boolean): Promise<OwnerRow> {
  const [reference] = await tx.$queryRaw<{ projectId: string | null }[]>`
    SELECT "projectId" FROM "CommercialProposal" WHERE id = ${input.proposalId}`;
  if (!reference) throw new ProposalMediaError("KP_MEDIA_NOT_FOUND");
  if (write && reference.projectId) await lockProjectRow(tx, reference.projectId);
  if (write) await tx.$queryRaw`SELECT id FROM "CommercialProposal" WHERE id = ${input.proposalId} FOR UPDATE`;
  const [owner] = await tx.$queryRaw<OwnerRow[]>`
    SELECT cp.id AS "proposalId", cp."projectId", cp.revision, cp."createdAt", cp."deletedAt",
      p.stage::text AS stage, p.number AS "projectNumber", p."deletedAt" AS "projectDeletedAt"
    FROM "CommercialProposal" cp LEFT JOIN "Project" p ON p.id = cp."projectId" WHERE cp.id = ${input.proposalId}`;
  const [user] = await tx.$queryRaw<{ active: boolean; roles: Role[];name?:string }[]>(Prisma.sql`
    SELECT active, roles, name FROM "User" WHERE id = ${input.actorId} ${write ? Prisma.sql`FOR SHARE` : Prisma.empty}`);
  assertProposalMediaAccess(user, owner, write, input.expectedRevision);
  return {...owner,actorName:user.name};
}

export async function ownedProposalMedia(tx: Tx, proposalId: string, mediaId: string): Promise<OwnedMediaRow> {
  const [media] = await tx.$queryRaw<OwnedMediaRow[]>`
    SELECT * FROM "ProposalMedia" WHERE "proposalId" = ${proposalId} AND id = ${mediaId}`;
  if (!media || media.uploadState !== "READY" || media.retiringAt || media.deletedAt)
    throw new ProposalMediaError("KP_MEDIA_NOT_FOUND");
  return media;
}
export function readableMedia(media: OwnedMediaRow, variant: "original" | "optimized"): ReadableMedia {
  const original = variant === "original";
  const key = original ? media.originalKey : media.optimizedKey;
  const sha256 = original ? media.originalHash : media.optimizedHash;
  const size = original ? media.originalSize : media.optimizedSize;
  const purgedAt = original ? media.originalPurgedAt : media.optimizedPurgedAt;
  const mimeType = original ? media.mimeType : media.optimizedMimeType;
  if (!key || !sha256 || !size || purgedAt || !["image/jpeg", "image/png", "image/webp"].includes(mimeType))
    throw new ProposalMediaError("KP_MEDIA_NOT_FOUND");
  return { binding: parseMediaBinding(media.storageBinding), object: { key, sha256, size,
    mimeType: mimeType as ReadableMedia["object"]["mimeType"] }, fileName: media.fileName };
}

export function proposalMediaCleanupPayload(plan: MediaPlan) {
  return { schema: 1, kind: plan.kind === "UPLOAD_MEDIA" ? "UNATTACHED_MEDIA" : "UNATTACHED_PRODUCT_COPY",
    operationJobId: plan.jobId, mediaId: plan.mediaId, proposalId: plan.proposalId, projectId: plan.projectId,
    ...(plan.fileId ? { fileId: plan.fileId, storedName: plan.storedName } : {}), binding: plan.binding,
    objects: [...(plan.original ? [plan.original] : []), plan.optimized] };
}

async function jobById(tx: Tx, jobId: string): Promise<JobRow> {
  const [job] = await tx.$queryRaw<JobRow[]>`SELECT * FROM "ProposalJob" WHERE id = ${jobId} FOR UPDATE`;
  if (!job) throw new ProposalMediaError("KP_MEDIA_LEASE_LOST");
  return job;
}
export async function ownedMediaJob(tx: Tx, reservation: MediaReservation, now: Date): Promise<MediaPlan> {
  const job = await jobById(tx, reservation.plan.jobId), plan = validateMediaPlan(job.payload);
  const cleanup = await jobById(tx, plan.cleanupJobId);
  if (job.proposalId !== plan.proposalId || job.kind !== plan.kind || job.createdById !== plan.actorId ||
    plan.fingerprint !== reservation.plan.fingerprint || job.state !== "PROCESSING" ||
    job.leaseOwner !== reservation.leaseOwner || !job.leaseUntil || job.leaseUntil <= now ||
    ["PROCESSING", "SUCCEEDED"].includes(cleanup.state))
    throw new ProposalMediaError("KP_MEDIA_LEASE_LOST");
  return plan;
}

async function reserveJob(tx: Tx, input: MediaOperation, plan: MediaPlan, dedupeKey: string, now: Date) {
  const [existing] = await tx.$queryRaw<JobRow[]>`SELECT * FROM "ProposalJob" WHERE "dedupeKey" = ${dedupeKey} FOR UPDATE`;
  const leaseOwner = randomUUID(), leaseUntil = new Date(now.getTime() + KP_MEDIA_LEASE_MS);
  if (existing) {
    const prior = validateMediaPlan(existing.payload);
    if (existing.kind !== plan.kind || existing.proposalId !== input.proposalId || existing.createdById !== input.actorId ||
      prior.fingerprint !== plan.fingerprint) throw new ProposalMediaError("KP_MEDIA_OPERATION_CONFLICT");
    const cleanup = await jobById(tx, prior.cleanupJobId);
    if (["PROCESSING", "SUCCEEDED"].includes(cleanup.state)) throw new ProposalMediaError("KP_MEDIA_OPERATION_CONFLICT");
    if (existing.state === "SUCCEEDED") return { plan: prior, leaseOwner: "", repeated: true, ready: true };
    if (existing.state === "CANCELLED" || existing.attempts >= existing.maxAttempts ||
      existing.state === "PROCESSING" && existing.leaseUntil && existing.leaseUntil > now)
      throw new ProposalMediaError("KP_MEDIA_OPERATION_CONFLICT");
    await tx.$executeRaw`UPDATE "ProposalJob" SET state = 'PROCESSING', "leaseOwner" = ${leaseOwner},
      "leaseUntil" = ${leaseUntil}, attempts = attempts + 1, "lastErrorCode" = NULL, "updatedAt" = ${now} WHERE id = ${existing.id}`;
    return { plan: prior, leaseOwner, repeated: true, ready: false };
  }
  await tx.$executeRaw`INSERT INTO "ProposalJob" (id, "proposalId", kind, state, "dedupeKey", payload, attempts,
    "leaseOwner", "leaseUntil", "createdById", "createdAt", "updatedAt") VALUES (${plan.jobId}, ${input.proposalId},
    ${plan.kind}::"ProposalJobKind", 'PROCESSING', ${dedupeKey}, ${JSON.stringify(plan)}::jsonb, 1,
    ${leaseOwner}, ${leaseUntil}, ${input.actorId}, ${now}, ${now})`;
  await tx.$executeRaw`INSERT INTO "ProposalJob" (id, "proposalId", kind, "dedupeKey", payload, "availableAt", "createdById", "createdAt", "updatedAt")
    VALUES (${plan.cleanupJobId}, ${input.proposalId}, 'PURGE_MEDIA', ${"kp:media-cleanup:" + plan.jobId},
    ${JSON.stringify(proposalMediaCleanupPayload(plan))}::jsonb, ${new Date(now.getTime() + KP_MEDIA_ORPHAN_DELAY_MS)}, ${input.actorId}, ${now}, ${now})`;
  return { plan, leaseOwner, repeated: false, ready: false };
}

function operationDedupe(input: MediaOperation, kind: string, suffix = "") {
  return `kp:media:${input.actorId}:${input.operationId}:${kind}${suffix}`;
}

export function createPrismaProposalMediaRepository(db: Pick<PrismaClient, "$transaction">,
  options: { now?: () => Date } = {}): ProposalMediaRepository {
  const time = () => options.now?.() ?? new Date();
  return {
    reserveUpload: input => db.$transaction(async tx => {
      // Подтверждённый replay ничего не меняет и допустим после последующей смены этапа/ревизии.
      const readableOwner = await lockProposalMediaOwner(tx, { actorId: input.actorId, proposalId: input.proposalId }, false);
      const [completed] = await tx.$queryRaw<JobRow[]>`SELECT * FROM "ProposalJob" WHERE "dedupeKey" = ${operationDedupe(input, "upload")}
        AND state = 'SUCCEEDED'`;
      if (completed) {
        const prior = validateMediaPlan(completed.payload), requested = createMediaUploadPlan(readableOwner, input);
        if (completed.kind !== "UPLOAD_MEDIA" || completed.createdById !== input.actorId || completed.proposalId !== input.proposalId ||
          prior.fingerprint !== requested.fingerprint) throw new ProposalMediaError("KP_MEDIA_OPERATION_CONFLICT");
        await ownedProposalMedia(tx, prior.proposalId, prior.mediaId);
        return { plan: prior, leaseOwner: "", repeated: true, ready: true };
      }
      const now = time(), owner = await lockProposalMediaOwner(tx, input, true);
        const reservation = await reserveJob(tx, input, createMediaUploadPlan(owner, input), operationDedupe(input, "upload"), now);
      const plan = reservation.plan;
      if (!reservation.repeated) {
        if (!plan.original) throw new ProposalMediaError("KP_MEDIA_INVALID");
        await tx.$executeRaw`INSERT INTO "ProposalMedia" (id, "proposalId", "storageBinding", "originalKey", "optimizedKey",
          "originalHash", "optimizedHash", "originalSize", "optimizedSize", "mimeType", "optimizedMimeType", "fileName",
          width, height, "expiresAt", "uploadState", "uploadJobId", "createdAt") VALUES (${plan.mediaId}, ${plan.proposalId},
          ${JSON.stringify(plan.binding)}::jsonb, ${plan.original.key}, ${plan.optimized.key}, ${plan.original.sha256}, ${plan.optimized.sha256},
          ${plan.original.size}, ${plan.optimized.size}, ${plan.original.mimeType}, ${plan.optimized.mimeType}, ${plan.fileName},
          ${plan.width}, ${plan.height}, ${new Date(plan.expiresAt)}, 'PENDING', ${plan.jobId}, ${now})`;
      } else if (reservation.ready) await ownedProposalMedia(tx, plan.proposalId, plan.mediaId);
      return reservation;
    }),
    reserveCopy: input => db.$transaction(async tx => {
      const now = time(), owner = await lockProposalMediaOwner(tx, input, true);
      // Прежняя копия изделия сохраняет ID при возврате фотографии в состав КП.
      const [existingFile] = await tx.$queryRaw<{ id: string; payload: unknown }[]>`
        SELECT f.id, j.payload FROM "File" f JOIN "ProposalJob" j ON j.id = f."proposalMediaCopyJobId"
        JOIN "ProposalItem" i ON i.id = f."proposalSourceItemId" AND i."productId" = f."productId"
        WHERE f."projectId" = ${owner.projectId} AND j."proposalId" = ${input.proposalId} AND f."proposalSourceItemId" = ${input.itemId}
          AND f."proposalSourceMediaId" = ${input.mediaId} AND f."deletedAt" IS NULL AND j.result->>'storageAvailability' IS DISTINCT FROM 'UNAVAILABLE'
          AND j.result->>'storageAvailability' IS DISTINCT FROM 'UNVERIFIED'
        ORDER BY f."proposalMediaRetiredAt" NULLS FIRST, f."createdAt", f.id LIMIT 1`;
      if (existingFile) {
        const plan = validateMediaPlan(existingFile.payload);
        if (plan.kind !== "COPY_PRODUCT_MEDIA" || plan.fileId !== existingFile.id || !sameMediaBinding(plan.binding, input.binding))
          throw new ProposalMediaError("KP_MEDIA_STORAGE_CHANGED");
        return { existingFileId: existingFile.id };
      }
      const media = await ownedProposalMedia(tx, input.proposalId, input.mediaId), source = readableMedia(media, "optimized");
      if (!sameMediaBinding(source.binding, input.binding)) throw new ProposalMediaError("KP_MEDIA_STORAGE_CHANGED");
      const plan = createProductMediaCopyPlan(owner, input, { ...source, width: media.width ?? 1, height: media.height ?? 1 });
      return reserveJob(tx, input, plan, operationDedupe(input, "copy", `:${input.itemId}:${input.mediaId}`), now);
    }),
    assertActive: reservation => db.$transaction(async tx => {
      const now = time(); await lockProposalMediaOwner(tx, reservation.plan, true);
      const plan = await ownedMediaJob(tx, reservation, now);
      if (plan.kind === "COPY_PRODUCT_MEDIA") await ownedProposalMedia(tx, plan.proposalId, plan.mediaId);
    }),
    publishUpload: reservation => db.$transaction(async tx => {
      const now = time(); const owner=await lockProposalMediaOwner(tx, reservation.plan, true);
      const plan = await ownedMediaJob(tx, reservation, now);
      if (plan.kind !== "UPLOAD_MEDIA" || !plan.original) throw new ProposalMediaError("KP_MEDIA_INVALID");
      const changed = await tx.$executeRaw`UPDATE "ProposalMedia" SET "uploadState" = 'READY' WHERE id = ${plan.mediaId}
        AND "proposalId" = ${plan.proposalId} AND "uploadJobId" = ${plan.jobId} AND "uploadState" = 'PENDING'
        AND "retiringAt" IS NULL AND "originalKey" = ${plan.original.key} AND "optimizedKey" = ${plan.optimized.key}
        AND "originalHash" = ${plan.original.sha256} AND "optimizedHash" = ${plan.optimized.sha256}
        AND "originalSize" = ${plan.original.size} AND "optimizedSize" = ${plan.optimized.size}`;
      if (changed !== 1) throw new ProposalMediaError("KP_MEDIA_OPERATION_CONFLICT");
      await tx.$executeRaw`UPDATE "ProposalJob" SET state = 'SUCCEEDED', "leaseOwner" = NULL, "leaseUntil" = NULL,
        result = ${JSON.stringify({ mediaId: plan.mediaId, ready: true })}::jsonb, "updatedAt" = ${now} WHERE id = ${plan.jobId}`;
      await tx.$executeRaw`UPDATE "ProposalJob" SET state = 'CANCELLED', "leaseOwner" = NULL, "leaseUntil" = NULL, "updatedAt" = ${now}
        WHERE id = ${plan.cleanupJobId} AND state IN ('PENDING', 'FAILED')`;
      await writeChangeLogInTransaction(tx, { actorType: "user", actorId: plan.actorId, entity: "proposalMedia", entityId: plan.mediaId,
        action: "create", reversal: proposalMediaUploadReversal.command({
          proposalId: plan.proposalId, mediaId: plan.mediaId, jobId: plan.jobId, expectedDeletedAt: null, deleted: true,
        }), newValue: { proposalId: plan.proposalId, originalHash: plan.original.sha256, optimizedHash: plan.optimized.sha256 } },
        {...(owner.projectId?projectJournalContext({id:owner.projectId,number:owner.projectNumber}):{}),
          entity:{type:'proposalMedia',id:plan.mediaId,label:plan.fileName},actor:{type:'user',id:plan.actorId,name:owner.actorName??'Имя пользователя не сохранено'},
          before:null,after:{fileName:plan.fileName,mimeType:plan.original.mimeType,size:plan.original.size}});
    }),
    completeCopy: reservation => db.$transaction(async tx => {
      const now = time(); await lockProposalMediaOwner(tx, reservation.plan, true);
      const plan = await ownedMediaJob(tx, reservation, now);
      if (plan.kind !== "COPY_PRODUCT_MEDIA") throw new ProposalMediaError("KP_MEDIA_INVALID");
      await ownedProposalMedia(tx, plan.proposalId, plan.mediaId);
      await tx.$executeRaw`UPDATE "ProposalJob" SET state = 'SUCCEEDED', "leaseOwner" = NULL, "leaseUntil" = NULL,
        result = ${JSON.stringify({ fileId: plan.fileId, copyReady: true, attached: false })}::jsonb, "updatedAt" = ${now} WHERE id = ${plan.jobId}`;
    }),
    fail: (reservation, code) => db.$transaction(async tx => {
      await tx.$executeRaw`UPDATE "ProposalJob" SET state = 'FAILED', "leaseOwner" = NULL, "leaseUntil" = NULL,
        "lastErrorCode" = ${code.startsWith("KP_MEDIA_") ? code.slice(0, 80) : "KP_MEDIA_STORAGE_FAILED"}, "updatedAt" = ${time()}
        WHERE id = ${reservation.plan.jobId} AND state = 'PROCESSING' AND "leaseOwner" = ${reservation.leaseOwner}`;
    }),
    authorizeRead: input => db.$transaction(async tx => {
      const owner = await lockProposalMediaOwner(tx, input, false);
      const media = await ownedProposalMedia(tx, input.proposalId, input.mediaId);
      if (input.scope.kind === "uploaded") {
        if (!owner.projectId || owner.stage !== "LEAD") throw new ProposalMediaError("KP_MEDIA_NOT_FOUND");
        const [upload] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "ProposalJob" WHERE id = ${media.uploadJobId}
          AND "createdById" = ${input.actorId} AND "proposalId" = ${input.proposalId} AND kind = 'UPLOAD_MEDIA' AND state = 'SUCCEEDED'
          AND (EXISTS (SELECT 1 FROM "ProposalCurrentMedia" cm WHERE cm."proposalId" = ${input.proposalId}
                         AND cm."mediaId" = ${media.id} AND cm."detachedAt" IS NULL)
            OR (NOT EXISTS (SELECT 1 FROM "ProposalCurrentMedia" cm WHERE cm."proposalId" = ${input.proposalId} AND cm."mediaId" = ${media.id})
              AND NOT EXISTS (SELECT 1 FROM "ProposalVersionMedia" vm WHERE vm."proposalId" = ${input.proposalId} AND vm."mediaId" = ${media.id})
              AND NOT EXISTS (SELECT 1 FROM "File" f WHERE f."proposalSourceMediaId" = ${media.id})))`;
        if (!upload) throw new ProposalMediaError("KP_MEDIA_NOT_FOUND");
      } else {
        const references = input.scope.kind === "current"
          ? await tx.$queryRaw<{ mediaId: string }[]>`SELECT "mediaId" FROM "ProposalCurrentMedia" WHERE "proposalId" = ${input.proposalId} AND "mediaId" = ${input.mediaId} AND "detachedAt" IS NULL`
          : await tx.$queryRaw<{ mediaId: string }[]>`SELECT vm."mediaId" FROM "ProposalVersionMedia" vm JOIN "ProposalVersion" v ON v.id=vm."versionId"
              WHERE vm."proposalId" = ${input.proposalId} AND vm."mediaId" = ${input.mediaId}
                AND vm."versionId" = ${input.scope.versionId} AND v.trigger<>'EDIT'
                AND NOT EXISTS (SELECT 1 FROM "ProposalArtifact" a WHERE a.id=v."pdfArtifactId" AND a."deletedAt" IS NOT NULL)`;
        if (references.length !== 1) throw new ProposalMediaError("KP_MEDIA_NOT_FOUND");
      }
      return readableMedia(media, input.variant);
    }),
  };
}
