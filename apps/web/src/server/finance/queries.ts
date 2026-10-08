import { projectTotal as calculateProjectTotal } from "@/lib/product-quantity";
import { prisma } from "@/lib/prisma";
import { Prisma,type PrismaClient } from "@prisma/client";

import { sumHistoricalByn, sumByn, subtractByn, BYN_UNAVAILABLE_REASON } from "@/lib/history-byn";
import { summarizeProjectExpenses, type ProjectExpenseFacts, type ExpenseBreakdownRow } from "./project-expense-facts";

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
  code: number;
  name: string;
  comment: string | null;
  active: boolean;
};

export async function listExpenseArticles(): Promise<ExpenseArticleView[]> {
  const articles = await prisma.expenseArticle.findMany({
    orderBy: { code: "asc" },
  });
  return articles.map((article) => ({
    id: article.id,
    code: article.code,
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
  expenseBreakdown: ExpenseBreakdownRow[]; // по статьям + ЗП + материалы
};

// Внутренняя экономика использует только сохранённые BYN-эквиваленты.
// Полные процентные снимки заменяют связанные начисления, а не дополняют их.
// Историческая неизвестность не пересчитывается сегодняшним курсом.
export async function getProjectEconomics(
  projectId: string,
  database:Pick<PrismaClient,"project"|"payment"|"payrollEntry"|"stockMovement"|"productStageSettlement"|"productPercentageCompletion">=prisma,
  facts?: ProjectExpenseFacts,
): Promise<ProjectEconomics | null> {
  const project = await database.project.findUnique({
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
    facts ? Promise.resolve(facts.payments) : database.payment.findMany({
      where: { projectId },
      select: {
        direction: true,
        bynAmount: true,
        expenseArticle: { select: { id: true, name: true } },
      },
    }),
    database.payrollEntry.findMany({
      where: { projectId, settlementShareId: null, percentageCompletionShareId: null,percentageAdjustmentId:null },
      select: { amount: true, currency: true, bynAmount: true },
    }),
    // Списания материалов со склада (§12): цены хранятся в BYN (totalByn),
    // привязка — к изделиям этого проекта
    facts ? Promise.resolve(facts.stockMovements) : database.stockMovement.findMany({
      where: { product: { projectId }, type: { in: ["EXPENSE", "RETURN"] } },
      select: { type: true, totalByn: true },
    }),
    database.productStageSettlement.findMany({
      where: { projectId },
      select: { bynAmount: true },
    }),
    database.productPercentageCompletion.findMany({
      where: { product: { projectId }, state: "SETTLED" },
      select: { amount: true, payrollCurrency: true, bynAmount: true,shares:{select:{adjustments:{select:{delta:true}}}} },
    }),
  ]);

  const { paidTotal, expensesTotal, expenseBreakdown } = summarizeProjectExpenses({ payments, stockMovements });

  // Полные снимки учитывают даже доли, округлённые до нуля; связанные
  // PayrollEntry исключены выше, чтобы не начислять одну сумму дважды.
  const payrollTotal = sumByn([
    sumHistoricalByn(payrollEntries),
    sumHistoricalByn(settlements.map(row => ({ amount: row.bynAmount, bynAmount: row.bynAmount }))),
    sumByn(completions.map(row => row.bynAmount?.toNumber() ?? null)),
    sumByn(completions.flatMap(row=>(row.shares??[]).flatMap(share=>(share.adjustments??[]).map(adjustment=>adjustment.delta.toNumber())))),
  ]);
  const round = (value: number) => new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber();
  // Ожидаемая цена = Σ цен изделий + доставка/выгрузка/монтаж проекта
  const expectedRaw =
    calculateProjectTotal(project.products, project);
  const expectedPrice = project.currency === "BYN" && project.products.every(product => product.expectedPrice !== null) ? round(expectedRaw) : null;

  if (payrollTotal === null || payrollTotal > 0) {
    expenseBreakdown.unshift({ key: "payroll", label: "Зарплата", amount: payrollTotal });
  }

  return {
    currency,
    unavailableReason: paidTotal === null || payrollTotal === null || expensesTotal === null || project.currency !== "BYN" ? BYN_UNAVAILABLE_REASON : null,
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
