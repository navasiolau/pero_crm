import { NextRequest } from "next/server";
import { z } from "zod";
import { finishTelegramFinanceBinding, TELEGRAM_BINDING_COOKIE, verifyTelegramFinanceBindingAccount } from "@/server/telegram/finance-binding";
import { denyTelegramFinance, readTelegramBody, telegramCookieOptions, telegramFinanceReply, telegramFinanceSessionReply } from "@/server/telegram/finance-http";
import { telegramFinanceConfig } from "@/server/telegram/finance-session";
import { signFinanceGrant, TELEGRAM_FINANCE_TTL_SECONDS } from "@/server/telegram/finance-security";

const bodySchema = z.discriminatedUnion("step", [
  z.strictObject({ step: z.literal("account"), email: z.email().max(254), password: z.string().min(1).max(1024) }),
  z.strictObject({ step: z.literal("confirm") }),
]);

export async function POST(request: NextRequest) {
  const config = telegramFinanceConfig();
  if (!config) return denyTelegramFinance(503, "Финансы в Telegram пока недоступны.");
  if (request.headers.get("origin") !== config.origin) return denyTelegramFinance(403, "Откройте финансы из Telegram.");
  const raw = await readTelegramBody(request, 8192);
  let value: unknown;
  try { value = JSON.parse(raw ?? "null"); } catch { return denyTelegramFinance(400, "Проверьте данные для подключения."); }
  const input = bodySchema.safeParse(value);
  if (!input.success) return denyTelegramFinance(400, "Проверьте данные для подключения.");
  const id = request.cookies.get(TELEGRAM_BINDING_COOKIE)?.value;
  if (input.data.step === "account") {
    const result = await verifyTelegramFinanceBindingAccount(id, input.data);
    if (result.ok) return telegramFinanceReply(result);
    if (result.limited) return denyTelegramFinance(429, "Слишком много попыток. Попробуйте позже.");
    if (result.expired) return denyTelegramFinance(409, "Откройте финансы заново из личного чата с ботом.");
    if (result.occupied) return denyTelegramFinance(409, "У этой учётной записи уже есть привязка. Отвяжите её в профиле CRM.");
    return denyTelegramFinance(403, "Не удалось подтвердить учётную запись с доступом к финансам.");
  }
  const bound = await finishTelegramFinanceBinding(id);
  if (!bound) return denyTelegramFinance(409, "Привязка изменилась или срок подтверждения истёк. Откройте финансы заново.");
  const reply = telegramFinanceSessionReply(signFinanceGrant({
    ...bound, expires: Math.floor(Date.now() / 1000) + TELEGRAM_FINANCE_TTL_SECONDS,
  }, config.secret));
  reply.cookies.set(TELEGRAM_BINDING_COOKIE, "", { ...telegramCookieOptions, maxAge: 0 });
  return reply;
}
