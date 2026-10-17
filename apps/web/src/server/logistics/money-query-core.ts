import { Prisma } from "@prisma/client";
import { BYN_UNAVAILABLE_REASON, sumByn, subtractByn } from "@/lib/history-byn";
import { activePaymentWhere } from "@/server/payments/active-records";
import { readCashBalance } from "@/server/payroll/cash-core";
import { requireLogisticsActor } from "./core";
import { listActiveCashAccountOptions } from "@/server/finance/default-cash-core";
import { type LogisticsMoneyOptions, type LogisticsPostingView, type LogisticsProjectBudget } from "./money-contracts";

const postingReadInclude = { allocations: { include: { payment: { select: { id: true } } }, orderBy: { projectId: "asc" } },
  documents: { orderBy: { documentId: "asc" } } } satisfies Prisma.LogisticsPostingInclude;
type PostingRecord = Prisma.LogisticsPostingGetPayload<{ include: typeof postingReadInclude }>;
function postingView(row: PostingRecord): LogisticsPostingView {
  return { id: row.id, tripId: row.tripId, tripRevision: row.tripRevision, status: row.status,
    amount: row.amount.toFixed(2), currency: row.currency, cashAccountId: row.cashAccountId,
    cashAccountName: row.cashAccountNameSnapshot,
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
  await requireLogisticsActor(actorId, tx);
  const accounts = await listActiveCashAccountOptions(tx);
  const cashAccounts = await Promise.all(accounts.map(async account => ({ ...account, balance: (await readCashBalance(tx, account.id)).toNumber() })));
  return { cashAccounts };
}
export async function getLogisticsProjectBudgetCore(actorId: string | null | undefined, projectId: string,
  tx: Prisma.TransactionClient): Promise<LogisticsProjectBudget> {
  await requireLogisticsActor(actorId, tx);
  const project = await tx.project.findUnique({ where: { id: projectId }, select: { currency: true, delivery: true } });
  if (!project) throw Error("Проект не найден");
  const payments = await tx.payment.findMany({ where: { AND: [activePaymentWhere, { projectId, direction: "EXPENSE", logisticsAllocationId: { not: null } }] },
    select: { bynAmount: true } });
  const spent = sumByn(payments.map(row => row.bynAmount?.toNumber() ?? null));
  const deliveryBudget = project.currency === "BYN" ? project.delivery?.toNumber() ?? null : null;
  const unavailableReason = project.currency !== "BYN" || spent === null ? BYN_UNAVAILABLE_REASON : null;
  return { currency: "BYN", deliveryBudget, tripSpent: spent, spent, remaining: subtractByn(deliveryBudget, spent), unavailableReason };
}
