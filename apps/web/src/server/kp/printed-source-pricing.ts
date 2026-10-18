type SourceObject = Record<string, unknown>;
const object = (value: unknown): SourceObject => value !== null && typeof value === "object" && !Array.isArray(value) ? value as SourceObject : {};
function number(value: unknown): number {
  if (typeof value !== "number" && typeof value !== "string" && typeof value !== "boolean" && value !== null && value !== undefined) throw Error("Некорректная сумма КП");
  if (typeof value === "number" && !Number.isFinite(value)) throw Error("Некорректная сумма КП");
  const result = typeof value === "string" ? Number.parseFloat(value.replace(",", ".")) : Number(value);
  return Number.isFinite(result) ? result : 0;
}
const amountMinor = (value: unknown) => Math.round((number(value) + Number.EPSILON) * 100);
function safeMinor(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw Error("Сумма КП превышает допустимый предел точности исходного генератора");
  return value;
}

/** Читаем эффективные печатные суммы, сохраняя normalizeState/totalsOf исходного SheetRender.
 * Здесь намеренно сохранён его Math.round/EPSILON: например, 100.75 минус 10% даёт 90.68.
 * Результат — целые копейки. Дальнейшее распределение, FX и запись CRM используют Decimal.
 */
export function readPrintedProposalMoney(state: SourceObject, sourceItems: readonly SourceObject[]) {
  const items = sourceItems.map(item => {
    const rawQty = typeof item.qty === "number" || typeof item.qty === "string" || typeof item.qty === "boolean" ? Number(item.qty) : 1;
    const quantity = Math.max(1, Math.round(rawQty) || 1);
    if (!Number.isInteger(quantity) || quantity > 2_147_483_647) throw Error("Количество изделий превышает допустимый предел");
    const priceMinor = safeMinor(Math.max(amountMinor(item.price), 0));
    return { source: item, quantity, priceMinor };
  });
  const delivery = object(state.delivery);
  const visible = delivery.visible !== false;
  const itemMode = delivery.mode === "items";
  const rows = (Array.isArray(delivery.items) ? delivery.items : [])
    .filter(row => row !== null && typeof row === "object")
    .map(row => ({ source: object(row), priceMinor: safeMinor(Math.max(amountMinor(object(row).price), 0)) }));
  const deliveryTotalMinor = safeMinor(Math.max(amountMinor(delivery.total), 0));
  const subtotalMinor = safeMinor(items.reduce((sum, item) => sum + amountMinor(item.priceMinor / 100) * item.quantity, 0));
  const serviceMinor = visible ? itemMode ? safeMinor(rows.reduce((sum, row) => sum + amountMinor(row.priceMinor / 100), 0)) : deliveryTotalMinor : 0;
  const sub = subtotalMinor / 100;
  const del = serviceMinor / 100;
  const base = sub + del;
  const val = Math.max(number(state.discount), 0);
  let disc = state.discountMode === "amount" ? Math.min(val, base) : base * Math.min(val, 100) / 100;
  disc = Math.round((disc + Number.EPSILON) * 100) / 100;
  const total = Math.round((base - disc + Number.EPSILON) * 100) / 100;
  return { items, visible, itemMode, rows, subtotalMinor, serviceMinor,
    baseMinor: safeMinor(amountMinor(base)), discountMinor: safeMinor(amountMinor(disc)), totalMinor: safeMinor(amountMinor(total)) };
}
