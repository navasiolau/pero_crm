"use server";
import { requireFinance } from "@/server/require-role";
import { uuid } from "zod";
import { createStockPurchaseCore } from "./stock-purchase-service";
import { stockPurchaseSchema, type StockPurchaseInput } from "./contracts";
export async function addPaidStockReceipt(input: StockPurchaseInput, expectedActorId: string) {
  const session = await requireFinance();
  const parsed = stockPurchaseSchema.safeParse(input);
  if (!parsed.success) {
    const recognizedId = uuid().safeParse(input?.clientMutationId);
    return {ok: false as const, outcome: "ROLLED_BACK" as const, kind: "invalid-request" as const,
      clientMutationId: recognizedId.success ? recognizedId.data.toLowerCase() : undefined, error: parsed.error.issues[0]?.message ?? "Ошибка данных"};
  }
  const data = parsed.data;
  if (!expectedActorId || expectedActorId !== session.user.id) return {ok: false as const, outcome: "ROLLED_BACK" as const,
    kind: "actor-changed" as const, clientMutationId: data.clientMutationId, error: "Учётная запись изменилась — обновите страницу"};
  return createStockPurchaseCore({ id: session.user.id, name: session.user.name ?? "", roles: session.user.roles, source: "web" }, data);
}
