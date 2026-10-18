import { createHash } from "node:crypto";
import { RetentionError, makeRetentionManifest, retentionHash, type RetentionBinding, type RetentionClaim, type RetentionPayload,
  type RetentionProgress, type RetentionTarget } from "../../src/server/kp/retention-contract";
import { planProposalRetention, type RetentionSnapshot } from "../../src/server/kp/retention-policy";
import type { RetentionRepository, RetentionStorage } from "../../src/server/kp/retention-executor";

export const retentionTime = new Date("2026-10-18T12:00:00.000Z");
export const retentionBinding: RetentionBinding = { endpoint: "https://retention.invalid/", bucket: "retention-unit", region: "us-east-1" };
export const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export const fact = (key: string, content = key, mimeType = "image/jpeg") => {
  const bytes = Buffer.from(content); return { key, sha256: digest(bytes), size: bytes.length, mimeType };
};
export function retentionSnapshot(): RetentionSnapshot {
  const media = ["shared", "old-only", "current"].map(id => ({ id, binding: retentionBinding,
    original: fact(`kp/proposals/proposal/original/${id}.jpg`), optimized: fact(`kp/proposals/proposal/optimized/${id}.jpg`),
    uploadState: "READY", uploadJobId: null, originalPurgedAt: null, optimizedPurgedAt: null,
    expiresAt: new Date("2027-01-01T00:00:00Z"), retiringAt: null }));
  return {
    proposal: { id: "proposal", projectId: "project", stage: "IN_WORK", epoch: 2, acceptedVersionId: "accepted", createdAt: new Date("2026-01-01T00:00:00Z") },
    versions: [{ id: "accepted", pdfArtifactId: "pdf-kept", mediaIds: ["shared", "current"] }, { id: "old", pdfArtifactId: "pdf-old", mediaIds: ["shared", "old-only"] }],
    inWorkTriggered:true,currentMediaIds: ["shared", "current"], media, files: [], jobs: [], pendingFileKeys: [], archiveReservations: [],
    artifacts: [
      { id: "pdf-kept", proposalId: "proposal", contractId: null, kind: "PDF", state: "READY", binding: retentionBinding,
        object: fact("kp/proposals/proposal/exports/accepted.pdf", undefined, "application/pdf"), quoteVersionIds: ["accepted"], contractVersionIds: [] },
      { id: "pdf-old", proposalId: "proposal", contractId: null, kind: "PDF", state: "READY", binding: retentionBinding,
        object: fact("kp/proposals/proposal/exports/old.pdf", undefined, "application/pdf"), quoteVersionIds: ["old"], contractVersionIds: [] },
      { id: "contract", proposalId: null, contractId: "contract", kind: "DOCX", state: "READY", binding: retentionBinding,
        object: fact("kp/contracts/contract/exports/issued.docx", undefined, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), quoteVersionIds: [], contractVersionIds: ["contract-version"] },
    ],
  };
}
export const acceptedPayload: RetentionPayload = { schema: 1, kind: "ACCEPTED_RETENTION", proposalId: "proposal", acceptedVersionId: "accepted", retentionEpoch: 2 };

