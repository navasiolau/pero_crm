import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticate, isErrorResponse } from "@/server/api/auth";
import { changeProjectStageCore } from "@/server/projects/core";
import {
  domainError,
  isActorError,
  requireBotManager,
  resolveBotActor,
} from "@/server/telegram/bot-api";

// POST /api/v1/bot/projects/:id/stage — смена этапа проекта (§6, свободные
// переходы; Отказ/Рекламация — с extras). Логика — в ядре. Scope: write.
const schema = z.object({
  toStage: z.enum([
    "LEAD",
    "ESTIMATE",
    "CONTRACT",
    "IN_WORK",
    "DONE",
    "REFUSED",
    "PAUSED",
    "RECLAMATION",
  ]),
  extras: z
    .object({
      refusalReason: z.string().optional(),
      refusalComment: z.string().optional(),
      reclamationReason: z.string().optional(),
      reclamationDescription: z.string().optional(),
      reclamationFault: z.string().optional(),
    })
    .optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticate(request, "write");
  if (isErrorResponse(auth)) return auth;
  const actor = await resolveBotActor(request);
  if (isActorError(actor)) return actor;
  const gate = requireBotManager(actor);
  if (gate) return gate;

  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Неверный этап" }, { status: 400 });
  }
  try {
    const result = await changeProjectStageCore(
      actor,
      id,
      parsed.data.toStage,
      parsed.data.extras,
    );
    return NextResponse.json(result);
  } catch (e) {
    return domainError(e);
  }
}
