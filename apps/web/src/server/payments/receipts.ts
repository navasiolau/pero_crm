import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { DomainActor } from "@/server/actor";
import type { PaymentData } from "./contracts";

export const paymentReceiptId = (id: string) => `payment-request:${id}`;
export function paymentFingerprint(actorId: string, data: PaymentData) {
  return createHash("sha256").update(JSON.stringify({ actorId, projectId: data.projectId ?? null,
    direction: data.direction, amount: new Prisma.Decimal(data.amount).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2),
    currency: data.currency, cashAccountId: data.cashAccountId, expenseArticleId: data.expenseArticleId || null,
    rate: data.rate ?? null, rateDate: data.rateDate ?? null, paidAt: data.paidAt ?? null,
    comment: data.comment?.trim() || null, reportDocumentId: data.reportDocumentId ?? null })).digest("hex");
}

export async function readPaymentReceipt(actor: DomainActor, data: PaymentData,
  db: Pick<Prisma.TransactionClient, "changeLog" | "payment">) {
  if (!data.clientMutationId) return null;
  const receipt = await db.changeLog.findUnique({ where: { id: paymentReceiptId(data.clientMutationId) } });
  if (!receipt) return null;
  const value = receipt.newValue;
  if (receipt.actorId !== actor.id || receipt.entity !== "payment" || receipt.action !== "request" ||
      !value || typeof value !== "object" || Array.isArray(value) || value.fingerprint !== paymentFingerprint(actor.id, data))
    throw Error("Идентификатор платежа уже использован с другими данными");
  const payment = await db.payment.findUnique({ where: { id: receipt.entityId } });
  if (!payment) throw Error("Операция удалена — повторное проведение запрещено");
  return payment;
}

export async function recordPaymentReceipt(actor: DomainActor, data: PaymentData, paymentId: string, tx: Prisma.TransactionClient) {
  if (!data.clientMutationId) return;
  await tx.changeLog.create({ data: { id: paymentReceiptId(data.clientMutationId), actorType: "user", actorId: actor.id,
    actorName: actor.name || undefined, source: actor.source, entity: "payment", entityId: paymentId, action: "request",
    newValue: { fingerprint: paymentFingerprint(actor.id, data) } } });
}
