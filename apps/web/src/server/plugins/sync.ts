import { prisma } from "@/lib/prisma";

import { isApiCompatible, listManifests } from "./registry";
import { syncPluginMetadata } from "./sync-core";

// Синхронизация реестра с БД: upsert строк Plugin по манифестам.
// enabled и настройки не трогаем — выключение/данные сохраняются (§14).
// Вызывается из instrumentation.ts при старте сервера.
export async function syncPlugins(): Promise<void> {
  for (const manifest of listManifests()) {
    if (!isApiCompatible(manifest)) {
      console.warn(
        `[plugins] Манифест "${manifest.id}" несовместим с Plugin API ядра — пропущен`,
      );
      continue;
    }
    await syncPluginMetadata(prisma.plugin, manifest);
  }
}
