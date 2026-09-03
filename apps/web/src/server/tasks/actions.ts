"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { formatAmount } from "@/lib/format";
import { writeChangeLog } from "@/server/plugins/changelog";
import { emitDomainEvent } from "@/server/plugins/events";
import { notifyOrg, notifyPerson } from "@/server/notifications/notify";

import { MANAGER_ROLES, OFFICE_ROLES, hasAnyRole } from "@/lib/roles";
import { revalidateProductPaths } from "@/server/products/revalidate";
import { getPayrollCurrency } from "@/server/payroll/queries";

const createSchema = z.object({
  projectId: z.string(),
  productId: z.string().optional(), // изделие проекта (необязательно)
  title: z.string().min(1, "Укажите название задачи"),
  // Тип и срок обязательны (без исполнителя — черновик, §4/§9)
  type: z.string().min(1, "Укажите тип задачи"),
  assigneeId: z.string().optional(),
  workId: z.string().optional(),
  quantity: z.number().positive().optional(), // часть работы; пусто — весь остаток
  dueAt: z.string().min(1, "Укажите срок"),
  // Оценка: можно задать сразу; без неё — среднее из истории идентичных
  estimateMinutes: z.number().int().min(0).optional(),
  requiresPhoto: z.boolean().default(false),
  dependencyIds: z.array(z.string()).default([]),
});

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Не авторизован");
  return session;
}

// Работа делится между задачами по количеству (§9: расценка × количество ×
// доля исполнителя). Проверка: сумма частей по задачам не превышает
// количество работы. Возвращает остаток при успехе, иначе текст ошибки.
async function checkWorkQuantity(
  workId: string,
  quantity: number | null,
  excludeTaskId?: string,
): Promise<{ error?: string; remaining?: number }> {
  const work = await prisma.work.findUnique({
    where: { id: workId },
    include: { tasks: { select: { id: true, title: true, quantity: true } } },
  });
  if (!work) return { error: "Работа не найдена" };
  const used = work.tasks
    .filter((task) => task.id !== excludeTaskId)
    .reduce((sum, task) => sum + Number(task.quantity ?? 0), 0);
  const remaining = Number(work.quantity) - used;
  const qty = quantity ?? remaining; // пусто → забрать весь остаток
  if (qty <= 0) return { error: "Количество должно быть больше нуля" };
  if (qty > remaining) {
    return {
      error: `В работе осталось ${remaining} из ${work.quantity} — больше распределить нельзя`,
    };
  }
  return { remaining: qty };
}

// Оценка времени (§9): среднее фактическое время идентичных задач
// (тот же тип) из истории организации; пока истории нет — null.
async function estimateFromHistory(type: string): Promise<number | null> {
  const rows = await prisma.$queryRaw<{ avg: number | null }[]>`
    SELECT AVG(s.m)::float AS avg FROM (
      SELECT SUM(te."minutes") AS m
      FROM "TimeEntry" te
      JOIN "Task" t ON t.id = te."taskId"
      WHERE t.type = ${type} AND t.status = 'DONE' AND te."stoppedAt" IS NOT NULL
      GROUP BY t.id
    ) s`;
  const avg = rows[0]?.avg;
  return avg && avg > 0 ? Math.round(avg) : null;
}

