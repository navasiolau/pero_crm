import { stockMovementTypeLabels } from "./labels";
type MovementKind = { type: string; receiptKind?: "INVENTORY" | "PAID" | null };
export const warehouseMovementKindLabels: Record<string, string> = {
  INCOME: "Все приходы", INVENTORY: "Инвентарный приход", PAID: "Приход с оплатой",
  UNCLASSIFIED: "Приход (вид не указан)", EXPENSE: stockMovementTypeLabels.EXPENSE, RETURN: stockMovementTypeLabels.RETURN,
};
function movementKind(row: MovementKind) { return row.type === "INCOME" ? row.receiptKind ?? "UNCLASSIFIED" : row.type; }
export function warehouseMovementLabel(row: MovementKind) { return warehouseMovementKindLabels[movementKind(row)] ?? row.type; }
export function matchesWarehouseMovementKind(row: MovementKind, filter: string) {
  return filter === "ALL" || (filter === "INCOME" ? row.type === "INCOME" : movementKind(row) === filter);
}
