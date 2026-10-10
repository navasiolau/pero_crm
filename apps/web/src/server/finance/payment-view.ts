import type { Payment } from "@prisma/client";
import { reportDocumentFile, type ReportDocumentRecord } from "@/server/finance-documents/view";
import type { PaymentRow } from "./contracts";
import { stockPurchaseView, type StockPurchaseRecord } from "@/server/warehouse/stock-purchase-view";
import { logisticsPaymentDocument, type LogisticsPaymentRecord } from "@/server/logistics/payment-view";

export type PaymentRecord = Pick<Payment, "id" | "direction" | "amount" | "currency" | "rate" | "bynAmount" | "projectAmount" | "paidAt" | "comment" | "createdById"> & {
  cashAccount: { name: string } | null;
  expenseArticle: { id: string; name: string } | null;
  reportDocument?: ReportDocumentRecord | null;
  stockPurchase?: StockPurchaseRecord | null;
  logisticsAllocation?: LogisticsPaymentRecord | null;
  logisticsAllocationId?: string | null;
};
export function paymentView(row: PaymentRecord, people: ReadonlyMap<string, string>): PaymentRow {
  return { id: row.id, direction: row.direction, amount: row.amount.toNumber(), currency: row.currency,
    rate: row.rate.toNumber(), bynAmount: row.bynAmount.toNumber(), projectAmount: row.projectAmount?.toNumber() ?? null,
    paidAt: row.paidAt.toISOString(), comment: row.comment, cashAccountName: row.cashAccount?.name ?? null,
    expenseArticleName: row.logisticsAllocation || row.logisticsAllocationId ? "Логистика" : row.expenseArticle?.name ?? null, createdByName: row.createdById ? people.get(row.createdById) ?? null : null,
    reportDocument: reportDocumentFile(row.reportDocument) ?? logisticsPaymentDocument(row.logisticsAllocation), stockPurchase: stockPurchaseView(row.stockPurchase),
    ...(row.logisticsAllocation ? { logisticsTripId: row.logisticsAllocation.posting.tripId } : {}) };
}
