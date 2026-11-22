import { NextResponse } from "next/server";
import type { Role } from "@prisma/client";

import { hasAnyRole, MANAGER_ROLES, FINANCE_ROLES } from "@/lib/roles";
import { findActiveTelegramLink, telegramBindingVersion, TELEGRAM_SECTION_DENIED } from "./access";

// Слой REST /api/v1/bot/* — канал telegram-бота (LXC tgbot).
// Авторизация: Bearer-сервисный токен CRM (authenticate, scope) + заголовок
// x-acting-user с id пользователя CRM, от имени которого действует бот.
// Разрешения на операции определяются действующей привязкой и ролями CRM.

export interface BotActor {
  id: string;
  name: string;
  roles: Role[];
  source: "telegram";
}

// Единый вид ошибок домена для бота — {ok:false, error} с человекочитаемым
// текстом по-русски; «Недостаточно прав» из ядер → 403.
export function domainError(e: unknown): NextResponse {
  const message = e instanceof Error ? e.message : "Внутренняя ошибка";
  const status = message === "Недостаточно прав" ? 403 : 400;
  console.error("[bot-api]", message);
  return NextResponse.json({ ok: false, error: status === 403 ? TELEGRAM_SECTION_DENIED : message }, { status });
}

// Resolve актёра по x-acting-user: пользователь должен существовать и быть активным.
export async function resolveBotActor(
  request: Request,
): Promise<BotActor | NextResponse> {
  const userId = request.headers.get("x-acting-user");
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "Не указан пользователь (x-acting-user)" },
      { status: 400 },
    );
  }
  const link = await findActiveTelegramLink({ userId });
  const supplied = request.headers.get("x-telegram-binding");
  const expected = link ? telegramBindingVersion(link.id, link.generation, link.user.sessionVersion) : null;
  const strict = process.env.PERO_REQUIRE_TELEGRAM_BINDING_GENERATION === "1";
  if (!link || ((strict || supplied !== null) && supplied !== expected)) {
    return NextResponse.json({ ok: false, error: "Действующая привязка Telegram не найдена" }, { status: 403 });
  }
  const user = link.user;
  return { id: user.id, name: user.name, roles: user.roles, source: "telegram" };
}

export function isActorError(
  result: BotActor | NextResponse,
): result is NextResponse {
  return result instanceof NextResponse;
}

export function requireBotManager(actor: BotActor): NextResponse | null {
  return hasAnyRole(actor.roles, MANAGER_ROLES) ? null : NextResponse.json({ ok: false, error: TELEGRAM_SECTION_DENIED }, { status: 403 });
}

export function requireBotFinance(actor: BotActor): NextResponse | null {
  return hasAnyRole(actor.roles, FINANCE_ROLES) ? null : NextResponse.json({ ok: false, error: TELEGRAM_SECTION_DENIED }, { status: 403 });
}
