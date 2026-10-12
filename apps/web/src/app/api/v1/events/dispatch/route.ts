import { NextResponse } from "next/server";
import { authenticate, isErrorResponse } from "@/server/api/auth";
import { dispatchPendingEvents, readEventQueueStats } from "@/server/plugins/events";
import { domainEventWorkerStatus } from "@/server/plugins/event-worker";

const privateHeaders = { "Cache-Control": "private, no-store", "Vary": "Authorization" };

export async function POST(request: Request) {
  const auth = await authenticate(request, "write");
  if (isErrorResponse(auth)) return auth;
  const count = await dispatchPendingEvents();
  return NextResponse.json({ ok: true, dispatched: count }, { headers: privateHeaders });
}

/** Диагностика не раскрывает события, payload, actor или lease tokens. */
export async function GET(request: Request) {
  const auth = await authenticate(request, "write");
  if (isErrorResponse(auth)) return auth;
  try {
    const worker = domainEventWorkerStatus(), queue = await readEventQueueStats();
    return NextResponse.json({ ok: true, queue, worker }, { headers: privateHeaders });
  } catch {
    return NextResponse.json({ ok: false, error: "Очередь событий временно недоступна" }, { status: 503, headers: privateHeaders });
  }
}