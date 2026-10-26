import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";
import { normalizationEntry, parseImportedProposalNormalization } from "../src/server/kp/archive/normalize";
import { ArchiveImportError, docReceiptId, publishReceiptId, reserveReceiptId, valueHash, type ArchiveProposal, type JsonObject } from "../src/server/kp/archive/contract";
import { allArchiveObjects, prepareArchiveManifest } from "../src/server/kp/archive/manifest";
import { archivePublishValue, archiveReserveValue, archiveRecoveryReceiptIds, createArchiveSqlStore } from "../src/server/kp/archive/prisma-store";
import { archiveProposalProvenance, archiveProposalVersionSnapshot } from "../src/server/kp/archive/provenance";
import { applyArchiveManifest } from "../src/server/kp/archive/apply";
import { makeRetentionManifest } from "../src/server/kp/retention-contract";
import { archiveFixture } from "./helpers/kp-archive-fixture";

const code = (expected: string) => (error: unknown) => error instanceof ArchiveImportError && error.code === expected;
function rows(number = "117") {
  const source = { id: "proposal", sourceId: "source", sourceNumber: number } as ArchiveProposal;
  const proposal: JsonObject = { ...source, projectId: null, clientId: null, isArchive: true, revision: 4,
    state: { items: [{ id: "item1", title: "Исходная позиция" }] }, deletedAt: null, updatedAt: "2026-01-01T00:00:00.000" };
  const project: JsonObject = { id: "project", number, clientId: "client", deletedAt: null, stage: "DONE", title: "Вручную исправлено", initialPrice: "900.00" };
  const items: JsonObject[] = [1, 2].map(position => ({ id: `item${position}`, proposalId: "proposal", position, state: { price: 10 }, productId: null, deletedAt: null }));
  const products: JsonObject[] = [{ id: "product1", projectId: "project", number: `${number}.1`, deletedAt: null, expectedPrice: "123.00" }];
  return { source, snapshot: { proposal, project, items, products, owners: [] as JsonObject[] } };
}

test("normalization links exact active product numbers and leaves missing positions for explicit Save", () => {
  const f = rows(), before = valueHash(f.snapshot), entry = normalizationEntry(f.source, f.snapshot);
  assert.deepEqual(entry.links, [{ itemId: "item1", productId: "product1" }]);
  assert.equal(entry.projectId, "project"); assert.equal(entry.clientId, "client");
  assert.equal(entry.revision, 4); assert.equal(entry.stateHash, valueHash(f.snapshot.proposal.state));
  assert.equal(valueHash(f.snapshot), before, "capture must preserve business fields, KP state and dates");
});

test("normalization does not guess by title, suffix, deleted row, duplicate number or foreign ownership", () => {
  const scenarios = [
    [{ id: "other", projectId: "project", number: "117-1", deletedAt: null }],
    [{ id: "other", projectId: "project", number: "117.1", deletedAt: "2026-01-01" }],
    [{ id: "other", projectId: "foreign", number: "117.1", deletedAt: null }],
    [{ id: "one", projectId: "project", number: "117.1", deletedAt: null }, { id: "two", projectId: "project", number: "117.1", deletedAt: null }],
  ];
  for (const products of scenarios) {
    const f = rows(); f.snapshot.products = products;
    assert.deepEqual(normalizationEntry(f.source, f.snapshot).links, []);
  }
  const f = rows(); f.snapshot.owners.push({ id: "another-item", productId: "product1" });
  assert.deepEqual(normalizationEntry(f.source, f.snapshot).links, []);
});

test("normalization preserves legal existing links and rejects mismatched project/source/current ownership", () => {
  const f = rows(); f.snapshot.proposal.projectId = "project"; f.snapshot.proposal.clientId = "client";
  f.snapshot.items[0].productId = "product1"; f.snapshot.owners.push({ id: "item1", productId: "product1" });
  assert.deepEqual(normalizationEntry(f.source, f.snapshot).links, [{ itemId: "item1", productId: "product1" }]);
  for (const mutate of [
    (v: ReturnType<typeof rows>) => { v.snapshot.project.number = "118"; },
    (v: ReturnType<typeof rows>) => { v.snapshot.proposal.sourceId = "foreign"; },
    (v: ReturnType<typeof rows>) => { v.snapshot.proposal.projectId = "foreign"; },
    (v: ReturnType<typeof rows>) => { v.snapshot.items[0].productId = "foreign-product"; },
  ]) {
    const changed = rows(); mutate(changed);
    assert.throws(() => normalizationEntry(changed.source, changed.snapshot), code("KP_NORMALIZATION_MAPPING_CHANGED"));
  }
});

