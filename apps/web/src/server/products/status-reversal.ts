import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { ACTIVE_PRODUCT_STATUS_IDS, isActiveProductStatus } from "@/lib/product-statuses";
import { liveProductWhere } from "@/server/access/live-entities";
import { defineJournalReversal, JournalReversalRefusal } from "@/server/changelog/reversal-contract";
import { readWorkflowCompensation, workflowDependencies } from "@/server/changelog/workflow-dependencies";
import { lockProjectRow } from "@/server/projects/lock";
import { lockProductRow } from "./quantity-core";

export const productWorkflowSelect = { id: true, projectId: true, number: true, status: true, statusChangedAt: true,
  workflowRevision: true, engineerId: true, assemblerId: true, mounterId: true } as const;
type ProductWorkflow = Prisma.ProductGetPayload<{ select: typeof productWorkflowSelect }>;
const state = z.object({ status: z.enum(ACTIVE_PRODUCT_STATUS_IDS), at: z.iso.datetime() });
const schema = z.object({ projectId: z.string(), previous: state, expected: state, revision: z.number().int().positive(),
  dependency: z.string(), assignments: z.array(z.string().nullable()), compensation: z.json(), pending: z.boolean() });

const assignmentIds = (product: ProductWorkflow) => [product.engineerId, product.assemblerId, product.mounterId];
const route = (id: string) => `/products/${encodeURIComponent(id)}`;

export function productWorkflowCommand(product: ProductWorkflow, toStatus: ProductWorkflow["status"],
  changedAt: Date, dependency: string, compensation: unknown, pending: boolean) {
  if (!isActiveProductStatus(product.status) || !isActiveProductStatus(toStatus)) return undefined;
  return productStatusReversal.command({ projectId: product.projectId,
    previous: { status: product.status, at: product.statusChangedAt.toISOString() },
    expected: { status: toStatus, at: changedAt.toISOString() }, revision: product.workflowRevision + 1,
    dependency, assignments: assignmentIds(product), compensation: schema.shape.compensation.parse(compensation), pending });
}

async function eligible(tx: Prisma.TransactionClient, id: string, data: z.infer<typeof schema>) {
  if (data.pending) throw new JournalReversalRefusal("Расчёт этого перехода ещё ожидает валютный курс", route(id));
  const product = await tx.product.findFirst({ where: { ...liveProductWhere, id }, select: productWorkflowSelect });
  if (!product || product.projectId !== data.projectId || product.workflowRevision !== data.revision ||
    product.status !== data.expected.status || product.statusChangedAt.toISOString() !== data.expected.at ||
    JSON.stringify(assignmentIds(product)) !== JSON.stringify(data.assignments) ||
    await workflowDependencies(tx, data.projectId, id) !== data.dependency)
    throw new JournalReversalRefusal("После перехода изменились работы, назначения, расчёты или состояние изделия", route(id));
  return product;
}

export const productStatusReversal = defineJournalReversal({
  kind: "product.workflow.status", version: 1, schema,
  async preview(ctx, data) {
    await eligible(ctx.tx, ctx.entityId, data);
    await readWorkflowCompensation(data.compensation)?.preview(ctx);
    return null;
  },
  async apply(ctx, data) {
    const { tx, actor, entityId } = ctx;
    await lockProjectRow(tx, data.projectId);
    await lockProductRow(tx, entityId);
    const product = await eligible(tx, entityId, data);
    const compensation = await readWorkflowCompensation(data.compensation)?.apply(ctx);
    const restored = await tx.product.update({ where: { id: entityId }, data: {
      status: data.previous.status, statusChangedAt: new Date(data.previous.at),
    }, select: productWorkflowSelect });
    await tx.productStatusHistory.create({ data: { productId: entityId, fromStatus: data.expected.status,
      toStatus: data.previous.status, changedById: actor.id, comment: `Откат действия ${ctx.entryId}` } });
    const event = await tx.domainEvent.create({ data: { type: "product.statusChanged", actor: actor.id,
      payload: { productId: entityId, number: product.number, from: data.expected.status, to: data.previous.status } } });
    return {
      inverse: { ...data, previous: data.expected, expected: data.previous, revision: restored.workflowRevision,
        compensation: compensation ? schema.shape.compensation.parse(compensation.reversal.data) : null },
      oldValue: { status: data.expected.status, statusChangedAt: data.expected.at },
      newValue: { status: data.previous.status, statusChangedAt: data.previous.at, compensation: compensation?.newValue },
      cachePaths: ["/products", `/products/${encodeURIComponent(product.number)}`, "/projects", `/projects/${encodeURIComponent(product.projectId)}`, ...(compensation?.cachePaths ?? [])],
      eventIds: [event.id],
    };
  },
});
