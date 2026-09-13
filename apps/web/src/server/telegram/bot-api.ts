import { NextResponse } from "next/server";
import type { Role } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { hasAnyRole, MANAGER_ROLES } from "@/lib/roles";

// Слой REST /api/v1/bot/* — канал telegram-бота (LXC tgbot).
// Авторизация: Bearer-сервисный токен CRM (authenticate, scope) + заголовок
// x-acting-user с id пользователя CRM, от имени которого действует бот.
// Гейт доступа (решение владельца): использование бота — только
// ADMIN/DIRECTOR/MANAGER; привязка и /стоп — любой роли.

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
  return NextResponse.json({ ok: false, error: message }, { status });
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
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, roles: true, active: true },
  });
  if (!user || !user.active) {
    return NextResponse.json(
      { ok: false, error: "Пользователь не найден или неактивен" },
      { status: 403 },
    );
  }
  return { id: user.id, name: user.name, roles: user.roles, source: "telegram" };
}

export function isActorError(
  result: BotActor | NextResponse,
): result is NextResponse {
  return result instanceof NextResponse;
}

// Гейт использования бота по ролям (ADMIN/DIRECTOR/MANAGER, §4 — объединение:
// комбинированная роль с любой из них проходит). Возвращает ответ-ошибку или null.
export function requireBotManager(actor: BotActor): NextResponse | null {
  if (!hasAnyRole(actor.roles, MANAGER_ROLES)) {
    return NextResponse.json(
      {
        ok: false,
        error: "Бот доступен только менеджерам, администраторам и директорам",
      },
      { status: 403 },
    );
  }
  return null;
}

export function botAllowed(roles: Role[]): boolean {
  return hasAnyRole(roles, MANAGER_ROLES);
}
