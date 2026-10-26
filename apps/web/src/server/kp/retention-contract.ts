import { createHash } from "node:crypto";
import { z } from "zod";

export type RetentionBinding = { endpoint: string; bucket: string; region?: string };
export type RetentionObject = { key: string; sha256: string; size: number; mimeType: string };
export type RetentionTarget = RetentionObject & { id: string; binding: RetentionBinding;
  entity: "MEDIA" | "ARTIFACT" | "PRODUCT_COPY"; entityId: string; variant?: "original" | "optimized";
  contractId?: string; projectId?: string; storedName?: string; operationJobId?: string };
export type RetentionClaim = { id: string; proposalId: string; owner: string; attempt: number };
export type StoredVersion = { id: string | null; marker: boolean; phase: "DISCOVERED" | "INTENT" | "DELETED" };
export type TargetProgress = { versions: StoredVersion[]; absentAt?: string; releasedAt?: string; lastProbeAt?: string };
export type RetentionManifest = { schema: 1; targets: RetentionTarget[]; pruneVersionIds: string[]; fingerprint: string };
export type RetentionProgress = { manifest: RetentionManifest; objects: Record<string, TargetProgress>; reconciledAt?: string };

const id = z.string().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const binding = z.object({ endpoint: z.string().url(), bucket: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/), region: z.string().min(1).max(255).optional() }).strict();
const object = z.object({ key: z.string().min(1).max(1024), sha256: hash, size: z.number().int().positive().max(2_147_483_647), mimeType: z.string().min(1).max(120) }).strict();
const exact = { schema: z.literal(1), proposalId: id, operationJobId: id, binding, objects: z.array(object).min(1).max(2) };
export const retentionPayloadSchema = z.discriminatedUnion("kind", [
  z.object({ schema: z.literal(1), kind: z.literal("ACCEPTED_RETENTION"), proposalId: id, acceptedVersionId: id, retentionEpoch: z.number().int().min(0) }).strict(),
  z.object({ schema: z.literal(1), kind: z.literal("ANNUAL_MEDIA"), proposalId: id, expiresAt: z.iso.datetime() }).strict(),
  z.object({ ...exact, kind: z.literal("UNATTACHED_MEDIA"), mediaId: id, projectId: id.nullable().optional() }).strict(),
  z.object({ ...exact, kind: z.literal("UNATTACHED_PRODUCT_COPY"), mediaId: id, projectId: id, fileId: id, storedName: z.string().min(1).max(255) }).strict(),
  z.object({ ...exact, kind: z.literal("RETIRED_PRODUCT_COPY"), sourceMediaId: id, projectId: id, fileId: id, storedName: z.string().min(1).max(255) }).strict(),
  z.object({ ...exact, kind: z.literal("ORPHAN_ARTIFACT"), artifactId: id, attempt: z.number().int().positive() }).strict(),
  z.object({ ...exact, kind: z.literal("ORPHAN_ARCHIVE_ARTIFACT"), artifactId: id, archiveReserveReceiptId: id, archiveManifestHash: hash }).strict(),
  z.object({ schema: z.literal(1), kind: z.literal("CANCELLED_PROBE"), proposalId: id, sourceJobId: id, manifestFingerprint: hash }).strict(),
]);
export type RetentionPayload = z.infer<typeof retentionPayloadSchema>;

