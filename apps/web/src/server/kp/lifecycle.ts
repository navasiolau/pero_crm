import { randomUUID } from "node:crypto";
import { proposalPdfFileName } from "./pdf-filename";
import { MANAGER_ROLES, hasAnyRole } from "../../lib/roles";
import type { ProjectStage } from "@prisma/client";
import type { DomainActor } from "../actor";
import {
  lifecycleClone, lifecycleFailure, lifecycleFingerprint, parseRenderJobPayload, pdfRequestSchema, restoreRequestSchema, pendingArtifactKey, savedProposalClientSnapshot,
  type ActorBinding, type ArtifactRecord, type FrozenMedia, type FrozenProposalSource, type LifecycleJson, type LifecycleObject, type LifecycleState,
  type LifecyclePorts, type MediaRecord, type ProposalLifecycleStore, type ProposalRecord, type RenderJobClaim,
  type RenderJobPayload, type SourceRecord, type VerifiedArtifact, type VersionRecord,
} from "./lifecycle-contract";

const json = (value: unknown): LifecycleJson => JSON.parse(JSON.stringify(value)) as LifecycleJson;
async function actorFor(store: ProposalLifecycleStore, binding: ActorBinding) {
  const actor = await store.authorize(binding);
  if (!hasAnyRole(actor.roles, MANAGER_ROLES)) lifecycleFailure("KP_FORBIDDEN", 403, "Недостаточно прав для КП");
  return actor;
}
type LiveSource = SourceRecord & { project: NonNullable<SourceRecord["project"]> };
function liveSource(source: SourceRecord | null): LiveSource {
  if (!source || !source.project || source.proposal.deletedAt || source.project.deletedAt || source.proposal.isArchive) lifecycleFailure("KP_NOT_FOUND", 404, "КП не найдено");
  return source as LiveSource;
}
function mutable(source: LiveSource) {
  if (source.project.stage !== "LEAD") lifecycleFailure("KP_PROPOSAL_LOCKED", 409, "Редактирование КП доступно только в Лиде");
}
function freezeMedia(row: MediaRecord, proposalId: string, now: Date): FrozenMedia {
  if (row.proposalId !== proposalId || row.uploadState !== "READY" || row.retiringAt || row.optimizedPurgedAt || row.expiresAt <= now || !row.optimizedKey || !row.optimizedHash || !row.optimizedSize) lifecycleFailure("KP_MEDIA_UNAVAILABLE", 410, "Изображение версии удалено или недоступно");
  return { id: row.id, binding: lifecycleClone(row.storageBinding), key: row.optimizedKey, sha256: row.optimizedHash, size: row.optimizedSize, mimeType: row.optimizedMimeType ?? row.mimeType, fileName: row.fileName };
}
async function mediaSnapshot(store: ProposalLifecycleStore, proposal: ProposalRecord, ports: LifecyclePorts, scope: { kind: "current" } | { kind: "version"; versionId: string }) {
  const ids = [...new Set(ports.mediaIds(proposal.state))].sort();
  const rows = await store.media(proposal.id, scope), now = await store.now();
  return ids.map(id => {
    const row = rows.find(media => media.id === id);
    if (!row) lifecycleFailure("KP_MEDIA_UNAVAILABLE", 410, "Изображение версии удалено или недоступно");
    return freezeMedia(row, proposal.id, now);
  });
}
function versionSource(version: VersionRecord, source: LiveSource): FrozenProposalSource {
  const snapshot = version.renderSnapshot;
  // Старый архив без полного binding доступен для скачивания, но не для восстановления/нового рендера.
  const candidate = {
    ...snapshot, proposalId: source.proposal.id, projectId: source.project.id, projectStage: source.project.stage,
    revision: version.revision, state: version.state, pricingSnapshot: version.pricingSnapshot, mode: "retained",
    retainedVersionId: version.id, retainedPdfArtifactId: version.pdfArtifactId,
  };
  try {
    return parseRenderJobPayload({ schema: 1, actor: { id: "snapshot", source: "web" }, requestFingerprint: "0".repeat(64), frozenSources: [candidate], extra: {} }).frozenSources[0];
  } catch { return lifecycleFailure("KP_VERSION_BINDING_UNAVAILABLE", 410, "В этой версии отсутствует полный снимок привязок"); }
}
function savedRenderSnapshot(source: FrozenProposalSource): LifecycleObject {
  return json({ binding: source.binding, currency: source.currency, rate: source.rate, rateDate: source.rateDate, rateSource: source.rateSource,
    media: source.media, template: source.template }) as LifecycleObject;
}
async function readyPdf(store: ProposalLifecycleStore, proposalId: string, version: VersionRecord | null) {
  if (!version || version.proposalId !== proposalId || !version.pdfArtifactId) lifecycleFailure("KP_RELEASE_REQUIRED", 409, "Сначала сгенерируйте PDF актуальной редакции КП");
  const artifact = await store.artifact(version.pdfArtifactId);
  if (!artifact || artifact.proposalId !== proposalId || artifact.kind !== "PDF" || artifact.state !== "READY") lifecycleFailure("KP_PDF_UNAVAILABLE", 410, "PDF версии недоступен");
  return { version, artifact };
}

