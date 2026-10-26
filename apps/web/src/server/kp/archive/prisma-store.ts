import type { PoolClient } from "pg";
import { archiveAssert, assertArchiveDatabaseIdentity, assertArchiveReservationRecovery, canonical, docReceiptId, isObject, publishReceiptId, reserveReceiptId, valueHash,
  type ArchiveManifest, type ArchiveObject, type ArchiveProposal, type ArchiveReservationRecovery, type ArchiveReservationWitness, type JsonObject } from "./contract";
import { allArchiveObjects } from "./manifest";
import type { ArchiveReconciliation, ArchiveStore } from "./apply";
import { archiveProposalProvenance, archiveProposalVersionSnapshot } from "./provenance";
import { parseRetentionProgress, retentionPayload } from "../retention-contract";

type JobRow = { id: string; proposalId: string | null; contractId: string | null; kind: string; createdById: string | null; dedupeKey: string;
  state: string; attempts: number; maxAttempts: number; leaseOwner: string | null; leaseUntil: unknown; liveLease: boolean; lastErrorCode: string | null; payload: JsonObject; result: JsonObject | null };
export type ArchiveReservationReader = { query<T extends Record<string, unknown>>(sql: string, parameters?: unknown[]): Promise<{ rows: T[] }> };
export const archiveCleanupId = (jobId: string) => "kp_archive_cleanup_" + valueHash(jobId);
export function archiveRecoveryReceiptIds(manifest: ArchiveManifest, operationId: string) {
  archiveAssert(/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(operationId), "ARCHIVE_RECOVERY_OPERATION_CHANGED");
  const prefix = `kp.archive.recovery:${manifest.sha256}:${operationId}`; return { reserve: prefix + ":reserve", publish: prefix + ":publish" };
}
export function archiveOwnedRows(manifest: ArchiveManifest, recoveryOperationId?: string) {
  const proposals = manifest.proposals.map(row => row.id), contracts = manifest.settings.map(row => row.id), objects = allArchiveObjects(manifest);
  const jobs = [...new Set(objects.map(row => row.jobId))];
  const entries: [string, string, string[]][] = [["CommercialProposal", "id", proposals], ["ProposalItem", "proposalId", proposals], ["ProposalVersion", "proposalId", proposals], ["ProposalMedia", "proposalId", proposals], ["ProposalCurrentMedia", "proposalId", proposals], ["ProposalVersionMedia", "proposalId", proposals], ["ProposalContract", "id", contracts], ["ProposalContractSource", "contractId", contracts], ["ProposalContractVersion", "contractId", contracts], ["ProposalArtifact", "contractId", contracts], ["ProposalJob", "id", [...jobs, ...jobs.map(archiveCleanupId)]],
    ["ChangeLog", "id", [reserveReceiptId(manifest.sha256), publishReceiptId(manifest.sha256), ...proposals.map(docReceiptId), ...contracts.map(id => `kp.archive.settings:${id}`), ...(recoveryOperationId ? Object.values(archiveRecoveryReceiptIds(manifest, recoveryOperationId)) : [])]]];
  return Object.fromEntries(entries.filter(([, , ids]) => ids.length).map(([table, column, ids]) => [table, { column, ids: [...new Set(ids)] }]));
}
export function archiveReserveValue(manifest: ArchiveManifest) {
  return { schema: 1, manifestHash: manifest.sha256, sourceNamespace: manifest.sourceNamespace, proposalIds: manifest.proposals.map(row => row.id), targetBindingHash: valueHash(manifest.target),
    documents: manifest.proposals.map(row => ({ proposalId: row.id, sourceId: row.sourceId, sourceHash: row.sourceHash })), objects: allArchiveObjects(manifest).map(row => ({ id: row.id, proposalId: row.proposalId, ...(row.mediaId ? { mediaId: row.mediaId } : { artifactId: row.artifactId }), operationJobId: row.jobId, binding: row.binding, key: row.key, sha256: row.sha256, size: row.size, mimeType: row.mimeType })) };
}
export function archivePublishValue(manifest: ArchiveManifest) {
  return { schema: 1, manifestHash: manifest.sha256, proposalIds: manifest.proposals.map(row => row.id), counts: manifest.counts,
    verifiedObjectHashes: Object.fromEntries(allArchiveObjects(manifest).map(row => [row.id, row.sha256])) };
}
const objectJson = (row: ArchiveObject) => ({ key: row.key, sha256: row.sha256, size: row.size, mimeType: row.mimeType });
function uploadPayload(manifest: ArchiveManifest, group: ArchiveObject[], actorId: string) {
  const first = group[0], original = group.find(row => row.role === "original"), optimized = group.find(row => row.role === "optimized");
  return { schema: 1, kind: "UPLOAD_MEDIA", proposalId: first.proposalId, mediaId: first.mediaId, artifactId: first.artifactId, contractId: first.contractId, binding: first.binding,
    original: original ? objectJson(original) : null, optimized: optimized ? objectJson(optimized) : null,
    archiveImport: { manifestHash: manifest.sha256, sourceNamespace: manifest.sourceNamespace, archiveRole: first.role === "docx" ? "DOCX" : "IMAGE", actorId }, fingerprint: valueHash({ actorId, manifestHash: manifest.sha256, objects: group }) };
}
function cleanupPayload(manifest: ArchiveManifest, group: ArchiveObject[]) {
  const first = group[0]; return first.mediaId ? { schema: 1, kind: "UNATTACHED_MEDIA", proposalId: first.proposalId, operationJobId: first.jobId, mediaId: first.mediaId, projectId: null, binding: first.binding, objects: group.map(objectJson) }
    : { schema: 1, kind: "ORPHAN_ARCHIVE_ARTIFACT", proposalId: first.proposalId, operationJobId: first.jobId, artifactId: first.artifactId, archiveReserveReceiptId: reserveReceiptId(manifest.sha256), archiveManifestHash: manifest.sha256, binding: first.binding, objects: group.map(objectJson) };
}
function verifiedResult(manifest: ArchiveManifest, group: ArchiveObject[], result: JsonObject | null) {
  if (result === null) return {};
  archiveAssert(canonical(Object.keys(result).sort()) === canonical(["archiveManifestHash", "verified"]) && result.archiveManifestHash === manifest.sha256 && isObject(result.verified), "ARCHIVE_RECOVERY_VERIFIED_OBJECT_CHANGED");
  archiveAssert(Object.entries(result.verified).every(([id, hash]) => group.some(object => object.id === id && object.sha256 === hash)), "ARCHIVE_RECOVERY_VERIFIED_OBJECT_CHANGED");
  return result.verified;
}
async function reservationRow(client: ArchiveReservationReader, manifest: ArchiveManifest) {
  const { rows } = await client.query<{ row: JsonObject }>('SELECT to_jsonb(t) AS row FROM "ChangeLog" t WHERE id=$1', [reserveReceiptId(manifest.sha256)]);
  const row = rows[0]?.row;
  archiveAssert(row && row.id === reserveReceiptId(manifest.sha256) && row.entity === "kpArchiveImport" && row.entityId === manifest.sha256 && row.action === "archive.reserve" && row.source === "cli" && row.actorType === "user" && typeof row.actorId === "string" && canonical(row.newValue) === canonical(archiveReserveValue(manifest)), "ARCHIVE_RECOVERY_RESERVE_CHANGED");
  return { row, actorId: row.actorId, hash: valueHash(row) };
}
/** После explicit ADMIN recovery публикацию подписывает оператор, а исходные creators/payload остаются прежними. */
async function verifyRecoveryPublication(client: ArchiveReservationReader, manifest: ArchiveManifest, original: { actorId: string; hash: string }, actorId: string) {
  const { rows } = await client.query<{ row: JsonObject }>('SELECT to_jsonb(t) AS row FROM "ChangeLog" t WHERE entity=\'kpArchiveRecovery\' AND "entityId"=$1 AND action=\'archive.recovery.publish\' AND "actorType"=\'user\' AND "actorId"=$2 AND source=\'cli\' ORDER BY id LIMIT 2', [manifest.sha256, actorId]);
  archiveAssert(rows.length === 1 && isObject(rows[0].row.newValue), "ARCHIVE_RECOVERY_AUDIT_CHANGED");
  const published = rows[0].row, value = published.newValue as JsonObject;
  archiveAssert(typeof value.operationId === "string" && typeof value.witnessHash === "string" && /^[a-f0-9]{64}$/.test(value.witnessHash) &&
    isObject(value.program) && canonical(Object.keys(value.program).sort()) === canonical(["entrySha256", "sourceRevision"]) &&
    typeof value.program.sourceRevision === "string" && /^[a-f0-9]{40}$/.test(value.program.sourceRevision) && typeof value.program.entrySha256 === "string" && /^[a-f0-9]{64}$/.test(value.program.entrySha256), "ARCHIVE_RECOVERY_AUDIT_CHANGED");
  const ids = archiveRecoveryReceiptIds(manifest, value.operationId), objects = allArchiveObjects(manifest);
  const common = { schema: 1, manifestHash: manifest.sha256, reservationReceiptId: reserveReceiptId(manifest.sha256), reservationRowHash: original.hash,
    reservationActorId: original.actorId, operatorId: actorId, operationId: value.operationId, targetHash: valueHash(manifest.target), witnessHash: value.witnessHash, program: value.program };
  const reserved = (await client.query<{ row: JsonObject }>('SELECT to_jsonb(t) AS row FROM "ChangeLog" t WHERE id=$1', [ids.reserve])).rows[0]?.row;
  for (const [row, id, completed] of [[reserved, ids.reserve, false], [published, ids.publish, true]] as const) {
    archiveAssert(row?.id === id && row.entity === "kpArchiveRecovery" && row.entityId === manifest.sha256 && row.action === (completed ? "archive.recovery.publish" : "archive.recovery.reserve") &&
      row.actorType === "user" && row.actorId === actorId && row.source === "cli" && isObject(row.newValue) && isObject(row.newValue.verifiedObjects) &&
      canonical(row.newValue) === canonical({ ...common, verifiedObjects: row.newValue.verifiedObjects }), "ARCHIVE_RECOVERY_AUDIT_CHANGED");
    verifiedResult(manifest, objects, { archiveManifestHash: manifest.sha256, verified: row.newValue.verifiedObjects });
    if (completed) archiveAssert(canonical(row.newValue.verifiedObjects) === canonical(Object.fromEntries(objects.map(object => [object.id, object.sha256]))), "ARCHIVE_RECOVERY_AUDIT_CHANGED");
  }
  const jobs = [...new Set(objects.map(object => object.jobId))], ledger = await client.query<{ row: JsonObject }>('SELECT to_jsonb(t) AS row FROM "ProposalJob" t WHERE id=ANY($1::text[]) ORDER BY id', [jobs]);
  archiveAssert(ledger.rows.length === jobs.length, "ARCHIVE_RECOVERY_OPERATION_CHANGED");
  for (const id of jobs) {
    const row = ledger.rows.find(entry => entry.row.id === id)?.row, group = objects.filter(object => object.jobId === id);
    archiveAssert(row?.kind === "UPLOAD_MEDIA" && row.proposalId === group[0].proposalId && row.contractId === null && row.createdById === original.actorId &&
      row.dedupeKey === `kp:archive:upload:${id}` && row.state === "SUCCEEDED" && row.leaseOwner === null && row.leaseUntil === null &&
      canonical(row.payload) === canonical(uploadPayload(manifest, group, original.actorId)) && canonical(row.result) === canonical({ archiveManifestHash: manifest.sha256, verified: Object.fromEntries(group.map(object => [object.id, object.sha256])) }), "ARCHIVE_RECOVERY_OPERATION_CHANGED");
  }
}
/** Неизменяемые receipts подтверждают импорт независимо от последующих обычных сохранений КП. */
export async function verifyPublishedArchiveOrigin(client: ArchiveReservationReader, manifest: ArchiveManifest) {
  const original = await reservationRow(client, manifest);
  const expected: [string, string, string, string, JsonObject][] = [
    [publishReceiptId(manifest.sha256), "kpArchiveImport", manifest.sha256, "archive.publish", archivePublishValue(manifest)],
    ...manifest.proposals.map(proposal => [docReceiptId(proposal.id), "kpArchiveDocument", proposal.id, "archive.document", archiveProposalProvenance(manifest, proposal)] as [string, string, string, string, JsonObject]),
    ...manifest.settings.map(settings => [`kp.archive.settings:${settings.id}`, "kpArchiveContract", settings.id, "archive.settings", { schema: 1, sourceHash: settings.sourceHash, rawBase64: settings.rawBase64 }] as [string, string, string, string, JsonObject]),
  ];
  for (const [id, entity, entityId, action, value] of expected) {
    const { rows } = await client.query<{ row: JsonObject }>('SELECT to_jsonb(t) AS row FROM "ChangeLog" t WHERE id=$1', [id]);
    const row = rows[0]?.row;
    archiveAssert(row?.entity === entity && row.entityId === entityId && row.action === action && row.actorType === "user" && typeof row.actorId === "string" && row.source === "cli" && canonical(row.newValue) === canonical(value), "ARCHIVE_RECONCILIATION_MISMATCH");
    if (row.actorId !== original.actorId) {
      archiveAssert(action === "archive.publish", "ARCHIVE_RECONCILIATION_MISMATCH");
      await verifyRecoveryPublication(client, manifest, original, row.actorId);
    }
  }
  return original.actorId;
}
async function reservationFamilies(client: ArchiveReservationReader, manifest: ArchiveManifest) {
  const families: ArchiveReservationWitness["families"] = {};
  for (const [table, scope] of Object.entries(archiveOwnedRows(manifest))) {
    archiveAssert(/^[A-Za-z]+$/.test(table) && /^[A-Za-z]+$/.test(scope.column), "ARCHIVE_RECOVERY_IDENTIFIER_INVALID");
    const stable = table === "ProposalJob" ? `CASE WHEN t.kind::text='UPLOAD_MEDIA' THEN to_jsonb(t)-ARRAY['state','attempts','leaseOwner','leaseUntil','result','lastErrorCode','updatedAt'] ELSE to_jsonb(t)-ARRAY['availableAt','updatedAt'] END` : "to_jsonb(t)";
    const { rows } = await client.query<{ count: number; hash: string; stableHash: string }>(`SELECT count(*)::int AS count,md5(COALESCE(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) AS hash,md5(COALESCE(string_agg((${stable})::text,'' ORDER BY (${stable})::text),'')) AS "stableHash" FROM "${table}" t WHERE "${scope.column}"::text=ANY($1::text[])`, [scope.ids]);
    archiveAssert(rows.length === 1, "ARCHIVE_RECOVERY_FAMILY_CHANGED"); families[table] = rows[0];
  }
  return families;
}
/** SELECT-only: вызывающий Root обязан предоставить guarded RR READ ONLY tx; коннекты/БД не открываются. */
export async function captureArchiveReservationWitness(client: ArchiveReservationReader, manifest: ArchiveManifest, binding: Pick<ArchiveReservationWitness, "operatorId" | "operationId" | "program">): Promise<ArchiveReservationWitness> {
  const reserve = await reservationRow(client, manifest), objects = allArchiveObjects(manifest), verifiedObjects: Record<string, string> = {};
  const { rows } = await client.query<{ id: string; result: JsonObject | null }>('SELECT id,result FROM "ProposalJob" WHERE id=ANY($1::text[]) ORDER BY id', [[...new Set(objects.map(o => o.jobId))]]);
  for (const row of rows) Object.assign(verifiedObjects, verifiedResult(manifest, objects.filter(object => object.jobId === row.id), row.result));
  return { schema: 1, kind: "ARCHIVE_RESERVATION_RECOVERY", manifestHash: manifest.sha256, targetHash: valueHash(manifest.target), reserveRowHash: reserve.hash, reservationActorId: reserve.actorId,
    ...binding, families: await reservationFamilies(client, manifest), verifiedObjects };
}

