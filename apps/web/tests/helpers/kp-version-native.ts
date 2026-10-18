import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { patchProjectStageTransaction } from "../../src/server/projects/stage-core";
import { ProposalLifecycleError, parseRenderJobPayload, type ActorBinding, type LifecyclePorts } from "../../src/server/kp/lifecycle-contract";
import { completeRenderJob, publishSourcePdf, recordPendingPdfArtifact, requestProposalPdf, restoreProposalVersion, type RestoreSave } from "../../src/server/kp/lifecycle";
import { createPrismaLifecycleStore, type LifecycleSecurity } from "../../src/server/kp/lifecycle-store";
import { createPrismaRenderQueue } from "../../src/server/kp/render-queue";
import { nativeSnapshot } from "./native-acceptance-snapshot";

/**
 * Только guarded rollback-транзакция существующей local5433, после нормальной интеграции №180–184.
 * Caller создаёт собственные User.name и CommercialProposal.sourceId = __qa185_<runId>.
 * Это приёмка SQL жизненного цикла: stand-in PDF не доказывает renderer/S3/визуальную приёмку.
 */
export async function verifyKpVersionNative(tx: Prisma.TransactionClient, input: {
  runId: string; proposalId: string; actor: ActorBinding; ports: LifecyclePorts & LifecycleSecurity; save: RestoreSave;
}) {
  assert.match(input.runId, /^[a-f0-9-]{36}$/i, "KP185_NATIVE_RUN_REQUIRED");
  assert.equal(input.actor.source, "web", "KP185_NATIVE_WEB_FIXTURE_ONLY");
  const marker = `__qa185_${input.runId}`;
  const owned = await tx.$queryRaw<{ sourceId: string | null; createdById: string | null; actorName: string }[]>`
    SELECT c."sourceId",c."createdById",u."name" AS "actorName" FROM "CommercialProposal" c JOIN "User" u ON u."id"=${input.actor.id} WHERE c."id"=${input.proposalId}`;
  assert.deepEqual(owned, [{ sourceId: marker, createdById: input.actor.id, actorName: marker }], "KP185_EXACT_OWNED_FIXTURES_REQUIRED");
  const store = createPrismaLifecycleStore(tx, input.ports), source = await store.source(input.proposalId);
  assert.ok(source?.project && source.project.stage === "LEAD" && !source.proposal.isArchive && !source.proposal.deletedAt, "KP185_OWNED_LEAD_REQUIRED");
  const projectId = source.project.id, revision = source.proposal.revision, operationId = randomUUID();
  const command = { proposalId: input.proposalId, expectedRevision: revision, operationId };
  const requested = await requestProposalPdf(store, input.actor, command, input.ports);
  assert.equal(requested.kind, "job"); if (requested.kind !== "job") throw Error("KP185_NATIVE_JOB_REQUIRED");
  const repeated = await requestProposalPdf(store, input.actor, command, input.ports);
  assert.equal(repeated.kind, "job"); assert.equal(repeated.replayed, true);
  const queue = createPrismaRenderQueue(async run => run(tx));
  const claim = await queue.claim(["PDF"], randomUUID(), 60000, requested.jobId);
  assert.ok(claim, "KP185_EXACT_JOB_CLAIM_REQUIRED");
  assert.equal(await queue.renew({ ...claim, owner: "not-the-owner" }, 60000), false);
  assert.equal(await queue.renew(claim, 60000), true);
  const job = await store.job(claim.id); assert.ok(job);
  const frozen = parseRenderJobPayload(job.payload).frozenSources[0];
  assert.equal(frozen.proposalId, input.proposalId); assert.equal(frozen.revision, revision);

  const pdf = Buffer.from("%PDF-1.7\nSQL acceptance fixture; never uploaded");
  const artifact = await recordPendingPdfArtifact(store, claim, input.proposalId, {
    storageBinding: { endpoint: "http://127.0.0.1:9000", bucket: "native-sql-only" }, sha256: createHash("sha256").update(pdf).digest("hex"), size: pdf.length,
  }, input.ports);
  const baseline = await nativeSnapshot(tx);
  await tx.$executeRawUnsafe("SAVEPOINT kp185_publication_fault");
  let rejected = false;
  try {
    await publishSourcePdf(store, { claim, proposalId: input.proposalId, artifactId: artifact.id, verified: artifact }, input.ports);
    await tx.$executeRaw`UPDATE "ProposalJob" SET "attempts"=-1 WHERE "id"=${claim.id}`;
  } catch (error) {
    if (typeof error === "object" && error !== null && "meta" in error && typeof error.meta === "object" && error.meta !== null && "code" in error.meta) rejected = error.meta.code === "23514";
  }
  finally { await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT kp185_publication_fault"); await tx.$executeRawUnsafe("RELEASE SAVEPOINT kp185_publication_fault"); }
  assert.equal(rejected, true, "KP185_NATIVE_SQL_FAILURE_REQUIRED");
  assert.deepEqual(await nativeSnapshot(tx), baseline, "KP185_PUBLICATION_REAL_SQL_ROLLBACK_REQUIRED");

  const version = await publishSourcePdf(store, { claim, proposalId: input.proposalId, artifactId: artifact.id, verified: artifact }, input.ports);
  await completeRenderJob(store, claim, { proposalId: input.proposalId, versionId: version.id, pdfArtifactId: artifact.id });
  assert.equal(await queue.completed(claim.id), true);
  assert.equal((await store.artifact(artifact.id))?.state, "READY");
  const actor = await store.authorize(input.actor);
  const toContract = { projectId, expectedStage: "LEAD", toStage: "CONTRACT", clientMutationId: randomUUID() };
  assert.equal((await patchProjectStageTransaction(actor, toContract, tx)).result.ok, true);
  assert.equal((await patchProjectStageTransaction(actor, toContract, tx)).result.replayed, true);
  const accepted = await store.proposalByProject(projectId); assert.equal(accepted?.acceptedVersionId, version.id);
  const frozenDownload = await requestProposalPdf(store, input.actor, { ...command, operationId: randomUUID() }, input.ports);
  assert.equal(frozenDownload.kind, "retained");
  assert.equal((await patchProjectStageTransaction(actor, { projectId, expectedStage: "CONTRACT", toStage: "IN_WORK", clientMutationId: randomUUID() }, tx)).result.ok, true);
  const cleanup = await tx.$queryRaw<{ id: string; retentionEpoch: number; state: string; payload: { kind: string; acceptedVersionId: string; retentionEpoch: number } }[]>`SELECT "id","retentionEpoch","state"::text AS state,"payload" FROM "ProposalJob" WHERE "proposalId"=${input.proposalId} AND "kind"='PRUNE_VERSIONS'`;
  assert.equal(cleanup.length, 1); assert.equal(cleanup[0].payload.kind, "ACCEPTED_RETENTION"); assert.equal(cleanup[0].payload.acceptedVersionId, version.id);
  assert.equal(cleanup[0].retentionEpoch, accepted?.retentionEpoch);
  assert.equal(await queue.claim(["PDF"], randomUUID(), 60000, cleanup[0].id), null, "KP185_RENDER_QUEUE_NEVER_STEALS_CLEANUP");
  assert.equal((await patchProjectStageTransaction(actor, { projectId, expectedStage: "IN_WORK", toStage: "LEAD", clientMutationId: randomUUID() }, tx)).result.ok, true);
  const reopened = await store.proposalByProject(projectId); assert.equal(reopened?.acceptedVersionId, null); assert.equal(reopened?.retentionEpoch, accepted!.retentionEpoch + 1);
  const cancelled = await tx.$queryRaw<{ state: string }[]>`SELECT "state"::text AS state FROM "ProposalJob" WHERE "id"=${cleanup[0].id}`;
  assert.deepEqual(cancelled, [{ state: "CANCELLED" }]);

  const changed = await input.save(actor, { proposalId: input.proposalId, expectedRevision: revision, operationId: randomUUID(), clientId: frozen.binding.clientId,
    state: { ...frozen.state, qaRestoreMarker: input.runId }, fx: { currency: frozen.currency, rate: frozen.rate, rateDate: frozen.rateDate, rateSource: frozen.rateSource } });
  assert.ok(changed.revision > revision, "KP185_FULL_SAVE_CHANGED_REVISION_REQUIRED");
  const restored = await restoreProposalVersion(store, input.actor, { proposalId: input.proposalId, versionId: version.id, expectedRevision: changed.revision, operationId: randomUUID() }, input.ports, input.save);
  assert.ok(restored.revision > changed.revision);
  assert.deepEqual((await store.source(input.proposalId))?.proposal.state, frozen.state, "KP185_FULL_SAVE_RESTORE_STATE_REQUIRED");
  const versionAfter = await store.version(input.proposalId, version.id); assert.deepEqual(versionAfter?.state, frozen.state);

  await tx.$executeRawUnsafe("SAVEPOINT kp185_revoked_actor");
  let revoked = false;
  try {
    await tx.$executeRaw`UPDATE "User" SET "active"=false WHERE "id"=${input.actor.id}`;
    await requestProposalPdf(store, input.actor, { proposalId: input.proposalId, expectedRevision: restored.revision, operationId: randomUUID() }, input.ports);
  } catch (error) { revoked = error instanceof ProposalLifecycleError && error.code === "KP_ACTOR_REVOKED"; }
  finally { await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT kp185_revoked_actor"); await tx.$executeRawUnsafe("RELEASE SAVEPOINT kp185_revoked_actor"); }
  assert.equal(revoked, true);
  return { exactOwnedFixtures: true, idempotency: true, actualLeaseSql: true, actualPublicationSqlRollback: true, readyVersion: true, stageReceiptPreserved: true,
    acceptanceAndEpoch: true, cleanupKindFence: true, frozenPdfReuse: true, full181Restore: true, revokedActor: true, rendererAndS3Accepted: false };
}
