import type { Prisma } from "@prisma/client";
import { decimalAtoms, decimalText } from "@/lib/product-quantity";

/** Called under material/product locks when a plan is first added after issues. */
export async function readIssuedQuantity(tx: Prisma.TransactionClient, productId: string, materialId: string) {
  const rows = await tx.stockMovement.groupBy({ by: ["type"], where: { productId, materialId, type: { in: ["EXPENSE","RETURN"] } }, _sum: { quantity: true } });
  const quantity = rows.reduce((sum,row) => sum + BigInt(row.type === "RETURN" ? -1 : 1) * decimalAtoms(row._sum.quantity ?? 0,3,12),BigInt(0));
  if (quantity < BigInt(0)) throw Error("Невозможно рассчитать выданное: неполная история движения материала");
  return decimalText(quantity,3);
}
