import type { PoolClient } from "pg";
import { z } from "zod";
import { archiveAssert, assertArchiveDatabaseIdentity, canonical, isObject, parseTargetProfile, valueHash,
  type ArchiveManifest, type ArchiveProposal, type JsonObject, type TargetProfile } from "./contract";
import { verifyPublishedArchiveOrigin, type ArchiveReservationReader } from "./prisma-store";

const id = z.string().min(1).max(160), hash = z.string().regex(/^[a-f0-9]{64}$/);
const entrySchema = z.object({ proposalId: id, sourceId: id, sourceNumber: z.string().regex(/^[1-9][0-9]*$/), projectId: id, clientId: id.nullable(),
  revision: z.number().int().min(0), stateHash: hash, proposalHash: hash, itemsHash: hash, projectHash: hash, productsHash: hash, ownersHash: hash,
  links: z.array(z.object({ itemId: id, productId: id }).strict()).max(5000) }).strict();
const planSchema = z.object({ schema: z.literal(1), kind: z.literal("KP_IMPORTED_PROPOSAL_NORMALIZATION"), manifestHash: hash,
  target: z.unknown(), operatorId: id, operationId: z.uuid(), proposals: z.array(entrySchema).length(23) }).strict();
export type ImportedProposalNormalization = Omit<z.infer<typeof planSchema>, "target"> & { target: TargetProfile };
export type NormalizationSnapshot = { proposal: JsonObject; project: JsonObject; items: JsonObject[]; products: JsonObject[]; owners: JsonObject[] };
const ordered = (rows: JsonObject[]) => [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id), "en"));
const unique = (values: string[]) => new Set(values).size === values.length;
const without = (row: JsonObject, keys: string[]) => Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));

