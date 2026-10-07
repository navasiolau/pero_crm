import { uploadFinanceDocumentResponse } from "@/server/finance-documents/http";
import { financeDocuments } from "@/server/finance-documents/service";
import { financeDocumentWebActorId } from "@/server/finance-documents/web-actor";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return uploadFinanceDocumentResponse(request, { authorize: financeDocumentWebActorId, service: financeDocuments });
}
