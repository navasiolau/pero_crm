import {liveProjectWhere,liveProductWhere} from "@/server/access/live-entities";
import {activePaymentWhere} from '@/server/payments/active-records';
import { projectTotal as calculateProjectTotal } from "@/lib/product-quantity";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { displayClientName } from "@/lib/labels";

import { authenticate, isErrorResponse } from "@/server/api/auth";
import { projectPatchSchema } from "@/server/projects/patch-contract";
import { projectFullBaseline, patchProjectCore } from "@/server/projects/project-field-core";
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
    where: {...liveProjectWhere, id },
    include: {
      client: {
        select: { name: true, lastName: true, middleName: true, phone: true },
      },
      manager: { select: { name: true } },
      products: { where:liveProductWhere, select: { expectedPrice: true, quantity: true } },
    },
  });
  if (!project) {
    return NextResponse.json({ ok: false, error: "Проект не найден" }, { status: 404 });
  }

  // Сумма по проекту = Σ цен изделий + доставка/выгрузка/монтаж
  const totalExpected =
    calculateProjectTotal(project.products, project);

  let finance: { incomeByn: string; expenseByn: string } | null = null;
  if (hasAnyRole(actor.roles, FINANCE_ROLES)) {
    const groups = await prisma.payment.groupBy({
      by: ["direction"],
      where: { ...activePaymentWhere, projectId: id },
      _sum: { bynAmount: true },
    });
    finance = {
      incomeByn: (groups.find((g) => g.direction === "INCOME")?._sum.bynAmount ?? "0").toString(),
      expenseByn: (groups.find((g) => g.direction === "EXPENSE")?._sum.bynAmount ?? "0").toString(),
    };
  }

  return NextResponse.json({
    ok: true,
    project: {
      fullBaseline: projectFullBaseline(project),
      id: project.id,
      number: project.number,
      title: project.title,
      stage: project.stage,
      stageChangedAt: project.stageChangedAt,
      currency: project.currency,
      address: project.address,
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
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: "Пустой запрос" }, { status: 400 });
  }
  try {
    if ("field" in body || "clientMutationId" in body) {
      const parsed = projectPatchSchema.safeParse(body);
      if (!parsed.success) return NextResponse.json({ok:false,kind:"validation",error:"Некорректный запрос поля"},{status:400});
      if (parsed.data.projectId !== id) return NextResponse.json({ok:false,kind:"validation",error:"Проект запроса не совпадает с адресом"},{status:400});
      const result = await patchProjectCore(actor,parsed.data);
      return NextResponse.json({ok:result.kind === "saved",...result});
    }
    const result = await updateProjectCore(actor, id, body);
    return NextResponse.json(result);
  } catch (e) {
    return domainError(e);
  }
}