/** DB-only; вызывается в общей транзакции до renderer/S3. Состояние от вызывающего транспорта не принимается. */
export async function freezeSources(store: ProposalLifecycleStore, binding: ActorBinding, inputs: readonly { proposalId: string; expectedRevision: number }[], ports: LifecyclePorts): Promise<FrozenProposalSource[]> {
  if (!ports.enabled) lifecycleFailure("KP_DISABLED", 503, "Раздел КП пока выключен");
  if (!inputs.length || new Set(inputs.map(value => value.proposalId)).size !== inputs.length) lifecycleFailure("KP_SOURCE_LIST_INVALID", 400);
  await store.globalLock();
  await actorFor(store, binding);
  const result: FrozenProposalSource[] = [];
  const template = lifecycleClone(json(ports.templateIdentity())) as unknown as FrozenProposalSource["template"];
  for (const input of [...inputs].sort((a, b) => a.proposalId.localeCompare(b.proposalId))) {
    const source = liveSource(await store.source(input.proposalId)), proposal = source.proposal;
    if (proposal.revision !== input.expectedRevision) lifecycleFailure("KP_REVISION_CHANGED");
    if (source.project.stage !== "LEAD") {
      const retained = await readyPdf(store, proposal.id, proposal.acceptedVersionId ? await store.version(proposal.id, proposal.acceptedVersionId) : null);
      if (retained.version.revision !== proposal.revision) lifecycleFailure("KP_REVISION_CHANGED");
      result.push(versionSource(retained.version, source));
      continue;
    }
    result.push({
      proposalId: proposal.id, projectId: source.project.id, projectStage: source.project.stage, revision: proposal.revision,
      state: lifecycleClone(proposal.state), pricingSnapshot: lifecycleClone(await ports.pricingSnapshot(proposal)),
      binding: { clientId: proposal.clientId, clientSnapshot: savedProposalClientSnapshot(proposal), projectId: source.project.id },
      currency: proposal.currency, rate: proposal.rate, rateDate: proposal.rateDate, rateSource: proposal.rateSource,
      media: await mediaSnapshot(store, proposal, ports, { kind: "current" }), template, mode: "render",
    });
  }
  // Прогоняем полный серверный снимок через тот же контракт, что читает worker после рестарта.
  return parseRenderJobPayload({ schema: 1, actor: binding, requestFingerprint: "0".repeat(64), frozenSources: result, extra: {} }).frozenSources;
}

