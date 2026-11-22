import { uploadFinanceDocumentResponse } from "@/server/finance-documents/http";
import { financeDocuments } from "@/server/finance-documents/service";
import { scopedFinanceAuth, telegramFinanceConfig } from "@/server/telegram/finance-session";
import { TELEGRAM_FINANCE_ONLY_HEADER } from "@/server/telegram/finance-security";
import { financeDocumentWebActorId } from "@/server/finance-documents/web-actor";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const telegramOnly = request.headers.get(TELEGRAM_FINANCE_ONLY_HEADER) === "1";
  const session = await scopedFinanceAuth(telegramOnly);
  if (telegramOnly && !session) {
    return Response.json({ ok: false, error: "Сессия Telegram завершена. Откройте «Финансы» заново." }, { status: 401 });
  }
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
