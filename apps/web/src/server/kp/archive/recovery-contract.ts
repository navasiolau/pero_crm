import { z } from "zod";
import { archiveAssert, canonical, isObject, jsonClone, parseSourceProfile, sourceImageKey, valueHash,
  type ArchiveManifest, type SourceObject, type SourceProfile } from "./contract";

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const reference = z.object({ documentId: z.string().regex(/^[0-9]{13}-[a-z0-9]{7}$/), position: z.number().int().positive(), slot: z.enum(["image", "image2"]) }).strict();
const origin = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("LOCAL_FILE"), sourceFileSha256: sha }).strict(),
  z.object({ kind: z.literal("PDF_DCT"), sourceFileSha256: sha, page: z.number().int().positive(), object: z.number().int().positive(), imageResource: z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/).optional() }).strict(),
]);
const entry = z.object({ key: z.string().regex(/^kp\/[A-Za-z0-9._/-]+$/), file: z.string().regex(/^[a-f0-9]{64}\.(jpg|png|webp)$/), sha256: sha,
  size: z.number().int().positive().max(15 * 1024 * 1024), mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]), references: z.array(reference).min(1).max(10000),
  origin, evidenceSha256: sha, reviewed: z.literal(true) }).strict();
const map = z.object({ schema: z.literal(1), sourceProfile: z.unknown(), sourceNamespace: sha, reviewed: z.literal(true), entries: z.array(entry).min(1).max(10000) }).strict();

export type ArchiveRecoveryEntry = z.infer<typeof entry>;
export type ArchiveRecoveryMap = Omit<z.infer<typeof map>, "sourceProfile"> & { sourceProfile: SourceProfile };
export type ArchiveRecoveryProvenance = { schema: 1; cloudState: "OBJECT_NOT_FOUND"; mapSha256: string; entry: ArchiveRecoveryEntry };

/** Reviewed map не содержит путей к исходным PDF/локальным оригиналам и переносится вместе с hash-named копиями. */
export function parseArchiveRecoveryMap(value: unknown, expected: SourceProfile): ArchiveRecoveryMap {
  archiveAssert(isObject(value) && value.reviewed === true && Array.isArray(value.entries) && value.entries.every(row => isObject(row) && row.reviewed === true), "ARCHIVE_RECOVERY_REVIEW_REQUIRED");
  const parsed = map.safeParse(value); archiveAssert(parsed.success, "ARCHIVE_RECOVERY_MAP_INVALID");
  const sourceProfile = parseSourceProfile(parsed.data.sourceProfile), sourceNamespace = valueHash(sourceProfile);
  archiveAssert(valueHash(parseSourceProfile(expected)) === sourceNamespace && parsed.data.sourceNamespace === sourceNamespace, "ARCHIVE_RECOVERY_BINDING_MISMATCH");
  const entries = parsed.data.entries.map(row => {
    archiveAssert(!row.key.split("/").some(part => !part || part === "." || part === ".."), "ARCHIVE_RECOVERY_MAP_INVALID");
    const extension = row.mimeType === "image/jpeg" ? "jpg" : row.mimeType === "image/png" ? "png" : "webp";
    archiveAssert(row.file === `${row.sha256}.${extension}` && (row.origin.kind !== "LOCAL_FILE" || row.origin.sourceFileSha256 === row.sha256), "ARCHIVE_RECOVERY_MAP_INVALID");
    const references = [...row.references].sort((a, b) => canonical(a).localeCompare(canonical(b)));
    archiveAssert(new Set(references.map(canonical)).size === references.length, "ARCHIVE_RECOVERY_MAP_INVALID");
    return { ...row, references };
  }).sort((a, b) => a.key.localeCompare(b.key));
  archiveAssert(new Set(entries.map(row => row.key)).size === entries.length, "ARCHIVE_RECOVERY_MAP_INVALID");
  const references = entries.flatMap(row => row.references.map(canonical));
  archiveAssert(new Set(references).size === references.length, "ARCHIVE_RECOVERY_REFERENCE_MISMATCH");
  return { schema: 1, sourceProfile, sourceNamespace, reviewed: true, entries };
}

export function recoveryProvenance(map: ArchiveRecoveryMap, entry: ArchiveRecoveryEntry): ArchiveRecoveryProvenance {
  return { schema: 1, cloudState: "OBJECT_NOT_FOUND", mapSha256: valueHash(map), entry: jsonClone(entry) };
}

export function assertRecoverySourceBinding(manifest: ArchiveManifest, actual: ArchiveRecoveryMap | undefined): void {
  archiveAssert(canonical(manifest.recovery ?? null) === canonical(actual ?? null), "ARCHIVE_RECOVERY_MAP_MISMATCH");
}

/** Каждая замена обязана соответствовать всем исходным URL/позициям; recovery нельзя выдать за настоящий original. */
export function validateManifestRecovery(manifest: ArchiveManifest): void {
  const recovered: SourceObject[] = [], optimized: SourceObject[] = [];
  for (const proposal of manifest.proposals) {
    archiveAssert(!proposal.sourceObject.recovery, "ARCHIVE_RECOVERY_MAP_MISMATCH");
    for (const media of proposal.media) {
      archiveAssert(!media.original?.source.recovery, "ARCHIVE_RECOVERY_ORIGINAL_UNPROVEN");
      optimized.push(media.optimized.source);
      if (media.optimized.source.recovery) recovered.push(media.optimized.source);
    }
  }
  archiveAssert(manifest.settings.every(row => !row.sourceObject.recovery) && manifest.docx.every(row => !row.sourceObject.recovery), "ARCHIVE_RECOVERY_MAP_MISMATCH");
  if (!manifest.recovery) { archiveAssert(recovered.length === 0, "ARCHIVE_RECOVERY_MAP_REQUIRED"); return; }
  const map = parseArchiveRecoveryMap(manifest.recovery, manifest.source);
  archiveAssert(canonical(map) === canonical(manifest.recovery), "ARCHIVE_RECOVERY_MAP_INVALID");
  for (const row of map.entries) {
    const actualReferences: ArchiveRecoveryEntry["references"] = [];
    for (const proposal of manifest.proposals) {
      const raw: unknown = JSON.parse(Buffer.from(proposal.rawBase64, "base64").toString("utf8"));
      archiveAssert(isObject(raw) && isObject(raw.state) && Array.isArray(raw.state.items), "ARCHIVE_SOURCE_RECORD_INVALID");
      for (const [index, item] of raw.state.items.entries()) if (isObject(item)) for (const slot of ["image", "image2"] as const) {
        if (typeof item[slot] === "string" && item[slot] && sourceImageKey(manifest.source, item[slot]) === row.key) actualReferences.push({ documentId: proposal.legacyId, position: index + 1, slot });
      }
    }
    actualReferences.sort((a, b) => canonical(a).localeCompare(canonical(b)));
    archiveAssert(canonical(actualReferences) === canonical(row.references), "ARCHIVE_RECOVERY_REFERENCE_MISMATCH");
    const sources = optimized.filter(source => source.key === row.key);
    archiveAssert(sources.length > 0 && sources.every(source => source.area === "public" && source.sha256 === row.sha256 && source.size === row.size && source.mimeType === row.mimeType && source.modifiedAt === null && canonical(source.recovery) === canonical(recoveryProvenance(map, row))), "ARCHIVE_RECOVERY_PROVENANCE_MISMATCH");
  }
  archiveAssert(recovered.every(source => map.entries.some(row => row.key === source.key)), "ARCHIVE_RECOVERY_MAP_MISMATCH");
}
