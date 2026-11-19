import type { Prisma } from "@prisma/client";
import { defineJournalReversal, JournalReversalRefusal } from "@/server/changelog/reversal-contract";
import { lockProjectRow } from "@/server/projects/lock";
import { lockWarehouseMetadata } from "@/server/warehouse/gate";
import { checkpointBinding, eligibleEditBaseline, proposalEditCommandSchema, proposalEditFingerprint,
  proposalEditReversalKind, type ProposalEditCommand } from "./edit-checkpoint";
import { saveProposalInTransaction } from "./proposal-core";
import { canonicalProposalJson, ProposalWriteError } from "./proposal-contract";
import { applyProposalClientEffect, previewProposalClientEffect } from "./proposal-client-reversal";
import { ProposalMediaError } from "./media-contract";

async function editTarget(tx: Prisma.TransactionClient, data: ProposalEditCommand) {
  const proposal = await tx.commercialProposal.findUnique({ where: { id: data.proposalId } });
  const project = await tx.project.findUnique({ where: { id: data.projectId } });
  if (!proposal || proposal.deletedAt || proposal.projectId !== data.projectId || proposal.acceptedVersionId ||
      !project || project.deletedAt || project.stage !== "LEAD" || proposal.revision !== data.expectedRevision)
    throw new JournalReversalRefusal("КП уже изменено, удалено или вышло из этапа «Лид»");
  const version = await tx.proposalVersion.findFirst({ where: { id: data.checkpointId, proposalId: proposal.id },
    include: { media: { select: { media: { select: { deletedAt: true, retiringAt: true, uploadState: true, optimizedPurgedAt: true } } } } } });
  const binding = version && checkpointBinding(version.renderSnapshot);
  if (!version || !binding ||
      version.media.some(({ media }) => media.deletedAt || media.retiringAt || media.optimizedPurgedAt || media.uploadState !== "READY"))
    throw new JournalReversalRefusal("Не найдена полная прежняя редакция КП или её изображения недоступны");
  if (await proposalEditFingerprint(tx, proposal.id, project.id, binding.clientId) !== data.expectedFingerprint)
    throw new JournalReversalRefusal("Связанные данные изменились после сохранения КП");
  const baseline = await eligibleEditBaseline(tx, proposal, project);
  if (!baseline)
    throw new JournalReversalRefusal("Текущая редакция КП содержит изменения, для которых требуется отдельный откат");
  return { version, binding, baseline };
}

export const proposalEditReversal = defineJournalReversal({
  kind: proposalEditReversalKind,
  version: 1,
  schema: proposalEditCommandSchema,
  async preview(ctx, data) {
    try { await editTarget(ctx.tx, data); return previewProposalClientEffect(ctx, data.clientEffect); }
    catch (error) {
      if (error instanceof JournalReversalRefusal) return error.message;
      throw error;
    }
  },
  async apply(ctx, data) {
    const { tx, actor, reversalId } = ctx;
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)`;
    await lockProjectRow(tx, data.projectId);
    await tx.$queryRaw`SELECT id FROM "CommercialProposal" WHERE id=${data.proposalId} FOR UPDATE`;
    await lockWarehouseMetadata(tx);
    await tx.$queryRaw`SELECT id FROM "Product" WHERE "projectId"=${data.projectId} ORDER BY id FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Client" WHERE id IN (
      SELECT "clientId" FROM "Project" WHERE id=${data.projectId}
      UNION
      SELECT "renderSnapshot"->'binding'->>'clientId' FROM "ProposalVersion" WHERE id=${data.checkpointId}
    ) ORDER BY id FOR UPDATE`;
    const { version, binding, baseline } = await editTarget(tx, data);
    if (!reversalId) throw new JournalReversalRefusal("Не подтверждён идентификатор отката КП");
    const { createApiSaveHooks } = await import("./api-documents");
    try {
      const client = await applyProposalClientEffect(ctx, data.clientEffect);
      const mutation = await saveProposalInTransaction(tx, actor, {
        proposalId: data.proposalId, expectedRevision: data.expectedRevision, operationId: reversalId.split(":").at(-1),
        clientId: binding.clientId, state: version.state,
      }, { ...createApiSaveHooks(binding.fx), restoreVersion: true, journalRootId: reversalId,
        journalBaseline: baseline, journalClientEffect: client?.inverse });
      if (!mutation.undo || mutation.result.noOp || canonicalProposalJson(mutation.result.state) !== canonicalProposalJson(version.state))
        throw new JournalReversalRefusal("Не удалось точно восстановить прежнюю редакцию КП");
      return {
        inverse: mutation.undo,
        oldValue: { revision: data.expectedRevision },
        newValue: { revision: mutation.result.revision, versionId: version.id },
        eventIds: [...mutation.eventIds, ...client?.eventIds ?? []],
        cachePaths: [...client?.cachePaths ?? [], "/kp", "/kp/" + encodeURIComponent(data.proposalId), "/projects",
          "/projects/" + encodeURIComponent(data.projectId), "/products", "/finance", "/warehouse",
          ...mutation.result.items.map(item => "/products/" + encodeURIComponent(item.number)),
          ...mutation.changedProducts.flatMap(product => product.previousNumbers.map(number => "/products/" + encodeURIComponent(number)))],
      };
    } catch (error) {
      if (error instanceof ProposalWriteError || error instanceof ProposalMediaError)
        throw new JournalReversalRefusal(error.message);
      throw error;
    }
  },
});

