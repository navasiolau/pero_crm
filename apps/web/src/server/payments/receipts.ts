import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { DomainActor } from "@/server/actor";
import type { PaymentDetails } from "./contracts";
type ReceiptInput = PaymentDetails & {clientMutationId?: string};
export class PaymentReceiptError extends Error {
  constructor(message: string, readonly kind: "conflict" | "removed" = "conflict", readonly removedPaymentId?: string) {super(message);}
}

export const paymentReceiptId = (id: string) => `payment-request:${id}`;
export function paymentFingerprint(actorId: string, data: ReceiptInput) {
  return createHash("sha256").update(JSON.stringify({ actorId, projectId: data.projectId ?? null,
    direction: data.direction, amount: new Prisma.Decimal(data.amount).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2),
    currency: data.currency, cashAccountId: data.cashAccountId, expenseArticleId: data.expenseArticleId || null,
    rate: data.rate ?? null, rateDate: data.rateDate ?? null, paidAt: data.paidAt ?? null,
    comment: data.comment?.trim() || null, reportDocumentId: data.reportDocumentId ?? null })).digest("hex");
}

export async function readPaymentReceipt(actor: DomainActor, data: ReceiptInput,
  db: Pick<Prisma.TransactionClient, "changeLog" | "payment">) {
  if (!data.clientMutationId) return null;
  const receipt = await db.changeLog.findUnique({ where: { id: paymentReceiptId(data.clientMutationId) } });
  if (!receipt) return null;
  const value = receipt.newValue;
  if (receipt.actorType !== "user" || receipt.actorId !== actor.id || receipt.entity !== "payment" || receipt.action !== "request" ||
      !value || typeof value !== "object" || Array.isArray(value) || value.fingerprint !== paymentFingerprint(actor.id, data))
    throw new PaymentReceiptError("Идентификатор платежа уже использован с другими данными");
  const payment = await db.payment.findUnique({ where: { id: receipt.entityId } });
  if (!payment || payment.deletionId) throw new PaymentReceiptError("Операция удалена — повторное проведение запрещено", "removed", receipt.entityId);
  return payment;
}

export async function recordPaymentReceipt(actor: DomainActor, data: ReceiptInput, paymentId: string, tx: Prisma.TransactionClient) {
  if (!data.clientMutationId) return;
  await tx.changeLog.create({ data: { id: paymentReceiptId(data.clientMutationId), actorType: "user", actorId: actor.id,
    actorName: actor.name || undefined, source: actor.source, entity: "payment", entityId: paymentId, action: "request",
    newValue: { fingerprint: paymentFingerprint(actor.id, data) } } });
}
