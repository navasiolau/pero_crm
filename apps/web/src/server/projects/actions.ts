"use server";

import { revalidatePath } from "next/cache";
import type { ProjectStage, Role } from "@prisma/client";
import { z } from "zod";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { formatAmount } from "@/lib/format";
import { stageLabels as STAGE_LABELS } from "@/lib/stages";
import { writeChangeLog } from "@/server/plugins/changelog";
import { emitDomainEvent } from "@/server/plugins/events";
import { notifyOrg, notifyPerson } from "@/server/notifications/notify";
import { getPayrollCurrency } from "@/server/payroll/queries";

import { MANAGER_ROLES } from "./queries";

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Не авторизован");
  return session;
}

function requireRoles(role: Role, roles: Role[]) {
  if (!roles.includes(role)) throw new Error("Недостаточно прав");
}

// Номер проекта — сплошная нумерация: следующий = max(numberInt) + 1
// (после миграции нормализации все номера каноничные числа, «205» —
// последний). Создание — в той же транзакции, чтобы два параллельных
// запроса не получили один номер.
async function createProjectWithNumber(
  data: {
    title: string;
    clientId: string;
    currency: string;
    address?: string;
    managerId?: string;
    engineerId?: string;
  },
  userId: string,
) {
  return prisma.$transaction(async (tx) => {
    const max = await tx.project.aggregate({ _max: { numberInt: true } });
    const numberInt = (max._max.numberInt ?? 0) + 1;
    const number = String(numberInt);
    const project = await tx.project.create({
      data: {
        // id = номер («205»): URL карточки — /projects/205
        id: number,
        number,
        numberInt,
        title: data.title,
        clientId: data.clientId,
        currency: data.currency,
        address: data.address,
        managerId: data.managerId,
        engineerId: data.engineerId,
        createdById: userId,
        stageHistory: {
          create: { toStage: "LEAD", changedById: userId },
        },
      },
    });
    return project;
  });
}

const createSchema = z.object({
  title: z.string().min(1, "Укажите название проекта"),
  clientId: z.string().min(1, "Выберите клиента"),
  currency: z.string().default("BYN"),
  address: z.string().optional(),
  managerId: z.string().optional(),
  engineerId: z.string().optional(),
});

// Проект = заказ клиента (§6): название, клиент, менеджер, инженер, адрес,
// валюта. Цены — на изделиях, создаются в карточке проекта.
export async function createProject(
  input: z.input<typeof createSchema>,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const session = await requireUser();
  requireRoles(session.user.role, MANAGER_ROLES);
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  }
  const data = parsed.data;

  const project = await createProjectWithNumber(
    {
      title: data.title,
      clientId: data.clientId,
      currency: data.currency,
      address: data.address,
      managerId: data.managerId,
      engineerId: data.engineerId,
    },
    session.user.id,
  );
  const number = project.number;

  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "project",
    entityId: project.id,
    action: "create",
    newValue: { number, title: data.title },
  });
  await emitDomainEvent("project.created", { projectId: project.id, number }, session.user.id);
  await notifyOrg({
    type: "project.created",
    title: `Новый проект ${number}`,
    body: data.title,
    link: `/projects/${project.id}`,
    exceptUserId: session.user.id,
  });

  revalidatePath("/projects");
  return { ok: true, id: project.id };
}

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  currency: z.string().optional(),
  address: z.string().nullable().optional(),
  managerId: z.string().nullable().optional(),
  engineerId: z.string().nullable().optional(),
  clientId: z.string().optional(),
});

// Редактирование карточки проекта (§4) — админ/директор/менеджер.
// (Тех. блок живёт на изделии — его правит и инженер, см. products/actions.)
export async function updateProject(
  projectId: string,
  input: z.infer<typeof updateSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireUser();
  requireRoles(session.user.role, MANAGER_ROLES);
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Ошибка данных" };
  const data = parsed.data;

  const before = await prisma.project.findUnique({ where: { id: projectId } });
  if (!before) return { ok: false, error: "Проект не найден" };

  await prisma.project.update({ where: { id: projectId }, data });

  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "project",
    entityId: projectId,
    action: "update",
    oldValue: Object.fromEntries(
      Object.keys(data).map((k) => [k, before[k as keyof typeof before]]),
    ),
    newValue: data,
  });
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
  return { ok: true };
}