export async function requestProposalPdf(store: ProposalLifecycleStore, binding: ActorBinding, input: unknown, ports: LifecyclePorts) {
  const parsed = pdfRequestSchema.safeParse(input);
  if (!parsed.success) lifecycleFailure("KP_PDF_REQUEST_INVALID", 400, "Нужны сохранённая ревизия КП и UUID операции");
  if (!ports.enabled) lifecycleFailure("KP_DISABLED", 503, "Раздел КП пока выключен");
  await store.globalLock();
  const actor = await actorFor(store, binding);
  const command = parsed.data, fingerprint = lifecycleFingerprint({ ...command, kind: "PDF", actorId: actor.id, source: binding.source });
  const dedupeKey = `kp:render:${command.operationId}`;
  const previous = await store.jobByDedupe(dedupeKey);
  if (previous) {
    const payload = parseRenderJobPayload(previous.payload);
    if (previous.kind !== "PDF" || payload.actor.id !== actor.id || payload.actor.source !== binding.source || payload.requestFingerprint !== fingerprint) lifecycleFailure("KP_OPERATION_REUSED", 409, "UUID операции уже использован");
    return { kind: "job" as const, jobId: previous.id, state: previous.state, result: previous.result, replayed: true };
  }
  const retainedReceiptId = `kp.render:${command.operationId}`, retainedReceipt = await store.receipt(retainedReceiptId, "pdf.retained");
  if (retainedReceipt) {
    if (retainedReceipt.actorId !== actor.id || retainedReceipt.fingerprint !== fingerprint) lifecycleFailure("KP_OPERATION_REUSED");
    const retained = await readyPdf(store, retainedReceipt.proposalId, await store.version(retainedReceipt.proposalId, retainedReceipt.versionId));
    return { kind: "retained" as const, versionId: retained.version.id, artifact: retained.artifact, replayed: true };
  }
  const current = liveSource(await store.source(command.proposalId));
  if (current.proposal.revision !== command.expectedRevision) lifecycleFailure("KP_REVISION_CHANGED");
  if (current.project.stage !== "LEAD") {
    const retained = await readyPdf(store, current.proposal.id, current.proposal.acceptedVersionId ? await store.version(current.proposal.id, current.proposal.acceptedVersionId) : null);
    await store.createReceipt(retainedReceiptId, { actorId: actor.id, fingerprint, proposalId: current.proposal.id, versionId: retained.version.id, revision: retained.version.revision }, actor, "pdf.retained");
    return { kind: "retained" as const, versionId: retained.version.id, artifact: retained.artifact, replayed: false };
  }
  const sources = await freezeSources(store, binding, [command], ports);
  const payload: RenderJobPayload = { schema: 1, actor: { ...binding }, requestFingerprint: fingerprint, frozenSources: sources, extra: {} };
  const id = randomUUID();
  await store.createJob({ id, proposalId: command.proposalId, dedupeKey, payload, actorId: actor.id });
  return { kind: "job" as const, jobId: id, state: "PENDING", result: null, replayed: false };
}

export async function assertRenderJobClaim(store: ProposalLifecycleStore, claim: RenderJobClaim) {
  await store.globalLock();
  const job = await store.job(claim.id), now = await store.now();
  if (!job || job.state !== "PROCESSING" || job.kind !== claim.kind || job.attempts !== claim.attempt || job.leaseOwner !== claim.owner || !job.leaseUntil || job.leaseUntil <= now) lifecycleFailure("KP_JOB_LEASE_LOST");
  const payload = parseRenderJobPayload(job.payload);
  if (job.createdById !== payload.actor.id) lifecycleFailure("KP_JOB_ACTOR_MISMATCH");
  if (job.kind === "PDF" && (job.contractId !== null || payload.frozenSources.length !== 1 || job.proposalId !== payload.frozenSources[0].proposalId) || job.kind === "CONTRACT" && (job.proposalId !== null || !job.contractId || payload.extra.contractId !== job.contractId)) lifecycleFailure("KP_JOB_SOURCE_MISMATCH");
  const actor = await actorFor(store, payload.actor);
  return { job, payload, actor };
}
async function currentRenderedSource(store: ProposalLifecycleStore, source: FrozenProposalSource, ports: LifecyclePorts) {
  const current = liveSource(await store.source(source.proposalId));
  mutable(current);
  const proposal = current.proposal;
  if (source.mode !== "render" || proposal.projectId !== source.projectId || proposal.clientId !== source.binding.clientId || proposal.revision !== source.revision || lifecycleFingerprint(proposal.state) !== lifecycleFingerprint(source.state) || proposal.currency !== source.currency || proposal.rate !== source.rate || proposal.rateDate !== source.rateDate || proposal.rateSource !== source.rateSource) lifecycleFailure("KP_REVISION_CHANGED");
  const media = await mediaSnapshot(store, proposal, ports, { kind: "current" });
  if (lifecycleFingerprint(json(media)) !== lifecycleFingerprint(json(source.media))) lifecycleFailure("KP_MEDIA_UNAVAILABLE", 410, "Изображения КП изменились");
}

