import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

import { authenticate, isErrorResponse } from "@/server/api/auth";
import { botAllowed } from "@/server/telegram/bot-api";

// GET /api/v1/bot/session?chatId=<telegram chat id> — кто привязан к чату.
// Scope: read. Непривязанный/неактивный пользователь → { found: false }
// (бот молча игнорирует непривязанные чаты).
export async function GET(request: Request) {
  const auth = await authenticate(request, "read");
  if (isErrorResponse(auth)) return auth;

  const chatId = new URL(request.url).searchParams.get("chatId");
  if (!chatId) {
    return NextResponse.json({ ok: false, error: "Укажите chatId" }, { status: 400 });
  }

  const link = await prisma.telegramLink.findUnique({
    where: { chatId },
    include: {
      user: { select: { id: true, name: true, roles: true, active: true } },
    },
  });
  if (!link || !link.user.active) {
    return NextResponse.json({ ok: true, found: false });
  }
  return NextResponse.json({
    ok: true,
    found: true,
    user: {
      id: link.user.id,
      name: link.user.name,
      roles: link.user.roles,
      botAllowed: botAllowed(link.user.roles),
    },
  });
}