// Создание задачи — админ/директор/менеджер (§4).
export async function createTask(
  input: z.input<typeof createSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireUser();
  if (!hasAnyRole(session.user.roles, MANAGER_ROLES)) {
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

  // Изделие должно принадлежать проекту задачи
  if (data.productId) {
    const product = await prisma.product.findFirst({
      where: { id: data.productId, projectId: data.projectId },
      select: { id: true },
    });
    if (!product) return { ok: false, error: "Изделие не найдено в этом проекте" };
  }

  const estimateMinutes =
    data.estimateMinutes ?? (await estimateFromHistory(data.type)) ?? null;
  // Оценка времени обязательна для любой задачи (§9)
  if (!estimateMinutes) {
    return {
      ok: false,
      error: "Укажите оценку времени (мин) — истории по таким задачам нет",
    };
  }

  let workQuantity: number | null = null;
  if (data.workId) {
    const check = await checkWorkQuantity(data.workId, data.quantity ?? null);
    if (check.error) return { ok: false, error: check.error };
    workQuantity = check.remaining!;
  }

  const task = await prisma.task.create({
    data: {
      projectId: data.projectId,
      productId: data.productId || null,
      title: data.title,
      type: data.type,
      assigneeId: data.assigneeId || null,
      workId: data.workId || null,
      quantity: workQuantity,
      status: data.assigneeId ? "NEW" : "DRAFT",
      dueAt: data.dueAt ? new Date(data.dueAt) : null,
      requiresPhoto: data.requiresPhoto,
      estimateMinutes,
      createdById: session.user.id,
      dependencies: {
        create: data.dependencyIds.map((dependsOnId) => ({ dependsOnId })),
      },
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
  await revalidateProductPaths(data.productId);
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
  productId: z.string().nullable().optional(), // изделие проекта (можно очистить)
  workId: z.string().nullable().optional(),
  quantity: z.number().positive().nullable().optional(),
  dueAt: z.string().min(1, "Укажите срок").optional(),
  estimateMinutes: z.number().int().min(0).nullable().optional(),
  dependencyIds: z.array(z.string()).optional(),
});

// Редактирование задачи — админ/директор/менеджер (§4).
// Закрытая (выполненная) задача — только просмотр, правок не принимаем.
// Назначение исполнителя черновику переводит его в «Новая» и шлёт уведомление.
// Оценку времени менеджер правит в любой момент, пока задача не закрыта (§9).
export async function updateTask(
  taskId: string,
  input: z.infer<typeof updateSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireUser();
  if (!hasAnyRole(session.user.roles, MANAGER_ROLES)) {
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

  // Изделие должно принадлежать проекту задачи
  if (data.productId) {
    const product = await prisma.product.findFirst({
      where: { id: data.productId, projectId: task.project.id },
      select: { id: true },
    });
    if (!product) return { ok: false, error: "Изделие не найдено в этом проекте" };
  }

  const becameAssigned =
    data.assigneeId && data.assigneeId !== task.assigneeId;
  const newStatus =
    task.status === "DRAFT" && data.assigneeId ? "NEW" : task.status;

  const newWorkId =
    data.workId === undefined ? task.workId : data.workId;
  let quantityValue: number | null | undefined = undefined;
  if (data.workId !== undefined || data.quantity !== undefined) {
    if (newWorkId) {
      const check = await checkWorkQuantity(
        newWorkId,
        data.quantity ?? (task.quantity ? Number(task.quantity) : null),
        taskId,
      );
      if (check.error) return { ok: false, error: check.error };
      quantityValue = check.remaining!;
    } else {
      quantityValue = null;
    }
  }

  await prisma.task.update({
    where: { id: taskId },
    data: {
      title: data.title,
      type: data.type,
      assigneeId: data.assigneeId === undefined ? undefined : data.assigneeId,
      productId: data.productId === undefined ? undefined : data.productId,
      workId: data.workId === undefined ? undefined : data.workId,
      quantity: quantityValue,
      dueAt: data.dueAt ? new Date(data.dueAt) : undefined,
      estimateMinutes:
        data.estimateMinutes === undefined ? undefined : data.estimateMinutes,
      status: newStatus,
    },
  });

  // Зависимости (DAG, §9): заменяем список, без самоссылок и циклов
  if (data.dependencyIds !== undefined) {
    const next = data.dependencyIds.filter((id) => id !== taskId);
    if (await hasCycle(taskId, next)) {
      return { ok: false, error: "Зависимость образует цикл" };
    }
    await prisma.$transaction([
      prisma.taskDependency.deleteMany({ where: { taskId } }),
      prisma.taskDependency.createMany({
        data: next.map((dependsOnId) => ({ taskId, dependsOnId })),
      }),
    ]);
  }

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
  await revalidateProductPaths(task.productId);
  await revalidateProductPaths(data.productId);
  revalidatePath("/tasks");
  revalidatePath("/my");
  return { ok: true };
}

// Проверка цикла: идём от новых предшественников по зависимостям —
// если добрались до самой задачи, цикл есть.
async function hasCycle(taskId: string, dependencyIds: string[]) {
  const seen = new Set<string>();
  const queue = [...dependencyIds];
  while (queue.length > 0) {
    const current = queue.pop()!;
    if (current === taskId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    const next = await prisma.taskDependency.findMany({
      where: { taskId: current },
      select: { dependsOnId: true },
    });
    queue.push(...next.map((edge) => edge.dependsOnId));
  }
  return false;
}

// Смена статуса задачи (§4, §9): сам исполнитель — свои; любые — админ/директор/менеджер.
// Для requiresPhoto-задачи (замер, §6.2) при «Выполнена» нужен хотя бы один файл.
// Задача блокируется, пока предшественники не выполнены (§9).
// Начисление денег — при «Выполнена» (сдельная схема: работа × доля исполнителя).
// ТАЙМЕР АВТОМАТИЧЕСКИ (требование владельца, защита от обмана): переход
// «В работе» запускает таймер исполнителя, «Выполнена» — останавливает.
// ФАКТИЧЕСКОЕ ВРЕМЯ при «Выполнена» обязательно: таймер (все роли) или
// ручной ввод — но работнику/монтажнику ручной ввод закрыт: нет записей →
// ошибка с подсказкой взять задачу в работу; правку вносит менеджер (§19).

// Автостарт таймера при «В работе»: прежний активный таймер исполнителя
// останавливаем (один таймер на пользователя), по этой задаче — создаём,
// если ещё не запущен вручную.
async function autoStartTimer(taskId: string, assigneeId: string) {
  const existing = await prisma.timeEntry.findFirst({
    where: { taskId, userId: assigneeId, stoppedAt: null },
    select: { id: true },
  });
  if (existing) return;
  await prisma.timeEntry.updateMany({
    where: { userId: assigneeId, stoppedAt: null },
    data: { stoppedAt: new Date() },
  });
  await prisma.$executeRaw`
    UPDATE "TimeEntry" SET "minutes" = GREATEST(1, FLOOR(EXTRACT(EPOCH FROM ("stoppedAt" - "startedAt")) / 60)::int)
    WHERE "userId" = ${assigneeId} AND "stoppedAt" IS NOT NULL AND "minutes" = 0
  `;
  await prisma.timeEntry.create({
    data: { taskId, userId: assigneeId, source: "timer" },
  });
}

// Автостоп таймера задачи при «Выполнена» — пишет фактические минуты.
async function autoStopTimer(taskId: string) {
  await prisma.timeEntry.updateMany({
    where: { taskId, stoppedAt: null },
    data: { stoppedAt: new Date() },
  });
  await prisma.$executeRaw`
    UPDATE "TimeEntry" SET "minutes" = GREATEST(1, FLOOR(EXTRACT(EPOCH FROM ("stoppedAt" - "startedAt")) / 60)::int)
    WHERE "taskId" = ${taskId} AND "stoppedAt" IS NOT NULL AND "minutes" = 0
  `;
}

export async function changeTaskStatus(
  taskId: string,
  toStatus: "IN_PROGRESS" | "DONE",
  actualMinutes?: number,
): Promise<{ ok: boolean; error?: string; timeRequired?: boolean }> {
  const session = await requireUser();
  const roles = session.user.roles;
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      project: { select: { id: true, number: true } },
      product: { select: { id: true, number: true } },
      files: { select: { id: true } },
      work: { select: { id: true, total: true } },
      dependencies: {
        include: { dependsOn: { select: { id: true, title: true, status: true } } },
      },
    },
  });
  if (!task) return { ok: false, error: "Задача не найдена" };

  const isAssignee = task.assigneeId === session.user.id;
  if (!isAssignee && !hasAnyRole(roles, MANAGER_ROLES)) {
    return { ok: false, error: "Недостаточно прав" };
  }
  if (!(STAGE_FLOW[task.status] ?? []).includes(toStatus)) {
    return { ok: false, error: "Недопустимый переход статуса" };
  }
  // Блокировка зависимостями (§9): предшественники должны быть выполнены
  const blockers = task.dependencies.filter((edge) => edge.dependsOn.status !== "DONE");
  if (blockers.length > 0) {
    return {
      ok: false,
      error: `Задача заблокирована — сначала выполните: ${blockers
        .map((edge) => `«${edge.dependsOn.title}»`)
        .join(", ")}`,
    };
  }
  if (toStatus === "DONE" && task.requiresPhoto && task.files.length === 0) {
    return {
      ok: false,
      error: "Приложите файлы (фото/замерный лист) перед выполнением",
    };
  }

  // Автостарт таймера при переходе «В работе» (исполнителя, не нажавшего)
  if (toStatus === "IN_PROGRESS" && task.assigneeId) {
    await autoStartTimer(task.id, task.assigneeId);
  }

  // Обязательное фактическое время при «Выполнена»
  if (toStatus === "DONE") {
    // Автостоп таймера задачи — его минуты и есть факт
    await autoStopTimer(taskId);
    const spent = await prisma.timeEntry.aggregate({
      where: { taskId, stoppedAt: { not: null } },
      _sum: { minutes: true },
    });
    const recorded = spent._sum.minutes ?? 0;
    if (recorded === 0) {
      // Работнику/монтажнику ручной ввод закрыт — только таймер
      if (!hasAnyRole(roles, OFFICE_ROLES)) {
        return {
          ok: false,
          error:
            "Нет записей времени. Возьмите задачу «В работу» — время посчитается таймером автоматически",
        };
      }
      if (!actualMinutes || actualMinutes < 1) {
        // UI по этому флагу показывает форму ввода фактического времени
        return { ok: false, error: "Укажите фактическое время (мин)", timeRequired: true };
      }
      await prisma.timeEntry.create({
        data: {
          taskId,
          userId: task.assigneeId ?? session.user.id,
          source: "manual",
          stoppedAt: new Date(),
          minutes: actualMinutes,
        },
      });
      await writeChangeLog({
        actorType: "user",
        actorId: session.user.id,
        actorName: session.user.name ?? undefined,
        entity: "task",
        entityId: taskId,
        action: "time",
        newValue: { actual: actualMinutes },
      });
    }
  }

  const doneAt = toStatus === "DONE" ? new Date() : null;
  await prisma.task.update({
    where: { id: taskId },
    data: {
      status: toStatus,
      ...(doneAt ? { doneAt, doneById: session.user.id } : {}),
    },
  });

  // Начисление сдельной оплаты при «Выполнена» (§9):
  // цена-снимок работы × количество задачи × доля исполнителя.
  if (doneAt && task.assigneeId && task.work) {
    const assignee = await prisma.user.findUnique({
      where: { id: task.assigneeId },
      select: { name: true, payScheme: true },
    });
    if (assignee?.payScheme === "PIECE") {
      const qty = task.quantity ? Number(task.quantity) : 1;
      const workRow = await prisma.work.findUnique({
        where: { id: task.work.id },
        select: { priceSnapshot: true },
      });
      const amount = Number(workRow?.priceSnapshot ?? 0) * qty * Number(task.executorShare);
      if (amount > 0) {
        const currency = await getPayrollCurrency();
        await prisma.payrollEntry.create({
          data: {
            userId: task.assigneeId,
            taskId: task.id,
            workId: task.work.id,
            projectId: task.project.id,
            amount,
            currency,
            scheme: "PIECE",
            month: doneAt.toISOString().slice(0, 7),
            comment: `${task.title} · ${task.project.number}`,
          },
        });
        // ЗП-событие для финансовых ролей (админ/директор/бухгалтер)
        await notifyOrg({
          type: "payroll.orgAccrued",
          title: `Начислено ${assignee.name}: ${formatAmount(amount, currency)}`,
          body: `Сдельно · ${task.title} · ${task.project.number}`,
          link: "/finance/payroll",
          exceptUserId: session.user.id,
        });
      }
    }
  }

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
    link: task.product ? `/products/${task.product.number}` : `/projects/${task.project.id}`,
    exceptUserId: session.user.id,
  });

  revalidatePath(`/projects/${task.project.id}`);
  if (task.product) await revalidateProductPaths(task.product.id);
  revalidatePath("/my");
  return { ok: true };
}

