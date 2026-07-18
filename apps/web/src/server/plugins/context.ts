import type { PluginContext } from "@pero/plugin-sdk";

import { prisma } from "@/lib/prisma";

import { writeChangeLog } from "./changelog";
import { emitDomainEvent } from "./events";
import { getManifest } from "./registry";
import { getPluginSettings, logPluginRun } from "./run-log";

// Контекст, выдаваемый хукам и командам плагина (§14).
// requirePermission — прагматичная проверка прав из манифеста:
// доверенный код в процессе, но объявленные permissions контролируются.
export async function buildPluginContext(
  pluginId: string,
): Promise<PluginContext> {
  const manifest = getManifest(pluginId);
  if (!manifest) {
    throw new Error(`Плагин "${pluginId}" не найден в реестре`);
  }
  const settings = await getPluginSettings(pluginId);
  const actor = `plugin:${pluginId}`;

  return {
    pluginId,
    actor,
    settings,
    db: prisma,
    logger: {
      info: (message) =>
        logPluginRun({ pluginId, kind: "hook", status: "ok", message }),
      error: (message) =>
        logPluginRun({ pluginId, kind: "hook", status: "error", message }),
    },
    audit: async (entry) => {
      await writeChangeLog({
        actorType: "plugin",
        actorId: actor,
        actorName: manifest.name,
        entity: entry.entity,
        entityId: entry.entityId,
        action: entry.action,
        field: entry.field,
        oldValue: entry.oldValue,
        newValue: entry.newValue,
        source: "plugin",
      });
    },
    emit: (type, payload) => emitDomainEvent(type, payload, actor),
    requirePermission: (permission: string) => {
      if (!manifest.permissions.includes(permission)) {
        throw new Error(
          `Плагин "${pluginId}" не заявил право "${permission}" в манифесте`,
        );
      }
    },
  };
}
