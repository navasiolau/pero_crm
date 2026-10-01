import { projectTotal as calculateProjectTotal } from "@/lib/product-quantity";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

import { sumHistoricalByn, sumByn, subtractByn, BYN_UNAVAILABLE_REASON } from "@/lib/history-byn";

// ─── Финансы (§11): кассы, статьи расходов, экономика проекта ───────────────
// Раздел доступен администратору, директору и бухгалтеру (middleware + requireFinance).

export type CashAccountView = {
  id: string;
  name: string;
  currency: string;
  comment: string | null;
  active: boolean;
  balance: number; // приходы − расходы по кассе, в валюте кассы
};

// Кассы с балансами. Операция по кассе всегда в валюте кассы (правило
// внесения), поэтому баланс — просто сумма приходов минус расходы.
export async function listCashAccounts(): Promise<CashAccountView[]> {
  const [accounts, grouped, payouts] = await Promise.all([
    prisma.cashAccount.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.payment.groupBy({
      by: ["cashAccountId", "direction"],
      _sum: { amount: true },
    }),
    prisma.payout.groupBy({ by: ["cashAccountId"], where: { cashAccountId: { not: null } }, _sum: { cashAmount: true } }),
  ]);
  const sums = new Map<string, number>();
  for (const row of grouped) {
    if (!row.cashAccountId) continue;
    const sign = row.direction === "INCOME" ? 1 : -1;
    sums.set(
      row.cashAccountId,
      (sums.get(row.cashAccountId) ?? 0) + sign * Number(row._sum.amount ?? 0),
    );
  }
  for (const row of payouts) {
    if (!row.cashAccountId) continue;
    sums.set(row.cashAccountId, (sums.get(row.cashAccountId) ?? 0) - Number(row._sum.cashAmount ?? 0));
  }
  return accounts.map((account) => ({
    id: account.id,
    name: account.name,
    currency: account.currency,
    comment: account.comment,
    active: account.active,
    balance: Math.round((sums.get(account.id) ?? 0) * 100) / 100,
  }));
}

export type ExpenseArticleView = {
  id: string;
  name: string;
  comment: string | null;
  active: boolean;
};

export async function listExpenseArticles(): Promise<ExpenseArticleView[]> {
  const articles = await prisma.expenseArticle.findMany({
    orderBy: { createdAt: "asc" },
  });
  return articles.map((article) => ({
    id: article.id,
    name: article.name,
    comment: article.comment,
    active: article.active,
  }));
}

export type ProjectEconomics = {
  currency: string;
  unavailableReason: string | null;
  expectedPrice: number | null;
  paidTotal: number | null; // приходы, в валюте проекта
  expensesTotal: number | null; // расходы (статьи + материалы склада), в валюте проекта
  payrollTotal: number | null; // ЗП по проекту (начисления), в валюте проекта
  margin: number | null; // paidTotal − expensesTotal − payrollTotal
  marginAtFullPrice: number | null; // expectedPrice − расходы − ЗП
  expenseBreakdown: { label: string; amount: number | null }[]; // по статьям + ЗП + материалы
};

