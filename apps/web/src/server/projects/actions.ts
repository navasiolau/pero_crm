"use server";

import { revalidatePath } from "next/cache";
import type { ProjectStage, Role } from "@prisma/client";
import { z } from "zod";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { stageLabels as STAGE_LABELS } from "@/lib/stages";
import { writeChangeLog } from "@/server/plugins/changelog";
import { emitDomainEvent } from "@/server/plugins/events";
import { notifyOrg } from "@/server/notifications/notify";

import { MANAGER_ROLES } from "./queries";

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Не авторизован");
  return session;
}

function requireRoles(role: Role, roles: Role[]) {
  if (!roles.includes(role)) throw new Error("Недостаточно прав");
}

// Номер проекта: П-<год>-<порядковый в году>, генерация в транзакции.
async function nextProjectNumber(): Promise<string> {
  const year = new Date().getFullYear();
  return prisma.$transaction(async (tx) => {
    const count = await tx.project.count({
      where: { number: { startsWith: `П-${year}-` } },
    });
    return `П-${year}-${String(count + 1).padStart(3, "0")}`;
  });
}

const createSchema = z.object({
  title: z.string().min(1, "Укажите изделие/описание"),
  clientId: z.string().min(1, "Выберите клиента"),
  expectedPrice: z.number().nonnegative().optional(),
  currency: z.string().default("BYN"),
  address: z.string().optional(),
  description: z.string().optional(),
  managerId: z.string().optional(),
});

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

  const number = await nextProjectNumber();
  const project = await prisma.project.create({
    data: {
      number,
      title: data.title,
      clientId: data.clientId,
      expectedPrice: data.expectedPrice,
      currency: data.currency,
      address: data.address,
      description: data.description,
      managerId: data.managerId,
      createdById: session.user.id,
      stageHistory: {
        create: { toStage: "LEAD", changedById: session.user.id },
      },
    },
  });

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
  expectedPrice: z.number().nonnegative().nullable().optional(),
  currency: z.string().optional(),
  address: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  managerId: z.string().nullable().optional(),
  clientId: z.string().optional(),
});

// Редактирование карточки (§4): полностью — админ/директор/менеджер;
// инженер — только тех. блок (description).
export async function updateProject(
  projectId: string,
  input: z.infer<typeof updateSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireUser();
  const role = session.user.role;
  if (![...MANAGER_ROLES, "ENGINEER" as Role].includes(role)) {
    throw new Error("Недостаточно прав");
  }
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Ошибка данных" };
  const data = parsed.data;

  if (role === "ENGINEER") {
    const keys = Object.keys(data);
    if (keys.some((k) => k !== "description")) {
      return { ok: false, error: "Инженер правит только технический блок" };
    }
  }

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
