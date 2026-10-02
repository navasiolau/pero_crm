import { Prisma } from "@prisma/client";

/** The durable marker, never a NULL historical price alone, permits capture. */
export function initialPriceCapture(
  product: { initialPriceCaptureEligible?: boolean; initialPrice: unknown },
  explicitPrice: string | number | null | undefined,
): { initialPrice: Prisma.Decimal; initialPriceCaptureEligible: false } | Record<string, never> {
  if (!product.initialPriceCaptureEligible || product.initialPrice !== null || explicitPrice === null || explicitPrice === undefined) return {};
  return { initialPrice: new Prisma.Decimal(String(explicitPrice)).toDecimalPlaces(2), initialPriceCaptureEligible: false };
}

export function newProductInitialPrice(price: number | undefined) {
  return price === undefined
    ? { initialPrice: null, initialPriceCaptureEligible: true }
    : { initialPrice: new Prisma.Decimal(String(price)).toDecimalPlaces(2), initialPriceCaptureEligible: false };
}
