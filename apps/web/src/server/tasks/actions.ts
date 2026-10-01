"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";

import { assertProjectMoneyCurrency } from "@/lib/internal-currency";
import { auth } from "@/auth";
import { formatAmount } from "@/lib/format";
import { allocatedWorkQuantity, quantityAtoms, quantityFromAtoms } from "@/lib/work-shares";
import { writeChangeLog } from "@/server/plugins/changelog";
import { dispatchEvent, emitDomainEvent } from "@/server/plugins/events";
import { notifyOrg, notifyPerson } from "@/server/notifications/notify";

import { MANAGER_ROLES, hasAnyRole } from "@/lib/roles";
import { revalidateProductPaths } from "@/server/products/revalidate";
import { withTaskTransaction } from "./transaction";
import { changeTaskStatusCore, stopTaskTimers } from "./completion-core";
import { engineeringRecipientError, taskRecipientError } from "./share-policy";
import { bumpEngineeringPoolRevision } from "@/server/product-stage-pay/core";

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
  tx: Prisma.TransactionClient,
  workId: string,
  quantity: number | null,
  excludeTaskId?: string,
  context?: { projectId: string; productId: string | null },
): Promise<{ error?: string; remaining?: string }> {
  const work = await tx.work.findUnique({
    where: { id: workId },
    include: { tasks: { select: { id: true, quantity: true, allocationGroupId: true } } },
  });
  if (!work) return { error: "Работа не найдена" };
  if (context && (work.projectId !== context.projectId || work.productId !== context.productId)) return { error: "Выберите работу этого проекта и изделия" };
  const used = quantityAtoms(allocatedWorkQuantity(work.tasks.filter((task) => task.id !== excludeTaskId)));
  const remaining = quantityAtoms(work.quantity) - used;
  let qty: bigint;
  try { qty = quantity === null ? remaining : quantityAtoms(quantity); }
  catch { return { error: "Количество должно содержать не больше двух знаков после запятой" }; }
  if (qty <= BigInt(0)) return { error: "Количество должно быть больше нуля" };
  if (qty > remaining) {
    return {
      error: `В работе осталось ${quantityFromAtoms(remaining)} из ${work.quantity} — больше распределить нельзя`,
    };
  }
  return { remaining: quantityFromAtoms(qty) };
}

