import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { defineJournalReversal, JournalReversalRefusal } from "@/server/changelog/reversal-contract";
import { lockProjectRow } from "@/server/projects/lock";
import { applyProposalClientEffect, previewProposalClientEffect, proposalClientEffectSchema } from "./proposal-client-reversal";
import { proposalEditFingerprint } from "./edit-checkpoint";

const creation = z.object({
  proposalId: z.string().min(1),
  projectId: z.string().min(1),
  clientId: z.string().min(1),
  expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  expectedDeletedAt: z.iso.datetime().nullable(),
  hide: z.boolean(),
  clientEffect: proposalClientEffectSchema.optional(),
}).strict();
type CreationVisibility = z.infer<typeof creation>;
const refusal = "После создания изменились КП, связанный проект, его файлы или изделия";

async function canReverseCreation(tx: Prisma.TransactionClient, data: CreationVisibility) {
  const deletedAt = data.expectedDeletedAt ? new Date(data.expectedDeletedAt) : null;
  const proposal = await tx.commercialProposal.findFirst({ where: {
    id: data.proposalId, projectId: data.projectId, clientId: data.clientId, revision: 0, deletedAt, acceptedVersionId: null,
    project: { id: data.projectId, stage: "LEAD", deletedAt },
  }, select: { id: true } });
  return proposal && await proposalEditFingerprint(tx, data.proposalId, data.projectId, data.clientId) === data.expectedFingerprint;
}

export const proposalCreationReversal = defineJournalReversal({
  kind: "proposal.create",
  version: 1,
  schema: creation,
  async preview(ctx, data) { return await canReverseCreation(ctx.tx, data) ? previewProposalClientEffect(ctx, data.clientEffect) : refusal; },
  async apply(ctx, data) {
    const { tx, actor } = ctx;
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)`;
    await lockProjectRow(tx, data.projectId);
    await tx.$queryRaw`SELECT id FROM "CommercialProposal" WHERE id=${data.proposalId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Product" WHERE "projectId"=${data.projectId} ORDER BY id FOR UPDATE`;
    if (!await canReverseCreation(tx, data)) throw new JournalReversalRefusal(refusal);
    const client = await applyProposalClientEffect(ctx, data.clientEffect);
    const deletedAt = data.hide ? new Date() : null;
    await tx.project.update({ where: { id: data.projectId }, data: {
      deletedAt, deletedById: data.hide ? actor.id : null,
    } });
    await tx.commercialProposal.update({ where: { id: data.proposalId }, data: { deletedAt } });
    return {
      inverse: { ...data, clientEffect: client?.inverse, hide: !data.hide, expectedDeletedAt: deletedAt?.toISOString() ?? null,
        expectedFingerprint: await proposalEditFingerprint(tx, data.proposalId, data.projectId, data.clientId) },
      oldValue: { deletedAt: data.expectedDeletedAt },
      newValue: { deletedAt: deletedAt?.toISOString() ?? null, projectId: data.projectId },
      eventIds: client?.eventIds,
      cachePaths: [...client?.cachePaths ?? [], "/kp", "/kp/" + encodeURIComponent(data.proposalId), "/projects", "/products", "/projects/" + encodeURIComponent(data.projectId)],
    };
  },
});