test("reviewed plan pins all 23 imported IDs, revision/state/full rows, target and operation", async () => {
  const f = archiveFixture(), manifest = await prepareArchiveManifest(f.source, f.target, f.deps, f.links);
  const proposals = manifest.proposals.map(source => {
    const current = rows(source.sourceNumber!);
    current.snapshot.proposal = { ...current.snapshot.proposal, id: source.id, sourceId: source.sourceId, sourceNumber: source.sourceNumber };
    current.snapshot.project.id = `project-${source.sourceNumber}`;
    current.snapshot.items = [];
    return normalizationEntry(source, current.snapshot);
  });
  const plan = { schema: 1, kind: "KP_IMPORTED_PROPOSAL_NORMALIZATION", manifestHash: manifest.sha256, target: manifest.target,
    operatorId: "operator", operationId: "00000000-0000-4000-8000-000000000189", proposals };
  assert.equal(valueHash(parseImportedProposalNormalization(plan, manifest)), valueHash(plan));
  for (const changed of [{ ...plan, proposals: proposals.slice(1) }, { ...plan, manifestHash: "0".repeat(64) },
    { ...plan, proposals: [...proposals.slice(1), proposals[1]] }, { ...plan, unexpected: true }])
    assert.throws(() => parseImportedProposalNormalization(changed, manifest), code("KP_NORMALIZATION_PLAN_INVALID"));
});

