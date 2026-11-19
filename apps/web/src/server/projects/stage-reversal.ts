import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { ACTIVE_PROJECT_STAGE_IDS, isActiveProjectStage } from "@/lib/stages";
import { liveProjectWhere } from "@/server/access/live-entities";
import { defineJournalReversal, JournalReversalRefusal } from "@/server/changelog/reversal-contract";
import { workflowDependencies } from "@/server/changelog/workflow-dependencies";
import { createPrismaLifecycleStore } from '@/server/kp/lifecycle-store';
import { lockProjectRow } from "./lock";
import { automationJournalContext, productJournalContext } from "./journal";
import { writeChangeLogInTransaction } from "@/server/changelog/writer";

const proposalState = z.object({ id: z.string(), revision: z.number().int(), epoch: z.number().int(),
  version: z.string().nullable(), acceptedAt: z.iso.datetime().nullable() }).nullable();
const state = z.object({ stage: z.enum(ACTIVE_PROJECT_STAGE_IDS), at: z.iso.datetime(),
  refusalReason: z.string().nullable(), refusalComment: z.string().nullable(), proposal: proposalState });
const schema = z.object({ previous: state, expected: state, revision: z.number().int().positive(),
  dependency: z.string(), promotedNow: z.boolean(),
  promoted: z.array(z.object({ id: z.string(), oldAt: z.iso.datetime(), newAt: z.iso.datetime() })) });
export const projectWorkflowSelect = { id: true, number: true, stage: true, stageChangedAt: true,
  refusalReason: true, refusalComment: true, workflowRevision: true } as const;
type ProjectWorkflow = Prisma.ProjectGetPayload<{ select: typeof projectWorkflowSelect }>;

export async function projectProposalAcceptance(tx: Prisma.TransactionClient, projectId: string) {
  const record = await tx.commercialProposal.findFirst({ where: { projectId, deletedAt: null },
    select: { id: true, revision: true, retentionEpoch: true, acceptedVersionId: true, acceptedAt: true } });
  return record ? { id: record.id, revision: record.revision, epoch: record.retentionEpoch,
    version: record.acceptedVersionId, acceptedAt: record.acceptedAt?.toISOString() ?? null } : null;
}
export function projectWorkflowState(project: ProjectWorkflow, proposal: z.infer<typeof proposalState>) {
  return state.parse({ stage: project.stage, at: project.stageChangedAt.toISOString(),
    refusalReason: project.refusalReason, refusalComment: project.refusalComment, proposal });
}

async function eligible(tx: Prisma.TransactionClient, id: string, data: z.infer<typeof schema>) {
  const project = await tx.project.findFirst({ where: { ...liveProjectWhere, id }, select: projectWorkflowSelect });
  const href = `/projects/${encodeURIComponent(id)}`;
  if (!project || !isActiveProjectStage(project.stage) || project.workflowRevision !== data.revision ||
    JSON.stringify(projectWorkflowState(project, await projectProposalAcceptance(tx, id))) !== JSON.stringify(data.expected) ||
    await workflowDependencies(tx, id) !== data.dependency)
    throw new JournalReversalRefusal("После перехода изменились этап, КП, работы, оплаты или изделия проекта", href);
  const target = data.previous.proposal;
  if (target?.version && target.version !== data.expected.proposal?.version && !await tx.proposalVersion.findFirst({ where: { id: target.version, proposalId: target.id,
    pdfArtifact: { state: "READY", deletedAt: null } }, select: { id: true } }))
    throw new JournalReversalRefusal("Принятая версия КП недоступна", href);
  return project;
}

export const projectStageReversal = defineJournalReversal({
  kind: "project.workflow.stage", version: 1, schema,
  async preview(ctx, data) { await eligible(ctx.tx, ctx.entityId, data); return null; },
  async apply(ctx, data) {
    const { tx, actor, entityId } = ctx;
    await lockProjectRow(tx, entityId);
    await tx.$queryRaw`SELECT id FROM "Product" WHERE "projectId"=${entityId} ORDER BY id FOR UPDATE`;
    const current = await eligible(tx, entityId, data);
    const oldProposal = data.previous.proposal;
    const newProposal = data.expected.proposal;
    if (oldProposal && newProposal && (oldProposal.version !== newProposal.version || oldProposal.acceptedAt !== newProposal.acceptedAt)) {
      const lifecycle = createPrismaLifecycleStore(tx, undefined, actor, ctx.reversalId);
      await lifecycle.accept(oldProposal.id, oldProposal.version, oldProposal.acceptedAt ? new Date(oldProposal.acceptedAt) : null, newProposal.epoch + 1);
      if (data.previous.stage === "LEAD") await lifecycle.cancelPruneJobs(oldProposal.id);
    }
    const restored = await tx.project.update({ where: { id: entityId }, data: { stage: data.previous.stage,
      stageChangedAt: new Date(data.previous.at), refusalReason: data.previous.refusalReason, refusalComment: data.previous.refusalComment },
      select: projectWorkflowSelect });
    await tx.projectStageHistory.create({ data: { projectId: entityId, fromStage: data.expected.stage,
      toStage: data.previous.stage, changedById: actor.id, comment: `Откат действия ${ctx.entryId}` } });
    const event = await tx.domainEvent.create({ data: { type: "project.stageChanged", actor: actor.id,
      payload: { projectId: entityId, number: current.number, from: data.expected.stage, to: data.previous.stage } } });
    const eventIds = [event.id];
    const from = data.promotedNow ? "PREPARATION" : "DRAFT", to = data.promotedNow ? "DRAFT" : "PREPARATION";
    for (const row of data.promoted) {
      const product = await tx.product.update({ where: { id: row.id, projectId: entityId, status: from, deletedAt: null },
        data: { status: to, statusChangedAt: new Date(data.promotedNow ? row.oldAt : row.newAt) }, select: { id: true, number: true } });
      await tx.productStatusHistory.create({ data: { productId: row.id, fromStatus: from, toStatus: to,
        changedById: actor.id, comment: `Откат действия ${ctx.entryId}` } });
      await writeChangeLogInTransaction(tx, { operationRootId: ctx.reversalId, actorType: "user", actorId: actor.id,
        actorName: actor.name, source: actor.source, entity: "product", entityId: row.id, action: "status", field: "status",
        oldValue: from, newValue: to }, { ...productJournalContext(product), ...automationJournalContext(actor, "Откат этапа проекта") });
      const child = await tx.domainEvent.create({ data: { type: "product.statusChanged", actor: actor.id,
        payload: { productId: row.id, projectId: entityId, number: product.number, from, to } } });
      eventIds.push(child.id);
    }
    return {
      inverse: { ...data, previous: data.expected, expected: projectWorkflowState(restored, await projectProposalAcceptance(tx, entityId)),
        revision: restored.workflowRevision, promotedNow: !data.promotedNow, dependency: await workflowDependencies(tx, entityId) },
      oldValue: { stage: data.expected.stage, stageChangedAt: data.expected.at },
      newValue: { stage: data.previous.stage, stageChangedAt: data.previous.at },
      eventIds, cachePaths: ["/projects", "/products", "/kp", ...data.promoted.map(row => `/products/${encodeURIComponent(row.id)}`)],
    };
  },
});
