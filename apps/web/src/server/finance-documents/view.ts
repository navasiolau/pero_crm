import type { Prisma } from "@prisma/client";
import type { ViewableFile } from "@/lib/viewable-file";

export const reportDocumentSelect = { id: true, fileName: true, mimeType: true, state: true } satisfies Prisma.FinanceDocumentSelect;
export type ReportDocumentRecord = Prisma.FinanceDocumentGetPayload<{ select: typeof reportDocumentSelect }>;
export function reportDocumentFile(document: ReportDocumentRecord | null | undefined): ViewableFile | null {
  return document?.state === "READY" ? { id: document.id, fileName: document.fileName, mimeType: document.mimeType, source: "finance" } : null;
}
