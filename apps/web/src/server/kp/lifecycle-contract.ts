import { createHash } from "node:crypto";
import { z } from "zod";
import type { ProjectStage } from "@prisma/client";
import type { DomainActor } from "../actor";

export type LifecycleJson = null | string | number | boolean | LifecycleJson[] | LifecycleObject;
export type LifecycleObject = { [key: string]: LifecycleJson };
export type LifecycleState = LifecycleObject & { items: LifecycleObject[] };
export type RenderKind = "PDF" | "CONTRACT";
export type ActorBinding = { id: string; source: DomainActor["source"]; tokenId?: string; sessionVersion?: number };
export type TemplateIdentity = { templateHash: string; fontManifestHash: string; sourceManifestHash: string; chromium: string; puppeteer: string };
export type FrozenMedia = { id: string; binding: LifecycleObject; key: string; sha256: string; size: number; mimeType: string; fileName: string };
export type FrozenProposalSource = {
  proposalId: string; projectId: string; projectStage: ProjectStage; revision: number; state: LifecycleState;
  pricingSnapshot: LifecycleObject; binding: { clientId: string | null; clientSnapshot: LifecycleObject; projectId: string };
  currency: string; rate: string | null; rateDate: string | null; rateSource: string | null;
  media: FrozenMedia[]; template: TemplateIdentity; mode: "render" | "retained";
  retainedVersionId?: string; retainedPdfArtifactId?: string;
};
export type RenderJobPayload = { schema: 1; actor: ActorBinding; requestFingerprint: string; frozenSources: FrozenProposalSource[]; extra: LifecycleObject };
export type RenderJobClaim = { id: string; owner: string; attempt: number; kind: RenderKind };
export type LifecycleJob = {
  id: string; proposalId: string | null; contractId: string | null; createdById: string | null; kind: string; state: string; dedupeKey: string; payload: LifecycleJson; result: LifecycleJson;
  attempts: number; maxAttempts: number; leaseOwner: string | null; leaseUntil: Date | null;
  lastErrorCode?: string | null;
};
export type ProposalRecord = {
  id: string; projectId: string | null; clientId: string | null; state: LifecycleState; revision: number;
  currency: string; rate: string | null; rateDate: string | null; rateSource: string | null;
  deletedAt: Date | null; acceptedVersionId: string | null; retentionEpoch: number;
};
export type SourceRecord = { proposal: ProposalRecord; project: { id: string; stage: ProjectStage; deletedAt: Date | null } | null; clientSnapshot: LifecycleObject };
export type MediaRecord = {
  id: string; proposalId: string; storageBinding: LifecycleObject; optimizedKey: string | null; optimizedHash: string | null;
  optimizedSize: number | null; optimizedMimeType: string | null; mimeType: string; fileName: string;
  expiresAt: Date; optimizedPurgedAt: Date | null; retiringAt: Date | null; uploadState: string | null;
};
export type ArtifactRecord = { id: string; proposalId: string | null; contractId: string | null; kind: string; state: string;
  storageBinding: LifecycleObject; key: string; sha256: string; size: number; fileName: string; mimeType: string };
export type VersionRecord = { id: string; proposalId: string; revision: number; state: LifecycleState; pricingSnapshot: LifecycleObject;
  renderSnapshot: LifecycleObject; pdfArtifactId: string | null; createdAt: Date };
export type VerifiedArtifact = Pick<ArtifactRecord, "id" | "storageBinding" | "key" | "sha256" | "size">;
export type RestoreReceipt = { actorId: string; fingerprint: string; proposalId: string; versionId: string; revision: number };

export class ProposalLifecycleError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); this.name = "ProposalLifecycleError"; }
}
export function lifecycleFailure(code: string, status = 409, message = "Обновите данные КП и повторите действие"): never {
  throw new ProposalLifecycleError(code, status, message);
}
export function stableJson(value: LifecycleJson): string {
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  if (value !== null && typeof value === "object") return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + stableJson(value[key])).join(",") + "}";
  return JSON.stringify(value);
}
export const lifecycleFingerprint = (value: LifecycleJson) => createHash("sha256").update(stableJson(value)).digest("hex");
export const lifecycleClone = <T extends LifecycleJson>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
/** Версия КП следует его сохранённому снимку, а не последующим изменениям справочника CRM. */
export function savedProposalClientSnapshot(proposal: Pick<ProposalRecord, "state" | "clientId">): LifecycleObject {
  const client = proposal.state.client;
  if (!client || typeof client !== "object" || Array.isArray(client)) return {};
  const snapshot = client.crmSnapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || snapshot.id !== proposal.clientId) return {};
  return lifecycleClone(Object.fromEntries(Object.entries(snapshot).filter(([key]) => key !== "id")));
}
export function pendingArtifactKey(claim: RenderJobClaim, owner: { kind: "PDF" | "DOCX"; id: string }, artifactId: string) {
  if (![claim.id, owner.id, artifactId].every(value => /^[A-Za-z0-9_-]+$/.test(value)) || !Number.isSafeInteger(claim.attempt) || claim.attempt < 1) lifecycleFailure("KP_ARTIFACT_INVALID", 400);
  return `kp/${owner.kind === "PDF" ? "proposals" : "contracts"}/${owner.id}/exports/${claim.id}-${claim.attempt}-${artifactId}.${owner.kind === "PDF" ? "pdf" : "docx"}`;
}

