import { Prisma } from "@prisma/client";
import type { DomainActor } from "../actor";
import {
  lifecycleFailure, savedProposalClientSnapshot, type ActorBinding, type ArtifactRecord, type LifecycleJob, type LifecycleObject, type LifecyclePorts,
  type MediaRecord, type ProposalLifecycleStore, type ProposalRecord, type RenderJobClaim, type RestoreReceipt, type SourceRecord, type VersionRecord,
} from "./lifecycle-contract";
import { assertRenderJobClaim, completeRenderJob, freezeSources, publishSourcePdf, readProposalVersion, readProposalVersions, readRenderJob, readVersionPdf, recordPendingPdfArtifact, registerPendingArtifactCleanup, requestProposalPdf, restoreProposalVersion, type RestoreSave } from "./lifecycle";

export type LifecycleSecurity = { authorizeSource(tx: Prisma.TransactionClient, binding: ActorBinding): Promise<void> };
const proposalColumns = Prisma.sql`c."id",c."projectId",c."clientId",c."state",c."revision",c."currency"::text AS "currency",
  c."rate"::text AS "rate",c."rateDate"::text AS "rateDate",c."rateSource"::text AS "rateSource",c."deletedAt",c."acceptedVersionId",c."retentionEpoch"`;
const versionColumns = Prisma.sql`v."id",v."proposalId",v."revision",v."state",v."pricingSnapshot",v."renderSnapshot",v."pdfArtifactId",v."createdAt" AT TIME ZONE 'UTC' AS "createdAt"`;
const jobColumns = Prisma.sql`j."id",j."proposalId",j."contractId",j."createdById",j."kind"::text AS "kind",j."state"::text AS "state",j."dedupeKey",j."payload",j."result",j."attempts",j."maxAttempts",j."leaseOwner",j."lastErrorCode",j."leaseUntil" AT TIME ZONE 'UTC' AS "leaseUntil"`;

