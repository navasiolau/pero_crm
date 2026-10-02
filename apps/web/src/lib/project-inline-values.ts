import { decimalAtoms, decimalText } from "./product-quantity";
export const PROJECT_SERVICE_FIELDS = ["delivery", "unloading", "installation"] as const;
export function parseProjectInlineValue(field: string, raw: string): string | null {
  const text = raw.trim();
  if ((PROJECT_SERVICE_FIELDS as readonly string[]).includes(field)) {
    if (!text) return null;
    const normalized = text.replace(",", ".");
    if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(normalized)) throw Error("Введите неотрицательную сумму с точностью до копеек");
    return decimalText(decimalAtoms(normalized, 2, 12), 2);
  }
  if (["title", "clientId", "client.phone"].includes(field)) {
    if (!text) throw Error(field === "client.phone" ? "Укажите телефон клиента" : "Заполните обязательное поле");
    return text;
  }
  return text || null;
}
export function confirmedProjectTotal(subtotal: string | null, services: readonly (string | null)[]): string | null {
  if (subtotal === null) return null;
  return decimalText(services.reduce((sum, value) => sum + decimalAtoms(value ?? "0", 2, 12), decimalAtoms(subtotal, 2, 18)), 2);
}
export function projectSubtotalFromProjection(total: string | null, services: readonly (string | null)[]): string | null {
  if (total === null) return null;
  const atoms = services.reduce((sum, value) => sum - decimalAtoms(value ?? "0", 2, 12), decimalAtoms(total, 2, 18));
  if (atoms < BigInt(0)) throw Error("Некорректный снимок суммы проекта");
  return decimalText(atoms, 2);
}
