import { randomUUID } from "node:crypto";
import { z } from "zod";
import { defineJournalReversal, JournalReversalRefusal } from "@/server/changelog/reversal-contract";
import { activePaymentWhere } from "@/server/payments/active-records";
import { averagePrice } from "@/lib/warehouse-cost";
import { warehouseWriteGate } from "./accounting";
import { activeStockMovementWhere } from "./active-records";
import { planWarehouseDeletion } from "./deletion-plan";
import { canDetachReceiptProject, loadExpenseReceiptPreview, postExpenseReceiptInTransaction } from "./expense-receipt-core";
import type { Prisma } from "@prisma/client";
import type { DomainActor } from "@/server/actor";

const schema = z.object({
  mode: z.enum(["undo", "redo"]),
  receiptId: z.string().min(1),
  projectId: z.string().nullable(),
  projectAmount: z.string().nullable(),
  expectedHead: z.string().nullable(),
  priorHead: z.string().nullable(),
}).strict();
type Command = z.output<typeof schema>;
type Context = { tx: Prisma.TransactionClient; actor: DomainActor; entryId: string; entityId: string };

async function prepare(ctx: Context, data: Command) {
  const { tx, actor } = ctx;
  const receipt = await tx.expenseReceipt.findUnique({ where: { id: data.receiptId },
    include: { lines: { orderBy: { position: "asc" }, include: { movement: true } } } });
  const payment = await tx.payment.findFirst({ where: { ...activePaymentWhere, id: ctx.entityId, lastActionId: data.expectedHead } });
  if (!receipt?.lines.length || !payment || receipt.paymentId !== payment.id ||
      (data.mode === "undo" ? Boolean(receipt.cancelledAt) || payment.projectId !== null
        : !receipt.cancelledAt || payment.projectId !== data.projectId || (payment.projectAmount?.toFixed(2) ?? null) !== data.projectAmount)) {
    throw new JournalReversalRefusal("Расход или оприходование уже изменились");
  }
  if (data.projectId) {
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${data.projectId} FOR SHARE`;
    const project = await tx.project.findFirst({ where: { id: data.projectId, deletedAt: null }, select: { id: true } });
    if (!project || !canDetachReceiptProject(actor)) throw new JournalReversalRefusal("Исходное назначение проекта недоступно");
  }
  return { receipt, payment };
}

async function prepareUndo(ctx: Context, receipt: Awaited<ReturnType<typeof prepare>>["receipt"]) {
  const { tx } = ctx;
  const state = await warehouseWriteGate(tx);
  const rootsByMaterial = new Map<string, string[]>();
  for (const line of receipt.lines) {
    if (line.movement.deletionId || line.movement.type !== "INCOME" || line.movement.receiptKind !== "PAID") {
      throw new JournalReversalRefusal("Складские строки уже изменились");
    }
    const ids = rootsByMaterial.get(line.movement.materialId) ?? [];
    ids.push(line.movementId);
    rootsByMaterial.set(line.movement.materialId, ids);
  }
  const movementIds = receipt.lines.map(line => line.movementId);
  const issue = await tx.expenseReceiptIssueLine.findFirst({ where: {
    sourceMovementId: { in: movementIds }, issue: { cancelledAt: null }, movement: activeStockMovementWhere,
  }, select: { issue: { select: { productId: true } } } });
  if (issue) throw new JournalReversalRefusal("Из строк чека выполнена выдача. Сначала отмените её в журнале",
    `/products/${encodeURIComponent(issue.issue.productId)}`);
  const plans = [];
  for (const materialId of [...rootsByMaterial.keys()].sort()) {
    await tx.$queryRaw`SELECT id FROM "Material" WHERE id = ${materialId} FOR UPDATE`;
    const balance = await tx.warehouseBalance.findUnique({ where: { materialId } });
    const rows = await tx.warehouseMovementValuation.findMany({
      where: { runId: state.runId, movement: { ...activeStockMovementWhere, materialId } },
      include: { movement: { select: { type: true, productId: true, quantity: true, totalByn: true } } }, take: 10001,
    });
    if (!balance || balance.runId !== state.runId || rows.length > 10000) {
      throw new JournalReversalRefusal("Недостаточно данных для безопасной отмены оприходования");
    }
    const facts = rows.map(row => {
      if (!row.quantity.eq(row.movement.quantity) || !row.moneyByn.eq(row.movement.totalByn ?? -1) ||
          (row.accountingRevision !== null && row.accountingRevision > balance.revision)) {
        throw new JournalReversalRefusal("Складские снимки изменились");
      }
      return { id: row.movementId, type: row.movement.type, quantity: row.quantity.toString(),
        unitCost: row.unitCost.toString(), value: row.valueByn.toString(), money: row.moneyByn.toString(),
        sourceId: row.sourceMovementId, revision: row.accountingRevision, createdAt: row.createdAt.toISOString() };
    });
    const plan = planWarehouseDeletion(facts, { quantity: balance.quantity.toString(), value: balance.valueByn.toString() },
      rootsByMaterial.get(materialId)!);
    const dependent = plan.deleted.find(row => row.reason !== "ROOT");
    if (dependent) {
      const productId = rows.find(row => row.movementId === dependent.id)?.movement.productId;
      throw new JournalReversalRefusal("Откат изменит последующую выдачу или возврат. Сначала разберите зависимое движение.",
        productId ? `/products/${encodeURIComponent(productId)}` : "/warehouse/movements");
    }
    plans.push({ materialId, position: plan.position });
  }
  return plans;
}

function restoredInput(receipt: Awaited<ReturnType<typeof prepare>>["receipt"]) {
  return { paymentId: receipt.paymentId, lines: receipt.lines.map(row => ({
    materialId: row.movement.materialId, quantity: row.movement.quantity.toString(), amount: row.amount.toFixed(2),
  })) };
}

export const expenseReceiptReversal = defineJournalReversal({
  kind: "expense-stock-receipt", version: 1, schema,
  async preview(ctx, command) {
    const { receipt } = await prepare(ctx, command);
    if (command.mode === "undo") await prepareUndo(ctx, receipt);
    else await loadExpenseReceiptPreview(ctx.tx, ctx.actor, restoredInput(receipt));
    return null;
  },
  async apply(ctx, command) {
    const { tx, actor, reversalId } = ctx;
    if (!reversalId) throw new JournalReversalRefusal("Идентификатор отмены отсутствует");
    const { receipt, payment } = await prepare(ctx, command);
    if (command.mode === "redo") {
      const input = restoredInput(receipt);
      const preview = await loadExpenseReceiptPreview(tx, actor, input);
      const result = await postExpenseReceiptInTransaction(tx, actor,
        { ...input, clientMutationId: randomUUID(), fingerprint: preview.fingerprint }, reversalId);
      return { inverse: { ...command, mode: "undo" as const, receiptId: result.receiptId,
        expectedHead: reversalId, priorHead: command.expectedHead },
        oldValue: { projectId: command.projectId, expenseReceiptId: null },
        newValue: { projectId: null, expenseReceiptId: result.receiptId },
        cachePaths: ["/finance/expenses", "/finance/accounts/report", "/warehouse/stock", "/warehouse/movements"],
        eventIds: result.eventIds };
    }
    const plans = await prepareUndo(ctx, receipt);
    const movementIds = receipt.lines.map(row => row.movementId);
    const deletion = await tx.warehouseMovementDeletion.create({ data: {
      clientMutationId: randomUUID(), actorId: actor.id, rootMovementId: movementIds[0],
      planFingerprint: reversalId,
    } });
    const marked = await tx.stockMovement.updateMany({
      where: { ...activeStockMovementWhere, id: { in: movementIds } }, data: { deletionId: deletion.id },
    });
    if (marked.count !== movementIds.length) throw new JournalReversalRefusal("Складские строки уже изменились");
    for (const { materialId, position } of plans) {
      await tx.warehouseBalance.update({ where: { materialId },
        data: { quantity: position.quantity, valueByn: position.value, revision: { increment: 1 } } });
      await tx.$executeRaw`UPDATE "Material" SET "purchasePrice" = CAST(${averagePrice(position)} AS numeric) WHERE id = ${materialId}`;
    }
    await tx.expenseReceipt.update({ where: { id: receipt.id }, data: { cancelledAt: new Date() } });
    const updated = await tx.payment.updateMany({
      where: { ...activePaymentWhere, id: payment.id, lastActionId: command.expectedHead },
      data: { projectId: command.projectId, projectAmount: command.projectAmount, lastActionId: command.priorHead },
    });
    if (updated.count !== 1) throw new JournalReversalRefusal("Расход уже изменился");
    const event = await tx.domainEvent.create({ data: { type: "stock.movement.deleted", actor: actor.id,
      payload: { deletionId: deletion.id, movementIds, paymentIds: [] } } });
    return { inverse: { ...command, mode: "redo" as const, expectedHead: command.priorHead, priorHead: command.expectedHead },
      oldValue: { projectId: null, expenseReceiptId: receipt.id },
      newValue: { projectId: command.projectId, expenseReceiptId: null },
      cachePaths: ["/finance/expenses", "/finance/accounts/report", "/warehouse/stock", "/warehouse/movements"],
      eventIds: [event.id] };
  },
});
