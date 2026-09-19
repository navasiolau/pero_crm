import { prisma } from "@/lib/prisma";

import { getNbrbRate } from "./nbrb";

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
  expensesTotal: number; // расходы (статьи + материалы склада), в валюте проекта
  payrollTotal: number; // ЗП по проекту (начисления), в валюте проекта
  margin: number; // paidTotal − expensesTotal − payrollTotal
  marginAtFullPrice: number | null; // expectedPrice − расходы − ЗП
  expenseBreakdown: { label: string; amount: number }[]; // по статьям + ЗП + материалы
};

// Экономика проекта (§11): ожидаемая цена (Σ цен изделий), оплаты, расходы
// (ЗП + материалы + прочее), маржа. Все суммы — в валюте проекта (платежи
// хранят projectAmount; начисления ЗП — в валюте ЗП, материалы склада — в BYN;
// при отличии конвертируем по текущему курсу НБ РБ — редкий случай, в типовой
// установке валюты совпадают). Материалы склада (§12) — безденежный расход:
// Σ StockMovement.totalByn (EXPENSE − RETURN) по изделиям проекта,
// без кассы и платежа.
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
      products: { select: { expectedPrice: true } },
    },
  });
  if (!project) return null;
  const currency = project.currency;

  const [payments, payrollEntries, stockMovements] = await Promise.all([
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
    // Списания материалов со склада (§12): цены хранятся в BYN (totalByn),
    // привязка — к изделиям этого проекта
    prisma.stockMovement.findMany({
      where: { product: { projectId }, type: { in: ["EXPENSE", "RETURN"] } },
      select: { type: true, totalByn: true },
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

  // Материалы склада: BYN → валюта проекта тем же курсом, что и ЗП
  let materialsByn = 0;
  for (const movement of stockMovements) {
    materialsByn +=
      (movement.type === "RETURN" ? -1 : 1) * Number(movement.totalByn ?? 0);
  }
  let materialsTotal = 0;
  if (materialsByn !== 0) {
    if (currency === "BYN") {
      materialsTotal = materialsByn;
    } else {
      const rate = await getNbrbRate(currency).catch(() => null);
      // НБ РБ недоступен — не искажаем маржу: показываем как есть
      materialsTotal = rate ? materialsByn / rate.rate : materialsByn;
    }
    expensesTotal += materialsTotal;
  }

  const round = (value: number) => Math.round(value * 100) / 100;
  paidTotal = round(paidTotal);
  expensesTotal = round(expensesTotal);
  payrollTotal = round(payrollTotal);
  // Ожидаемая цена = Σ цен изделий + доставка/выгрузка/монтаж проекта
  const expectedRaw =
    project.products.reduce(
      (sum, product) => sum + Number(product.expectedPrice ?? 0),
      0,
    ) +
    Number(project.delivery ?? 0) +
    Number(project.unloading ?? 0) +
    Number(project.installation ?? 0);
  const expectedPrice = expectedRaw > 0 ? round(expectedRaw) : null;

  const expenseBreakdown = [...byArticle.entries()]
    .map(([label, amount]) => ({ label, amount: round(amount) }))
    .sort((a, b) => b.amount - a.amount);
  if (materialsTotal > 0) {
    expenseBreakdown.unshift({
      label: "Материалы (склад)",
      amount: round(materialsTotal),
    });
  }
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
