import type { Prisma } from "@prisma/client";
import type { ViewableFile } from "@/lib/viewable-file";

export const logisticsAllocationSelect = { posting: { select: { tripId: true,
  documents: { select: { document: { select: { id: true, fileName: true, mimeType: true } } }, orderBy: { documentId: "asc" } },
} } } satisfies Prisma.LogisticsPostingAllocationSelect;
export type LogisticsPaymentRecord = Prisma.LogisticsPostingAllocationGetPayload<{ select: typeof logisticsAllocationSelect }>;
export function logisticsPaymentDocument(allocation: LogisticsPaymentRecord | null | undefined): ViewableFile | null {
  return logisticsPaymentDocuments(allocation)[0] ?? null;
}
export function logisticsPaymentDocuments(allocation: LogisticsPaymentRecord | null | undefined): ViewableFile[] {
  return allocation?.posting.documents.map(row => ({ ...row.document, source: "logistics" })) ?? [];
}
