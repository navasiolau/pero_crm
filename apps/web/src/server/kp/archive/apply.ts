import { randomUUID } from "node:crypto";
import { archiveAssert, byteHash, canonical, type ArchiveDependencies, type ArchiveManifest, type ArchiveObject, type ArchiveSource, type TargetProfile } from "./contract";
import { allArchiveObjects, archiveReport, sourceInventory, sourceLimit, validateArchiveManifest } from "./manifest";
import { assertRecoverySourceBinding } from "./recovery-contract";

export type ArchiveReconciliation = { published: boolean; proposals: number; items: number; settings: number; docx: number; verifiedObjects: number; businessBaselinePreserved: boolean; policyPurgedObjectIds?: string[] };
export interface ArchiveStore {
  reserve(manifest: ArchiveManifest, owner: string): Promise<{ published: boolean }>;
  active(manifest: ArchiveManifest, owner: string): Promise<void>;
  verified(manifest: ArchiveManifest, owner: string, object: ArchiveObject): Promise<void>;
  publish(manifest: ArchiveManifest, owner: string): Promise<void>;
  reconcile(manifest: ArchiveManifest): Promise<ArchiveReconciliation>;
  release(manifest: ArchiveManifest, owner: string): Promise<void>;
}
export interface ArchiveTargetIO {
  binding(): TargetProfile["storage"];
  ensure(object: ArchiveObject, bytes: Uint8Array, authorize: () => Promise<void>): Promise<{ key: string; sha256: string; size: number }>;
  verify(object: ArchiveObject, authorize: () => Promise<void>): Promise<void>;
}
export async function verifyFrozenArchiveSource(manifest: ArchiveManifest, source: ArchiveSource, authorize?: () => Promise<void>) {
  await authorize?.();
  archiveAssert(canonical(source.profile()) === canonical(manifest.source), "ARCHIVE_SOURCE_BINDING_CHANGED");
  assertRecoverySourceBinding(manifest, source.recoveryMap?.());
  archiveAssert(canonical(await sourceInventory(source)) === canonical(manifest.inventory), "ARCHIVE_SOURCE_INVENTORY_CHANGED");
  await authorize?.();
  const objects = [...manifest.proposals.map(record => record.sourceObject), ...manifest.settings.map(record => record.sourceObject), ...allArchiveObjects(manifest).map(object => object.source)];
  const unique = new Map(objects.map(object => [object.area + ":" + object.key, object]));
  for (const object of unique.values()) {
    await authorize?.();
    const actual = await source.read(object.area, object.key, sourceLimit(object.area, object.key));
    archiveAssert(actual.bytes.length === object.size && byteHash(actual.bytes) === object.sha256 && actual.mimeType.split(";")[0].trim() === object.mimeType && actual.modifiedAt === object.modifiedAt && canonical(actual.recovery ?? null) === canonical(object.recovery ?? null), "ARCHIVE_SOURCE_CHANGED");
    await authorize?.();
  }
}

/** Dry-run не обращается к store/source/target. apply всегда требует точного reviewed digest. */
export async function applyArchiveManifest(input: unknown, options: {
  apply?: boolean; reviewedHash?: string; deps: ArchiveDependencies; source: ArchiveSource; store: ArchiveStore; io: ArchiveTargetIO;
  guardTarget(target: TargetProfile): Promise<void>;
}) {
  const manifest = validateArchiveManifest(input, options.deps), report = archiveReport(manifest);
  if (!options.apply) return { mode: "dry-run" as const, ...report };
  archiveAssert(options.reviewedHash === manifest.sha256 && report.applicable, "ARCHIVE_REVIEW_REQUIRED");
  await options.guardTarget(manifest.target);
  archiveAssert(canonical(options.io.binding()) === canonical(manifest.target.storage), "ARCHIVE_TARGET_STORAGE_CHANGED");
  await verifyFrozenArchiveSource(manifest, options.source);
  const owner = randomUUID(), reserved = await options.store.reserve(manifest, owner);
  const authorize = async () => {
    await options.guardTarget(manifest.target);
    archiveAssert(canonical(options.io.binding()) === canonical(manifest.target.storage), "ARCHIVE_TARGET_STORAGE_CHANGED");
    await options.store.active(manifest, owner);
  };
  try {
    if (reserved.published) {
      const reconciliation = await options.store.reconcile(manifest), purged = new Set(reconciliation.policyPurgedObjectIds ?? []);
      for (const object of allArchiveObjects(manifest)) if (!purged.has(object.id)) await options.io.verify(object, authorize);
      return { mode: "applied" as const, manifestHash: manifest.sha256, replayed: true, created: { proposals: 0, items: 0, settings: 0, docx: 0 }, reconciliation };
    }
    for (const object of allArchiveObjects(manifest)) {
      await authorize();
      const source = await options.source.read(object.source.area, object.source.key, sourceLimit(object.source.area, object.source.key));
      archiveAssert(source.bytes.length === object.size && byteHash(source.bytes) === object.sha256 && source.mimeType.split(";")[0].trim() === object.source.mimeType && source.modifiedAt === object.source.modifiedAt && canonical(source.recovery ?? null) === canonical(object.source.recovery ?? null), "ARCHIVE_SOURCE_CHANGED");
      await authorize();
      const verified = await options.io.ensure(object, source.bytes, authorize);
      archiveAssert(verified.key === object.key && verified.sha256 === object.sha256 && verified.size === object.size, "ARCHIVE_READBACK_MISMATCH");
      await authorize(); await options.store.verified(manifest, owner, object);
    }
    await verifyFrozenArchiveSource(manifest, options.source, authorize);
    await authorize(); await options.store.publish(manifest, owner);
    return { mode: "applied" as const, manifestHash: manifest.sha256, replayed: false, created: manifest.counts, reconciliation: await options.store.reconcile(manifest) };
  } finally { if (!reserved.published) await options.store.release(manifest, owner); }
}
