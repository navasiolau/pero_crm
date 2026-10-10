import { Prisma } from "@prisma/client";

export function allocateLogisticsMoney(total: string, shares: readonly { projectId: string; percentBps: number }[], savedRate: string) {
  if (!shares.length || shares.some(row => !Number.isInteger(row.percentBps) || row.percentBps < 1 || row.percentBps > 10000) ||
      shares.reduce((sum, row) => sum + row.percentBps, 0) !== 10000) throw Error("Доли проектов должны давать 100%");
  if (new Set(shares.map(row => row.projectId)).size !== shares.length) throw Error("Проект не должен повторяться");
  const amount = new Prisma.Decimal(total), rate = new Prisma.Decimal(savedRate);
  if (!amount.isFinite() || amount.lte(0) || !amount.eq(amount.toDecimalPlaces(2)) || amount.gt("9999999999.99"))
    throw Error("Проверьте общую стоимость рейса");
  if (!rate.isFinite() || rate.lte(0) || rate.gt("99999999.999999") || !rate.eq(rate.toDecimalPlaces(6))) throw Error("Проверьте сохранённый курс");
  const cents = BigInt(amount.toFixed(2).replace(".", ""));
  const ranked = shares.map(share => {
    const numerator = cents * BigInt(share.percentBps);
    return { ...share, cents: numerator / 10000n, remainder: numerator % 10000n };
  }).sort((a, b) => a.remainder === b.remainder ? compareProject(a, b) : a.remainder > b.remainder ? -1 : 1);
  const rest = Number(cents - ranked.reduce((sum, row) => sum + row.cents, 0n));
  for (let index = 0; index < rest; index++) ranked[index].cents++;
  const allocations = ranked.sort(compareProject).map(({ projectId, percentBps, cents }) => {
    const part = new Prisma.Decimal(cents.toString()).div(100);
    return { projectId, percentBps, amount: part.toFixed(2), bynAmount: part.times(rate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2) };
  });
  const bynAmount = allocations.reduce((sum, row) => sum.plus(row.bynAmount), new Prisma.Decimal(0));
  if (bynAmount.gt("9999999999.99")) throw Error("Стоимость рейса в BYN превышает допустимую сумму");
  return { amount: amount.toFixed(2), rate: rate.toFixed(6), bynAmount: bynAmount.toFixed(2), allocations };
}

function compareProject(a: { projectId: string }, b: { projectId: string }) {
  return a.projectId < b.projectId ? -1 : a.projectId > b.projectId ? 1 : 0;
}
