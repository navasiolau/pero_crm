import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";

import { authenticate, isErrorResponse } from "@/server/api/auth";
import { botAllowed } from "@/server/telegram/bot-api";

// POST /api/v1/bot/link — бот подтверждает привязку по одноразовому коду
// из профиля CRM: { code, chatId, username }. Доступно ЛЮБОЙ роли
// (решение владельца); использование бота ограничивается отдельно (session.botAllowed).
// Scope: write.
const schema = z.object({
  code: z.string().min(1),
  chatId: z.string().min(1).max(64),
  username: z.string().max(64).optional(),
});

export async function POST(request: Request) {
  const auth = await authenticate(request, "write");
  if (isErrorResponse(auth)) return auth;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Нужны code и chatId" }, { status: 400 });
  }
  const { code, chatId, username } = parsed.data;

  const link = await prisma.telegramLink.findUnique({
    where: { linkCode: code },
    include: { user: { select: { id: true, name: true, roles: true, active: true } } },
  });
  if (
    !link ||
    !link.linkCodeExpiresAt ||
    link.linkCodeExpiresAt.getTime() < Date.now()
  ) {
    return NextResponse.json(
      { ok: false, error: "Код не найден или истёк — запросите новый в профиле CRM" },
      { status: 400 },
    );
  }
  if (!link.user.active) {
    return NextResponse.json(
      { ok: false, error: "Пользователь неактивен" },
      { status: 403 },
    );
  }
  const taken = await prisma.telegramLink.findFirst({
    where: { chatId, NOT: { userId: link.userId } },
    select: { id: true },
  });
  if (taken) {
    return NextResponse.json(
      { ok: false, error: "Этот Telegram уже привязан к другой учётной записи" },
      { status: 400 },
    );
  }

  const updated = await prisma.telegramLink.update({
    where: { id: link.id },
    data: {
      chatId,
      username: username ?? null,
      linkedAt: new Date(),
      linkCode: null,
      linkCodeExpiresAt: null,
    },
  });

  return NextResponse.json({
    ok: true,
    user: {
      id: link.user.id,
      name: link.user.name,
      roles: link.user.roles,
      botAllowed: botAllowed(link.user.roles),
    },
    linkedAt: updated.linkedAt,
  });
}