function projectLabel(number: string) {
  return `Проект ${number}`;
}

// Удаление задачи — админ/директор/менеджер (§4).
// Выполненную удалять нельзя: там начисления, время и история.
// Файлы остаются в проекте (отвязываются), время и зависимости удаляются с ней.
export async function deleteTask(
  taskId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireUser();
  if (!hasAnyRole(session.user.roles, MANAGER_ROLES)) {
    throw new Error("Недостаточно прав");
  }
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { project: { select: { id: true, number: true } } },
  });
  if (!task) return { ok: false, error: "Задача не найдена" };
  if (task.status === "DONE") {
    return {
      ok: false,
      error: "Выполненную задачу удалить нельзя — там начисления и история",
    };
  }

  await prisma.$transaction([
    prisma.taskDependency.deleteMany({
      where: { OR: [{ taskId }, { dependsOnId: taskId }] },
    }),
    prisma.timeEntry.deleteMany({ where: { taskId } }),
    prisma.file.updateMany({ where: { taskId }, data: { taskId: null } }),
    prisma.task.delete({ where: { id: taskId } }),
  ]);

  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "task",
    entityId: taskId,
    action: "delete",
    oldValue: { title: task.title, project: task.project.number },
  });
  revalidatePath(`/projects/${task.project.id}`);
  await revalidateProductPaths(task.productId);
  revalidatePath("/tasks");
  revalidatePath("/my");
  return { ok: true };
}
