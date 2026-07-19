"use server";

import { revalidatePath } from "next/cache";
import type { Role } from "@prisma/client";
import { z } from "zod";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeChangeLog } from "@/server/plugins/changelog";
import { emitDomainEvent } from "@/server/plugins/events";
import { notifyOrg, notifyPerson } from "@/server/notifications/notify";

import { MANAGER_ROLES } from "@/server/projects/queries";

const createSchema = z.object({
  projectId: z.string(),
  title: z.string().min(1, "Укажите название задачи"),
  // Тип и срок обязательны (без исполнителя — черновик, §4/§9)
  type: z.string().min(1, "Укажите тип задачи"),
  assigneeId: z.string().optional(),
  dueAt: z.string().min(1, "Укажите срок"),
  requiresPhoto: z.boolean().default(false),
});

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Не авторизован");
  return session;
}

// Создание задачи — админ/директор/менеджер (§4).
export async function createTask(
  input: z.infer<typeof createSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireUser();
  if (!MANAGER_ROLES.includes(session.user.role)) {
    throw new Error("Недостаточно прав");
  }
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  }
  const data = parsed.data;
  const project = await prisma.project.findUnique({
    where: { id: data.projectId },
    select: { id: true, number: true },
  });
  if (!project) return { ok: false, error: "Проект не найден" };

  const task = await prisma.task.create({
    data: {
      projectId: data.projectId,
      title: data.title,
      type: data.type,
      assigneeId: data.assigneeId || null,
      status: data.assigneeId ? "NEW" : "DRAFT",
      dueAt: data.dueAt ? new Date(data.dueAt) : null,
      requiresPhoto: data.requiresPhoto,
      createdById: session.user.id,
    },
  });

  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "task",
    entityId: task.id,
    action: "create",
    newValue: { title: task.title, project: project.number },
  });
  if (task.assigneeId) {
    await emitDomainEvent(
      "task.assigned",
      { taskId: task.id, projectId: project.id, assigneeId: task.assigneeId },
      session.user.id,
    );
    await notifyPerson({
      userId: task.assigneeId,
      type: "task.assigned",
      title: `Вам назначена задача: ${task.title}`,
      body: `Проект ${project.number}`,
      link: "/my",
    });
  }
  revalidatePath(`/projects/${data.projectId}`);
  revalidatePath("/my");
  return { ok: true };
}

const STAGE_FLOW: Record<string, string[]> = {
  NEW: ["IN_PROGRESS", "DONE"],
  IN_PROGRESS: ["DONE"],
};

const updateSchema = z.object({
  title: z.string().min(1, "Укажите название задачи").optional(),
  type: z.string().min(1, "Укажите тип задачи").optional(),
  assigneeId: z.string().nullable().optional(),
  dueAt: z.string().min(1, "Укажите срок").optional(),
});

// Редактирование задачи — админ/директор/менеджер (§4).
// Закрытая (выполненная) задача — только просмотр, правок не принимаем.
// Назначение исполнителя черновику переводит его в «Новая» и шлёт уведомление.
export async function updateTask(
  taskId: string,
  input: z.infer<typeof updateSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireUser();
  if (!MANAGER_ROLES.includes(session.user.role)) {
    throw new Error("Недостаточно прав");
  }
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  }
  const data = parsed.data;

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { project: { select: { id: true, number: true } } },
  });
  if (!task) return { ok: false, error: "Задача не найдена" };
  if (task.status === "DONE") {
    return { ok: false, error: "Выполненная задача — только просмотр" };
  }

  const becameAssigned =
    data.assigneeId && data.assigneeId !== task.assigneeId;
  const newStatus =
    task.status === "DRAFT" && data.assigneeId ? "NEW" : task.status;

  await prisma.task.update({
    where: { id: taskId },
    data: {
      title: data.title,
      type: data.type,
      assigneeId: data.assigneeId === undefined ? undefined : data.assigneeId,
      dueAt: data.dueAt ? new Date(data.dueAt) : undefined,
      status: newStatus,
    },
  });

  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "task",
    entityId: taskId,
    action: "update",
    oldValue: {
      title: task.title,
      type: task.type,
      assigneeId: task.assigneeId,
      dueAt: task.dueAt,
      status: task.status,
    },
    newValue: { ...data, status: newStatus },
  });

  if (becameAssigned && data.assigneeId) {
    await emitDomainEvent(
      "task.assigned",
      { taskId, projectId: task.project.id, assigneeId: data.assigneeId },
      session.user.id,
    );
    await notifyPerson({
      userId: data.assigneeId,
      type: "task.assigned",
      title: `Вам назначена задача: ${data.title ?? task.title}`,
      body: `Проект ${task.project.number}`,
      link: "/my",
    });
  }

  revalidatePath(`/projects/${task.project.id}`);
  revalidatePath("/tasks");
  revalidatePath("/my");
  return { ok: true };
}

// Смена статуса задачи (§4, §9): сам исполнитель — свои; любые — админ/директор/менеджер.
// Для requiresPhoto-задачи (замер, §6.2) при «Выполнена» нужен хотя бы один файл.
export async function changeTaskStatus(
  taskId: string,
  toStatus: "IN_PROGRESS" | "DONE",
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireUser();
  const role: Role = session.user.role;
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      project: { select: { id: true, number: true } },
      files: { select: { id: true } },
    },
  });
  if (!task) return { ok: false, error: "Задача не найдена" };

  const isAssignee = task.assigneeId === session.user.id;
  if (!isAssignee && !MANAGER_ROLES.includes(role)) {
    return { ok: false, error: "Недостаточно прав" };
  }
  if (!(STAGE_FLOW[task.status] ?? []).includes(toStatus)) {
    return { ok: false, error: "Недопустимый переход статуса" };
  }
  if (toStatus === "DONE" && task.requiresPhoto && task.files.length === 0) {
    return {
      ok: false,
      error: "Приложите файлы (фото/замерный лист) перед выполнением",
    };
  }

  await prisma.task.update({
    where: { id: taskId },
    data: {
      status: toStatus,
      ...(toStatus === "DONE"
        ? { doneAt: new Date(), doneById: session.user.id }
        : {}),
    },
  });

  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "task",
    entityId: taskId,
    action: "status",
    field: "status",
    oldValue: task.status,
    newValue: toStatus,
  });
  await emitDomainEvent(
    "task.statusChanged",
    { taskId, projectId: task.project.id, from: task.status, to: toStatus },
    session.user.id,
  );
  if (task.assigneeId && !isAssignee) {
    await notifyPerson({
      userId: task.assigneeId,
      type: "task.statusChanged",
      title: `Задача «${task.title}»: ${toStatus === "DONE" ? "выполнена" : "в работе"}`,
      body: `Проект ${task.project.number}`,
      link: "/my",
    });
  }
  await notifyOrg({
    type: "task.statusChanged",
    title: `Задача «${task.title}»: ${toStatus === "DONE" ? "выполнена" : "в работе"}`,
    body: `${projectLabel(task.project.number)} · ${session.user.name ?? ""}`,
    link: `/projects/${task.project.id}`,
    exceptUserId: session.user.id,
  });

  revalidatePath(`/projects/${task.project.id}`);
  revalidatePath("/my");
  return { ok: true };
}

function projectLabel(number: string) {
  return `Проект ${number}`;
}
