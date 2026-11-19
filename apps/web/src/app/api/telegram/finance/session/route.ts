import { NextRequest, NextResponse } from "next/server";
import { TELEGRAM_FINANCE_COOKIE, TELEGRAM_FINANCE_TTL_SECONDS, verifiedTelegramIdentity } from "@/server/telegram/finance-security";
import { startTelegramFinanceSession, telegramFinanceConfig } from "@/server/telegram/finance-session";

const privateHeaders = { "Cache-Control": "private, no-store" };
const deny = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status, headers: privateHeaders });

export async function POST(request: NextRequest) {
  const config = telegramFinanceConfig();
  if (!config) return deny(503, "Финансы в Telegram пока недоступны.");
  if (request.headers.get("origin") !== config.origin) return deny(403, "Откройте финансы из Telegram.");
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > 16384) return deny(400, "Данные Telegram не приняты.");

  const reader = request.body?.getReader();
  if (!reader) return deny(400, "Данные Telegram не получены.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 16384) {
      await reader.cancel();
      return deny(400, "Данные Telegram не приняты.");
    }
    chunks.push(value);
  }
  const actor = verifiedTelegramIdentity(Buffer.concat(chunks).toString("utf8"), config.telegramToken);
  if (!actor) return deny(403, "Откройте финансы заново из личного чата с ботом.");
  const proof = await startTelegramFinanceSession(actor, config.secret);
  if (!proof) return deny(403, "Нет действующей привязки Telegram к финансовому аккаунту CRM.");
  const response = NextResponse.json({ ok: true }, { headers: privateHeaders });
  response.cookies.set(TELEGRAM_FINANCE_COOKIE, proof, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: TELEGRAM_FINANCE_TTL_SECONDS,
  });
  return response;
}
