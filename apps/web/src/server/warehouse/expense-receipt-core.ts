import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { FINANCE_ROLES, EXPENSE_RECEIPT_PROJECT_ROLES, hasAnyRole } from "@/lib/roles";
import { requireActorRoles, type DomainActor } from "@/server/actor";
import { writeChangeLogInTransaction } from "@/server/changelog/writer";
import { paymentJournalSnapshot, journalProjectContext } from "@/server/finance/journal";
import { activePaymentWhere } from "@/server/payments/active-records";
import { warehouseMove, warehouseWriteGate } from "./accounting";
import { allocateExpenseReceipt } from "./expense-receipt-allocation";
import { expenseReceiptReversal } from "./expense-receipt-reversal";
import type { ConfirmExpenseReceiptInput, ExpenseReceiptInput } from "./expense-receipt-contracts";

type Tx = Prisma.TransactionClient;
export class ExpenseReceiptConflict extends Error {}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function canDetachReceiptProject(actor: DomainActor) {
  return hasAnyRole(actor.roles, EXPENSE_RECEIPT_PROJECT_ROLES);
}

export async function loadExpenseReceiptPreview(tx: Tx, actor: DomainActor, input: ExpenseReceiptInput) {
  requireActorRoles(actor, FINANCE_ROLES);
  const payment = await tx.payment.findFirst({
    where: { ...activePaymentWhere, id: input.paymentId, direction: "EXPENSE", logisticsAllocationId: null,
      stockPurchase: null, expenseReceipts: { none: { cancelledAt: null } } },
    include: { project: { select: { id: true, number: true, deletedAt: true } }, cashAccount: { select: { id: true, name: true, currency: true } },
      reportDocuments: { select: { documentId: true }, orderBy: { position: "asc" } } },
  });
  if (!payment?.cashAccount || payment.cashAccount.currency !== payment.currency) {
    throw Error("Расход недоступен для оприходования или уже связан со складом");
  }
  if (payment.projectId && (!payment.project || payment.project.deletedAt || !canDetachReceiptProject(actor))) {
    throw Error("Для оприходования требуется право снять назначение с действующего проекта");
  }
  const lines = allocateExpenseReceipt(input.lines, payment.amount.toFixed(2), payment.bynAmount.toFixed(2));
  const materialIds = [...new Set(lines.map(row => row.materialId))];
  const materials = await tx.material.findMany({ where: { id: { in: materialIds }, active: true },
    select: { id: true, name: true, measurementUnit: { select: { name: true } } } });
  const byId = new Map(materials.map(row => [row.id, row]));
  if (byId.size !== materialIds.length) throw Error("Один из материалов недоступен");
  const cashAccount = payment.cashAccount;
  const documents = payment.reportDocuments.length ? payment.reportDocuments.map(row => row.documentId)
    : payment.reportDocumentId ? [payment.reportDocumentId] : [];
  const snapshot = paymentJournalSnapshot(payment, { project: payment.project?.number, cashAccount: cashAccount.name, documentIds: documents });
  const labeledLines = lines.map(row => ({
    ...row, materialName: byId.get(row.materialId)!.name, unit: byId.get(row.materialId)!.measurementUnit.name,
  }));
  const fingerprint = hash({ actorId: actor.id, paymentId: payment.id, lastActionId: payment.lastActionId, snapshot, lines: labeledLines });
  return { payment, cashAccount, documents, snapshot, fingerprint, lines: labeledLines };
}

export async function readExpenseReceipt(tx: Pick<Tx, "expenseReceipt">, actor: DomainActor, input: ConfirmExpenseReceiptInput) {
  const receipt = await tx.expenseReceipt.findUnique({ where: { clientMutationId: input.clientMutationId },
    select: { id: true, actorId: true, requestFingerprint: true, cancelledAt: true, paymentId: true } });
  if (!receipt) return null;
  if (receipt.actorId !== actor.id || receipt.paymentId !== input.paymentId || receipt.cancelledAt ||
      receipt.requestFingerprint !== hash({ preview: input.fingerprint, lines: input.lines })) {
    throw new ExpenseReceiptConflict("Идентификатор уже использован или оприходование отменено");
  }
  return receipt;
}

