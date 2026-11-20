import { NextRequest } from "next/server";
import { openTelegramFinanceBinding, TELEGRAM_BINDING_COOKIE } from "@/server/telegram/finance-binding";
import { denyTelegramFinance, readTelegramBody, telegramCookieOptions, telegramFinanceReply, telegramFinanceSessionReply } from "@/server/telegram/finance-http";
import { verifiedTelegramIdentity } from "@/server/telegram/finance-security";
import { startTelegramFinanceSession, telegramFinanceConfig } from "@/server/telegram/finance-session";

export async function POST(request: NextRequest) {
  const config = telegramFinanceConfig();
  if (!config) return denyTelegramFinance(503, "Финансы в Telegram пока недоступны.");
  if (request.headers.get("origin") !== config.origin) return denyTelegramFinance(403, "Откройте финансы из Telegram.");
  const raw = await readTelegramBody(request, 16384);
  if (!raw) return denyTelegramFinance(400, "Данные Telegram не приняты.");
  const identity = verifiedTelegramIdentity(raw, config.telegramToken);
  if (!identity) return denyTelegramFinance(403, "Откройте финансы заново из личного чата с ботом.");
  const proof = await startTelegramFinanceSession(identity.chatId, config.secret, identity.authenticatedAt);
  if (proof) return telegramFinanceSessionReply(proof);

  const launchHash = new URLSearchParams(raw).get("hash")!;
  const pending = await openTelegramFinanceBinding(identity, launchHash, request.cookies.get(TELEGRAM_BINDING_COOKIE)?.value);
  if (!pending) return denyTelegramFinance(403, "Нет доступной привязки. Откройте финансы заново из личного чата.");
  const reply = telegramFinanceReply({ ok: false, code: "LINK_REQUIRED", ...(pending.candidate ? { candidate: pending.candidate } : {}) }, 409);
  reply.cookies.set(TELEGRAM_BINDING_COOKIE, pending.id, { ...telegramCookieOptions, expires: pending.expiresAt });
  return reply;
}
