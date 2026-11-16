import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";

import { authenticate, isErrorResponse } from "@/server/api/auth";
import { registerTelegramBotInTransaction } from "@/server/telegram/mutation-core";

// POST /api/v1/bot/register — бот при старте сообщает свой @username.
// Нужен CRM профилю, чтобы собрать ссылку привязки t.me/<bot>?start=<код>.
// Scope: write. Входящие: { username }.
const schema = z.object({ username: z.string().min(1).max(64) });

export async function POST(request: Request) {
  const auth = await authenticate(request, "write");
  if (isErrorResponse(auth)) return auth;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Укажите username" }, { status: 400 });
  }

  await prisma.$transaction(tx => registerTelegramBotInTransaction(tx, parsed.data.username));
  return NextResponse.json({ ok: true });
}
