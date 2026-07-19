"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeChangeLog } from "@/server/plugins/changelog";

import { MANAGER_ROLES } from "@/server/projects/queries";

const AUTOSTOP_MINUTES = 12 * 60; // §19: автостоп по таймауту 12 ч с пометкой

// Автостоп «забытых» таймеров (вызывается при чтении/старте/стопе).
async function autostopExpired(userId: string): Promise<void> {
  const edge = new Date(Date.now() - AUTOSTOP_MINUTES * 60 * 1000);
  await prisma.timeEntry.updateMany({
    where: { userId, stoppedAt: null, startedAt: { lt: edge } },
    data: { stoppedAt: new Date(), autoStopped: true, minutes: AUTOSTOP_MINUTES },
  });
}

export async function getActiveTimer(userId: string) {
  await autostopExpired(userId);
  return prisma.timeEntry.findFirst({
    where: { userId, stoppedAt: null },
    include: {
      task: {
        select: {
          id: true,
          title: true,
          project: { select: { id: true, number: true } },
        },
      },
    },
  });
}

// Старт таймера по задаче (§9): серверный, переживает перезаход/другое
// устройство. Один активный таймер на пользователя — прежний глушим автостопом.
export async function startTimer(
  taskId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) throw new Error("Не авторизован");

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return { ok: false, error: "Задача не найдена" };
  if (task.status === "DONE") return { ok: false, error: "Задача уже выполнена" };
  const isAssignee = task.assigneeId === session.user.id;
  if (!isAssignee && !MANAGER_ROLES.includes(session.user.role)) {
    return { ok: false, error: "Недостаточно прав" };
  }

  // Один активный таймер: прежний останавливаем
  await prisma.timeEntry.updateMany({
    where: { userId: session.user.id, stoppedAt: null },
    data: { stoppedAt: new Date() },
  });
  await prisma.$executeRaw`
    UPDATE "TimeEntry" SET "minutes" = GREATEST(1, FLOOR(EXTRACT(EPOCH FROM ("stoppedAt" - "startedAt")) / 60)::int)
    WHERE "userId" = ${session.user.id} AND "stoppedAt" IS NOT NULL AND "minutes" = 0
  `;

  await prisma.timeEntry.create({
    data: { taskId, userId: session.user.id, source: "timer" },
  });
  revalidatePath("/my");
  return { ok: true };
}

// Стоп активного таймера — пишет факт (§9).
export async function stopTimer(): Promise<{
  ok: boolean;
  minutes?: number;
  error?: string;
}> {
  const session = await auth();
  if (!session?.user) throw new Error("Не авторизован");

  const active = await prisma.timeEntry.findFirst({
    where: { userId: session.user.id, stoppedAt: null },
  });
  if (!active) return { ok: false, error: "Активного таймера нет" };

  const minutes = Math.max(
    1,
    Math.floor((Date.now() - active.startedAt.getTime()) / 60000),
  );
  await prisma.timeEntry.update({
    where: { id: active.id },
    data: { stoppedAt: new Date(), minutes },
  });
  revalidatePath("/my");
  return { ok: true, minutes };
}

const manualSchema = z.object({
  taskId: z.string(),
  minutes: z.number().int().min(1, "Минимум 1 минута").max(24 * 60, "Больше суток?"),
});

// Ручной ввод времени (§9) — на случай забытого таймера.
export async function addManualTime(
  input: z.infer<typeof manualSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) throw new Error("Не авторизован");
  const parsed = manualSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  }
  const task = await prisma.task.findUnique({
    where: { id: parsed.data.taskId },
  });
  if (!task) return { ok: false, error: "Задача не найдена" };
  const isAssignee = task.assigneeId === session.user.id;
  if (!isAssignee && !MANAGER_ROLES.includes(session.user.role)) {
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
  const result = await prisma.timeEntry.aggregate({
    where: { taskId, stoppedAt: { not: null } },
    _sum: { minutes: true },
  });
  return result._sum.minutes ?? 0;
}
