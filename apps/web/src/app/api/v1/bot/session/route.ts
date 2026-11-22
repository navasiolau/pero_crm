import { NextResponse } from "next/server";

import { authenticate, isErrorResponse } from "@/server/api/auth";
import { findActiveTelegramLink, telegramBindingVersion, telegramBotUser } from "@/server/telegram/access";

// GET /api/v1/bot/session?chatId=<telegram chat id> — кто привязан к чату.
// Scope: read. Непривязанный/неактивный пользователь → { found: false }
// (бот молча игнорирует непривязанные чаты).
export async function GET(request: Request) {
  const auth = await authenticate(request, "read");
  if (isErrorResponse(auth)) return auth;

  const chatId = new URL(request.url).searchParams.get("chatId");
  if (!chatId || !/^[1-9]\d{0,15}$/.test(chatId)) {
    return NextResponse.json({ ok: false, error: "Укажите chatId" }, { status: 400 });
  }

  const link = await findActiveTelegramLink({ chatId });
  if (!link) {
    return NextResponse.json({ ok: true, found: false });
  }
  return NextResponse.json({
    ok: true,
    found: true,
    binding: telegramBindingVersion(link.id, link.generation, link.user.sessionVersion),
    user: telegramBotUser(link.user),
  });
}