const object = z.record(z.string(), z.json());
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const actorSchema = z.object({ id: z.string().min(1), source: z.enum(["web", "api", "telegram"]), tokenId: z.string().min(1).optional(), sessionVersion: z.number().int().nonnegative().optional() }).strict();
const templateSchema = z.object({ templateHash: hash, fontManifestHash: hash, sourceManifestHash: hash, chromium: z.string().min(1), puppeteer: z.string().min(1) }).strict();
const sourceSchema = z.object({
  proposalId: z.string().min(1), projectId: z.string().min(1), projectStage: z.enum(["LEAD", "ESTIMATE", "CONTRACT", "IN_WORK", "DONE", "REFUSED", "PAUSED", "RECLAMATION"]),
  revision: z.number().int().nonnegative(), state: object.refine(value => Array.isArray(value.items) && value.items.every(item => item !== null && typeof item === "object" && !Array.isArray(item))),
  pricingSnapshot: object, binding: z.object({ clientId: z.string().nullable(), clientSnapshot: object, projectId: z.string().min(1) }).strict(),
  currency: z.string().min(1), rate: z.string().nullable(), rateDate: z.string().nullable(), rateSource: z.string().nullable(),
  media: z.array(z.object({ id: z.string().min(1), binding: object, key: z.string().min(1), sha256: hash, size: z.number().int().positive(), mimeType: z.string().min(1), fileName: z.string() }).strict()),
  template: templateSchema, mode: z.enum(["render", "retained"]), retainedVersionId: z.string().min(1).optional(), retainedPdfArtifactId: z.string().min(1).optional(),
}).strict();
const payloadSchema = z.object({ schema: z.literal(1), actor: actorSchema, requestFingerprint: hash, frozenSources: z.array(sourceSchema).min(1), extra: object }).strict();
export function parseRenderJobPayload(value: unknown): RenderJobPayload {
  const result = payloadSchema.safeParse(value);
  if (!result.success) lifecycleFailure("KP_JOB_SNAPSHOT_INVALID", 409, "Снимок задания повреждён");
  const payload = result.data as RenderJobPayload;
  if (new Set(payload.frozenSources.map(source => source.proposalId)).size !== payload.frozenSources.length || payload.frozenSources.some(source => source.binding.projectId !== source.projectId || source.mode === "retained" && (!source.retainedVersionId || !source.retainedPdfArtifactId))) lifecycleFailure("KP_JOB_SNAPSHOT_INVALID");
  return payload;
}
export const pdfRequestSchema = z.object({ proposalId: z.string().min(1), expectedRevision: z.number().int().nonnegative(), operationId: z.uuid() }).strict();
export const restoreRequestSchema = pdfRequestSchema.extend({ versionId: z.string().min(1) }).strict();

export interface ProposalLifecycleStore {
  now(): Promise<Date>;
  globalLock(): Promise<void>;
  authorize(binding: ActorBinding): Promise<DomainActor>;
  source(proposalId: string): Promise<SourceRecord | null>;
  proposalByProject(projectId: string): Promise<ProposalRecord | null>;
  media(proposalId: string, scope: { kind: "current" } | { kind: "version"; versionId: string }): Promise<MediaRecord[]>;
  version(proposalId: string, versionId: string): Promise<VersionRecord | null>;
  versions(proposalId: string): Promise<VersionRecord[]>;
  currentReadyVersion(proposalId: string, revision: number): Promise<VersionRecord | null>;
  artifact(id: string): Promise<ArtifactRecord | null>;
  jobByDedupe(dedupeKey: string): Promise<LifecycleJob | null>;
  job(id: string): Promise<LifecycleJob | null>;
  createJob(input: { id: string; proposalId: string; dedupeKey: string; payload: RenderJobPayload; actorId: string }): Promise<void>;
  createPendingArtifact(artifact: ArtifactRecord): Promise<void>;
  enqueueOrphanArtifact(artifact: ArtifactRecord, claim: RenderJobClaim, proposalId: string): Promise<void>;
  makeArtifactReady(id: string): Promise<void>;
  createVersion(input: Omit<VersionRecord, "createdAt"> & { trigger: RenderKind; actorId: string }): Promise<VersionRecord>;
  linkVersionMedia(proposalId: string, versionId: string, mediaIds: string[]): Promise<void>;
  completeJob(claim: RenderJobClaim, result: LifecycleObject): Promise<void>;
  accept(proposalId: string, versionId: string | null, at: Date | null, epoch: number): Promise<void>;
  cancelPruneJobs(proposalId: string): Promise<void>;
  enqueuePrune(input: { proposalId: string; versionId: string; epoch: number; at: Date }): Promise<void>;
  receipt(id: string, action?: "version.restore" | "pdf.retained"): Promise<RestoreReceipt | null>;
  createReceipt(id: string, value: RestoreReceipt, actor: DomainActor, action?: "version.restore" | "pdf.retained"): Promise<void>;
}
export type LifecyclePorts = {
  enabled: boolean;
  templateIdentity(): TemplateIdentity;
  pricingSnapshot(proposal: ProposalRecord): Promise<LifecycleObject> | LifecycleObject;
  mediaIds(state: LifecycleState): readonly string[];
};
