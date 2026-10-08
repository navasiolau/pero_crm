import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { requireActorRoles, type DomainActor } from "@/server/actor";
import { FINANCE_ROLES } from "@/lib/roles";
import { stockPurchaseAmount } from "@/lib/warehouse-cost";
import { preparePayment } from "@/server/payments/prepare";
import { createPaymentInTransaction, type PreparedPayment } from "@/server/payments/transaction";
import type { PaymentData } from "@/server/payments/contracts";
import { warehouseMove } from "./accounting";
import { stockPurchaseSchema, type StockPurchaseData } from "./contracts";

const receiptInclude = { movement: true, payment: true } as const;
export function stockPurchaseFingerprint(actorId: string, data: StockPurchaseData) {
  return createHash("sha256").update(JSON.stringify({ actorId, materialId: data.materialId, quantity: data.quantity,
    unitPrice: data.unitPrice, currency: data.currency, cashAccountId: data.cashAccountId, expenseArticleId: data.expenseArticleId,
    rate: data.rate ?? null, rateDate: data.rateDate ?? null, paidAt: data.paidAt ?? null, comment: data.comment?.trim() || null,
    // Без файла сохраняем прежний fingerprint для повторов уже проведённых закупок.
    ...(data.reportDocumentId ? { reportDocumentId: data.reportDocumentId } : {}) })).digest("hex");
}
export async function readStockPurchaseReceipt(actor: DomainActor, data: StockPurchaseData, db: Pick<Prisma.TransactionClient, "stockPurchase">) {
  const receipt = await db.stockPurchase.findUnique({ where: { clientMutationId: data.clientMutationId }, include: receiptInclude });
  if (!receipt) return null;
  if (receipt.actorId !== actor.id || receipt.requestFingerprint !== stockPurchaseFingerprint(actor.id, data))
    throw Error("Идентификатор закупки уже использован с другими данными");
  if (receipt.movement.deletionId || receipt.payment.deletionId) throw Error("Приход удалён — повторное проведение запрещено");
  return receipt;
}
function paymentData(data: StockPurchaseData): PaymentData {
  return { direction: "EXPENSE", projectId: null, amount: Number(stockPurchaseAmount(data.quantity, data.unitPrice)), currency: data.currency,
    cashAccountId: data.cashAccountId, expenseArticleId: data.expenseArticleId, rate: data.rate, rateDate: data.rateDate,
    paidAt: data.paidAt, comment: data.comment, ...(data.reportDocumentId ? { reportDocumentId: data.reportDocumentId } : {}) };
}
export async function prepareStockPurchase(actor: DomainActor, input: StockPurchaseData,
  db: Pick<PrismaClient, "project" | "cashAccount" | "expenseArticle" | "material">,
  getRate?: Parameters<typeof preparePayment>[2]) {
  requireActorRoles(actor, FINANCE_ROLES);
  const data = stockPurchaseSchema.parse(input);
  const material = await db.material.findUnique({ where: { id: data.materialId }, select: { id: true, name: true, measurementUnit: { select: { name: true } }, active: true } });
  if (!material?.active) throw Error("Материал не найден");
  const prepared = await preparePayment(paymentData(data), db, getRate);
  if (prepared.bynAmount <= 0) throw Error("Стоимость закупки в BYN должна быть больше нуля");
  return { material, prepared };
}
/** Called under the common money lock; warehouseMove takes its own stock locks. */
export async function createStockPurchaseInTransaction(actor: DomainActor, input: StockPurchaseData,
  prepared: PreparedPayment, tx: Prisma.TransactionClient) {
  requireActorRoles(actor, FINANCE_ROLES);
  const data = stockPurchaseSchema.parse(input);
  const previous = await readStockPurchaseReceipt(actor, data, tx);
  if (previous) return { receipt: previous, repeated: true, eventIds: [] as string[] };
  const monetaryInput = { ...paymentData(data), clientMutationId: randomUUID() };
  if (prepared.project || !new Prisma.Decimal(monetaryInput.amount).eq(prepared.amount) || prepared.bynAmount <= 0)
    throw Error("Денежный снимок закупки изменился");
  const stock = await warehouseMove(tx, actor, { kind: "INCOME", clientMutationId: randomUUID(),
    materialId: data.materialId, quantity: data.quantity, comment: data.comment },
    { bynAmount: new Prisma.Decimal(prepared.bynAmount).toFixed(2) });
  const money = await createPaymentInTransaction(actor, monetaryInput, prepared, tx, { movementId: stock.movement.id });
  const receipt = await tx.stockPurchase.create({ data: { clientMutationId: data.clientMutationId,
    requestFingerprint: stockPurchaseFingerprint(actor.id, data), actorId: actor.id, unitPrice: data.unitPrice,
    movementId: stock.movement.id, paymentId: money.payment.id }, include: receiptInclude });
  return { receipt, repeated: false, eventIds: [stock.eventId, money.eventId].filter((id): id is string => Boolean(id)) };
}
