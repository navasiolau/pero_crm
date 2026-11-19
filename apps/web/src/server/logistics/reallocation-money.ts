import { Prisma } from "@prisma/client";
import { allocateLogisticsMoney } from "./allocation";

export function reallocateLogisticsMoney(
  total: string,
  savedByn: string,
  rate: string,
  shares: Parameters<typeof allocateLogisticsMoney>[1],
) {
  const split = allocateLogisticsMoney(total, shares, rate);
  const difference = new Prisma.Decimal(savedByn).minus(split.bynAmount);
  const allocations = split.allocations.map(part => ({
    ...part,
    rounded: new Prisma.Decimal(part.bynAmount),
    adjusted: new Prisma.Decimal(part.bynAmount),
    exact: new Prisma.Decimal(part.amount).times(rate),
  }));
  let cents = difference.times(100).toNumber();
  while (cents !== 0) {
    const step = cents > 0 ? "0.01" : "-0.01";
    const candidates = allocations.filter(part => part.amount !== "0.00" && (cents > 0 || part.adjusted.gt(0)));
    candidates.sort((a, b) => {
      const order = b.exact.minus(b.adjusted).cmp(a.exact.minus(a.adjusted));
      return cents > 0 ? order : -order;
    });
    if (!candidates[0]) throw Error("Невозможно сохранить сумму рейса в BYN");
    candidates[0].adjusted = candidates[0].adjusted.plus(step);
    cents += cents > 0 ? -1 : 1;
  }
  return {
    amount: split.amount,
    bynAmount: new Prisma.Decimal(savedByn).toFixed(2),
    difference: difference.toFixed(2),
    allocations: allocations.map(({ projectId, percentBps, amount, rounded, adjusted }) => ({
      projectId, percentBps, amount, bynAmount: adjusted.toFixed(2),
      roundingAdjustment: adjusted.minus(rounded).toFixed(2),
    })),
  };
}
