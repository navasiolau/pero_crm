import { prisma } from "@/lib/prisma";

import { getNbrbRate } from "./nbrb";

// ─── Финансы (§11): кассы, статьи расходов, экономика проекта ───────────────
// Раздел доступен только администратору и директору (middleware + requireAdmin).

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
  const [accounts, grouped] = await Promise.all([
    prisma.cashAccount.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.payment.groupBy({
      by: ["cashAccountId", "direction"],
      _sum: { amount: true },
    }),
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
  expectedPrice: number | null;
  paidTotal: number; // приходы, в валюте проекта
  expensesTotal: number; // расходы (статьи), в валюте проекта
  payrollTotal: number; // ЗП по проекту (начисления), в валюте проекта
  margin: number; // paidTotal − expensesTotal − payrollTotal
  marginAtFullPrice: number | null; // expectedPrice − расходы − ЗП
  expenseBreakdown: { label: string; amount: number }[]; // по статьям + ЗП
};

// Экономика проекта (§11): ожидаемая цена, оплаты, расходы (ЗП + материалы +
// прочее), маржа. Все суммы — в валюте проекта (платежи хранят projectAmount;
// начисления ЗП — в валюте ЗП, при отличии конвертируем по текущему курсу
// НБ РБ — редкий случай, в типовой установке валюты совпадают).
export async function getProjectEconomics(
  projectId: string,
): Promise<ProjectEconomics | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, currency: true, expectedPrice: true },
  });
  if (!project) return null;
  const currency = project.currency;

  const [payments, payrollEntries] = await Promise.all([
    prisma.payment.findMany({
      where: { projectId },
      select: {
        direction: true,
        projectAmount: true,
        expenseArticle: { select: { name: true } },
      },
    }),
    prisma.payrollEntry.findMany({
      where: { projectId },
      select: { amount: true, currency: true },
    }),
  ]);

  let paidTotal = 0;
  let expensesTotal = 0;
  const byArticle = new Map<string, number>();
  for (const payment of payments) {
    const amount = Number(payment.projectAmount);
    if (payment.direction === "INCOME") {
      paidTotal += amount;
    } else {
      expensesTotal += amount;
      const label = payment.expenseArticle?.name ?? "Прочее";
      byArticle.set(label, (byArticle.get(label) ?? 0) + amount);
    }
  }

  // ЗП проекта: суммируем начисления по валютам и приводим к валюте проекта
  const payrollByCurrency = new Map<string, number>();
  for (const entry of payrollEntries) {
    payrollByCurrency.set(
      entry.currency,
      (payrollByCurrency.get(entry.currency) ?? 0) + Number(entry.amount),
    );
  }
  let payrollTotal = 0;
  for (const [entryCurrency, amount] of payrollByCurrency) {
    if (entryCurrency === currency) {
      payrollTotal += amount;
    } else {
      const [from, to] = await Promise.all([
        getNbrbRate(entryCurrency).catch(() => null),
        getNbrbRate(currency).catch(() => null),
      ]);
      // НБ РБ недоступен — не искажаем маржу: показываем как есть
      payrollTotal += from && to ? (amount * from.rate) / to.rate : amount;
    }
  }

  const round = (value: number) => Math.round(value * 100) / 100;
  paidTotal = round(paidTotal);
  expensesTotal = round(expensesTotal);
  payrollTotal = round(payrollTotal);
  const expectedPrice = project.expectedPrice
    ? Number(project.expectedPrice)
    : null;

  const expenseBreakdown = [...byArticle.entries()]
    .map(([label, amount]) => ({ label, amount: round(amount) }))
    .sort((a, b) => b.amount - a.amount);
  if (payrollTotal > 0) {
    expenseBreakdown.unshift({ label: "Зарплата", amount: payrollTotal });
  }

  return {
    currency,
    expectedPrice,
    paidTotal,
    expensesTotal,
    payrollTotal,
    margin: round(paidTotal - expensesTotal - payrollTotal),
    marginAtFullPrice:
      expectedPrice === null
        ? null
        : round(expectedPrice - expensesTotal - payrollTotal),
    expenseBreakdown,
  };
}
