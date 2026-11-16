import { prisma } from "@/lib/prisma";

import { isApiCompatible, listManifests } from "./registry";
import { syncPluginMetadata } from "./sync-core";
import { writeChangeLogInTransaction } from "@/server/changelog/writer";

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
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(228, hashtext(${`plugin-metadata:${manifest.id}`}))`;
      await syncPluginMetadata(tx.plugin, manifest, async (before, after) => {
        await writeChangeLogInTransaction(tx, { actorType: "system", actorId: "system:plugins", actorName: "Система", source: "system",
          entity: "plugin", entityId: manifest.id, action: before ? "update" : "create", oldValue: before, newValue: after }, {
          before, after, entity: { label: `Модуль ${manifest.name}`, href: `/settings/modules/${encodeURIComponent(manifest.id)}` },
          reason: "Синхронизация реестра модулей при запуске",
        });
      });
    });
  }
}
