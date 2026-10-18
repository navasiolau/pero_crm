import type { PoolClient } from "pg";
import { archiveAssert, assertArchiveDatabaseIdentity, canonical, docReceiptId, isObject, publishReceiptId, reserveReceiptId, valueHash,
  type ArchiveManifest, type ArchiveObject, type ArchiveProposal, type JsonObject } from "./contract";
import { allArchiveObjects } from "./manifest";
import type { ArchiveReconciliation, ArchiveStore } from "./apply";
import { archiveProposalProvenance, archiveProposalVersionSnapshot } from "./provenance";

type JobRow = { id: string; state: string; attempts: number; maxAttempts: number; leaseOwner: string | null; liveLease: boolean; payload: JsonObject; result: JsonObject | null };
export const archiveCleanupId = (jobId: string) => "kp_archive_cleanup_" + valueHash(jobId);
export function archiveOwnedRows(manifest: ArchiveManifest) {
  const proposals = manifest.proposals.map(row => row.id), contracts = manifest.settings.map(row => row.id), objects = allArchiveObjects(manifest);
  const jobs = [...new Set(objects.map(row => row.jobId))];
  const entries: [string, string, string[]][] = [["CommercialProposal", "id", proposals], ["ProposalItem", "proposalId", proposals], ["ProposalVersion", "proposalId", proposals], ["ProposalMedia", "proposalId", proposals], ["ProposalCurrentMedia", "proposalId", proposals], ["ProposalVersionMedia", "proposalId", proposals], ["ProposalContract", "id", contracts], ["ProposalContractSource", "contractId", contracts], ["ProposalContractVersion", "contractId", contracts], ["ProposalArtifact", "contractId", contracts], ["ProposalJob", "id", [...jobs, ...jobs.map(archiveCleanupId)]],
    ["ChangeLog", "id", [reserveReceiptId(manifest.sha256), publishReceiptId(manifest.sha256), ...proposals.map(docReceiptId), ...contracts.map(id => `kp.archive.settings:${id}`)]]];
  return Object.fromEntries(entries.filter(([, , ids]) => ids.length).map(([table, column, ids]) => [table, { column, ids: [...new Set(ids)] }]));
}

