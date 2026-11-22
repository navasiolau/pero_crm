import { uploadLogisticsDocumentResponse } from "@/server/logistics/http";
import { logisticsDocuments } from "@/server/logistics/service";
import { logisticsWebActorId } from "@/server/logistics/web-actor";
import { financeSessionSource } from "@/server/telegram/finance-session";
import { financeWorkspaceUploadSession } from "@/server/telegram/finance-http";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const session = await financeWorkspaceUploadSession(request);
  if (session instanceof Response) return session;
  return uploadLogisticsDocumentResponse(request, {
    authorize: () => logisticsWebActorId("manage", session),
    service: logisticsDocuments,
    source: session ? financeSessionSource(session) : "web",
  });
}
