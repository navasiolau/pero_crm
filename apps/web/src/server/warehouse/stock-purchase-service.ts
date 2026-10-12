import { revalidatePath } from "next/cache";
import { uuid } from "zod";
import { prisma } from "@/lib/prisma";
import { FINANCE_ROLES } from "@/lib/roles";
import { formatAmount } from "@/lib/format";
import { requireActorRoles, type DomainActor } from "@/server/actor";
import { withTaskTransaction } from "@/server/tasks/transaction";
import { confirmMutation } from "@/server/operations/confirmation";
import { deliverPostCommit } from "@/server/operations/post-commit";
import { dispatchEvent } from "@/server/plugins/events";
import { notifyOrg } from "@/server/notifications/notify";
import { revalidateWarehouse } from "./revalidate";
import { stockPurchaseSchema } from "./contracts";
import { readStockPurchaseReceipt, prepareStockPurchase, createStockPurchaseInTransaction, StockPurchaseReceiptError } from "./stock-purchase-core";
import type { PreparedPayment } from "@/server/payments/transaction";

export async function quoteStockPurchaseCore(actor: DomainActor, input: unknown) {
  requireActorRoles(actor, FINANCE_ROLES);
  const parsed = stockPurchaseSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  try {
    const { prepared, material } = await prepareStockPurchase(actor, parsed.data, prisma);
    return { ok: true as const, quote: { materialName: material.name, unit: material.measurementUnit.name, quantity: parsed.data.quantity,
      unitPrice: parsed.data.unitPrice, currency: parsed.data.currency, amount: prepared.amount, bynAmount: prepared.bynAmount,
      rate: prepared.rate, rateDate: prepared.rateDate?.toISOString().slice(0,10) ?? null } };
  } catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : "Не удалось рассчитать закупку" }; }
}
export async function createStockPurchaseCore(actor: DomainActor, input: unknown) {
  requireActorRoles(actor, FINANCE_ROLES);
  const parsed = stockPurchaseSchema.safeParse(input);
  if (!parsed.success) {
    const recognizedId = uuid().safeParse(input && typeof input === "object" && "clientMutationId" in input ? input.clientMutationId : undefined);
    return {ok: false as const, outcome: "ROLLED_BACK" as const, kind: "invalid-request" as const,
      clientMutationId: recognizedId.success ? recognizedId.data.toLowerCase() : undefined, error: parsed.error.issues[0]?.message ?? "Ошибка данных"};
  }
  const data = parsed.data;
  const rejected = (error: unknown) => ({ok: false as const, outcome: "ROLLED_BACK" as const, clientMutationId: data.clientMutationId,
    ...(error instanceof StockPurchaseReceiptError ? {kind: "conflict" as const} : {}), error: error instanceof Error ? error.message : "Не удалось провести приход"});
  const uncertain = () => ({ok: false as const, outcome: "UNKNOWN" as const, retrySafe: true, clientMutationId: data.clientMutationId,
    error: "Не удалось подтвердить закупку. Повторите прежний запрос с сохранённым идентификатором."});
  try {
    const previous = await readStockPurchaseReceipt(actor, data, prisma);
    if (previous) return {ok: true as const, outcome: "COMMITTED" as const, resultId: previous.id, receiptId: previous.id,
      clientMutationId: data.clientMutationId, repeated: true};
  } catch (error) {return error instanceof StockPurchaseReceiptError ? rejected(error) : uncertain();}
  let prepared: PreparedPayment;
  try {({prepared} = await prepareStockPurchase(actor, data, prisma));}
  catch (error) {return rejected(error);}
  const outcome = await confirmMutation(withTaskTransaction, tx => createStockPurchaseInTransaction(actor, data, prepared, tx), async (tx, candidate) => {
    let receipt;
    try {receipt = await readStockPurchaseReceipt(actor, data, tx);}
    catch (error) {if (candidate === undefined && error instanceof StockPurchaseReceiptError) return null; throw error;}
    if (!receipt) return null;
    return candidate === undefined ? {receipt, repeated: true, eventIds: []} : receipt.id === candidate.receipt.id ? candidate : null;
  });
  if (outcome.outcome === "UNKNOWN") return uncertain();
  if (outcome.outcome === "ROLLED_BACK") return rejected(outcome.error);
  const result = outcome.value;
  const ack = {ok: true as const, outcome: "COMMITTED" as const, resultId: result.receipt.id, receiptId: result.receipt.id,
    clientMutationId: data.clientMutationId, repeated: result.repeated};
  if (result.repeated) return ack;
  const effects: Parameters<typeof deliverPostCommit>[2] = result.eventIds.map(eventId => ({kind: "dispatch", run: () => dispatchEvent(eventId)}));
  effects.push({kind: "org", run: () => notifyOrg({type: "expense.added", title: `Приход на склад · ${formatAmount(result.receipt.payment.amount.toNumber(), data.currency)}`,
    body: data.comment?.trim() || undefined, link: "/finance/expenses", exceptUserId: actor.id})}, {kind: "cache", run: () => revalidateWarehouse()});
  for (const path of ["/finance/expenses", "/finance/accounts", "/finance/payroll"]) effects.push({kind: "cache", run: () => revalidatePath(path)});
  await deliverPostCommit("stock-purchase", result.receipt.id, effects);
  return ack;
}
