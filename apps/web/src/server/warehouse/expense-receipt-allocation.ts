import { decimalAtoms, decimalText } from "@/lib/product-quantity";
import { priceInput, quantityInput } from "@/lib/warehouse-cost";

export function allocateExpenseReceipt<T extends { quantity: string; amount: string }>(
  rows: readonly T[], paymentAmount: string, paymentByn: string,
) {
  const total = decimalAtoms(priceInput(paymentAmount), 2, 12);
  const byn = decimalAtoms(priceInput(paymentByn), 2, 12);
  const amounts = rows.map(row => decimalAtoms(priceInput(row.amount), 2, 12));
  if (amounts.reduce((sum, amount) => sum + amount, BigInt(0)) !== total) {
    throw Error("Сумма строк должна совпадать с суммой расхода");
  }
  const quotas = amounts.map((amount, index) => ({
    index, allocation: amount * byn / total, remainder: amount * byn % total,
  }));
  const missing = byn - quotas.reduce((sum, row) => sum + row.allocation, BigInt(0));
  const ranked = [...quotas].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  for (const row of ranked.slice(0, Number(missing))) row.allocation++;
  return rows.map((row, index) => {
    const applied = quotas[index].allocation;
    if (!applied) throw Error(`Стоимость строки ${index + 1} после распределения меньше 0,01 BYN`);
    return { ...row, quantity: quantityInput(row.quantity), amount: decimalText(amounts[index], 2), bynAmount: decimalText(applied, 2) };
  });
}
