import type { Prisma } from "@prisma/client";
import type { StockPurchaseRecord } from "./stock-purchase-view";

export const expenseReceiptSelect = {
  where: { cancelledAt: null }, take: 1,
  select: { id: true, lines: { orderBy: { position: "asc" }, select: {
    movementId: true, amount: true, unitPrice: true, movement: { select: { materialId: true, quantity: true, totalByn: true,
      material: { select: { name: true, measurementUnit: { select: { name: true } } } },
    } },
  } } },
} satisfies Prisma.Payment$expenseReceiptsArgs;

type ReceiptRecord = Prisma.ExpenseReceiptGetPayload<{ select: typeof expenseReceiptSelect.select }>;

export function expenseReceiptLinesView(
  receipt: ReceiptRecord | undefined, purchase: StockPurchaseRecord | null, paymentAmount: Prisma.Decimal,
) {
  const rows = receipt ? receipt.lines : purchase ? [{ ...purchase, amount: paymentAmount }] : [];
  return rows.map(row => ({
    movementId: row.movementId, materialId: row.movement.materialId, materialName: row.movement.material.name,
    unit: row.movement.material.measurementUnit.name, quantity: row.movement.quantity.toString(),
    amount: row.amount.toFixed(2), unitPrice: row.unitPrice.toString(), stockValueByn: row.movement.totalByn?.toFixed(2) ?? null,
  }));
}
