export const MAX_TIMER_MINUTES = 720;

/** Формула сохранённой истории; используется только отдельным операторским cutoff. */
export function timerStopSnapshot(startedAt: Date, instant: Date) {
  const start = startedAt.getTime(), stop = instant.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(stop)) throw Error("Некорректная дата таймера");
  const elapsed = Math.max(0, stop - start), limit = MAX_TIMER_MINUTES * 60000;
  const autoStopped = elapsed >= limit;
  return { minutes: Math.min(MAX_TIMER_MINUTES, Math.max(1, Math.floor(elapsed / 60000))),
    stoppedAt: new Date(autoStopped ? start + limit : stop), autoStopped };
}