/** CLI-only SQL adapter. Все транзакции короткие: source/target I/O здесь отсутствует. */
export function createArchiveSqlStore(client: PoolClient, options: {
  actorId: string;
  guardTarget(manifest: ArchiveManifest): Promise<void>;
  baseline(client: PoolClient, manifest: ArchiveManifest): Promise<string>;
}): ArchiveStore {
  const query = async <T>(sql: string, values: unknown[] = []) => (await client.query(sql, values)).rows as T[];
  const receipt = async (id: string) => (await query<{ entity: string; entityId: string; action: string; newValue: JsonObject }>('SELECT "entity","entityId","action","newValue" FROM "ChangeLog" WHERE id=$1', [id]))[0] ?? null;
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
      archiveAssert(actor?.active && actor.roles.some(role => role === "ADMIN" || role === "DIRECTOR"), "ARCHIVE_ACTOR_FORBIDDEN");
      const result = await run(); await client.query("COMMIT"); return result;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
  };
  const jobsFor = (manifest: ArchiveManifest) => [...new Set(allArchiveObjects(manifest).map(object => object.jobId))].sort();
  const published = async (manifest: ArchiveManifest) => {
    const row = await receipt(publishReceiptId(manifest.sha256));
    if (!row) return false;
    archiveAssert(row.entity === "kpArchiveImport" && row.entityId === manifest.sha256 && row.action === "archive.publish" && row.newValue.manifestHash === manifest.sha256, "ARCHIVE_RECEIPT_CONFLICT");
    return true;
  };
  const ownedJob = async (id: string) => (await query<JobRow>('SELECT id,state::text AS state,attempts,"maxAttempts","leaseOwner",("leaseUntil">clock_timestamp() AT TIME ZONE \'UTC\') AS "liveLease",payload,result FROM "ProposalJob" WHERE id=$1 FOR UPDATE', [id]))[0];
  const requireActive = async (manifest: ArchiveManifest, owner: string) => {
    if (await published(manifest)) return;
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
    const row = (await query<{ sourceId: string; isArchive: boolean; projectId: string | null; clientId: string | null; state: JsonObject; deleted: boolean; createdAt: string; updatedAt: string; sourceNumber: string | null; currency: string; revision: number; rate: string | null; acceptedVersionId: string | null }>('SELECT "sourceId","isArchive","projectId","clientId",state,("deletedAt" IS NOT NULL) AS deleted,to_char("createdAt",\'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "createdAt",to_char("updatedAt",\'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "updatedAt","sourceNumber",currency::text AS currency,revision,rate::text AS rate,"acceptedVersionId" FROM "CommercialProposal" WHERE id=$1 FOR UPDATE', [proposal.id]))[0];
    archiveAssert(row && row.sourceId === proposal.sourceId && row.isArchive && row.projectId === null && row.clientId === null && row.deleted === !visible && row.createdAt === proposal.createdAt && row.updatedAt === proposal.updatedAt && row.sourceNumber === proposal.sourceNumber && row.currency === proposal.currency && row.revision === 0 && row.rate === null && row.acceptedVersionId === null, "ARCHIVE_TARGET_RECORD_CONFLICT");
    if (visible) archiveAssert(canonical(row.state) === canonical(proposal.state), "ARCHIVE_TARGET_STATE_DIVERGED");
  };
  const verifyTargetObject = async (object: ArchiveObject, pending: boolean) => {
    const row = object.role === "docx"
      ? (await query<{ state: string; key: string; sha256: string; size: number; mimeType: string; binding: JsonObject; owner: string; retiring: boolean }>('SELECT state::text AS state,key,sha256,size,"mimeType","storageBinding" AS binding,"contractId" AS owner,("deletedAt" IS NOT NULL) AS retiring FROM "ProposalArtifact" WHERE id=$1 AND "proposalId" IS NULL AND kind=\'DOCX\' FOR UPDATE', [object.artifactId]))[0]
      : (await query<{ state: string; key: string; sha256: string; size: number; mimeType: string; binding: JsonObject; owner: string; retiring: boolean }>('SELECT "uploadState" AS state,CASE WHEN $2::text=\'original\' THEN "originalKey" ELSE "optimizedKey" END AS key,CASE WHEN $2::text=\'original\' THEN "originalHash" ELSE "optimizedHash" END AS sha256,CASE WHEN $2::text=\'original\' THEN "originalSize" ELSE "optimizedSize" END AS size,CASE WHEN $2::text=\'original\' THEN "mimeType" ELSE "optimizedMimeType" END AS "mimeType","storageBinding" AS binding,"proposalId" AS owner,("retiringAt" IS NOT NULL OR CASE WHEN $2::text=\'original\' THEN "originalPurgedAt" IS NOT NULL ELSE "optimizedPurgedAt" IS NOT NULL END) AS retiring FROM "ProposalMedia" WHERE id=$1 AND "uploadJobId"=$3 FOR UPDATE', [object.mediaId, object.role, object.jobId]))[0];
    archiveAssert(row && row.key === object.key && row.sha256 === object.sha256 && row.size === object.size && row.mimeType === object.mimeType && canonical(row.binding) === canonical(object.binding) && row.owner === (object.contractId ?? object.proposalId) && row.state === (pending ? "PENDING" : "READY") && (!pending || !row.retiring), "ARCHIVE_TARGET_OBJECT_CHANGED");
  };
  return {
    reserve: (manifest, owner) => tx(manifest, async () => {
      if (await published(manifest)) return { published: true };
      return baselinePreserved(manifest, async () => {
        for (const proposal of manifest.proposals) {
          const provenance = archiveProposalProvenance(manifest, proposal);
          const prior = await receipt(docReceiptId(proposal.id));
          if (prior) {
            archiveAssert(canonical(prior.newValue) === canonical(provenance), "ARCHIVE_SOURCE_CHANGED"); await verifyProposal(proposal, false);
          } else {
            archiveAssert(!(await query('SELECT id FROM "CommercialProposal" WHERE id=$1 OR "sourceId"=$2', [proposal.id, proposal.sourceId])).length, "ARCHIVE_TARGET_RECORD_CONFLICT");
            await client.query('INSERT INTO "CommercialProposal"(id,"sourceId","sourceNumber","isArchive",state,currency,"deletedAt","createdById","createdAt","updatedAt") VALUES($1,$2,$3,true,\'{"items":[]}\'::jsonb,$4::"ProposalCurrency",clock_timestamp() AT TIME ZONE \'UTC\',$5,$6::timestamptz AT TIME ZONE \'UTC\',$7::timestamptz AT TIME ZONE \'UTC\')', [proposal.id, proposal.sourceId, proposal.sourceNumber, proposal.currency, options.actorId, proposal.createdAt, proposal.updatedAt]);
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
        await insertReceipt(reserveReceiptId(manifest.sha256), "kpArchiveImport", manifest.sha256, "archive.reserve", { schema: 1, manifestHash: manifest.sha256, sourceNamespace: manifest.sourceNamespace, proposalIds: manifest.proposals.map(row => row.id), targetBindingHash: valueHash(manifest.target),
          documents: manifest.proposals.map(row => ({ proposalId: row.id, sourceId: row.sourceId, sourceHash: row.sourceHash })), objects: objects.map(row => ({ id: row.id, proposalId: row.proposalId, ...(row.mediaId ? { mediaId: row.mediaId } : { artifactId: row.artifactId }), operationJobId: row.jobId, binding: row.binding, key: row.key, sha256: row.sha256, size: row.size, mimeType: row.mimeType })) });
        for (const jobId of jobsFor(manifest)) {
          const group = objects.filter(row => row.jobId === jobId), first = group[0], original = group.find(row => row.role === "original"), optimized = group.find(row => row.role === "optimized");
          const objectJson = (row: ArchiveObject) => ({ key: row.key, sha256: row.sha256, size: row.size, mimeType: row.mimeType });
          const payload = { schema: 1, kind: "UPLOAD_MEDIA", proposalId: first.proposalId, mediaId: first.mediaId, artifactId: first.artifactId, contractId: first.contractId, binding: first.binding,
            original: original ? objectJson(original) : null, optimized: optimized ? objectJson(optimized) : null,
            archiveImport: { manifestHash: manifest.sha256, sourceNamespace: manifest.sourceNamespace, archiveRole: first.role === "docx" ? "DOCX" : "IMAGE", actorId: options.actorId }, fingerprint: valueHash({ actorId: options.actorId, manifestHash: manifest.sha256, objects: group }) };
          const prior = await ownedJob(jobId);
          if (prior) {
            archiveAssert(canonical(prior.payload) === canonical(payload) && (!prior.liveLease || prior.leaseOwner === owner) && prior.attempts < prior.maxAttempts, "ARCHIVE_OPERATION_CONFLICT");
            const cleanup = (await query<{ state: string }>('SELECT state::text AS state FROM "ProposalJob" WHERE id=$1 FOR UPDATE', [archiveCleanupId(jobId)]))[0];
            archiveAssert(cleanup?.state === "PENDING", "ARCHIVE_OBJECT_ALREADY_RETIRED");
            await client.query('UPDATE "ProposalJob" SET state=\'PROCESSING\',attempts=attempts+1,"leaseOwner"=$2,"leaseUntil"=(clock_timestamp()+interval \'5 minutes\') AT TIME ZONE \'UTC\',"updatedAt"=clock_timestamp() AT TIME ZONE \'UTC\' WHERE id=$1', [jobId, owner]);
          } else {
            await client.query('INSERT INTO "ProposalJob"(id,"proposalId",kind,state,"dedupeKey",payload,attempts,"leaseOwner","leaseUntil","createdById","createdAt","updatedAt") VALUES($1,$2,\'UPLOAD_MEDIA\',\'PROCESSING\',$3,$4::jsonb,1,$5,(clock_timestamp()+interval \'5 minutes\') AT TIME ZONE \'UTC\',$6,clock_timestamp() AT TIME ZONE \'UTC\',clock_timestamp() AT TIME ZONE \'UTC\')', [jobId, first.proposalId, `kp:archive:upload:${jobId}`, JSON.stringify(payload), owner, options.actorId]);
            const cleanup = first.mediaId ? { schema: 1, kind: "UNATTACHED_MEDIA", proposalId: first.proposalId, operationJobId: jobId, mediaId: first.mediaId, projectId: null, binding: first.binding, objects: group.map(objectJson) }
              : { schema: 1, kind: "ORPHAN_ARCHIVE_ARTIFACT", proposalId: first.proposalId, operationJobId: jobId, artifactId: first.artifactId, archiveReserveReceiptId: reserveReceiptId(manifest.sha256), archiveManifestHash: manifest.sha256, binding: first.binding, objects: group.map(objectJson) };
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
        await requireActive(manifest, owner); return { published: false };
      });
    }),
    active: (manifest, owner) => tx(manifest, () => requireActive(manifest, owner)),
    verified: (manifest, owner, object) => tx(manifest, async () => {
      await requireActive(manifest, owner); archiveAssert(allArchiveObjects(manifest).some(expected => canonical(expected) === canonical(object)), "ARCHIVE_OBJECT_OWNER_MISMATCH"); await verifyTargetObject(object, true);
      const row = await ownedJob(object.jobId); archiveAssert(row, "ARCHIVE_LEASE_LOST");
      const prior = row.result && isObject(row.result.verified) ? row.result.verified : {};
      await client.query('UPDATE "ProposalJob" SET result=$2::jsonb,"updatedAt"=clock_timestamp() AT TIME ZONE \'UTC\' WHERE id=$1', [object.jobId, JSON.stringify({ archiveManifestHash: manifest.sha256, verified: { ...prior, [object.id]: object.sha256 } })]);
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
          await client.query('INSERT INTO "ProposalVersion"(id,"proposalId",revision,trigger,state,"pricingSnapshot","renderSnapshot","templateVersion","createdById","createdAt") VALUES($1,$2,0,\'IMPORT\',$3::jsonb,\'{}\'::jsonb,$4::jsonb,\'legacy-import-v1\',$5,$6::timestamptz AT TIME ZONE \'UTC\')', [proposal.versionId, proposal.id, JSON.stringify(proposal.state), JSON.stringify(snapshot), options.actorId, proposal.updatedAt]);
          for (const media of proposal.media) {
            const changed = await client.query('UPDATE "ProposalMedia" SET "uploadState"=\'READY\' WHERE id=$1 AND "proposalId"=$2 AND "uploadJobId"=$3 AND "uploadState"=\'PENDING\' AND "retiringAt" IS NULL AND "optimizedPurgedAt" IS NULL', [media.id, proposal.id, media.jobId]);
            archiveAssert(changed.rowCount === 1, "ARCHIVE_MEDIA_CHANGED");
            await client.query('INSERT INTO "ProposalCurrentMedia"("proposalId","mediaId") VALUES($1,$2)', [proposal.id, media.id]);
            await client.query('INSERT INTO "ProposalVersionMedia"("proposalId","versionId","mediaId") VALUES($1,$2,$3)', [proposal.id, proposal.versionId, media.id]);
          }
          const changed = await client.query('UPDATE "CommercialProposal" SET state=$2::jsonb,"deletedAt"=NULL WHERE id=$1 AND "sourceId"=$3 AND "isArchive"=true AND "projectId" IS NULL AND "clientId" IS NULL AND "deletedAt" IS NOT NULL', [proposal.id, JSON.stringify(proposal.state), proposal.sourceId]);
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
          await client.query('INSERT INTO "ProposalContractVersion"(id,"contractId","settingsSnapshot","clientSnapshot","sourcesSnapshot","renderSnapshot","templateVersion","docxArtifactId","createdById","createdAt") VALUES($1,$2,$3::jsonb,\'{}\'::jsonb,\'[]\'::jsonb,$4::jsonb,\'legacy-docx-unknown\',$5,$6,$7::timestamptz AT TIME ZONE \'UTC\')', [docx.versionId, artifact.contractId, JSON.stringify(snapshot), JSON.stringify({ archiveImport: { sourceObject: docx.sourceObject, historicalSettingsKnown: false } }), artifact.artifactId, options.actorId, docx.sourceObject.modifiedAt]);
        }
        for (const id of jobsFor(manifest)) {
          const changed = await client.query('UPDATE "ProposalJob" SET state=\'SUCCEEDED\',"leaseOwner"=NULL,"leaseUntil"=NULL,"updatedAt"=clock_timestamp() AT TIME ZONE \'UTC\' WHERE id=$1 AND state=\'PROCESSING\' AND "leaseOwner"=$2 AND "leaseUntil">clock_timestamp() AT TIME ZONE \'UTC\'', [id, owner]); archiveAssert(changed.rowCount === 1, "ARCHIVE_LEASE_LOST");
        }
        await insertReceipt(publishReceiptId(manifest.sha256), "kpArchiveImport", manifest.sha256, "archive.publish", { schema: 1, manifestHash: manifest.sha256, proposalIds: manifest.proposals.map(row => row.id), counts: manifest.counts, verifiedObjectHashes: Object.fromEntries(allArchiveObjects(manifest).map(row => [row.id, row.sha256])) });
      });
    }),
    reconcile: manifest => tx(manifest, async () => {
      archiveAssert(await published(manifest), "ARCHIVE_NOT_PUBLISHED");
      let items = 0; const policyPurgedObjectIds: string[] = [];
      for (const proposal of manifest.proposals) {
        await verifyProposal(proposal, true);
        const rows = await query<{ id: string; position: number; state: JsonObject; productId: string | null }>('SELECT id,position,state,"productId" FROM "ProposalItem" WHERE "proposalId"=$1 AND "deletedAt" IS NULL ORDER BY position', [proposal.id]);
        archiveAssert(rows.length === proposal.state.items.length && rows.every((row, index) => row.id === proposal.state.items[index].id && row.position === index + 1 && row.productId === null && canonical(row.state) === canonical(proposal.state.items[index])), "ARCHIVE_RECONCILIATION_MISMATCH"); items += rows.length;
        const version = (await query<{ state: JsonObject; provenance: JsonObject }>('SELECT state,"renderSnapshot"->\'archiveImport\' AS provenance FROM "ProposalVersion" WHERE id=$1 AND "proposalId"=$2', [proposal.versionId, proposal.id]))[0]; archiveAssert(version && canonical(version.provenance) === canonical(archiveProposalVersionSnapshot(manifest, proposal)) && canonical(version.state) === canonical(proposal.state), "ARCHIVE_RECONCILIATION_MISMATCH");
        const original = await receipt(docReceiptId(proposal.id)); archiveAssert(original && canonical(original.newValue) === canonical(archiveProposalProvenance(manifest, proposal)), "ARCHIVE_RECONCILIATION_MISMATCH");
        for (const media of proposal.media) {
          const record = (await query<{ uploadState: string; optimizedPurged: boolean; originalPurged: boolean; optimizedHash: string; optimizedKey: string; originalHash: string | null; originalKey: string | null; expiresAt: string }>('SELECT "uploadState",("optimizedPurgedAt" IS NOT NULL) AS "optimizedPurged",("originalPurgedAt" IS NOT NULL) AS "originalPurged","optimizedHash","optimizedKey","originalHash","originalKey",to_char("expiresAt",\'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "expiresAt" FROM "ProposalMedia" WHERE id=$1 AND "proposalId"=$2', [media.id, proposal.id]))[0];
          archiveAssert(record?.uploadState === "READY" && record.optimizedHash === media.optimized.sha256 && record.optimizedKey === media.optimized.key && record.originalHash === (media.original?.sha256 ?? null) && record.originalKey === (media.original?.key ?? null) && record.expiresAt === media.expiresAt, "ARCHIVE_RECONCILIATION_MISMATCH");
          const refs = await query('SELECT 1 FROM "ProposalCurrentMedia" c JOIN "ProposalVersionMedia" v ON v."proposalId"=c."proposalId" AND v."mediaId"=c."mediaId" WHERE c."proposalId"=$1 AND c."mediaId"=$2 AND v."versionId"=$3', [proposal.id, media.id, proposal.versionId]); archiveAssert(refs.length === 1, "ARCHIVE_RECONCILIATION_MISMATCH");
          if (record.optimizedPurged) policyPurgedObjectIds.push(media.optimized.id); if (media.original && record.originalPurged) policyPurgedObjectIds.push(media.original.id);
        }
      }
      for (const settings of manifest.settings) {
        const row = (await query<{ settings: JsonObject }>('SELECT settings FROM "ProposalContract" WHERE id=$1 AND "primaryProposalId"=$2', [settings.id, settings.proposalId]))[0]; archiveAssert(row && canonical(row.settings) === canonical(settings.settings), "ARCHIVE_RECONCILIATION_MISMATCH");
        const original = await receipt(`kp.archive.settings:${settings.id}`); archiveAssert(original?.newValue.sourceHash === settings.sourceHash && original.newValue.rawBase64 === settings.rawBase64, "ARCHIVE_RECONCILIATION_MISMATCH");
        const sources = await query<{ proposalId: string; position: number }>('SELECT "proposalId",position FROM "ProposalContractSource" WHERE "contractId"=$1 ORDER BY position', [settings.id]); archiveAssert(canonical(sources) === canonical(settings.sourceProposalIds.map((proposalId, index) => ({ proposalId, position: index + 1 }))), "ARCHIVE_RECONCILIATION_MISMATCH");
      }
      for (const docx of manifest.docx) {
        const artifact = docx.artifact!;
        const rows = await query<{ key: string; sha256: string; size: number; state: string; createdAt: string }>('SELECT a.key,a.sha256,a.size,a.state::text AS state,to_char(v."createdAt",\'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS "createdAt" FROM "ProposalContractVersion" v JOIN "ProposalArtifact" a ON a.id=v."docxArtifactId" AND a."contractId"=v."contractId" WHERE v.id=$1 AND v."contractId"=$2 AND a.id=$3', [docx.versionId, artifact.contractId, artifact.artifactId]);
        archiveAssert(rows.length === 1 && rows[0].key === artifact.key && rows[0].sha256 === artifact.sha256 && rows[0].size === artifact.size && rows[0].state === "READY" && rows[0].createdAt === docx.sourceObject.modifiedAt, "ARCHIVE_RECONCILIATION_MISMATCH");
      }
      for (const object of allArchiveObjects(manifest)) await verifyTargetObject(object, false);
      return { published: true, proposals: manifest.proposals.length, items, settings: manifest.settings.length, docx: manifest.docx.length, verifiedObjects: allArchiveObjects(manifest).length - policyPurgedObjectIds.length, businessBaselinePreserved: true, policyPurgedObjectIds } satisfies ArchiveReconciliation;
    }),
    release: (manifest, owner) => tx(manifest, async () => {
      for (const id of jobsFor(manifest)) await client.query('UPDATE "ProposalJob" SET state=\'FAILED\',"leaseOwner"=NULL,"leaseUntil"=NULL,"lastErrorCode"=\'ARCHIVE_INTERRUPTED\',"updatedAt"=clock_timestamp() AT TIME ZONE \'UTC\' WHERE id=$1 AND state=\'PROCESSING\' AND "leaseOwner"=$2', [id, owner]);
    }),
  };
}