/** CLI-only SQL adapter. Все транзакции короткие: source/target I/O здесь отсутствует. */
export function createArchiveSqlStore(client: PoolClient, options: {
  actorId: string;
  recovery?: ArchiveReservationRecovery;
  guardTarget(manifest: ArchiveManifest): Promise<void>;
  baseline(client: PoolClient, manifest: ArchiveManifest): Promise<string>;
}): ArchiveStore {
  let reservationActorId = options.actorId, recoveryClaimed = false;
  const claimedAttempts = new Map<string, number>(), expectedResults = new Map<string, JsonObject | null>();
  const query = async <T>(sql: string, values: unknown[] = []) => (await client.query(sql, values)).rows as T[];
  const receipt = async (id: string) => (await query<{ entity: string; entityId: string; action: string; newValue: JsonObject; actorType: string; actorId: string | null; source: string }>('SELECT "entity","entityId","action","newValue","actorType","actorId",source FROM "ChangeLog" WHERE id=$1', [id]))[0] ?? null;
  const recoveryAudit = (manifest: ArchiveManifest, completed: boolean) => {
    const recovery = options.recovery!;
    return { schema: 1, manifestHash: manifest.sha256, reservationReceiptId: reserveReceiptId(manifest.sha256), reservationRowHash: recovery.witness.reserveRowHash,
      reservationActorId, operatorId: options.actorId, operationId: recovery.operationId, targetHash: valueHash(manifest.target), witnessHash: recovery.reviewedHash, program: recovery.witness.program,
      verifiedObjects: completed ? Object.fromEntries(allArchiveObjects(manifest).map(o => [o.id, o.sha256])) : recovery.witness.verifiedObjects };
  };
  const insertReceipt = async (id: string, entity: string, entityId: string, action: string, value: JsonObject) => {
    const previous = await receipt(id);
    if (previous) { archiveAssert(previous.entity === entity && previous.entityId === entityId && previous.action === action && canonical(previous.newValue) === canonical(value), "ARCHIVE_SOURCE_CHANGED"); return; }
    await client.query('INSERT INTO "ChangeLog"(id,"actorType","actorId",entity,"entityId",action,"newValue",source,"createdAt") VALUES($1,\'user\',$2,$3,$4,$5,$6::jsonb,\'cli\',clock_timestamp() AT TIME ZONE \'UTC\')', [id, options.actorId, entity, entityId, action, JSON.stringify(value)]);
  };
  const tx = async <T>(manifest: ArchiveManifest, run: () => Promise<T>) => {
    await options.guardTarget(manifest);
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    try {
      await client.query("SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)");
      const identity = (await query<{ database: string; schema: string; user: string }>('SELECT current_database() AS database,current_schema() AS schema,current_user AS user'))[0];
      assertArchiveDatabaseIdentity(manifest.target, identity);
      const actor = (await query<{ active: boolean; roles: string[] }>('SELECT active,roles::text[] AS roles FROM "User" WHERE id=$1 FOR SHARE', [options.actorId]))[0];
      archiveAssert(actor?.active && actor.roles.some(role => role === "ADMIN" || !options.recovery && role === "DIRECTOR"), "ARCHIVE_ACTOR_FORBIDDEN");
      if (options.recovery) {
        const witness = assertArchiveReservationRecovery(options.recovery, manifest, options.actorId), original = await reservationRow(client, manifest);
        archiveAssert(original.hash === witness.reserveRowHash && original.actorId === witness.reservationActorId, "ARCHIVE_RECOVERY_RESERVE_CHANGED"); reservationActorId = original.actorId;
        if (await published(manifest)) {
          const ids = archiveRecoveryReceiptIds(manifest, options.recovery.operationId);
          for (const [id, completed] of [[ids.reserve, false], [ids.publish, true]] as const) {
            const audit = await receipt(id); archiveAssert(audit?.actorId === options.actorId && audit.actorType === "user" && audit.source === "cli" && audit.entity === "kpArchiveRecovery" && audit.entityId === manifest.sha256 && audit.action === (completed ? "archive.recovery.publish" : "archive.recovery.reserve") && canonical(audit.newValue) === canonical(recoveryAudit(manifest, completed)), "ARCHIVE_RECOVERY_AUDIT_CHANGED");
          }
        } else if (recoveryClaimed) {
          const actual = await reservationFamilies(client, manifest);
          archiveAssert(canonical(Object.keys(actual).sort()) === canonical(Object.keys(witness.families).sort()) && Object.entries(actual).every(([name, value]) => value.count === witness.families[name].count && value.stableHash === witness.families[name].stableHash), "ARCHIVE_RECOVERY_FAMILY_CHANGED");
        }
      }
      const result = await run(); await client.query("COMMIT"); return result;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
  };
  const jobsFor = (manifest: ArchiveManifest) => [...new Set(allArchiveObjects(manifest).map(object => object.jobId))].sort();
  const published = async (manifest: ArchiveManifest) => {
    const row = await receipt(publishReceiptId(manifest.sha256));
    if (!row) return false;
    archiveAssert(row.entity === "kpArchiveImport" && row.entityId === manifest.sha256 && row.action === "archive.publish" && row.actorType === "user" && row.source === "cli" && canonical(row.newValue) === canonical(archivePublishValue(manifest)), "ARCHIVE_RECEIPT_CONFLICT");
    return true;
  };
  const ownedJob = async (id: string) => (await query<JobRow>('SELECT id,"proposalId","contractId",kind::text AS kind,"createdById","dedupeKey",state::text AS state,attempts,"maxAttempts","leaseOwner","leaseUntil","lastErrorCode",("leaseUntil">clock_timestamp() AT TIME ZONE \'UTC\') AS "liveLease",payload,result FROM "ProposalJob" WHERE id=$1 FOR UPDATE', [id]))[0];
  const requireActive = async (manifest: ArchiveManifest, owner: string) => {
    if (await published(manifest)) return;
    if (options.recovery) {
      const ids = jobsFor(manifest); archiveAssert(recoveryClaimed && claimedAttempts.size === ids.length, "ARCHIVE_RECOVERY_CLAIM_REQUIRED");
      const rows = await query<JobRow>('SELECT id,attempts,result,"lastErrorCode" FROM "ProposalJob" WHERE id=ANY($1::text[]) AND state=\'PROCESSING\' AND "leaseOwner"=$2 AND "leaseUntil">clock_timestamp() AT TIME ZONE \'UTC\' FOR UPDATE', [ids, owner]);
      archiveAssert(rows.length === ids.length && rows.every(row => row.attempts === claimedAttempts.get(row.id) && (row.lastErrorCode === null || row.lastErrorCode === "ARCHIVE_INTERRUPTED") && canonical(row.result) === canonical(expectedResults.get(row.id))), "ARCHIVE_LEASE_LOST");
      const cleanup = await query<{ id: string }>('SELECT id FROM "ProposalJob" WHERE id=ANY($1::text[]) AND state=\'PENDING\' AND result IS NULL AND "leaseOwner" IS NULL AND "leaseUntil" IS NULL AND "availableAt">clock_timestamp() AT TIME ZONE \'UTC\' FOR UPDATE', [ids.map(archiveCleanupId)]);
      archiveAssert(cleanup.length === ids.length, "ARCHIVE_OBJECT_ALREADY_RETIRED");
      await client.query('UPDATE "ProposalJob" SET "leaseUntil"=(clock_timestamp()+interval \'5 minutes\') AT TIME ZONE \'UTC\',"updatedAt"=clock_timestamp() AT TIME ZONE \'UTC\' WHERE id=ANY($1::text[])', [ids]);
      await client.query('UPDATE "ProposalJob" SET "availableAt"=(clock_timestamp()+interval \'24 hours\') AT TIME ZONE \'UTC\',"updatedAt"=clock_timestamp() AT TIME ZONE \'UTC\' WHERE id=ANY($1::text[])', [ids.map(archiveCleanupId)]); return;
    }
    for (const id of jobsFor(manifest)) {
      const row = await ownedJob(id);
      archiveAssert(row && row.state === "PROCESSING" && row.leaseOwner === owner && row.liveLease && isObject(row.payload.archiveImport) && row.payload.archiveImport.manifestHash === manifest.sha256, "ARCHIVE_LEASE_LOST");
      const cleanup = (await query<{ state: string }>('SELECT state::text AS state FROM "ProposalJob" WHERE id=$1 FOR UPDATE', [archiveCleanupId(id)]))[0];
      archiveAssert(cleanup?.state === "PENDING", "ARCHIVE_OBJECT_ALREADY_RETIRED");
      await client.query('UPDATE "ProposalJob" SET "leaseUntil"=(clock_timestamp()+interval \'5 minutes\') AT TIME ZONE \'UTC\',"updatedAt"=clock_timestamp() AT TIME ZONE \'UTC\' WHERE id=$1', [id]);
      await client.query('UPDATE "ProposalJob" SET "availableAt"=(clock_timestamp()+interval \'24 hours\') AT TIME ZONE \'UTC\',"updatedAt"=clock_timestamp() AT TIME ZONE \'UTC\' WHERE id=$1 AND state=\'PENDING\'', [archiveCleanupId(id)]);
    }
  };
  const baselinePreserved = async <T>(manifest: ArchiveManifest, run: () => Promise<T>) => {
    const before = await options.baseline(client, manifest), result = await run();
    archiveAssert(await options.baseline(client, manifest) === before, "ARCHIVE_BUSINESS_BASELINE_CHANGED"); return result;
  };
  const verifyProposal = async (proposal: ArchiveProposal, visible: boolean) => {
    const row = (await query<{ sourceId: string; projectId: string | null; clientId: string | null; state: JsonObject; deleted: boolean; createdAt: string; updatedAt: string; sourceNumber: string | null; currency: string; revision: number; rate: string | null; acceptedVersionId: string | null }>('SELECT "sourceId","projectId","clientId",state,("deletedAt" IS NOT NULL) AS deleted,to_char("createdAt",\'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "createdAt",to_char("updatedAt",\'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "updatedAt","sourceNumber",currency::text AS currency,revision,rate::text AS rate,"acceptedVersionId" FROM "CommercialProposal" WHERE id=$1 FOR UPDATE', [proposal.id]))[0];
    archiveAssert(row && row.sourceId === proposal.sourceId && row.projectId === null && row.clientId === null && row.deleted === !visible && row.createdAt === proposal.createdAt && row.updatedAt === proposal.updatedAt && row.sourceNumber === proposal.sourceNumber && row.currency === proposal.currency && row.revision === 0 && row.rate === null && row.acceptedVersionId === null, "ARCHIVE_TARGET_RECORD_CONFLICT");
    if (visible) archiveAssert(canonical(row.state) === canonical(proposal.state), "ARCHIVE_TARGET_STATE_DIVERGED");
  };
  const verifyTargetObject = async (object: ArchiveObject, pending: boolean) => {
    const row = object.role === "docx"
      ? (await query<{ state: string; key: string; sha256: string; size: number; mimeType: string; binding: JsonObject; owner: string; retiring: boolean }>('SELECT state::text AS state,key,sha256,size,"mimeType","storageBinding" AS binding,"contractId" AS owner,("deletedAt" IS NOT NULL) AS retiring FROM "ProposalArtifact" WHERE id=$1 AND "proposalId" IS NULL AND kind=\'DOCX\' FOR UPDATE', [object.artifactId]))[0]
      : (await query<{ state: string; key: string; sha256: string; size: number; mimeType: string; binding: JsonObject; owner: string; retiring: boolean }>('SELECT "uploadState" AS state,CASE WHEN $2::text=\'original\' THEN "originalKey" ELSE "optimizedKey" END AS key,CASE WHEN $2::text=\'original\' THEN "originalHash" ELSE "optimizedHash" END AS sha256,CASE WHEN $2::text=\'original\' THEN "originalSize" ELSE "optimizedSize" END AS size,CASE WHEN $2::text=\'original\' THEN "mimeType" ELSE "optimizedMimeType" END AS "mimeType","storageBinding" AS binding,"proposalId" AS owner,("retiringAt" IS NOT NULL OR CASE WHEN $2::text=\'original\' THEN "originalPurgedAt" IS NOT NULL ELSE "optimizedPurgedAt" IS NOT NULL END) AS retiring FROM "ProposalMedia" WHERE id=$1 AND "uploadJobId"=$3 FOR UPDATE', [object.mediaId, object.role, object.jobId]))[0];
    archiveAssert(row && row.key === object.key && row.sha256 === object.sha256 && row.size === object.size && row.mimeType === object.mimeType && canonical(row.binding) === canonical(object.binding) && row.owner === (object.contractId ?? object.proposalId) && row.state === (pending ? "PENDING" : "READY") && (!pending || !row.retiring), "ARCHIVE_TARGET_OBJECT_CHANGED");
  };
  const verifyRecoveryFamily = async (manifest: ArchiveManifest) => {
    const recovery = options.recovery!, witness = assertArchiveReservationRecovery(recovery, manifest, options.actorId), objects = allArchiveObjects(manifest), ids = jobsFor(manifest);
    const expectedCounts: Record<string, number> = { CommercialProposal: manifest.proposals.length, ProposalItem: 0, ProposalVersion: 0, ProposalMedia: manifest.proposals.reduce((n, p) => n + p.media.length, 0), ProposalCurrentMedia: 0, ProposalVersionMedia: 0, ProposalContract: manifest.settings.length, ProposalContractSource: 0, ProposalContractVersion: 0, ProposalArtifact: manifest.docx.filter(d => d.artifact).length, ProposalJob: ids.length * 2, ChangeLog: manifest.proposals.length + manifest.settings.length + 1 };
    const actual = await reservationFamilies(client, manifest);
    archiveAssert(canonical(actual) === canonical(witness.families) && canonical(Object.keys(actual).sort()) === canonical(Object.keys(expectedCounts).sort()) && Object.entries(expectedCounts).every(([name, count]) => actual[name].count === count), "ARCHIVE_RECOVERY_FAMILY_CHANGED");
    for (const proposal of manifest.proposals) {
      await verifyProposal(proposal, false);
      const row = (await query<{ createdById: string; state: JsonObject }>('SELECT "createdById",state FROM "CommercialProposal" WHERE id=$1', [proposal.id]))[0];
      archiveAssert(row?.createdById === reservationActorId && canonical(row.state) === canonical({ items: [] }), "ARCHIVE_RECOVERY_CREATOR_CHANGED");
      const original = await receipt(docReceiptId(proposal.id));
      archiveAssert(original?.actorType === "user" && original.actorId === reservationActorId && original.source === "cli" && original.entity === "kpArchiveDocument" && original.entityId === proposal.id && original.action === "archive.document" && canonical(original.newValue) === canonical(archiveProposalProvenance(manifest, proposal)), "ARCHIVE_RECOVERY_RESERVE_CHANGED");
    }
    for (const setting of manifest.settings) {
      const row = (await query<{ createdById: string; primaryProposalId: string; settings: JsonObject }>('SELECT "createdById","primaryProposalId",settings FROM "ProposalContract" WHERE id=$1 FOR UPDATE', [setting.id]))[0], original = await receipt(`kp.archive.settings:${setting.id}`);
      archiveAssert(row?.createdById === reservationActorId && row.primaryProposalId === setting.proposalId && canonical(row.settings) === "{}", "ARCHIVE_RECOVERY_CREATOR_CHANGED");
      archiveAssert(original?.actorType === "user" && original.actorId === reservationActorId && original.source === "cli" && original.entity === "kpArchiveContract" && original.entityId === setting.id && original.action === "archive.settings" && canonical(original.newValue) === canonical({ schema: 1, sourceHash: setting.sourceHash, rawBase64: setting.rawBase64 }), "ARCHIVE_RECOVERY_RESERVE_CHANGED");
    }
    for (const object of objects) await verifyTargetObject(object, true);
    const verified: JsonObject = {};
    for (const id of ids) {
      const row = await ownedJob(id), group = objects.filter(object => object.jobId === id), first = group[0];
      archiveAssert(row && row.kind === "UPLOAD_MEDIA" && row.createdById === reservationActorId && row.proposalId === first.proposalId && row.contractId === null && row.dedupeKey === `kp:archive:upload:${id}` && canonical(row.payload) === canonical(uploadPayload(manifest, group, reservationActorId)), "ARCHIVE_RECOVERY_OPERATION_CHANGED");
      archiveAssert(row.attempts < row.maxAttempts && (row.state === "FAILED" && row.leaseOwner === null && row.leaseUntil === null || row.state === "PROCESSING" && row.leaseUntil !== null && !row.liveLease), "ARCHIVE_RECOVERY_OPERATION_ACTIVE");
      archiveAssert(row.lastErrorCode === null || row.lastErrorCode === "ARCHIVE_INTERRUPTED", "ARCHIVE_RECOVERY_OPERATION_CHANGED");
      const valid = verifiedResult(manifest, group, row.result); Object.assign(verified, valid); claimedAttempts.set(id, row.attempts + 1); expectedResults.set(id, row.result);
      const cleanup = (await query<{ kind: string; proposalId: string; contractId: string | null; createdById: string | null; dedupeKey: string; state: string; attempts: number; future: boolean; result: unknown; leaseOwner: unknown; leaseUntil: unknown; payload: JsonObject }>('SELECT kind::text AS kind,"proposalId","contractId","createdById","dedupeKey",state::text AS state,attempts,("availableAt">clock_timestamp() AT TIME ZONE \'UTC\') AS future,result,"leaseOwner","leaseUntil",payload FROM "ProposalJob" WHERE id=$1 FOR UPDATE', [archiveCleanupId(id)]))[0];
      archiveAssert(cleanup?.kind === "PURGE_MEDIA" && cleanup.proposalId === first.proposalId && cleanup.contractId === null && cleanup.createdById === null && cleanup.dedupeKey === `kp:archive:cleanup:${id}` && cleanup.state === "PENDING" && cleanup.attempts === 0 && cleanup.future && cleanup.result === null && cleanup.leaseOwner === null && cleanup.leaseUntil === null && canonical(cleanup.payload) === canonical(cleanupPayload(manifest, group)), "ARCHIVE_RECOVERY_CLEANUP_CHANGED");
    }
    archiveAssert(canonical(verified) === canonical(witness.verifiedObjects), "ARCHIVE_RECOVERY_VERIFIED_OBJECT_CHANGED");
    const unexpected = (await query<{ jobs: string; artifacts: string; files: string; refs: string }>(`SELECT
      (SELECT count(*)::text FROM "ProposalJob" WHERE ("proposalId"=ANY($1::text[]) OR "contractId"=ANY($2::text[])) AND NOT(id=ANY($3::text[]))) AS jobs,
      (SELECT count(*)::text FROM "ProposalArtifact" WHERE "proposalId"=ANY($1::text[])) AS artifacts,
      (SELECT count(*)::text FROM "File" WHERE "proposalSourceMediaId"=ANY($4::text[])) AS files,
      ((SELECT count(*) FROM "ProposalContractSource" WHERE "proposalId"=ANY($1::text[]) AND NOT("contractId"=ANY($2::text[])))+
       (SELECT count(*) FROM "ProposalVersion" WHERE "pdfArtifactId"=ANY($5::text[]))+
       (SELECT count(*) FROM "ProposalContractVersion" WHERE "docxArtifactId"=ANY($5::text[])))::text AS refs`, [manifest.proposals.map(p => p.id), manifest.settings.map(s => s.id), [...ids, ...ids.map(archiveCleanupId)], manifest.proposals.flatMap(p => p.media.map(m => m.id)), manifest.docx.flatMap(d => d.artifact?.artifactId ? [d.artifact.artifactId] : [])]))[0];
    archiveAssert(unexpected?.jobs === "0" && unexpected.artifacts === "0" && unexpected.files === "0" && unexpected.refs === "0", "ARCHIVE_RECOVERY_FOREIGN_REFERENCE");
    const auditIds = archiveRecoveryReceiptIds(manifest, recovery.operationId);
    archiveAssert(!(await receipt(auditIds.reserve)) && !(await receipt(auditIds.publish)), "ARCHIVE_RECOVERY_OPERATION_ALREADY_USED");
    return Object.keys(verified);
  };
  return {
    reserve: (manifest, owner) => tx(manifest, async () => {
      if (await published(manifest)) { archiveAssert(!options.recovery, "ARCHIVE_RECOVERY_ALREADY_PUBLISHED"); return { published: true }; }
      return baselinePreserved(manifest, async () => {
        const verifiedObjectIds = options.recovery ? await verifyRecoveryFamily(manifest) : undefined;
        if (options.recovery) await insertReceipt(archiveRecoveryReceiptIds(manifest, options.recovery.operationId).reserve, "kpArchiveRecovery", manifest.sha256, "archive.recovery.reserve", recoveryAudit(manifest, false));
        for (const proposal of manifest.proposals) {
          const provenance = archiveProposalProvenance(manifest, proposal);
          const prior = await receipt(docReceiptId(proposal.id));
          if (prior) {
            archiveAssert(canonical(prior.newValue) === canonical(provenance), "ARCHIVE_SOURCE_CHANGED"); await verifyProposal(proposal, false);
          } else {
            archiveAssert(!(await query('SELECT id FROM "CommercialProposal" WHERE id=$1 OR "sourceId"=$2', [proposal.id, proposal.sourceId])).length, "ARCHIVE_TARGET_RECORD_CONFLICT");
            await client.query('INSERT INTO "CommercialProposal"(id,"sourceId","sourceNumber",state,currency,"deletedAt","createdById","createdAt","updatedAt") VALUES($1,$2,$3,\'{"items":[]}\'::jsonb,$4::"ProposalCurrency",clock_timestamp() AT TIME ZONE \'UTC\',$5,$6::timestamptz AT TIME ZONE \'UTC\',$7::timestamptz AT TIME ZONE \'UTC\')', [proposal.id, proposal.sourceId, proposal.sourceNumber, proposal.currency, options.actorId, proposal.createdAt, proposal.updatedAt]);
            await insertReceipt(docReceiptId(proposal.id), "kpArchiveDocument", proposal.id, "archive.document", provenance);
          }
        }
        for (const settings of manifest.settings) {
          const key = `kp.archive.settings:${settings.id}`, prior = await receipt(key), value = { schema: 1, sourceHash: settings.sourceHash, rawBase64: settings.rawBase64 };
          if (prior) archiveAssert(canonical(prior.newValue) === canonical(value), "ARCHIVE_SOURCE_CHANGED");
          else {
            archiveAssert(!(await query('SELECT id FROM "ProposalContract" WHERE id=$1 OR "primaryProposalId"=$2', [settings.id, settings.proposalId])).length, "ARCHIVE_TARGET_CONTRACT_CONFLICT");
            await client.query('INSERT INTO "ProposalContract"(id,"primaryProposalId",settings,"createdById","createdAt","updatedAt") VALUES($1,$2,\'{}\'::jsonb,$3,$4::timestamptz AT TIME ZONE \'UTC\',$4::timestamptz AT TIME ZONE \'UTC\')', [settings.id, settings.proposalId, options.actorId, settings.updatedAt]);
            await insertReceipt(key, "kpArchiveContract", settings.id, "archive.settings", value);
          }
        }
        const objects = allArchiveObjects(manifest);
        await insertReceipt(reserveReceiptId(manifest.sha256), "kpArchiveImport", manifest.sha256, "archive.reserve", archiveReserveValue(manifest));
        for (const jobId of jobsFor(manifest)) {
          const group = objects.filter(row => row.jobId === jobId), first = group[0], original = group.find(row => row.role === "original"), optimized = group.find(row => row.role === "optimized");
          const payload = uploadPayload(manifest, group, reservationActorId);
          const prior = await ownedJob(jobId);
          if (prior) {
            archiveAssert(canonical(prior.payload) === canonical(payload) && (!prior.liveLease || prior.leaseOwner === owner) && prior.attempts < prior.maxAttempts, "ARCHIVE_OPERATION_CONFLICT");
            const cleanup = (await query<{ state: string }>('SELECT state::text AS state FROM "ProposalJob" WHERE id=$1 FOR UPDATE', [archiveCleanupId(jobId)]))[0];
            archiveAssert(cleanup?.state === "PENDING", "ARCHIVE_OBJECT_ALREADY_RETIRED");
            await client.query('UPDATE "ProposalJob" SET state=\'PROCESSING\',attempts=attempts+1,"leaseOwner"=$2,"leaseUntil"=(clock_timestamp()+interval \'5 minutes\') AT TIME ZONE \'UTC\',"updatedAt"=clock_timestamp() AT TIME ZONE \'UTC\' WHERE id=$1', [jobId, owner]);
          } else {
            await client.query('INSERT INTO "ProposalJob"(id,"proposalId",kind,state,"dedupeKey",payload,attempts,"leaseOwner","leaseUntil","createdById","createdAt","updatedAt") VALUES($1,$2,\'UPLOAD_MEDIA\',\'PROCESSING\',$3,$4::jsonb,1,$5,(clock_timestamp()+interval \'5 minutes\') AT TIME ZONE \'UTC\',$6,clock_timestamp() AT TIME ZONE \'UTC\',clock_timestamp() AT TIME ZONE \'UTC\')', [jobId, first.proposalId, `kp:archive:upload:${jobId}`, JSON.stringify(payload), owner, options.actorId]);
            const cleanup = cleanupPayload(manifest, group);
            await client.query('INSERT INTO "ProposalJob"(id,"proposalId",kind,"dedupeKey",payload,"availableAt","createdAt","updatedAt") VALUES($1,$2,\'PURGE_MEDIA\',$3,$4::jsonb,(clock_timestamp()+interval \'24 hours\') AT TIME ZONE \'UTC\',clock_timestamp() AT TIME ZONE \'UTC\',clock_timestamp() AT TIME ZONE \'UTC\')', [archiveCleanupId(jobId), first.proposalId, `kp:archive:cleanup:${jobId}`, JSON.stringify(cleanup)]);
            if (first.mediaId && optimized) {
              const proposal = manifest.proposals.find(row => row.id === first.proposalId)!, media = proposal.media.find(row => row.id === first.mediaId)!;
              await client.query('INSERT INTO "ProposalMedia"(id,"proposalId","storageBinding","originalKey","originalHash","originalSize","optimizedKey","optimizedHash","optimizedSize","mimeType","optimizedMimeType","fileName","expiresAt","uploadState","uploadJobId","createdAt") VALUES($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::timestamptz AT TIME ZONE \'UTC\',\'PENDING\',$14,$15::timestamptz AT TIME ZONE \'UTC\')', [media.id, proposal.id, JSON.stringify(first.binding), original?.key ?? null, original?.sha256 ?? null, original?.size ?? null, optimized.key, optimized.sha256, optimized.size, original?.mimeType ?? optimized.mimeType, optimized.mimeType, media.fileName, media.expiresAt, jobId, optimized.source.modifiedAt ?? proposal.createdAt]);
            } else {
              archiveAssert(first.artifactId && first.contractId, "ARCHIVE_OBJECT_OWNER_MISMATCH");
              await client.query('INSERT INTO "ProposalArtifact"(id,"contractId",kind,state,"storageBinding",key,sha256,size,"fileName","mimeType","createdAt") VALUES($1,$2,\'DOCX\',\'PENDING\',$3::jsonb,$4,$5,$6,$7,$8,$9::timestamptz AT TIME ZONE \'UTC\')', [first.artifactId, first.contractId, JSON.stringify(first.binding), first.key, first.sha256, first.size, first.source.key.split("/").at(-1), first.mimeType, first.source.modifiedAt]);
            }
          }
        }
        if (options.recovery) recoveryClaimed = true;
        await requireActive(manifest, owner); return { published: false, ...(verifiedObjectIds ? { verifiedObjectIds } : {}) };
      });
    }),
    active: (manifest, owner) => tx(manifest, () => requireActive(manifest, owner)),
    verified: (manifest, owner, object) => tx(manifest, async () => {
      await requireActive(manifest, owner); archiveAssert(allArchiveObjects(manifest).some(expected => canonical(expected) === canonical(object)), "ARCHIVE_OBJECT_OWNER_MISMATCH"); await verifyTargetObject(object, true);
      const row = await ownedJob(object.jobId); archiveAssert(row, "ARCHIVE_LEASE_LOST");
      const prior = row.result && isObject(row.result.verified) ? row.result.verified : {};
      const result = { archiveManifestHash: manifest.sha256, verified: { ...prior, [object.id]: object.sha256 } };
      await client.query('UPDATE "ProposalJob" SET result=$2::jsonb,"updatedAt"=clock_timestamp() AT TIME ZONE \'UTC\' WHERE id=$1', [object.jobId, JSON.stringify(result)]);
      if (options.recovery) expectedResults.set(object.jobId, result);
    }),
    publish: (manifest, owner) => tx(manifest, async () => {
      if (await published(manifest)) return;
      await requireActive(manifest, owner);
      await baselinePreserved(manifest, async () => {
        for (const object of allArchiveObjects(manifest)) {
          const job = await ownedJob(object.jobId); archiveAssert(job?.result && isObject(job.result.verified) && job.result.verified[object.id] === object.sha256, "ARCHIVE_READBACK_REQUIRED");
          await verifyTargetObject(object, true);
        }
        for (const proposal of manifest.proposals) {
          await verifyProposal(proposal, false);
          for (const [index, item] of proposal.state.items.entries()) await client.query('INSERT INTO "ProposalItem"(id,"proposalId",position,state,"createdAt","updatedAt") VALUES($1,$2,$3,$4::jsonb,$5::timestamptz AT TIME ZONE \'UTC\',$6::timestamptz AT TIME ZONE \'UTC\')', [item.id, proposal.id, index + 1, JSON.stringify(item), proposal.createdAt, proposal.updatedAt]);
          const snapshot = { archiveImport: archiveProposalVersionSnapshot(manifest, proposal), binding: { clientId: null, projectId: null, clientSnapshot: isObject(proposal.state.client) ? proposal.state.client : {} } };
          await client.query('INSERT INTO "ProposalVersion"(id,"proposalId",revision,trigger,state,"pricingSnapshot","renderSnapshot","templateVersion","createdById","createdAt") VALUES($1,$2,0,\'IMPORT\',$3::jsonb,\'{}\'::jsonb,$4::jsonb,\'legacy-import-v1\',$5,$6::timestamptz AT TIME ZONE \'UTC\')', [proposal.versionId, proposal.id, JSON.stringify(proposal.state), JSON.stringify(snapshot), reservationActorId, proposal.updatedAt]);
          for (const media of proposal.media) {
            const changed = await client.query('UPDATE "ProposalMedia" SET "uploadState"=\'READY\' WHERE id=$1 AND "proposalId"=$2 AND "uploadJobId"=$3 AND "uploadState"=\'PENDING\' AND "retiringAt" IS NULL AND "optimizedPurgedAt" IS NULL', [media.id, proposal.id, media.jobId]);
            archiveAssert(changed.rowCount === 1, "ARCHIVE_MEDIA_CHANGED");
            await client.query('INSERT INTO "ProposalCurrentMedia"("proposalId","mediaId") VALUES($1,$2)', [proposal.id, media.id]);
            await client.query('INSERT INTO "ProposalVersionMedia"("proposalId","versionId","mediaId") VALUES($1,$2,$3)', [proposal.id, proposal.versionId, media.id]);
          }
          const changed = await client.query('UPDATE "CommercialProposal" SET state=$2::jsonb,"deletedAt"=NULL WHERE id=$1 AND "sourceId"=$3 AND "projectId" IS NULL AND "clientId" IS NULL AND "deletedAt" IS NOT NULL', [proposal.id, JSON.stringify(proposal.state), proposal.sourceId]);
          archiveAssert(changed.rowCount === 1, "ARCHIVE_TARGET_RECORD_CONFLICT");
        }
        for (const settings of manifest.settings) {
          const changed = await client.query('UPDATE "ProposalContract" SET settings=$2::jsonb WHERE id=$1 AND "primaryProposalId"=$3', [settings.id, JSON.stringify(settings.settings), settings.proposalId]);
          archiveAssert(changed.rowCount === 1, "ARCHIVE_TARGET_CONTRACT_CONFLICT");
          for (const [index, proposalId] of settings.sourceProposalIds.entries()) await client.query('INSERT INTO "ProposalContractSource"("contractId","proposalId",position) VALUES($1,$2,$3)', [settings.id, proposalId, index + 1]);
        }
        for (const docx of manifest.docx) {
          const artifact = docx.artifact; archiveAssert(artifact?.artifactId && artifact.contractId && docx.sourceObject.modifiedAt, "ARCHIVE_REVIEW_REQUIRED");
          const changed = await client.query('UPDATE "ProposalArtifact" SET state=\'READY\' WHERE id=$1 AND "contractId"=$2 AND state=\'PENDING\'', [artifact.artifactId, artifact.contractId]); archiveAssert(changed.rowCount === 1, "ARCHIVE_ARTIFACT_CHANGED");
          const settings = manifest.settings.find(row => row.id === artifact.contractId)!;
          const snapshot = { archiveImport: { historicalSettingsKnown: false, sourceObject: docx.sourceObject, manifestHash: manifest.sha256, evidenceSha256: docx.evidenceSha256 }, availableSourceSettingsRecordBase64: settings.rawBase64 };
          await client.query('INSERT INTO "ProposalContractVersion"(id,"contractId","settingsSnapshot","clientSnapshot","sourcesSnapshot","renderSnapshot","templateVersion","docxArtifactId","createdById","createdAt") VALUES($1,$2,$3::jsonb,\'{}\'::jsonb,\'[]\'::jsonb,$4::jsonb,\'legacy-docx-unknown\',$5,$6,$7::timestamptz AT TIME ZONE \'UTC\')', [docx.versionId, artifact.contractId, JSON.stringify(snapshot), JSON.stringify({ archiveImport: { sourceObject: docx.sourceObject, historicalSettingsKnown: false } }), artifact.artifactId, reservationActorId, docx.sourceObject.modifiedAt]);
        }
        for (const id of jobsFor(manifest)) {
          const changed = await client.query('UPDATE "ProposalJob" SET state=\'SUCCEEDED\',"leaseOwner"=NULL,"leaseUntil"=NULL,"updatedAt"=clock_timestamp() AT TIME ZONE \'UTC\' WHERE id=$1 AND state=\'PROCESSING\' AND "leaseOwner"=$2 AND "leaseUntil">clock_timestamp() AT TIME ZONE \'UTC\'', [id, owner]); archiveAssert(changed.rowCount === 1, "ARCHIVE_LEASE_LOST");
        }
        await insertReceipt(publishReceiptId(manifest.sha256), "kpArchiveImport", manifest.sha256, "archive.publish", archivePublishValue(manifest));
        if (options.recovery) await insertReceipt(archiveRecoveryReceiptIds(manifest, options.recovery.operationId).publish, "kpArchiveRecovery", manifest.sha256, "archive.recovery.publish", recoveryAudit(manifest, true));
      });
    }),
    reconcile: manifest => tx(manifest, async () => {
      archiveAssert(await published(manifest), "ARCHIVE_NOT_PUBLISHED");
      const importActorId = await verifyPublishedArchiveOrigin(client, manifest), policyPurgedObjectIds: string[] = [];
      for (const proposal of manifest.proposals) {
        const current = (await query<{ sourceId: string; createdById: string; createdAt: string }>('SELECT "sourceId","createdById",to_char("createdAt",\'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "createdAt" FROM "CommercialProposal" WHERE id=$1', [proposal.id]))[0];
        archiveAssert(current?.sourceId === proposal.sourceId && current.createdById === importActorId && current.createdAt === proposal.createdAt, "ARCHIVE_RECONCILIATION_MISMATCH");
        const version = (await query<{ state: JsonObject; provenance: JsonObject; trigger: string; revision: number }>('SELECT state,"renderSnapshot"->\'archiveImport\' AS provenance,trigger::text AS trigger,revision FROM "ProposalVersion" WHERE id=$1 AND "proposalId"=$2', [proposal.versionId, proposal.id]))[0];
        if (version) {
          archiveAssert(version.trigger === "IMPORT" && version.revision === 0 && canonical(version.provenance) === canonical(archiveProposalVersionSnapshot(manifest, proposal)) && canonical(version.state) === canonical(proposal.state), "ARCHIVE_RECONCILIATION_MISMATCH");
          const refs = await query<{ mediaId: string }>('SELECT "mediaId" FROM "ProposalVersionMedia" WHERE "proposalId"=$1 AND "versionId"=$2 ORDER BY "mediaId"', [proposal.id, proposal.versionId]);
          archiveAssert(canonical(refs.map(row => row.mediaId)) === canonical(proposal.media.map(row => row.id).sort()), "ARCHIVE_RECONCILIATION_MISMATCH");
        } else {
          const jobs = await query<{ payload: unknown; result: unknown }>('SELECT payload,result FROM "ProposalJob" WHERE "proposalId"=$1 AND kind=\'PRUNE_VERSIONS\' AND state=\'SUCCEEDED\'', [proposal.id]);
          archiveAssert(jobs.some(job => { const payload = retentionPayload(job.payload), progress = parseRetentionProgress(proposal.id, job.result); return payload.kind === "ACCEPTED_RETENTION" && payload.proposalId === proposal.id && payload.acceptedVersionId !== proposal.versionId && progress?.manifest.pruneVersionIds.includes(proposal.versionId); }), "ARCHIVE_IMPORT_VERSION_MISSING");
        }
        for (const media of proposal.media) {
          const record = (await query<{ uploadState: string; optimizedPurged: boolean; originalPurged: boolean; optimizedHash: string; optimizedKey: string; originalHash: string | null; originalKey: string | null; expiresAt: string }>('SELECT "uploadState",("optimizedPurgedAt" IS NOT NULL) AS "optimizedPurged",("originalPurgedAt" IS NOT NULL) AS "originalPurged","optimizedHash","optimizedKey","originalHash","originalKey",to_char("expiresAt",\'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "expiresAt" FROM "ProposalMedia" WHERE id=$1 AND "proposalId"=$2', [media.id, proposal.id]))[0];
          archiveAssert(record?.uploadState === "READY" && record.optimizedHash === media.optimized.sha256 && record.optimizedKey === media.optimized.key && record.originalHash === (media.original?.sha256 ?? null) && record.originalKey === (media.original?.key ?? null) && record.expiresAt === media.expiresAt, "ARCHIVE_RECONCILIATION_MISMATCH");
          if (record.optimizedPurged) policyPurgedObjectIds.push(media.optimized.id); if (media.original && record.originalPurged) policyPurgedObjectIds.push(media.original.id);
        }
      }
      for (const settings of manifest.settings) {
        archiveAssert((await query('SELECT id FROM "ProposalContract" WHERE id=$1 AND "primaryProposalId"=$2', [settings.id, settings.proposalId])).length === 1, "ARCHIVE_RECONCILIATION_MISMATCH");
      }
      for (const docx of manifest.docx) {
        const artifact = docx.artifact!;
        const rows = await query<{ key: string; sha256: string; size: number; state: string; createdAt: string }>('SELECT a.key,a.sha256,a.size,a.state::text AS state,to_char(v."createdAt",\'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "createdAt" FROM "ProposalContractVersion" v JOIN "ProposalArtifact" a ON a.id=v."docxArtifactId" AND a."contractId"=v."contractId" WHERE v.id=$1 AND v."contractId"=$2 AND a.id=$3', [docx.versionId, artifact.contractId, artifact.artifactId]);
        archiveAssert(rows.length === 1 && rows[0].key === artifact.key && rows[0].sha256 === artifact.sha256 && rows[0].size === artifact.size && rows[0].state === "READY" && rows[0].createdAt === docx.sourceObject.modifiedAt, "ARCHIVE_RECONCILIATION_MISMATCH");
      }
      for (const object of allArchiveObjects(manifest)) await verifyTargetObject(object, false);
      return { published: true, ...manifest.counts, verifiedObjects: allArchiveObjects(manifest).length - policyPurgedObjectIds.length, businessBaselinePreserved: true, policyPurgedObjectIds } satisfies ArchiveReconciliation;
    }),
    release: (manifest, owner) => tx(manifest, async () => {
      for (const id of jobsFor(manifest)) await client.query('UPDATE "ProposalJob" SET state=\'FAILED\',"leaseOwner"=NULL,"leaseUntil"=NULL,"lastErrorCode"=\'ARCHIVE_INTERRUPTED\',"updatedAt"=clock_timestamp() AT TIME ZONE \'UTC\' WHERE id=$1 AND state=\'PROCESSING\' AND "leaseOwner"=$2', [id, owner]);
    }),
  };
}
