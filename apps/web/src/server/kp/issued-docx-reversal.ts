import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { defineJournalReversal, JournalReversalRefusal } from "@/server/changelog/reversal-contract";
import { lockProjectRow } from "@/server/projects/lock";

const visibility = z.object({
  contractId: z.string().min(1),
  versionId: z.string().min(1),
  artifactId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  expectedDeletedAt: z.iso.datetime().nullable(),
  hide: z.boolean(),
}).strict();
const sourceSchema = z.array(z.object({
  proposalId: z.string(), projectId: z.string(), revision: z.number(), projectStage: z.string(),
  retainedVersionId: z.string(), binding: z.object({ clientId: z.string().nullable() }), mode: z.literal("retained"),
})).min(1);
type VisibilityCommand = z.infer<typeof visibility>;
const refusal = "Источники, этапы или более поздняя редакция договора изменились";

async function contractOutput(tx: Prisma.TransactionClient, data: VisibilityCommand) {
  const row = await tx.proposalContractVersion.findFirst({ where: {
    contractId: data.contractId, id: data.versionId, docxArtifactId: data.artifactId,
    contract: { revision: data.revision, primaryProposal: { deletedAt: null, project: { deletedAt: null } } },
    docxArtifact: { state: "READY", kind: "DOCX", deletedAt: data.expectedDeletedAt ? new Date(data.expectedDeletedAt) : null },
  }, select: { sourcesSnapshot: true, createdAt: true } });
  const sources = row && sourceSchema.safeParse(row.sourcesSnapshot);
  if (!row || !sources || !sources.success || sources.data.some(source => ["LEAD", "ESTIMATE"].includes(source.projectStage))) return null;
  if (await tx.proposalContractVersion.count({ where: { contractId: data.contractId,
    OR: [{ createdAt: { gt: row.createdAt } }, { createdAt: row.createdAt, id: { gt: data.versionId } }],
  } })) return null;
  return sources.data;
}

async function matchesSources(tx: Prisma.TransactionClient, sources: z.infer<typeof sourceSchema>) {
  const current = await tx.commercialProposal.findMany({ where: { id: { in: sources.map(source => source.proposalId) }, deletedAt: null },
    select: { id: true, clientId: true, acceptedVersionId: true, revision: true,
      project: { select: { id: true, stage: true, deletedAt: true } } } });
  return sources.every(source => current.some(row => row.id === source.proposalId && row.clientId === source.binding.clientId &&
    row.revision === source.revision && row.acceptedVersionId === source.retainedVersionId &&
    row.project?.id === source.projectId && row.project.stage === source.projectStage && !row.project.deletedAt));
}

export const issuedContractDocxReversal = defineJournalReversal({
  kind: "proposal.contract.visibility",
  version: 1,
  schema: visibility,
  async preview({ tx }, data) {
    const sources = await contractOutput(tx, data);
    return sources && await matchesSources(tx, sources) ? null : refusal;
  },
  async apply({ tx }, data) {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)`;
    const initial = await contractOutput(tx, data);
    if (!initial) throw new JournalReversalRefusal(refusal);
    const projectIds = [...new Set(initial.map(source => source.projectId))].sort();
    for (const projectId of projectIds) await lockProjectRow(tx, projectId);
    await tx.$queryRaw`SELECT id FROM "ProposalContract" WHERE id=${data.contractId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "ProposalArtifact" WHERE id=${data.artifactId} FOR UPDATE`;
    const sources = await contractOutput(tx, data);
    if (!sources || !await matchesSources(tx, sources)) throw new JournalReversalRefusal(refusal);
    const deletedAt = data.hide ? new Date() : null;
    await tx.proposalArtifact.update({ where: { id: data.artifactId }, data: { deletedAt } });
    return {
      inverse: { ...data, expectedDeletedAt: deletedAt?.toISOString() ?? null, hide: !data.hide },
      oldValue: { deletedAt: data.expectedDeletedAt }, newValue: { deletedAt: deletedAt?.toISOString() ?? null, versionId: data.versionId },
      cachePaths: ["/kp", ...projectIds.map(id => "/projects/" + encodeURIComponent(id))],
    };
  },
});
