import type { Prisma } from "@prisma/client";
export const stockPurchaseSelect = {
  id: true, movementId: true, unitPrice: true,
  movement: { select: { quantity: true, totalByn: true, material: { select: { name: true, measurementUnit: { select: { name: true } } } } } },
} satisfies Prisma.StockPurchaseSelect;
export type StockPurchaseRecord = Prisma.StockPurchaseGetPayload<{ select: typeof stockPurchaseSelect }>;
export type StockPurchaseView = { id: string; movementId: string; unitPrice: number; quantity: string; materialName: string; unit: string; stockValueByn: number | null };
export function stockPurchaseView(row?: StockPurchaseRecord | null): StockPurchaseView | null {
  return row ? { id: row.id, movementId: row.movementId, unitPrice: row.unitPrice.toNumber(), quantity: row.movement.quantity.toString(),
    materialName: row.movement.material.name, unit: row.movement.material.measurementUnit.name, stockValueByn: row.movement.totalByn?.toNumber() ?? null } : null;
}
