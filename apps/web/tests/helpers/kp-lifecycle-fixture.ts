import { createHash } from "node:crypto";
import { ProposalLifecycleError, type ActorBinding, type ArtifactRecord, type LifecycleJob, type LifecycleObject, type LifecyclePorts,
  type MediaRecord, type ProposalLifecycleStore, type ProposalRecord, type RenderJobClaim, type RestoreReceipt, type VersionRecord } from "../../src/server/kp/lifecycle-contract";
import type { DomainActor } from "../../src/server/actor";
import type { RenderQueue } from "../../src/server/kp/render-queue";
import type { LifecycleTransaction, PdfWorkerIO } from "../../src/server/kp/render-worker";

/** DI-модель транзакции для проверки orchestration; не заменяет PostgreSQL/FK приёмку. */
export function lifecycleFixture() {
  const image = Buffer.from("synthetic optimized image");
  const binding: ActorBinding = { id: "manager1", source: "api", tokenId: "key1", sessionVersion: 0 };
  const template = { templateHash: "a".repeat(64), fontManifestHash: "b".repeat(64), sourceManifestHash: "c".repeat(64), chromium: "141.0.0", puppeteer: "24.43.1" };
  let state = {
    now: new Date("2026-10-18T10:00:00.000Z"), revoked: false, authorizations: 0, failLink: false,
    proposal: { id: "proposal1", projectId: "project1", clientId: "client1", state: { client: { crmId: "client1", crmSnapshot: { id: "client1", name: "Клиент А", phone: "" } }, items: [{ id: "item1", image: "kp-media:media1", title: "До изменения" }] }, revision: 1,
      currency: "USD", rate: "3.2500000000", rateDate: "2026-10-18", rateSource: "MANUAL", deletedAt: null, acceptedVersionId: null, retentionEpoch: 0 } as ProposalRecord,
    project: { id: "project1", stage: "LEAD" as const as "LEAD" | "ESTIMATE" | "CONTRACT" | "IN_WORK", deletedAt: null as Date | null },
    clients: new Map<string, LifecycleObject>([["client1", { name: "Клиент А", phone: "" }], ["client2", { name: "Клиент Б", phone: "" }]]),
    users: new Map<string, DomainActor>([["manager1", { id: "manager1", name: "Менеджер", roles: ["MANAGER"], source: "api" }], ["manager2", { id: "manager2", name: "Другой менеджер", roles: ["MANAGER"], source: "api" }]]),
    media: new Map<string, MediaRecord>([["media1", { id: "media1", proposalId: "proposal1", storageBinding: { endpoint: "http://127.0.0.1:9000", bucket: "test" }, optimizedKey: "kp/proposals/proposal1/optimized/media1.webp", optimizedHash: createHash("sha256").update(image).digest("hex"), optimizedSize: image.length,
      optimizedMimeType: "image/webp", mimeType: "image/png", fileName: "fixture.webp", expiresAt: new Date("2027-10-18T10:00:00.000Z"), optimizedPurgedAt: null, retiringAt: null, uploadState: "READY" }]]),
    currentMedia: new Set(["media1"]), versionMedia: new Map<string, string[]>(), jobs: new Map<string, LifecycleJob>(),
    artifacts: new Map<string, ArtifactRecord>(), versions: new Map<string, VersionRecord>(), receipts: new Map<string, RestoreReceipt>(),
    acceptedAt: null as Date | null, cleanup: [] as { proposalId: string; versionId: string; epoch: number; state: string }[], failures: [] as { code: string; terminal: boolean }[],
    orphans: [] as { artifactId: string; jobId: string; proposalId: string; attempt: number }[],
  };
  const copy = <T>(value: T): T => structuredClone(value);
  const store: ProposalLifecycleStore = {
    now: async () => copy(state.now), globalLock: async () => {},
    async authorize(actor) {
      state.authorizations++;
      const current = state.users.get(actor.id);
      if (state.revoked || !current || actor.tokenId === "revoked") throw new ProposalLifecycleError("KP_ACTOR_REVOKED", 403, "Доступ отозван");
      return copy({ ...current, source: actor.source });
    },
    source: async id => id === state.proposal.id ? copy({ proposal: state.proposal, project: state.proposal.projectId ? state.project : null, clientSnapshot: state.clients.get(state.proposal.clientId ?? "") ?? {} }) : null,
    proposalByProject: async id => id === state.proposal.projectId ? copy(state.proposal) : null,
    media: async (proposalId, scope) => [...state.media.values()].filter(row => row.proposalId === proposalId && (scope.kind === "current" ? state.currentMedia.has(row.id) : state.versionMedia.get(scope.versionId)?.includes(row.id))).map(copy),
    version: async (proposalId, versionId) => { const value = state.versions.get(versionId); return value?.proposalId === proposalId ? copy(value) : null; },
    versions: async proposalId => [...state.versions.values()].filter(row => row.proposalId === proposalId).map(copy),
    currentReadyVersion: async (proposalId, revision) => copy([...state.versions.values()].reverse().find(row => row.proposalId === proposalId && row.revision === revision && state.artifacts.get(row.pdfArtifactId ?? "")?.state === "READY") ?? null),
    artifact: async id => copy(state.artifacts.get(id) ?? null),
    jobByDedupe: async key => copy([...state.jobs.values()].find(row => row.dedupeKey === key) ?? null),
    job: async id => copy(state.jobs.get(id) ?? null),
    async createJob(input) { state.jobs.set(input.id, { id: input.id, proposalId: input.proposalId, contractId: null, createdById: input.actorId, kind: "PDF", state: "PENDING", dedupeKey: input.dedupeKey, payload: JSON.parse(JSON.stringify(input.payload)), result: null, attempts: 0, maxAttempts: 5, leaseOwner: null, leaseUntil: null }); },
    async createPendingArtifact(row) { state.artifacts.set(row.id, copy(row)); },
    async enqueueOrphanArtifact(artifact, claim, proposalId) { state.orphans.push({ artifactId: artifact.id, jobId: claim.id, proposalId, attempt: claim.attempt }); },
    async makeArtifactReady(id) { const row = state.artifacts.get(id); if (!row || row.state !== "PENDING") throw Error("fixture-artifact"); row.state = "READY"; },
    async createVersion(input) {
      const row: VersionRecord = { id: input.id, proposalId: input.proposalId, revision: input.revision, state: copy(input.state), pricingSnapshot: copy(input.pricingSnapshot), renderSnapshot: copy(input.renderSnapshot), pdfArtifactId: input.pdfArtifactId, createdAt: copy(state.now) };
      state.versions.set(row.id, row); return copy(row);
    },
    async linkVersionMedia(_proposalId, versionId, ids) { if (state.failLink) throw Error("fixture-last-write"); state.versionMedia.set(versionId, [...ids]); },
    async completeJob(claim, result) { const row = state.jobs.get(claim.id); if (!row || row.leaseOwner !== claim.owner || row.attempts !== claim.attempt) throw Error("fixture-lease"); Object.assign(row, { state: "SUCCEEDED", result: copy(result), leaseOwner: null, leaseUntil: null }); },
    async accept(proposalId, versionId, at, epoch) { if (proposalId !== state.proposal.id) throw Error("fixture-owner"); Object.assign(state.proposal, { acceptedVersionId: versionId, retentionEpoch: epoch }); state.acceptedAt = at; },
    async cancelPruneJobs() { for (const job of state.cleanup) if (job.state !== "SUCCEEDED") job.state = "CANCELLED"; },
    async enqueuePrune(input) { if (!state.cleanup.some(row => row.proposalId === input.proposalId && row.epoch === input.epoch)) state.cleanup.push({ ...input, state: "PENDING" }); },
    receipt: async id => copy(state.receipts.get(id) ?? null), createReceipt: async (id, value) => { state.receipts.set(id, copy(value)); },
  };
  const transaction: LifecycleTransaction = async run => {
    const before = copy(state);
    try { return await run(store); } catch (error) { state = before; throw error; }
  };
  const ports: LifecyclePorts = {
    enabled: true, templateIdentity: () => template,
    pricingSnapshot: proposal => ({ currency: proposal.currency, rate: proposal.rate, totalBeforeDiscount: "246.90", totalAfterDiscount: "222.21" }),
    mediaIds: proposalState => proposalState.items.flatMap(item => [item.image, item.image2].filter((value): value is string => typeof value === "string" && value.length > 0).map(value => value.replace(/^kp-media:/, ""))),
  };
  const owned = (claim: RenderJobClaim) => { const row = state.jobs.get(claim.id); return row?.state === "PROCESSING" && row.leaseOwner === claim.owner && row.attempts === claim.attempt && !!row.leaseUntil && row.leaseUntil > state.now; };
  const queue: RenderQueue = {
    async claim(kinds, owner, leaseMs) {
      const row = [...state.jobs.values()].find(job => job.state === "PENDING" && kinds.some(kind => kind === job.kind));
      if (!row) return null;
      row.state = "PROCESSING"; row.leaseOwner = owner; row.attempts++; row.leaseUntil = new Date(state.now.getTime() + leaseMs);
      return { id: row.id, owner, attempt: row.attempts, kind: row.kind as "PDF" | "CONTRACT" };
    },
    async renew(claim, leaseMs) { if (!owned(claim)) return false; state.jobs.get(claim.id)!.leaseUntil = new Date(state.now.getTime() + leaseMs); return true; },
    async fail(claim, input) { if (!owned(claim)) return false; const row = state.jobs.get(claim.id)!; Object.assign(row, { state: input.terminal ? "CANCELLED" : "PENDING", leaseOwner: null, leaseUntil: null }); state.failures.push(input); return true; },
    completed: async id => state.jobs.get(id)?.state === "SUCCEEDED",
  };
  const uploaded = new Map<string, Uint8Array>();
  const io: PdfWorkerIO = {
    storageBinding: () => ({ endpoint: "http://127.0.0.1:9000", bucket: "test" }),
    loadAssets: async source => source.media.map(media => ({ mediaId: media.id, mimeType: media.mimeType, bytesBase64: image.toString("base64") })),
    render: async input => ({ bytes: Buffer.from("%PDF-1.7\nsynthetic only"), templateHash: input.templateHash }),
    async upload(artifact, bytes) { if (!(bytes instanceof Uint8Array)) throw Error("BUFFER_FIXTURE_ONLY"); uploaded.set(artifact.id, copy(bytes)); },
    async verify(artifact) { const bytes = uploaded.get(artifact.id); if (!bytes) throw Error("fixture-upload-missing"); return { id: artifact.id, storageBinding: artifact.storageBinding, key: artifact.key, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }; },
  };
  return { get state() { return state; }, store, transaction, ports, binding, queue, io, uploaded };
}