/** Все методы получают уже открытую mutation-транзакцию; ни renderer, ни S3 здесь не вызываются. */
export function createPrismaLifecycleStore(tx: Prisma.TransactionClient, security?: LifecycleSecurity): ProposalLifecycleStore {
  const one = async <T>(query: Prisma.Sql) => (await tx.$queryRaw<T[]>(query))[0] ?? null;
  const job = (id: string) => one<LifecycleJob>(Prisma.sql`SELECT ${jobColumns} FROM "ProposalJob" j WHERE j."id"=${id} FOR UPDATE`);
  return {
    async now() { const row = await one<{ at: Date }>(Prisma.sql`SELECT clock_timestamp() AS at`); if (!row) lifecycleFailure("KP_DATABASE_CLOCK_UNAVAILABLE", 503); return row.at; },
    async globalLock() { await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)`; },
    async authorize(binding) {
      const user = await one<{ id: string; name: string; roles: DomainActor["roles"]; active: boolean; sessionVersion: number }>(Prisma.sql`SELECT "id","name","roles","active","sessionVersion" FROM "User" WHERE "id"=${binding.id} FOR SHARE`);
      if (!user?.active || binding.sessionVersion !== undefined && user.sessionVersion !== binding.sessionVersion || binding.source === "api" && !binding.tokenId) lifecycleFailure("KP_ACTOR_REVOKED", 403, "Доступ к КП отозван");
      if (!security) lifecycleFailure("KP_SOURCE_AUTHORIZATION_REQUIRED", 503);
      await security.authorizeSource(tx, binding);
      return { id: user.id, name: user.name, roles: user.roles, source: binding.source };
    },
    async source(proposalId) {
      const link = await one<{ projectId: string | null }>(Prisma.sql`SELECT "projectId" FROM "CommercialProposal" WHERE "id"=${proposalId}`);
      if (!link) return null;
      let project: SourceRecord["project"] = null;
      if (link.projectId) project = await one<NonNullable<SourceRecord["project"]>>(Prisma.sql`SELECT "id","stage","deletedAt" FROM "Project" WHERE "id"=${link.projectId} FOR UPDATE`);
      const proposal = await one<ProposalRecord>(Prisma.sql`SELECT ${proposalColumns} FROM "CommercialProposal" c WHERE c."id"=${proposalId} FOR UPDATE`);
      if (!proposal || proposal.projectId !== link.projectId) lifecycleFailure("KP_SOURCE_BINDING_CHANGED");
      return { proposal, project, clientSnapshot: savedProposalClientSnapshot(proposal) };
    },
    proposalByProject(projectId) { return one<ProposalRecord>(Prisma.sql`SELECT ${proposalColumns} FROM "CommercialProposal" c WHERE c."projectId"=${projectId} FOR UPDATE`); },
    media(proposalId, scope) {
      const ownership = scope.kind === "current"
        ? Prisma.sql`EXISTS(SELECT 1 FROM "ProposalCurrentMedia" u WHERE u."proposalId"=m."proposalId" AND u."mediaId"=m."id")`
        : Prisma.sql`EXISTS(SELECT 1 FROM "ProposalVersionMedia" u WHERE u."proposalId"=m."proposalId" AND u."mediaId"=m."id" AND u."versionId"=${scope.versionId})`;
      return tx.$queryRaw<MediaRecord[]>(Prisma.sql`SELECT m."id",m."proposalId",m."storageBinding",m."optimizedKey",m."optimizedHash",m."optimizedSize",to_jsonb(m)->>'optimizedMimeType' AS "optimizedMimeType",m."mimeType",m."fileName",m."expiresAt" AT TIME ZONE 'UTC' AS "expiresAt",m."optimizedPurgedAt",m."retiringAt",to_jsonb(m)->>'uploadState' AS "uploadState" FROM "ProposalMedia" m WHERE m."proposalId"=${proposalId} AND ${ownership} ORDER BY m."id" FOR UPDATE OF m`);
    },
    version(proposalId, versionId) { return one<VersionRecord>(Prisma.sql`SELECT ${versionColumns} FROM "ProposalVersion" v WHERE v."proposalId"=${proposalId} AND v."id"=${versionId} FOR SHARE`); },
    versions(proposalId) { return tx.$queryRaw<VersionRecord[]>(Prisma.sql`SELECT ${versionColumns} FROM "ProposalVersion" v WHERE v."proposalId"=${proposalId} ORDER BY v."createdAt" DESC,v."id" DESC`); },
    currentReadyVersion(proposalId, revision) { return one<VersionRecord>(Prisma.sql`SELECT ${versionColumns} FROM "ProposalVersion" v JOIN "ProposalArtifact" a ON a."id"=v."pdfArtifactId" AND a."proposalId"=v."proposalId" WHERE v."proposalId"=${proposalId} AND v."revision"=${revision} AND a."state"='READY' AND a."kind"='PDF' ORDER BY v."createdAt" DESC,v."id" DESC LIMIT 1 FOR SHARE OF v,a`); },
    artifact(id) { return one<ArtifactRecord>(Prisma.sql`SELECT "id","proposalId","contractId","kind"::text AS kind,"state"::text AS state,"storageBinding","key","sha256","size","fileName","mimeType" FROM "ProposalArtifact" WHERE "id"=${id} FOR UPDATE`); },
    job,
    jobByDedupe(dedupeKey) { return one<LifecycleJob>(Prisma.sql`SELECT ${jobColumns} FROM "ProposalJob" j WHERE j."dedupeKey"=${dedupeKey} FOR UPDATE`); },
    async createJob(input) {
      await tx.$executeRaw`INSERT INTO "ProposalJob"("id","proposalId","kind","state","dedupeKey","payload","createdById","createdAt","updatedAt") VALUES(${input.id},${input.proposalId},'PDF','PENDING',${input.dedupeKey},${JSON.stringify(input.payload)}::jsonb,${input.actorId},clock_timestamp() AT TIME ZONE 'UTC',clock_timestamp() AT TIME ZONE 'UTC')`;
    },
    async createPendingArtifact(a) {
      await tx.$executeRaw`INSERT INTO "ProposalArtifact"("id","proposalId","contractId","kind","state","storageBinding","key","sha256","size","fileName","mimeType","createdAt") VALUES(${a.id},${a.proposalId},${a.contractId},${a.kind}::"ProposalArtifactKind",'PENDING',${JSON.stringify(a.storageBinding)}::jsonb,${a.key},${a.sha256},${a.size},${a.fileName},${a.mimeType},clock_timestamp() AT TIME ZONE 'UTC')`;
    },
    async enqueueOrphanArtifact(artifact, claim, proposalId) {
      const payload = { schema: 1, kind: "ORPHAN_ARTIFACT", proposalId, artifactId: artifact.id, operationJobId: claim.id, attempt: claim.attempt,
        binding: artifact.storageBinding, objects: [{ key: artifact.key, sha256: artifact.sha256, size: artifact.size, mimeType: artifact.mimeType }] };
      await tx.$executeRaw`INSERT INTO "ProposalJob"("id","proposalId","kind","state","dedupeKey","payload","availableAt","createdAt","updatedAt") VALUES(${`kp_orphan_${artifact.id}`},${proposalId},'PURGE_MEDIA','PENDING',${`kp:orphan-artifact:${artifact.id}`},${JSON.stringify(payload)}::jsonb,(clock_timestamp()+interval '24 hours') AT TIME ZONE 'UTC',clock_timestamp() AT TIME ZONE 'UTC',clock_timestamp() AT TIME ZONE 'UTC') ON CONFLICT("dedupeKey") DO NOTHING`;
    },
    async makeArtifactReady(id) {
      const count = await tx.$executeRaw`UPDATE "ProposalArtifact" SET "state"='READY' WHERE "id"=${id} AND "state"='PENDING'`;
      if (count !== 1) lifecycleFailure("KP_ARTIFACT_VERIFICATION_FAILED");
    },
    async createVersion(input) {
      await tx.$executeRaw`INSERT INTO "ProposalVersion"("id","proposalId","revision","trigger","state","pricingSnapshot","renderSnapshot","templateVersion","pdfArtifactId","createdById","createdAt") VALUES(${input.id},${input.proposalId},${input.revision},${input.trigger}::"ProposalVersionTrigger",${JSON.stringify(input.state)}::jsonb,${JSON.stringify(input.pricingSnapshot)}::jsonb,${JSON.stringify(input.renderSnapshot)}::jsonb,${String((input.renderSnapshot.template as LifecycleObject).templateHash)},${input.pdfArtifactId},${input.actorId},clock_timestamp() AT TIME ZONE 'UTC')`;
      const version = await one<VersionRecord>(Prisma.sql`SELECT ${versionColumns} FROM "ProposalVersion" v WHERE v."id"=${input.id}`);
      if (!version) lifecycleFailure("KP_VERSION_NOT_FOUND", 500);
      return version;
    },
    async linkVersionMedia(proposalId, versionId, mediaIds) {
      for (const mediaId of [...new Set(mediaIds)].sort()) await tx.$executeRaw`INSERT INTO "ProposalVersionMedia"("proposalId","versionId","mediaId") VALUES(${proposalId},${versionId},${mediaId})`;
    },
    async completeJob(claim, result) {
      const count = await tx.$executeRaw`UPDATE "ProposalJob" SET "state"='SUCCEEDED',"result"=${JSON.stringify(result)}::jsonb,"leaseOwner"=NULL,"leaseUntil"=NULL,"updatedAt"=clock_timestamp() AT TIME ZONE 'UTC' WHERE "id"=${claim.id} AND "kind"::text=${claim.kind} AND "state"='PROCESSING' AND "leaseOwner"=${claim.owner} AND "attempts"=${claim.attempt} AND "leaseUntil">clock_timestamp() AT TIME ZONE 'UTC'`;
      if (count !== 1) lifecycleFailure("KP_JOB_LEASE_LOST");
    },
    async accept(proposalId, versionId, at, epoch) {
      await tx.$executeRaw`UPDATE "CommercialProposal" SET "acceptedVersionId"=${versionId},"acceptedAt"=${at?.toISOString() ?? null}::timestamptz AT TIME ZONE 'UTC',"retentionEpoch"=${epoch},"updatedAt"=clock_timestamp() AT TIME ZONE 'UTC' WHERE "id"=${proposalId}`;
    },
    async cancelPruneJobs(proposalId) {
      await tx.$executeRaw`UPDATE "ProposalJob" SET "state"='CANCELLED',"leaseOwner"=NULL,"leaseUntil"=NULL,"updatedAt"=clock_timestamp() AT TIME ZONE 'UTC' WHERE "proposalId"=${proposalId} AND "kind"='PRUNE_VERSIONS' AND "state" IN ('PENDING','PROCESSING','FAILED')`;
    },
    async enqueuePrune(input) {
      const id = `kp_prune_${input.proposalId}_${input.epoch}`, dedupe = `kp:prune:${input.proposalId}:${input.epoch}`;
      await tx.$executeRaw`INSERT INTO "ProposalJob"("id","proposalId","kind","state","dedupeKey","payload","retentionEpoch","createdAt","updatedAt") VALUES(${id},${input.proposalId},'PRUNE_VERSIONS','PENDING',${dedupe},${JSON.stringify({ schema: 1, kind: "ACCEPTED_RETENTION", proposalId: input.proposalId, acceptedVersionId: input.versionId, retentionEpoch: input.epoch })}::jsonb,${input.epoch},clock_timestamp() AT TIME ZONE 'UTC',clock_timestamp() AT TIME ZONE 'UTC') ON CONFLICT("dedupeKey") DO NOTHING`;
    },
    async receipt(id, action = "version.restore") {
      const row = await tx.changeLog.findUnique({ where: { id } });
      if (!row) return null;
      const value = row.newValue;
      if (row.entity !== "commercialProposal" || row.action !== action || !value || Array.isArray(value) || typeof value !== "object" || typeof value.actorId !== "string" || row.actorId !== value.actorId || typeof value.fingerprint !== "string" || typeof value.proposalId !== "string" || typeof value.versionId !== "string" || typeof value.revision !== "number") lifecycleFailure("KP_OPERATION_REUSED");
      return value as RestoreReceipt;
    },
    async createReceipt(id, value, actor, action = "version.restore") {
      await tx.changeLog.create({ data: { id, actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source, entity: "commercialProposal", entityId: value.proposalId, action, newValue: value } });
    },
  };
}

export const freezeSourcesInTransaction = (tx: Prisma.TransactionClient, binding: ActorBinding, input: Parameters<typeof freezeSources>[2], ports: LifecyclePorts & LifecycleSecurity) => freezeSources(createPrismaLifecycleStore(tx, ports), binding, input, ports);
export const requestProposalPdfInTransaction = (tx: Prisma.TransactionClient, binding: ActorBinding, input: unknown, ports: LifecyclePorts & LifecycleSecurity) => requestProposalPdf(createPrismaLifecycleStore(tx, ports), binding, input, ports);
export const assertRenderJobClaimInTransaction = (tx: Prisma.TransactionClient, claim: RenderJobClaim, security: LifecycleSecurity) => assertRenderJobClaim(createPrismaLifecycleStore(tx, security), claim);
export const recordPendingPdfArtifactInTransaction = (tx: Prisma.TransactionClient, input: { claim: RenderJobClaim; proposalId: string; artifact: Parameters<typeof recordPendingPdfArtifact>[3] }, ports: LifecyclePorts & LifecycleSecurity) => recordPendingPdfArtifact(createPrismaLifecycleStore(tx, ports), input.claim, input.proposalId, input.artifact, ports);
export const publishSourcePdfInTransaction = (tx: Prisma.TransactionClient, input: Parameters<typeof publishSourcePdf>[1], ports: LifecyclePorts & LifecycleSecurity) => publishSourcePdf(createPrismaLifecycleStore(tx, ports), input, ports);
export const registerPendingArtifactCleanupInTransaction = (tx: Prisma.TransactionClient, input: { claim: RenderJobClaim; artifactId: string; proposalId: string }, security: LifecycleSecurity) => registerPendingArtifactCleanup(createPrismaLifecycleStore(tx, security), input.claim, input.artifactId, input.proposalId);
export const completeRenderJobInTransaction = (tx: Prisma.TransactionClient, claim: RenderJobClaim, result: LifecycleObject, security: LifecycleSecurity) => completeRenderJob(createPrismaLifecycleStore(tx, security), claim, result);
export const restoreProposalVersionInTransaction = (tx: Prisma.TransactionClient, binding: ActorBinding, input: unknown, ports: LifecyclePorts & LifecycleSecurity, save: RestoreSave) => restoreProposalVersion(createPrismaLifecycleStore(tx, ports), binding, input, ports, save);
export const readProposalVersionsInTransaction = (tx: Prisma.TransactionClient, binding: ActorBinding, proposalId: string, security: LifecycleSecurity) => readProposalVersions(createPrismaLifecycleStore(tx, security), binding, proposalId);
export const readProposalVersionInTransaction = (tx: Prisma.TransactionClient, binding: ActorBinding, proposalId: string, versionId: string, security: LifecycleSecurity) => readProposalVersion(createPrismaLifecycleStore(tx, security), binding, proposalId, versionId);
export const readVersionPdfInTransaction = (tx: Prisma.TransactionClient, binding: ActorBinding, proposalId: string, versionId: string, security: LifecycleSecurity) => readVersionPdf(createPrismaLifecycleStore(tx, security), binding, proposalId, versionId);
export const readRenderJobInTransaction = (tx: Prisma.TransactionClient, binding: ActorBinding, jobId: string, security: LifecycleSecurity) => readRenderJob(createPrismaLifecycleStore(tx, security), binding, jobId);
