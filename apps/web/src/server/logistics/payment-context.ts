import { Prisma } from "@prisma/client";
import type { DomainActor } from "@/server/actor";
import type { PaymentDetails } from "@/server/payments/contracts";
import type { PreparedPayment } from "@/server/payments/transaction";
import { requireLogisticsActor } from "./core";

/** Только сохранённая доля текущего проведения. Публичный PaymentInput не содержит этот контекст. */
export async function assertLogisticsPaymentContext(actor: DomainActor, data: PaymentDetails & {clientMutationId?: string}, prepared: PreparedPayment,
  tx: Prisma.TransactionClient, allocationId: string) {
  await requireLogisticsActor(actor.id, tx);
  const allocation = await tx.logisticsPostingAllocation.findUnique({ where: { id: allocationId }, include: {
    payment: { select: { id: true } },
    posting: { include: { documents: { include: { document: { select: { tripId: true, state: true, stage: true } } } } } },
  } });
  const posting = allocation?.posting;
  if (!allocation || !posting || posting.status !== "ACTIVE" || posting.actorId !== actor.id || allocation.payment ||
      data.direction !== "EXPENSE" || data.reportDocumentId || data.clientMutationId || !prepared.project ||
      allocation.projectId !== prepared.project.id || allocation.amount.lte(0) ||
      !allocation.amount.eq(prepared.amount) || !allocation.bynAmount.eq(prepared.bynAmount) ||
      posting.currency !== data.currency || posting.cashAccountId !== prepared.account.id ||
      posting.expenseArticleId !== prepared.articleId || !posting.rate.eq(prepared.rate) ||
      posting.rateDate?.getTime() !== prepared.rateDate?.getTime() || posting.paidAt.getTime() !== prepared.paidAt.getTime() ||
      !posting.documents.length || posting.documents.some(row => row.document.tripId !== posting.tripId ||
        row.document.state !== "READY" || !["ISSUED", "SIGNED"].includes(row.document.stage)))
    throw Error("Нет подтверждённой доли рейса с сохранённой ТТН для расхода");
  return allocation.id;
}
