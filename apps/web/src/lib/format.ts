const CURRENCY_SYMBOLS: Record<string, string> = {
  BYN: "BYN", // по требованию владельца — код ISO, а не «руб.»
  RUB: "₽",
  USD: "$",
  EUR: "€",
};

// Форматирование суммы с символом валюты (BYN по умолчанию)
export function formatAmount(
  amount: string | number | null | undefined,
  currency: string,
): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const value = Number(amount);
  if (Number.isNaN(value)) return "—";
  return `${new Intl.NumberFormat("ru-RU").format(value)} ${CURRENCY_SYMBOLS[currency] ?? currency}`;
}

// Форматирование количества на складе (до 3 знаков, без хвостовых нулей)
export function formatQty(quantity: string | number | null | undefined): string {
  if (quantity === null || quantity === undefined || quantity === "") return "—";
  const value = Number(quantity);
  if (Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(value);
}