/** PENDING ledger предшествует upload; каждая попытка получает отдельный ключ, защищённый от позднего writer. */
export async function recordPendingPdfArtifact(store: ProposalLifecycleStore, claim: RenderJobClaim, proposalId: string, bytes: { storageBinding: LifecycleObject; sha256: string; size: number }, ports: LifecyclePorts) {
  const { payload } = await assertRenderJobClaim(store, claim);
  const source = payload.frozenSources.find(value => value.proposalId === proposalId);
  if (!source) lifecycleFailure("KP_JOB_SOURCE_MISMATCH");
  await currentRenderedSource(store, source, ports);
  if (!/^[a-f0-9]{64}$/.test(bytes.sha256) || !Number.isSafeInteger(bytes.size) || bytes.size <= 0 || !/^[A-Za-z0-9_-]+$/.test(proposalId) || !/^[A-Za-z0-9_-]+$/.test(claim.id)) lifecycleFailure("KP_ARTIFACT_INVALID", 400);
  const id = randomUUID();
  const artifact: ArtifactRecord = { id, proposalId, contractId: null, kind: "PDF", state: "PENDING", storageBinding: lifecycleClone(bytes.storageBinding),
    key: pendingArtifactKey(claim, { kind: "PDF", id: proposalId }, id), sha256: bytes.sha256, size: bytes.size, fileName: proposalPdfFileName(source.state), mimeType: "application/pdf" };
  await store.createPendingArtifact(artifact);
  await registerPendingArtifactCleanup(store, claim, artifact.id, proposalId);
  return artifact;
}

/** Точный orphan intent создаётся до upload; исполнитель №188 повторно доказывает отсутствие опубликованных ссылок. */
export async function registerPendingArtifactCleanup(store: ProposalLifecycleStore, claim: RenderJobClaim, artifactId: string, proposalId: string) {
  const { job, payload } = await assertRenderJobClaim(store, claim);
  const artifact = await store.artifact(artifactId);
  if (!artifact || artifact.state !== "PENDING" || !payload.frozenSources.some(source => source.proposalId === proposalId)) lifecycleFailure("KP_ARTIFACT_VERIFICATION_FAILED");
  const owner = artifact.kind === "PDF" && artifact.proposalId === proposalId ? { kind: "PDF" as const, id: proposalId }
    : artifact.kind === "DOCX" && claim.kind === "CONTRACT" && artifact.contractId === job.contractId && job.contractId ? { kind: "DOCX" as const, id: job.contractId } : null;
  if (!owner || artifact.key !== pendingArtifactKey(claim, owner, artifact.id)) lifecycleFailure("KP_ARTIFACT_VERIFICATION_FAILED");
  await store.enqueueOrphanArtifact(artifact, claim, proposalId);
}

