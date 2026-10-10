import type { Prisma } from "@prisma/client";
import type { ViewableFile } from "@/lib/viewable-file";

export const logisticsAllocationSelect = { posting: { select: { tripId: true,
  documents: { select: { document: { select: { id: true, fileName: true, mimeType: true } } }, orderBy: { documentId: "asc" }, take: 1 },
} } } satisfies Prisma.LogisticsPostingAllocationSelect;
export type LogisticsPaymentRecord = Prisma.LogisticsPostingAllocationGetPayload<{ select: typeof logisticsAllocationSelect }>;
export function logisticsPaymentDocument(allocation: LogisticsPaymentRecord | null | undefined): ViewableFile | null {
  const document = allocation?.posting.documents[0]?.document;
  return document ? { ...document, source: "logistics" } : null;
}
