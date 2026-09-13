import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

import { authenticate, isErrorResponse } from "@/server/api/auth";
import { createProjectCore } from "@/server/projects/core";
import {
  domainError,
  isActorError,
  requireBotManager,
  resolveBotActor,
} from "@/server/telegram/bot-api";

// GET /api/v1/bot/projects?q=<поиск> — выборка проектов для бота
// (поиск по номеру/названию; офисные роли видят все, §4). Scope: read.
export async function GET(request: Request) {
  const auth = await authenticate(request, "read");
  if (isErrorResponse(auth)) return auth;
  const actor = await resolveBotActor(request);
  if (isActorError(actor)) return actor;
  const gate = requireBotManager(actor);
  if (gate) return gate;

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  const projects = await prisma.project.findMany({
    where: q
      ? {
          OR: [
            { number: { contains: q } },
            { title: { contains: q, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: { numberInt: "desc" },
    take: 8,
    select: { id: true, number: true, title: true, stage: true, currency: true },
  });
  return NextResponse.json({ ok: true, projects });
}

// POST /api/v1/bot/projects — создание проекта от имени пользователя бота.
// Логика и права (MANAGER_ROLES) — в ядре. Scope: write.
export async function POST(request: Request) {
  const auth = await authenticate(request, "write");
  if (isErrorResponse(auth)) return auth;
  const actor = await resolveBotActor(request);
  if (isActorError(actor)) return actor;
  const gate = requireBotManager(actor);
  if (gate) return gate;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "Пустой запрос" }, { status: 400 });
  }
  try {
    const result = await createProjectCore(actor, body);
    return NextResponse.json(result);
  } catch (e) {
    return domainError(e);
  }
}