export class RetentionError extends Error {
  constructor(readonly code: string, readonly retryable = false) { super(code); this.name = "RetentionError"; }
}
export function retentionPayload(value: unknown): RetentionPayload {
  const parsed = retentionPayloadSchema.safeParse(value);
  if (!parsed.success) throw new RetentionError("KP_RETENTION_INTENT_INVALID");
  if ("binding" in parsed.data) normalizeRetentionBinding(parsed.data.binding);
  return parsed.data;
}
export function normalizeRetentionBinding(value: RetentionBinding): RetentionBinding {
  const parsed = binding.safeParse(value);
  if (!parsed.success) throw new RetentionError("KP_RETENTION_STORAGE_CHANGED");
  const endpoint = new URL(value.endpoint);
  if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
    /[\\\s]/.test(value.endpoint) || value.region && /[\s\u0000-\u001f]/.test(value.region)) throw new RetentionError("KP_RETENTION_STORAGE_CHANGED");
  return { ...value, endpoint: endpoint.toString(), region: value.region ?? "us-east-1" };
}
export function sameRetentionBinding(a: RetentionBinding, b: RetentionBinding) {
  const left = normalizeRetentionBinding(a), right = normalizeRetentionBinding(b);
  return left.endpoint === right.endpoint && left.bucket === right.bucket && left.region === right.region;
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.keys(value).sort().filter(key => (value as Record<string, unknown>)[key] !== undefined).map(key => JSON.stringify(key) + ":" + canonical((value as Record<string, unknown>)[key])).join(",") + "}";
}
export const retentionHash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
export function retentionAnniversary(createdAt: Date): Date {
  const due = new Date(createdAt), month = due.getUTCMonth(); due.setUTCFullYear(due.getUTCFullYear() + 1);
  if (due.getUTCMonth() !== month) due.setUTCDate(0); return due;
}
export function assertRetentionTarget(proposalId: string, target: RetentionTarget): void {
  if (!id.safeParse(proposalId).success || !id.safeParse(target.entityId).success ||
    !object.safeParse({ key: target.key, sha256: target.sha256, size: target.size, mimeType: target.mimeType }).success)
    throw new RetentionError("KP_RETENTION_TARGET_INVALID");
  normalizeRetentionBinding(target.binding);
  const parts = target.key.split("/");
  if (parts.some(part => !part || part === "." || part === "..") || /[^A-Za-z0-9/._-]/.test(target.key)) throw new RetentionError("KP_RETENTION_KEY_INVALID");
  if (target.entity === "MEDIA") {
    if (!target.variant || target.id !== `media:${target.entityId}:${target.variant}` || !target.key.startsWith(`kp/proposals/${proposalId}/${target.variant}/`)) throw new RetentionError("KP_RETENTION_KEY_INVALID");
  } else if (target.entity === "ARTIFACT") {
    const owner = target.contractId ? `contracts/${target.contractId}` : `proposals/${proposalId}`;
    if (target.id !== `artifact:${target.entityId}` || !target.key.startsWith(`kp/${owner}/exports/`) || target.contractId && !id.safeParse(target.contractId).success)
      throw new RetentionError("KP_RETENTION_KEY_INVALID");
  } else if (target.entity !== "PRODUCT_COPY" || target.id !== `copy:${target.entityId}` || !target.projectId || !target.storedName || !/^kp-[a-f0-9-]{36}\.(jpg|png|webp)$/.test(target.storedName) ||
    target.key !== `${target.projectId}/${target.storedName}` || !id.safeParse(target.projectId).success)
    throw new RetentionError("KP_RETENTION_KEY_INVALID");
}
export function makeRetentionManifest(proposalId: string, targets: RetentionTarget[], pruneVersionIds: string[]): RetentionManifest {
  if (targets.length > 5000 || new Set(targets.map(target => target.id)).size !== targets.length || new Set(targets.map(target => target.key)).size !== targets.length)
    throw new RetentionError("KP_RETENTION_MANIFEST_INVALID");
  targets.forEach(target => assertRetentionTarget(proposalId, target));
  const values = { schema: 1 as const, targets: [...targets].sort((a, b) => a.id.localeCompare(b.id)), pruneVersionIds: [...pruneVersionIds].sort() };
  return { ...values, fingerprint: retentionHash(values) };
}

export function parseRetentionProgress(proposalId: string, value: unknown): RetentionProgress | null {
  if (value === null || value === undefined) return null;
  const record = value as RetentionProgress;
  if (!record || typeof record !== "object" || !record.manifest || !Array.isArray(record.manifest.targets) ||
    !Array.isArray(record.manifest.pruneVersionIds) || !record.objects || typeof record.objects !== "object" || Array.isArray(record.objects))
    throw new RetentionError("KP_RETENTION_PROGRESS_INVALID");
  const checked = makeRetentionManifest(proposalId, record.manifest.targets, record.manifest.pruneVersionIds);
  if (checked.fingerprint !== record.manifest.fingerprint) throw new RetentionError("KP_RETENTION_PROGRESS_INVALID");
  for (const [targetId, progress] of Object.entries(record.objects)) {
    if (!checked.targets.some(target => target.id === targetId) || !Array.isArray(progress.versions) || progress.versions.length > 1000 ||
      progress.versions.some(version => version.id !== null && (typeof version.id !== "string" || !version.id || version.id.length > 1024) ||
        typeof version.marker !== "boolean" || version.marker && version.id === null || !["DISCOVERED", "INTENT", "DELETED"].includes(version.phase)))
      throw new RetentionError("KP_RETENTION_PROGRESS_INVALID");
  }
  return record;
}

/** Поздний ACK исходного владельца дополняет read-only probe, не отменяя уже доказанные факты. */
export function mergeRetentionProgress(current: RetentionProgress, source: RetentionProgress): RetentionProgress {
  if(current.manifest.fingerprint!==source.manifest.fingerprint)throw new RetentionError('KP_RETENTION_MANIFEST_CHANGED');
  const rank={DISCOVERED:0,INTENT:1,DELETED:2};
  for(const[id,other]of Object.entries(source.objects)){
    const target=current.objects[id]??={versions:[]};
    for(const version of other.versions){
      const prior=target.versions.find(value=>value.id===version.id);
      if(!prior)target.versions.push({...version});
      else if(rank[version.phase]>rank[prior.phase])prior.phase=version.phase;
    }
    if(other.absentAt&&!target.absentAt)target.absentAt=other.absentAt;
  }
  return current;
}
