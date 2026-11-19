import { uploadFinanceDocumentResponse } from "@/server/finance-documents/http";
import { financeDocuments } from "@/server/finance-documents/service";
import { scopedFinanceAuth, telegramFinanceConfig } from "@/server/telegram/finance-session";
import { financeDocumentWebActorId } from "@/server/finance-documents/web-actor";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const session = await scopedFinanceAuth();
  const telegram = !!session && "telegramFinance" in session;
  if (telegram && request.headers.get("origin") !== telegramFinanceConfig()?.origin) {
    return Response.json({ ok: false, error: "Загрузка недоступна из этого источника." }, { status: 403 });
  }
  return uploadFinanceDocumentResponse(request, {
    authorize: () => financeDocumentWebActorId(session?.user.id ?? null),
    service: financeDocuments,
    source: telegram ? "telegram" : "web",
  });
}
