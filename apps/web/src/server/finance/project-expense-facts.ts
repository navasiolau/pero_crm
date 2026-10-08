import { Prisma } from "@prisma/client";
import { sumByn } from "@/lib/history-byn";

export type ProjectExpenseFacts = {
  payments: readonly { direction: string; bynAmount: Prisma.Decimal.Value | null; expenseArticle: { id: string; name: string } | null }[];
  stockMovements: readonly { type: string; totalByn: Prisma.Decimal.Value | null }[];
};
export type ExpenseBreakdownRow = { key: string; label: string; amount: number | null };
export const WAREHOUSE_EXPENSE_ARTICLE = { key: "warehouse", label: "Материалы (склад)" };
export function paymentExpenseArticle(article: { id: string; name: string } | null) {
  return { key: article ? `article:${article.id}` : "article:none", label: article?.name ?? "Прочее" };
}
export function stockExpenseAmount(row: ProjectExpenseFacts["stockMovements"][number]) {
  return row.totalByn === null ? null : new Prisma.Decimal(row.totalByn).times(row.type === "RETURN" ? -1 : 1).toNumber();
}
/** Shared saved facts for rows, article groups and project economics. No live prices/FX. */
export function summarizeProjectExpenses(facts: ProjectExpenseFacts) {
  const groups = new Map<string, { label: string; amounts: (number | null)[] }>();
  const income: (number | null)[] = [];
  const add = (article: { key: string; label: string }, amount: number | null) => {
    const group = groups.get(article.key) ?? { label: article.label, amounts: [] };
    group.amounts.push(amount); groups.set(article.key, group);
  };
  for (const row of facts.payments) {
    const amount = row.bynAmount === null ? null : new Prisma.Decimal(row.bynAmount).toNumber();
    if (row.direction === "INCOME") income.push(amount);
    else add(paymentExpenseArticle(row.expenseArticle), amount);
  }
  for (const row of facts.stockMovements) {
    if (row.type === "EXPENSE" || row.type === "RETURN") add(WAREHOUSE_EXPENSE_ARTICLE, stockExpenseAmount(row));
  }
  const expenseBreakdown: ExpenseBreakdownRow[] = [...groups].map(([key, group]) => ({ key, label: group.label, amount: sumByn(group.amounts) }))
    .sort((a,b) => (b.amount ?? 0) - (a.amount ?? 0) || a.key.localeCompare(b.key));
  return { paidTotal: sumByn(income), expensesTotal: sumByn(expenseBreakdown.map(row => row.amount)), expenseBreakdown };
}

