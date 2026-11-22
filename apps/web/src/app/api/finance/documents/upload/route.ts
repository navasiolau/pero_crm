import { uploadFinanceDocumentResponse } from "@/server/finance-documents/http";
import { financeDocuments } from "@/server/finance-documents/service";
import { financeSessionSource } from "@/server/telegram/finance-session";
import { financeWorkspaceUploadSession } from "@/server/telegram/finance-http";
import { financeDocumentWebActorId } from "@/server/finance-documents/web-actor";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const session = await financeWorkspaceUploadSession(request);
  if (session instanceof Response) return session;
  return uploadFinanceDocumentResponse(request, {
    authorize: () => financeDocumentWebActorId(session?.user.id ?? null),
    service: financeDocuments,
    source: session ? financeSessionSource(session) : "web",
  });
}
