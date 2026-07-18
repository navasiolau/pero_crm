import { NextResponse } from "next/server";

import { authenticate, isErrorResponse } from "@/server/api/auth";
import { dispatchPendingEvents } from "@/server/plugins/events";

// POST /api/v1/events/dispatch — повторная доставка необработанных событий.
// Точка для cron-вызова. Scope: write.
export async function POST(request: Request) {
  const auth = await authenticate(request, "write");
  if (isErrorResponse(auth)) return auth;

  const count = await dispatchPendingEvents();
  return NextResponse.json({ ok: true, dispatched: count });
}
