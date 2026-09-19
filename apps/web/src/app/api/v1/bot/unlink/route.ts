import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";

import { authenticate, isErrorResponse } from "@/server/api/auth";

// DELETE /api/v1/bot/link — отвязка чата (команда /стоп в боте). Scope: write.
const schema = z.object({ chatId: z.string().min(1).max(64) });

export async function DELETE(request: Request) {
  const auth = await authenticate(request, "write");
  if (isErrorResponse(auth)) return auth;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Укажите chatId" }, { status: 400 });
  }

  const deleted = await prisma.telegramLink.deleteMany({
    where: { chatId: parsed.data.chatId },
  });
  return NextResponse.json({ ok: true, deleted: deleted.count });
}
