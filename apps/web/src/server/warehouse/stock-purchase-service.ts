import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { FINANCE_ROLES } from "@/lib/roles";
import { formatAmount } from "@/lib/format";
import { requireActorRoles, type DomainActor } from "@/server/actor";
import { withTaskTransaction } from "@/server/tasks/transaction";
import { dispatchEvent } from "@/server/plugins/events";
import { notifyOrg } from "@/server/notifications/notify";
import { revalidateWarehouse } from "./revalidate";
import { stockPurchaseSchema } from "./contracts";
import { readStockPurchaseReceipt, prepareStockPurchase, createStockPurchaseInTransaction } from "./stock-purchase-core";

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
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  const data = parsed.data;
  let result;
  try {
    const previous = await readStockPurchaseReceipt(actor, data, prisma);
    if (previous) return { ok: true as const, receiptId: previous.id, repeated: true };
    const { prepared } = await prepareStockPurchase(actor, data, prisma);
    result = await withTaskTransaction(tx => createStockPurchaseInTransaction(actor, data, prepared, tx));
  } catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : "Не удалось провести приход" }; }
  if (!result.repeated) {
    for (const eventId of result.eventIds) await dispatchEvent(eventId).catch(() => {});
    await notifyOrg({ type: "expense.added", title: `Приход на склад · ${formatAmount(result.receipt.payment.amount.toNumber(), data.currency)}`,
      body: data.comment?.trim() || undefined, link: "/finance/expenses", exceptUserId: actor.id }).catch(() => {});
  }
  await revalidateWarehouse();
  for (const path of ["/finance/expenses","/finance/accounts","/finance/payroll"]) revalidatePath(path);
  return { ok: true as const, receiptId: result.receipt.id, repeated: result.repeated };
}
