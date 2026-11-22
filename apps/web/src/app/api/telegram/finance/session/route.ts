import { NextRequest } from "next/server";
import { TELEGRAM_SECTION_DENIED } from "@/server/telegram/access";
import { denyTelegramFinance, readTelegramBody, telegramFinanceReply, telegramFinanceSessionReply } from "@/server/telegram/finance-http";
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
  const result = await startTelegramFinanceSession(identity.chatId, config.secret, identity.authenticatedAt);
  if (result.kind === "signed") return telegramFinanceSessionReply(result.proof);
  if (result.kind === "forbidden") return denyTelegramFinance(403, TELEGRAM_SECTION_DENIED);
  if (result.kind === "stale") return denyTelegramFinance(403, "Откройте «Финансы» заново из личного чата с ботом.");
  return telegramFinanceReply({
    ok: false, code: "LINK_REQUIRED",
    error: "Привяжите Telegram в профиле CRM через «Telegram → Получить ссылку».",
  }, 409);
}