// Оценка времени (§9): среднее фактическое время идентичных задач
// (тот же тип) из истории организации; пока истории нет — null.
async function estimateFromHistory(tx: Prisma.TransactionClient, type: string): Promise<number | null> {
  const rows = await tx.$queryRaw<{ avg: number | null }[]>`
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
  const mutation = await withTaskTransaction(async (tx) => {
  const project = await tx.project.findUnique({
    where: { id: data.projectId },
    select: { id: true, number: true, currency: true },
  });
  if (!project) return { ok: false as const, error: "Проект не найден" };

  // Изделие должно принадлежать проекту задачи
  const product = data.productId ? await tx.product.findFirst({
      where: { id: data.productId, projectId: data.projectId },
      select: { id: true, engineerId: true, status: true },
    }) : null;
  if (data.productId && !product) return { ok: false as const, error: "Изделие не найдено в этом проекте" };
  if (data.assigneeId) {
    const assignee = await tx.user.findUnique({ where: { id: data.assigneeId }, select: { id: true, roles: true, active: true } });
    const error = assignee ? taskRecipientError(assignee, product) : "Сотрудник не найден";
    if (error) return { ok: false as const, error };
  }

  const estimateMinutes =
    data.estimateMinutes ?? (await estimateFromHistory(tx, data.type)) ?? null;
  // Оценка времени обязательна для любой задачи (§9)
  if (!estimateMinutes) {
    return {
      ok: false as const,
      error: "Укажите оценку времени (мин) — истории по таким задачам нет",
    };
  }

  let workQuantity: string | null = null;
  if (data.workId) {
    try { assertProjectMoneyCurrency(project.currency); }
    catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : "Валюта проекта не подготовлена" }; }
    const work = await tx.work.findUnique({ where: { id: data.workId }, select: { paymentKind: true } });
    if (work?.paymentKind === "ENGINEERING") return { ok: false as const, error: "Задачи инженерного фонда создаются через настройку фонда" };
    const check = await checkWorkQuantity(tx, data.workId, data.quantity ?? null, undefined, { projectId: data.projectId, productId: data.productId || null });
    if (check.error) return { ok: false as const, error: check.error };
    workQuantity = check.remaining!;
  }

  const dependencies = await expandDependencies(tx, data.dependencyIds);
  if (dependencies.error) return { ok: false as const, error: dependencies.error };
  const task = await tx.task.create({
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
        create: dependencies.ids.map((dependsOnId) => ({ dependsOnId })),
      },
    },
  });
  return { ok: true as const, task, project };
  });
  if (!mutation.ok) return mutation;
  const { task, project } = mutation;

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

  const mutation = await withTaskTransaction(async (tx) => {
  const task = await tx.task.findUnique({
    where: { id: taskId },
    include: { project: { select: { id: true, number: true, currency: true } }, product: { select: { engineerId: true, status: true, projectId: true } },
      work: { select: { paymentKind: true, projectId: true, productId: true, stagePayPoolId: true, stagePayPool: { select: { id: true, kind: true, state: true, productId: true } } } },
      _count: { select: { payrollEntries: true } } },
  });
  if (!task) return { ok: false as const, error: "Задача не найдена" };
  if (data.workId !== undefined || data.quantity !== undefined) {
    try { assertProjectMoneyCurrency(task.project.currency); }
    catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : "Валюта проекта не подготовлена" }; }
  }
  const engineering = task.work?.paymentKind === "ENGINEERING";
  let engineeringPoolId: string | null = null;
  if (engineering) {
    const pool = task.work?.stagePayPool;
    if (!task.productId || task.product?.status !== "DESIGN" || task.product.projectId !== task.projectId ||
      task.work?.projectId !== task.projectId || task.work.productId !== task.productId ||
      !pool || pool.kind !== "ENGINEERING" || pool.state !== "DRAFT" || pool.productId !== task.productId)
      return { ok: false as const, error: "Инженерную задачу можно менять только на проектировании до начисления" };
    if ((data.workId !== undefined && data.workId !== task.workId) || (data.productId !== undefined && data.productId !== task.productId))
      return { ok: false as const, error: "Нельзя переносить задачу между инженерными фондами" };
    if (await tx.payrollEntry.count({ where: { workId: task.workId } })) return { ok: false as const, error: "По инженерной работе уже есть начисление" };
    engineeringPoolId = pool.id;
  }
  if (data.workId && data.workId !== task.workId) {
    const targetWork = await tx.work.findUnique({ where: { id: data.workId }, select: { paymentKind: true } });
    if (targetWork?.paymentKind === "ENGINEERING") return { ok: false as const, error: "Инженерная работа требует настройки полного распределения долей" };
  }
  if (task.status === "DONE" || task._count.payrollEntries > 0) {
    return { ok: false as const, error: "Выполненная или начисленная задача — только просмотр" };
  }
  if (task.allocationGroupId && (
    (data.workId !== undefined && data.workId !== task.workId) ||
    (data.productId !== undefined && data.productId !== task.productId) ||
    (data.quantity !== undefined && String(data.quantity) !== String(task.quantity))
  )) {
    return { ok: false as const, error: "Объём, работа и изделие общей доли зафиксированы; используйте разделение" };
  }

  // Изделие должно принадлежать проекту задачи
  let product = data.productId === null ? null : task.product;
  if (data.productId) {
    product = await tx.product.findFirst({
      where: { id: data.productId, projectId: task.project.id },
      select: { engineerId: true, status: true, projectId: true },
    });
    if (!product) return { ok: false as const, error: "Изделие не найдено в этом проекте" };
  }
  const nextAssigneeId = data.assigneeId === undefined ? task.assigneeId : data.assigneeId;
  if (nextAssigneeId) {
    const assignee = await tx.user.findUnique({ where: { id: nextAssigneeId }, select: { id: true, roles: true, active: true } });
    const error = assignee ? (engineering ? engineeringRecipientError(assignee, product) : taskRecipientError(assignee, product)) : "Сотрудник не найден";
    if (error) return { ok: false as const, error };
  }

  const becameAssigned =
    data.assigneeId && data.assigneeId !== task.assigneeId;
  const reassignedEngineering = engineering && data.assigneeId !== undefined && data.assigneeId !== task.assigneeId;
  const newStatus = reassignedEngineering ? (data.assigneeId ? "NEW" : "DRAFT")
    : task.status === "DRAFT" && data.assigneeId ? "NEW" : task.status;

  const newWorkId =
    data.workId === undefined ? task.workId : data.workId;
  let quantityValue: string | null | undefined = undefined;
  if (!task.allocationGroupId && (data.workId !== undefined || data.quantity !== undefined || data.productId !== undefined)) {
    if (newWorkId) {
      const check = await checkWorkQuantity(
        tx,
        newWorkId,
        data.quantity ?? (task.quantity ? Number(task.quantity) : null),
        taskId,
        { projectId: task.projectId, productId: data.productId === undefined ? task.productId : data.productId },
      );
      if (check.error) return { ok: false as const, error: check.error };
      quantityValue = check.remaining!;
    } else {
      quantityValue = null;
    }
  }

  const dependencies = data.dependencyIds === undefined ? null : await expandDependencies(tx, data.dependencyIds, taskId);
  if (dependencies?.error) return { ok: false as const, error: dependencies.error };
  if (reassignedEngineering) await stopTaskTimers(tx, taskId);
  await tx.task.update({
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
      splitRevision: { increment: 1 },
    },
  });

  // Зависимости (DAG, §9): заменяем список, без самоссылок и циклов
  if (dependencies) {
    await tx.taskDependency.deleteMany({ where: { taskId } });
    await tx.taskDependency.createMany({ data: dependencies.ids.map((dependsOnId) => ({ taskId, dependsOnId })) });
  }
  if (engineeringPoolId) await bumpEngineeringPoolRevision(tx, engineeringPoolId);
  return { ok: true as const, task, becameAssigned, newStatus };
  });
  if (!mutation.ok) return mutation;
  const { task, becameAssigned, newStatus } = mutation;

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
async function hasCycle(tx: Prisma.TransactionClient, taskId: string, dependencyIds: string[]) {
  const seen = new Set<string>();
  const queue = [...dependencyIds];
  while (queue.length > 0) {
    const current = queue.pop()!;
    if (current === taskId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    const next = await tx.taskDependency.findMany({
      where: { taskId: current },
      select: { dependsOnId: true },
    });
    queue.push(...next.map((edge) => edge.dependsOnId));
  }
  return false;
}

async function expandDependencies(tx: Prisma.TransactionClient, selectedIds: string[], taskId?: string): Promise<{ ids: string[]; error?: string }> {
  const requested = [...new Set(selectedIds)];
  if (!requested.length) return { ids: [] };
  const selected = await tx.task.findMany({ where: { id: { in: requested } }, select: { id: true, allocationGroupId: true } });
  if (selected.length !== requested.length) return { ids: [], error: "Одна из выбранных зависимостей не найдена" };
  const groupIds = [...new Set(selected.map((task) => task.allocationGroupId).filter((id): id is string => !!id))];
  const parts = groupIds.length ? await tx.task.findMany({ where: { allocationGroupId: { in: groupIds } }, select: { id: true } }) : [];
  const ids = [...new Set([...selected, ...parts].map((task) => task.id))];
  if (taskId && (ids.includes(taskId) || await hasCycle(tx, taskId, ids))) return { ids: [], error: "Зависимость образует цикл или включает собственную группу долей" };
  return { ids };
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

export async function changeTaskStatus(
  taskId: string,
  toStatus: "IN_PROGRESS" | "DONE",
  actualMinutes?: number,
): Promise<{ ok: boolean; error?: string; timeRequired?: boolean }> {
  const session = await requireUser();
  const result = await changeTaskStatusCore({ id: session.user.id, name: session.user.name ?? "", roles: session.user.roles, source: "web" }, taskId, toStatus, actualMinutes, withTaskTransaction);
  if (!result.ok) return result;
  if (!result.repeated) {
    if (result.eventId) await dispatchEvent(result.eventId);
    if (result.payroll) await notifyOrg({
      type: "payroll.orgAccrued",
      title: `Начислено ${result.payroll.name}: ${formatAmount(result.payroll.amount, result.payroll.currency)}`,
      body: `Сдельно · ${result.task.title} · ${result.task.projectNumber}`,
      link: "/finance/payroll", exceptUserId: session.user.id,
    });
    if (result.task.assigneeId && result.task.assigneeId !== session.user.id) await notifyPerson({
      userId: result.task.assigneeId, type: "task.statusChanged",
      title: `Задача «${result.task.title}»: ${toStatus === "DONE" ? "выполнена" : "в работе"}`,
      body: `Проект ${result.task.projectNumber}`, link: "/my",
    });
    await notifyOrg({
      type: "task.statusChanged",
      title: `Задача «${result.task.title}»: ${toStatus === "DONE" ? "выполнена" : "в работе"}`,
      body: `Проект ${result.task.projectNumber} · ${session.user.name ?? ""}`,
      link: result.task.productNumber ? `/products/${result.task.productNumber}` : `/projects/${result.task.projectId}`,
      exceptUserId: session.user.id,
    });
  }
  revalidatePath(`/projects/${result.task.projectId}`);
  await revalidateProductPaths(result.task.productId);
  revalidatePath("/my");
  revalidatePath("/tasks");
  return { ok: true };
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
  const mutation = await withTaskTransaction(async (tx) => {
  const task = await tx.task.findUnique({
    where: { id: taskId },
    include: { project: { select: { id: true, number: true, currency: true } }, work: { select: { paymentKind: true } }, _count: { select: { payrollEntries: true } } },
  });
  if (!task) return { ok: false as const, error: "Задача не найдена" };
  if (task.work?.paymentKind === "ENGINEERING") return { ok: false as const, error: "Задача входит в распределение инженерного фонда — её долю можно передать или перераспределить" };
  if (task.allocationGroupId) return { ok: false as const, error: "Отдельную долю общей работы удалить нельзя — её объём и бюджет должны сохраниться" };
  if (task.status === "DONE" || task._count.payrollEntries > 0) {
    return {
      ok: false as const,
      error: "Выполненную задачу удалить нельзя — там начисления и история",
    };
  }

  await tx.taskDependency.deleteMany({
      where: { OR: [{ taskId }, { dependsOnId: taskId }] },
    });
  await tx.timeEntry.deleteMany({ where: { taskId } });
  await tx.file.updateMany({ where: { taskId }, data: { taskId: null } });
  await tx.task.delete({ where: { id: taskId } });
  return { ok: true as const, task };
  });
  if (!mutation.ok) return mutation;
  const { task } = mutation;

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
