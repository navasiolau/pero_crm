import { NextResponse } from "next/server";

import { authenticate, isErrorResponse } from "@/server/api/auth";
import { createPaymentCore } from "@/server/payments/service";
import {
  domainError,
  isActorError,
  requireBotFinance,
  resolveBotActor,
} from "@/server/telegram/bot-api";

// POST /api/v1/bot/payments — приход/расход по проекту от имени пользователя
// бота. Права FINANCE_ROLES, касса/статья/курс НБ РБ — в ядре (§11). Scope: write.
export async function POST(request: Request) {
  const auth = await authenticate(request, "write");
  if (isErrorResponse(auth)) return auth;
  const actor = await resolveBotActor(request);
  if (isActorError(actor)) return actor;
  const gate = requireBotFinance(actor);
  if (gate) return gate;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "Пустой запрос" }, { status: 400 });
  }
  try {
    const result = await createPaymentCore(actor, body);
    return NextResponse.json(result);
  } catch (e) {
    return domainError(e);
  }
}
