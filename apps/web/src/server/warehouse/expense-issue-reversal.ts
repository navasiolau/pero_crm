import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { defineJournalReversal, JournalReversalRefusal } from "@/server/changelog/reversal-contract";
import { averagePrice } from "@/lib/warehouse-cost";
import { lockProductRow } from "@/server/products/quantity-core";
import type { DomainActor } from "@/server/actor";
import { warehouseWriteGate } from "./accounting";
import { activeStockMovementWhere } from "./active-records";
import { planWarehouseDeletion } from "./deletion-plan";
import { expenseIssueCachePaths, loadExpenseIssueQuote, postExpenseIssueInTransaction } from "./expense-issue-core";

const schema = z.object({ kind: z.enum(["undo", "redo"]), issueId: z.string().min(1).max(200) }).strict();
type Command = z.infer<typeof schema>;
type Context = { tx: Prisma.TransactionClient; actor: DomainActor; entityId: string };

async function readIssue({ tx, entityId }: Context, command: Command) {
  const affected = await tx.expenseReceiptIssue.findUnique({
    where: { id: command.issueId },
    include: { lines: { include: { movement: { include: { warehouseValuation: true } } }, orderBy: { sourceMovementId: "asc" } } },
  });
  if (!affected?.lines.length || affected.paymentId !== entityId || Boolean(affected.cancelledAt) !== (command.kind === "redo"))
    throw new JournalReversalRefusal("Выдача уже изменилась");
  return affected;
}
type Issue = Awaited<ReturnType<typeof readIssue>>;

async function planUndo(tx: Prisma.TransactionClient, issue: Issue) {
  const state = await warehouseWriteGate(tx);
  const byMaterial = new Map<string, string[]>();
  for (const { movement } of issue.lines) {
    const valuation = movement.warehouseValuation;
    if (movement.deletionId || movement.type !== "EXPENSE" || movement.productId !== issue.productId || valuation?.runId !== state.runId)
      throw new JournalReversalRefusal("Выдача изменилась после проведения");
    if (!valuation.returnedQuantity.isZero())
      throw new JournalReversalRefusal("Есть связанный возврат. Сначала разберите его", `/products/${encodeURIComponent(issue.productId)}`);
    byMaterial.set(movement.materialId, [...(byMaterial.get(movement.materialId) ?? []), movement.id]);
  }
  const materialIds = [...byMaterial.keys()].sort();
  await tx.$queryRaw`SELECT id FROM "Material" WHERE id IN (${Prisma.join(materialIds)}) ORDER BY id COLLATE "C" FOR UPDATE`;
  await lockProductRow(tx, issue.productId);
  const planned = [];
  for (const materialId of materialIds) {
    const balance = await tx.warehouseBalance.findUnique({ where: { materialId } });
    const rows = await tx.warehouseMovementValuation.findMany({ where: { runId: state.runId, movement: { ...activeStockMovementWhere, materialId } },
      include: { movement: { select: { type: true, productId: true, totalByn: true, quantity: true } } }, take: 10001 });
    if (!balance || balance.runId !== state.runId || rows.length > 10000)
      throw new JournalReversalRefusal("Недостаточно данных для безопасной отмены выдачи");
    const facts = rows.map(row => {
      if (!row.quantity.eq(row.movement.quantity) || !row.moneyByn.eq(row.movement.totalByn ?? -1) ||
          (row.accountingRevision !== null && row.accountingRevision > balance.revision))
        throw new JournalReversalRefusal("Складские снимки изменились");
      return { id: row.movementId, type: row.movement.type, quantity: row.quantity.toString(),
        unitCost: row.unitCost.toString(), value: row.valueByn.toString(), money: row.moneyByn.toString(),
        sourceId: row.sourceMovementId, revision: row.accountingRevision, createdAt: row.createdAt.toISOString() };
    });
    const plan = planWarehouseDeletion(facts, { quantity: balance.quantity.toString(), value: balance.valueByn.toString() }, byMaterial.get(materialId)!);
    for (const row of rows) {
      const baseline = plan.baselineReturns.get(row.movementId);
      if (baseline && (!row.returnedQuantity.eq(baseline.quantity) || !row.returnedValueByn.eq(baseline.value) ||
          !row.returnedMoneyByn.eq(baseline.money))) throw new JournalReversalRefusal("Счётчики возвратов не согласованы со складской историей");
    }
    const dependent = plan.deleted.find(row => row.reason !== "ROOT");
    if (dependent) {
      const productId = rows.find(row => row.movementId === dependent.id)?.movement.productId;
      throw new JournalReversalRefusal("Отмена затронет более позднюю выдачу или возврат",
        productId ? `/products/${encodeURIComponent(productId)}` : "/warehouse/movements");
    }
    planned.push({ materialId, position: plan.position });
  }
  const consumed = new Map<string, Prisma.Decimal>();
  for (const { movement } of issue.lines) if (movement.projectMaterialId) {
    const amount = consumed.get(movement.projectMaterialId) ?? new Prisma.Decimal(0);
    consumed.set(movement.projectMaterialId, amount.plus(movement.quantity));
  }
  const lineChanges = [];
  for (const [id, quantity] of consumed) {
    const line = await tx.projectMaterial.findUnique({ where: { id }, select: { productId: true, issuedQty: true } });
    if (!line || line.productId !== issue.productId || line.issuedQty.lt(quantity))
      throw new JournalReversalRefusal("Факт выдачи в потребности изменился");
    lineChanges.push({ id, quantity });
  }
  return { planned, lineChanges };
}

