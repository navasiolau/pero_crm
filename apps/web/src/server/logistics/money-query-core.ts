import { Prisma } from "@prisma/client";
import { ADMIN_ROLES, hasAnyRole } from "@/lib/roles";
import { BYN_UNAVAILABLE_REASON, sumByn, subtractByn } from "@/lib/history-byn";
import { activePaymentWhere } from "@/server/payments/active-records";
import { readCashBalance } from "@/server/payroll/cash-core";
import { requireLogisticsActor } from "./core";
import { LOGISTICS_ARTICLE_SETTING, type LogisticsMoneyOptions, type LogisticsPostingView, type LogisticsProjectBudget } from "./money-contracts";

const postingReadInclude = { allocations: { include: { payment: { select: { id: true } } }, orderBy: { projectId: "asc" } },
  documents: { orderBy: { documentId: "asc" } } } satisfies Prisma.LogisticsPostingInclude;
type PostingRecord = Prisma.LogisticsPostingGetPayload<{ include: typeof postingReadInclude }>;
function postingView(row: PostingRecord): LogisticsPostingView {
  return { id: row.id, tripId: row.tripId, tripRevision: row.tripRevision, status: row.status,
    amount: row.amount.toFixed(2), currency: row.currency, cashAccountId: row.cashAccountId,
    cashAccountName: row.cashAccountNameSnapshot, expenseArticleId: row.expenseArticleId,
    rate: row.rate.toFixed(6), rateDate: row.rateDate?.toISOString().slice(0, 10) ?? null, bynAmount: row.bynAmount.toFixed(2),
    paidAt: row.paidAt.toISOString().slice(0, 10), createdAt: row.createdAt.toISOString(), createdByName: row.actorNameSnapshot,
    allocations: row.allocations.map(allocation => ({ id: allocation.id, projectId: allocation.projectId,
      projectNumber: allocation.projectNumberSnapshot, percentBps: allocation.percentBps, amount: allocation.amount.toFixed(2),
      bynAmount: allocation.bynAmount.toFixed(2), paymentId: allocation.payment?.id ?? null })),
    documentIds: row.documents.map(document => document.documentId) };
}
export async function getLogisticsTripMoneyCore(actorId: string | null | undefined, tripId: string, tx: Prisma.TransactionClient):
  Promise<{ current: LogisticsPostingView | null; history: LogisticsPostingView[] }> {
  await requireLogisticsActor(actorId, tx);
  const records = await tx.logisticsPosting.findMany({ where: { tripId }, include: postingReadInclude, orderBy: { tripRevision: "desc" } });
  return { current: records.find(row => row.status === "ACTIVE") ? postingView(records.find(row => row.status === "ACTIVE")!) : null,
    history: records.filter(row => row.status === "SUPERSEDED").map(postingView) };
}
export async function getLogisticsMoneyOptionsCore(actorId: string | null | undefined, tx: Prisma.TransactionClient): Promise<LogisticsMoneyOptions> {
  const actor = await requireLogisticsActor(actorId, tx);
  const [accounts, setting] = await Promise.all([
    tx.cashAccount.findMany({ where: { active: true }, select: { id: true, name: true, currency: true }, orderBy: { createdAt: "asc" } }),
    tx.orgSetting.findUnique({ where: { key: LOGISTICS_ARTICLE_SETTING } }),
  ]);
  const canConfigureArticle = hasAnyRole(actor.roles, ADMIN_ROLES);
  const [logisticsArticle, articleOptions] = await Promise.all([
    setting?.value ? tx.expenseArticle.findUnique({ where: { id: setting.value }, select: { id: true, name: true, active: true } }) : null,
    canConfigureArticle ? tx.expenseArticle.findMany({ select: { id: true, name: true, active: true }, orderBy: { code: "asc" } }) : [],
  ]);
  const cashAccounts = await Promise.all(accounts.map(async account => ({ ...account, balance: (await readCashBalance(tx, account.id)).toNumber() })));
  return { cashAccounts, logisticsArticle, articleOptions, canConfigureArticle };
}
export async function getLogisticsProjectBudgetCore(actorId: string | null | undefined, projectId: string,
  tx: Prisma.TransactionClient): Promise<LogisticsProjectBudget> {
  await requireLogisticsActor(actorId, tx);
  const [project, setting] = await Promise.all([
    tx.project.findUnique({ where: { id: projectId }, select: { currency: true, delivery: true } }),
    tx.orgSetting.findUnique({ where: { key: LOGISTICS_ARTICLE_SETTING } }),
  ]);
  if (!project) throw Error("Проект не найден");
  const payments = await tx.payment.findMany({ where: { AND: [activePaymentWhere, { projectId, direction: "EXPENSE" },
    { OR: [{ logisticsAllocationId: { not: null } }, ...(setting?.value ? [{ expenseArticleId: setting.value }] : [])] }] },
  select: { bynAmount: true, logisticsAllocationId: true } });
  const tripSpent = sumByn(payments.filter(row => row.logisticsAllocationId !== null).map(row => row.bynAmount?.toNumber() ?? null));
  const otherSpent = setting?.value ? sumByn(payments.filter(row => row.logisticsAllocationId === null).map(row => row.bynAmount?.toNumber() ?? null)) : null;
  const spent = sumByn([tripSpent, otherSpent]);
  const deliveryBudget = project.currency === "BYN" ? project.delivery?.toNumber() ?? null : null;
  const unavailableReason = project.currency !== "BYN" || spent === null && !!setting?.value ? BYN_UNAVAILABLE_REASON :
    !setting?.value ? "Статья «Логистика» не настроена" : null;
  return { currency: "BYN", deliveryBudget, tripSpent, otherSpent, spent, remaining: subtractByn(deliveryBudget, spent),
    unavailableReason, articleConfigured: !!setting?.value };
}
