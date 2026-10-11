"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {withTaskTransaction} from '../tasks/transaction';
import { startTaskTimer, stopTimers } from "./timers";
import { writeChangeLog } from "@/server/plugins/changelog";

import { MANAGER_ROLES, OFFICE_WRITE_ROLES, hasAnyRole } from "@/lib/roles";
import { resolveVisibilityActor, taskExecutionWhere, taskVisibilityWhere } from "@/server/access/visibility";

// Автостоп и чтение используют текущий scope под той же task transaction.
export async function getActiveTimer() {
  const session = await auth();
  if (!session?.user) throw new Error("Не авторизован");
  return withTaskTransaction(async tx => {
    const instant = new Date();
    const actor = await resolveVisibilityActor(tx, session.user);
    const scope = { userId: session.user.id, task: taskExecutionWhere(actor) };
    await stopTimers(tx, scope, instant, true);
    return tx.timeEntry.findFirst({ where: { ...scope, source: "timer", stoppedAt: null },
      include: { task: { select: { id: true, title: true, project: { select: { id: true, number: true } } } } } });
  });
}

// Старт таймера по задаче (§9): серверный, переживает перезаход/другое
// устройство. Один активный таймер на пользователя — прежний глушим автостопом.
export async function startTimer(
  taskId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) throw new Error("Не авторизован");
  const result=await withTaskTransaction(async tx=>{
  const instant = new Date();
  const actor = await resolveVisibilityActor(tx, session.user);

  const task = await tx.task.findFirst({ where: { AND: [{ id: taskId }, taskExecutionWhere(actor)] } });
  if (!task) return { ok: false, error: "Задача не найдена" };
  if (task.status === "DONE") return { ok: false, error: "Задача уже выполнена" };
  const isAssignee = task.assigneeId === session.user.id;
  if (!isAssignee && !hasAnyRole(session.user.roles, MANAGER_ROLES)) {
    return { ok: false, error: "Недостаточно прав" };
  }

  await startTaskTimer(tx, taskId, session.user.id, instant);
  return { ok: true };
  });
  if(result.ok)revalidatePath("/my");
  return result;
}

// Стоп активного таймера — пишет факт (§9).
export async function stopTimer(): Promise<{ ok: boolean; minutes?: number; error?: string }> {
  const session = await auth();
  if (!session?.user) throw new Error("Не авторизован");
  const result = await withTaskTransaction(async tx => {
    const instant = new Date();
    const actor = await resolveVisibilityActor(tx, session.user);
    const scope = { userId: session.user.id, task: taskExecutionWhere(actor) };
    const active = await tx.timeEntry.findFirst({ where: { ...scope, source: "timer", stoppedAt: null } });
    if (!active) return { ok: false, error: "Активного таймера нет" };
    const [stopped] = await stopTimers(tx, { ...scope, id: active.id }, instant);
    return stopped ? { ok: true, minutes: stopped.minutes } : { ok: false, error: "Активного таймера нет" };
  });
  if (result.ok) revalidatePath("/my");
  return result;
}

const manualSchema = z.object({
  taskId: z.string(),
  minutes: z.number().int().min(1, "Минимум 1 минута").max(24 * 60, "Больше суток?"),
});

// Ручной ввод времени (§9) — только офисные роли и менеджмент.
// Работнику и монтажнику ручной ввод закрыт (требование владельца):
// их время считается только таймером — иначе можно обмануть руководство.
// Забыли таймер — правку вносит менеджер (с записью в журнал, §19).
// Комбинированные роли: запрет действует только если НИ одна из ролей
// пользователя не офисная (приоритет старшей роли, §4).

export async function addManualTime(
  input: z.infer<typeof manualSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) throw new Error("Не авторизован");
  if (!hasAnyRole(session.user.roles, OFFICE_WRITE_ROLES)) {
    return {
      ok: false,
      error:
        "Ручной ввод времени недоступен — время считается таймером автоматически. Если таймер забыли, обратитесь к менеджеру",
    };
  }
  const parsed = manualSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  }
  const actor = await resolveVisibilityActor(prisma, session.user);
  const task = await prisma.task.findFirst({
    where: { AND: [{ id: parsed.data.taskId }, taskExecutionWhere(actor)] },
  });
  if (!task) return { ok: false, error: "Задача не найдена" };
  const isAssignee = task.assigneeId === session.user.id;
  if (!isAssignee && !hasAnyRole(session.user.roles, MANAGER_ROLES)) {
    return { ok: false, error: "Недостаточно прав" };
  }

  await prisma.timeEntry.create({
    data: {
      taskId: task.id,
      userId: session.user.id,
      source: "manual",
      stoppedAt: new Date(),
      minutes: parsed.data.minutes,
    },
  });
  await writeChangeLog({
    actorType: "user",
    actorId: session.user.id,
    actorName: session.user.name ?? undefined,
    entity: "task",
    entityId: task.id,
    action: "time",
    newValue: { manual: parsed.data.minutes },
  });
  revalidatePath("/my");
  revalidatePath(`/projects/${task.projectId}`);
  return { ok: true };
}

// Фактическое время задачи (§9): сумма завершённых записей.
export async function spentMinutes(taskId: string): Promise<number> {
  const session = await auth();
  if (!session?.user) throw new Error("Не авторизован");
  const actor = await resolveVisibilityActor(prisma, session.user);
  const result = await prisma.timeEntry.aggregate({
    where: { taskId, stoppedAt: { not: null }, task: taskVisibilityWhere(actor) },
    _sum: { minutes: true },
  });
  return result._sum.minutes ?? 0;
}