/** SQL reader double: данные текущего КП намеренно отличаются, business writers отсутствуют. Native-проверка вынесена Root. */
async function publishedSqlFixture() {
  const f = archiveFixture(), manifest = await prepareArchiveManifest(f.source, f.target, f.deps, f.links), queries: string[] = [];
  const receipts = new Map<string, JsonObject>(), missingVersions = new Set<string>(), purged = new Set<string>(), changedObjects = new Set<string>();
  const receipt = (id: string, entity: string, entityId: string, action: string, newValue: JsonObject) => receipts.set(id, { id, entity, entityId, action, newValue, actorId: "importer", actorType: "user", source: "cli" });
  receipt(reserveReceiptId(manifest.sha256), "kpArchiveImport", manifest.sha256, "archive.reserve", archiveReserveValue(manifest));
  receipt(publishReceiptId(manifest.sha256), "kpArchiveImport", manifest.sha256, "archive.publish", archivePublishValue(manifest));
  for (const proposal of manifest.proposals) receipt(docReceiptId(proposal.id), "kpArchiveDocument", proposal.id, "archive.document", archiveProposalProvenance(manifest, proposal));
  for (const settings of manifest.settings) receipt(`kp.archive.settings:${settings.id}`, "kpArchiveContract", settings.id, "archive.settings", { schema: 1, sourceHash: settings.sourceHash, rawBase64: settings.rawBase64 });
  for (const object of allArchiveObjects(manifest)) f.blobs.set(object.key, f.cloud.get(object.source.area + ":" + object.source.key)!.bytes);
  const pruneJobs: { payload: unknown; result: unknown }[] = [], uploadJobs = new Map<string, JsonObject>();
  const client = { async query(sql: string, values: unknown[] = []) {
    queries.push(sql); const key = String(values[0]); let result: unknown[] = [];
    if (/^(INSERT|UPDATE|DELETE)\b/.test(sql)) throw Error("PUBLISHED_REPLAY_MUST_NOT_WRITE");
    if (sql.includes("current_database()")) result = [{ database: "pero_crm", schema: "public", user: "pero" }];
    else if (sql.includes('FROM "User"')) result = [{ active: true, roles: ["ADMIN"] }];
    else if (sql.includes('FROM "ChangeLog"')) {
      if (sql.includes("action='archive.recovery.publish'")) result = [...receipts.values()].filter(row => row.entity === "kpArchiveRecovery" && row.entityId === key && row.action === "archive.recovery.publish" && row.actorId === values[1]).map(row => ({ row }));
      else { const row = receipts.get(key); result = row ? [sql.includes("to_jsonb") ? { row } : row] : []; }
    }
    else if (sql.includes('FROM "CommercialProposal"')) {
      const proposal = manifest.proposals.find(row => row.id === key)!;
      result = [{ sourceId: proposal.sourceId, createdById: "importer", createdAt: proposal.createdAt,
        projectId: "linked-project", clientId: "linked-client", isArchive: false, revision: 11, currency: "BYN", rate: "3.2", state: { items: [{ id: "new-reordered-item" }] } }];
    } else if (sql.includes('FROM "ProposalItem"') || sql.includes('FROM "ProposalCurrentMedia"') || sql.includes('FROM "ProposalContractSource"')) throw Error("CURRENT_MUTABLE_BINDINGS_MUST_NOT_BE_RECONCILED");
    else if (sql.includes('FROM "ProposalVersionMedia"')) result = manifest.proposals.find(row => row.id === key)!.media.map(row => ({ mediaId: row.id })).sort((a, b) => a.mediaId.localeCompare(b.mediaId));
    else if (sql.includes('FROM "ProposalVersion"')) {
      const proposal = manifest.proposals.find(row => row.versionId === key)!;
      result = missingVersions.has(key) ? [] : [{ state: proposal.state, provenance: archiveProposalVersionSnapshot(manifest, proposal), trigger: "IMPORT", revision: 0 }];
    } else if (sql.includes('FROM "ProposalJob"')) result = sql.includes('to_jsonb(t)') ? (values[0] as string[]).flatMap(id => uploadJobs.has(id) ? [{ row: uploadJobs.get(id) }] : []) : pruneJobs;
    else if (sql.includes('FROM "ProposalMedia"')) {
      const media = manifest.proposals.flatMap(row => row.media).find(row => row.id === key)!;
      if (sql.includes('AS "optimizedPurged"')) result = [{ uploadState: "READY", optimizedPurged: purged.has(media.optimized.id), originalPurged: false,
        optimizedHash: media.optimized.sha256, optimizedKey: media.optimized.key, originalHash: media.original?.sha256 ?? null, originalKey: media.original?.key ?? null, expiresAt: media.expiresAt }];
      else { const object = values[1] === "original" ? media.original! : media.optimized; result = [{ state: "READY", key: object.key + (changedObjects.has(object.id) ? "-foreign" : ""), sha256: object.sha256, size: object.size, mimeType: object.mimeType, binding: object.binding, owner: object.proposalId, retiring: purged.has(object.id) }]; }
    } else if (sql.includes('FROM "ProposalContractVersion"')) {
      const docx = manifest.docx.find(row => row.versionId === key)!;
      result = [{ key: docx.artifact!.key, sha256: docx.artifact!.sha256, size: docx.artifact!.size, state: "READY", createdAt: docx.sourceObject.modifiedAt }];
    } else if (sql.includes('FROM "ProposalContract"')) result = [{ id: key, settings: { number: "Последующая редакция" } }];
    else if (sql.includes('FROM "ProposalArtifact"')) {
      const object = allArchiveObjects(manifest).find(row => row.artifactId === key)!;
      result = [{ state: "READY", key: object.key, sha256: object.sha256, size: object.size, mimeType: object.mimeType, binding: object.binding, owner: object.contractId, retiring: false }];
    }
    return { rows: result, rowCount: result.length };
  } } as unknown as PoolClient;
  const store = createArchiveSqlStore(client, { actorId: "operator", guardTarget: async () => {}, baseline: async () => "unchanged" });
  return { ...f, manifest, store, receipts, missingVersions, purged, changedObjects, pruneJobs, uploadJobs, queries };
}

