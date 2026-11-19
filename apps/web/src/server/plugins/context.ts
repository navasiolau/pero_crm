import { assertPluginAuditEntry, assertPluginEventType, pluginReadDatabase } from "./read-database";
import type { PluginContext } from "@pero/plugin-sdk";

import { prisma } from "@/lib/prisma";

import { writeChangeLogInTransaction } from "@/server/changelog/writer";
import type { JournalPerson } from "@/server/changelog/contract";
import { getManifest } from "./registry";
import { getPluginSettings, logPluginRun } from "./run-log";

type DomainEventEmitter = (type: string, payload: unknown, actor: string) => Promise<void>;

// Контекст, выдаваемый хукам и командам плагина (§14).
// requirePermission — прагматичная проверка прав из манифеста:
// доверенный код в процессе, но объявленные permissions контролируются.
export async function buildPluginContext(
  pluginId: string,
  emitter: DomainEventEmitter,
  initiator?: JournalPerson,
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
    db: pluginReadDatabase(prisma, manifest.permissions),
    logger: {
      info: (message) =>
        logPluginRun({ pluginId, kind: "hook", status: "ok", message }),
      error: (message) =>
        logPluginRun({ pluginId, kind: "hook", status: "error", message }),
    },
    audit: async (entry) => {
      assertPluginAuditEntry(pluginId, entry);
      await writeChangeLogInTransaction(prisma, {
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
      }, { actor: { type: "system", id: "system", name: "Система" }, ...(initiator ? { initiator } : {}),
        reason: `Действие модуля «${manifest.name}»`,
        ...(entry.entity === "plugin" && entry.entityId === pluginId ? { entity: { label: `Модуль ${manifest.name}`, href: `/settings/modules/${encodeURIComponent(pluginId)}` } } : {}),
      });
    },
    emit: (type, payload) => {
      assertPluginEventType(pluginId, type);
      return emitter(type, payload, actor);
    },
    requirePermission: (permission: string) => {
      if (!manifest.permissions.includes(permission)) {
        throw new Error(
          `Плагин "${pluginId}" не заявил право "${permission}" в манифесте`,
        );
      }
    },
  };
}
