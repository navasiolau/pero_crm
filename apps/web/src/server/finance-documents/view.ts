import type { Prisma } from "@prisma/client";
import type { ViewableFile } from "@/lib/viewable-file";

export const reportDocumentSelect = { id: true, fileName: true, mimeType: true, state: true } satisfies Prisma.FinanceDocumentSelect;
export type ReportDocumentRecord = Prisma.FinanceDocumentGetPayload<{ select: typeof reportDocumentSelect }>;
export const paymentReportDocumentsSelect = {
  select: { document: { select: reportDocumentSelect }, position: true }, orderBy: { position: "asc" },
} satisfies Prisma.Payment$reportDocumentsArgs;
export type PaymentReportDocumentRecord = { document: ReportDocumentRecord; position: number };
export function reportDocumentFile(document: ReportDocumentRecord | null | undefined): ViewableFile | null {
  return document?.state === "READY" ? { id: document.id, fileName: document.fileName, mimeType: document.mimeType, source: "finance" } : null;
}

export function reportDocumentFiles(payment: { reportDocuments?: PaymentReportDocumentRecord[]; reportDocument?: ReportDocumentRecord | null }): ViewableFile[] {
  const documents = payment.reportDocuments?.length ? payment.reportDocuments.map(row => row.document)
    : payment.reportDocument ? [payment.reportDocument] : [];
  return documents.map(reportDocumentFile).filter((file): file is ViewableFile => file !== null);
}
