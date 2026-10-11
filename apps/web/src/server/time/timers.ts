import type { Prisma } from "@prisma/client";

export const MAX_TIMER_MINUTES = 720;
type TimerScope = Pick<Prisma.TimeEntryWhereInput, "id" | "userId" | "taskId" | "task">;

/** Все пути фиксируют один факт из одного instant; закрытая история сюда не попадает. */
export function timerStopSnapshot(startedAt: Date, instant: Date) {
  const start = startedAt.getTime(), stop = instant.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(stop)) throw Error("Некорректная дата таймера");
  const elapsed = Math.max(0, stop - start), limit = MAX_TIMER_MINUTES * 60000;
  const autoStopped = elapsed >= limit;
  return { minutes: Math.min(MAX_TIMER_MINUTES, Math.max(1, Math.floor(elapsed / 60000))),
    stoppedAt: new Date(autoStopped ? start + limit : stop), autoStopped };
}

export async function stopTimers(tx: Prisma.TransactionClient, scope: TimerScope, instant: Date, expiredOnly = false) {
  if (!scope.id && !scope.userId && !scope.taskId) throw Error("Не определён контекст таймера");
  const where: Prisma.TimeEntryWhereInput = { ...scope, source: "timer", stoppedAt: null };
  const timers = await tx.timeEntry.findMany({ where, select: { id: true, startedAt: true } });
  const stopped: ({ id: string } & ReturnType<typeof timerStopSnapshot>)[] = [];
  for (const timer of timers) {
    const data = timerStopSnapshot(timer.startedAt, instant);
    if (expiredOnly && !data.autoStopped) continue;
    // Повторная текущая ACL и stoppedAt=null защищают от revoke и позднего stop.
    const changed = await tx.timeEntry.updateMany({ where: { ...where, id: timer.id }, data });
    if (changed.count === 1) stopped.push({ id: timer.id, ...data });
  }
  return stopped;
}

/** Caller уже проверил task/actor и держит общий task lock в переданной transaction. */
export async function startTaskTimer(tx: Prisma.TransactionClient, taskId: string, userId: string, instant: Date) {
  const active = await tx.timeEntry.findFirst({ where: { userId, taskId, source: "timer", stoppedAt: null }, select: { id: true, startedAt: true } });
  if (active && !timerStopSnapshot(active.startedAt, instant).autoStopped) {
    await stopTimers(tx, { userId, id: { not: active.id } }, instant);
    return;
  }
  await stopTimers(tx, { userId }, instant);
  await tx.timeEntry.create({ data: { taskId, userId, source: "timer", startedAt: instant } });
}
