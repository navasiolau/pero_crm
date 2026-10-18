// Синхронизация реестра плагинов с БД при старте сервера (§14).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { syncPlugins } = await import("@/server/plugins/sync");
    await syncPlugins();
    const { startDomainEventWorker } = await import("@/server/plugins/event-worker");
    try { startDomainEventWorker(); } catch { console.error("[domain-events] invalid environment; worker disabled"); }
    const {startCalendarReminderWorker}=await import("@/server/calendar/reminder-worker");
    try {startCalendarReminderWorker();} catch {console.error("[calendar-reminders] invalid environment; worker disabled");}
    if (process.env.PERO_KP_ENABLED === "1" && process.env.PERO_KP_WORKER_ENABLED === "1") {
      try { const { startKpRenderRuntime } = await import("@/server/kp/api-render-runtime"); startKpRenderRuntime(); }
      catch { console.error("[kp-render] invalid environment; worker disabled"); }
    }
    const { startKpRetentionWorker } = await import("@/server/kp/retention-worker");
    try { await startKpRetentionWorker(); } catch { console.error("[kp-retention] invalid environment; worker disabled"); }
  }
}
