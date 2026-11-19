import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { defineJournalReversal, JournalReversalRefusal } from "@/server/changelog/reversal-contract";
import { lockProjectRow } from "@/server/projects/lock";

const scope = z.object({
  proposalId: z.string().min(1),
  versionId: z.string().min(1),
  artifactId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  expectedDeletedAt: z.iso.datetime().nullable(),
  hide: z.boolean(),
}).strict();
type PdfVisibilityCommand = z.infer<typeof scope>;
const refusal = "После выпуска были изменены КП, этап или договор, связанный с PDF";

async function eligible(tx: Prisma.TransactionClient, data: PdfVisibilityCommand) {
  const row = await tx.proposalVersion.findFirst({
    where: {
      id: data.versionId, proposalId: data.proposalId, trigger: "PDF", revision: data.revision,
      proposal: { deletedAt: null, revision: data.revision, acceptedVersionId: null,
        project: { deletedAt: null, stage: "LEAD" } },
      pdfArtifactId: data.artifactId, pdfArtifact: { kind: "PDF", state: "READY",
        deletedAt: data.expectedDeletedAt ? new Date(data.expectedDeletedAt) : null },
    },
    select: { createdAt: true, proposal: { select: { projectId: true } } },
  });
  if (!row?.proposal.projectId) return null;
  if (await tx.proposalVersion.count({ where: { proposalId: data.proposalId, trigger: { not: "EDIT" },
    OR: [{ createdAt: { gt: row.createdAt } }, { createdAt: row.createdAt, id: { gt: data.versionId } }] } })) return null;
  if (await tx.proposalContractVersion.count({ where: {
    renderSnapshot: { path: ["releases"], array_contains: [{ versionId: data.versionId }] },
  } })) return null;
  return row.proposal.projectId;
}

export const issuedProposalPdfReversal = defineJournalReversal({
  kind: "proposal.pdf.visibility",
  version: 1,
  schema: scope,
  async preview({ tx }, data) { return await eligible(tx, data) ? null : refusal; },
  async apply({ tx }, data) {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)`;
    const owner = await tx.commercialProposal.findUnique({ where: { id: data.proposalId }, select: { projectId: true } });
    if (!owner?.projectId) throw new JournalReversalRefusal(refusal);
    await lockProjectRow(tx, owner.projectId);
    await tx.$queryRaw`SELECT id FROM "CommercialProposal" WHERE id=${data.proposalId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "ProposalArtifact" WHERE id=${data.artifactId} FOR UPDATE`;
    const projectId = await eligible(tx, data);
    if (projectId !== owner.projectId) throw new JournalReversalRefusal(refusal);
    const deletedAt = data.hide ? new Date() : null;
    await tx.proposalArtifact.update({ where: { id: data.artifactId }, data: { deletedAt } });
    return {
      inverse: { ...data, expectedDeletedAt: deletedAt?.toISOString() ?? null, hide: !data.hide },
      oldValue: { deletedAt: data.expectedDeletedAt },
      newValue: { deletedAt: deletedAt?.toISOString() ?? null, versionId: data.versionId },
      cachePaths: ["/kp", "/kp/" + encodeURIComponent(data.proposalId), "/projects/" + encodeURIComponent(projectId)],
    };
  },
});