async function publishedRecoverySqlFixture() {
  const f = await publishedSqlFixture(), objects = allArchiveObjects(f.manifest), operatorId = "recovery-operator";
  const ids = archiveRecoveryReceiptIds(f.manifest, "00000000-0000-4000-8000-000000000189");
  f.receipts.get(publishReceiptId(f.manifest.sha256))!.actorId = operatorId;
  const common = { schema: 1, manifestHash: f.manifest.sha256, reservationReceiptId: reserveReceiptId(f.manifest.sha256),
    reservationRowHash: valueHash(f.receipts.get(reserveReceiptId(f.manifest.sha256))), reservationActorId: "importer", operatorId,
    operationId: "00000000-0000-4000-8000-000000000189", targetHash: valueHash(f.manifest.target), witnessHash: "a".repeat(64),
    program: { sourceRevision: "b".repeat(40), entrySha256: "c".repeat(64) } };
  for (const [id, completed] of [[ids.reserve, false], [ids.publish, true]] as const) f.receipts.set(id, {
    id, actorId: operatorId, actorType: "user", source: "cli", entity: "kpArchiveRecovery", entityId: f.manifest.sha256,
    action: completed ? "archive.recovery.publish" : "archive.recovery.reserve", newValue: { ...structuredClone(common),
      verifiedObjects: Object.fromEntries((completed ? objects : objects.slice(0, 1)).map(row => [row.id, row.sha256])) },
  });
  const abandoned = archiveRecoveryReceiptIds(f.manifest, "00000000-0000-4000-8000-000000000188");
  f.receipts.set(abandoned.reserve, { ...structuredClone(f.receipts.get(ids.reserve)!), id: abandoned.reserve,
    newValue: { ...structuredClone(common), operationId: "00000000-0000-4000-8000-000000000188", verifiedObjects: {} } });
  for (const jobId of new Set(objects.map(row => row.jobId))) {
    const group = objects.filter(row => row.jobId === jobId), first = group[0], original = group.find(row => row.role === "original"), optimized = group.find(row => row.role === "optimized");
    const object = (row: typeof first) => ({ key: row.key, sha256: row.sha256, size: row.size, mimeType: row.mimeType });
    const payload = { schema: 1, kind: "UPLOAD_MEDIA", proposalId: first.proposalId, mediaId: first.mediaId, artifactId: first.artifactId, contractId: first.contractId,
      binding: first.binding, original: original ? object(original) : null, optimized: optimized ? object(optimized) : null,
      archiveImport: { manifestHash: f.manifest.sha256, sourceNamespace: f.manifest.sourceNamespace, archiveRole: first.role === "docx" ? "DOCX" : "IMAGE", actorId: "importer" },
      fingerprint: valueHash({ actorId: "importer", manifestHash: f.manifest.sha256, objects: group }) };
    f.uploadJobs.set(jobId, { id: jobId, proposalId: first.proposalId, contractId: null, kind: "UPLOAD_MEDIA", state: "SUCCEEDED", createdById: "importer",
      dedupeKey: `kp:archive:upload:${jobId}`, payload, result: { archiveManifestHash: f.manifest.sha256, verified: Object.fromEntries(group.map(row => [row.id, row.sha256])) }, leaseOwner: null, leaseUntil: null });
  }
  return { ...f, recoveryIds: ids };
}

test("published SQL replay accepts changed current KP/settings/bindings and only verifies owned immutable history", async () => {
  const f = await publishedSqlFixture(), result = await applyArchiveManifest(f.manifest, { ...f.options(f.manifest), store: f.store });
  assert.equal(result.mode, "applied"); if (result.mode === "applied") assert.equal(result.replayed, true);
  assert.equal(f.counters.puts, 0); assert.equal(f.queries.some(sql => /^(INSERT|UPDATE|DELETE)\b/.test(sql)), false);
  const original = f.receipts.get(docReceiptId(f.manifest.proposals[0].id))!;
  original.newValue = { changed: true };
  await assert.rejects(f.store.reconcile(f.manifest), code("ARCHIVE_RECONCILIATION_MISMATCH"));
});

test("published SQL replay preserves proven pruned IMPORT and purged media without recreating bytes", async () => {
  const f = await publishedSqlFixture(), proposal = f.manifest.proposals[0], object = proposal.media[0].optimized;
  f.missingVersions.add(proposal.versionId); f.purged.add(object.id); f.blobs.delete(object.key);
  await assert.rejects(f.store.reconcile(f.manifest), code("ARCHIVE_IMPORT_VERSION_MISSING"));
  f.pruneJobs.push({ payload: { schema: 1, kind: "ACCEPTED_RETENTION", proposalId: proposal.id, acceptedVersionId: "later-version", retentionEpoch: 1 },
    result: { manifest: makeRetentionManifest(proposal.id, [], [proposal.versionId]), objects: {} } });
  const result = await applyArchiveManifest(f.manifest, { ...f.options(f.manifest), store: f.store });
  assert.equal(result.mode, "applied"); if (result.mode === "applied") assert.deepEqual(result.reconciliation.policyPurgedObjectIds, [object.id]);
  assert.equal(f.counters.puts, 0); assert.equal(f.blobs.has(object.key), false);
});

