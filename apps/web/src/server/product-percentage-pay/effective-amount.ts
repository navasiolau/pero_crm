import { Prisma } from "@prisma/client";

const source = { select: { compensations: { select: { amount: true } } } } as const;
export const percentageAmountInclude = {
  payrollEntry: source,
  adjustments: { orderBy: { configRevision: "desc" }, include: { payrollEntry: source } },
} satisfies Prisma.ProductPercentageCompletionShareInclude;

type MoneyValue = Prisma.Decimal | string | number;
type Source = { compensations?: readonly { amount: MoneyValue }[] } | null;
type Share = { amount?: MoneyValue | null; payrollEntry?: Source; adjustments?: readonly {
  amount: MoneyValue; delta?: MoneyValue; payrollEntry?: Source;
}[] };

export function effectivePercentageAmount(share: Share, legacyFallback?: MoneyValue | null): string | null {
  const base = share.amount ?? legacyFallback;
  const adjustments = share.adjustments ?? [];
  const compensations = [...(share.payrollEntry?.compensations ?? []),
    ...adjustments.flatMap(row => row.payrollEntry?.compensations ?? [])];
  if (!compensations.length) return (adjustments[0]?.amount ?? base)?.toString() ?? null;
  return [...adjustments.map(row => row.delta ?? 0), ...compensations.map(row => row.amount)]
    .reduce<Prisma.Decimal>((amount, delta) => amount.plus(delta), new Prisma.Decimal(base ?? 0)).toFixed(2);
}
