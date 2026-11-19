import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { defineJournalReversal, JournalReversalRefusal } from "@/server/changelog/reversal-contract";
import { lockProjectRow } from "@/server/projects/lock";

const draft = z.object({
  contractId: z.string().min(1),
  primaryId: z.string().min(1),
  expectedRevision: z.number().int().positive(),
  settings: z.record(z.string(), z.json()),
  sourceIds: z.array(z.string().min(1)).min(1),
  sources: z.array(z.object({ proposalId: z.string(), projectId: z.string(), revision: z.number(),
    stage: z.string(), clientId: z.string().nullable() })).min(1),
  clients: z.array(z.object({ id: z.string(), updatedAt: z.iso.datetime() })),
  versions: z.array(z.string()),
}).strict();
type DraftCommand = z.infer<typeof draft>;
const draftPresence = draft.omit({ settings: true }).extend({
  expectedDeletedAt: z.iso.datetime().nullable(), hide: z.boolean(),
}).strict();
const refusal = "Настройки договора, исходные КП, клиенты или выпуски изменились";

async function readDraft(tx: Prisma.TransactionClient, data: Omit<DraftCommand, "settings">,
  presence?: Pick<z.infer<typeof draftPresence>, "expectedDeletedAt">) {
  const current = await tx.proposalContract.findFirst({
    where: { id: data.contractId, primaryProposalId: data.primaryId, revision: data.expectedRevision,
      deletedAt: presence?.expectedDeletedAt ? new Date(presence.expectedDeletedAt) : null },
    select: { revision: true, settings: true, _count: { select: { jobs: true, versions: true } },
      sources: { where: { detachedAt: null }, orderBy: { position: "asc" }, select: { proposalId: true } },
      versions: { where: { docxArtifact: { deletedAt: null } }, select: { id: true } },
      jobs: { where: { state: { in: ["PENDING", "PROCESSING"] } }, select: { id: true }, take: 1 } },
  });
  if (!current || current.jobs.length || presence && (current._count.jobs || current._count.versions) || JSON.stringify(current.versions.map(v => v.id).sort()) !== JSON.stringify([...data.versions].sort())
      || data.sourceIds[0] !== data.primaryId || new Set(data.sourceIds).size !== data.sourceIds.length) return null;
  const sources = await tx.commercialProposal.findMany({ where: { id: { in: data.sources.map(source => source.proposalId) }, deletedAt: null },
    select: { id: true, clientId: true, revision: true, project: { select: { id: true, stage: true, clientId: true, deletedAt: true } } } });
  if (!data.sourceIds.every(id => data.sources.some(source => source.proposalId === id)) ||
      !data.sources.every(source => sources.some(item => item.id === source.proposalId && item.revision === source.revision &&
        item.clientId === source.clientId && item.project?.id === source.projectId && item.project.stage === source.stage &&
        item.project.clientId === source.clientId && !item.project.deletedAt))) return null;
  const clients = await tx.client.findMany({ where: { id: { in: data.clients.map(client => client.id) } }, select: { id: true, updatedAt: true } });
  if (!data.clients.every(client => clients.some(row => row.id === client.id && row.updatedAt.toISOString() === client.updatedAt))) return null;
  return current;
}

export const savedContractDraftReversal = defineJournalReversal({
  kind: "proposal.contract.draft",
  version: 1,
  schema: draft,
  async preview({ tx }, data) { return await readDraft(tx, data) ? null : refusal; },
  async apply({ tx, actor }, data) {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)`;
    const projectIds = [...new Set(data.sources.map(source => source.projectId))].sort();
    for (const id of projectIds) await lockProjectRow(tx, id);
    await tx.$queryRaw`SELECT id FROM "ProposalContract" WHERE id=${data.contractId} FOR UPDATE`;
    for (const client of [...data.clients].sort((a, b) => a.id.localeCompare(b.id)))
      await tx.$queryRaw`SELECT id FROM "Client" WHERE id=${client.id} FOR SHARE`;
    const current = await readDraft(tx, data);
    const previous = draft.shape.settings.safeParse(current?.settings);
    if (!current || !previous.success) throw new JournalReversalRefusal(refusal);
    const { createPostgresContractTransaction } = await import("./contract-store");
    const saved = await createPostgresContractTransaction(tx).saveDraft({
      id: data.contractId, primaryId: data.primaryId, expectedRevision: data.expectedRevision,
      create: false, settings: data.settings, sourceIds: data.sourceIds, actorId: actor.id,
    });
    return {
      inverse: { ...data, settings: previous.data, sourceIds: current.sources.map(source => source.proposalId), expectedRevision: saved.revision },
      oldValue: { revision: current.revision },
      newValue: { revision: saved.revision, sourceIds: data.sourceIds },
      cachePaths: ["/kp", ...projectIds.map(id => "/projects/" + encodeURIComponent(id))],
    };
  },
});


export const createdContractDraftReversal = defineJournalReversal({
  kind: "proposal.contract.create",
  version: 1,
  schema: draftPresence,
  async preview({ tx }, data) { return await readDraft(tx, data, data) ? null : refusal; },
  async apply({ tx, actor }, data) {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)`;
    const projectIds = [...new Set(data.sources.map(source => source.projectId))].sort();
    for (const id of projectIds) await lockProjectRow(tx, id);
    await tx.$queryRaw`SELECT id FROM "ProposalContract" WHERE id=${data.contractId} FOR UPDATE`;
    for (const client of [...data.clients].sort((a, b) => a.id.localeCompare(b.id)))
      await tx.$queryRaw`SELECT id FROM "Client" WHERE id=${client.id} FOR SHARE`;
    if (!await readDraft(tx, data, data)) throw new JournalReversalRefusal(refusal);
    const deletedAt = data.hide ? new Date() : null;
    await tx.proposalContract.update({ where: { id: data.contractId },
      data: { deletedAt, deletedById: data.hide ? actor.id : null } });
    return {
      inverse: { ...data, expectedDeletedAt: deletedAt?.toISOString() ?? null, hide: !data.hide },
      oldValue: { deletedAt: data.expectedDeletedAt }, newValue: { deletedAt: deletedAt?.toISOString() ?? null },
      cachePaths: ["/kp", ...projectIds.map(id => "/projects/" + encodeURIComponent(id))],
    };
  },
});