export async function postExpenseReceiptInTransaction(
  tx: Tx, actor: DomainActor, input: ConfirmExpenseReceiptInput, reversalId?: string,
) {
  requireActorRoles(actor, FINANCE_ROLES);
  const previous = await readExpenseReceipt(tx, actor, input);
  if (previous) return { receiptId: previous.id, projectId: null, eventIds: [] as string[], repeated: true };
  const current = await tx.payment.findUnique({ where: { id: input.paymentId }, select: { projectId: true } });
  if (current?.projectId) {
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${current.projectId} FOR SHARE`;
  }
  await warehouseWriteGate(tx);
  const ids = [...new Set(input.lines.map(line => line.materialId))].sort();
  await tx.$queryRaw`SELECT id FROM "Material" WHERE id IN (${Prisma.join(ids)}) ORDER BY id COLLATE "C" FOR UPDATE`;
  const prepared = await loadExpenseReceiptPreview(tx, actor, input);
  if (prepared.fingerprint !== input.fingerprint) throw Error("Расход или строки изменились. Обновите предпросмотр.");
  const { payment, cashAccount, documents, snapshot } = prepared;
  const receipt = await tx.expenseReceipt.create({ data: { paymentId: payment.id,
    clientMutationId: input.clientMutationId, requestFingerprint: hash({ preview: input.fingerprint, lines: input.lines }), actorId: actor.id } });
  const journalId = reversalId ?? randomUUID();
  const eventIds: string[] = [];
  const sorted = prepared.lines.map((line, position) => ({ ...line, position }))
    .sort((a, b) => a.materialId.localeCompare(b.materialId) || a.position - b.position);
  for (const line of sorted) {
    const unitPrice = new Prisma.Decimal(line.amount).div(line.quantity).toFixed(12);
    const stock = await warehouseMove(tx, actor, { kind: "INCOME", clientMutationId: randomUUID(),
      materialId: line.materialId, quantity: line.quantity, comment: payment.comment ?? undefined },
    { bynAmount: line.bynAmount, operationRootId: journalId, purchase: {
      currency: payment.currency, unitPrice,
      amount: line.amount, cashAccountId: cashAccount.id, cashAccount: cashAccount.name,
      expenseArticleId: payment.expenseArticleId, rate: payment.rate.toString(), rateDate: payment.rateDate?.toISOString() ?? null,
      paidAt: payment.paidAt.toISOString(), reportDocumentIds: documents,
    } });
    await tx.expenseReceiptLine.create({ data: { receiptId: receipt.id, movementId: stock.movement.id,
      position: line.position, amount: line.amount, unitPrice } });
    if (stock.eventId) eventIds.push(stock.eventId);
  }
  const updated = await tx.payment.updateMany({ where: { ...activePaymentWhere, id: payment.id,
    projectId: payment.projectId, lastActionId: payment.lastActionId },
    data: { projectId: null, projectAmount: null, lastActionId: journalId },
  });
  if (updated.count !== 1) throw new ExpenseReceiptConflict("Расход или назначение уже изменились");
  if (!reversalId) {
    await writeChangeLogInTransaction(tx, { id: journalId, entity: "payment", entityId: payment.id,
      action: "update", actorType: "user", actorId: actor.id, actorName: actor.name, source: actor.source,
      oldValue: { ...snapshot, expenseReceiptId: null },
      newValue: { ...snapshot, projectId: null, project: null, projectAmount: null, expenseReceiptId: receipt.id },
      reversal: expenseReceiptReversal.command({ mode: "undo", receiptId: receipt.id,
        projectId: payment.projectId, projectAmount: payment.projectAmount?.toFixed(2) ?? null,
        expectedHead: journalId, priorHead: payment.lastActionId }),
    }, { entity: { label: "Оприходование расхода" },
      contexts: payment.project ? [journalProjectContext(payment.project)] : [] });
  }
  return { receiptId: receipt.id, projectId: payment.projectId, eventIds, repeated: false };
}
