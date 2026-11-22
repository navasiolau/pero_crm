import { NextResponse } from "next/server";
import { TELEGRAM_FINANCE_COOKIE, TELEGRAM_FINANCE_TTL_SECONDS, TELEGRAM_FINANCE_ONLY_HEADER } from "./finance-security";
import { financeSessionSource, scopedFinanceAuth, telegramFinanceConfig } from "./finance-session";

export const telegramPrivateHeaders = { "Cache-Control": "private, no-store" };
export const telegramCookieOptions = { httpOnly: true, secure: true, sameSite: "lax", path: "/" } as const;
export const telegramFinanceReply = (body: object, status = 200) => NextResponse.json(body, { status, headers: telegramPrivateHeaders });
export const denyTelegramFinance = (status: number, error: string) => telegramFinanceReply({ ok: false, error }, status);

export function telegramFinanceSessionReply(proof: string) {
  const response = telegramFinanceReply({ ok: true });
  response.cookies.set(TELEGRAM_FINANCE_COOKIE, proof, { ...telegramCookieOptions, maxAge: TELEGRAM_FINANCE_TTL_SECONDS });
  return response;
}

/** Проверить сессию и адрес отправки до чтения multipart. */
export async function financeWorkspaceUploadSession(request: Request) {
  const telegramOnly = request.headers.get(TELEGRAM_FINANCE_ONLY_HEADER) === "1";
  const session = await scopedFinanceAuth(telegramOnly);
  if (telegramOnly && !session) {
    return denyTelegramFinance(401, "Сессия Telegram завершена. Откройте «Финансы» заново.");
  }
  if (session && financeSessionSource(session) === "telegram" && request.headers.get("origin") !== telegramFinanceConfig()?.origin) {
    return denyTelegramFinance(403, "Загрузка недоступна из этого источника.");
  }
  return session;
}

export async function readTelegramBody(request: Request, limit: number) {
  if (Number(request.headers.get("content-length") ?? 0) > limit) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
