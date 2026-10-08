import { Prisma } from "@prisma/client";
import { liveProjectWhere } from "@/server/access/live-entities";
import { requireActorRoles, type DomainActor } from "@/server/actor";
import { FINANCE_ROLES } from "@/lib/roles";
import { assertProjectMoneyCurrency } from "@/lib/internal-currency";
import { isCurrency } from "@/server/finance/nbrb";
import { readCashBalance, readOrgBalance } from "@/server/payroll/cash-core";
import { requireFinanceDocumentActor } from "@/server/finance-documents/core";
import { paymentSchema, type PaymentInput } from "./contracts";
import { readPaymentReceipt, recordPaymentReceipt } from "./receipts";

export type PreparedPayment = {
  project: { id: string; number: string; currency: string } | null;
  account: { id: string; name: string };
  articleId: string | null;
  paidAt: Date;
  rate: number;
  rateDate: Date | null;
  amount: number;
  bynAmount: number;
};

/** Вызывается под общей денежной блокировкой; сеть и уведомления выполняются после commit. */
export async function createPaymentInTransaction(actor: DomainActor, input: PaymentInput,
  prepared: PreparedPayment, tx: Prisma.TransactionClient) {
  requireActorRoles(actor, FINANCE_ROLES);
  const data = paymentSchema.parse(input);
  const previous = await readPaymentReceipt(actor, data, tx);
  if (previous) return { payment: previous, eventId: null, repeated: true as const };

  if (data.reportDocumentId) {
    await requireFinanceDocumentActor(actor.id, tx);
    const document = await tx.financeDocument.findUnique({ where: { id: data.reportDocumentId },
      include: { payment: { select: { id: true } } } });
    if (!document || document.state !== "READY" || document.uploadedById !== actor.id || document.payment)
      throw Error("Отчётный документ недоступен или уже прикреплён к другой операции");
  }

  if (!isCurrency(data.currency) || data.cashAccountId !== prepared.account.id) throw Error("Реквизиты кассы изменились");
  const amount = new Prisma.Decimal(data.amount).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (!Number.isFinite(prepared.rate) || prepared.rate <= 0 || (data.currency === "BYN" && prepared.rate !== 1) ||
      !amount.eq(prepared.amount) || !amount.times(prepared.rate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).eq(prepared.bynAmount))
    throw Error("Денежный снимок изменился");
  if ((data.projectId ?? null) !== (prepared.project?.id ?? null)) throw Error("Реквизиты проекта изменились");
  if ((data.expenseArticleId || null) !== prepared.articleId) throw Error("Реквизиты статьи изменились");

  const [project, account, article] = await Promise.all([
    prepared.project ? tx.project.findUnique({ where: { ...liveProjectWhere, id: prepared.project.id }, select: { currency: true } }) : null,
    tx.cashAccount.findUnique({ where: { id: prepared.account.id }, select: { active: true, currency: true } }),
    prepared.articleId ? tx.expenseArticle.findUnique({ where: { id: prepared.articleId }, select: { active: true } }) : null,
  ]);
  if ((prepared.project && project?.currency !== prepared.project.currency) || !account?.active || account.currency !== data.currency ||
      (prepared.articleId && !article?.active)) throw Error("Реквизиты платежа изменились — обновите форму");
  if (project) assertProjectMoneyCurrency(project.currency);

  if (data.direction === "EXPENSE") {
    if (!prepared.articleId) throw Error("Выберите статью расхода");
    const [cash, org] = await Promise.all([
      readCashBalance(tx, prepared.account.id),
      readOrgBalance(tx, "1.000000", new Prisma.Decimal(prepared.bynAmount).negated().toFixed(2)),
    ]);
    if (cash.lt(prepared.amount)) throw Error("Недостаточно средств в выбранной кассе");
    if (org.lt(0)) throw Error("Недостаточно средств на балансе организации");
  }

  const payment = await tx.payment.create({ data: {
    projectId: prepared.project?.id ?? null, direction: data.direction,
    amount: prepared.amount, currency: data.currency, rate: prepared.rate, rateDate: prepared.rateDate,
    bynAmount: prepared.bynAmount, projectAmount: prepared.project ? prepared.bynAmount : null,
    cashAccountId: prepared.account.id, expenseArticleId: prepared.articleId,
    paidAt: prepared.paidAt, comment: data.comment?.trim() || null, createdById: actor.id,
    ...(data.reportDocumentId ? { reportDocumentId: data.reportDocumentId } : {}),
  } });
  await tx.changeLog.create({ data: {
    actorType: "user", actorId: actor.id, actorName: actor.name || undefined, entity: "payment", entityId: payment.id,
    action: "create", source: actor.source, newValue: {
      project: prepared.project?.number ?? null, direction: data.direction, amount: prepared.amount,
      currency: data.currency, rate: prepared.rate, bynAmount: prepared.bynAmount,
      projectAmount: prepared.project ? prepared.bynAmount : null, cashAccount: prepared.account.name,
    },
  } });
  const event = await tx.domainEvent.create({ data: {
    type: data.direction === "INCOME" ? "payment.created" : "expense.created", actor: actor.id,
    payload: { paymentId: payment.id, projectId: prepared.project?.id ?? null, direction: data.direction,
      amount: prepared.amount, currency: data.currency, bynAmount: prepared.bynAmount },
  } });
  await recordPaymentReceipt(actor, data, payment.id, tx);
  return { payment, eventId: event.id, repeated: false as const };
}
