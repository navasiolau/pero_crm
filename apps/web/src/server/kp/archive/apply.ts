import { randomUUID } from "node:crypto";
import { archiveAssert, byteHash, canonical, type ArchiveDependencies, type ArchiveManifest, type ArchiveObject, type ArchiveSource, type TargetProfile } from "./contract";
import { allArchiveObjects, archiveReport, sourceInventory, sourceLimit, validateArchiveManifest } from "./manifest";
import { assertRecoverySourceBinding } from "./recovery-contract";

export type ArchiveReconciliation = { published: boolean; proposals: number; items: number; settings: number; docx: number; verifiedObjects: number; businessBaselinePreserved: boolean; policyPurgedObjectIds?: string[] };
export interface ArchiveStore {
  reserve(manifest: ArchiveManifest, owner: string): Promise<{ published: boolean; verifiedObjectIds?: string[] }>;
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
  const objects = [...manifest.proposals.map(record => record.sourceObject), ...manifest.settings.map(record => record.sourceObject), ...allArchiveObjects(manifest).map(object => object.source)];
  const unique = new Map<string, typeof objects[number]>(), byteBudget = 128 * 1024 * 1024;
  for (const object of objects) {
    archiveAssert(Number.isSafeInteger(object.size) && object.size > 0 && object.size <= sourceLimit(object.area, object.key) && object.size <= byteBudget, "ARCHIVE_SOURCE_SIZE_INVALID");
    const key = object.area + ":" + object.key, prior = unique.get(key);
    archiveAssert(!prior || canonical(prior) === canonical(object), "ARCHIVE_SOURCE_CHANGED"); unique.set(key, object);
  }
  archiveAssert(canonical(await sourceInventory(source)) === canonical(manifest.inventory), "ARCHIVE_SOURCE_INVENTORY_CHANGED");
  await authorize?.();
  let failed = false, failure: unknown, authorization = Promise.resolve(), next = 0, bytes = 0;
  const fail = (error: unknown) => { if (!failed) { failed = true; failure = error; } };
  // Один pg client: HTTP чтения параллельны, проверка actor/lease всегда последовательна.
  const authorized = () => {
    const result = authorization.then(async () => { if (failed) throw failure; await authorize?.(); });
    authorization = result.catch(fail); return result;
  };
  const queued = [...unique.values()], active = new Set<Promise<void>>();
  while (next < queued.length || active.size) {
    while (!failed && next < queued.length && active.size < 4 && bytes + queued[next].size <= byteBudget) {
      try { await authorized(); } catch (error) { fail(error); }
      if (failed) break;
      const object = queued[next++]; bytes += object.size;
      const task = Promise.resolve().then(async () => {
        try {
          if (failed) throw failure;
          // Размер из manifest не доверенный: он проверен выше и становится жёстким лимитом stream.
          const actual = await source.read(object.area, object.key, object.size);
          archiveAssert(actual.bytes.length === object.size && byteHash(actual.bytes) === object.sha256 && actual.mimeType.split(";")[0].trim() === object.mimeType && actual.modifiedAt === object.modifiedAt && canonical(actual.recovery ?? null) === canonical(object.recovery ?? null), "ARCHIVE_SOURCE_CHANGED");
          await authorized();
        } catch (error) { fail(error); }
      }).finally(() => { bytes -= object.size; active.delete(task); });
      active.add(task);
    }
    if (!active.size) break;
    await Promise.race(active);
  }
  await authorization;
  if (failed) throw failure;
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
    const previouslyVerified = new Set(reserved.verifiedObjectIds ?? []);
    archiveAssert(previouslyVerified.size === (reserved.verifiedObjectIds ?? []).length && [...previouslyVerified].every(id => allArchiveObjects(manifest).some(object => object.id === id)), "ARCHIVE_RECOVERY_VERIFIED_OBJECT_CHANGED");
    for (const object of allArchiveObjects(manifest)) {
      await authorize();
      let bytes: Uint8Array | undefined;
      if (!previouslyVerified.has(object.id)) {
        const source = await options.source.read(object.source.area, object.source.key, object.size);
        archiveAssert(source.bytes.length === object.size && byteHash(source.bytes) === object.sha256 && source.mimeType.split(";")[0].trim() === object.source.mimeType && source.modifiedAt === object.source.modifiedAt && canonical(source.recovery ?? null) === canonical(object.source.recovery ?? null), "ARCHIVE_SOURCE_CHANGED"); bytes = source.bytes;
      }
      await authorize();
      let verified: { key: string; sha256: string; size: number };
      if (previouslyVerified.has(object.id)) { await options.io.verify(object, authorize); verified = { key: object.key, sha256: object.sha256, size: object.size }; }
      else { archiveAssert(bytes, "ARCHIVE_READBACK_REQUIRED"); verified = await options.io.ensure(object, bytes, authorize); }
      archiveAssert(verified.key === object.key && verified.sha256 === object.sha256 && verified.size === object.size, "ARCHIVE_READBACK_MISMATCH");
      await authorize(); await options.store.verified(manifest, owner, object);
    }
    await verifyFrozenArchiveSource(manifest, options.source, authorize);
    await authorize(); await options.store.publish(manifest, owner);
    return { mode: "applied" as const, manifestHash: manifest.sha256, replayed: false, created: manifest.counts, reconciliation: await options.store.reconcile(manifest) };
  } finally { if (!reserved.published) await options.store.release(manifest, owner); }
}
