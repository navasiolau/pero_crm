import type { ViewableFile } from "@/lib/viewable-file";

export type PaymentRow = {
  id: string;
  direction: "INCOME" | "EXPENSE";
  amount: number;
  currency: string;
  rate: number;
  bynAmount: number;
  projectAmount: number | null;
  paidAt: string;
  comment: string | null;
  cashAccountName: string | null;
  expenseArticleName: string | null;
  createdByName: string | null;
  reportDocument: ViewableFile | null;
};
export type ProjectEconomicsView = {
  expectedPrice: number | null;
  paidTotal: number | null;
  expensesTotal: number | null;
  payrollTotal: number | null;
  margin: number | null;
  marginAtFullPrice: number | null;
  expenseBreakdown: { label: string; amount: number | null }[];
};
export type CashAccountOption = { id: string; name: string; currency: string };
export type ExpenseArticleOption = { id: string; name: string };
