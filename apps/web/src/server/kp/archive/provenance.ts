import { jsonClone, valueHash, type ArchiveManifest, type ArchiveProposal } from "./contract";

/** Один и тот же provenance сохраняется в receipt и immutable IMPORT snapshot; это снимок state, не выпущенный PDF. */
export function archiveProposalProvenance(manifest: ArchiveManifest, proposal: ArchiveProposal) {
  const recovery = proposal.media.flatMap(media => media.optimized.source.recovery ? [{ mediaId: media.id, sourceKey: media.optimized.source.key, provenance: jsonClone(media.optimized.source.recovery) }] : []);
  return { schema: 1, sourceId: proposal.sourceId, sourceHash: proposal.sourceHash, rawBase64: proposal.rawBase64, createdAtConfidence: proposal.createdAtConfidence,
    ...(manifest.recovery ? { recovery: { mapSha256: valueHash(manifest.recovery), sourceNamespace: manifest.sourceNamespace, sourceProfile: jsonClone(manifest.recovery.sourceProfile), objects: recovery, originalR2BytesKnown: false } } : {}) };
}
export function archiveProposalVersionSnapshot(manifest: ArchiveManifest, proposal: ArchiveProposal) {
  return { ...archiveProposalProvenance(manifest, proposal), manifestHash: manifest.sha256, historicalTemplate: "unknown", sourceStateOnly: true, issuedPdfAvailable: false };
}