/** Не завершает job: №186 публикует все PDF/DOCX и переходы в одной внешней транзакции. */
export async function publishSourcePdf(store: ProposalLifecycleStore, input: { claim: RenderJobClaim; proposalId: string; artifactId: string; verified: VerifiedArtifact }, ports: LifecyclePorts) {
  const { payload, actor } = await assertRenderJobClaim(store, input.claim);
  const source = payload.frozenSources.find(value => value.proposalId === input.proposalId);
  if (!source) lifecycleFailure("KP_JOB_SOURCE_MISMATCH");
  await currentRenderedSource(store, source, ports);
  const artifact = await store.artifact(input.artifactId);
  if (!artifact || artifact.proposalId !== source.proposalId || artifact.kind !== "PDF" || artifact.key !== pendingArtifactKey(input.claim, { kind: "PDF", id: source.proposalId }, artifact.id) || artifact.id !== input.verified.id || artifact.key !== input.verified.key || artifact.sha256 !== input.verified.sha256 || artifact.size !== input.verified.size || lifecycleFingerprint(artifact.storageBinding) !== lifecycleFingerprint(input.verified.storageBinding)) lifecycleFailure("KP_ARTIFACT_VERIFICATION_FAILED");
  const versionId = "kpv_" + lifecycleFingerprint({ jobId: input.claim.id, proposalId: source.proposalId });
  const previous = await store.version(source.proposalId, versionId);
  if (previous) {
    if (previous.pdfArtifactId !== artifact.id || artifact.state !== "READY") lifecycleFailure("KP_ARTIFACT_VERIFICATION_FAILED");
    return previous;
  }
  if (artifact.state !== "PENDING") lifecycleFailure("KP_ARTIFACT_VERIFICATION_FAILED");
  await store.makeArtifactReady(artifact.id);
  const version = await store.createVersion({ id: versionId, proposalId: source.proposalId, revision: source.revision, state: source.state,
    pricingSnapshot: source.pricingSnapshot, renderSnapshot: savedRenderSnapshot(source), pdfArtifactId: artifact.id, trigger: input.claim.kind, actorId: actor.id });
  await store.linkVersionMedia(source.proposalId, version.id, source.media.map(media => media.id));
  return version;
}
export async function completeRenderJob(store: ProposalLifecycleStore, claim: RenderJobClaim, result: LifecycleObject) {
  await assertRenderJobClaim(store, claim);
  await store.completeJob(claim, result);
}

/** Вызывать под Project lock; бизнес-инвариант работает и при выключенном UI/worker. */
export async function applyProposalStageGate(store: ProposalLifecycleStore, input: { projectId: string; fromStage: ProjectStage; toStage: ProjectStage; at: Date }) {
  const proposal = await store.proposalByProject(input.projectId);
  if (!proposal || proposal.isArchive || proposal.deletedAt || input.fromStage === input.toStage) return;
  let acceptedVersionId = proposal.acceptedVersionId, epoch = proposal.retentionEpoch;
  if (input.toStage === "LEAD") {
    await store.accept(proposal.id, null, null, epoch + 1);
    await store.cancelPruneJobs(proposal.id);
    return;
  }
  if (input.fromStage === "LEAD") {
    const retained = await readyPdf(store, proposal.id, await store.currentReadyVersion(proposal.id, proposal.revision));
    acceptedVersionId = retained.version.id;
    epoch++;
  }
  if (input.toStage === "IN_WORK") {
    if (!acceptedVersionId) lifecycleFailure("KP_RELEASE_REQUIRED", 409, "Сначала выпустите и примите актуальное КП");
    const retained = await readyPdf(store, proposal.id, await store.version(proposal.id, acceptedVersionId));
    if (retained.version.revision !== proposal.revision) lifecycleFailure("KP_REVISION_CHANGED");
  }
  if (input.fromStage === "LEAD") await store.accept(proposal.id, acceptedVersionId, input.at, epoch);
  if (input.toStage === "IN_WORK" && acceptedVersionId) await store.enqueuePrune({ proposalId: proposal.id, versionId: acceptedVersionId, epoch, at: input.at });
}

