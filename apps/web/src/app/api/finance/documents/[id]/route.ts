import { readFinanceDocumentResponse } from "@/server/finance-documents/http";
import { financeDocuments } from "@/server/finance-documents/service";
import { financeDocumentWebActorId } from "@/server/finance-documents/web-actor";

export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return readFinanceDocumentResponse(request, (await params).id, { authorize: financeDocumentWebActorId, service: financeDocuments });
}
