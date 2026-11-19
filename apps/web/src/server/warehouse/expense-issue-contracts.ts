import { z } from "zod";
import { decimalText } from "@/lib/product-quantity";
import { issuePosition, quantityAtoms, quantityInput, type WarehousePosition } from "@/lib/warehouse-cost";

const id = z.string().trim().min(1).max(200);
const input = z.object({
  paymentId: id, projectId: id, productId: id,
  lines: z.array(z.object({ sourceMovementId: id, quantity: z.string().trim().min(1).max(32) }).strict()).min(1).max(100),
}).strict();
export const expenseIssueInput = input.refine(value => value.lines.length === new Set(value.lines.map(line => line.sourceMovementId)).size,
  { message: "Одна строка чека может участвовать только один раз в выдаче" });
export const expenseIssueConfirmInput = input.extend({
  requestId: z.string().uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).refine(value => value.lines.length === new Set(value.lines.map(line => line.sourceMovementId)).size,
  { message: "Одна строка чека может участвовать только один раз в выдаче" });
export type ExpenseIssueInput = z.infer<typeof expenseIssueInput>;

export type ExpenseIssueSourceLine = {
  movementId: string; materialId: string; materialName: string; unit: string;
  receiptQuantity: string; issuedQuantity: string; remainingQuantity: string;
};
export type ExpenseIssueChoice = { id: string; label: string };

export function receiptLineQuantities(receiptQuantity: string, issuedQuantity: string) {
  const total = quantityAtoms(receiptQuantity), used = quantityAtoms(issuedQuantity);
  if (used > total) throw Error("Количество выдачи не согласовано с чеком");
  return { receiptQuantity: decimalText(total, 3), issuedQuantity: decimalText(used, 3),
    remainingQuantity: decimalText(total - used, 3) };
}

export function expenseIssueQuantities(lines: ExpenseIssueInput["lines"], sources: readonly ExpenseIssueSourceLine[],
  positions: ReadonlyMap<string, WarehousePosition>) {
  const byMovement = new Map(sources.map(line => [line.movementId, line]));
  const remaining = new Map(positions);
  return [...lines].sort((left, right) => left.sourceMovementId.localeCompare(right.sourceMovementId)).map(line => {
    const source = byMovement.get(line.sourceMovementId);
    if (!source) throw Error("Подтверждённая строка чека недоступна");
    const quantity = quantityInput(line.quantity);
    if (quantityAtoms(quantity) > quantityAtoms(source.remainingQuantity))
      throw Error("Недостаточно доступного количества по строке чека " + source.materialName);
    const available = remaining.get(source.materialId) ?? { quantity: "0", value: "0" };
    if (quantityAtoms(quantity) > quantityAtoms(available.quantity))
      throw Error("Недостаточно материала на складе " + source.materialName);
    const result = issuePosition(available, quantity);
    remaining.set(source.materialId, result.position);
    return { ...source, quantity, warehouseBefore: available.quantity, warehouseAfter: result.position.quantity,
      warehouseValueBefore: available.value, unitCost: result.cost, value: result.value, moneyByn: result.money };
  });
}

export type ExpenseIssueQuoteLine = ReturnType<typeof expenseIssueQuantities>[number];
