import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { lockProjectRow } from "@/server/projects/lock";
import { lockFileStorageBinding } from "@/server/files/storage-binding-fence";
import { persistFileDeleteIntent } from "@/server/files/delete-intent";
import { RetentionError, parseRetentionProgress, retentionAnniversary, retentionHash, retentionPayload,mergeRetentionProgress,
  type RetentionClaim, type RetentionPayload, type RetentionProgress, type RetentionTarget } from "./retention-contract";
import { planProposalRetention,shouldScheduleAcceptanceCleanup } from "./retention-policy";
import { proposalRetentionSnapshot } from "./retention-snapshot";
import type { RetentionRepository } from "./retention-executor";

type Tx = Prisma.TransactionClient;
type Row = { id: string; proposalId: string; kind: string; state: string; payload: unknown; result: unknown;
  attempts: number; maxAttempts: number; leaseOwner: string | null; leaseUntil: Date | null; createdById: string | null;retentionEpoch:number|null };
const serialize = (value: unknown) => JSON.stringify(value);
const active = (row: Row, claim: RetentionClaim, now: Date) => row.state === "PROCESSING" && row.leaseOwner === claim.owner &&
  row.attempts === claim.attempt && !!row.leaseUntil && row.leaseUntil > now;

async function lockOwner(tx: Tx, proposalId: string) {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)`;
  const [owner] = await tx.$queryRaw<{ projectId: string | null }[]>`SELECT "projectId" FROM "CommercialProposal" WHERE id = ${proposalId}`;
  if (!owner) throw new RetentionError("KP_RETENTION_OWNER_MISSING");
  if (owner.projectId) await lockProjectRow(tx, owner.projectId);
  await tx.$queryRaw`SELECT id FROM "CommercialProposal" WHERE id = ${proposalId} FOR UPDATE`;
}
async function rowById(tx: Tx, id: string) {
  const [row] = await tx.$queryRaw<Row[]>`SELECT *,kind::text,state::text FROM "ProposalJob" WHERE id = ${id} FOR UPDATE`;
  if (!row) throw new RetentionError("KP_RETENTION_LEASE_LOST"); return row;
}
async function locked(tx: Tx, claim: RetentionClaim, now: Date, requireLease = true) {
  await lockOwner(tx, claim.proposalId); const row = await rowById(tx, claim.id);
  if (row.proposalId !== claim.proposalId || !["PURGE_MEDIA", "PRUNE_VERSIONS"].includes(row.kind)) throw new RetentionError("KP_RETENTION_OWNER_MISMATCH");
  if (requireLease && !active(row, claim, now)) throw new RetentionError(row.state === "CANCELLED" ? "KP_RETENTION_CANCELLED" : "KP_RETENTION_LEASE_LOST");
  const payload = retentionPayload(row.payload);
  if (payload.proposalId !== claim.proposalId || (row.kind === "PRUNE_VERSIONS") !== (payload.kind === "ACCEPTED_RETENTION"))
    throw new RetentionError("KP_RETENTION_OWNER_MISMATCH");
  if(payload.kind==='ACCEPTED_RETENTION'&&row.retentionEpoch!==payload.retentionEpoch)throw new RetentionError('KP_RETENTION_EPOCH_MISMATCH');
  return { row, payload, progress: parseRetentionProgress(claim.proposalId, row.result) };
}
async function saveProgress(tx: Tx, id: string, progress: RetentionProgress, now: Date) {
  await tx.$executeRaw`UPDATE "ProposalJob" SET result = ${serialize(progress)}::jsonb, "updatedAt" = ${now} WHERE id = ${id}`;
}
function targetIn(progress: RetentionProgress | null, target: RetentionTarget) {
  if (!progress || !progress.manifest.targets.some(candidate => candidate.id === target.id && retentionHash(candidate) === retentionHash(target)))
    throw new RetentionError("KP_RETENTION_MANIFEST_CHANGED");
  return progress;
}
async function authoritative(tx: Tx, claim: RetentionClaim, payload: RetentionPayload, progress: RetentionProgress | null,
  target: RetentionTarget | undefined, now: Date) {
  if (payload.kind === "CANCELLED_PROBE") {
    const source = await rowById(tx, payload.sourceJobId), sourceProgress = parseRetentionProgress(claim.proposalId, source.result);
    if (source.proposalId !== claim.proposalId || source.state !== "CANCELLED" || !sourceProgress || sourceProgress.manifest.fingerprint !== payload.manifestFingerprint)
      throw new RetentionError("KP_RETENTION_PROBE_CHANGED");
    if (target) targetIn(sourceProgress, target); return;
  }
  const snapshot = await proposalRetentionSnapshot(tx, claim.proposalId), fresh = planProposalRetention(snapshot, payload, now);
  if (target && !progress?.objects[target.id]?.absentAt && !fresh.targets.some(candidate => candidate.id === target.id && retentionHash(candidate) === retentionHash(target)))
    throw new RetentionError("KP_RETENTION_REFERENCED", true);
  if (target?.entity === "PRODUCT_COPY") {
    await lockFileStorageBinding(tx, target.projectId!, target.storedName!);
    await tx.$queryRaw`SELECT id FROM "File" WHERE id = ${target.entityId} FOR UPDATE`;
  }
}
async function markRetiring(tx: Tx, target: RetentionTarget, now: Date) {
  if (target.entity === "MEDIA" && target.variant === "optimized") await tx.$executeRaw`UPDATE "ProposalMedia" SET "retiringAt" = COALESCE("retiringAt",${now}) WHERE id = ${target.entityId}`;
  if (target.entity === "ARTIFACT") await tx.$executeRaw`UPDATE "ProposalArtifact" SET state = 'RETIRING' WHERE id = ${target.entityId} AND state <> 'DELETED'`;
}

/** Никакая фабрика не открывает соединение/таймер и не запускает очистку при import. */
export function createPrismaRetentionRepository(db: Pick<PrismaClient, "$transaction">, options: { now?: () => Date; leaseMs?: number } = {}): RetentionRepository {
  const time = () => options.now?.() ?? new Date(), leaseMs = options.leaseMs ?? 120_000;
  const run = <T>(action: (tx: Tx) => Promise<T>) => db.$transaction(action, { maxWait: 10_000, timeout: 30_000 });
  return {
    claim: (owner, duration, jobId) => run(async tx => {
      if (!owner || !Number.isSafeInteger(duration) || duration < 60_000 || duration > 300_000) throw new RetentionError("KP_RETENTION_CLAIM_INVALID");
      const now = time(); await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)`;
      const [candidate] = await tx.$queryRaw<{ id: string; proposalId: string }[]>(Prisma.sql`SELECT j.id,j."proposalId" FROM "ProposalJob" j
        WHERE j.kind::text IN ('PURGE_MEDIA','PRUNE_VERSIONS') ${jobId ? Prisma.sql`AND j.id=${jobId}` : Prisma.empty}
          AND ((j.state='PENDING' AND j."availableAt"<=${now}) OR (j.state='PROCESSING' AND j."leaseUntil"<=${now}))
          AND NOT EXISTS(SELECT 1 FROM "ProposalJob" other WHERE other.id<>j.id AND other."proposalId"=j."proposalId" AND other.kind::text IN ('PURGE_MEDIA','PRUNE_VERSIONS') AND other.state='PROCESSING' AND other."leaseUntil">${now})
        ORDER BY j."availableAt",j."createdAt",j.id LIMIT 1`);
      if (!candidate) return null;
      await lockOwner(tx, candidate.proposalId); const row = await rowById(tx, candidate.id);
      if (row.state === "CANCELLED" || row.state === "SUCCEEDED" || row.state === "FAILED" || row.state === "PROCESSING" && row.leaseUntil && row.leaseUntil > now) return null;
      if(row.attempts>=row.maxAttempts){
        await tx.$executeRaw`UPDATE "ProposalJob" SET state='FAILED',"leaseOwner"=NULL,"leaseUntil"=NULL,"lastErrorCode"='KP_RETENTION_ATTEMPTS_EXHAUSTED',"updatedAt"=${now} WHERE id=${row.id}`;
        return null;
      }
      await tx.$executeRaw`UPDATE "ProposalJob" SET state='PROCESSING',attempts=attempts+1,"leaseOwner"=${owner},"leaseUntil"=${new Date(now.getTime()+duration)},"updatedAt"=${now} WHERE id=${row.id}`;
      return { id: row.id, proposalId: row.proposalId, owner, attempt: row.attempts + 1 };
    }),
    prepare: claim => run(async tx => {
      const now = time(), context = await locked(tx, claim, now); await authoritative(tx, claim, context.payload, context.progress, undefined, now);
      if (context.progress) {
        if(context.payload.kind==='CANCELLED_PROBE'){
          const source=await rowById(tx,context.payload.sourceJobId),late=parseRetentionProgress(claim.proposalId,source.result);
          if(!late)throw new RetentionError('KP_RETENTION_PROBE_CHANGED');
          mergeRetentionProgress(context.progress,late);await saveProgress(tx,claim.id,context.progress,now);
        }
        return { payload: context.payload, progress: context.progress };
      }
      let progress: RetentionProgress;
      if (context.payload.kind === "CANCELLED_PROBE") {
        const source = await rowById(tx, context.payload.sourceJobId); const recorded = parseRetentionProgress(claim.proposalId, source.result);
        if (!recorded) throw new RetentionError("KP_RETENTION_PROBE_CHANGED");
        progress = structuredClone(recorded);
      } else {
        const manifest = planProposalRetention(await proposalRetentionSnapshot(tx, claim.proposalId), context.payload, now);
        progress = { manifest, objects: Object.fromEntries(manifest.targets.map(target => [target.id, { versions: [] }])) };
        for (const target of manifest.targets) await markRetiring(tx, target, now);
        // Отменяем возобновление уже закрытых pending uploads, чьи точные ключи входят в cleanup.
        for (const mediaId of new Set(manifest.targets.filter(target => target.entity === "MEDIA").map(target => target.entityId)))
          await tx.$executeRaw`UPDATE "ProposalJob" j SET state='CANCELLED',"leaseOwner"=NULL,"leaseUntil"=NULL,"updatedAt"=${now}
            FROM "ProposalMedia" m WHERE m.id=${mediaId} AND m."uploadState"='PENDING' AND j.id=m."uploadJobId" AND j.state<>'PROCESSING'`;
      }
      await saveProgress(tx, claim.id, progress, now); return { payload: context.payload, progress };
    }),
    guard: (claim, target) => run(async tx => {
      const now = time(), context = await locked(tx, claim, now);
      if (target) targetIn(context.progress, target);
      await authoritative(tx, claim, context.payload, context.progress, target, now);
      await tx.$executeRaw`UPDATE "ProposalJob" SET "leaseUntil"=${new Date(now.getTime()+leaseMs)},"updatedAt"=${now} WHERE id=${claim.id}`;
    }),
    discover: (claim, target, versions) => run(async tx => {
      const now = time(), context = await locked(tx, claim, now), progress = targetIn(context.progress, target);
      await authoritative(tx, claim, context.payload, progress, target, now);
      const current = progress.objects[target.id] ??= { versions: [] };
      for (const version of versions) if (!current.versions.some(value => value.id === version.id)) current.versions.push({ ...version, phase: "DISCOVERED" });
      if (current.versions.length > 1000) throw new RetentionError("KP_RETENTION_VERSION_LIMIT");
      await saveProgress(tx, claim.id, progress, now); return current.versions;
    }),
    deleteIntent: (claim, target, version) => run(async tx => {
      const now = time(), context = await locked(tx, claim, now), progress = targetIn(context.progress, target);
      if (context.payload.kind === "CANCELLED_PROBE") throw new RetentionError("KP_RETENTION_PROBE_READ_ONLY");
      await authoritative(tx, claim, context.payload, progress, target, now);
      const current = progress.objects[target.id]?.versions.find(value => value.id === version.id);
      if (!current) throw new RetentionError("KP_RETENTION_VERSION_UNTRACKED");
      if (current.phase !== "DELETED") current.phase = "INTENT";
      await saveProgress(tx, claim.id, progress, now);
    }),
    deleted: (claim, target, version) => run(async tx => {
      const now = time(), context = await locked(tx, claim, now, false), progress = targetIn(context.progress, target);
      const current = progress.objects[target.id]?.versions.find(value => value.id === version.id);
      if (!current) throw new RetentionError("KP_RETENTION_VERSION_UNTRACKED");
      current.phase = "DELETED"; await saveProgress(tx, claim.id, progress, now);
    }),
    absent: (claim, target, proof) => run(async tx => {
      const now = time(), context = await locked(tx, claim, now, false), progress = targetIn(context.progress, target);
      if (!proof.listedEmpty || !proof.headMissing || !Number.isFinite(new Date(proof.at).getTime())) throw new RetentionError("KP_RETENTION_ABSENCE_PROOF_INVALID");
      progress.objects[target.id] ??= { versions: [] }; progress.objects[target.id].absentAt = proof.at;
      if (target.entity === "MEDIA") {
        const column = target.variant === "original" ? Prisma.sql`"originalPurgedAt"` : Prisma.sql`"optimizedPurgedAt"`;
        const key = target.variant === "original" ? Prisma.sql`"originalKey"` : Prisma.sql`"optimizedKey"`;
        const hash = target.variant === "original" ? Prisma.sql`"originalHash"` : Prisma.sql`"optimizedHash"`;
        const size = target.variant === "original" ? Prisma.sql`"originalSize"` : Prisma.sql`"optimizedSize"`;
        const count = await tx.$executeRaw(Prisma.sql`UPDATE "ProposalMedia" SET ${column}=COALESCE(${column},${new Date(proof.at)}) WHERE id=${target.entityId} AND "proposalId"=${claim.proposalId} AND ${key}=${target.key} AND ${hash}=${target.sha256} AND ${size}=${target.size} AND "storageBinding"=${serialize(target.binding)}::jsonb`);
        if (count !== 1) throw new RetentionError("KP_RETENTION_OBJECT_FACTS_CHANGED");
      } else if (target.entity === "ARTIFACT") {
        const count = await tx.$executeRaw`UPDATE "ProposalArtifact" SET state='DELETED',"deletedAt"=COALESCE("deletedAt",${new Date(proof.at)})
          WHERE id=${target.entityId} AND key=${target.key} AND sha256=${target.sha256} AND size=${target.size} AND "storageBinding"=${serialize(target.binding)}::jsonb`;
        if (count !== 1) throw new RetentionError("KP_RETENTION_OBJECT_FACTS_CHANGED");
      } else {
        await lockFileStorageBinding(tx, target.projectId!, target.storedName!);
        const snapshot = await proposalRetentionSnapshot(tx, claim.proposalId), file = snapshot.files.find(value => value.id === target.entityId);
        if (file) {
          if (!file.retiredAt || file.copyJobId !== target.operationJobId || file.coverReferences || file.aliases || file.pendingDelete)
            throw new RetentionError("KP_RETENTION_REFERENCED", true);
          await tx.file.delete({ where: { id: file.id } });
          const intent = await persistFileDeleteIntent(tx, { id: "kp-retention", name: "Очистка КП" },
            { ...file, taskId: null }, randomUUID(), { mode: "s3", endpoint: target.binding.endpoint, bucket: target.binding.bucket });
          const receipt = await tx.changeLog.findUniqueOrThrow({ where: { id: intent.eventId } });
          await tx.changeLog.update({ where: { id: intent.eventId }, data: { actorType:"system", newValue: { ...(receipt.newValue as Prisma.InputJsonObject),
            physicalRetentionJobId: claim.id, binding: target.binding, keys: [target.key], absenceProof: proof } } });
          await tx.domainEvent.update({ where: { id: intent.eventId }, data: { processedAt: now } });
        }
        await tx.$executeRaw`UPDATE "ProposalJob" SET state='CANCELLED',"leaseOwner"=NULL,"leaseUntil"=NULL,"updatedAt"=${now}
          WHERE id=${target.operationJobId} AND kind::text='COPY_PRODUCT_MEDIA'`;
      }
      await tx.changeLog.create({ data: { actorType: "system", actorId: "kp-retention", entity: target.entity === "MEDIA" ? "proposalMedia" : target.entity === "ARTIFACT" ? "proposalArtifact" : "file",
        entityId: target.entityId, action: "physical-purge", newValue: { retentionJobId: claim.id, key: target.key, sha256: target.sha256, absenceProof: proof } } });
      await saveProgress(tx, claim.id, progress, now);
    }),
    release: (claim, target, available) => run(async tx => {
      const now = time(), context = await locked(tx, claim, now), progress = targetIn(context.progress, target);
      if (context.payload.kind !== "CANCELLED_PROBE") throw new RetentionError("KP_RETENTION_PROBE_READ_ONLY");
      await authoritative(tx, claim, context.payload, progress, target, now);
      if (available && target.entity === "MEDIA" && target.variant === "optimized") {
        const [other] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "ProposalJob" WHERE id<>${claim.id} AND id<>${context.payload.sourceJobId}
          AND "proposalId"=${claim.proposalId} AND state IN ('PENDING','PROCESSING','FAILED') AND result->'manifest'->'targets' @> ${serialize([{ id: target.id }])}::jsonb LIMIT 1`;
        if (!other) await tx.$executeRaw`UPDATE "ProposalMedia" SET "retiringAt"=NULL WHERE id=${target.entityId} AND "optimizedPurgedAt" IS NULL`;
      }
      if (available && target.entity === "ARTIFACT") await tx.$executeRaw`UPDATE "ProposalArtifact" SET state='READY' WHERE id=${target.entityId} AND state='RETIRING' AND "deletedAt" IS NULL`;
      progress.objects[target.id] ??= { versions: [] };progress.objects[target.id].lastProbeAt=now.toISOString();
      if(available)progress.objects[target.id].releasedAt = now.toISOString();
      else delete progress.objects[target.id].releasedAt;
      await saveProgress(tx, claim.id, progress, now);
    }),
    finish: claim => run(async tx => {
      const now = time(), context = await locked(tx, claim, now), progress = context.progress;
      if (!progress || progress.manifest.targets.some(target => !progress.objects[target.id]?.absentAt && !progress.objects[target.id]?.releasedAt))
        throw new RetentionError(context.payload.kind==='CANCELLED_PROBE'?'KP_RETENTION_PROBE_UNRESOLVED':'KP_RETENTION_INCOMPLETE',context.payload.kind==='CANCELLED_PROBE');
      await authoritative(tx, claim, context.payload, progress, undefined, now);
      if (context.payload.kind === "ACCEPTED_RETENTION") for (const versionId of progress.manifest.pruneVersionIds) {
        if (versionId === context.payload.acceptedVersionId) throw new RetentionError("KP_RETENTION_ACCEPTED_VERSION_INVALID");
        await tx.$executeRaw`DELETE FROM "ProposalVersion" WHERE id=${versionId} AND "proposalId"=${claim.proposalId}`;
      }
      if (context.payload.kind === "CANCELLED_PROBE") {
        const source = await rowById(tx, context.payload.sourceJobId), old = parseRetentionProgress(claim.proposalId, source.result);
        if (old) { old.reconciledAt = now.toISOString(); await saveProgress(tx, source.id, old, now); }
      }
      await tx.$executeRaw`UPDATE "ProposalJob" SET state='SUCCEEDED',"leaseOwner"=NULL,"leaseUntil"=NULL,"updatedAt"=${now} WHERE id=${claim.id}`;
    }),
    fail: (claim, error) => run(async tx => {
      const now = time(), context = await locked(tx, claim, now, false);
      if (!active(context.row, claim, now)) return;
      const cancelled = error.code === "KP_RETENTION_CANCELLED", blocked = ['KP_RETENTION_REFERENCED','KP_RETENTION_NOT_DUE','KP_RETENTION_PROBE_UNRESOLVED'].includes(error.code);
      const retry = error.retryable && (blocked || context.row.attempts < context.row.maxAttempts);
      const wait = blocked ? 60_000 : Math.min(3_600_000, 15_000 * 2 ** Math.max(0, context.row.attempts - 1));
      await tx.$executeRaw`UPDATE "ProposalJob" SET state=${cancelled ? "CANCELLED" : retry ? "PENDING" : "FAILED"}::"ProposalJobState",
        "leaseOwner"=NULL,"leaseUntil"=NULL,"lastErrorCode"=${error.code},"availableAt"=${new Date(now.getTime()+wait)},
        attempts=CASE WHEN ${blocked} THEN greatest(0,attempts-1) ELSE attempts END,"updatedAt"=${now} WHERE id=${claim.id}`;
    }),
    scheduleDue: (limit, annual = true) => run(async tx => {
      const now = time(); let count = 0;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new RetentionError("KP_RETENTION_BATCH_INVALID");
      const cancelled = await tx.$queryRaw<{ id: string; proposalId: string; result: unknown; updatedAt: Date }[]>`SELECT id,"proposalId",result,"updatedAt" FROM "ProposalJob"
        WHERE kind='PRUNE_VERSIONS' AND state='CANCELLED' AND result->'manifest' IS NOT NULL AND result->>'reconciledAt' IS NULL ORDER BY "updatedAt" LIMIT ${limit}`;
      for (const source of cancelled) {
        const progress = parseRetentionProgress(source.proposalId, source.result); if (!progress) continue;
        const payload = { schema: 1, kind: "CANCELLED_PROBE", proposalId: source.proposalId, sourceJobId: source.id, manifestFingerprint: progress.manifest.fingerprint };
        // Уже начатый S3-request ограничен 45 секундами; read-only probe ждёт его завершения.
        const availableAt = new Date(Math.max(now.getTime(),source.updatedAt.getTime()+60_000));
        count += await tx.$executeRaw`INSERT INTO "ProposalJob" (id,"proposalId",kind,"dedupeKey",payload,"availableAt","createdAt","updatedAt") VALUES
          (${randomUUID()},${source.proposalId},'PURGE_MEDIA',${"kp:retention-probe:"+source.id+":"+progress.manifest.fingerprint},${serialize(payload)}::jsonb,${availableAt},${now},${now}) ON CONFLICT("dedupeKey") DO NOTHING`;
      }
      if (annual) {
        const due = await tx.$queryRaw<{ id: string; createdAt: Date }[]>`SELECT cp.id,cp."createdAt" FROM "CommercialProposal" cp
          WHERE cp."createdAt"<=${new Date(now.getTime()-364*24*60*60_000)} AND EXISTS(SELECT 1 FROM "ProposalMedia" m WHERE m."proposalId"=cp.id
            AND ((m."originalKey" IS NOT NULL AND m."originalPurgedAt" IS NULL) OR (m."optimizedKey" IS NOT NULL AND m."optimizedPurgedAt" IS NULL))) ORDER BY cp."createdAt",cp.id LIMIT ${limit}`;
        for (const proposal of due) {
          const expiry = retentionAnniversary(proposal.createdAt); if (expiry > now) continue;
          const payload = { schema: 1, kind: "ANNUAL_MEDIA", proposalId: proposal.id, expiresAt: expiry.toISOString() };
          count += await tx.$executeRaw`INSERT INTO "ProposalJob" (id,"proposalId",kind,"dedupeKey",payload,"createdAt","updatedAt") VALUES
            (${randomUUID()},${proposal.id},'PURGE_MEDIA',${"kp:annual-media:"+proposal.id+":"+expiry.toISOString()},${serialize(payload)}::jsonb,${now},${now}) ON CONFLICT("dedupeKey") DO NOTHING`;
        }
        // Поздние генерации после первоначальной IN_WORK-приёмки также не создают вечный архив лишних КП PDF.
        const accepted = await tx.$queryRaw<{ id: string }[]>`SELECT cp.id FROM "CommercialProposal" cp JOIN "Project" p ON p.id=cp."projectId"
          WHERE p.stage<>'LEAD' AND cp."acceptedVersionId" IS NOT NULL
            AND(p.stage='IN_WORK' OR EXISTS(SELECT 1 FROM "ProjectStageHistory" h WHERE h."projectId"=p.id AND h."toStage"='IN_WORK' AND h."createdAt">=cp."acceptedAt")
              OR EXISTS(SELECT 1 FROM "ProposalJob" prior WHERE prior."proposalId"=cp.id AND prior.kind='PRUNE_VERSIONS' AND prior."retentionEpoch"=cp."retentionEpoch" AND prior.payload->>'acceptedVersionId'=cp."acceptedVersionId"))
            AND NOT EXISTS(SELECT 1 FROM "ProposalJob" j WHERE j."proposalId"=cp.id
            AND j.kind='PRUNE_VERSIONS' AND j."retentionEpoch"=cp."retentionEpoch" AND j.state IN ('PENDING','PROCESSING','FAILED'))
            AND (EXISTS(SELECT 1 FROM "ProposalVersion" v WHERE v."proposalId"=cp.id AND v.id<>cp."acceptedVersionId") OR EXISTS(SELECT 1 FROM "ProposalMedia" m WHERE m."proposalId"=cp.id AND m."originalKey" IS NOT NULL AND m."originalPurgedAt" IS NULL)) ORDER BY cp.id LIMIT ${limit}`;
        for (const candidate of accepted) {
          await lockOwner(tx,candidate.id); const snapshot = await proposalRetentionSnapshot(tx,candidate.id), proposal = snapshot.proposal;
          if (!shouldScheduleAcceptanceCleanup(snapshot)||!proposal.acceptedVersionId) continue;
          const payload: RetentionPayload = {schema:1,kind:'ACCEPTED_RETENTION',proposalId:proposal.id,acceptedVersionId:proposal.acceptedVersionId,retentionEpoch:proposal.epoch};
          let plan: ReturnType<typeof planProposalRetention>;
          try { plan=planProposalRetention(snapshot,payload,now); } catch(error) { if(error instanceof RetentionError&&error.retryable)continue; throw error; }
          if (!plan.targets.length&&!plan.pruneVersionIds.length) continue;
          count += await tx.$executeRaw`INSERT INTO "ProposalJob"(id,"proposalId",kind,"dedupeKey",payload,"retentionEpoch","createdAt","updatedAt") VALUES
            (${randomUUID()},${proposal.id},'PRUNE_VERSIONS',${"kp:prune-sweep:"+proposal.id+":"+proposal.epoch+":"+plan.fingerprint},${serialize(payload)}::jsonb,${proposal.epoch},${now},${now}) ON CONFLICT("dedupeKey") DO NOTHING`;
        }
      }
      return count;
    }),
  };
}