/** Только точные действующие номера. Отсутствие соответствия оставляет NULL до явного сохранения КП. */
export function normalizationEntry(source: Pick<ArchiveProposal, "id" | "sourceId" | "sourceNumber">, snapshot: NormalizationSnapshot) {
  const { proposal, project, items, products, owners } = snapshot;
  archiveAssert(proposal.id === source.id && proposal.sourceId === source.sourceId && proposal.sourceNumber === source.sourceNumber &&
    typeof source.sourceNumber === "string" && /^[1-9][0-9]*$/.test(source.sourceNumber) && project.number === source.sourceNumber &&
    typeof project.id === "string" && (project.clientId === null || typeof project.clientId === "string") &&
    proposal.deletedAt === null && project.deletedAt === null && (proposal.projectId === null || proposal.projectId === project.id) &&
    (proposal.clientId === null || proposal.clientId === project.clientId) && Number.isSafeInteger(proposal.revision) && Number(proposal.revision) >= 0 && isObject(proposal.state), "KP_NORMALIZATION_MAPPING_CHANGED");
  const active = items.filter(item => item.deletedAt === null);
  archiveAssert(items.every(item => item.proposalId === source.id && typeof item.id === "string") && unique(items.map(item => String(item.id))) &&
    active.every(item => Number.isSafeInteger(item.position) && Number(item.position) > 0) && unique(active.map(item => String(item.position))), "KP_NORMALIZATION_MAPPING_CHANGED");
  const links: { itemId: string; productId: string }[] = [];
  for (const item of ordered(active)) {
    const candidates = products.filter(product => product.deletedAt === null && product.projectId === project.id && product.number === `${project.number}.${item.position}`);
    const product = candidates.length === 1 && typeof candidates[0].id === "string" && !owners.some(owner => owner.productId === candidates[0].id && owner.id !== item.id) ? candidates[0] : null;
    archiveAssert(item.productId === null || item.productId === product?.id, "KP_NORMALIZATION_MAPPING_CHANGED");
    if (product) links.push({ itemId: String(item.id), productId: String(product.id) });
  }
  return { proposalId: source.id, sourceId: source.sourceId, sourceNumber: source.sourceNumber, projectId: project.id, clientId: project.clientId as string | null,
    revision: Number(proposal.revision), stateHash: valueHash(proposal.state), proposalHash: valueHash(proposal), itemsHash: valueHash(ordered(items)),
    projectHash: valueHash(project), productsHash: valueHash(ordered(products)), ownersHash: valueHash(ordered(owners)), links };
}
export function parseImportedProposalNormalization(value: unknown, manifest: ArchiveManifest): ImportedProposalNormalization {
  const parsed = planSchema.safeParse(value);
  archiveAssert(parsed.success, "KP_NORMALIZATION_PLAN_INVALID");
  const plan = { ...parsed.data, target: parseTargetProfile(parsed.data.target) };
  archiveAssert(plan.manifestHash === manifest.sha256 && manifest.proposals.length === 23 && unique(plan.proposals.map(row => row.proposalId)) &&
    unique(plan.proposals.map(row => row.projectId)) && plan.proposals.every(row => {
      const source = manifest.proposals.find(proposal => proposal.id === row.proposalId);
      return source?.sourceId === row.sourceId && source.sourceNumber === row.sourceNumber && unique(row.links.map(link => link.itemId)) && unique(row.links.map(link => link.productId));
    }), "KP_NORMALIZATION_PLAN_INVALID");
  return plan;
}
export const normalizationReceiptId = (operationId: string) => `kp.import.normalize:${operationId}`;
export function normalizationOwnedRows(plan: ImportedProposalNormalization) {
  const ids = plan.proposals.map(row => row.proposalId);
  return { CommercialProposal: { column: "id", ids }, ProposalItem: { column: "proposalId", ids }, ChangeLog: { column: "id", ids: [normalizationReceiptId(plan.operationId)] } };
}
async function readSnapshot(client: ArchiveReservationReader, proposalId: string, projectId: string): Promise<NormalizationSnapshot> {
  const rows = async (sql: string, values: unknown[]) => (await client.query<{ row: JsonObject }>(sql, values)).rows.map(row => row.row);
  const proposal = (await rows('SELECT to_jsonb(t) AS row FROM "CommercialProposal" t WHERE id=$1', [proposalId]))[0];
  const project = (await rows('SELECT to_jsonb(t) AS row FROM "Project" t WHERE id=$1', [projectId]))[0];
  archiveAssert(proposal && project, "KP_NORMALIZATION_MAPPING_CHANGED");
  return { proposal, project,
    items: await rows('SELECT to_jsonb(t) AS row FROM "ProposalItem" t WHERE "proposalId"=$1 ORDER BY id', [proposalId]),
    products: await rows('SELECT to_jsonb(t) AS row FROM "Product" t WHERE "projectId"=$1 ORDER BY id', [projectId]),
    owners: await rows('SELECT jsonb_build_object(\'id\',id,\'productId\',"productId") AS row FROM "ProposalItem" WHERE "productId" IN (SELECT id FROM "Product" WHERE "projectId"=$1) ORDER BY id', [projectId]) };
}
/** SELECT-only building block для native под внешним rollback; production capture ниже дополнительно требует настоящий READ ONLY. */
export async function readImportedProposalNormalizationEntry(client: ArchiveReservationReader, source: Pick<ArchiveProposal, "id" | "sourceId" | "sourceNumber">, projectId: string) {
  return normalizationEntry(source, await readSnapshot(client, source.id, projectId));
}
/** SELECT-only порт: Root предоставляет guarded REPEATABLE READ READ ONLY и точное reviewed сопоставление ID. */
export async function captureImportedProposalNormalization(client: ArchiveReservationReader, input: {
  manifest: ArchiveManifest; target: TargetProfile; operatorId: string; operationId: string; mapping: { proposalId: string; projectId: string }[];
}): Promise<ImportedProposalNormalization> {
  const { rows } = await client.query<{ readOnly: string; isolation: string }>('SELECT current_setting(\'transaction_read_only\') AS "readOnly",current_setting(\'transaction_isolation\') AS isolation');
  archiveAssert(rows[0]?.readOnly === "on" && rows[0].isolation === "repeatable read", "KP_NORMALIZATION_READONLY_REQUIRED");
  const identity = await client.query<{ database: string; schema: string; user: string }>('SELECT current_database() AS database,current_schema() AS schema,current_user AS user');
  assertArchiveDatabaseIdentity(input.target, identity.rows[0]);
  archiveAssert(input.mapping.length === 23 && unique(input.mapping.map(row => row.proposalId)) && unique(input.mapping.map(row => row.projectId)), "KP_NORMALIZATION_PLAN_INVALID");
  await verifyPublishedArchiveOrigin(client, input.manifest);
  const proposals = [];
  for (const mapping of [...input.mapping].sort((a, b) => a.proposalId.localeCompare(b.proposalId, "en"))) {
    const source = input.manifest.proposals.find(proposal => proposal.id === mapping.proposalId);
    archiveAssert(source, "KP_NORMALIZATION_PLAN_INVALID");
    proposals.push(await readImportedProposalNormalizationEntry(client, source, mapping.projectId));
  }
  return parseImportedProposalNormalization({ schema: 1, kind: "KP_IMPORTED_PROPOSAL_NORMALIZATION", manifestHash: input.manifest.sha256,
    target: input.target, operatorId: input.operatorId, operationId: input.operationId, proposals }, input.manifest);
}

