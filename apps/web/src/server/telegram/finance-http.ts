import { NextResponse } from "next/server";
import { TELEGRAM_FINANCE_COOKIE, TELEGRAM_FINANCE_TTL_SECONDS } from "./finance-security";

export const telegramPrivateHeaders = { "Cache-Control": "private, no-store" };
export const telegramCookieOptions = { httpOnly: true, secure: true, sameSite: "lax", path: "/" } as const;
export const telegramFinanceReply = (body: object, status = 200) => NextResponse.json(body, { status, headers: telegramPrivateHeaders });
export const denyTelegramFinance = (status: number, error: string) => telegramFinanceReply({ ok: false, error }, status);

export function telegramFinanceSessionReply(proof: string) {
  const response = telegramFinanceReply({ ok: true });
  response.cookies.set(TELEGRAM_FINANCE_COOKIE, proof, { ...telegramCookieOptions, maxAge: TELEGRAM_FINANCE_TTL_SECONDS });
  return response;
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
