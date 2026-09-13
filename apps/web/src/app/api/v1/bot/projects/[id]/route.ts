import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { displayClientName } from "@/lib/labels";

import { authenticate, isErrorResponse } from "@/server/api/auth";
import { updateProjectCore } from "@/server/projects/core";
import { FINANCE_ROLES, hasAnyRole } from "@/lib/roles";
import {
  domainError,
  isActorError,
  requireBotManager,
  resolveBotActor,
} from "@/server/telegram/bot-api";

// GET /api/v1/bot/projects/:id — карточка проекта для бота. Финансовые
// суммы (оплачено/расходы, BYN-эквиваленты §11) — только FINANCE_ROLES.
// Scope: read.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticate(request, "read");
  if (isErrorResponse(auth)) return auth;
  const actor = await resolveBotActor(request);
  if (isActorError(actor)) return actor;
  const gate = requireBotManager(actor);
  if (gate) return gate;

  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      client: {
        select: { name: true, lastName: true, middleName: true, phone: true },
      },
      manager: { select: { name: true } },
      products: { select: { expectedPrice: true } },
    },
  });
  if (!project) {
    return NextResponse.json({ ok: false, error: "Проект не найден" }, { status: 404 });
  }

  const totalExpected = project.products.reduce(
    (sum, product) => sum + Number(product.expectedPrice ?? 0),
    0,
  );

  let finance: { incomeByn: number; expenseByn: number } | null = null;
  if (hasAnyRole(actor.roles, FINANCE_ROLES)) {
    const groups = await prisma.payment.groupBy({
      by: ["direction"],
      where: { projectId: id },
      _sum: { bynAmount: true },
    });
    finance = {
      incomeByn: Number(
        groups.find((g) => g.direction === "INCOME")?._sum.bynAmount ?? 0,
      ),
      expenseByn: Number(
        groups.find((g) => g.direction === "EXPENSE")?._sum.bynAmount ?? 0,
      ),
    };
  }

  return NextResponse.json({
    ok: true,
    project: {
      id: project.id,
      number: project.number,
      title: project.title,
      stage: project.stage,
      stageChangedAt: project.stageChangedAt,
      currency: project.currency,
      address: project.address,
      initialPrice: project.initialPrice === null ? null : Number(project.initialPrice),
      client: displayClientName(project.client),
      clientPhone: project.client.phone,
      managerName: project.manager?.name ?? null,
      productsCount: project.products.length,
      totalExpected,
    },
    finance,
  });
}

// PATCH /api/v1/bot/projects/:id — правка реквизитов проекта
// (название/адрес/менеджер/клиент/валюта/первоначальная цена). Scope: write.
export async function PATCH(
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
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "Пустой запрос" }, { status: 400 });
  }
  try {
    const result = await updateProjectCore(actor, id, body);
    return NextResponse.json(result);
  } catch (e) {
    return domainError(e);
  }
}