async function authorizeRead(store: ProposalLifecycleStore, binding: ActorBinding, proposalId: string) {
  await store.globalLock(); await actorFor(store, binding);
  const source = await store.source(proposalId);
  if (!source || source.proposal.deletedAt || source.project?.deletedAt) lifecycleFailure("KP_NOT_FOUND", 404);
}
export async function readProposalVersions(store: ProposalLifecycleStore, binding: ActorBinding, proposalId: string) {
  await authorizeRead(store, binding, proposalId);
  return (await store.versions(proposalId)).map(version => ({ id: version.id, proposalId: version.proposalId, revision: version.revision, createdAt: version.createdAt, pdfArtifactId: version.pdfArtifactId }));
}
export async function readProposalVersion(store: ProposalLifecycleStore, binding: ActorBinding, proposalId: string, versionId: string) {
  await authorizeRead(store, binding, proposalId);
  const version = await store.version(proposalId, versionId);
  if (!version) lifecycleFailure("KP_VERSION_NOT_FOUND", 404);
  return version;
}
export async function readVersionPdf(store: ProposalLifecycleStore, binding: ActorBinding, proposalId: string, versionId: string) {
  return readyPdf(store, proposalId, await readProposalVersion(store, binding, proposalId, versionId));
}
export async function readRenderJob(store: ProposalLifecycleStore, binding: ActorBinding, jobId: string) {
  await store.globalLock(); await actorFor(store, binding);
  const job = await store.job(jobId);
  if (!job || job.kind !== "PDF" && job.kind !== "CONTRACT") lifecycleFailure("KP_JOB_NOT_FOUND", 404);
  const payload = parseRenderJobPayload(job.payload);
  for (const source of payload.frozenSources) await authorizeRead(store, binding, source.proposalId);
  return { id: job.id, kind: job.kind, state: job.state, attempts: job.attempts, maxAttempts: job.maxAttempts,
    result: job.state === "SUCCEEDED" ? job.result : null, errorCode: job.lastErrorCode && /^[A-Z][A-Z0-9_]{1,100}$/.test(job.lastErrorCode) ? job.lastErrorCode : null };
}
export type RestoreSave = (actor: DomainActor, input: { proposalId: string; expectedRevision: number; operationId: string; clientId: string | null; state: LifecycleState; fx: { currency: string; rate: string | null; rateDate: string | null; rateSource: string | null } }) => Promise<{ revision: number }>;

/** save обязан быть обёрткой №181 с обязательным pricing hook и синхронизацией медиа в той же tx. */
export async function restoreProposalVersion(store: ProposalLifecycleStore, binding: ActorBinding, input: unknown, ports: LifecyclePorts, save: RestoreSave) {
  if (!ports.enabled) lifecycleFailure("KP_DISABLED", 503);
  const parsed = restoreRequestSchema.safeParse(input);
  if (!parsed.success) lifecycleFailure("KP_RESTORE_REQUEST_INVALID", 400);
  await store.globalLock(); const actor = await actorFor(store, binding), command = parsed.data;
  const fingerprint = lifecycleFingerprint({ ...command, actorId: actor.id, source: binding.source });
  const receiptId = `kp.restore:${command.operationId}`, previous = await store.receipt(receiptId);
  if (previous) {
    if (previous.actorId !== actor.id || previous.fingerprint !== fingerprint) lifecycleFailure("KP_OPERATION_REUSED");
    return { proposalId: previous.proposalId, versionId: previous.versionId, revision: previous.revision, replayed: true };
  }
  const source = liveSource(await store.source(command.proposalId)); mutable(source);
  if (source.proposal.revision !== command.expectedRevision) lifecycleFailure("KP_REVISION_CHANGED");
  const version = await store.version(command.proposalId, command.versionId);
  if (!version) lifecycleFailure("KP_VERSION_NOT_FOUND", 404);
  const historic = versionSource(version, source);
  const restoredProposal = { ...source.proposal, state: historic.state };
  const media = await mediaSnapshot(store, restoredProposal, ports, { kind: "version", versionId: version.id });
  if (lifecycleFingerprint(json(media)) !== lifecycleFingerprint(json(historic.media))) lifecycleFailure("KP_MEDIA_UNAVAILABLE", 410);
  const result = await save(actor, { proposalId: source.proposal.id, expectedRevision: source.proposal.revision, operationId: command.operationId,
    clientId: historic.binding.clientId, state: historic.state,
    fx: { currency: historic.currency, rate: historic.rate, rateDate: historic.rateDate, rateSource: historic.rateSource } });
  const receipt = { actorId: actor.id, fingerprint, proposalId: source.proposal.id, versionId: version.id, revision: result.revision };
  await store.createReceipt(receiptId, receipt, actor);
  return { proposalId: receipt.proposalId, versionId: receipt.versionId, revision: result.revision, replayed: false };
}