/** Одна транзакция меняет только CP bindings/legacy flag и точные ProposalItem.productId; save/pricing/media не вызываются. */
export async function normalizeImportedProposals(client: PoolClient, manifest: ArchiveManifest, input: unknown, options: {
  reviewedHash: string; guardTarget(target: TargetProfile, client?: PoolClient): Promise<void>;
  baseline(client: PoolClient, owned: ReturnType<typeof normalizationOwnedRows>): Promise<string>;
}) {
  const plan = parseImportedProposalNormalization(input, manifest), planHash = valueHash(plan), receiptId = normalizationReceiptId(plan.operationId);
  archiveAssert(options.reviewedHash === planHash, "KP_NORMALIZATION_REVIEW_REQUIRED");
  await options.guardTarget(plan.target, client);
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
  try {
    await client.query("SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)");
    await options.guardTarget(plan.target, client);
    const identity = await client.query<{ database: string; schema: string; user: string }>('SELECT current_database() AS database,current_schema() AS schema,current_user AS user');
    assertArchiveDatabaseIdentity(plan.target, identity.rows[0]);
    const actor = await client.query<{ active: boolean; roles: string[] }>('SELECT active,roles::text[] AS roles FROM "User" WHERE id=$1 FOR SHARE', [plan.operatorId]);
    archiveAssert(actor.rows[0]?.active && actor.rows[0].roles.includes("ADMIN"), "KP_NORMALIZATION_ACTOR_FORBIDDEN");
    const result = { operationId: plan.operationId, planHash, proposals: plan.proposals.length, linkedItems: plan.proposals.reduce((n, row) => n + row.links.length, 0) };
    const audit = { schema: 1, manifestHash: manifest.sha256, ...result };
    const previous = await client.query<{ row: JsonObject }>('SELECT to_jsonb(t) AS row FROM "ChangeLog" t WHERE id=$1', [receiptId]);
    if (previous.rows.length) {
      const row = previous.rows[0].row;
      archiveAssert(row.entity === "kpImportedProposalNormalization" && row.entityId === plan.operationId && row.action === "kp.import.normalize" &&
        row.actorType === "user" && row.actorId === plan.operatorId && row.source === "cli" && canonical(row.newValue) === canonical(audit), "KP_NORMALIZATION_OPERATION_CHANGED");
      await client.query("COMMIT"); return { ...result, replayed: true };
    }
    const projectIds = plan.proposals.map(row => row.projectId), proposalIds = plan.proposals.map(row => row.proposalId);
    await client.query('SELECT id FROM "Project" WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE', [projectIds]);
    await client.query('SELECT id FROM "CommercialProposal" WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE', [proposalIds]);
    const conflicts = await client.query('SELECT id FROM "CommercialProposal" WHERE "projectId"=ANY($1::text[]) AND NOT(id=ANY($2::text[])) ORDER BY id FOR UPDATE', [projectIds, proposalIds]);
    archiveAssert(conflicts.rows.length === 0, "KP_NORMALIZATION_MAPPING_CHANGED");
    await client.query('SELECT id FROM "Product" WHERE "projectId"=ANY($1::text[]) ORDER BY id FOR UPDATE', [projectIds]);
    await client.query('SELECT id FROM "ProposalItem" WHERE "proposalId"=ANY($1::text[]) OR "productId" IN (SELECT id FROM "Product" WHERE "projectId"=ANY($2::text[])) ORDER BY id FOR UPDATE', [proposalIds, projectIds]);
    await verifyPublishedArchiveOrigin(client, manifest);
    const before = await options.baseline(client, normalizationOwnedRows(plan));
    for (const expected of plan.proposals) {
      const source = manifest.proposals.find(proposal => proposal.id === expected.proposalId)!;
      const original = await readSnapshot(client, expected.proposalId, expected.projectId);
      archiveAssert(canonical(normalizationEntry(source, original)) === canonical(expected), "KP_NORMALIZATION_SNAPSHOT_CHANGED");
      const updated = await client.query('UPDATE "CommercialProposal" SET "projectId"=$2,"clientId"=$3,"isArchive"=false WHERE id=$1 AND revision=$4', [expected.proposalId, expected.projectId, expected.clientId, expected.revision]);
      archiveAssert(updated.rowCount === 1, "KP_NORMALIZATION_SNAPSHOT_CHANGED");
      for (const link of expected.links) {
        const changed = await client.query('UPDATE "ProposalItem" SET "productId"=$2 WHERE id=$1 AND "proposalId"=$3 AND ("productId" IS NULL OR "productId"=$2)', [link.itemId, link.productId, expected.proposalId]);
        archiveAssert(changed.rowCount === 1, "KP_NORMALIZATION_SNAPSHOT_CHANGED");
      }
      const after = await readSnapshot(client, expected.proposalId, expected.projectId);
      archiveAssert(valueHash(without(original.proposal, ["projectId", "clientId", "isArchive"])) === valueHash(without(after.proposal, ["projectId", "clientId", "isArchive"])) &&
        valueHash(ordered(original.items).map(row => without(row, ["productId"]))) === valueHash(ordered(after.items).map(row => without(row, ["productId"]))), "KP_NORMALIZATION_PRESERVATION_FAILED");
      archiveAssert(after.proposal.projectId === expected.projectId && after.proposal.clientId === expected.clientId && after.proposal.isArchive === false &&
        after.items.every(item => item.productId === (expected.links.find(link => link.itemId === item.id)?.productId ?? original.items.find(row => row.id === item.id)?.productId)), "KP_NORMALIZATION_PRESERVATION_FAILED");
    }
    await client.query('INSERT INTO "ChangeLog"(id,"actorType","actorId",entity,"entityId",action,"newValue",source,"createdAt") VALUES($1,\'user\',$2,\'kpImportedProposalNormalization\',$3,\'kp.import.normalize\',$4::jsonb,\'cli\',clock_timestamp() AT TIME ZONE \'UTC\')', [receiptId, plan.operatorId, plan.operationId, JSON.stringify(audit)]);
    archiveAssert(await options.baseline(client, normalizationOwnedRows(plan)) === before, "KP_NORMALIZATION_BUSINESS_CHANGED");
    await options.guardTarget(plan.target, client);
    await client.query("COMMIT"); return { ...result, replayed: false };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
}
