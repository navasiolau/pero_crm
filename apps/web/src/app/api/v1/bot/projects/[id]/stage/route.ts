import { NextResponse } from "next/server";
import {projectStagePatchSchema} from "@/server/projects/stage-contract";

import { authenticate, isErrorResponse } from "@/server/api/auth";
import {patchProjectStageCore} from "@/server/projects/stage-service";
import {
  domainError,
  isActorError,
  requireBotManager,
  resolveBotActor,
} from "@/server/telegram/bot-api";

// POST /api/v1/bot/projects/:id/stage — смена этапа проекта (§6, свободные
// переходы; Отказ/Рекламация — с extras). Логика — в ядре. Scope: write.
const schema = projectStagePatchSchema.omit({projectId:true});

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
    return NextResponse.json({ ok: false, error: "Неверный статус" }, { status: 400 });
  }
  try {
    const result = await patchProjectStageCore(actor,{projectId:id,...parsed.data});
    return NextResponse.json(result);
  } catch (e) {
    return domainError(e);
  }
}
