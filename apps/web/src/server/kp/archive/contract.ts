import { createHash } from "node:crypto";
import { z } from "zod";
import type { ArchiveRecoveryMap, ArchiveRecoveryProvenance } from "./recovery-contract";

export type Json = null | string | number | boolean | Json[] | JsonObject;
export type JsonObject = { [key: string]: Json };
export type Binding = { endpoint: string; bucket: string; region?: string };
export type SourceProfile = { public: Binding; contracts: Binding; publicBaseUrl: string };
const productionDatabaseSchema = z.object({
  kind: z.literal("production"), containerId: z.string().regex(/^[a-f0-9]{64}$/),
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/), user: z.string().regex(/^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/), schema: z.literal("public"),
  host: z.string().min(1).max(253).regex(/^[A-Za-z0-9][A-Za-z0-9.-]*$/), port: z.number().int().min(1).max(65535),
  revision: z.string().regex(/^[a-f0-9]{40}$/), volume: z.string().min(1).max(255).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/).refine(value => value !== "crm-staging_pgdata"),
}).strict();
export type TargetProfile = {
  database: { kind: "local" | "staging"; containerId: string; name: "pero_crm" | "crm"; schema: "public"; host: "127.0.0.1" | "db"; port: 5433 | 5432; revision?: string; volume?: string } | z.infer<typeof productionDatabaseSchema>;
  storage: Binding;
};
export type SourceArea = "public" | "contracts";
export type SourceObject = { area: SourceArea; key: string; size: number; mimeType: string; modifiedAt: string | null; sha256: string; recovery?: ArchiveRecoveryProvenance };
export type SourceListing = Pick<SourceObject, "area" | "key" | "size" | "modifiedAt">;
export interface ArchiveSource {
  profile(): SourceProfile;
  recoveryMap?(): ArchiveRecoveryMap;
  list(area: SourceArea, prefix: string): Promise<SourceListing[]>;
  read(area: SourceArea, key: string, maxBytes: number): Promise<{ bytes: Uint8Array; mimeType: string; modifiedAt: string | null; recovery?: ArchiveRecoveryProvenance }>;
}
export type Counts = { proposals: number; items: number; settings: number; docx: number };
export const HISTORICAL_COUNTS: Counts = { proposals: 23, items: 189, settings: 6, docx: 7 };
export type UnknownFact = { sourceId: string; field: string; confidence: "unknown"; reason: string };
export type ArchiveObject = {
  id: string; proposalId: string; mediaId: string | null; artifactId: string | null; contractId: string | null; jobId: string;
  role: "original" | "optimized" | "docx"; source: SourceObject; binding: Binding; key: string; sha256: string; size: number; mimeType: string;
};
export type ArchiveMedia = { id: string; proposalId: string; original: ArchiveObject | null; optimized: ArchiveObject; expiresAt: string; fileName: string; jobId: string };
export type ArchiveProposal = {
  id: string; sourceId: string; legacyId: string; sourceNumber: string | null; sourceHash: string; sourceObject: SourceObject; rawBase64: string;
  createdAt: string; createdAtConfidence: "source" | "IDderived"; updatedAt: string; currency: "BYN" | "USD" | "RUB" | "EUR";
  state: JsonObject & { items: JsonObject[] }; versionId: string; media: ArchiveMedia[];
};
export type ArchiveSettings = { id: string; proposalId: string; legacyId: string; sourceHash: string; sourceObject: SourceObject; rawBase64: string; updatedAt: string; settings: JsonObject; sourceProposalIds: string[] };
export type DocxBinding = { primaryDocumentId: string; reviewed: boolean; evidenceSha256: string };
export type ArchiveDocx = { sourceObject: SourceObject; primaryDocumentId: string | null; reviewed: boolean; evidenceSha256: string | null; artifact: ArchiveObject | null; versionId: string; createdAtConfidence: "source" | "unknown" };
export type ArchiveManifest = { schema: 1; source: SourceProfile; sourceNamespace: string; target: TargetProfile; counts: Counts; historicalCounts: Counts;
  inventory: SourceListing[]; recovery?: ArchiveRecoveryMap; proposals: ArchiveProposal[]; settings: ArchiveSettings[]; docx: ArchiveDocx[]; unknowns: UnknownFact[]; sha256: string };
