"use server";
import { requireFinance } from "@/server/require-role";
import { createStockPurchaseCore } from "./stock-purchase-service";
import type { StockPurchaseInput } from "./contracts";
export async function addPaidStockReceipt(input: StockPurchaseInput) {
  const session = await requireFinance();
  return createStockPurchaseCore({ id: session.user.id, name: session.user.name ?? "", roles: session.user.roles, source: "web" }, input);
}
