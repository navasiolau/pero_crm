import { parsePercentageRate, type ProductPercentageKind } from "./product-percentage-pay";

export type WholePercentageAmount = { amount: string; sourceFundExact: string };

/** Одна точная формула для карточки и нового начисления; без промежуточных копеек. */
export function calculateWholeProductPercentage(input: {
  kind: ProductPercentageKind;
  unitPrice: string | null;
  quantity: number | null;
  rate: string | null;
}): WholePercentageAmount | null {
  const rate = parsePercentageRate(input.rate);
  if (rate === null) return null;
  if (input.quantity === null || !Number.isSafeInteger(input.quantity) || input.quantity < 1) return null;
  const basisPoints = BigInt(rate.replace(".", ""));
  if (basisPoints === BigInt(0)) return { amount: "0.00", sourceFundExact: "0.000000" };
  if (input.unitPrice === null) return null;
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(input.unitPrice)) throw new Error("Некорректная цена изделия");
  const [whole, fraction = ""] = input.unitPrice.split(".");
  const cents = BigInt(whole + fraction.padEnd(2, "0"));
  const count = input.kind === "ENGINEERING" ? BigInt(1) : BigInt(input.quantity);
  const numerator = cents * basisPoints * count;
  const denominator = BigInt(1_000_000);
  const ceiling = (numerator + denominator - BigInt(1)) / denominator;
  if (ceiling > BigInt("9999999999")) throw new Error("Сумма процентного этапа превышает допустимую");
  return {
    amount: `${ceiling}.00`,
    sourceFundExact: `${numerator / denominator}.${String(numerator % denominator).padStart(6, "0")}`,
  };
}
