import { parsePercentageRate } from "./product-percentage-pay";

export const MAX_PRODUCT_PERCENTAGE_RATE = 15;

/** Предел новых ставок изделия; исторические ставки и доли используют общий parser. */
export function parseProductPercentageRate(value: string | null): string | null {
  const rate = parsePercentageRate(value);
  if (rate !== null && Number(rate) > MAX_PRODUCT_PERCENTAGE_RATE) throw new Error("Процент оплаты не должен превышать 15%");
  return rate;
}
