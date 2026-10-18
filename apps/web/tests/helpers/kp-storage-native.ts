import assert from "node:assert/strict";
import type { PoolClient } from "pg";

type NativeDb = Pick<PoolClient, "query">;
type Fixture = Record<string, unknown>;

/** Только внутри guarded BEGIN/ROLLBACK; бизнес-сущности и внешнее хранилище не изменяются. */
export async function verifyKpStorageNative(db: NativeDb, runId: string) {
  assert.match(runId, /^[a-f0-9-]{36}$/i, "KP_NATIVE_RUN_ID_REQUIRED");
  const prefix = `__kp180_${runId}_`;
  const now = new Date("2026-10-18T09:00:00.000Z");
  const sha256 = "a".repeat(64);
  const binding = { endpoint: "http://127.0.0.1:9000", bucket: "native-test", region: "us-east-1" };
  const checks: string[] = [];
  let savepoint = 0;
  const identifier = (name: string) => {
    assert.match(name, /^[A-Za-z_][A-Za-z0-9_]*$/, "KP_NATIVE_IDENTIFIER_INVALID");
    return `"${name}"`;
  };
  const insert = async (table: string, data: Fixture) => {
    const names = Object.keys(data);
    const result = await db.query(
      `INSERT INTO public.${identifier(table)} (${names.map(identifier).join(",")}) VALUES (${names.map((_, index) => `$${index + 1}`).join(",")})`,
      Object.values(data).map(value => typeof value === "object" && value !== null && !(value instanceof Date) ? JSON.stringify(value) : value),
    );
    assert.equal(result.rowCount, 1, "KP_NATIVE_FIXTURE_INSERT_REQUIRED");
  };
  const reject = async (name: string, code: "23503" | "23505" | "23514", action: () => Promise<unknown>) => {
    const point = `kp180_expected_${++savepoint}`;
    await db.query(`SAVEPOINT ${point}`);
    let actualCode: unknown;
    try { await action(); }
    catch (error) {
      if (typeof error === "object" && error !== null && "code" in error) actualCode = error.code;
    }
    finally {
      await db.query(`ROLLBACK TO SAVEPOINT ${point}`);
      await db.query(`RELEASE SAVEPOINT ${point}`);
    }
    assert.equal(actualCode, code, `KP_NATIVE_${name.toUpperCase()}_REJECTION_REQUIRED`);
    checks.push(name);
  };
  const proposal = (suffix: string, extra: Fixture = {}): Fixture => ({
    id: prefix + suffix, sourceId: prefix + "source_" + suffix, sourceNumber: "180-archive",
    isArchive: true, state: { items: [], additional: { preserved: true } }, updatedAt: now, ...extra,
  });
  const item = (suffix: string, proposalId: string, position = 1, extra: Fixture = {}): Fixture => ({
    id: prefix + suffix, proposalId, position, state: { title: "Native fixture" }, updatedAt: now, ...extra,
  });
  const media = (suffix: string, proposalId: string, extra: Fixture = {}): Fixture => ({
    id: prefix + suffix, proposalId, storageBinding: binding,
    originalKey: `kp/proposals/${proposalId}/original/${suffix}.png`, optimizedKey: `kp/proposals/${proposalId}/optimized/${suffix}.webp`,
    originalHash: sha256, optimizedHash: sha256, originalSize: 64, optimizedSize: 32,
    mimeType: "image/webp", fileName: "native.webp", width: 100, height: 80,
    expiresAt: new Date("2027-10-18T09:00:00.000Z"), ...extra,
  });
  const artifact = (suffix: string, owner: { proposalId: string } | { contractId: string }, extra: Fixture = {}): Fixture => ({
    id: prefix + suffix, ...owner, kind: "proposalId" in owner ? "PDF" : "DOCX", state: "READY",
    storageBinding: binding, key: "proposalId" in owner ? `kp/proposals/${owner.proposalId}/exports/${suffix}.pdf` : `kp/contracts/${owner.contractId}/exports/${suffix}.docx`, sha256, size: 128,
    fileName: "proposalId" in owner ? "native.pdf" : "native.docx",
    mimeType: "proposalId" in owner ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ...extra,
  });
  const version = (suffix: string, proposalId: string, pdfArtifactId: string | null, extra: Fixture = {}): Fixture => ({
    id: prefix + suffix, proposalId, revision: 0, trigger: "PDF", state: { items: [] },
    pricingSnapshot: { currency: "BYN", total: "0.00" }, templateVersion: "native-180", pdfArtifactId, ...extra,
  });
  const contract = (suffix: string, primaryProposalId: string, extra: Fixture = {}): Fixture => ({
    id: prefix + suffix, primaryProposalId, settings: {}, updatedAt: now, ...extra,
  });
  const contractVersion = (suffix: string, contractId: string, docxArtifactId: string, extra: Fixture = {}): Fixture => ({
    id: prefix + suffix, contractId, settingsSnapshot: {}, clientSnapshot: {}, sourcesSnapshot: [],
    templateVersion: "native-180", docxArtifactId, ...extra,
  });
  const job = (suffix: string, owner: { proposalId: string } | { contractId: string }, extra: Fixture = {}): Fixture => ({
    id: prefix + suffix, ...owner, kind: "proposalId" in owner ? "PDF" : "CONTRACT",
    dedupeKey: prefix + "dedupe_" + suffix, payload: {}, updatedAt: now, ...extra,
  });

  const p1 = prefix + "proposal_1", p2 = prefix + "proposal_2";
  await insert("CommercialProposal", proposal("proposal_1"));
  await insert("CommercialProposal", proposal("proposal_2", {
    currency: "USD", rate: "3.2500000000", rateDate: "2026-10-18", rateSource: "MANUAL",
  }));
  const read = await db.query<{ state: unknown; projectId: string | null; clientId: string | null }>(
    'SELECT "state", "projectId", "clientId" FROM public."CommercialProposal" WHERE "id"=$1', [p1],
  );
  assert.deepEqual(read.rows, [{ state: proposal("proposal_1").state, projectId: null, clientId: null }], "KP_NATIVE_ARCHIVE_ROUND_TRIP_REQUIRED");
  checks.push("archive_without_business_entities", "fixed_manual_rate", "unknown_state_fields_round_trip");
  await reject("source_id_unique", "23505", () => insert("CommercialProposal", proposal("duplicate_source", { sourceId: prefix + "source_proposal_1" })));
  await reject("proposal_object_state", "23514", () => insert("CommercialProposal", proposal("invalid_state", { state: [] })));
  await reject("proposal_nonnegative_revision", "23514", () => insert("CommercialProposal", proposal("invalid_revision", { revision: -1 })));
  await reject("rate_positive", "23514", () => insert("CommercialProposal", proposal("invalid_rate", { currency: "USD", rate: "0", rateDate: "2026-10-18", rateSource: "MANUAL" })));
  await reject("rate_complete_tuple", "23514", () => insert("CommercialProposal", proposal("incomplete_rate", { currency: "USD", rate: "3.25", rateSource: "MANUAL" })));
  await reject("byn_rate_one", "23514", () => insert("CommercialProposal", proposal("invalid_byn_rate", { rate: "2", rateDate: "2026-10-18", rateSource: "MANUAL" })));
  await reject("retention_epoch_nonnegative", "23514", () => insert("CommercialProposal", proposal("invalid_epoch", { retentionEpoch: -1 })));

  await insert("ProposalItem", item("item_1", p1));
  await reject("active_item_position_unique", "23505", () => insert("ProposalItem", item("item_duplicate", p1)));
  await insert("ProposalItem", item("item_deleted", p1, 1, { deletedAt: now }));
  await insert("ProposalItem", item("item_other_proposal", p2));
  await reject("item_positive_position", "23514", () => insert("ProposalItem", item("item_zero", p1, 0)));
  await reject("item_object_state", "23514", () => insert("ProposalItem", item("item_invalid_state", p1, 2, { state: [] })));
  checks.push("soft_deleted_item_position_reusable", "item_positions_scoped_to_proposal");

  const m1 = prefix + "media_1", m2 = prefix + "media_2";
  await insert("ProposalMedia", media("media_1", p1));
  await insert("ProposalMedia", media("media_2", p2));
  await reject("media_private_key_prefix", "23514", () => insert("ProposalMedia", media("media_bad_prefix", p1, { originalKey: "public/native.png" })));
  await reject("media_exact_owner_key_prefix", "23514", () => insert("ProposalMedia", media("media_wrong_owner", p1, { originalKey: `kp/proposals/${p1.replace("__kp180", "zzkp180")}/original/namespace.png` })));
  await reject("media_sha256", "23514", () => insert("ProposalMedia", media("media_bad_hash", p1, { originalHash: "invalid" })));
  await reject("media_positive_size", "23514", () => insert("ProposalMedia", media("media_bad_size", p1, { originalSize: 0 })));
  await reject("media_object_binding", "23514", () => insert("ProposalMedia", media("media_bad_binding", p1, { storageBinding: [] })));
  await reject("media_complete_original_tuple", "23514", () => insert("ProposalMedia", media("media_incomplete", p1, { originalHash: null })));

  const c1 = prefix + "contract_1", c2 = prefix + "contract_2";
  await insert("ProposalContract", contract("contract_1", p1));
  await insert("ProposalContract", contract("contract_2", p2));
  await reject("primary_contract_unique", "23505", () => insert("ProposalContract", contract("contract_duplicate", p1)));
  await reject("contract_object_settings", "23514", () => db.query('UPDATE public."ProposalContract" SET "settings"=$1 WHERE "id"=$2', ["[]", c1]));

  const pdf1 = prefix + "pdf_1", pdf2 = prefix + "pdf_2", docx1 = prefix + "docx_1", docx2 = prefix + "docx_2";
  await insert("ProposalArtifact", artifact("pdf_1", { proposalId: p1 }));
  await insert("ProposalArtifact", artifact("pdf_2", { proposalId: p2 }));
  await insert("ProposalArtifact", artifact("docx_1", { contractId: c1 }));
  await insert("ProposalArtifact", artifact("docx_2", { contractId: c2 }));
  await reject("artifact_exactly_one_owner", "23514", () => insert("ProposalArtifact", artifact("artifact_both_owners", { proposalId: p1 }, { contractId: c1 })));
  await reject("artifact_private_key_prefix", "23514", () => insert("ProposalArtifact", artifact("artifact_bad_prefix", { proposalId: p1 }, { key: "public/native.pdf" })));
  await reject("artifact_exact_owner_key_prefix", "23514", () => insert("ProposalArtifact", artifact("artifact_wrong_owner", { proposalId: p1 }, { key: `kp/proposals/${p1.replace("__kp180", "zzkp180")}/exports/namespace.pdf` })));
  await reject("artifact_sha256", "23514", () => insert("ProposalArtifact", artifact("artifact_bad_hash", { proposalId: p1 }, { sha256: "invalid" })));
  await reject("artifact_positive_size", "23514", () => insert("ProposalArtifact", artifact("artifact_bad_size", { proposalId: p1 }, { size: 0 })));
  await reject("artifact_object_binding", "23514", () => insert("ProposalArtifact", artifact("artifact_bad_binding", { proposalId: p1 }, { storageBinding: [] })));
  await reject("artifact_owner_kind", "23514", () => insert("ProposalArtifact", artifact("artifact_wrong_kind", { proposalId: p1 }, { kind: "DOCX" })));

  const v1 = prefix + "version_1", v2 = prefix + "version_2";
  await insert("ProposalVersion", version("version_1", p1, pdf1));
  await insert("ProposalVersion", version("version_2", p2, pdf2));
  await insert("ProposalVersion", version("version_import_without_pdf", p2, null, { trigger: "IMPORT" }));
  await db.query('UPDATE public."CommercialProposal" SET "acceptedVersionId"=$1, "acceptedAt"=$2 WHERE "id"=$3', [v1, now, p1]);
  checks.push("own_pdf_and_accepted_version");
  await reject("cross_proposal_pdf_denied", "23503", () => insert("ProposalVersion", version("version_wrong_pdf", p1, pdf2)));
  await reject("cross_proposal_accepted_version_denied", "23503", () => db.query('UPDATE public."CommercialProposal" SET "acceptedVersionId"=$1 WHERE "id"=$2', [v2, p1]));
  await reject("acceptance_complete_tuple", "23514", () => db.query('UPDATE public."CommercialProposal" SET "acceptedAt"=NULL WHERE "id"=$1', [p1]));
  await reject("version_immutable", "23514", () => db.query('UPDATE public."ProposalVersion" SET "state"=$1 WHERE "id"=$2', [{ items: [], changed: true }, v1]));
  await reject("version_object_state", "23514", () => insert("ProposalVersion", version("version_invalid_state", p1, pdf1, { state: [] })));
  await reject("version_object_pricing", "23514", () => insert("ProposalVersion", version("version_invalid_pricing", p1, pdf1, { pricingSnapshot: [] })));
  await reject("published_version_requires_pdf", "23514", () => insert("ProposalVersion", version("version_missing_pdf", p1, null)));

  await insert("ProposalCurrentMedia", { proposalId: p1, mediaId: m1 });
  await insert("ProposalVersionMedia", { proposalId: p1, versionId: v1, mediaId: m1 });
  checks.push("owned_current_and_version_media");
  await reject("cross_proposal_current_media_denied", "23503", () => insert("ProposalCurrentMedia", { proposalId: p1, mediaId: m2 }));
  await reject("current_media_link_unique", "23505", () => insert("ProposalCurrentMedia", { proposalId: p1, mediaId: m1 }));
  await reject("cross_proposal_version_media_denied", "23503", () => insert("ProposalVersionMedia", { proposalId: p1, versionId: v1, mediaId: m2 }));
  await reject("cross_proposal_version_link_denied", "23503", () => insert("ProposalVersionMedia", { proposalId: p1, versionId: v2, mediaId: m1 }));

  await insert("ProposalContractSource", { contractId: c1, proposalId: p1, position: 1 });
  await insert("ProposalContractSource", { contractId: c1, proposalId: p2, position: 2 });
  await reject("contract_source_unique", "23505", () => insert("ProposalContractSource", { contractId: c1, proposalId: p1, position: 3 }));
  await reject("contract_source_position_unique", "23505", () => insert("ProposalContractSource", { contractId: c2, proposalId: p1, position: 1 }).then(() => insert("ProposalContractSource", { contractId: c2, proposalId: p2, position: 1 })));
  await reject("contract_source_positive_position", "23514", () => insert("ProposalContractSource", { contractId: c2, proposalId: p1, position: 0 }));

  const disposableVersion = prefix + "version_disposable", cv1 = prefix + "contract_version_1";
  await insert("ProposalVersion", version("version_disposable", p1, pdf1));
  await insert("ProposalVersionMedia", { proposalId: p1, versionId: disposableVersion, mediaId: m1 });
  const sourceSnapshot = [{ proposalId: p1, versionId: disposableVersion, revision: 0 }];
  await insert("ProposalContractVersion", contractVersion("contract_version_1", c1, docx1, { sourcesSnapshot: sourceSnapshot }));
  await reject("bound_pdf_key_immutable", "23514", () => db.query('UPDATE public."ProposalArtifact" SET "key"=$1 WHERE "id"=$2', [`kp/proposals/${p1}/exports/rebound.pdf`, pdf1]));
  await reject("bound_pdf_storage_immutable", "23514", () => db.query('UPDATE public."ProposalArtifact" SET "storageBinding"=$1 WHERE "id"=$2', [{ ...binding, bucket: "native-other" }, pdf1]));
  await reject("bound_pdf_hash_immutable", "23514", () => db.query('UPDATE public."ProposalArtifact" SET "sha256"=$1 WHERE "id"=$2', ["b".repeat(64), pdf1]));
  const lifecycleArtifact = prefix + "pdf_lifecycle";
  await insert("ProposalArtifact", artifact("pdf_lifecycle", { proposalId: p1 }));
  await db.query('UPDATE public."ProposalArtifact" SET "state"=\'RETIRING\' WHERE "id"=$1', [lifecycleArtifact]);
  await db.query('UPDATE public."ProposalArtifact" SET "state"=\'DELETED\', "deletedAt"=$1 WHERE "id"=$2', [now, lifecycleArtifact]);
  assert.deepEqual((await db.query<{ state: string; deleted: boolean }>('SELECT "state", "deletedAt" IS NOT NULL AS deleted FROM public."ProposalArtifact" WHERE "id"=$1', [lifecycleArtifact])).rows, [{ state: "DELETED", deleted: true }], "KP_NATIVE_ARTIFACT_LIFECYCLE_REQUIRED");
  checks.push("artifact_lifecycle_preserves_identity");
  await reject("cross_contract_docx_denied", "23503", () => insert("ProposalContractVersion", contractVersion("contract_version_wrong_docx", c1, docx2)));
  await reject("contract_version_immutable", "23514", () => db.query('UPDATE public."ProposalContractVersion" SET "settingsSnapshot"=$1 WHERE "id"=$2', [{ changed: true }, cv1]));
  await reject("contract_version_object_settings", "23514", () => insert("ProposalContractVersion", contractVersion("contract_version_bad_settings", c1, docx1, { settingsSnapshot: [] })));
  await reject("contract_version_object_client", "23514", () => insert("ProposalContractVersion", contractVersion("contract_version_bad_client", c1, docx1, { clientSnapshot: [] })));
  await reject("contract_version_array_sources", "23514", () => insert("ProposalContractVersion", contractVersion("contract_version_bad_sources", c1, docx1, { sourcesSnapshot: {} })));
  await db.query('DELETE FROM public."ProposalVersion" WHERE "id"=$1', [disposableVersion]);
  assert.equal((await db.query('SELECT 1 FROM public."ProposalVersionMedia" WHERE "versionId"=$1', [disposableVersion])).rowCount, 0, "KP_NATIVE_VERSION_MEDIA_CASCADE_REQUIRED");
  assert.equal((await db.query('SELECT 1 FROM public."ProposalMedia" WHERE "id"=$1', [m1])).rowCount, 1, "KP_NATIVE_SHARED_MEDIA_PRESERVED");
  assert.deepEqual((await db.query<{ sourcesSnapshot: unknown }>('SELECT "sourcesSnapshot" FROM public."ProposalContractVersion" WHERE "id"=$1', [cv1])).rows, [{ sourcesSnapshot: sourceSnapshot }], "KP_NATIVE_CONTRACT_SNAPSHOT_PRESERVED");
  checks.push("own_contract_docx", "contract_survives_source_version_pruning", "shared_media_survives_version_pruning");
  await reject("accepted_version_delete_denied", "23503", () => db.query('DELETE FROM public."ProposalVersion" WHERE "id"=$1', [v1]));

  await insert("ProposalJob", job("job_pdf", { proposalId: p1 }));
  await insert("ProposalJob", job("job_contract", { contractId: c1 }));
  await insert("ProposalJob", job("job_prune", { proposalId: p1 }, { kind: "PRUNE_VERSIONS", retentionEpoch: 0 }));
  await insert("ProposalJob", job("job_purge", { proposalId: p1 }, { kind: "PURGE_MEDIA" }));
  await insert("ProposalJob", job("job_processing", { proposalId: p1 }, { state: "PROCESSING", leaseOwner: prefix + "worker", leaseUntil: new Date("2026-10-18T09:05:00.000Z") }));
  checks.push("all_job_kinds_and_valid_lease");
  await reject("job_dedupe_unique", "23505", () => insert("ProposalJob", job("job_duplicate", { proposalId: p1 }, { dedupeKey: prefix + "dedupe_job_pdf" })));
  await reject("job_exactly_one_owner", "23514", () => insert("ProposalJob", job("job_both_owners", { proposalId: p1 }, { contractId: c1 })));
  await reject("job_contract_owner_kind", "23514", () => insert("ProposalJob", job("job_wrong_contract_owner", { proposalId: p1 }, { kind: "CONTRACT" })));
  await reject("job_proposal_owner_kind", "23514", () => insert("ProposalJob", job("job_wrong_proposal_owner", { contractId: c1 }, { kind: "PDF" })));
  await reject("job_processing_requires_lease", "23514", () => insert("ProposalJob", job("job_missing_lease", { proposalId: p1 }, { state: "PROCESSING" })));
  await reject("job_complete_lease_tuple", "23514", () => insert("ProposalJob", job("job_incomplete_lease", { proposalId: p1 }, { state: "PROCESSING", leaseOwner: prefix + "worker" })));
  await reject("job_nonprocessing_has_no_lease", "23514", () => insert("ProposalJob", job("job_stale_lease", { proposalId: p1 }, { leaseOwner: prefix + "worker", leaseUntil: now })));
  await reject("job_attempts_nonnegative", "23514", () => insert("ProposalJob", job("job_negative_attempts", { proposalId: p1 }, { attempts: -1 })));
  await reject("job_max_attempts_positive", "23514", () => insert("ProposalJob", job("job_no_attempts", { proposalId: p1 }, { maxAttempts: 0 })));
  await reject("job_object_payload", "23514", () => insert("ProposalJob", job("job_invalid_payload", { proposalId: p1 }, { payload: [] })));
  await reject("job_object_result", "23514", () => insert("ProposalJob", job("job_invalid_result", { proposalId: p1 }, { result: [] })));

  return { checks, passed: checks.length, fixtureTables: 11 };
}