// Внутренняя экономика использует только сохранённые BYN-эквиваленты.
// Полные процентные снимки заменяют связанные начисления, а не дополняют их.
// Историческая неизвестность не пересчитывается сегодняшним курсом.
export async function getProjectEconomics(
  projectId: string,
): Promise<ProjectEconomics | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      currency: true,
      delivery: true,
      unloading: true,
      installation: true,
      products: { select: { expectedPrice: true, quantity: true } },
    },
  });
  if (!project) return null;
  const currency = "BYN";

  const [payments, payrollEntries, stockMovements, settlements, completions] = await Promise.all([
    prisma.payment.findMany({
      where: { projectId },
      select: {
        direction: true,
        bynAmount: true,
        expenseArticle: { select: { name: true } },
      },
    }),
    prisma.payrollEntry.findMany({
      where: { projectId, settlementShareId: null, percentageCompletionShareId: null },
      select: { amount: true, currency: true, bynAmount: true },
    }),
    // Списания материалов со склада (§12): цены хранятся в BYN (totalByn),
    // привязка — к изделиям этого проекта
    prisma.stockMovement.findMany({
      where: { product: { projectId }, type: { in: ["EXPENSE", "RETURN"] } },
      select: { type: true, totalByn: true },
    }),
    prisma.productStageSettlement.findMany({
      where: { projectId },
      select: { bynAmount: true },
    }),
    prisma.productPercentageCompletion.findMany({
      where: { product: { projectId }, state: "SETTLED" },
      select: { amount: true, payrollCurrency: true, bynAmount: true },
    }),
  ]);

  let paidByn = new Prisma.Decimal(0);
  let expenseByn = new Prisma.Decimal(0);
  const byArticle = new Map<string, Prisma.Decimal>();
  for (const payment of payments) {
    const amount = new Prisma.Decimal(payment.bynAmount);
    if (payment.direction === "INCOME") paidByn = paidByn.plus(amount);
    else {
      expenseByn = expenseByn.plus(amount);
      const label = payment.expenseArticle?.name ?? "Прочее";
      byArticle.set(label, (byArticle.get(label) ?? new Prisma.Decimal(0)).plus(amount));
    }
  }
  let paidTotal = paidByn.toNumber();
  let expensesTotal: number | null = expenseByn.toNumber();

  // Полные снимки учитывают даже доли, округлённые до нуля; связанные
  // PayrollEntry исключены выше, чтобы не начислять одну сумму дважды.
  const payrollTotal = sumByn([
    sumHistoricalByn(payrollEntries),
    sumHistoricalByn(settlements.map(row => ({ amount: row.bynAmount, bynAmount: row.bynAmount }))),
    sumByn(completions.map(row => row.bynAmount?.toNumber() ?? null)),
  ]);
  const materialsTotal = stockMovements.some(movement => movement.totalByn === null) ? null : stockMovements.reduce((sum, movement) => sum.plus(
    new Prisma.Decimal(movement.totalByn!).times(movement.type === "RETURN" ? -1 : 1)), new Prisma.Decimal(0)).toNumber();
  expensesTotal = sumByn([expensesTotal, materialsTotal]);
  const round = (value: number) => new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber();
  paidTotal = round(paidTotal);
  expensesTotal = expensesTotal === null ? null : round(expensesTotal);
  // Ожидаемая цена = Σ цен изделий + доставка/выгрузка/монтаж проекта
  const expectedRaw =
    calculateProjectTotal(project.products, project);
  const expectedPrice = project.currency === "BYN" && project.products.every(product => product.expectedPrice !== null) ? round(expectedRaw) : null;

  const expenseBreakdown: { label: string; amount: number | null }[] = [...byArticle.entries()]
    .map(([label, amount]) => ({ label, amount: round(amount.toNumber()) }))
    .sort((a, b) => b.amount - a.amount);
  if (materialsTotal === null || materialsTotal > 0) {
    expenseBreakdown.unshift({
      label: "Материалы (склад)",
      amount: materialsTotal === null ? null : round(materialsTotal),
    });
  }
  if (payrollTotal === null || payrollTotal > 0) {
    expenseBreakdown.unshift({ label: "Зарплата", amount: payrollTotal });
  }

  return {
    currency,
    unavailableReason: payrollTotal === null || expensesTotal === null || project.currency !== "BYN" ? BYN_UNAVAILABLE_REASON : null,
    expectedPrice,
    paidTotal,
    expensesTotal,
    payrollTotal,
    margin: subtractByn(subtractByn(paidTotal, expensesTotal), payrollTotal),
    marginAtFullPrice:
      expectedPrice === null
        ? null
        : subtractByn(subtractByn(expectedPrice, expensesTotal), payrollTotal),
    expenseBreakdown,
  };
}
