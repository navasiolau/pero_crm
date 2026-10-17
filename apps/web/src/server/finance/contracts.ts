import type { ViewableFile } from "@/lib/viewable-file";
import type { ExpenseBreakdownRow } from "./project-expense-facts";
import type { StockPurchaseView } from "@/server/warehouse/stock-purchase-view";

export type ProjectExpenseRow = {
  id: string;
  source: "PAYMENT" | "WAREHOUSE_ISSUE" | "WAREHOUSE_RETURN";
  sourceId: string;
  date: string;
  article: { key: string; label: string };
  bynAmount: number | null;
  comment: string | null;
  createdByName: string | null;
  payment: PaymentRow | null;
  stock: {
    materialId: string; materialName: string; unit: string; quantity: string; unitPrice: string | null;
    product: { id: string; number: string } | null; sourceMovementId: string | null;
  } | null;
};

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
  stockPurchase: StockPurchaseView | null;
  logisticsTripId?: string | null;
};
export type ProjectEconomicsView = {
  expectedPrice: number | null;
  paidTotal: number | null;
  expensesTotal: number | null;
  payrollTotal: number | null;
  margin: number | null;
  marginAtFullPrice: number | null;
  expenseBreakdown: ExpenseBreakdownRow[];
};
export type CashAccountOption = { id: string; name: string; currency: string; isDefault?: boolean };
export type ExpenseArticleOption = { id: string; name: string };
export type ExpenseArticleCreateResult = { ok: true; article: ExpenseArticleOption } | { ok: false; error: string };
