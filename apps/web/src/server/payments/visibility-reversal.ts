import { createHash } from "node:crypto";
import type { Payment, Prisma } from "@prisma/client";
import { z } from "zod";
import { defineJournalReversal, JournalReversalRefusal } from "@/server/changelog/reversal-contract";
import { journalProjectContext, paymentJournalSnapshot } from "@/server/finance/journal";
import { readCashBalance, readOrgBalance } from "@/server/payroll/cash-core";

const paymentInclude = {
  project: { select: { id: true, number: true, deletedAt: true } },
  stockPurchase: { select: { id: true } },
  cashAccount: { select: { name: true } },
  expenseArticle: { select: { name: true } },
  reportDocuments: { select: { documentId: true, document: { select: { fileName: true } } }, orderBy: { position: "asc" } },
} satisfies Prisma.PaymentInclude;

type StoredPayment = Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>;
const commandSchema = z.object({
  visible: z.boolean(), expectedHead: z.string().nullable(), priorHead: z.string().nullable(), fingerprint: z.string().length(64),
}).strict();
type VisibilityCommand = z.infer<typeof commandSchema>;

export function readPaymentForVisibility(tx: Prisma.TransactionClient, id: string) {
  return tx.payment.findUnique({ where: { id }, include: paymentInclude });
}

export function paymentVisibilityDocumentIds(payment: StoredPayment) {
  return payment.reportDocuments.length ? payment.reportDocuments.map(row => row.documentId) :
    payment.reportDocumentId ? [payment.reportDocumentId] : [];
}

function fingerprint(payment: Payment, ids: readonly string[]) {
  return createHash("sha256").update(JSON.stringify(paymentJournalSnapshot(payment, { documentIds: [...ids] }))).digest("hex");
}

export function paymentVisibilityCommand(payment: Payment, ids: readonly string[], visible: boolean, head: string, priorHead: string | null) {
  return paymentVisibilityReversal.command({
    visible, expectedHead: head, priorHead, fingerprint: fingerprint(payment, ids),
  });
}

export function paymentVisibilityHints(payment: StoredPayment, visible: boolean) {
  const snapshot = paymentJournalSnapshot(payment, { project: payment.project?.number,
    cashAccount: payment.cashAccount?.name, expenseArticle: payment.expenseArticle?.name, documentIds: paymentVisibilityDocumentIds(payment) });
  return {
    entity: { label: `${payment.direction === "INCOME" ? "Приход" : "Расход"} ${payment.amount.toString()} ${payment.currency}` },
    contexts: payment.project ? [journalProjectContext(payment.project)] : [],
    links: [
      ...(payment.project ? [{ type: "project", ...journalProjectContext(payment.project) }] : []),
      ...(payment.cashAccountId && payment.cashAccount ? [{ type: "cashAccount", id: payment.cashAccountId, label: payment.cashAccount.name }] : []),
      ...(payment.expenseArticleId && payment.expenseArticle ? [{ type: "expenseArticle", id: payment.expenseArticleId, label: payment.expenseArticle.name }] : []),
      ...payment.reportDocuments.map(row => ({ type: "financeDocument", id: row.documentId, label: row.document.fileName })),
    ],
    before: visible ? null : snapshot, after: visible ? snapshot : null,
  };
}

export async function paymentVisibilityProblem(tx: Prisma.TransactionClient, payment: StoredPayment | null,
  visible: boolean, command?: VisibilityCommand): Promise<string | null> {
  if (!payment || payment.deletionId) return "Платёж не найден или отменён вместе со складской операцией";
  if (payment.logisticsAllocationId) return "Расход связан с рейсом — исправьте общий рейс в логистике";
  if (payment.stockPurchase) return "Платёж связан с приходом на склад — отдельно изменить его нельзя";
  if (payment.project?.deletedAt) return "Проект в корзине: финансовая история доступна только для просмотра";
  if (Boolean(payment.deletedAt) !== visible) return visible ? "Платёж уже действует" : "Платёж уже удалён";
  if (command && (command.expectedHead !== payment.lastActionId || command.fingerprint !== fingerprint(payment, paymentVisibilityDocumentIds(payment))))
    return "Платёж изменился после этого действия. Откройте его историю";
  if (visible) {
    const ids = paymentVisibilityDocumentIds(payment);
    if (ids.length && await tx.financeDocument.count({ where: { id: { in: ids }, state: "READY" } }) !== ids.length)
      return "Сначала восстановите исходные отчётные документы платежа";
  }

  const decreasesBalance = visible ? payment.direction === "EXPENSE" : payment.direction === "INCOME";
  if (!decreasesBalance) return null;
  if (payment.cashAccountId && (await readCashBalance(tx, payment.cashAccountId)).lt(payment.amount))
    return "Операция сделает остаток кассы отрицательным";
  const balance = await readOrgBalance(tx, "1", payment.bynAmount.negated().toFixed(2));
  return balance.lt(0) ? "Операция сделает баланс организации отрицательным" : null;
}

export async function setPaymentVisibility(tx: Prisma.TransactionClient, payment: StoredPayment, visible: boolean,
  actorId: string, nextHead: string | null) {
  const changed = await tx.payment.updateMany({
    where: { id: payment.id, deletionId: null, deletedAt: payment.deletedAt, lastActionId: payment.lastActionId },
    data: { deletedAt: visible ? null : new Date(), deletedById: visible ? null : actorId, lastActionId: nextHead },
  });
  if (changed.count !== 1) throw new JournalReversalRefusal("Платёж уже изменён — обновите карточку");
}

export const paymentVisibilityReversal = defineJournalReversal({
  kind: "payment.visibility", version: 1, schema: commandSchema,
  async preview({ tx, entityId }, command) {
    return paymentVisibilityProblem(tx, await readPaymentForVisibility(tx, entityId), command.visible, command);
  },
  async apply({ tx, entityId, actor }, command) {
    const payment = await readPaymentForVisibility(tx, entityId);
    const problem = await paymentVisibilityProblem(tx, payment, command.visible, command);
    if (problem || !payment) throw new JournalReversalRefusal(problem ?? "Платёж не найден");
    await setPaymentVisibility(tx, payment, command.visible, actor.id, command.priorHead);
    return { inverse: { ...command, visible: !command.visible, expectedHead: command.priorHead, priorHead: command.expectedHead },
      hints: paymentVisibilityHints(payment, command.visible),
      cachePaths: ["/finance/income", "/finance/expenses", "/finance/accounts", "/finance/accounts/report", "/finance/payroll",
        ...(payment.projectId ? [`/finance/projects/${encodeURIComponent(payment.projectId)}`] : [])] };
  },
});
