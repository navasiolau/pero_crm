import { quantityAtoms, quantityFromAtoms } from "./work-shares";

// Keep database decimal strings as hundredths until the existing numeric action
// boundary. Never subtract/add Number values and then try to round away residue.
export function remainingWorkQuantity(quantity: string, allocated: string, own = "0"): string {
  const remaining = quantityAtoms(quantity) - quantityAtoms(allocated) + quantityAtoms(own);
  return quantityFromAtoms(remaining > BigInt(0) ? remaining : BigInt(0));
}

export function stepWorkQuantity(value: string, remaining: string, direction: 1 | -1): string {
  const current = quantityAtoms(value.trim() || "0");
  const limit = quantityAtoms(remaining);
  const next = current + BigInt(direction * 100);
  const positive = next < BigInt(1) ? BigInt(1) : next;
  return quantityFromAtoms(positive > limit ? limit : positive);
}

export function isPositiveQuantity(value: string): boolean {
  try { return quantityAtoms(value) > BigInt(0); } catch { return false; }
}

export function quantityInputError(value: string): string | null {
  if (!value.trim()) return null; // Empty means "all remaining" in existing task forms.
  try {
    return quantityAtoms(value) > BigInt(0) ? null : "Количество должно быть больше нуля";
  } catch {
    return "Укажите количество с точностью не больше двух знаков после запятой";
  }
}
