import { archiveAssert, byteHash, canonical, jsonClone, valueHash, type ArchiveDependencies, type ArchiveManifest, type ArchiveObject, type ArchiveSource, type DocxBinding, type SourceArea, type SourceProfile, type TargetProfile } from "../../src/server/kp/archive/contract";
import { allArchiveObjects } from "../../src/server/kp/archive/manifest";
import type { ArchiveStore, ArchiveTargetIO } from "../../src/server/kp/archive/apply";
import { archiveProposalProvenance, archiveProposalVersionSnapshot } from "../../src/server/kp/archive/provenance";

/** Синтетические source/DB/IO порты; fixture не является подтверждением PostgreSQL/S3. */
export function archiveFixture() {
  const sourceProfile: SourceProfile = { public: { endpoint: "https://source.example.invalid", bucket: "legacy-public", region: "auto" }, contracts: { endpoint: "https://source.example.invalid", bucket: "legacy-private", region: "auto" }, publicBaseUrl: "https://images.example.invalid" };
  const target: TargetProfile = { database: { kind: "local", containerId: "1".repeat(64), name: "pero_crm", schema: "public", host: "127.0.0.1", port: 5433 }, storage: { endpoint: "http://127.0.0.1:9000", bucket: "crm-archive-test", region: "us-east-1" } };
  const cloud = new Map<string, { bytes: Buffer; mimeType: string; modifiedAt: string }>();
  const ids = Array.from({ length: 23 }, (_, index) => `${Date.UTC(2023, 0, index + 1)}-${index.toString(36).padStart(7, "a")}`);
  const set = (area: SourceArea, key: string, value: unknown, mimeType = "application/json", modifiedAt = "2023-02-01T00:00:00.000Z") => cloud.set(area + ":" + key, { bytes: value instanceof Uint8Array ? Buffer.from(value) : Buffer.from(JSON.stringify(value)), mimeType, modifiedAt });
  for (const [index, id] of ids.entries()) {
    set("public", `documents/${id}.json`, { id, updatedAt: Date.UTC(2023, 1, 1), name: `КП ${index + 1}`, extraTop: { keep: true }, state: { currency: "$", order: { number: String(100 + index), date: "01.02.2023" }, client: { name: "Условный клиент" }, unknownBlock: { nested: ["unchanged", 7] },
      items: Array.from({ length: index === 22 ? 13 : 8 }, (_, item) => ({ title: `Позиция ${item + 1}`, quantity: 2, price: 123.45, image: sourceProfile.publicBaseUrl + `/kp/photo-${index}.jpg`, custom: { keep: index } })) } });
    set("public", `kp/photo-${index}.jpg`, Buffer.from(`synthetic optimized bytes ${index}`), "image/jpeg");
  }
  for (let index = 0; index < 6; index++) set("contracts", `contracts/${ids[index]}.json`, { schemaVersion: 1, primaryDocumentId: ids[index], updatedAt: Date.UTC(2023, 1, 2), settings: { number: `Д-${index}`, proposalIds: [ids[index], ids[index + 1]], client: { name: "Условный клиент" }, originalUnknown: { keep: true } }, sourceSnapshots: [], lastGeneration: { generatedAt: Date.UTC(2023, 1, 2), templateVersion: "legacy-1" } }, "application/json", "2023-02-02T00:00:00.000Z");
  const links: Record<string, DocxBinding> = {};
  for (let index = 0; index < 7; index++) {
    const key = `exports/00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}.docx`, bytes = Buffer.from(`PK\u0003\u0004synthetic DOCX bytes ${index}`);
    set("contracts", key, bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", `2023-02-${String(index + 2).padStart(2, "0")}T00:00:00.000Z`);
    links[key] = { primaryDocumentId: ids[index % 6], reviewed: true, evidenceSha256: byteHash(bytes) };
  }
  const counters = { sourceReads: 0, sourceLists: 0, sourceWrites: 0, reserves: 0, publishes: 0, puts: 0, reads: 0, active: 0, failAfterPut: 0, failPublish: false };
  const source: ArchiveSource = {
    profile: () => jsonClone(sourceProfile),
    async list(area, prefix) { counters.sourceLists++; return [...cloud].filter(([key]) => key.startsWith(area + ":" + prefix)).map(([key, value]) => ({ area, key: key.slice(area.length + 1), size: value.bytes.length, modifiedAt: value.modifiedAt })); },
    async read(area, key, maxBytes) { counters.sourceReads++; const row = cloud.get(area + ":" + key); archiveAssert(row, "ARCHIVE_SOURCE_MISSING"); archiveAssert(row.bytes.length <= maxBytes, "ARCHIVE_SOURCE_SIZE_INVALID"); return { ...row, bytes: Buffer.from(row.bytes) }; },
  };
  const deps: ArchiveDependencies = {
    validateState(value) { archiveAssert(value && typeof value === "object" && !Array.isArray(value) && "items" in value && Array.isArray(value.items), "ARCHIVE_STATE_INVALID"); return jsonClone(value) as ReturnType<ArchiveDependencies["validateState"]>; },
    expiry(date) { const result = new Date(date); result.setUTCFullYear(result.getUTCFullYear() + 1); if (result.getUTCMonth() !== date.getUTCMonth()) result.setUTCDate(0); return result; },
  };
  const state = { hidden: new Set<string>(), visible: new Map<string, unknown>(), documentProvenance: new Map<string, unknown>(), versionSnapshots: new Map<string, unknown>(), sourceHashes: new Map<string, string>(), verified: new Map<string, string>(), published: new Set<string>(), owner: "", jobsState: "", contractHistory: [] as unknown[], itemPositions: [] as number[], policyPurgedObjectIds: [] as string[], business: { projects: ["real-project"], products: ["real-product"], clients: ["real-client"], payments: ["real-payment"] } };
  const originalBusinessHash = valueHash(state.business), blobs = new Map<string, Buffer>();
  const store: ArchiveStore = {
    async reserve(manifest, owner) {
      counters.reserves++; if (state.published.has(manifest.sha256)) return { published: true };
      for (const record of manifest.proposals) { const prior = state.sourceHashes.get(record.id); archiveAssert(!prior || prior === record.sourceHash, "ARCHIVE_SOURCE_CHANGED"); }
      for (const record of manifest.proposals) { state.sourceHashes.set(record.id, record.sourceHash); state.hidden.add(record.id); }
      state.owner = owner; state.jobsState = "PROCESSING"; return { published: false };
    },
    async active(manifest, owner) { counters.active++; archiveAssert(state.published.has(manifest.sha256) || state.owner === owner && state.jobsState === "PROCESSING", "ARCHIVE_LEASE_LOST"); },
    async verified(_manifest, owner, object) { archiveAssert(owner === state.owner, "ARCHIVE_LEASE_LOST"); state.verified.set(object.id, object.sha256); },
    async publish(manifest, owner) {
      archiveAssert(owner === state.owner && allArchiveObjects(manifest).every(object => state.verified.get(object.id) === object.sha256), "ARCHIVE_READBACK_REQUIRED");
      if (counters.failPublish) throw Error("synthetic-final-SQL-fault");
      for (const proposal of manifest.proposals) { state.visible.set(proposal.id, jsonClone(proposal)); state.documentProvenance.set(proposal.id, jsonClone(archiveProposalProvenance(manifest, proposal))); state.versionSnapshots.set(proposal.versionId, jsonClone(archiveProposalVersionSnapshot(manifest, proposal))); state.hidden.delete(proposal.id); }
      state.contractHistory = jsonClone(manifest.docx); state.itemPositions = manifest.proposals.flatMap(proposal => proposal.state.items.map((_, index) => index + 1));
      state.published.add(manifest.sha256); state.jobsState = "SUCCEEDED"; counters.publishes++;
    },
    async reconcile(manifest) { archiveAssert(state.published.has(manifest.sha256) && valueHash(state.business) === originalBusinessHash, "ARCHIVE_RECONCILIATION_MISMATCH"); return { published: true, ...manifest.counts, verifiedObjects: allArchiveObjects(manifest).length - state.policyPurgedObjectIds.length, businessBaselinePreserved: true, policyPurgedObjectIds: [...state.policyPurgedObjectIds] }; },
    async release(_manifest, owner) { if (owner === state.owner && state.jobsState === "PROCESSING") state.jobsState = "FAILED"; },
  };
  const verify = (object: ArchiveObject) => { const row = blobs.get(object.key); archiveAssert(row && row.length === object.size && byteHash(row) === object.sha256, "ARCHIVE_READBACK_MISMATCH"); };
  const io: ArchiveTargetIO = {
    binding: () => jsonClone(target.storage),
    async ensure(object, bytes, authorize) {
      await authorize(); const existing = blobs.get(object.key);
      if (existing) verify(object);
      else { blobs.set(object.key, Buffer.from(bytes)); counters.puts++; if (counters.failAfterPut && counters.puts === counters.failAfterPut) throw Error("synthetic-unknown-ACK"); }
      counters.reads++; verify(object); await authorize(); return { key: object.key, sha256: object.sha256, size: object.size };
    },
    async verify(object, authorize) { await authorize(); counters.reads++; verify(object); await authorize(); },
  };
  const guardTarget = async (actual: TargetProfile) => archiveAssert(canonical(actual) === canonical(target), "ARCHIVE_TARGET_GUARD_MISMATCH");
  const options = (manifest: ArchiveManifest) => ({ apply: true, reviewedHash: manifest.sha256, deps, source, store, io, guardTarget });
  return { sourceProfile, source, target, deps, links, ids, cloud, set, state, counters, blobs, io, store, guardTarget, options, originalBusinessHash };
}
