import { Prisma } from "@prisma/client";
import type { DomainActor } from "@/server/actor";
import { defineJournalReversal, JournalReversalRefusal } from "@/server/changelog/reversal-contract";
import { liveWorkWhere } from "@/server/access/live-entities";
import { workVisibilityWhere } from "@/server/access/visibility";
import { scaleNorm, workBudget } from "@/lib/product-quantity";
import { allocatedWorkQuantity, quantityAtoms } from "@/lib/work-shares";
import { trackedRevision } from "@/server/tasks/edit-reversal-contract";
import { operationJournalContext, journalSnapshot, WORK_JOURNAL_FIELDS } from "@/server/tasks/journal";
import { lockProductRow } from "@/server/products/quantity-core";
import { isOrdinaryWork } from "./plan";
import { createWorkEditReversal, workEditReversalKind, workEditReversalSchema, workEditSnapshot, type WorkEditReversal } from "./edit-reversal-contract";

async function prepareWorkEditRestore(tx: Prisma.TransactionClient, actor: DomainActor, workId: string, data: WorkEditReversal) {
  const work = await tx.work.findUnique({ where: { ...liveWorkWhere, id: workId, AND: [workVisibilityWhere(actor)] }, include: {
    product: { select: { id: true, number: true, quantity: true } },
    tasks: { where: { deletedAt: null }, select: { quantity: true, allocationGroupId: true } },
    _count: { select: { paymentConversions: true, settlementShares: true } },
  } });
  if (!work || !work.product || !isOrdinaryWork(work) || work._count.paymentConversions || work._count.settlementShares || !work.priceSnapshot)
    throw new JournalReversalRefusal("Работа недоступна для отката");
  const hasPrice = data.expected.price !== undefined;
  if (Object.entries(data.revisions).some(([field, revision]) => trackedRevision(work.journalFieldRevisions, field) !== revision) ||
      JSON.stringify(workEditSnapshot(work, hasPrice)) !== JSON.stringify(data.expected))
    throw new JournalReversalRefusal("Изменённые поля работы уже обновились");
  if (await tx.payrollEntry.count({ where: { workId } }))
    throw new JournalReversalRefusal("По работе уже есть начисления");
  if (hasPrice && work.tasks.length)
    throw new JournalReversalRefusal("Расценку нельзя менять после создания связанных задач");
  if (data.restore.price?.priceItemId && !await tx.priceItem.findUnique({ where: { id: data.restore.price.priceItemId }, select: { id: true } }))
    throw new JournalReversalRefusal("Прежняя расценка больше не существует");
  const quantity = data.restore.quantityPerUnit === null ? data.restore.quantity
    : scaleNorm(data.restore.quantityPerUnit, work.product.quantity, 2, 10);
  if (quantityAtoms(quantity) < quantityAtoms(allocatedWorkQuantity(work.tasks)))
    throw new JournalReversalRefusal("Прежний объём меньше уже распределённого по задачам");
  const price = data.restore.price ? new Prisma.Decimal(data.restore.price.priceSnapshot) : work.priceSnapshot;
  const total = workBudget(price, quantity);
  const patch = { ...data.restore.price, quantity, quantityPerUnit: data.restore.quantityPerUnit, priceSnapshot: price, total };
  return { work, patch };
}

export const workEditReversal = defineJournalReversal({
  kind: workEditReversalKind,
  version: 1,
  schema: workEditReversalSchema,
  async preview(ctx, data) {
    try {
      await prepareWorkEditRestore(ctx.tx, ctx.actor, ctx.entityId, data);
      return null;
    } catch (error) {
      if (error instanceof JournalReversalRefusal) return error.message;
      throw error;
    }
  },
  async apply(ctx, data) {
    const { tx, actor, entityId } = ctx;
    const reference = await tx.work.findUnique({ where: { id: entityId }, select: { productId: true } });
    if (reference?.productId) await lockProductRow(tx, reference.productId);
    await tx.$queryRaw`SELECT id FROM "Work" WHERE id = ${entityId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Task" WHERE "workId" = ${entityId} ORDER BY id FOR UPDATE`;
    const { work, patch } = await prepareWorkEditRestore(tx, actor, entityId, data);
    const after = await tx.work.update({ where: { id: work.id }, data: patch });
    const inverse = createWorkEditReversal(work, after);
    if (!inverse) throw new JournalReversalRefusal("Изменение работы отсутствует");
    const before = journalSnapshot(work, WORK_JOURNAL_FIELDS), next = journalSnapshot(after, WORK_JOURNAL_FIELDS);
    const hints = await operationJournalContext(tx, { type: "work", id: work.id, label: work.title }, [work, after]);
    return { inverse, oldValue: before, newValue: next, hints: { ...hints, before, after: next },
      cachePaths: ["/tasks", "/my", `/projects/${work.projectId}`, `/products/${work.productId}`, `/products/${work.product?.number}`] };
  },
});