export function retentionFixture(payload: RetentionPayload = acceptedPayload, snapshot = retentionSnapshot()) {
  let currentPayload = payload, progress: RetentionProgress | null = null, state = "PENDING", owner = "", attempt = 0, binding = retentionBinding;
  let now = new Date(retentionTime), enabled = true;
  const events: string[] = [], objects = new Map<string, { id: string; marker: boolean; bytes: Buffer }[]>(), unversioned = new Set<string>();
  const tombstones: { key: string; proof: unknown }[] = [];
  const control: { onDelete?: (key: string, id: string | null) => void | Promise<void>; onHead?: () => void } = {};
  const claim: RetentionClaim = { id: "cleanup", proposalId: snapshot.proposal.id, owner: "owner", attempt: 1 };
  const manifest = () => currentPayload.kind === "CANCELLED_PROBE" ? progress!.manifest : planProposalRetention(snapshot, currentPayload, now);
  const assertClaim = (value: RetentionClaim) => {
    if (state === "CANCELLED") throw new RetentionError("KP_RETENTION_CANCELLED");
    if (state !== "PROCESSING" || value.owner !== owner || value.attempt !== attempt) throw new RetentionError("KP_RETENTION_LEASE_LOST");
  };
  const repository: RetentionRepository = {
    async claim(nextOwner) {
      if (state !== "PENDING") return null;
      state = "PROCESSING"; owner = nextOwner; attempt++; return { ...claim, owner, attempt };
    },
    async prepare(value) {
      assertClaim(value); progress ??= { manifest: manifest(), objects: {} };
      for (const target of progress.manifest.targets) {
        progress.objects[target.id] ??= { versions: [] };
        if (target.entity === "MEDIA" && target.variant === "optimized") snapshot.media.find(media => media.id === target.entityId)!.retiringAt = now;
        if (target.entity === "ARTIFACT") snapshot.artifacts.find(artifact => artifact.id === target.entityId)!.state = "RETIRING";
      }
      events.push("manifest-persisted"); return { payload: currentPayload, progress: structuredClone(progress) };
    },
    async guard(value, target) {
      assertClaim(value);
      if (!enabled) throw new RetentionError("KP_RETENTION_DISABLED", true);
      if (currentPayload.kind !== "CANCELLED_PROBE") {
        const fresh = manifest();
        if (target && !progress?.objects[target.id]?.absentAt && !fresh.targets.some(item => item.id === target.id && retentionHash(item) === retentionHash(target)))
          throw new RetentionError("KP_RETENTION_REFERENCED", true);
      }
      events.push("guard");
    },
    async discover(value, target, versions) {
      await repository.guard(value, target); const row = progress!.objects[target.id];
      for (const version of versions) if (!row.versions.some(existing => existing.id === version.id)) row.versions.push({ ...version, phase: "DISCOVERED" });
      events.push("versions-persisted:" + target.key); return structuredClone(row.versions);
    },
    async deleteIntent(value, target, version) {
      await repository.guard(value, target); const row = progress!.objects[target.id].versions.find(item => item.id === version.id)!;
      row.phase = "INTENT"; events.push("intent:" + target.key + ":" + version.id);
    },
    async deleted(_value, target, version) { progress!.objects[target.id].versions.find(item => item.id === version.id)!.phase = "DELETED"; events.push("ack:" + target.key + ":" + version.id); },
    async absent(_value, target, proof) {
      const remaining = objects.get(target.key) ?? [];
      if (remaining.length) throw new RetentionError("FIXTURE_PHYSICAL_ABSENCE_REQUIRED");
      progress!.objects[target.id].absentAt = proof.at; events.push("absent:" + target.key);
      if (target.entity === "MEDIA") snapshot.media.find(media => media.id === target.entityId)![target.variant === "original" ? "originalPurgedAt" : "optimizedPurgedAt"] = now;
      if (target.entity === "ARTIFACT") snapshot.artifacts.find(artifact => artifact.id === target.entityId)!.state = "DELETED";
      if (target.entity === "PRODUCT_COPY") { snapshot.files = snapshot.files.filter(file => file.id !== target.entityId); tombstones.push({ key: target.key, proof }); }
    },
    async release(_value, target, available) {
      if(available)progress!.objects[target.id].releasedAt = now.toISOString();else delete progress!.objects[target.id].releasedAt;
      if (available && target.entity === "MEDIA" && target.variant === "optimized") snapshot.media.find(media => media.id === target.entityId)!.retiringAt = null;
      if (available && target.entity === "ARTIFACT") snapshot.artifacts.find(artifact => artifact.id === target.entityId)!.state = "READY";
      events.push("release:" + target.key);
    },
    async finish(value) {
      assertClaim(value);
      if (progress!.manifest.targets.some(target => !progress!.objects[target.id].absentAt && !progress!.objects[target.id].releasedAt)) throw new RetentionError("KP_RETENTION_INCOMPLETE");
      if (currentPayload.kind === "ACCEPTED_RETENTION") snapshot.versions = snapshot.versions.filter(version => !progress!.manifest.pruneVersionIds.includes(version.id));
      state = "SUCCEEDED"; events.push("finished");
    },
    async fail(_claim, error) { if (state === "CANCELLED") return; state = error.retryable ? "PENDING" : "FAILED"; events.push("failed:" + error.code); },
    async scheduleDue(_limit, annual) { events.push(annual ? "schedule-annual" : "schedule-probe"); return 0; },
  };
  const storage: RetentionStorage = {
    currentBinding: () => binding,
    async list(_binding, key, cursor) {
      events.push("list:" + key);
      const all = [...objects.entries()].filter(([name]) => name.startsWith(key) && !unversioned.has(name))
        .flatMap(([name, versions]) => versions.map(version => ({ key: name, id: version.id, marker: version.marker })));
      const index = cursor ? all.findIndex(row => row.key === cursor.key && row.id === cursor.version) + 1 : 0;
      const entries = all.slice(index, index + 2), last = entries.at(-1);
      return { entries, ...(index + 2 < all.length && last ? { next: { key: last.key, version: last.id } } : {}) };
    },
    async digest(_binding, key, versionId) {
      events.push("digest:" + key + ":" + versionId);
      const versions = objects.get(key) ?? [], row = versionId === null ? versions.at(-1) : versions.find(value => value.id === versionId);
      return !row || row.marker ? null : { size: row.bytes.length, sha256: digest(row.bytes) };
    },
    async deleteVersion(_binding, key, versionId) {
      if (!events.includes("intent:" + key + ":" + versionId)) throw new RetentionError("FIXTURE_DURABLE_DELETE_INTENT_REQUIRED");
      events.push("delete:" + key + ":" + versionId);
      const previous = objects.get(key) ?? [];
      objects.set(key, versionId === null ? [] : previous.filter(row => row.id !== versionId));
      await control.onDelete?.(key, versionId);
    },
    async head(_binding, key) { events.push("head:" + key); control.onHead?.(); const latest = objects.get(key)?.at(-1); return latest && !latest.marker ? { size: latest.bytes.length } : null; },
  };
  const seed = (target: RetentionTarget, versions = 1, marker = false) => {
    const data = Buffer.from(target.key); // Переопределить setBytes для content, отличного от key.
    objects.set(target.key, [...Array.from({ length: versions }, (_, i) => ({ id: `v${i}`, marker: false, bytes: data })),
      ...(marker ? [{ id: "marker", marker: true, bytes: Buffer.alloc(0) }] : [])]);
  };
  return { snapshot, repository, storage, events, objects, unversioned, tombstones, control, seed,
    dependencies: { repository, storage, enabled: () => enabled, now: () => now },
    get progress() { return progress; }, get state() { return state; },
    async acquire() { return (await repository.claim("owner", 120_000))!; },
    beginProbe() {
      currentPayload = { schema: 1, kind: "CANCELLED_PROBE", proposalId: snapshot.proposal.id, sourceJobId: "cleanup", manifestFingerprint: progress!.manifest.fingerprint };
      state = "PENDING";
    },
    cancel() { state = "CANCELLED"; snapshot.proposal.stage = "LEAD"; snapshot.proposal.epoch++; snapshot.proposal.acceptedVersionId = null; },
    setBinding(value: RetentionBinding) { binding = value; }, setEnabled(value: boolean) { enabled = value; },
    setTime(value: Date) { now = value; }, setProgress(value: RetentionProgress) { progress = value; },
    emptyManifest() { return makeRetentionManifest(snapshot.proposal.id, [], []); },
  };
}
