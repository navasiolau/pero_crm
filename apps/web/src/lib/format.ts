const CURRENCY_SYMBOLS: Record<string, string> = {
  BYN: "руб.", // белорусский рубль — реальное обозначение, а не аббревиатура ISO
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
