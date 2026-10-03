// Синхронизация реестра плагинов с БД при старте сервера (§14).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { syncPlugins } = await import("@/server/plugins/sync");
    await syncPlugins();
    const {startCalendarReminderWorker}=await import("@/server/calendar/reminder-worker");
    try {startCalendarReminderWorker();} catch {console.error("[calendar-reminders] invalid environment; worker disabled");}
  }
}
