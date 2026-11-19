import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";

import { authenticate, isErrorResponse } from "@/server/api/auth";
import { botAllowed } from "@/server/telegram/bot-api";
import { confirmTelegramLinkInTransaction } from "@/server/telegram/mutation-core";

// POST /api/v1/bot/link — бот подтверждает привязку по одноразовому коду
// из профиля CRM: { code, chatId, username }. Доступно ЛЮБОЙ роли
// (решение владельца); использование бота ограничивается отдельно (session.botAllowed).
// Scope: write.
const schema = z.object({
  code: z.string().min(1),
  chatId: z.string().regex(/^[1-9]\d{0,15}$/),
  username: z.string().max(64).optional(),
});

export async function POST(request: Request) {
  const auth = await authenticate(request, "write");
  if (isErrorResponse(auth)) return auth;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Нужны code и chatId" }, { status: 400 });
  }
  const result = await prisma.$transaction(tx => confirmTelegramLinkInTransaction(tx, parsed.data));
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });

  return NextResponse.json({
    ok: true,
    user: {
      id: result.user.id,
      name: result.user.name,
      roles: result.user.roles,
      botAllowed: botAllowed(result.user.roles),
    },
    linkedAt: result.linkedAt,
  });
}
