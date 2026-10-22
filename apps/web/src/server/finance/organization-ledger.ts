import type { PaymentDirection, PrismaClient } from "@prisma/client";
import {activePaymentWhere} from '@/server/payments/active-records';
import { requireFinanceWorkspaceActor, listFinanceWorkspaceProjects, type FinanceWorkspaceActor } from "./project-refs";
import { paymentView } from "./payment-view";
import { reportDocumentSelect, paymentReportDocumentsSelect } from "@/server/finance-documents/view";
import { stockPurchaseSelect } from "@/server/warehouse/stock-purchase-view";
import { logisticsAllocationSelect } from "@/server/logistics/payment-view";
import { listActiveCashAccountOptions } from "./default-cash-core";

export async function loadOrganizationPayments(actor: FinanceWorkspaceActor, direction: PaymentDirection,
  db: Pick<PrismaClient, "project" | "payment" | "cashAccount" | "orgSetting">) {
  requireFinanceWorkspaceActor(actor);
  const [records, cashAccounts, projects] = await Promise.all([
    db.payment.findMany({ where: { ...activePaymentWhere, direction }, select: { id: true, direction: true, amount: true, currency: true,
      rate: true, rateDate: true, bynAmount: true, projectAmount: true, paidAt: true, comment: true, createdById: true,
      project: { select: { id: true, number: true, title: true, deletedAt: true } }, cashAccount: { select: { name: true } },
      expenseArticle: { select: { id: true, name: true } }, reportDocument: { select: reportDocumentSelect }, reportDocuments: paymentReportDocumentsSelect, stockPurchase: { select: stockPurchaseSelect },
      logisticsAllocation: { select: logisticsAllocationSelect } }, orderBy: { paidAt: "desc" } }),
    listActiveCashAccountOptions(db),
    listFinanceWorkspaceProjects(actor, db),
  ]);
  return { rows: records.map(row => ({ ...paymentView(row, new Map()), rateDate: row.rateDate?.toISOString() ?? null,
    project: row.project ? { id: row.project.id, number: row.project.number, title: row.project.title, archived: row.project.deletedAt !== null } : null,
    cashName: row.cashAccount?.name ?? null })), cashAccounts,
    projects: projects.map(({ id, number, title }) => ({ id, number, title })) };
}
export type OrganizationLedgerData = Awaited<ReturnType<typeof loadOrganizationPayments>>;
export type OrganizationPaymentRow = OrganizationLedgerData["rows"][number];