// Смена этапа (§6): переходы свободные; для Отказа нужны причина+комментарий,
// для Рекламации — причина, описание, виновная сторона (§6.3, только из «Завершён»).
export async function changeProjectStage(
  projectId: string,
  toStage: ProjectStage,
  extras?: {
    refusalReason?: string;
    refusalComment?: string;
    reclamationReason?: string;
    reclamationDescription?: string;
    reclamationFault?: string;
  },
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireUser();
  requireRoles(session.user.role, MANAGER_ROLES);

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return { ok: false, error: "Проект не найден" };
  if (project.stage === toStage) return { ok: true };

  if (toStage === "REFUSED") {
    if (!extras?.refusalReason?.trim() || !extras?.refusalComment?.trim()) {
      return { ok: false, error: "Для отказа нужны причина и комментарий" };
    }
  }
  if (toStage === "RECLAMATION") {
    if (project.stage !== "DONE") {
      return { ok: false, error: "Рекламация открывается только из «Завершён»" };
    }
    if (
      !extras?.reclamationReason?.trim() ||
      !extras?.reclamationDescription?.trim() ||
      !extras?.reclamationFault?.trim()
    ) {
      return {
        ok: false,
        error: "Для рекламации нужны причина, описание и виновная сторона",
      };
    }
  }

  await prisma.$transaction([
    prisma.project.update({
      where: { id: projectId },
      data: {
        stage: toStage,
        stageChangedAt: new Date(),
        ...(toStage === "REFUSED"
          ? {
              refusalReason: extras!.refusalReason,
              refusalComment: extras!.refusalComment,
            }
          : {}),
        ...(toStage === "RECLAMATION"
          ? {
              reclamationReason: extras!.reclamationReason,
              reclamationDescription: extras!.reclamationDescription,
              reclamationFault: extras!.reclamationFault,
            }
          : {}),
      },
    }),
    prisma.projectStageHistory.create({
      data: {
        projectId,
        fromStage: project.stage,
        toStage,
        comment:
          toStage === "REFUSED"
            ? extras!.refusalReason
            : toStage === "RECLAMATION"
              ? extras!.reclamationReason
              : undefined,
        changedById: session.user.id,
      },
    }),
  ]);

  // Начисление «% от стоимости» инженеру (§10): этап начисления — передача
  // проекта в производство (первый переход «В работе»). Повторные переходы
  // (пауза, рекламация) не начисляют — запись одна на проект.
  // Стоимость проекта = Σ цен изделий на момент перехода.
  if (toStage === "IN_WORK" && project.engineerId) {
    const engineer = await prisma.user.findUnique({
      where: { id: project.engineerId },
      select: { name: true, payScheme: true, payPercent: true },
    });
    if (
      engineer?.payScheme === "PERCENT_PROJECT" &&
      engineer.payPercent &&
      Number(engineer.payPercent) > 0
    ) {
      const existing = await prisma.payrollEntry.findFirst({
        where: { projectId, scheme: "PERCENT_PROJECT" },
        select: { id: true },
      });
      if (!existing) {
        const priceAgg = await prisma.product.aggregate({
          where: { projectId },
          _sum: { expectedPrice: true },
        });
        const totalPrice = Number(priceAgg._sum.expectedPrice ?? 0);
        const percent = Number(engineer.payPercent);
        const amount = Math.round(((totalPrice * percent) / 100) * 100) / 100;
        if (amount > 0) {
          const currency = await getPayrollCurrency();
          await prisma.payrollEntry.create({
            data: {
              userId: project.engineerId,
              projectId,
              amount,
              currency,
              scheme: "PERCENT_PROJECT",
              month: new Date().toISOString().slice(0, 7),
              comment: `${percent}% от стоимости · ${project.number}`,
            },
          });
          await emitDomainEvent(
            "payroll.accrued",
            {
              userId: project.engineerId,
              scheme: "PERCENT_PROJECT",
              amount,
              projectId,
            },
            session.user.id,
          );
          await notifyPerson({
            userId: project.engineerId,
            type: "payroll.accrued",
            title: `Начислена зарплата: ${formatAmount(amount, currency)}`,
            body: `${percent}% от стоимости проекта ${project.number}`,
            link: "/payroll",
          });
          await notifyOrg({
            type: "payroll.orgAccrued",
            title: `Начислено ${engineer.name}: ${formatAmount(amount, currency)}`,
            body: `${percent}% от стоимости проекта ${project.number}`,
            link: "/finance/payroll",
            exceptUserId: session.user.id,
          });
        }
      }
    }
  }

  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "project",
    entityId: projectId,
    action: "stage",
    field: "stage",
    oldValue: project.stage,
    newValue: toStage,
  });
  await emitDomainEvent(
    "project.stageChanged",
    { projectId, number: project.number, from: project.stage, to: toStage },
    session.user.id,
  );
  await notifyOrg({
    type: "project.stageChanged",
    title: `${project.number}: ${STAGE_LABELS[project.stage]} → ${STAGE_LABELS[toStage]}`,
    body: project.title,
    link: `/projects/${projectId}`,
    exceptUserId: session.user.id,
  });

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
  return { ok: true };
}