test("published SQL replay rejects changed publish ownership or source object facts", async () => {
  const f = await publishedSqlFixture(), publish = f.receipts.get(publishReceiptId(f.manifest.sha256))!;
  const value = publish.newValue as JsonObject; value.proposalIds = [];
  await assert.rejects(f.store.reserve(f.manifest, "owner"), code("ARCHIVE_RECEIPT_CONFLICT"));
  publish.newValue = archivePublishValue(f.manifest);
  f.changedObjects.add(f.manifest.proposals[0].media[0].optimized.id);
  await assert.rejects(f.store.reconcile(f.manifest), code("ARCHIVE_TARGET_OBJECT_CHANGED"));
});

test("published SQL replay accepts only the exact completed ADMIN recovery pair and preserves original creators", async () => {
  const f = await publishedRecoverySqlFixture(), before = valueHash([...f.receipts]);
  const result = await applyArchiveManifest(f.manifest, { ...f.options(f.manifest), store: f.store });
  assert.equal(result.mode, "applied"); if (result.mode === "applied") assert.equal(result.replayed, true);
  assert.equal(valueHash([...f.receipts]), before); assert.equal(f.counters.puts, 0);
  assert.ok([...f.uploadJobs.values()].every(row => row.createdById === "importer"));
});

test("published recovery actor exception rejects missing, ambiguous or tampered audit/ledger evidence", async () => {
  const mutations: [string, (f: Awaited<ReturnType<typeof publishedRecoverySqlFixture>>) => void][] = [
    ["missing matching reserve", f => { f.receipts.delete(f.recoveryIds.reserve); }],
    ["different original reserve hash", f => { for (const id of Object.values(f.recoveryIds)) (f.receipts.get(id)!.newValue as JsonObject).reservationRowHash = "f".repeat(64); }],
    ["different original actor", f => { for (const id of Object.values(f.recoveryIds)) (f.receipts.get(id)!.newValue as JsonObject).reservationActorId = "foreign"; }],
    ["different recovery operator", f => { (f.receipts.get(f.recoveryIds.publish)!.newValue as JsonObject).operatorId = "foreign"; }],
    ["different operation", f => { (f.receipts.get(f.recoveryIds.publish)!.newValue as JsonObject).operationId = "00000000-0000-4000-8000-000000000187"; }],
    ["changed program", f => { (f.receipts.get(f.recoveryIds.publish)!.newValue as JsonObject).program = { sourceRevision: "b".repeat(40), entrySha256: "d".repeat(64) }; }],
    ["incomplete final verification", f => { (f.receipts.get(f.recoveryIds.publish)!.newValue as JsonObject).verifiedObjects = {}; }],
    ["foreign reserved verification", f => { (f.receipts.get(f.recoveryIds.reserve)!.newValue as JsonObject).verifiedObjects = { foreign: "a".repeat(64) }; }],
    ["changed job creator", f => { [...f.uploadJobs.values()][0].createdById = "foreign"; }],
    ["changed job payload", f => { [...f.uploadJobs.values()][0].payload = {}; }],
    ["changed readback", f => { [...f.uploadJobs.values()][0].result = { archiveManifestHash: f.manifest.sha256, verified: {} }; }],
    ["ambiguous successful audits", f => { const row = structuredClone(f.receipts.get(f.recoveryIds.publish)!); f.receipts.set("duplicate-success", { ...row, id: "duplicate-success" }); }],
  ];
  for (const [label, mutate] of mutations) {
    const f = await publishedRecoverySqlFixture(); mutate(f);
    await assert.rejects(f.store.reconcile(f.manifest), error => error instanceof ArchiveImportError && ["ARCHIVE_RECOVERY_AUDIT_CHANGED", "ARCHIVE_RECOVERY_OPERATION_CHANGED", "ARCHIVE_RECOVERY_VERIFIED_OBJECT_CHANGED"].includes(error.code), label);
  }
});