async function planRedo(ctx: Context, issue: Issue) {
  const input = { paymentId: issue.paymentId, projectId: issue.projectId, productId: issue.productId,
    lines: issue.lines.map(({ sourceMovementId, movement }) => ({ sourceMovementId, quantity: movement.quantity.toString() })) };
  const quote = await loadExpenseIssueQuote(ctx.tx, ctx.actor, input);
  const original = new Map(issue.lines.map(({ sourceMovementId, movement }) => [sourceMovementId, movement.warehouseValuation]));
  for (const row of quote.lines) {
    const value = original.get(row.movementId);
    if (!value?.moneyByn.eq(row.moneyByn) || !value.valueByn.eq(row.value) || !value.unitCost.eq(row.unitCost))
      throw new JournalReversalRefusal("Себестоимость изменилась. Создайте новую выдачу");
  }
  return { ...input, requestId: randomUUID(), fingerprint: quote.fingerprint };
}

async function applyUndo(tx: Prisma.TransactionClient, actor: DomainActor, issue: Issue, reversalId: string) {
  const { planned, lineChanges } = await planUndo(tx, issue);
  const movementIds = issue.lines.map(line => line.movementId);
  const deletion = await tx.warehouseMovementDeletion.create({ data: {
    clientMutationId: randomUUID(), actorId: actor.id, rootMovementId: movementIds[0], planFingerprint: reversalId,
  } });
  const marked = await tx.stockMovement.updateMany({ where: { ...activeStockMovementWhere, id: { in: movementIds } }, data: { deletionId: deletion.id } });
  if (marked.count !== movementIds.length) throw new JournalReversalRefusal("Выдача уже изменилась");
  for (const { materialId, position } of planned) {
    await tx.warehouseBalance.update({ where: { materialId },
      data: { quantity: position.quantity, valueByn: position.value, revision: { increment: 1 } } });
    await tx.$executeRaw`UPDATE "Material" SET "purchasePrice" = CAST(${averagePrice(position)} AS numeric) WHERE id = ${materialId}`;
  }
  for (const { id, quantity } of lineChanges) {
    await tx.projectMaterial.update({ where: { id }, data: { issuedQty: { decrement: quantity } } });
  }
  await tx.expenseReceiptIssue.update({ where: { id: issue.id }, data: { cancelledAt: new Date() } });
  const event = await tx.domainEvent.create({ data: { type: "stock.movement.deleted", actor: actor.id,
    payload: { deletionId: deletion.id, movementIds, paymentIds: [] } } });
  return [event.id];
}

export const expenseReceiptIssueReversal = defineJournalReversal({
  kind: "expense-receipt.issue", version: 1, schema,
  async preview(ctx, command) {
    try {
      const issue = await readIssue(ctx, command);
      if (command.kind === "undo") await planUndo(ctx.tx, issue);
      else await planRedo(ctx, issue);
      return null;
    } catch (error) {
      if (error instanceof JournalReversalRefusal) throw error;
      return "Не удалось проверить складские зависимости выдачи";
    }
  },
  async apply(ctx, command) {
    if (!ctx.reversalId) throw new JournalReversalRefusal("Идентификатор отмены отсутствует");
    const issue = await readIssue(ctx, command);
    if (command.kind === "redo") {
      const posted = await postExpenseIssueInTransaction(ctx.tx, ctx.actor, await planRedo(ctx, issue), ctx.reversalId);
      return { inverse: { kind: "undo" as const, issueId: posted.issueId },
        cachePaths: posted.cachePaths, eventIds: posted.eventIds,
        oldValue: { issueId: null }, newValue: { issueId: posted.issueId } };
    }
    const eventIds = await applyUndo(ctx.tx, ctx.actor, issue, ctx.reversalId);
    return { inverse: { kind: "redo" as const, issueId: issue.id }, cachePaths: expenseIssueCachePaths(issue.projectId, issue.productId),
      eventIds, oldValue: { issueId: issue.id }, newValue: { issueId: null } };
  },
});
