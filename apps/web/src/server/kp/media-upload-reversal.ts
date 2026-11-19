import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { defineJournalReversal, JournalReversalRefusal } from "@/server/changelog/reversal-contract";
import { lockProjectRow } from "@/server/projects/lock";

const uploadReversalSchema = z.object({
  proposalId: z.string().min(1),
  mediaId: z.string().min(1),
  jobId: z.string().min(1),
  expectedDeletedAt: z.iso.datetime().nullable(),
  deleted: z.boolean(),
}).strict();
type UploadReversalCommand = z.infer<typeof uploadReversalSchema>;

async function readEligibleUpload(tx: Prisma.TransactionClient, data: UploadReversalCommand) {
  return tx.proposalMedia.findFirst({
    where: {
      id: data.mediaId, proposalId: data.proposalId, uploadJobId: data.jobId, uploadState: "READY",
      deletedAt: data.expectedDeletedAt ? new Date(data.expectedDeletedAt) : null,
      retiringAt: null, originalPurgedAt: null, optimizedPurgedAt: null,
      proposal: { deletedAt: null, project: { deletedAt: null } },
      currentUses: { none: { detachedAt: null } },
      versionUses: { none: {} },
      productFiles: { none: { deletedAt: null, proposalMediaRetiredAt: null } },
    },
    select: { proposal: { select: { projectId: true } } },
  });
}

const refusal = "Загрузка недоступна или изображение уже используется в КП, версии или изделии";

export const proposalMediaUploadReversal = defineJournalReversal({
  kind: "proposal-media.upload",
  version: 1,
  schema: uploadReversalSchema,
  async preview({ tx }, data) {
    return await readEligibleUpload(tx, data) ? null : refusal;
  },
  async apply({ tx, actor }, data) {
    const owner = await tx.commercialProposal.findUnique({ where: { id: data.proposalId }, select: { projectId: true } });
    if (!owner?.projectId) throw new JournalReversalRefusal(refusal);
    await lockProjectRow(tx, owner.projectId);
    await tx.$queryRaw`SELECT id FROM "CommercialProposal" WHERE id=${data.proposalId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "ProposalMedia" WHERE id=${data.mediaId} FOR UPDATE`;
    const current = await readEligibleUpload(tx, data);
    if (current?.proposal.projectId !== owner.projectId) throw new JournalReversalRefusal(refusal);
    const deletedAt = data.deleted ? new Date() : null;
    await tx.proposalMedia.update({ where: { id: data.mediaId },
      data: { deletedAt, deletedById: data.deleted ? actor.id : null } });
    return {
      inverse: { ...data, expectedDeletedAt: deletedAt?.toISOString() ?? null, deleted: !data.deleted },
      oldValue: { deletedAt: data.expectedDeletedAt }, newValue: { deletedAt: deletedAt?.toISOString() ?? null },
      cachePaths: ["/projects/" + encodeURIComponent(owner.projectId)],
    };
  },
});