export type ArchiveDependencies = {
  validateState(value: unknown): JsonObject & { items: JsonObject[] };
  expiry(createdAt: Date): Date;
};
export class ArchiveImportError extends Error {
  constructor(readonly code: string) { super(code); this.name = "ArchiveImportError"; }
}
export function archiveAssert(condition: unknown, code: string): asserts condition { if (!condition) throw new ArchiveImportError(code); }
export const byteHash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object") return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical((value as Record<string, unknown>)[key])).join(",") + "}";
  archiveAssert(value !== undefined && (typeof value !== "number" || Number.isFinite(value)), "ARCHIVE_JSON_INVALID");
  return JSON.stringify(value);
}
export const valueHash = (value: unknown) => byteHash(canonical(value));
const recoveryWitnessSchema = z.object({
  schema: z.literal(1), kind: z.literal("ARCHIVE_RESERVATION_RECOVERY"),
  manifestHash: z.string().regex(/^[a-f0-9]{64}$/), targetHash: z.string().regex(/^[a-f0-9]{64}$/),
  reserveRowHash: z.string().regex(/^[a-f0-9]{64}$/), reservationActorId: z.string().min(1).max(160),
  operatorId: z.string().min(1).max(160), operationId: z.uuid(),
  program: z.object({ sourceRevision: z.string().regex(/^[a-f0-9]{40}$/), entrySha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  families: z.record(z.string(), z.object({ count: z.number().int().min(0), hash: z.string().regex(/^[a-f0-9]{32}$/), stableHash: z.string().regex(/^[a-f0-9]{32}$/) }).strict()),
  verifiedObjects: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
}).strict();
export type ArchiveReservationWitness = z.infer<typeof recoveryWitnessSchema>;
export type ArchiveReservationRecovery = { witness: ArchiveReservationWitness; reviewedHash: string; operationId: string; programSha256: string };
export function parseArchiveReservationWitness(value: unknown): ArchiveReservationWitness {
  const result = recoveryWitnessSchema.safeParse(value); archiveAssert(result.success, "ARCHIVE_RECOVERY_WITNESS_INVALID"); return result.data;
}
export function assertArchiveReservationRecovery(input: ArchiveReservationRecovery, manifest: ArchiveManifest, operatorId: string): ArchiveReservationWitness {
  const witness = parseArchiveReservationWitness(input.witness);
  archiveAssert(input.reviewedHash === valueHash(witness) && witness.manifestHash === manifest.sha256 && witness.targetHash === valueHash(manifest.target), "ARCHIVE_RECOVERY_REVIEW_REQUIRED");
  archiveAssert(witness.operatorId === operatorId && witness.operatorId !== witness.reservationActorId && witness.operationId === input.operationId && witness.program.entrySha256 === input.programSha256, "ARCHIVE_RECOVERY_OPERATION_CHANGED");
  const objects = new Map(manifest.proposals.flatMap(p => p.media.flatMap(m => [...(m.original ? [m.original] : []), m.optimized])).concat(manifest.docx.flatMap(d => d.artifact ? [d.artifact] : [])).map(o => [o.id, o.sha256]));
  archiveAssert(Object.entries(witness.verifiedObjects).every(([id, hash]) => objects.get(id) === hash), "ARCHIVE_RECOVERY_VERIFIED_OBJECT_CHANGED");
  return witness;
}
export const sameStorageResource = (a: Binding, b: Binding) => new URL(a.endpoint).toString().replace(/\/$/, "") === new URL(b.endpoint).toString().replace(/\/$/, "") && a.bucket === b.bucket;
export const archiveId = (kind: string, namespace: string, identity: string) => `kp_a_${kind}_${byteHash(namespace + "\n" + identity)}`;
export const isObject = (value: unknown): value is JsonObject => value !== null && typeof value === "object" && !Array.isArray(value);
export const jsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const bindingSchema = z.object({ endpoint: z.string().min(1), bucket: z.string().min(1).max(255), region: z.string().min(1).max(255).optional() }).strict();
export function parseBinding(value: unknown): Binding {
  const result = bindingSchema.safeParse(value); archiveAssert(result.success, "ARCHIVE_BINDING_INVALID");
  const url = new URL(result.data.endpoint);
  archiveAssert(["https:", "http:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && !/[\\\s]/.test(result.data.endpoint) && !/[\\/\s]/.test(result.data.bucket), "ARCHIVE_BINDING_INVALID");
  return result.data;
}
export function parseSourceProfile(value: unknown): SourceProfile {
  archiveAssert(isObject(value) && Object.keys(value).every(key => ["public", "contracts", "publicBaseUrl"].includes(key)), "ARCHIVE_SOURCE_PROFILE_INVALID");
  const profile = { public: parseBinding(value.public), contracts: parseBinding(value.contracts), publicBaseUrl: String(value.publicBaseUrl ?? "") };
  const base = new URL(profile.publicBaseUrl);
  archiveAssert(base.protocol === "https:" && !base.username && !base.password && !base.search && !base.hash && !sameStorageResource(profile.public, profile.contracts), "ARCHIVE_SOURCE_PROFILE_INVALID");
  profile.publicBaseUrl = base.toString().replace(/\/$/, "");
  return profile;
}
export function parseTargetProfile(value: unknown): TargetProfile {
  archiveAssert(isObject(value) && isObject(value.database) && Object.keys(value).every(key => ["database", "storage"].includes(key)), "ARCHIVE_TARGET_PROFILE_INVALID");
  const db = value.database;
  archiveAssert(Object.keys(db).every(key => ["kind", "containerId", "name", "schema", "host", "port", "revision", "volume", ...(db.kind === "production" ? ["user"] : [])].includes(key)), "ARCHIVE_TARGET_PROFILE_INVALID");
  archiveAssert(/^[a-f0-9]{64}$/.test(String(db.containerId)) && db.schema === "public", "ARCHIVE_TARGET_PROFILE_INVALID");
  archiveAssert(db.kind === "local" && db.name === "pero_crm" && db.host === "127.0.0.1" && db.port === 5433 || db.kind === "staging" && db.name === "crm" && db.host === "db" && db.port === 5432 && db.volume === "crm-staging_pgdata" && /^[a-f0-9]{40}$/.test(String(db.revision)) || db.kind === "production" && productionDatabaseSchema.safeParse(db).success, "ARCHIVE_TARGET_PROFILE_INVALID");
  return { database: jsonClone(db) as TargetProfile["database"], storage: parseBinding(value.storage) };
}
export function assertArchiveDatabaseIdentity(target: TargetProfile, identity: { database: string; schema: string; user: string } | undefined): void {
  const database = parseTargetProfile(target).database;
  archiveAssert(identity?.database === database.name && identity.schema === database.schema && identity.user === (database.kind === "production" ? database.user : database.kind === "local" ? "pero" : "crm"), "ARCHIVE_DATABASE_GUARD_MISMATCH");
}
export function sourceImageKey(profile: SourceProfile, raw: string): string {
  const base = new URL(profile.publicBaseUrl + "/"), image = new URL(raw);
  archiveAssert(image.origin === base.origin && image.pathname.startsWith(base.pathname) && !image.username && !image.password && !image.search && !image.hash && !raw.includes("%"), "ARCHIVE_IMAGE_FOREIGN_HOST");
  const key = image.pathname.slice(base.pathname.length);
  archiveAssert(/^kp\/[A-Za-z0-9._/-]+$/.test(key) && !key.split("/").some(part => !part || part === "." || part === ".."), "ARCHIVE_SOURCE_KEY_INVALID");
  return key;
}
export const reserveReceiptId = (hash: string) => `kp.archive.reserve:${hash}`;
export const publishReceiptId = (hash: string) => `kp.archive.publish:${hash}`;
export const docReceiptId = (id: string) => `kp.archive.document:${id}`;
