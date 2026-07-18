// Синхронизация реестра плагинов с БД при старте сервера (§14).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { syncPlugins } = await import("@/server/plugins/sync");
    await syncPlugins();
  }
}
