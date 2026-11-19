import type { Prisma } from "@prisma/client";
import { activeStockMovementWhere } from "./active-records";
import { activePaymentWhere } from "@/server/payments/active-records";
import { FINANCE_ROLES, hasAnyRole, type Role } from "@/lib/roles";
import type { ViewableFile } from "@/lib/viewable-file";
import { reportDocumentFiles, reportDocumentSelect, paymentReportDocumentsSelect } from "@/server/finance-documents/view";

type DocumentReader = Pick<Prisma.TransactionClient, "stockPurchase"> & Partial<Pick<Prisma.TransactionClient, "expenseReceiptLine">>;

/** Складская выборка передаёт разрешённые движения, финансовое право проверяется отдельно. */
export async function loadMovementReportDocumentSets(actor: { roles: Role[] }, movementIds: readonly string[], database: DocumentReader) {
  const documents = new Map<string, ViewableFile[]>();
  if (!hasAnyRole(actor.roles, FINANCE_ROLES) || !movementIds.length) return documents;
  const ids = [...new Set(movementIds)];
  const movement = { ...activeStockMovementWhere, type: "INCOME", receiptKind: "PAID" } as const;
  const paymentSelect = { reportDocument: { select: reportDocumentSelect }, reportDocuments: paymentReportDocumentsSelect };
  const [purchases, lines] = await Promise.all([
    database.stockPurchase.findMany({
      where: { movementId: { in: ids }, movement, payment: activePaymentWhere },
      select: { movementId: true, payment: { select: paymentSelect } },
    }),
    database.expenseReceiptLine?.findMany({
      where: { movementId: { in: ids }, movement, receipt: { cancelledAt: null, payment: activePaymentWhere } },
      select: { movementId: true, receipt: { select: { payment: { select: paymentSelect } } } },
    }) ?? [],
  ]);
  for (const row of [...purchases, ...lines.map(line => ({ movementId: line.movementId, payment: line.receipt.payment }))]) {
    const files = reportDocumentFiles(row.payment);
    if (files.length) documents.set(row.movementId, files);
  }
  return documents;
}

/** Совместимый одиночный reader для прежних внутренних клиентов. */
export async function loadMovementReportDocuments(...args: Parameters<typeof loadMovementReportDocumentSets>) {
  const sets = await loadMovementReportDocumentSets(...args);
  return new Map([...sets].map(([id, files]) => [id, files[0]!]));
}
